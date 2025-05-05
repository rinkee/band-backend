// supabase/functions/products-get-all/index.ts - NO JWT AUTH
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
// import { verifyToken } from '../_shared/jwt.ts'; // 제거

// === CORS 헤더 가져오기 ===
import { corsHeadersGet, createJsonResponseHeaders } from "../_shared/cors.ts"; // 경로 확인!

// === 응답 헤더 생성 (JSON 용) ===
const responseHeaders = createJsonResponseHeaders(corsHeadersGet); // GET 요청용 헤더 사용

Deno.serve(async (req: Request) => {
  // OPTIONS, GET 외 거부
  if (req.method === "OPTIONS")
    return new Response(null, { headers: responseHeaders, status: 204 });
  if (req.method !== "GET")
    return new Response(
      JSON.stringify({ success: false, message: "허용되지 않는 메소드 (GET)" }),
      {
        status: 405,
        headers: responseHeaders,
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
        headers: responseHeaders,
      }
    );
  }

  try {
    // URL 파라미터 추출
    const url = new URL(req.url);
    const params = url.searchParams;

    // === JWT 제거: userId를 쿼리 파라미터에서 받음 ===
    const userId = params.get("userId");
    if (!userId) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "쿼리 파라미터 'userId'가 필요합니다.",
        }),
        {
          status: 400,
          headers: responseHeaders,
        }
      );
    }
    // ==========================================

    // 페이지네이션, 정렬, 필터 파라미터
    const page = parseInt(params.get("page") || "1", 10);
    const limit = parseInt(params.get("limit") || "10", 10); // 기본값 10
    const startIndex = (page - 1) * limit;
    const sortBy = params.get("sortBy") || "posted_at"; // DB 컬럼 확인 (posted_at, created_at, updated_at 등)
    const ascending = params.get("sortOrder")?.toLowerCase() === "asc";
    const statusFilter = params.get("status");
    const searchFilter = params.get("search");

    console.log("Query Params (No Auth):", {
      userId,
      page,
      limit,
      sortBy,
      sortOrder: ascending ? "asc" : "desc",
      statusFilter,
      searchFilter,
    });

    // --- 쿼리 시작 ---
    let query = supabase
      .from("products") // 실제 상품 테이블 이름 확인!
      .select("*", { count: "exact" })
      .eq("user_id", userId); // <<<--- 쿼리 파라미터 userId로 필터링

    // --- 필터링 ---
    if (
      statusFilter &&
      statusFilter !== "all" &&
      statusFilter !== "undefined"
    ) {
      query = query.eq("status", statusFilter); // 'status' 컬럼 확인
    }
    if (searchFilter && searchFilter !== "undefined") {
      const searchTerm = `%${searchFilter}%`;
      // title, barcode 컬럼 확인
      query = query.or(`title.ilike.${searchTerm},barcode.ilike.${searchTerm}`);
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

    const totalItems = count || 0;
    const totalPages = Math.ceil(totalItems / limit);
    console.log(
      `Query successful. Found ${totalItems} total products for user ${userId}.`
    );

    // --- 성공 응답 (pagination 필드명 확인: totalItems) ---
    return new Response(
      JSON.stringify({
        success: true,
        data: data || [],
        pagination: {
          totalItems: totalItems,
          totalPages,
          currentPage: page,
          limit,
        },
      }),
      {
        status: 200,
        headers: responseHeaders,
      }
    );
  } catch (error) {
    console.error("Unhandled error in products-get-all (No Auth):", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "상품 목록 조회 중 오류 발생",
        error: error.message,
      }),
      {
        status: 500,
        headers: responseHeaders,
      }
    );
  }
});

/*
// 사용 예시 (프론트엔드 - JWT 불필요, apikey는 필요)
// fetch('/functions/v1/products-get-all?userId=TARGET_USER_ID&page=1&status=판매중', { headers: { apikey } })
// 또는 supabase.functions.invoke('products-get-all?userId=...', ...)
*/
