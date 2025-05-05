// supabase/functions/products-patch/index.ts - NO JWT AUTH
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// === CORS 헤더 가져오기 ===
import {
  corsHeadersPutPatch,
  createJsonResponseHeaders,
} from "../_shared/cors.ts"; // 경로 확인!

// === 기존 CORS 헤더 정의 삭제 ===
// const corsHeaders = { ... };

// === 응답 헤더 생성 (JSON 용) ===
const responseHeaders = createJsonResponseHeaders(corsHeadersPutPatch); // PATCH 요청용 헤더 사용

// 허용된 업데이트 필드 매핑
const fieldMapping = {
  title: "title",
  base_price: "base_price",
  status: "status",
  barcode: "barcode",
  memo: "memo",
  pickup_info: "pickup_info",
  pickup_date: "pickup_date",
  quantity: "quantity", // 실제 DB 컬럼명 확인
  category: "category", // 필요 시 추가
  options: "options", // 필요 시 추가
  // 필요한 다른 필드 추가
};

Deno.serve(async (req: Request) => {
  // OPTIONS, PATCH 외 거부
  if (req.method === "OPTIONS")
    return new Response(null, { headers: responseHeaders, status: 204 });
  if (req.method !== "PATCH") return new Response(/* ... 405 ... */);

  let supabase: SupabaseClient;
  try {
    // Supabase 클라이언트 초기화
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
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
    const userId = url.searchParams.get("userId"); // userId 추가
    if (!productId || !userId) {
      // userId 검증 추가
      return new Response(
        JSON.stringify({
          success: false,
          message: "상품 ID와 사용자 ID가 필요합니다.",
        }),
        { status: 400, headers: responseHeaders }
      );
    }

    // 요청 본문 파싱
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return new Response(/* ... 400 JSON 오류 ... */);
    }

    console.log(`Attempting to patch product ${productId} (No Auth)`);

    // --- 권한 확인 제거! ---

    // 업데이트할 데이터 객체 생성
    const fieldsToUpdate: Record<string, any> = {};
    for (const frontendField in body) {
      if (Object.prototype.hasOwnProperty.call(fieldMapping, frontendField)) {
        const backendField = fieldMapping[frontendField];
        let value = body[frontendField];

        // 날짜 처리 (pickup_date 예시)
        if (frontendField === "pickup_date") {
          if (value === null || value === "") value = null;
          else if (typeof value === "string") {
            try {
              value = new Date(value).toISOString();
            } catch {
              value = null;
              console.warn(
                `Invalid date for ${frontendField}: ${body[frontendField]}`
              );
            }
          } else {
            value = null; /* 다른 타입이면 null 처리 */
          }
        }
        // 숫자 처리 (base_price, quantity 예시)
        else if (
          frontendField === "base_price" ||
          frontendField === "quantity"
        ) {
          const numValue = Number(value);
          value = isNaN(numValue) ? null : numValue; // 숫자로 변환 안되면 null
        }
        // 다른 타입 변환 필요 시 추가

        fieldsToUpdate[backendField] = value;
        console.log(
          `  Updating field ${backendField} to: ${JSON.stringify(value)}`
        );
      }
    }

    // 업데이트할 내용 확인
    if (Object.keys(fieldsToUpdate).length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "업데이트할 유효한 정보가 없습니다.",
        }),
        {
          status: 400,
          headers: responseHeaders,
        }
      );
    }
    fieldsToUpdate.updated_at = new Date().toISOString();

    // DB 업데이트 실행
    const { data: updatedProduct, error: updateError } = await supabase
      .from("products")
      .update(fieldsToUpdate)
      .eq("product_id", productId)
      .eq("user_id", userId) // 사용자 확인 추가!
      .select()
      .single();

    if (updateError) {
      console.error(
        `Supabase patch error for product ${productId}:`,
        updateError
      );
      if (
        updateError.code === "PGRST116" ||
        updateError.details?.includes("0 rows")
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "업데이트할 상품을 찾을 수 없습니다.",
          }),
          {
            status: 404,
            headers: responseHeaders,
          }
        );
      }
      throw updateError;
    }

    // 성공 응답
    console.log("Product patched successfully:", updatedProduct?.product_id);
    return new Response(
      JSON.stringify({
        success: true,
        message: "상품 정보가 업데이트되었습니다.",
        data: updatedProduct,
      }),
      {
        status: 200,
        headers: responseHeaders,
      }
    );
  } catch (error) {
    console.error("Unhandled error in products-patch (No Auth):", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "상품 정보 부분 업데이트 중 오류 발생",
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
// fetch('/functions/v1/products-patch?productId=PRODUCT_UUID', {
//   method: 'PATCH',
//   headers: { apikey, 'Content-Type': 'application/json' },
//   body: JSON.stringify({ barcode: '1234567890', memo: '특이사항 메모' })
// })
*/
