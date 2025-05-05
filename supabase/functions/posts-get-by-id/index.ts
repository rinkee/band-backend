// supabase/functions/posts/get-by-id/index.ts - NO JWT AUTH
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
// import { verifyToken } from '../../_shared/jwt.ts'; // 제거

// CORS 헤더 설정
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // OPTIONS, GET 외 거부
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders, status: 204 });
  if (req.method !== "GET")
    return new Response(
      JSON.stringify({ success: false, message: "허용되지 않는 메소드 (GET)" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  let supabase: SupabaseClient;

  try {
    // Supabase 클라이언트 초기화
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); // 또는 Anon Key
    if (!supabaseUrl || !serviceKey)
      throw new Error("Missing Supabase URL or Key");
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
    // URL에서 postId 추출 (쿼리 파라미터 사용)
    const url = new URL(req.url);
    const postId = url.searchParams.get("postId"); // 예: /functions/v1/posts/get-by-id?postId=xxx

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
    console.log(`Fetching post details for postId: ${postId} (No Auth)`);

    // DB에서 특정 게시글 조회
    const { data, error } = await supabase
      .from("posts") // 실제 테이블 이름 확인
      .select("*") // 필요한 컬럼 명시 권장
      .eq("post_id", postId) // 실제 게시글 ID 컬럼 확인
      .single();

    // 오류 처리
    if (error) {
      console.error(`Supabase query error for post ${postId}:`, error);
      if (error.code === "PGRST116") {
        // Not Found
        return new Response(
          JSON.stringify({
            success: false,
            message: "해당 ID의 게시글을 찾을 수 없습니다.",
          }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      throw error;
    }
    if (!data) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "해당 ID의 게시글을 찾을 수 없습니다.",
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 성공 응답
    console.log(`Successfully fetched post ${postId}`);
    return new Response(JSON.stringify({ success: true, data: data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Unhandled error in posts/get-by-id (No Auth):", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "게시글 정보 조회 중 오류 발생",
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
// fetch('/functions/v1/posts/get-by-id?postId=POST_UUID', { headers: { apikey } })
*/
