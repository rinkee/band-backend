// supabase/functions/orders/update-status/index.ts
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// CORS 헤더 설정
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PUT, PATCH, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// 허용되는 주문 상태 목록 (필요에 따라 수정)
const allowedStatuses = [
  "주문완료",
  "주문취소",
  "수령완료",
  "결제완료",
  "확인필요",
  "미수령",
];

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
    // URL에서 orderId 추출
    const url = new URL(req.url);
    const orderId = url.searchParams.get("orderId"); // 예: /functions/v1/orders/update-status?orderId=xxx

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
    const { status, subStatus, shippingInfo, cancelReason } = body;

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
    // 허용된 status 값 확인
    if (!allowedStatuses.includes(status)) {
      return new Response(
        JSON.stringify({
          success: false,
          message: `허용되지 않은 주문 상태입니다: ${status}`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(
      `Attempting to update status for order ${orderId} to ${status}`
    );

    // 업데이트 데이터 준비
    const updateData: Record<string, any> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (subStatus !== undefined) updateData.sub_status = subStatus;
    if (shippingInfo) updateData.shipping_info = shippingInfo;

    // 상태별 추가 처리
    const now = updateData.updated_at;
    if (status === "수령완료") {
      updateData.completed_at = now;
      updateData.canceled_at = null;
    } else if (status === "주문취소") {
      updateData.canceled_at = now;
      updateData.completed_at = null;
      updateData.paid_at = null;
    } else if (status === "결제완료") {
      updateData.paid_at = now;
      updateData.completed_at = null;
      updateData.canceled_at = null;
    } else if (status === "주문완료") {
      updateData.completed_at = null;
      updateData.canceled_at = null;
      updateData.paid_at = null;
      updateData.sub_status = null;
    }

    // DB 업데이트 실행
    const { data: updatedOrder, error: updateError } = await supabase
      .from("orders")
      .update(updateData)
      .eq("order_id", orderId)
      .select()
      .single();

    if (updateError) {
      console.error(`Supabase update error for order ${orderId}:`, updateError);
      throw updateError;
    }

    // 성공 응답
    console.log(`Order ${orderId} status updated successfully.`);
    return new Response(
      JSON.stringify({
        success: true,
        message: "주문 상태가 업데이트되었습니다.",
        data: updatedOrder,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Unhandled error in orders/update-status:", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "주문 상태 업데이트 중 오류 발생",
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
// supabase.functions.invoke('orders/update-status?orderId=ORDER_UUID', {
//   method: 'PUT', // 또는 'PATCH'
//   headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
//   body: JSON.stringify({ status: '수령완료', shippingInfo: 'CJ 대한통운 12345' })
// })
*/
