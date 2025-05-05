// supabase/functions/products-update/index.ts - NO JWT AUTH
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// === CORS 헤더 가져오기 ===
import { corsHeadersGet, corsHeadersPutPatch, createJsonResponseHeaders } from "../_shared/cors.ts"; // 경로 확인!

// === 응답 헤더 생성 (JSON 용) ===
const responseHeaders = createJsonResponseHeaders(corsHeadersPutPatch); // PUT/PATCH 요청용 헤더 사용

Deno.serve(async (req: Request) => {
  // OPTIONS, PUT, PATCH 외 거부
  if (req.method === "OPTIONS")
    return new Response(null, { headers: responseHeaders, status: 204 });
  if (req.method !== "PUT" && req.method !== "PATCH")
    return new Response(
      JSON.stringify({
        success: false,
        message: "허용되지 않는 메소드 (PUT/PATCH만 허용)",
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

    console.log(`[DEBUG] 상품 ID: "${productId}", 사용자 ID: "${userId}"`);

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

    console.log(`Attempting to update product ${productId} for user ${userId}`);

    // 필드 매핑 정의 - 프론트엔드 필드명을 백엔드 DB 컬럼명으로 변환
    const fieldMapping = {
      title: "title",
      name: "title", // 'name'도 'title'로 매핑
      base_price: "base_price",
      price: "base_price", // 'price'도 'base_price'로 매핑
      status: "status",
      barcode: "barcode",
      memo: "memo",
      pickup_info: "pickup_info",
      pickup_date: "pickup_date",
      quantity: "quantity", 
      stock: "quantity", // 'stock'도 'quantity'로 매핑
      category: "category",
      imageUrl: "image_url",
      options: "price_options",
    };

    // 업데이트 데이터 준비 (제공된 값만 업데이트)
    const fieldsToUpdate: Record<string, any> = {};

    Object.keys(updateData).forEach((frontendField) => {
      if (
        updateData[frontendField] !== undefined &&
        fieldMapping[frontendField]
      ) {
        const backendField = fieldMapping[frontendField];
        let value = updateData[frontendField];

        // 특수 필드 처리
        if (frontendField === "pickup_date") {
          if (value === null || value === "") {
            value = null; // 빈 값이면 명시적으로 null로 설정
          } else if (typeof value === "string" && !value.includes("T")) {
            try {
              value = new Date(value).toISOString();
            } catch (dateParseError) {
              console.error(`유효하지 않은 pickup_date 형식: ${value}. null로 설정합니다.`);
              value = null;
            }
          }
        }

        // 숫자 필드 처리
        if (backendField === "base_price" || backendField === "quantity") {
          if (value !== null && value !== undefined) {
            value = Number(value);
            if (isNaN(value)) {
              console.warn(`경고: ${backendField}에 유효하지 않은 숫자 값: ${updateData[frontendField]}`);
              return; // 해당 필드는 건너뜁니다
            }
          }
        }

        fieldsToUpdate[backendField] = value;
        console.log(
          `상품 ID ${productId}의 ${backendField}를 업데이트합니다: ${JSON.stringify(value)}`
        );
      }
    });

    // 업데이트 시간 추가
    fieldsToUpdate.updated_at = new Date().toISOString();

    // 업데이트할 내용 확인
    if (Object.keys(fieldsToUpdate).length === 1 && fieldsToUpdate.updated_at) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "업데이트할 내용이 없습니다.",
        }),
        { status: 400, headers: responseHeaders }
      );
    }

    console.log("Product data to update:", fieldsToUpdate);

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
      
      // PostgreSQL 날짜/시간 포맷 에러 처리
      if (updateError.code === "22007") {
        return new Response(
          JSON.stringify({
            success: false,
            message: "날짜 또는 시간 포맷 오류입니다.",
            error: updateError.message,
          }),
          { status: 400, headers: responseHeaders }
        );
      }
      
      if (
        updateError.code === "PGRST116" ||
        updateError.details?.includes("0 rows")
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "업데이트할 상품을 찾을 수 없습니다.",
          }),
          { status: 404, headers: responseHeaders }
        );
      }
      
      throw updateError;
    }

    // 성공 응답
    console.log("Product updated successfully:", updatedProduct?.product_id);
    return new Response(
      JSON.stringify({
        success: true,
        message: "상품 정보가 업데이트되었습니다.",
        data: updatedProduct,
      }),
      { status: 200, headers: responseHeaders }
    );
  } catch (error) {
    console.error("Unhandled error in products-update:", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "상품 정보 업데이트 중 오류 발생",
        error: error.message,
      }),
      { status: 500, headers: responseHeaders }
    );
  }
});

/*
// 사용 예시 (프론트엔드)
// fetch('/functions/v1/products-update?productId=PRODUCT_UUID&userId=USER_ID', {
//   method: 'PATCH', // 또는 PUT
//   headers: { apikey, 'Content-Type': 'application/json' },
//   body: JSON.stringify({ title: '수정된 이름', base_price: 12000, pickup_date: '2023-05-30' })
// })
*/
