// supabase/functions/users-get-data/index.ts - NO JWT AUTH
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
// === CORS 관련 import 추가 ===
import { corsHeadersGet, createJsonResponseHeaders } from "../_shared/cors.ts"; // 경로 확인!

// === 응답 헤더 생성 ===
const responseHeaders = createJsonResponseHeaders(corsHeadersGet);

Deno.serve(async (req: Request) => {
  // === OPTIONS 요청 처리 추가 ===
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeadersGet, status: 204 });
  }
  // ============================

  // GET 요청 외 거부
  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ success: false, message: "허용되지 않는 메소드 (GET)" }),
      {
        status: 405,
        headers: responseHeaders, // 헤더 적용
      }
    );
  }

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
    // 오류 응답에도 헤더 적용
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
    const userId = url.searchParams.get("userId");

    if (!userId) {
      // 400 오류 응답에도 헤더 적용
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
    console.log(`Fetching data for user ID: ${userId} (No Auth)`);

    // DB에서 사용자 정보 조회 (필요한 필드만 선택 권장)
    const { data, error } = await supabase
      .from("users")
      .select(
        `
        user_id, login_id, naver_id, store_name, store_address, owner_name,
        phone_number, band_url, band_number, is_active, created_at,
        last_login_at, last_crawl_at, product_count, crawl_interval,
        naver_login_status, excluded_customers, job_id, auto_barcode_generation
      `
      ) // 비밀번호 등 민감 정보 제외하고 필요한 것만 명시
      .eq("user_id", userId)
      .single();

    // 오류 처리
    if (error) {
      console.error(`Supabase query error for user ${userId}:`, error);
      const status = error.code === "PGRST116" ? 404 : 500;
      const message =
        error.code === "PGRST116"
          ? "해당 ID의 유저를 찾을 수 없습니다."
          : "데이터베이스 조회 오류";
      // 404 또는 500 오류 응답에도 헤더 적용
      return new Response(
        JSON.stringify({
          success: false,
          message: message,
          error: error.message,
        }),
        {
          status: status,
          headers: responseHeaders,
        }
      );
    }
    if (!data) {
      // 404 오류 응답에도 헤더 적용
      return new Response(
        JSON.stringify({
          success: false,
          message: "해당 ID의 유저를 찾을 수 없습니다.",
        }),
        {
          status: 404,
          headers: responseHeaders,
        }
      );
    }

    // 성공 응답 (200) 에도 헤더 적용
    console.log(`Successfully fetched data for user ID: ${userId}`);
    return new Response(JSON.stringify({ success: true, data: data }), {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    // 최종 오류 처리 (500) 에도 헤더 적용
    console.error("Unhandled error in users-get-data (No Auth):", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "사용자 정보 조회 중 오류 발생",
        error: error.message,
      }),
      {
        status: 500,
        headers: responseHeaders,
      }
    );
  }
});
