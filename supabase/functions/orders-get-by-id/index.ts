// supabase/functions/orders/get-by-id/index.ts
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

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
    // Supabase 클라이언트 초기화 (Service Role Key 사용)
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey)
      throw new Error("Missing Supabase URL or Service Role Key");
    supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    console.log("Supabase client initialized.");
  } catch (error) {
    const status =
      error.message.includes("Authorization") || error.message.includes("token")
        ? 401
        : 500;
    console.error("Auth or Supabase init error:", error.message);
    return new Response(
      JSON.stringify({ success: false, message: error.message }),
      {
        status: status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    // URL에서 orderId 추출 (쿼리 파라미터 사용)
    const url = new URL(req.url);
    const orderId = url.searchParams.get("orderId"); // 예: /functions/v1/orders/get-by-id?orderId=xxx

    if (!orderId) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "쿼리 파라미터 'orderId'가 필요합니다.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    console.log(`Fetching order details for orderId: ${orderId}`);

    // DB에서 주문 조회 (사용자 ID 일치 확인 포함)
    const { data, error } = await supabase
      .from("orders") // 또는 상세 정보 포함 뷰
      .select("*") // 필요한 컬럼 명시 권장
      .eq("order_id", orderId)
      .eq("user_id", userId) // ★★★ 본인 주문 확인 ★★★
      .single();

    // 오류 처리
    if (error) {
      console.error(`Supabase query error for order ${orderId}:`, error);
      if (error.code === "PGRST116") {
        // Not Found
        return new Response(
          JSON.stringify({
            success: false,
            message: "주문을 찾을 수 없거나 접근 권한이 없습니다.",
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
      // single() 사용 시 data가 null일 수 있음
      return new Response(
        JSON.stringify({
          success: false,
          message: "주문을 찾을 수 없거나 접근 권한이 없습니다.",
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 성공 응답
    console.log(`Successfully fetched order ${orderId}`);
    return new Response(JSON.stringify({ success: true, data: data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Unhandled error in orders/get-by-id:", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "주문 정보 조회 중 오류 발생",
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
// 사용 예시 (프론트엔드)
// supabase.functions.invoke('orders/get-by-id?orderId=ORDER_UUID', { method: 'GET', headers: { Authorization: `Bearer ${token}` } })
*/
