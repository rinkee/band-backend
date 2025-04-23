// Supabase 클라이언트 가져오기
const { supabase } = require("../config/supabase");
const logger = require("../config/logger"); // 로거 가져오기

/**
 * 날짜 범위로 주문 조회 - Supabase 버전
 * @param {string} userId - 사용자 ID
 * @param {Date} fromDate - 시작 날짜
 * @param {Date} toDate - 종료 날짜
 * @returns {Promise<Array>} - 필터링된 주문 데이터 배열 (상품/고객 정보 제외된 기본 주문 정보)
 */
const getOrdersByDateRange = async (userId, fromDate, toDate) => {
  logger.debug(
    "getOrdersByDateRange called for user:",
    userId,
    fromDate.toISOString(),
    toDate.toISOString()
  );
  try {
    // --- orders 테이블만 조회 ---
    const { data: orders, error } = await supabase
      .from("orders")
      .select("*") // 필요한 컬럼만 명시하는 것이 더 효율적입니다. 예: 'order_id, customer_id, status, total_amount, ordered_at'
      .eq("user_id", userId)
      .gte("ordered_at", fromDate.toISOString())
      .lte("ordered_at", toDate.toISOString())
      .order("ordered_at", { ascending: false });

    if (error) {
      logger.error("Supabase query error in getOrdersByDateRange:", error);
      throw new Error(`Supabase 주문 쿼리 오류: ${error.message}`);
    }

    if (!orders || orders.length === 0) {
      logger.debug("No orders found for the given date range.");
      return [];
    }

    // --- order_products 및 products 조회 로직 제거 ---
    // 각 주문별로 추가 DB 조회를 하던 루프를 제거했습니다.
    // 만약 고객 정보 등 다른 테이블 정보가 필요하다면, 여기서 별도로 조회하거나 JOIN을 사용해야 합니다.
    // 여기서는 단순화하여 orders 테이블 정보만 반환합니다.
    // 필요하다면 아래 customer 정보 조회 로직은 살릴 수 있습니다.

    /*
    // 만약 고객 정보가 여전히 필요하다면, 이 로직을 활용할 수 있습니다.
    // (단, 주문 건수가 많으면 N+1 쿼리 문제가 발생할 수 있으니 주의)
    const formattedOrders = [];
    for (const order of orders) {
      let customerName = "알 수 없음";
      let customerPhone = "";
      if (order.customer_id) {
        try {
          const { data: customer, error: customerError } = await supabase
            .from("customers")
            .select("name, phone")
            .eq("customer_id", order.customer_id)
            .maybeSingle();

          if (!customerError && customer) {
            customerName = customer.name || "알 수 없음";
            customerPhone = customer.phone || "";
          } else if (customerError) {
             logger.warn(`Error fetching customer ${order.customer_id}:`, customerError);
          }
        } catch (err) {
          logger.warn(`Exception fetching customer ${order.customer_id}:`, err);
        }
      }
      formattedOrders.push({
        ...order,
        customer_name: customerName,
        customer_phone: customerPhone,
        products: [], // 상품 정보는 없으므로 빈 배열
      });
    }
    return formattedOrders;
    */

    // 단순화된 버전: orders 테이블 데이터만 반환
    logger.debug(
      `Returning ${orders.length} orders from getOrdersByDateRange.`
    );
    return orders;
  } catch (error) {
    logger.error("Error in getOrdersByDateRange:", error);
    throw new Error(
      `날짜 범위 주문 조회 중 오류가 발생했습니다: ${error.message}`
    );
  }
};

/**
 * 기간별 주문 통계 계산 (JavaScript 기반)
 * @param {Array} orders - 주문 데이터 배열 (getOrdersByDateRange 결과)
 * @returns {Object} - 통계 객체
 */
