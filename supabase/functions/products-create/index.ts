// supabase/functions/products-create/index.ts - NO JWT AUTH
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// === CORS 헤더 가져오기 ===
import { corsHeadersGet, createJsonResponseHeaders } from "../_shared/cors.ts"; // 경로 확인!

// === 응답 헤더 생성 (JSON 용) ===
const responseHeaders = createJsonResponseHeaders(corsHeadersGet); // GET 요청용 헤더 사용

Deno.serve(async (req: Request) => {
  // OPTIONS, POST 외 거부
  if (req.method === "OPTIONS")
    return new Response(null, { headers: responseHeaders, status: 204 });
  if (req.method !== "POST") return new Response(/* ... 405 ... */);

  let supabase: SupabaseClient;
  try {
    // Supabase 클라이언트 초기화
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); // 등록 권한
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
    // 요청 본문 파싱
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return new Response(/* ... 400 JSON 오류 ... */);
    }
    const {
      userId, // <<<--- 요청 본문에서 userId 받아야 함 (보안 위험!)
      name, // 실제 DB 컬럼명 확인 (title?)
      description,
      price, // 실제 DB 컬럼명 확인 (base_price?)
      category,
      imageUrl, // 실제 DB 컬럼명 확인 (image_url?)
      stock, // 실제 DB 컬럼명 확인 (quantity?)
      options, // JSONB 타입 가정
      // 기타 필요한 필드 (예: band_number, post_number 등)
    } = body;

    // 필수 필드 확인 (userId, name, price)
    if (!userId || !name || price === undefined || price === null) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "필수 정보(userId, name, price)가 누락되었습니다.",
        }),
        {
          status: 400,
          headers: responseHeaders,
        }
      );
    }
    console.log(`Attempting to create product for user ${userId} (No Auth)`);

    // --- 권한 확인 제거! ---

    // DB 삽입 데이터 준비
    const productData = {
      user_id: userId,
      title: name, // DB 컬럼명 'title' 사용 가정
      description: description || null,
      base_price: Number(price) || 0, // DB 컬럼명 'base_price', 숫자 변환
      category: category || null,
      image_url: imageUrl || null,
      quantity: Number(stock) || 0, // DB 컬럼명 'quantity', 숫자 변환
      options: options || null, // JSONB
      // created_at, updated_at 은 DB에서 자동 설정되도록 하는 것이 좋음
      // status 등 다른 기본값 설정 필요 시 추가
      status: body.status || "판매중", // 예시: 기본 상태 '판매중'
    };
    console.log("Product data to insert:", productData);

    // DB 삽입 실행
    const { data: newProduct, error: insertError } = await supabase
      .from("products") // 실제 테이블 이름 확인
      .insert([productData])
      .select() // 삽입된 데이터 반환
      .single(); // 하나만 삽입했으므로 single()

    if (insertError) {
      console.error("Supabase insert error:", insertError);
      throw insertError;
    }

    // 성공 응답
    console.log("Product created successfully:", newProduct?.product_id);
    return new Response(
      JSON.stringify({
        success: true,
        message: "상품이 등록되었습니다.",
        data: newProduct,
      }),
      {
        status: 201,
        headers: responseHeaders,
      }
    );
  } catch (error) {
    console.error("Unhandled error in products-create (No Auth):", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "상품 등록 중 오류 발생",
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
// fetch('/functions/v1/products-create', {
//   method: 'POST',
//   headers: { apikey, 'Content-Type': 'application/json' },
//   body: JSON.stringify({ userId: 'USER_ID', name: '새 상품', price: 10000, ... })
// })
*/
