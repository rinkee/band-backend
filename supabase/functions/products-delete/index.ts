// supabase/functions/products-delete/index.ts - NO JWT AUTH
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// === CORS 헤더 가져오기 ===
import { corsHeadersGet, createJsonResponseHeaders } from "../_shared/cors.ts"; // 경로 확인!

// === 응답 헤더 생성 (JSON 용) ===
const responseHeaders = createJsonResponseHeaders(corsHeadersGet); // GET 요청용 헤더 사용

Deno.serve(async (req: Request) => {
  // OPTIONS, DELETE 외 거부
  if (req.method === "OPTIONS")
    return new Response(null, { headers: responseHeaders, status: 204 });
  if (req.method !== "DELETE") return new Response(/* ... 405 ... */);

  let supabase: SupabaseClient;
  try {
    // Supabase 클라이언트 초기화
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); // 삭제 권한
    if (!supabaseUrl || !serviceKey)
      throw new Error("Missing Supabase URL or Key");
    supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    console.log("Supabase client initialized.");
  } catch (error) {
    /* ... 오류 처리 ... */
  }

  try {
    // URL에서 productId 추출
    const url = new URL(req.url);
    const productId = url.searchParams.get("productId");
const userId = url.searchParams.get("userId"); // 추가
if (!productId || !userId) {
  // userId 검증 추가
  return new Response(/* ... 400 ... */);
}

    // === 요청 본문에서 userId 받기 (권한 확인 제거!) ===
    // 원래는 여기서 권한 확인해야 함
    // const body = await req.json();
    // const userId = body.userId; // 또는 다른 방식의 권한 확인
    // ------------------------------------------
    console.log(`Attempting to delete product ${productId} (No Auth)`);

    // --- 권한 확인 제거! ---

    // DB 삭제 실행
    const { error: deleteError } = await supabase
      .from("products")
      .delete()
      .eq("product_id", productId);
      .eq("user_id", userId) // 사용자 확인 제거!

    if (deleteError) {
      console.error(
        `Supabase delete error for product ${productId}:`,
        deleteError
      );
      // Foreign Key 제약 조건 오류 등 처리 추가 가능
      throw deleteError;
    }

    // 삭제 성공 여부 확인 (선택적: 삭제 전에 select로 확인)
    // 여기서는 오류 없으면 성공으로 간주

    // 성공 응답
    console.log(`Product ${productId} deleted successfully.`);
    return new Response(
      JSON.stringify({ success: true, message: "상품이 삭제되었습니다." }),
      {
        status: 200,
        headers: responseHeaders,
      }
    );
    // 또는 return new Response(null, { status: 204, headers: corsHeaders });
  } catch (error) {
    console.error("Unhandled error in products-delete (No Auth):", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "상품 삭제 중 오류 발생",
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
// fetch('/functions/v1/products-delete?productId=PRODUCT_UUID', {
//   method: 'DELETE',
//   headers: { apikey }
//   // body: JSON.stringify({ userId: 'USER_ID_TO_VERIFY' }) // 권한 확인 필요 시 userId 전달
// })
*/
