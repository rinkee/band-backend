// src/controllers/customers.controller.js - 고객 관련 컨트롤러
const { createClient } = require("@supabase/supabase-js");
const logger = require("../config/logger");

// Supabase 클라이언트 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * 고객 목록 조회
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getAllCustomers = async (req, res) => {
  try {
    const { userId } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const startIndex = (page - 1) * limit;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "사용자 ID가 필요합니다.",
      });
    }

    // 고객 목록 조회 쿼리
    let query = supabase
      .from("customers")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("last_order_at", { ascending: false })
      .range(startIndex, startIndex + limit - 1);

    // 검색 조건 추가
    if (req.query.search) {
      query = query.or(
        `name.ilike.%${req.query.search}%,phone.ilike.%${req.query.search}%`
      );
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
    logger.error("고객 목록 조회 오류:", error);
    return res.status(500).json({
      success: false,
      message: "고객 목록을 불러오는 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 특정 고객 정보 조회
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "고객 ID가 필요합니다.",
      });
    }

    // 고객 정보 조회
    const { data: customerData, error: customerError } = await supabase
      .from("customers")
      .select("*")
      .eq("customer_id", id)
      .single();

    if (customerError) {
      if (customerError.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          message: "해당 ID의 고객을 찾을 수 없습니다.",
        });
      }
      throw customerError;
    }

    // 고객의 주문 내역 조회
    const { data: orderData, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("customer_id", id)
      .order("ordered_at", { ascending: false });

    if (orderError) {
      throw orderError;
    }

    return res.status(200).json({
      success: true,
      data: {
        customer: customerData,
        orders: orderData || [],
      },
    });
  } catch (error) {
    logger.error(`고객 정보 조회 오류 (ID: ${req.params.id}):`, error);
    return res.status(500).json({
      success: false,
      message: "고객 정보를 불러오는 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 고객 정보 추가
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const createCustomer = async (req, res) => {
  try {
    const { userId, name, phone, email, address, memo } = req.body;

    if (!userId || !name) {
      return res.status(400).json({
        success: false,
        message: "필수 정보가 누락되었습니다.",
      });
    }

    // 중복 고객 확인 (전화번호 기준)
    if (phone) {
      const { data: existingCustomer, error: checkError } = await supabase
        .from("customers")
        .select("customer_id")
        .eq("user_id", userId)
        .eq("phone", phone)
        .single();

      if (existingCustomer) {
        return res.status(400).json({
          success: false,
          message: "이미 등록된 전화번호입니다.",
          customerId: existingCustomer.customer_id,
        });
      }
    }

    const now = new Date().toISOString();

    // 고객 정보 추가
    const { data, error } = await supabase
      .from("customers")
      .insert([
        {
          user_id: userId,
          name,
          phone,
          email,
          address,
          memo,
          first_order_at: now,
          last_order_at: now,
          total_orders: 0,
        },
      ])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return res.status(201).json({
      success: true,
      message: "고객 정보가 등록되었습니다.",
      data,
    });
  } catch (error) {
    logger.error("고객 등록 오류:", error);
    return res.status(500).json({
      success: false,
      message: "고객 정보 등록 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 고객 정보 업데이트
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, email, address, memo } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "고객 ID가 필요합니다.",
      });
    }

    // 고객 정보 업데이트
    const { data, error } = await supabase
      .from("customers")
      .update({
        name,
        phone,
        email,
        address,
        memo,
      })
      .eq("customer_id", id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return res.status(200).json({
      success: true,
      message: "고객 정보가 업데이트되었습니다.",
      data,
    });
  } catch (error) {
    logger.error(`고객 정보 업데이트 오류 (ID: ${req.params.id}):`, error);
    return res.status(500).json({
      success: false,
      message: "고객 정보 업데이트 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 고객 삭제
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "고객 ID가 필요합니다.",
      });
    }

    // 관련 주문 확인
    const { data: ordersData, error: ordersError } = await supabase
      .from("orders")
      .select("order_id")
      .eq("customer_id", id);

    if (ordersError) {
      throw ordersError;
    }

    // 관련 주문이 있는 경우 삭제 불가능
    if (ordersData && ordersData.length > 0) {
      return res.status(400).json({
        success: false,
        message: "이 고객과 연결된 주문이 있어 삭제할 수 없습니다.",
        orderCount: ordersData.length,
      });
    }

    // 고객 삭제
    const { error } = await supabase
      .from("customers")
      .delete()
      .eq("customer_id", id);

    if (error) {
      throw error;
    }

    return res.status(200).json({
      success: true,
      message: "고객 정보가 삭제되었습니다.",
    });
  } catch (error) {
    logger.error(`고객 삭제 오류 (ID: ${req.params.id}):`, error);
    return res.status(500).json({
      success: false,
      message: "고객 삭제 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

module.exports = {
  getAllCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
};
