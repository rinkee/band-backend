// supabase/functions/products-get-by-id/index.ts - NO JWT AUTH
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// === CORS 헤더 가져오기 ===
import { corsHeadersGet, createJsonResponseHeaders } from "../_shared/cors.ts"; // 경로 확인!

// === 기존 CORS 헤더 정의 삭제 ===
// const corsHeaders = { ... };

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
    // URL에서 productId 추출
    const url = new URL(req.url);
    const productId = url.searchParams.get("productId");

    // ... productId 추출 후 ...
    console.log(`[DEBUG] Querying with productId: "[${productId}]"`); // 대괄호로 감싸서 앞뒤 공백 확인

    if (!productId) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "쿼리 파라미터 'productId'가 필요합니다.",
        }),
        {
          status: 400,
          headers: responseHeaders,
        }
      );
    }
    console.log(
      `Fetching product details for productId: ${productId} (No Auth)`
    );

    // DB에서 특정 상품 조회 (user_id 조건 없이)
    const { data, error } = await supabase
      .from("products") // 실제 테이블 이름 확인
      .select("*")
      .eq("product_id", productId) // 실제 상품 ID 컬럼 확인
      .single();

    // 오류 처리
    if (error) {
      console.error(`Supabase query error for product ${productId}:`, error);
      if (error.code === "PGRST116") {
        return new Response(
          JSON.stringify({
            success: false,
            message: "해당 ID의 상품을 찾을 수 없습니다.",
          }),
          {
            status: 404,
            headers: responseHeaders,
          }
        );
      }
      throw error;
    }
    if (!data) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "해당 ID의 상품을 찾을 수 없습니다.",
        }),
        {
          status: 404,
          headers: responseHeaders,
        }
      );
    }

    // 성공 응답
    console.log(`Successfully fetched product ${productId}`);
    return new Response(JSON.stringify({ success: true, data: data }), {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Unhandled error in products-get-by-id (No Auth):", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "상품 정보 조회 중 오류 발생",
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
// fetch('/functions/v1/products-get-by-id?productId=PRODUCT_UUID', { headers: { apikey } })
*/
