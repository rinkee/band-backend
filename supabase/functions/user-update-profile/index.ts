// supabase/functions/update-profile/index.ts
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { verifyToken } from '../_shared/jwt.ts'; // JWT 검증 함수 import

// CORS 헤더 설정
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PUT, OPTIONS', // PUT 요청만 허용 (또는 PATCH)
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  // OPTIONS 요청 처리
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  // PUT 또는 PATCH 요청 외 거부
  if (req.method !== 'PUT' && req.method !== 'PATCH') {
    return new Response(JSON.stringify({ success: false, message: "허용되지 않는 메소드 (PUT 또는 PATCH 사용)" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let supabase: SupabaseClient;
  let requesterUserId: string | null = null;
  let requesterRole: string | null = null;

  try {
    // --- JWT 인증 ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ success: false, message: "인증 헤더가 없거나 형식이 잘못되었습니다." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.split(" ")[1];
    const verifiedPayload = await verifyToken(token); // _shared/jwt.ts 사용

    if (!verifiedPayload) {
      return new Response(JSON.stringify({ success: false, message: "유효하지 않은 토큰입니다." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // --- JWT 검증 성공 ---
    requesterUserId = verifiedPayload.userId as string; // payload에서 userId 추출
    requesterRole = verifiedPayload.role as string;   // payload에서 role 추출
    console.log(`Authenticated user: ${requesterUserId}, Role: ${requesterRole}`);
    // -----------------

    // Supabase 클라이언트 초기화 (인증된 사용자의 권한으로 실행)
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); // <<< 중요: 업데이트는 Service Role Key 사용 고려 (RLS 우회) 또는 사용자 JWT 전달

    if (!supabaseUrl || !serviceRoleKey) { // 여기서는 Service Role Key 사용 예시
      throw new Error("Missing Supabase URL or Service Role Key");
    }
     // Service Role Key 사용 시 RLS 우회 가능, 함수 내에서 권한 체크 필수!
    supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            // Service Role은 사용자를 가장하지 않음
             autoRefreshToken: false,
             persistSession: false
        }
    });
    // 또는 사용자 JWT를 사용하려면:
    // supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    //    global: { headers: { Authorization: `Bearer ${token}` } }
    // });

    console.log("Supabase client initialized for update-profile.");
  } catch (error) {
    console.error("Initialization or Auth error:", error.message);
    // JWT 검증 실패 시에도 401 반환 고려
    const status = error.message.includes("JWT") ? 401 : 500;
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // URL에서 업데이트 대상 userId 쿼리 파라미터 추출
    const url = new URL(req.url);
    const targetUserId = url.searchParams.get("userId");

    if (!targetUserId) {
      return new Response(JSON.stringify({ success: false, error: "쿼리 파라미터 'userId'가 필요합니다." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- 권한 확인 ---
    // Service Role Key를 사용했으므로 함수 내에서 직접 권한 확인 필수
    if (requesterUserId !== targetUserId && requesterRole !== "admin") {
      console.log(`Authorization failed: Requester ${requesterUserId} (Role: ${requesterRole}) cannot update profile for ${targetUserId}`);
      return new Response(JSON.stringify({ success: false, message: "요청을 수행할 권한이 없습니다." }), {
        status: 403, // Forbidden
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log(`Authorization granted for user ${requesterUserId} to update profile ${targetUserId}`);
    // ---------------

    // 요청 본문 파싱
    const requestBody = await req.json();
    console.log(`Update request body for user ${targetUserId}:`, requestBody);

    // 업데이트할 데이터 객체 생성 및 유효 필드 매핑
    const updateData: Record<string, any> = {};
    const allowedDbFields: Record<string, string> = { // 프론트 key : DB 컬럼명
      ownerName: "owner_name",
      storeName: "store_name",
      storeAddress: "store_address",
      phoneNumber: "phone_number",
      bandUrl: "band_url",
      // band_number는 보통 URL 변경 시 같이 변경되거나 읽기전용일 수 있음 (필요시 추가)
      auto_barcode_generation: "auto_barcode_generation",
      excluded_customers: "excluded_customers",
      post_fetch_limit: "post_fetch_limit",
       // 네이버 ID/PW는 별도 함수(updateNaverCredentials) 사용 권장
       // login_password는 별도 함수(updateLoginPassword) 사용 권장
    };

    let hasUpdateData = false;
    for (const key in requestBody) {
      if (Object.prototype.hasOwnProperty.call(allowedDbFields, key)) {
        const dbColumn = allowedDbFields[key];
        // 간단한 타입 검증 예시 (필요에 따라 강화)
        if (key === "auto_barcode_generation" && typeof requestBody[key] !== "boolean") continue;
        if (key === "excluded_customers" && !Array.isArray(requestBody[key])) continue;
        if (key === "post_fetch_limit" && typeof requestBody[key] !== "number") continue;

        updateData[dbColumn] = requestBody[key];
        hasUpdateData = true;
      }
    }

    if (!hasUpdateData) {
      return new Response(JSON.stringify({ success: false, message: "업데이트할 유효한 데이터가 없습니다." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // updated_at 타임스탬프 추가
    updateData.updated_at = new Date().toISOString();
    console.log(`Data to update for user ${targetUserId}:`, updateData);

    // Supabase 데이터베이스 업데이트 실행
    const { data: updatedResult, error: updateError } = await supabase
      .from("users") // 실제 테이블 이름 확인!
      .update(updateData)
      .eq("user_id", targetUserId) // 실제 ID 컬럼 확인!
      .select() // 업데이트된 전체 데이터 반환
      .single();

    // 업데이트 오류 처리
    if (updateError) {
      console.error(`Supabase update error for user ${targetUserId}:`, updateError.message);
      return new Response(JSON.stringify({ success: false, message: "사용자 정보 업데이트 실패", error: updateError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 업데이트된 사용자 못 찾음 (거의 발생 안 함)
    if (!updatedResult) {
       return new Response(JSON.stringify({ success: false, message: "업데이트된 사용자 정보를 찾을 수 없습니다." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 성공 응답 (민감 정보 제외하고 반환 필요 시 필터링)
     const { login_password, naver_password, ...safeUpdatedResult } = updatedResult; // 민감 정보 제거

    console.log(`Profile updated successfully for user ${targetUserId}`);
    return new Response(JSON.stringify({ success: true, message: "프로필이 업데이트되었습니다.", data: safeUpdatedResult }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    // 예외 처리
    console.error(`Unhandled error in update-profile for user ${req.params?.userId || 'N/A'}:`, error);
    return new Response(JSON.stringify({ success: false, message: "프로필 업데이트 중 오류 발생", error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/*
// 사용 예시 (Supabase CLI 로컬 실행 후)
// JWT_SECRET, SUPABASE_SERVICE_ROLE_KEY 환경 변수 설정 필요!
// curl -i -X PUT 'http://localhost:54321/functions/v1/update-profile?userId=업데이트할_사용자UUID' \
//   -H "Authorization: Bearer 사용자JWT_또는_관리자JWT" \
//   -H "Content-Type: application/json" \
//   -d '{
//     "storeName": "새로운 가게 이름",
//     "phoneNumber": "010-1234-5678",
//     "auto_barcode_generation": true,
//     "excluded_customers": ["고객1", "고객2"]
//   }'
*/