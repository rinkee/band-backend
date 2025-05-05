// supabase/functions/orders/get-all/index.ts
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// CORS 헤더 설정
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // OPTIONS 요청 처리
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }
  // GET 요청 외 거부
  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ success: false, message: "허용되지 않는 메소드 (GET)" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  let supabase: SupabaseClient;

  try {
    // Supabase 클라이언트 초기화 (Service Role Key 사용)
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey)
      throw new Error("Missing Supabase URL or Service Role Key");
    supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    console.log("Supabase client initialized.");
  } catch (error) {
    const status =
      error.message.includes("Authorization") || error.message.includes("token")
        ? 401
        : 500;
    console.error("Auth or Supabase init error:", error.message);
    return new Response(
      JSON.stringify({ success: false, message: error.message }),
      {
        status: status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    // URL에서 쿼리 파라미터 추출 및 기본값 설정
    const url = new URL(req.url);
    const params = url.searchParams;
    const userId = params.get("userId");

    if (!userId) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "쿼리 파라미터 'userId'가 필요합니다.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    // ==========================================

    // 필터 파라미터
    const statusFilter = params.get("status");
    const subStatusFilter = params.get("subStatus");
    const searchFilter = params.get("search");
    const startDateFilter = params.get("startDate");
    const endDateFilter = params.get("endDate");

    // 페이지네이션 및 정렬 파라미터
    const page = parseInt(params.get("page") || "1", 10);
    const limit = parseInt(params.get("limit") || "30", 10);
    const sortBy = params.get("sortBy") || "ordered_at"; // DB 컬럼명과 일치해야 함
    const ascending = params.get("sortOrder")?.toLowerCase() === "asc";

    const startIndex = (page - 1) * limit;
    console.log("Query Params:", {
      userId,
      statusFilter,
      subStatusFilter,
      searchFilter,
      startDateFilter,
      endDateFilter,
      page,
      limit,
      sortBy,
      sortOrder: ascending ? "asc" : "desc",
    });

    // --- 쿼리 빌더 시작 ('orders_with_products' 뷰 사용 가정) ---
    let query = supabase
      .from("orders_with_products") // 실제 뷰 이름 확인!
      .select("*", { count: "exact" })
      .eq("user_id", userId); // 사용자 본인 주문만 조회

    // --- 필터링 ---
    if (
      statusFilter &&
      statusFilter !== "all" &&
      statusFilter !== "undefined"
    ) {
      const statusValues = statusFilter
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s);
      if (statusValues.length > 0) query = query.in("status", statusValues);
    }
    if (
      subStatusFilter &&
      subStatusFilter !== "all" &&
      subStatusFilter !== "undefined"
    ) {
      if (
        subStatusFilter.toLowerCase() === "none" ||
        subStatusFilter.toLowerCase() === "null"
      ) {
        query = query.is("sub_status", null);
      } else {
        const subStatusValues = subStatusFilter
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s);
        if (subStatusValues.length > 0)
          query = query.in("sub_status", subStatusValues);
      }
    }
    if (searchFilter && searchFilter !== "undefined") {
      const searchTerm = `%${searchFilter}%`;
      // 뷰 컬럼명 확인 (customer_name, product_title, product_barcode)
      query = query.or(
        `customer_name.ilike.${searchTerm},product_title.ilike.${searchTerm},product_barcode.ilike.${searchTerm}`
      );
    }
    if (startDateFilter && endDateFilter) {
      try {
        const start = new Date(startDateFilter).toISOString();
        const end = new Date(endDateFilter);
        end.setHours(23, 59, 59, 999);
        query = query
          .gte("ordered_at", start)
          .lte("ordered_at", end.toISOString());
      } catch (dateError) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "날짜 형식이 잘못되었습니다.",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // --- 정렬 및 페이지네이션 ---
    query = query
      .order(sortBy, { ascending: ascending })
      .range(startIndex, startIndex + limit - 1);

    // --- 쿼리 실행 ---
    const { data, error, count } = await query;

    if (error) {
      console.error("Supabase query error:", error);
      if (
        error.message.includes("relation") &&
        error.message.includes("does not exist")
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "데이터베이스 뷰 또는 관계 오류.",
            error: error.message,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      throw error;
    }

    const totalPages = count ? Math.ceil(count / limit) : 0;
    console.log(`Query successful. Found ${count} total items.`);

    // --- 성공 응답 ---
    return new Response(
      JSON.stringify({
        success: true,
        data: data || [],
        pagination: { total: count || 0, totalPages, currentPage: page, limit },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Unhandled error in orders/get-all:", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "주문 목록 조회 중 오류 발생",
        error: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/*
// 사용 예시 (프론트엔드)
// supabase.functions.invoke('orders/get-all?status=주문완료&page=1&limit=20&sortBy=customer_name&sortOrder=asc', { method: 'GET', headers: { Authorization: `Bearer ${token}` } })
// 또는 fetch('/functions/v1/orders/get-all?status=...', { headers: { apikey, Authorization } })
*/
