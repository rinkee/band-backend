// supabase/functions/register/index.ts
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

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
    // Supabase 클라이언트 초기화 (Anon Key 사용 - 회원가입은 누구나 가능해야 함)
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Missing Supabase URL or Anon Key");
    }
    supabase = createClient(supabaseUrl, supabaseAnonKey); // 여기서는 Anon Key 사용
    console.log("Supabase client initialized for register.");
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
    // 요청 본문 파싱
    const body = await req.json();
    const {
      loginId,
      loginPassword, // <<< 중요: 이 비밀번호는 해싱되어야 합니다!
      naverId,
      naverPassword, // <<< 중요: 민감 정보 처리 주의!
      bandUrl,
      storeName,
      storeAddress,
      ownerName,
      phoneNumber,
    } = body;

    // 필수 데이터 검증
    if (!loginId || !loginPassword || !bandUrl || !storeName) {
      return new Response(
        JSON.stringify({
          success: false,
          message:
            "필수 정보(loginId, loginPassword, bandUrl, storeName)가 누락되었습니다.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 밴드 URL 유효성 검증
    if (!bandUrl.includes("band.us") && !bandUrl.includes("band.com")) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "유효한 밴드 URL이 아닙니다.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 밴드 번호 추출
    const bandNumberMatch = bandUrl.match(
      /band\/(?:us\/band\/|com\/band\/)(\d+)/
    );
    const bandNumber = bandNumberMatch ? bandNumberMatch[1] : null;

    if (!bandNumber) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "밴드 URL에서 ID를 추출할 수 없습니다.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // --- 보안 강화 제안 ---
    // 실제 구현 시에는 여기서 비밀번호 해싱 로직을 추가해야 합니다.
    // 예: const hashedPassword = await bcrypt.hash(loginPassword, 10);
    // 그리고 DB에는 hashedPassword를 저장해야 합니다.
    // 네이버 비밀번호 같은 민감 정보는 암호화하여 저장하는 것을 고려해야 합니다.
    console.warn(
      "[Register Function] Security Warning: Storing plaintext passwords is highly insecure!"
    );
    const passwordToStore = loginPassword; // 임시: 평문 저장 (매우 비권장)
    const naverPasswordToStore = naverPassword; // 임시: 평문 저장 (매우 비권장)
    // --------------------

    // 기존 사용자 확인 (login_id 기준)
    const { data: existingUser, error: checkError } = await supabase
      .from("users")
      .select("user_id")
      .eq("login_id", loginId)
      .maybeSingle(); // single() 대신 maybeSingle() 사용 (없을 수 있음)

    if (checkError && checkError.code !== "PGRST116") {
      // PGRST116 (결과 없음) 외의 오류
      console.error("DB check error:", checkError.message);
      throw new Error("기존 사용자 확인 중 오류 발생");
    }
    if (existingUser) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "이미 사용 중인 아이디입니다.",
        }),
        {
          status: 409, // Conflict
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 새 사용자 ID 생성
    const userId = crypto.randomUUID();

    // 사용자 정보 저장
    const { data: newUser, error: insertError } = await supabase
      .from("users") // 실제 테이블 이름 확인!
      .insert([
        {
          user_id: userId, // UUID
          login_id: loginId,
          login_password: passwordToStore, // <<< 해싱된 비밀번호 사용 권장
          naver_id: naverId || null,
          naver_password: naverPasswordToStore || null, // <<< 암호화된 값 사용 권장
          is_active: true, // 기본 활성
          store_name: storeName,
          store_address: storeAddress || null,
          owner_name: ownerName || loginId, // 기본값
          phone_number: phoneNumber || null,
          band_url: bandUrl,
          band_number: bandNumber,
          settings: {
            // 기본 설정값 (JSONB 타입 컬럼이어야 함)
            notificationEnabled: true,
            autoConfirmOrders: false,
            theme: "light",
          },
          subscription: {
            // 기본 구독 정보 (JSONB 타입 컬럼이어야 함)
            plan: "free",
            status: "active",
            expireDate: null,
            paymentMethod: null,
          },
          // created_at 등은 DB에서 자동으로 설정되도록 설정 권장
        },
      ])
      .select("user_id, login_id, store_name, band_number") // 필요한 정보만 반환
      .single();

    // 삽입 오류 처리
    if (insertError) {
      console.error("User insert error:", insertError.message);
      return new Response(
        JSON.stringify({
          success: false,
          message: "사용자 정보 저장 실패",
          error: insertError.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 성공 응답
    console.log(`User registered: ${loginId}, User ID: ${newUser.user_id}`);
    return new Response(
      JSON.stringify({
        success: true,
        message: "회원가입이 완료되었습니다.",
        data: newUser,
      }),
      {
        status: 201, // Created
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    // 예외 처리
    console.error("Unhandled error in register:", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "회원가입 처리 중 오류 발생",
        error: error.message,
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
// curl -i -X POST 'http://localhost:54321/functions/v1/register' \
//   -H "Authorization: Bearer SUPABASE_ANON_KEY" \
//   -H "Content-Type: application/json" \
//   -d '{
//     "loginId": "newuser",
//     "loginPassword": "password123",
//     "bandUrl": "https://band.us/band/12345678",
//     "storeName": "가게이름",
//     "naverId": "optional_naver_id",
//     "naverPassword": "optional_naver_password"
//   }'
*/
