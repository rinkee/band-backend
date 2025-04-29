// src/controllers/orders.controller.js - 주문 관련 컨트롤러
const { createClient } = require("@supabase/supabase-js");
const logger = require("../config/logger");
const { orderService } = require("../services/orders.service");

// Supabase 클라이언트 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * 주문 목록 조회
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getAllOrders = async (req, res) => {
  try {
    const { userId, status, subStatus, search, startDate, endDate } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const startIndex = (page - 1) * limit;
    const sortBy = req.query.sortBy || "ordered_at"; // 기본 정렬: 주문 시간
    const sortOrder = req.query.sortOrder === "asc" ? true : false; // 기본 정렬: 내림차순

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "사용자 ID가 필요합니다.",
      });
    }

    // --- 쿼리 시작 ---
    let query = supabase
      .from("orders_with_products")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("ordered_at", { ascending: false }); //

    // --- 필터링 조건 추가 ---
    // 1. 주 상태(status) 필터링
    // status 파라미터가 문자열 배열로 올 수 있음을 처리 (예: ['주문완료', '확인필요', '미수령'])
    if (status) {
      if (Array.isArray(status)) {
        // 배열이면 .in() 사용
        query = query.in("status", status);
      } else if (
        typeof status === "string" &&
        status !== "undefined" &&
        status !== "all"
      ) {
        // 문자열이면 .eq() 사용 ('all' 또는 'undefined' 문자열은 무시)
        query = query.eq("status", status);
      }
    }

    // 2. 부가 상태(sub_status) 필터링 <<<--- 수정된 부분 ---
    if (subStatus) {
      if (Array.isArray(subStatus)) {
        // 배열이면 .in() 사용
        query = query.in("sub_status", subStatus);
      } else if (
        typeof subStatus === "string" &&
        subStatus !== "undefined" &&
        subStatus !== "all"
      ) {
        // 문자열이면 .eq() 또는 .is() 사용
        if (
          subStatus.toLowerCase() === "none" ||
          subStatus.toLowerCase() === "null"
        ) {
          // 'none' 또는 'null' 값이 오면 sub_status가 NULL인 것만 필터링
          query = query.is("sub_status", null);
        } else {
          // 그 외 문자열은 .eq() 사용
          query = query.eq("sub_status", subStatus);
        }
      }
      // 만약 'all' 또는 'undefined' 문자열이 오면 아무 필터도 적용하지 않음
    }

    // 3. 검색 조건 (기존과 동일)
    // 고객명, 상품명(뷰에 포함된), 상품 바코드(뷰에 포함된) 검색
    if (search && search !== "undefined") {
      // 쉼표로 구분된 여러 필드에 대해 ILIKE 검색
      query = query.or(
        `customer_name.ilike.%${search}%,product_title.ilike.%${search}%,product_barcode.ilike.%${search}%`
      );
    }

    // 4. 기간 필터링 (기존과 동일)
    if (startDate && endDate) {
      // ISO 8601 형식의 날짜 문자열이라고 가정
      query = query.gte("ordered_at", startDate).lte("ordered_at", endDate);
    }

    // --- 정렬 및 페이지네이션 적용 (기존과 동일) ---
    query = query
      .order(sortBy, { ascending: sortOrder })
      .range(startIndex, startIndex + limit - 1);

    // --- 쿼리 실행 ---
    const { data, error, count } = await query;
    if (error) {
      // 관계 설정 오류 등 특정 오류 메시지 확인
      if (
        error.message.includes("relationship") &&
        error.message.includes("products")
      ) {
        logger.error(
          "Supabase 오류: 'orders'와 'products' 간의 관계 설정이 DB에 없거나 잘못되었을 수 있습니다."
        );
        return res.status(500).json({
          success: false,
          message: "데이터베이스 관계 설정 오류. 관리자에게 문의하세요.",
          error: "Missing or incorrect relationship: orders -> products",
        });
      }
      // 그 외 일반 오류
      throw error;
    }

    // 전체 페이지 수 계산
    const totalPages = Math.ceil(count / limit);

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        total: count,
        totalPages,
        currentPage: page,
        limit,
      },
    });
  } catch (error) {
    logger.error("주문 목록 조회 오류:", error);
    return res.status(500).json({
      success: false,
      message: "주문 목록을 불러오는 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 특정 주문 정보 조회
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "주문 ID가 필요합니다.",
      });
    }

    const { data, error } = await supabase
      .from("orders")
      .select(
        `
        *
      `
      )
      .eq("order_id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          message: "해당 ID의 주문을 찾을 수 없습니다.",
        });
      }
      throw error;
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    logger.error(`주문 정보 조회 오류 (ID: ${req.params.id}):`, error);
    return res.status(500).json({
      success: false,
      message: "주문 정보를 불러오는 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 주문 상태 업데이트
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, shippingInfo } = req.body;

    if (!id || !status) {
      return res.status(400).json({
        success: false,
        message: "주문 ID와 상태 정보가 필요합니다.",
      });
    }

    // 허용된 상태 값인지 확인
    const allowedStatuses = [
      "주문완료",
      "주문취소",
      "수령완료",
      "결제완료",
      "확인필요",
    ];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message:
          "허용되지 않은 주문 상태입니다. 주문완료, 주문취소, 수령완료 중 하나를 선택해주세요.",
      });
    }

    const updateData = {
      status,
      updated_at: new Date().toISOString(),
    };

    // 배송 정보가 있을 경우 추가
    if (shippingInfo) {
      updateData.shipping_info = shippingInfo;
    }

    // 주문 상태에 따라 완료/취소/결제 시간 설정
    if (status === "수령완료") {
      updateData.completed_at = new Date().toISOString();
      // 필요하다면 다른 필드 초기화 (예: canceled_at)
      updateData.canceled_at = null;
    } else if (status === "주문취소") {
      updateData.canceled_at = new Date().toISOString();
      // 필요하다면 다른 필드 초기화 (예: completed_at, paid_at)
      updateData.completed_at = null;
      updateData.paid_at = null; // 예시: 취소 시 결제 시간 초기화
    } else if (status === "결제완료") {
      // --- Add: "결제완료" 상태 처리 추가 ---
      updateData.paid_at = new Date().toISOString(); // 예시: 결제 완료 시간 기록
      // updateData.payment_status = 'paid'; // 예시: 별도 결제 상태 필드 업데이트
      // 필요하다면 다른 필드 초기화 (예: canceled_at)
      updateData.completed_at = null;
      updateData.canceled_at = null;
    } else if (status === "주문완료") {
      // 주문완료 상태로 변경 시 관련 시간 필드 초기화
      updateData.completed_at = null;
      updateData.canceled_at = null;
      updateData.paid_at = null; // 결제 시간도 초기화 (필요에 따라 조정)
    }
    // "주문완료", "확인필요" 시에는 기본 status, updated_at만 업데이트
    const { data, error } = await supabase
      .from("orders")
      .update(updateData)
      .eq("order_id", id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return res.status(200).json({
      success: true,
      message: "주문 상태가 업데이트되었습니다.",
      data,
    });
  } catch (error) {
    logger.error(`주문 상태 업데이트 오류 (ID: ${req.params.id}):`, error);
    return res.status(500).json({
      success: false,
      message: "주문 상태 업데이트 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 주문 취소
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const cancelOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "주문 ID가 필요합니다.",
      });
    }

    // 주문 정보 확인
    const { data: orderData, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("order_id", id)
      .single();

    if (orderError) {
      throw orderError;
    }

    // 이미 취소된 주문인지 확인
    if (orderData.status === "canceled") {
      return res.status(400).json({
        success: false,
        message: "이미 취소된 주문입니다.",
      });
    }

    // 주문 상태 업데이트
    const { data, error } = await supabase
      .from("orders")
      .update({
        status: "canceled",
        cancel_reason: reason || "사용자 요청으로 취소됨",
        canceled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("order_id", id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return res.status(200).json({
      success: true,
      message: "주문이 취소되었습니다.",
      data,
    });
  } catch (error) {
    logger.error(`주문 취소 오류 (ID: ${req.params.id}):`, error);
    return res.status(500).json({
      success: false,
      message: "주문 취소 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 주문 통계 조회 - 기간별 및 추가 필터링 가능
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getOrderStats = async (req, res) => {
  try {
    // --- 1. 필터 파라미터 추출 (status, subStatus, search 추가) ---
    const {
      userId,
      dateRange = "7days", // 기본값 설정
      startDate: queryStartDate, // 이름 충돌 피하기 위해 변경
      endDate: queryEndDate, // 이름 충돌 피하기 위해 변경
      status, // 주 상태 필터
      subStatus, // 부가 상태 필터
      search, // 검색어 필터
    } = req.query; // <<< req.query에서 새 파라미터 추출

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "사용자 ID가 필요합니다.",
      });
    }

    console.time(`[Stats ${userId}] Total`);

    // --- 2. 날짜 범위 계산 (기존 로직 유지) ---
    let fromDate = new Date();
    let toDate = new Date();
    toDate.setHours(23, 59, 59, 999);

    if (dateRange === "custom" && queryStartDate && queryEndDate) {
      fromDate = new Date(queryStartDate);
      fromDate.setHours(0, 0, 0, 0);
      toDate = new Date(queryEndDate);
      toDate.setHours(23, 59, 59, 999);
    } else {
      // 미리 정의된 기간 계산
      switch (dateRange) {
        case "today":
          fromDate.setHours(0, 0, 0, 0);
          break;
        // ... (yesterday, thisWeek 등 다른 케이스) ...
        case "30days":
          fromDate.setDate(fromDate.getDate() - 30);
          fromDate.setHours(0, 0, 0, 0);
          break;
        case "90days":
          fromDate.setDate(fromDate.getDate() - 90);
          fromDate.setHours(0, 0, 0, 0);
          break;
        case "7days":
        default:
          fromDate.setDate(fromDate.getDate() - 7);
          fromDate.setHours(0, 0, 0, 0);
          break;
      }
    }

    // 계산된 날짜 로그
    logger.debug(
      // console.log 대신 logger 사용
      `[Stats ${userId}] 기간 필터링 적용: ${fromDate.toISOString()} ~ ${toDate.toISOString()}`
    );

    // --- 3. DB/서비스 호출 시 모든 필터 파라미터 전달 ---
    console.time(`[Stats ${userId}] DB Query`);
    // <<< orderService.getOrderStatsFromDB 호출 시 새 파라미터 전달 >>>
    const [statsResultFromDB, recentOrdersResult] = await Promise.all([
      orderService.getOrderStatsFromDB(
        userId,
        fromDate,
        toDate,
        status, // <<< status 전달
        subStatus, // <<< subStatus 전달
        search // <<< search 전달
      ),
      orderService.getRecentOrders(userId, 10), // 최근 주문은 필터와 무관하게 유지
    ]);
    console.timeEnd(`[Stats ${userId}] DB Query`);

    // --- 4. 결과 처리 ---
    console.time(`[Stats ${userId}] Data Processing`);
    // DB 함수/RPC의 반환값 구조를 확인하고 필드명 매칭 필요
    const stats = {
      totalOrders: statsResultFromDB?.total_orders_count ?? 0,
      completedOrders: statsResultFromDB?.completed_orders_count ?? 0,
      pendingOrders: statsResultFromDB?.pending_receipt_orders_count ?? 0, // '미수령' 카운트 (DB 함수 반환 필드명 확인)
      estimatedRevenue: Number(statsResultFromDB?.total_estimated_revenue ?? 0),
      confirmedRevenue: Number(statsResultFromDB?.total_confirmed_revenue ?? 0),
    };
    console.timeEnd(`[Stats ${userId}] Data Processing`);

    // --- 최근 활동 데이터 가공 (기존 로직 유지) ---
    const recentActivity = recentOrdersResult.map((order) => ({
      type: "order",
      orderId: order.order_id,
      customerName: order.customer_name || "알 수 없음",
      productName: order.product_title || "상품 정보 없음", // 뷰의 product_title 사용
      amount: order.total_amount || 0,
      timestamp: order.ordered_at || order.created_at,
      status: order.status, // 필요시 sub_status도 포함 가능
    }));

    // --- 5. 응답 생성 ---
    const statsData = {
      ...stats,
      recentActivity,
      dateRange: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        type: dateRange,
      },
    };

    console.timeEnd(`[Stats ${userId}] Total`);

    return res.status(200).json({
      success: true,
      message: "주문 통계 조회 성공",
      data: statsData,
    });
  } catch (error) {
    logger.error("주문 통계 조회 오류:", error); // logger 사용
    console.timeEnd(`[Stats ${req.query.userId}] DB Query`); // 에러 시 타이머 정리
    console.timeEnd(`[Stats ${req.query.userId}] Data Processing`);
    console.timeEnd(`[Stats ${req.query.userId}] Total`);
    return res.status(500).json({
      success: false,
      message: "주문 통계 조회 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

const updateOrderDetails = async (req, res) => {
  try {
    const orderId = req.params.id;
    const userId = req.user.userId; // Get userId from authMiddleware
    const { item_number, quantity, price, total_amount } = req.body;

    if (
      !orderId ||
      !userId ||
      !item_number ||
      !quantity ||
      !price ||
      !total_amount
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Missing parameters" });
    }

    // Check if order belongs to the user (add security check!)
    const { data: order, error } = await supabase
      .from("orders")
      .select("*")
      .eq("order_id", orderId)
      .eq("user_id", userId) // added user ID check for security
      .single();
    if (error) throw error;
    if (!order)
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });

    const { data: updatedOrder, error: updateError } = await supabase
      .from("orders")
      .update({
        item_number,
        quantity,
        price,
        total_amount,
        updated_at: new Date(),
      })
      .eq("order_id", orderId)
      .single();

    if (updateError) throw updateError;

    return res.status(200).json({ success: true, data: updatedOrder });
  } catch (error) {
    logger.error("Error updating order details:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating order details",
      error: error.message,
    });
  }
};

module.exports = {
  getAllOrders,
  getOrderById,
  updateOrderStatus,
  cancelOrder,
  getOrderStats,
  updateOrderDetails,
};
