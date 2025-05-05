// supabase/functions/posts/update-status/index.ts - NO JWT AUTH
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
// import { verifyToken } from '../../_shared/jwt.ts'; // 제거

// CORS 헤더 설정
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PUT, PATCH, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // OPTIONS, PUT, PATCH 외 거부
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders, status: 204 });
  if (req.method !== "PUT" && req.method !== "PATCH")
    return new Response(
      JSON.stringify({
        success: false,
        message: "허용되지 않는 메소드 (PUT 또는 PATCH)",
      }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  let supabase: SupabaseClient;

  try {
    // Supabase 클라이언트 초기화
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); // 업데이트 권한
    if (!supabaseUrl || !serviceKey)
      throw new Error("Missing Supabase URL or Service Role Key");
    supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    console.log("Supabase client initialized.");
  } catch (error) {
    console.error("Supabase init error:", error.message);
    return new Response(
      JSON.stringify({ success: false, message: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    // URL에서 postId 추출
    const url = new URL(req.url);
    const postId = url.searchParams.get("postId"); // 예: /functions/v1/posts/update-status?postId=xxx

    if (!postId) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "쿼리 파라미터 'postId'가 필요합니다.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 요청 본문 파싱
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return new Response(
        JSON.stringify({ success: false, message: "잘못된 JSON 형식입니다." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    const { status } = body;

    // status 필수 확인
    if (!status) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "'status' 정보가 필요합니다.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    // 필요하다면 허용된 status 값 목록 검증 추가

    console.log(
      `Attempting to update status for post ${postId} to ${status} (No Auth)`
    );

    // --- 권한 확인 제거! (보안 위험) ---
    // 원래는 이 게시글을 수정할 권한이 있는지 확인 필요 (예: 해당 밴드 관리자 또는 게시글 작성자)
    // --- 현재는 바로 업데이트 실행 ---

    // 업데이트 데이터 준비
    const updateData = {
      status,
      updated_at: new Date().toISOString(),
    };

    // DB 업데이트 실행
    const { data: updatedPost, error: updateError } = await supabase
      .from("posts") // 실제 테이블 이름 확인
      .update(updateData)
      .eq("post_id", postId) // 실제 ID 컬럼 확인
      .select()
      .single();

    if (updateError) {
      console.error(`Supabase update error for post ${postId}:`, updateError);
      if (
        updateError.code === "PGRST116" ||
        updateError.details?.includes("0 rows")
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "업데이트할 게시글을 찾을 수 없습니다.",
          }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      throw updateError;
    }

    // 성공 응답
    console.log(`Post ${postId} status updated successfully.`);
    return new Response(
      JSON.stringify({
        success: true,
        message: "게시글 상태가 업데이트되었습니다.",
        data: updatedPost,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Unhandled error in posts/update-status (No Auth):", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "게시글 상태 업데이트 중 오류 발생",
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
// 사용 예시 (프론트엔드 - JWT 불필요, apikey는 필요)
// fetch('/functions/v1/posts/update-status?postId=POST_UUID', {
//   method: 'PATCH', // 또는 PUT
//   headers: { apikey, 'Content-Type': 'application/json' },
//   body: JSON.stringify({ status: '삭제됨' })
// })
*/
