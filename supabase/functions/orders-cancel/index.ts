// supabase/functions/orders/cancel/index.ts - NO JWT AUTH
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
// import { verifyToken } from '../../_shared/jwt.ts'; // 제거

// CORS 헤더 설정
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS", // 취소는 보통 POST 사용
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // OPTIONS, POST 외 거부
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders, status: 204 });
  if (req.method !== "POST")
    return new Response(
      JSON.stringify({
        success: false,
        message: "허용되지 않는 메소드 (POST)",
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
    // URL에서 orderId 추출
    const url = new URL(req.url);
    const orderId = url.searchParams.get("orderId"); // 예: /functions/v1/orders/cancel?orderId=xxx

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

    // 요청 본문 파싱 (취소 사유 등)
    let body = {}; // 본문이 없을 수도 있음
    let reason = "사용자 요청"; // 기본 취소 사유
    try {
      // Content-Type 헤더 확인 후 파싱 시도 (선택적이지만 권장)
      if (req.headers.get("content-type")?.includes("application/json")) {
        const textBody = await req.text(); // 빈 본문도 처리하기 위해 text() 먼저 사용
        if (textBody) {
          body = JSON.parse(textBody);
          if (body.reason) {
            reason = body.reason;
          }
        }
      }
    } catch (e) {
      console.warn(
        "Could not parse request body for cancel reason, using default."
      );
      // JSON 파싱 실패해도 기본 사유로 계속 진행 가능
    }

    console.log(
      `Attempting to cancel order ${orderId} with reason: ${reason} (No Auth)`
    );

    // --- 권한 확인 제거! (보안 위험) ---
    // 원래는 여기서 주문 소유권 확인 필요
    // --- 현재는 바로 주문 상태 확인으로 넘어감 ---

    // 주문 상태 확인 (이미 취소되었는지)
    const { data: currentOrder, error: fetchError } = await supabase
      .from("orders")
      .select("status")
      .eq("order_id", orderId)
      .single();

    if (fetchError) {
      console.error(
        `Error fetching order ${orderId} before cancel:`,
        fetchError
      );
      if (fetchError.code === "PGRST116") {
        return new Response(
          JSON.stringify({
            success: false,
            message: "취소할 주문을 찾을 수 없습니다.",
          }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      throw fetchError; // 기타 DB 오류
    }
    if (!currentOrder) {
      // single() 사용 시 data가 null일 수 있음
      return new Response(
        JSON.stringify({
          success: false,
          message: "취소할 주문을 찾을 수 없습니다.",
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 이미 취소된 경우
    if (
      currentOrder.status === "주문취소" ||
      currentOrder.status === "canceled"
    ) {
      // 'canceled'도 확인
      return new Response(
        JSON.stringify({ success: false, message: "이미 취소된 주문입니다." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 주문 취소 업데이트
    const updateData = {
      status: "주문취소", // DB에 저장되는 실제 상태값 확인 필요 ('canceled'?)
      cancel_reason: reason,
      canceled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // 취소 시 초기화할 다른 필드들
      completed_at: null,
      paid_at: null,
    };

    console.log("Updating order to cancel:", updateData);

    const { data: canceledOrder, error: updateError } = await supabase
      .from("orders")
      .update(updateData)
      .eq("order_id", orderId)
      .select() // 취소된 주문 정보 반환
      .single();

    if (updateError) {
      console.error(
        `Supabase cancel update error for order ${orderId}:`,
        updateError
      );
      if (
        updateError.code === "PGRST116" ||
        updateError.details?.includes("0 rows")
      ) {
        // 이 경우는 거의 발생 안 함 (위에서 이미 확인했으므로)
        return new Response(
          JSON.stringify({
            success: false,
            message: "주문 취소 업데이트 실패: 주문을 찾을 수 없습니다.",
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
    console.log(`Order ${orderId} canceled successfully.`);
    return new Response(
      JSON.stringify({
        success: true,
        message: "주문이 취소되었습니다.",
        data: canceledOrder,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Unhandled error in orders/cancel (No Auth):", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "주문 취소 중 오류 발생",
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
// fetch('/functions/v1/orders/cancel?orderId=ORDER_UUID', {
//   method: 'POST',
//   headers: { apikey, 'Content-Type': 'application/json' },
//   body: JSON.stringify({ reason: '고객 변심' }) // reason은 선택 사항
// })
*/