const calculateOrderStats = (orders) => {
  // orders 배열이 비어있거나 유효하지 않으면 기본값 반환
  if (!Array.isArray(orders)) {
    logger.warn(
      "calculateOrderStats received invalid input, returning zero stats."
    );
    return {
      totalOrders: 0,
      completedOrders: 0,
      pendingOrders: 0,
      totalSales: 0,
      completedSales: 0,
    };
  }

  // 총 주문 수 ('주문취소' 상태 제외 카운트는 DB 함수에서 하므로 여기선 전체 카운트)
  // DB 함수와 일관성을 맞추려면 여기서도 '주문취소'를 제외해야 함
  const totalOrders = orders.filter(
    (order) => order.status !== "주문취소"
  ).length;

  // 완료된 주문 (status 확인 필요)
  // '수령완료' 문자열이 DB와 일치하는지 확인
  const completedOrders = orders.filter(
    (order) => order.status === "수령완료" // 'delivered' 등 다른 상태도 있다면 추가
  ).length;

  // 미수령 주문 (status 확인 필요)
  // '미수령' 또는 관련 상태 문자열 확인 (SQL 함수와 일치해야 함)
  const pendingOrders = orders.filter(
    (order) => order.status === "미수령" // SQL 함수에서 사용한 '미수령'과 동일한지 확인
  ).length;

  // 예상 매출 ('주문취소' 제외)
  const totalSales = orders
    .filter((order) => order.status !== "주문취소")
    .reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0);

  // 실 매출 ('수령완료' 기준)
  const completedSales = orders
    .filter(
      (order) => order.status === "수령완료" // 'delivered' 등 다른 상태도 있다면 추가
    )
    .reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0);

  const stats = {
    totalOrders,
    completedOrders,
    pendingOrders, // 필드 이름 통일 (pending_receipt_orders_count 대신)
    totalSales, // 필드 이름 통일 (total_estimated_revenue 대신)
    completedSales, // 필드 이름 통일 (total_confirmed_revenue 대신)
  };
  logger.debug("Calculated stats in JS:", stats);
  return stats;
};

/**
 * DB에서 주문 통계 조회 (기간 및 추가 필터 적용)
 * @param {string} userId - 사용자 ID
 * @param {Date} fromDate - 시작일
 * @param {Date} toDate - 종료일
 * @param {string | undefined} status - 주 상태 필터 값 (예: '주문완료', '수령완료', 또는 undefined)
 * @param {string | undefined} subStatus - 부가 상태 필터 값 (예: '확인필요', '미수령', 'none', 또는 undefined)
 * @param {string | undefined} search - 검색어 (예: '홍길동' 또는 undefined)
 * @returns {Promise<object>} - 집계된 통계 데이터 객체
 */
