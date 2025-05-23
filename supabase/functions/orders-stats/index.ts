// supabase/functions/orders/stats/index.ts - NO JWT AUTH
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
// import { verifyToken } from '../../_shared/jwt.ts'; // 제거

// CORS 헤더 설정
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// --- 최근 주문 조회를 위한 함수 (서비스 로직 통합) ---
async function getRecentOrdersInternal(
  supabase: SupabaseClient,
  userId: string,
  limit = 10
) {
  console.log(
    `Fetching recent orders internally for user ${userId} with limit ${limit}`
  );
  try {
    // 1. 제외고객 목록 가져오기
    let excludedCustomers: string[] = [];
    try {
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("excluded_customers")
        .eq("user_id", userId)
        .single();

      if (userError) {
        console.error(
          `[getRecentOrdersInternal] Failed to fetch excluded customers for user ${userId}: ${userError.message}`
        );
      } else if (
        userData?.excluded_customers &&
        Array.isArray(userData.excluded_customers)
      ) {
        excludedCustomers = userData.excluded_customers;
        console.log(
          `[getRecentOrdersInternal] Loaded ${excludedCustomers.length} excluded customers for filtering`
        );
      }
    } catch (e) {
      console.error(
        `[getRecentOrdersInternal] Error fetching excluded customers: ${e.message}`
      );
      // 제외고객 목록 조회 실패 시에도 최근 주문은 계속 조회 (필터링 없이)
    }

    // 2. 최근 주문 조회 (필터링 적용)
    let query = supabase
      .from("orders")
      .select(
        `
        order_id,
        customer_name,
        total_amount,
        ordered_at,
        created_at,
        status,
        sub_status
      `
      )
      .eq("user_id", userId)
      .order("ordered_at", { ascending: false })
      .limit(limit);

    // 제외고객 필터링 적용
    if (excludedCustomers.length > 0) {
      // Supabase 'in' 필터는 값들을 괄호로 묶고 쉼표로 구분된 문자열을 기대합니다.
      // 예: ('customer1','customer2','customer3')
      // 각 고객 이름에 작은따옴표가 필요할 수 있으나, Supabase JS 라이브러리가 이를 처리해 줄 가능성이 높습니다.
      // 먼저 따옴표 없이 시도하고, 문제가 지속되면 각 항목을 "'" + item + "'" 형태로 감싸는 것을 고려합니다.
      const filterValues = `(${excludedCustomers
        .map((name) => `${name.replace(/'/g, "''")}`)
        .join(",")})`; // 고객 이름 내 작은따옴표 이스케이프 처리
      query = query.not("customer_name", "in", filterValues);
      console.log(
        `[getRecentOrdersInternal] Filtering out ${excludedCustomers.length} excluded customers from recent orders with filter: customer_name.not.in.${filterValues}`
      );
    }
    const { data, error } = await query;

    if (error) {
      console.error(
        "[getRecentOrdersInternal] Internal error fetching recent orders:",
        error
      );
      return [];
    }
    return data || [];
  } catch (err) {
    console.error(
      "[getRecentOrdersInternal] Exception in getRecentOrdersInternal:",
      err
    );
    return [];
  }
}
// --- 최근 주문 조회 함수 끝 ---

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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); // RPC 호출 등에 필요할 수 있음
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
    // URL에서 쿼리 파라미터 추출
    const url = new URL(req.url);
    const params = url.searchParams;

    // === JWT 제거: userId를 쿼리 파라미터에서 받음 ===
    const userId = params.get("userId");
    if (!userId) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "쿼리 파라미터 'userId'가 필요합니다.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    // ==========================================

    // 1. 제외고객 목록 가져오기 (RPC 호출용)
    let excludedCustomersForRpc: string[] = [];
    try {
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("excluded_customers")
        .eq("user_id", userId)
        .single();

      if (userError) {
        console.error(
          `[MainHandler] Failed to fetch excluded customers for user ${userId} for RPC: ${userError.message}`
        );
      } else if (
        userData?.excluded_customers &&
        Array.isArray(userData.excluded_customers)
      ) {
        excludedCustomersForRpc = userData.excluded_customers;
        console.log(
          `[MainHandler] Loaded ${excludedCustomersForRpc.length} excluded customers for RPC filtering`
        );
      }
    } catch (e) {
      console.error(
        `[MainHandler] Error fetching excluded customers for RPC: ${e.message}`
      );
      // 오류 발생 시 빈 배열로 계속 진행 (RPC에서 필터링 안 함)
    }

    // 필터 파라미터
    const dateRange = params.get("dateRange") || "7days";
    const queryStartDate = params.get("startDate");
    const queryEndDate = params.get("endDate");
    const status = params.get("status");
    const subStatus = params.get("subStatus");
    const search = params.get("search");

    console.log(
      `Fetching order stats for user ${userId} (No Auth) with filters:`,
      { dateRange, queryStartDate, queryEndDate, status, subStatus, search }
    );

    // 날짜 범위 계산
    let fromDate = new Date();
    let toDate = new Date();
    toDate.setHours(23, 59, 59, 999);

    if (dateRange === "custom" && queryStartDate && queryEndDate) {
      try {
        fromDate = new Date(queryStartDate);
        fromDate.setHours(0, 0, 0, 0);
        toDate = new Date(queryEndDate);
        toDate.setHours(23, 59, 59, 999);
      } catch {
        /* 날짜 형식 오류 시 기본값 사용 */
      }
    } else {
      const daysMap = { today: 0, "7days": 7, "30days": 30, "90days": 90 };
      const days = daysMap[dateRange] ?? 7; // 기본 7일
      fromDate.setDate(fromDate.getDate() - days);
      fromDate.setHours(0, 0, 0, 0);
    }
    console.log(
      `Calculated date range: ${fromDate.toISOString()} ~ ${toDate.toISOString()}`
    );

    // RPC 호출 파라미터 준비
    const rpcParams = {
      p_user_id: userId,
      p_start_date: fromDate.toISOString(),
      p_end_date: toDate.toISOString(),
      p_status_filter:
        status && status !== "all" && status !== "undefined" ? status : null,
      // subStatus가 콤마로 구분된 여러 값일 경우 RPC 함수가 처리 가능한지 확인 필요
      // 여기서는 단일 값 또는 null만 전달하는 것으로 가정
      p_sub_status_filter:
        subStatus &&
        subStatus !== "all" &&
        subStatus !== "undefined" &&
        subStatus.toLowerCase() !== "none"
          ? subStatus
          : subStatus?.toLowerCase() === "none"
          ? null
          : null, // 'none'은 null로
      p_search_term: search ? `%${search}%` : null,
      p_excluded_customer_names:
        excludedCustomersForRpc.length > 0 ? excludedCustomersForRpc : null, // 제외고객 목록 추가
    };
    console.log("Calling RPC with params:", rpcParams);

    // --- DB RPC 호출 및 최근 주문 조회 (Promise.all) ---
    const [rpcResult, recentOrdersResult] = await Promise.all([
      supabase.rpc("get_order_stats_by_date_range", rpcParams), // 실제 RPC 함수 이름 확인!
      getRecentOrdersInternal(supabase, userId, 10), // 내부 함수 호출
    ]);
    // --------------------------------------------------

    // RPC 결과 처리
    if (rpcResult.error) {
      console.error("Supabase RPC error:", rpcResult.error);
      throw new Error(`DB 통계 함수 호출 오류: ${rpcResult.error.message}`);
    }
    const statsFromDB =
      rpcResult.data &&
      Array.isArray(rpcResult.data) &&
      rpcResult.data.length > 0
        ? rpcResult.data[0]
        : {};
    console.log("Stats from DB RPC:", statsFromDB);

    // 최근 활동 데이터 가공
    const recentActivity = recentOrdersResult.map((order) => ({
      type: "order",
      orderId: order.order_id,
      customerName: order.customer_name || "알 수 없음",
      amount: order.total_amount || 0,
      timestamp: order.ordered_at || order.created_at,
      status: order.status,
    }));

    // 최종 응답 데이터 구성 (DB RPC 반환 필드명 기준)
    const statsData = {
      totalOrders: statsFromDB?.total_orders_count ?? 0,
      completedOrders: statsFromDB?.completed_orders_count ?? 0,
      pendingOrders: statsFromDB?.pending_receipt_orders_count ?? 0, // DB 함수 필드명 확인
      estimatedRevenue: Number(statsFromDB?.total_estimated_revenue ?? 0),
      confirmedRevenue: Number(statsFromDB?.total_confirmed_revenue ?? 0),
      // DB RPC가 반환하는 다른 통계 추가
      recentActivity,
      dateRange: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        type: dateRange,
      },
    };

    // 성공 응답
    console.log("Order stats fetched successfully.");
    return new Response(
      JSON.stringify({
        success: true,
        message: "주문 통계 조회 성공",
        data: statsData,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Unhandled error in orders/stats (No Auth):", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "주문 통계 조회 중 오류 발생",
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
// fetch('/functions/v1/orders/stats?userId=TARGET_USER_ID&dateRange=30days&status=수령완료', { headers: { apikey } })
*/
