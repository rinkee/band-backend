// Supabase 클라이언트 가져오기
const { supabase } = require("../config/supabase");

/**
 * 날짜 범위로 주문 조회 - Supabase 버전
 * @param {string} userId - 사용자 ID
 * @param {Date} fromDate - 시작 날짜
 * @param {Date} toDate - 종료 날짜
 * @returns {Promise<Array>} - 필터링된 주문 데이터 배열
 */
const getOrdersByDateRange = async (userId, fromDate, toDate) => {
  try {
    console.log(
      "getOrdersByDateRange 호출:",
      userId,
      fromDate.toISOString(),
      toDate.toISOString()
    );

    // 1. 주문 데이터 가져오기 (관계형 쿼리 없이)
    const { data: orders, error } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", userId)
      .gte("ordered_at", fromDate.toISOString())
      .lte("ordered_at", toDate.toISOString())
      .order("ordered_at", { ascending: false });

    if (error) {
      throw new Error(`Supabase 주문 쿼리 오류: ${error.message}`);
    }

    // 주문이 없는 경우 빈 배열 반환
    if (!orders || orders.length === 0) {
      return [];
    }

    const formattedOrders = [];

    // 주문 목록 처리
    for (const order of orders) {
      // 2. 주문 상품 정보 가져오기
      let products = [];

      try {
        const { data: orderProducts, error: orderProductsError } =
          await supabase
            .from("order_products")
            .select("product_id, quantity")
            .eq("order_id", order.order_id);

        if (!orderProductsError && orderProducts && orderProducts.length > 0) {
          // 상품 IDs 추출
          const productIds = orderProducts.map((op) => op.product_id);

          // 3. 상품 정보 가져오기
          const { data: productsData, error: productsError } = await supabase
            .from("products")
            .select("product_id, title, base_price")
            .in("product_id", productIds);

          if (!productsError && productsData) {
            // 상품 정보와 수량 결합
            products = orderProducts.map((op) => {
              const product =
                productsData.find((p) => p.product_id === op.product_id) || {};
              return {
                product_id: op.product_id,
                title: product.title || "상품 정보 없음",
                price: product.base_price || 0,
                quantity: op.quantity || 1,
              };
            });
          }
        }
      } catch (err) {
        console.warn(`주문 ${order.order_id}의 상품 정보 조회 중 오류:`, err);
        // 오류가 발생해도 주문 처리는 계속 진행
      }

      // 4. 고객 정보 가져오기 (고객 ID가 있는 경우)
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
          }
        } catch (err) {
          console.warn(`주문 ${order.order_id}의 고객 정보 조회 중 오류:`, err);
          // 오류가 발생해도 주문 처리는 계속 진행
        }
      }

      // 주문 객체 리턴
      formattedOrders.push({
        ...order,
        customer_name: customerName,
        customer_phone: customerPhone,
        products: products,
      });
    }

    return formattedOrders;
  } catch (error) {
    console.error("날짜 범위 주문 조회 오류:", error);
    throw new Error(
      `날짜 범위 주문 조회 중 오류가 발생했습니다: ${error.message}`
    );
  }
};

/**
 * 기간별 주문 통계 계산
 * @param {Array} orders - 주문 데이터 배열
 * @returns {Object} - 통계 객체
 */
const calculateOrderStats = (orders) => {
  // 총 주문 수
  const totalOrders = orders.length;

  // 완료된 주문 (status가 'delivered' 또는 '수령완료'인 경우)
  const completedOrders = orders.filter(
    (order) => order.status === "delivered" || order.status === "수령완료"
  ).length;

  // 미수령 주문 (주문완료건)
  const pendingOrders = orders.filter(
    (order) => order.status === "주문완료" || order.status === "confirmed"
  ).length;

  // 총 매출 (모든 주문의 total_amount 합계)
  const totalSales = orders.reduce(
    (sum, order) => sum + (Number(order.total_amount) || 0),
    0
  );

  // 수령완료 기준 매출 (status가 'delivered' 또는 '수령완료'인 주문의 total_amount 합계)
  const completedSales = orders
    .filter(
      (order) => order.status === "delivered" || order.status === "수령완료"
    )
    .reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0);

  return {
    totalOrders,
    completedOrders,
    pendingOrders,
    totalSales,
    completedSales,
  };
};

// 서비스 객체 내보내기
const orderService = {
  getOrdersByDateRange,
  calculateOrderStats,
};

module.exports = { orderService };
