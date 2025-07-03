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
  } catch (error: any) {
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
    const exactCustomerNameFilter = params.get("exactCustomerName"); // <<< 정확한 고객명 파라미터 받기

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
      exactCustomerNameFilter,
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

    // 제외고객 목록 가져오기 (항상 적용)
    let excludedCustomers: string[] = [];
    try {
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("excluded_customers")
        .eq("id", userId)
        .single();

      if (userError) {
        console.error(
          `Failed to fetch excluded customers for user ${userId}: ${userError.message}`
        );
      } else if (
        userData?.excluded_customers &&
        Array.isArray(userData.excluded_customers)
      ) {
        excludedCustomers = userData.excluded_customers;
        console.log(
          `Loaded ${excludedCustomers.length} excluded customers for filtering`
        );
      }
    } catch (e: any) {
      console.error(`Error fetching excluded customers: ${e.message}`);
    }
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
    // 검색 조건은 아래에서 통합 처리
    if (startDateFilter && endDateFilter) {
      try {
        const start = new Date(startDateFilter).toISOString();
        const end = new Date(endDateFilter);
        end.setHours(23, 59, 59, 999);
        query = query
          .gte("ordered_at", start)
          .lte("ordered_at", end.toISOString());
      } catch (dateError: any) {
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

    // --- 👇 4. 검색 조건 (정확한 고객명 필터 및 post_key 우선 적용) 👇 ---
    if (exactCustomerNameFilter && exactCustomerNameFilter !== "undefined") {
      // 4.1. 정확한 고객명 필터가 있으면, 그것만 적용 (eq 사용)
      console.log(`Applying EXACT customer filter: ${exactCustomerNameFilter}`);
      query = query.eq("customer_name", exactCustomerNameFilter);
    } else if (searchFilter && searchFilter !== "undefined") {
      // 4.2. post_key 검색인지 확인 (길이가 길고 공백이 없는 문자열)
      console.log(`[DEBUG] Received searchFilter: "${searchFilter}"`);
      const isPostKeySearch =
        searchFilter.length > 20 && !searchFilter.includes(" ");

      console.log(`[DEBUG] isPostKeySearch: ${isPostKeySearch}`);

      if (isPostKeySearch) {
        console.log(
          `[DEBUG] Applying EXACT post_key filter: "${searchFilter}"`
        );
        query = query.eq("post_key", searchFilter);
      } else {
        // 4.3. 일반 검색어는 ILIKE 사용 (이스케이프 처리 포함)
        const escapedSearch = searchFilter
          .replace(/\\/g, "\\\\") // 백슬래시 먼저
          .replace(/%/g, "\\%") // 퍼센트
          .replace(/_/g, "\\_") // 언더스코어
          .replace(/\(/g, "\\(") // 여는 괄호
          .replace(/\)/g, "\\)"); // 닫는 괄호

        const searchTerm = `%${escapedSearch}%`;
        console.log(`Applying GENERAL search with escaped term: ${searchTerm}`);
        query = query.or(
          `customer_name.ilike.${searchTerm},product_title.ilike.${searchTerm},product_barcode.ilike.${searchTerm},comment.ilike.${searchTerm},post_key.ilike.${searchTerm}`
        );
      }
    }
    // --- 👆 검색 조건 끝 👆 ---

    console.log("[DEBUG] Final Query:", query);

    // 제외고객 필터링 적용 (항상)
    if (excludedCustomers.length > 0) {
      query = query.not("customer_name", "in", excludedCustomers);
      console.log(
        `Filtering out ${excludedCustomers.length} excluded customers`
      );
    }

    // --- 정렬 및 페이지네이션 ---
    query = query
      .order(sortBy, { ascending: ascending })
      .range(startIndex, startIndex + limit - 1);

    // --- 쿼리 실행 ---
    const { data, error, count } = await query;

    if (error) {
      console.error("Database query error:", error.message);
      // 더 구체적인 에러 메시지나 상태 코드 반환 가능
      if (error.code === "42P01") {
        // 'undefined_table'
        return new Response(
          JSON.stringify({
            success: false,
            message: `DB 오류: '${sortBy}' 컬럼 또는 'orders_with_products' 뷰를 찾을 수 없습니다.`,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      throw error; // 다른 DB 에러는 그대로 throw
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
  } catch (error: any) {
    // 최상위 에러 핸들러
    console.error("An unexpected error occurred:", error.message);
    return new Response(
      JSON.stringify({ success: false, message: "내부 서버 오류" }),
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