async function getOrderStatsFromDB(
  userId,
  fromDate,
  toDate,
  status,
  subStatus,
  search // 'search' 파라미터가 추가되었음 (또는 이전부터 있었음)
) {
  // --- RPC 호출 파라미터 준비 ---
  const rpcParams = {
    p_user_id: userId,
    p_start_date: fromDate.toISOString(),
    p_end_date: toDate.toISOString(),
    // <<< 필터 파라미터 추가 >>>
    // status 필터: 'all' 또는 undefined/null이면 null 전달, 아니면 해당 값 전달
    p_status_filter:
      status && status !== "all" && status !== "undefined" ? status : null,
    // subStatus 필터: 'all' 또는 undefined/null이면 null 전달, 아니면 해당 값 전달
    // ('none'은 RPC 함수 내에서 NULL로 처리될 것임)
    p_sub_status_filter:
      subStatus && subStatus !== "all" && subStatus !== "undefined"
        ? subStatus
        : null,
    // search 필터: 값이 있으면 ILIKE용 '%' 추가, 없으면 null 전달
    // <<< 여기가 중요! >>>
    p_search_term: search ? `%${search}%` : null, // search 값이 있으면 '%검색어%', 없으면 null 전달
  };

  logger.debug(
    "Calling RPC get_order_stats_by_date_range with params:",
    rpcParams // 로그에 실제 전달되는 파라미터 출력
  );

  try {
    // --- Supabase RPC 호출 ---
    const { data, error } = await supabase.rpc(
      "get_order_stats_by_date_range", // 실제 RPC 함수 이름 확인
      rpcParams // 수정된 파라미터 전달
    );

    if (error) {
      logger.error("Supabase RPC get_order_stats_by_date_range error:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      // 에러 메시지를 더 구체적으로 전달
      throw new Error(
        `DB 통계 함수 호출 오류: ${error.message || "Unknown RPC error"}`
      );
    }

    logger.debug("RPC get_order_stats_by_date_range raw result:", data);

    // 결과 처리: data가 배열로 오므로 첫 번째 요소 사용, 없으면 null
    const statsData =
      data && Array.isArray(data) && data.length > 0 ? data[0] : null;

    logger.debug("Parsed stats object (statsData):", statsData);

    // --- 최종 통계 객체 생성 (DB 함수 반환 필드명 확인 필수) ---
    const finalStats = {
      total_orders_count: statsData?.total_orders_count ?? 0,
      completed_orders_count: statsData?.completed_orders_count ?? 0,
      pending_receipt_orders_count:
        statsData?.pending_receipt_orders_count ?? 0, // '미수령' 등 DB 함수 정의 확인
      total_estimated_revenue: Number(statsData?.total_estimated_revenue ?? 0),
      total_confirmed_revenue: Number(statsData?.total_confirmed_revenue ?? 0),
      // 다른 통계 필드가 있다면 여기에 추가
    };

    logger.debug("Final stats object to be returned from DB:", finalStats);
    return finalStats;
  } catch (err) {
    // 함수 레벨에서 에러 로깅 및 재throw
    logger.error(`Error in getOrderStatsFromDB for user ${userId}:`, err);
    // 에러 처리를 상위(컨트롤러)로 위임하기 위해 에러를 다시 던짐
    // 또는 여기서 기본값을 반환할 수도 있음 (컨트롤러에서 에러 처리 안 할 경우)
    // return { total_orders_count: 0, ... };
    throw err;
  }
}

/**
 * 최근 주문 목록을 가져옵니다. (orders 테이블 정보만)
 * @param {string} userId - 사용자 ID
 * @param {number} [limit=10] - 가져올 주문 수
 * @returns {Promise<Array>} - 최근 주문 객체 배열 (기본 정보)
 */
async function getRecentOrders(userId, limit = 10) {
  logger.debug(`Fetching recent orders for user ${userId} with limit ${limit}`);
  try {
    // --- 'order_products' 관련 중첩 select 제거 ---
    const { data, error } = await supabase
      .from("orders")
      // 필요한 orders 테이블의 컬럼만 명시적으로 선택하는 것이 좋습니다.
      .select(
        `
        order_id,
        customer_name,
        total_amount,
        ordered_at,
        created_at,
        status
      `
      )
      // .select('*') // 모든 컬럼을 가져오려면 이렇게 사용
      .eq("user_id", userId)
      .order("ordered_at", { ascending: false })
      .limit(limit);

    if (error) {
      // 에러 로그에 상세 정보 추가
      logger.error("Error fetching recent orders from Supabase:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        userId: userId,
        limit: limit,
      });
      // 에러 메시지에 Supabase 에러 포함
      throw new Error(`DB 최근 주문 조회 오류: ${error.message}`);
    }

    // --- 'order_products' 관련 데이터 가공 로직 제거 ---
    // Supabase는 요청한 컬럼만 배열 형태로 반환합니다.
    // 추가적인 가공이 필요하다면 여기서 수행할 수 있습니다. (예: 날짜 포맷 변경 등)
    const formattedData = data || []; // data가 null일 경우 빈 배열 반환

    logger.debug(`Successfully fetched ${formattedData.length} recent orders.`);
    return formattedData; // 가공 없이 또는 최소한의 가공 후 반환
  } catch (err) {
    // 여기서 잡힌 에러는 위에서 throw된 에러 또는 예상 못한 다른 에러일 수 있음
    logger.error("Error in getRecentOrders function:", {
      message: err.message,
      stack: err.stack, // 스택 트레이스 포함
      userId: userId,
    });
    // 이미 Error 객체일 것이므로 그대로 다시 throw
    throw err;
  }
}

// 서비스 객체 내보내기
const orderService = {
  getOrdersByDateRange,
  calculateOrderStats,
  getOrderStatsFromDB, // DB 기반 통계 함수
  getRecentOrders,
};

module.exports = { orderService };
