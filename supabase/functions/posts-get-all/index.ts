// supabase/functions/posts/get-all/index.ts - NO JWT AUTH
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
// import { verifyToken } from '../../_shared/jwt.ts'; // 제거

// CORS 헤더 설정
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // OPTIONS, GET 외 거부
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders, status: 204 });
  if (req.method !== "GET")
    return new Response(
      JSON.stringify({ success: false, message: "허용되지 않는 메소드 (GET)" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  let supabase: SupabaseClient;

  try {
    // Supabase 클라이언트 초기화
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); // 또는 Anon Key
    if (!supabaseUrl || !serviceKey)
      throw new Error("Missing Supabase URL or Key");
    supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    console.log("Supabase client initialized.");
  } catch (error) {
    console.error("Supabase init error:", error.message);
    return new Response(
      JSON.stringify({ success: false, message: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    // URL에서 쿼리 파라미터 추출
    const url = new URL(req.url);
    const params = url.searchParams;

    // === JWT 제거: bandNumber를 쿼리 파라미터에서 받음 ===
    const bandNumber = params.get("bandNumber");
    if (!bandNumber) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "쿼리 파라미터 'bandNumber'가 필요합니다.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    // ===============================================

    // 페이지네이션 및 정렬, 필터 파라미터
    const page = parseInt(params.get("page") || "1", 10);
    const limit = parseInt(params.get("limit") || "30", 10);
    const startIndex = (page - 1) * limit;
    const sortBy = params.get("sortBy") || "posted_at"; // DB 컬럼명 확인
    const ascending = params.get("sortOrder")?.toLowerCase() === "asc";
    const statusFilter = params.get("status");
    const searchFilter = params.get("search"); // 검색 필드 (예: title) 확인 필요
    const startDateFilter = params.get("startDate");
    const endDateFilter = params.get("endDate");

    console.log("Query Params (No Auth):", {
      bandNumber,
      page,
      limit,
      sortBy,
      sortOrder: ascending ? "asc" : "desc",
      statusFilter,
      searchFilter,
      startDateFilter,
      endDateFilter,
    });

    // --- 쿼리 시작 ---
    let query = supabase
      .from("posts") // 실제 게시글 테이블 이름 확인!
      .select("*", { count: "exact" }) // 필요한 컬럼만 선택 권장
      .eq("band_number", bandNumber); // <<<--- 쿼리 파라미터 bandNumber로 필터링

    // --- 필터링 ---
    if (
      statusFilter &&
      statusFilter !== "undefined" &&
      statusFilter !== "all"
    ) {
      query = query.eq("status", statusFilter); // 'status' 컬럼 존재 확인
    }
    if (searchFilter && searchFilter !== "undefined") {
      // 'title' 외 다른 컬럼도 검색하려면 .or() 사용
      query = query.ilike("title", `%${searchFilter}%`); // 'title' 컬럼 존재 확인
    }
    if (startDateFilter && endDateFilter) {
      try {
        const start = new Date(startDateFilter).toISOString();
        const end = new Date(endDateFilter);
        end.setHours(23, 59, 59, 999);
        query = query
          .gte("posted_at", start)
          .lte("posted_at", end.toISOString()); // 'posted_at' 컬럼 확인
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
      throw error;
    }

    const totalPages = count ? Math.ceil(count / limit) : 0;
    console.log(
      `Query successful. Found ${count} total posts for band ${bandNumber}.`
    );

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
    console.error("Unhandled error in posts/get-all (No Auth):", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "게시글 목록 조회 중 오류 발생",
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
// 사용 예시 (프론트엔드 - JWT 불필요, apikey는 필요)
// fetch('/functions/v1/posts/get-all?bandNumber=BAND_ID&page=1&status=활성', { headers: { apikey } })
*/
