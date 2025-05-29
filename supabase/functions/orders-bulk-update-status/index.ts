// supabase/functions/orders-bulk-update-status/index.ts
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// CORS 헤더 설정
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS", // 일괄 처리는 POST 사용 권장
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// 허용되는 주문 상태 목록 (기존 함수와 동일하게 유지 또는 필요에 따라 수정)
const allowedStatuses = [
  "주문완료",
  "주문취소",
  "수령완료",
  "결제완료",
  "확인필요",
  "미수령",
];

Deno.serve(async (req: Request) => {
  // OPTIONS, POST 외 거부
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }
  if (req.method !== "POST") {
    // 일괄 처리는 보통 POST를 사용합니다.
    return new Response(
      JSON.stringify({
        success: false,
        message: "허용되지 않는 메소드 (POST만 허용)",
      }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  let supabase: SupabaseClient;

  try {
    // Supabase 클라이언트 초기화 (Service Role Key 사용)
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      throw new Error("Missing Supabase URL or Service Role Key");
    }
    supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    console.log("Supabase client for bulk update initialized.");
  } catch (error) {
    const status =
      error.message.includes("Authorization") || error.message.includes("token")
        ? 401
        : 500;
    console.error("Auth or Supabase init error (bulk):", error.message);
    return new Response(
      JSON.stringify({ success: false, message: error.message }),
      {
        status: status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
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

    const { orderIds, status, subStatus, shippingInfo, cancelReason } = body; // orderIds는 배열

    // orderIds와 status 필수 확인
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "'orderIds' (배열) 정보가 필요하며, 비어있을 수 없습니다.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
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
      `Attempting to bulk update status for ${orderIds.length} orders to ${status}`
    );
    console.log(`Order IDs: ${orderIds.join(", ")}`);

    // 업데이트 데이터 준비
    const updateData: Record<string, any> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (subStatus !== undefined) updateData.sub_status = subStatus;
    // 참고: shippingInfo, cancelReason 등은 모든 주문에 동일하게 적용됩니다.
    // 만약 주문별로 다른 값을 적용해야 한다면, API 요청 구조와 이 로직을 더 복잡하게 만들어야 합니다.
    if (shippingInfo) updateData.shipping_info = shippingInfo;
    if (cancelReason) updateData.cancel_reason = cancelReason; // 예시로 추가

    // 상태별 추가 처리 (기존 로직과 유사)
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
    // 미수령, 확인필요 등은 sub_status로 관리될 수 있으므로, 기본 updateData에 subStatus가 포함되도록 함.
    // 만약 이 상태들이 주 상태(status)이고 특별한 타임스탬프 처리가 필요하다면 여기에 추가.

    // DB 일괄 업데이트 실행
    // .update()는 기본적으로 업데이트된 행의 수를 반환하지 않지만, .select()를 추가하면 데이터를 가져올 수 있습니다.
    // count: 'exact' 옵션은 PostgreSQL에서 count를 가져오지만, update와 함께 사용할 때 주의가 필요.
    // 여기서는 업데이트 후 select로 실제 변경된 데이터를 가져오거나, count만 가져오는 것을 선택할 수 있습니다.
    // 우선은 업데이트된 데이터를 가져오도록 합니다.
    const {
      data: updatedOrders,
      error: updateError,
      count,
    } = await supabase
      .from("orders")
      .update(updateData)
      .in("order_id", orderIds) // 여기가 핵심: 여러 ID에 대해 업데이트
      .select(); // 업데이트된 행들을 반환 (선택 사항, 성능에 영향 줄 수 있음)
    // .select('order_id') 와 같이 특정 컬럼만 선택하여 성능 개선 가능
    // 또는 count만 필요하면 .select('*', { count: 'exact', head: true }) 같은 방법도 고려

    if (updateError) {
      console.error(`Supabase bulk update error:`, updateError);
      throw updateError;
    }

    // 성공 응답
    // updatedOrders는 배열이거나 null일 수 있습니다.
    const updatedCount = updatedOrders ? updatedOrders.length : 0; // 실제 업데이트된 주문 수 (select() 사용 시)
    // 만약 .select()를 사용하지 않고 count만 필요하면, Supabase JS 라이브러리가 update 작업 후 count를 직접 반환하는지 확인 필요.
    // (최신 버전에서는 data와 count를 함께 반환하기도 합니다.)

    console.log(
      `${updatedCount} orders (out of ${orderIds.length} requested) status updated successfully.`
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: `${updatedCount}개의 주문 상태가 업데이트되었습니다. (요청: ${orderIds.length}개)`,
        updatedCount: updatedCount,
        requestedCount: orderIds.length,
        // data: updatedOrders, // 선택 사항: 업데이트된 전체 주문 데이터를 반환할지 여부
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Unhandled error in orders-bulk-update-status:", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "주문 상태 일괄 업데이트 중 오류 발생",
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
// const orderIdsToUpdate = ["uuid1", "uuid2", "uuid3"];
// const newStatus = "수령완료";

// supabase.functions.invoke('orders-bulk-update-status', {
//   method: 'POST',
//   headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
//   body: JSON.stringify({ orderIds: orderIdsToUpdate, status: newStatus })
// })
// .then(response => {
//   if (response.error) throw response.error;
//   console.log('Bulk update successful:', response.data);
// })
// .catch(error => {
//   console.error('Bulk update failed:', error);
// });
*/
