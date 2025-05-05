// supabase/functions/orders/update-details/index.ts
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

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
    const orderId = url.searchParams.get("orderId"); // 예: /functions/v1/orders/update-details?orderId=xxx

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
    // 업데이트할 필드 추출 (DB 컬럼명 확인 필요)
    const {
      item_number,
      order_quantity,
      order_price,
      total_amount,
      order_options,
      order_memo /* 기타 필드 */,
    } = body;

    console.log(`Attempting to update details for order ${orderId}`);
    // --- 권한 확인 끝 ---

    // 업데이트할 데이터 객체 생성 (제공된 필드만 포함)
    const updateData: Record<string, any> = {};
    if (item_number !== undefined) updateData.item_number = item_number;
    if (order_quantity !== undefined)
      updateData.order_quantity = order_quantity;
    if (order_price !== undefined) updateData.order_price = order_price;
    if (total_amount !== undefined) updateData.total_amount = total_amount;
    if (order_options !== undefined) updateData.order_options = order_options; // JSONB 타입 가정
    if (order_memo !== undefined) updateData.order_memo = order_memo;
    // 다른 업데이트 가능 필드 추가

    // 업데이트할 내용이 없으면 오류 반환 (updated_at 제외)
    if (Object.keys(updateData).length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "업데이트할 내용이 없습니다.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    updateData.updated_at = new Date().toISOString(); // 업데이트 시간 추가

    console.log("Updating order details with data:", updateData);

    // DB 업데이트 실행
    const { data: updatedOrder, error: updateError } = await supabase
      .from("orders")
      .update(updateData)
      .eq("order_id", orderId)
      .select()
      .single();

    if (updateError) {
      console.error(
        `Supabase update error for order details ${orderId}:`,
        updateError
      );
      throw updateError;
    }

    // 성공 응답
    console.log(`Order ${orderId} details updated successfully.`);
    return new Response(
      JSON.stringify({
        success: true,
        message: "주문 상세 정보가 업데이트되었습니다.",
        data: updatedOrder,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Unhandled error in orders/update-details:", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "주문 상세 정보 업데이트 중 오류 발생",
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
// supabase.functions.invoke('orders/update-details?orderId=ORDER_UUID', {
//   method: 'PATCH', // PATCH가 더 적절할 수 있음 (부분 업데이트)
//   headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
//   body: JSON.stringify({ order_quantity: 5, total_amount: 50000 })
// })
*/
