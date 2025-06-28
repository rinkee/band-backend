// supabase/functions/login/index.ts
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { generateToken } from "../_shared/jwt.ts"; // 공유 유틸리티 import

// CORS 헤더 설정
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS", // POST 요청만 허용
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // OPTIONS 요청 처리
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  // POST 요청 외 거부
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, message: "허용되지 않는 메소드" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  let supabase: SupabaseClient;
  try {
    // Supabase 클라이언트 초기화 (Anon Key 사용 - 로그인은 누구나 시도 가능)
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Missing Supabase URL or Anon Key");
    }
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    console.log("Supabase client initialized for login.");
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Supabase init error:", errorMessage);
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
    // === 요청 헤더 및 원본 본문 로깅 추가 ===
    console.log("Request received. Method:", req.method);
    console.log(
      "Request Headers:",
      JSON.stringify(Object.fromEntries(req.headers.entries()))
    ); // 헤더 로깅

    let rawBody = "";
    try {
      rawBody = await req.text(); // 원본 텍스트 읽기 시도
      console.log(`Received raw body (length: ${rawBody.length}):`, rawBody);
    } catch (bodyReadError) {
      console.error("Error reading request body:", bodyReadError);
      return new Response(
        JSON.stringify({
          success: false,
          message: "요청 본문을 읽는 중 오류 발생",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    // ======================================

    // 요청 본문 파싱
    // === 안전한 JSON 파싱 ===
    let body;
    if (!rawBody) {
      // 본문이 비어있는 경우
      console.warn("Request body is empty.");
      // 비어있는 본문이 오류인지, 아니면 허용되는지 정책에 따라 처리
      // 여기서는 오류로 간주하고 400 반환
      return new Response(
        JSON.stringify({
          success: false,
          message: "요청 본문이 비어 있습니다.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    try {
      body = JSON.parse(rawBody);
    } catch (parseError) {
      console.error("JSON parsing error:", parseError);
      console.error("Raw body that caused parsing error:", rawBody); // 파싱 실패한 원본 로깅
      return new Response(
        JSON.stringify({ success: false, message: "잘못된 JSON 형식입니다." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    // =======================

    const { loginId, loginPassword } = body;

    if (!loginId || !loginPassword) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "loginId와 loginPassword는 필수입니다.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    console.log(`Login attempt for: ${loginId}`);

    // 사용자 정보 조회 (비밀번호 포함)
    const { data: userData, error: userError } = await supabase
      .from("users") // 실제 테이블 이름 확인!
      .select("*") // 모든 정보 가져오기 (비밀번호 비교 위해)
      .eq("login_id", loginId)
      .maybeSingle(); // 사용자가 없을 수 있음

    // 사용자 없음 또는 DB 오류
    if (userError && userError.code !== "PGRST116") {
      console.error("DB user fetch error:", userError.message);
      throw new Error("사용자 정보 조회 중 오류 발생");
    }
    if (!userData) {
      console.warn(`Login failed: User not found - loginId: ${loginId}`);
      return new Response(
        JSON.stringify({
          success: false,
          message: "아이디 또는 비밀번호가 올바르지 않습니다.",
        }),
        {
          status: 401, // Unauthorized
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // --- 비밀번호 검증 (매우 중요: 보안 취약점!) ---
    console.warn(
      "[Login Function] Security Warning: Comparing plaintext passwords! Implement hashing."
    );
    const isPasswordMatch = userData.login_password === loginPassword; // <<< 평문 비교 (비권장)
    // 실제 구현: const isPasswordMatch = await bcrypt.compare(loginPassword, userData.hashed_password);
    // ---------------------------------------------

    if (!isPasswordMatch) {
      console.warn(`Login failed: Password mismatch - loginId: ${loginId}`);
      return new Response(
        JSON.stringify({
          success: false,
          message: "아이디 또는 비밀번호가 올바르지 않습니다.",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 로그인 성공, JWT 토큰 생성
    const tokenPayload = {
      userId: userData.user_id, // DB의 실제 ID 컬럼명 사용!
      loginId: userData.login_id,
      role: userData.role || "user", // 역할 정보가 있다면 포함 (없으면 기본값)
      // 필요한 다른 정보 추가 가능 (민감 정보 제외)
      aud: "authenticated", // Supabase 표준 audience
      sub: userData.user_id, // Supabase 표준 subject (user id)
    };

    console.log("Generating JWT with payload:", tokenPayload);
    const token = await generateToken(tokenPayload); // _shared/jwt.ts 사용

    console.log(`Login successful: ${loginId}, User ID: ${userData.user_id}`);

    // 마지막 로그인 시간 업데이트 (백그라운드에서 비동기 처리도 가능)
    await supabase
      .from("users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("user_id", userData.user_id);

    // 응답 데이터 구성 (민감 정보 제외!)
    const userResponseData = {
      userId: userData.user_id,
      loginId: userData.login_id,
      storeName: userData.store_name,
      storeAddress: userData.store_address,
      ownerName: userData.owner_name,
      phoneNumber: userData.phone_number,
      bandUrl: userData.band_url,
      bandNumber: userData.band_number,
      naverId: userData.naver_id, // 네이버 ID는 필요에 따라 포함
      band_access_token: userData.band_access_token, // BAND 액세스 토큰 추가
      band_key: userData.band_key, // BAND 키 추가
      isActive: userData.is_active,
      excludedCustomers: userData.excluded_customers,
      subscription: userData.subscription, // 구독 정보
      createdAt: userData.created_at,
      updatedAt: userData.updated_at, // DB 컬럼명 확인
      role: userData.role || "user", // 역할
      // 필요에 따라 다른 안전한 정보 추가
    };

    // 성공 응답 (토큰과 사용자 정보 포함)
    // httpOnly 쿠키로 토큰 설정 추가
    const responseHeaders = {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Set-Cookie": `authToken=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`,
    };

    return new Response(
      JSON.stringify({
        success: true,
        message: "로그인 성공",
        token: token,
        user: userResponseData,
      }),
      {
        status: 200,
        headers: responseHeaders,
      }
    );
  } catch (error: unknown) {
    // 예외 처리
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Unhandled error in login:", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "로그인 처리 중 오류 발생",
        error: errorMessage,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/*
// 사용 예시 (Supabase CLI 로컬 실행 후)
// JWT_SECRET 환경 변수 설정 필요! (.env 파일 등)
// curl -i -X POST 'http://localhost:54321/functions/v1/login' \
//   -H "Authorization: Bearer SUPABASE_ANON_KEY" \
//   -H "Content-Type: application/json" \
//   -d '{
//     "loginId": "testuser",
//     "loginPassword": "password123"
//   }'
*/
