// supabase/functions/products-update-barcode/index.ts - 바코드만 업데이트하는 심플 API
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// === CORS 헤더 가져오기 ===
import {
  corsHeadersPutPatch,
  createJsonResponseHeaders,
} from "../_shared/cors.ts"; // 경로 확인!

// === 응답 헤더 생성 (JSON 용) ===
const responseHeaders = createJsonResponseHeaders(corsHeadersPutPatch); // PUT/PATCH 요청용 헤더 사용

Deno.serve(async (req: Request) => {
  // OPTIONS, PATCH 외 거부
  if (req.method === "OPTIONS")
    return new Response(null, { headers: responseHeaders, status: 204 });
  if (req.method !== "PATCH")
    return new Response(
      JSON.stringify({
        success: false,
        message: "허용되지 않는 메소드 (PATCH만 허용)",
      }),
      { status: 405, headers: responseHeaders }
    );

  let supabase: SupabaseClient;
  try {
    // Supabase 클라이언트 초기화
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); // 업데이트 권한
    if (!supabaseUrl || !serviceKey)
      throw new Error("Missing Supabase URL or Key");
    supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    console.log("Supabase client initialized.");
  } catch (error) {
    console.error("Supabase 클라이언트 초기화 오류:", error.message);
    return new Response(
      JSON.stringify({
        success: false,
        message: "서버 초기화 오류",
        error: error.message,
      }),
      { status: 500, headers: responseHeaders }
    );
  }

  try {
    // URL에서 productId 추출
    const url = new URL(req.url);
    const productId = url.searchParams.get("productId");
    const userId = url.searchParams.get("userId"); // URL에서 userId 추출

    // 필수 파라미터 검증
    if (!productId || !userId) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "상품 ID와 사용자 ID가 필요합니다.",
        }),
        { status: 400, headers: responseHeaders }
      );
    }

    console.log(
      `[DEBUG] 바코드 업데이트 - 상품 ID: "${productId}", 사용자 ID: "${userId}"`
    );

    // 요청 본문 파싱
    let updateData;
    try {
      updateData = await req.json();
    } catch (e) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "유효하지 않은 JSON 형식입니다.",
          error: e.message,
        }),
        { status: 400, headers: responseHeaders }
      );
    }

    // 바코드 필드 검증
    if (!updateData || updateData.barcode === undefined) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "바코드 필드가 필요합니다.",
        }),
        { status: 400, headers: responseHeaders }
      );
    }

    console.log(
      `Attempting to update barcode for product ${productId} to: ${updateData.barcode}`
    );

    // 업데이트 데이터 준비 (바코드만)
    const fieldsToUpdate = {
      barcode: updateData.barcode,
      updated_at: new Date().toISOString(),
    };

    // 권한 확인: 해당 사용자의 상품인지 확인
    const { data: ownerCheck, error: ownerCheckError } = await supabase
      .from("products")
      .select("user_id")
      .eq("product_id", productId)
      .single();

    if (ownerCheckError) {
      console.error(`상품 소유자 확인 오류: ${ownerCheckError.message}`);
      return new Response(
        JSON.stringify({
          success: false,
          message: "상품을 찾을 수 없습니다.",
          error: ownerCheckError.message,
        }),
        { status: 404, headers: responseHeaders }
      );
    }

    if (!ownerCheck || ownerCheck.user_id !== userId) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "해당 상품에 대한 권한이 없습니다.",
        }),
        { status: 403, headers: responseHeaders }
      );
    }

    // DB 업데이트 실행
    const { data: updatedProduct, error: updateError } = await supabase
      .from("products")
      .update(fieldsToUpdate)
      .eq("product_id", productId)
      .eq("user_id", userId) // 사용자 ID도 확인
      .select()
      .single();

    if (updateError) {
      console.error(
        `Supabase update error for product ${productId}:`,
        updateError
      );
      return new Response(
        JSON.stringify({
          success: false,
          message: "상품 바코드 업데이트 실패",
          error: updateError.message,
        }),
        {
          status: updateError.code === "23505" ? 409 : 500, // 중복 키 충돌 시 409
          headers: responseHeaders,
        }
      );
    }

    // 성공 응답
    return new Response(
      JSON.stringify({
        success: true,
        message: "상품 바코드가 성공적으로 업데이트되었습니다.",
        data: updatedProduct,
      }),
      { status: 200, headers: responseHeaders }
    );
  } catch (error) {
    console.error("상품 바코드 업데이트 중 예상치 못한 오류:", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "상품 바코드 업데이트 중 서버 오류",
        error: error.message,
      }),
      { status: 500, headers: responseHeaders }
    );
  }
});

/*
// 사용 예시 (프론트엔드)
// fetch('/functions/v1/products-update-barcode?productId=PRODUCT_UUID&userId=USER_ID', {
//   method: 'PATCH',
//   headers: { 'Content-Type': 'application/json', apikey: 'YOUR_API_KEY' },
//   body: JSON.stringify({ barcode: '8801234567890' })
// })
// .then(res => res.json())
// .then(data => console.log(data))
// .catch(err => console.error(err));
*/
