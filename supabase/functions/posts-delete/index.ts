// supabase/functions/posts/delete/index.ts - NO JWT AUTH
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
// import { verifyToken } from '../../_shared/jwt.ts'; // 제거

// CORS 헤더 설정
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "DELETE, OPTIONS", // DELETE 메소드 허용
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // OPTIONS, DELETE 외 거부
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders, status: 204 });
  if (req.method !== "DELETE")
    return new Response(
      JSON.stringify({
        success: false,
        message: "허용되지 않는 메소드 (DELETE)",
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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); // 삭제 권한
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
    const postId = url.searchParams.get("postId"); // 예: /functions/v1/posts/delete?postId=xxx

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
    console.log(`Attempting to delete post ${postId} (No Auth)`);

    // --- 권한 확인 제거! (보안 위험) ---
    // 원래는 이 게시글을 삭제할 권한이 있는지 확인 필요
    // --- 현재는 바로 삭제 실행 ---

    // DB 삭제 실행
    // 참고: delete()는 기본적으로 삭제된 행 수를 반환하지 않음.
    // count 옵션을 주거나, 삭제 전에 select로 확인 필요 시 추가.
    const { error: deleteError } = await supabase
      .from("posts") // 실제 테이블 이름 확인
      .delete()
      .eq("post_id", postId); // 실제 ID 컬럼 확인

    if (deleteError) {
      console.error(`Supabase delete error for post ${postId}:`, deleteError);
      // Foreign key 제약 조건 위반 등의 오류 처리 추가 가능
      throw deleteError;
    }

    // 삭제 성공 여부를 더 확실히 하려면, 삭제 전 select로 존재 여부 확인 또는
    // delete().select().single()을 시도해 볼 수 있으나, delete는 보통 데이터를 반환하지 않음.
    // 여기서는 오류가 없으면 성공으로 간주.

    // 성공 응답 (데이터 반환 없음)
    console.log(`Post ${postId} deleted successfully.`);
    return new Response(
      JSON.stringify({ success: true, message: "게시글이 삭제되었습니다." }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
    // 또는 삭제 성공 시 204 No Content 반환도 가능
    // return new Response(null, { status: 204, headers: corsHeaders });
  } catch (error) {
    console.error("Unhandled error in posts/delete (No Auth):", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "게시글 삭제 중 오류 발생",
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
// fetch('/functions/v1/posts/delete?postId=POST_UUID', {
//   method: 'DELETE',
//   headers: { apikey }
// })
*/
