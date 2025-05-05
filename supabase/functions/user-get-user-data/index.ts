// supabase/functions/get-user-data/index.ts
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// CORS 헤더 설정 (필요에 따라 출처 '*'를 특정 도메인으로 변경)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS", // GET 요청만 허용
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // OPTIONS 요청 처리 (preflight)
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  let supabase: SupabaseClient;
  try {
    // Supabase 클라이언트 초기화 (환경 변수 필요)
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Missing Supabase URL or Anon Key");
    }
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      // 중요: RLS를 사용하고 특정 사용자 데이터만 접근하게 하려면,
      // 클라이언트에서 보낸 Authorization 헤더를 전달해야 합니다.
      global: {
        headers: { Authorization: req.headers.get("Authorization")! },
      },
    });
    console.log("Supabase client initialized for get-user-data.");
  } catch (error) {
    console.error("Supabase init error:", error.message);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Internal Server Error: DB client config failed.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    // URL에서 userId 쿼리 파라미터 추출
    const url = new URL(req.url);
    const userId = url.searchParams.get("userId"); // 쿼리 파라미터 사용 (?userId=...)

    if (!userId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "쿼리 파라미터 'userId'가 필요합니다.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    console.log(`Fetching data for user ID: ${userId}`);

    // Supabase에서 사용자 정보 조회 (필요한 필드만 선택)
    const { data, error } = await supabase
      .from("users") // 실제 테이블 이름 확인!
      .select(
        `
        user_id,
        login_id,
        naver_id,
        store_name,
        store_address,
        owner_name,
        phone_number,
        band_url,
        band_number,
        is_active,
        created_at,
        last_login_at,
        last_crawl_at,
        product_count,
        crawl_interval,
        naver_login_status,
        excluded_customers,
        job_id,
        auto_barcode_generation
      `
      ) // 필요한 필드 명시
      .eq("user_id", userId) // 실제 사용자 ID 컬럼 확인!
      .single(); // 단일 결과 예상

    // Supabase 오류 처리
    if (error) {
      console.error(`Supabase query error for user ${userId}:`, error.message);
      if (error.code === "PGRST116") {
        // PostgREST 코드: 결과 없음
        return new Response(
          JSON.stringify({
            success: false,
            error: "해당 ID의 유저를 찾을 수 없습니다.",
          }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      // 다른 DB 오류
      return new Response(
        JSON.stringify({ success: false, error: "데이터베이스 조회 오류" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 데이터가 없는 경우 (single() 사용 시 data가 null)
    if (!data) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "해당 ID의 유저를 찾을 수 없습니다.",
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 성공 응답 (민감 정보는 select에서 제외했으므로 별도 제거 필요 없음)
    console.log(`Successfully fetched data for user ID: ${userId}`);
    return new Response(JSON.stringify({ success: true, data: data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    // 예외 처리
    console.error("Unhandled error in get-user-data:", error);
    return new Response(
      JSON.stringify({ success: false, error: "서버 내부 오류" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/*
// 사용 예시 (Supabase CLI 로컬 실행 후)
// curl -i -X GET 'http://localhost:54321/functions/v1/get-user-data?userId=사용자UUID' \
//   -H "Authorization: Bearer SUPABASE_ANON_KEY_또는_사용자JWT" \
//   -H "Content-Type: application/json"
*/
