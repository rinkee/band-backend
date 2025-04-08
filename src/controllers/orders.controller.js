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
    const { userId, status, search, startDate, endDate } = req.query;
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
      .eq("user_id", userId);

    // --- 필터링 조건 추가 ---

    // 1. 상태 필터링
    if (status && status !== "undefined") {
      query = query.eq("status", status);
    }

    // 2. 검색 조건 (고객명과 평탄화된 상품명(product_title)을 OR 조건으로 검색)
    if (search && search !== "undefined") {
      query = query.or(
        `customer_name.ilike.%${search}%,product_title.ilike.%${search}%,product_barcode.ilike.%${search}%`
      );
    }

    // 4. 기간 필터링
    if (startDate && endDate) {
      // 날짜 형식 유효성 검사 추가 권장
      query = query
        .gte("ordered_at", startDate) // 시작일 이후
        .lte("ordered_at", endDate); // 종료일 이전
    }

    // --- 정렬 및 페이지네이션 적용 (모든 필터링 후에 적용) ---
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
    const allowedStatuses = ["주문완료", "주문취소", "수령완료"];
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

    // 주문 상태에 따라 완료 시간 설정
    if (status === "수령완료") {
      updateData.completed_at = new Date().toISOString();
    } else if (status === "주문취소") {
      updateData.canceled_at = new Date().toISOString();
    }

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
 * 주문 통계 조회 - 기간별 필터링 가능
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getOrderStats = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "사용자 ID가 필요합니다.",
      });
    }

    // 기간 파라미터 처리
    const dateRange = req.query.dateRange || "7days"; // 기본값: 7일
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    // 날짜 범위 계산
    let fromDate, toDate;
    toDate = new Date(); // 현재 시간

    if (dateRange === "custom" && startDate && endDate) {
      // 사용자 지정 기간
      fromDate = new Date(startDate);
      toDate = new Date(endDate);
      toDate.setHours(23, 59, 59, 999); // 종료일 끝 시간으로 설정
    } else {
      // 미리 정의된 기간
      fromDate = new Date();
      switch (dateRange) {
        case "today":
          // 오늘 데이터 (오늘 00:00:00부터 현재까지)
          fromDate.setHours(0, 0, 0, 0);
          break;
        case "yesterday":
          // 어제 데이터
          fromDate.setDate(fromDate.getDate() - 1);
          fromDate.setHours(0, 0, 0, 0);
          toDate = new Date(fromDate);
          toDate.setHours(23, 59, 59, 999);
          break;
        case "thisWeek":
          // 이번 주 데이터 (월요일부터 현재까지)
          const dayOfWeek = fromDate.getDay() || 7; // 0(일)을 7로 변경
          const mondayOffset = dayOfWeek === 1 ? 0 : -(dayOfWeek - 1); // 월요일이면 0, 아니면 음수
          fromDate.setDate(fromDate.getDate() + mondayOffset);
          fromDate.setHours(0, 0, 0, 0);
          break;
        case "thisMonth":
          // 이번 달 데이터 (1일부터 현재까지)
          fromDate = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
          break;
        case "lastMonth":
          // 지난 달 데이터 (지난 달 1일부터 말일까지)
          fromDate = new Date(
            fromDate.getFullYear(),
            fromDate.getMonth() - 1,
            1
          );
          toDate = new Date(fromDate.getFullYear(), fromDate.getMonth() + 1, 0);
          toDate.setHours(23, 59, 59, 999);
          break;
        case "30days":
          fromDate.setDate(fromDate.getDate() - 30);
          break;
        case "90days":
          fromDate.setDate(fromDate.getDate() - 90);
          break;
        case "7days":
        default:
          fromDate.setDate(fromDate.getDate() - 7);
          break;
      }
    }

    console.log(
      `기간 필터링: ${fromDate.toISOString()} ~ ${toDate.toISOString()}`
    );

    // 주문 데이터 조회
    const orders = await orderService.getOrdersByDateRange(
      userId,
      fromDate,
      toDate
    );

    // 서비스의 메소드를 사용하여 통계 계산
    const stats = orderService.calculateOrderStats(orders);

    // 최근 활동 (최대 10개)
    const recentActivity = orders.slice(0, 10).map((order) => ({
      type: "order",
      orderId: order.order_id,
      customerName: order.customer_name || "알 수 없음",
      productName: order.products?.[0]?.title || "상품 정보 없음",
      amount: order.total_amount || 0,
      timestamp: order.ordered_at || order.created_at, // ordered_at이 우선, 없으면 created_at 사용
      status: order.status,
    }));

    // 응답 데이터
    const statsData = {
      ...stats, // totalOrders, completedOrders, pendingOrders, totalSales, completedSales
      recentActivity,
      dateRange: {
        from: fromDate,
        to: toDate,
        type: dateRange,
      },
    };

    return res.status(200).json({
      success: true,
      message: "주문 통계 조회 성공",
      data: statsData,
    });
  } catch (error) {
    console.error("주문 통계 조회 오류:", error);
    return res.status(500).json({
      success: false,
      message: "주문 통계 조회 중 오류가 발생했습니다.",
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
};
