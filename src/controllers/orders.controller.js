// src/controllers/orders.controller.js - 주문 관련 컨트롤러
const { createClient } = require("@supabase/supabase-js");
const logger = require("../config/logger");

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
    const { userId } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const startIndex = (page - 1) * limit;
    const sortBy = req.query.sortBy || "ordered_at";
    const sortOrder = req.query.sortOrder === "asc" ? true : false;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "사용자 ID가 필요합니다.",
      });
    }

    // 주문 목록 조회 쿼리
    let query = supabase
      .from("orders")
      .select(
        `
        *
        
      `,
        { count: "exact" }
      )
      .eq("user_id", userId)
      .order(sortBy, { ascending: sortOrder })
      .range(startIndex, startIndex + limit - 1);

    // 필터링 조건 추가
    if (req.query.status && req.query.status !== "undefined") {
      query = query.eq("status", req.query.status);
    }

    if (req.query.search && req.query.search !== "undefined") {
      query = query.ilike("title", `%${req.query.search}%`);
    }

    if (req.query.startDate && req.query.endDate) {
      query = query
        .gte("ordered_at", req.query.startDate)
        .lte("ordered_at", req.query.endDate);
    }

    const { data, error, count } = await query;

    if (error) {
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

    const updateData = {
      status,
      updated_at: new Date().toISOString(),
    };

    // 배송 정보가 있을 경우 추가
    if (shippingInfo) {
      updateData.shipping_info = shippingInfo;
    }

    // 주문 상태에 따라 확인/완료 시간 설정
    if (status === "확인완료") {
      updateData.confirmed_at = new Date().toISOString();
    } else if (status === "배송완료" || status === "수령완료") {
      updateData.completed_at = new Date().toISOString();
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
 * 주문 통계 조회
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getOrderStats = async (req, res) => {
  try {
    const { userId } = req.query;
    const period = req.query.period || "month"; // 기본값: 월간

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "사용자 ID가 필요합니다.",
      });
    }

    // 기간 설정
    const now = new Date();
    let startDate;

    switch (period) {
      case "week":
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
      case "month":
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 1);
        break;
      case "year":
        startDate = new Date(now);
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      default:
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 1);
    }

    // 주문 통계 쿼리
    const { data: ordersData, error: ordersError } = await supabase
      .from("orders")
      .select("status, total_amount, ordered_at")
      .eq("user_id", userId)
      .gte("ordered_at", startDate.toISOString())
      .lte("ordered_at", now.toISOString());

    if (ordersError) {
      throw ordersError;
    }

    // 통계 계산
    const totalOrders = ordersData.length;
    const totalSales = ordersData.reduce(
      (sum, order) => sum + (order.total_amount || 0),
      0
    );

    // 상태별 주문 수 계산
    const statusCounts = {};
    ordersData.forEach((order) => {
      const status = order.status || "unknown";
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    return res.status(200).json({
      success: true,
      data: {
        totalOrders,
        totalSales,
        statusCounts,
        period,
        startDate: startDate.toISOString(),
        endDate: now.toISOString(),
      },
    });
  } catch (error) {
    logger.error("주문 통계 조회 오류:", error);
    return res.status(500).json({
      success: false,
      message: "주문 통계를 불러오는 중 오류가 발생했습니다.",
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
