// src/controllers/products.controller.js - 상품 관련 컨트롤러
const { createClient } = require("@supabase/supabase-js");
const logger = require("../config/logger");

// Supabase 클라이언트 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * 모든 상품 목록 조회
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getAllProducts = async (req, res) => {
  try {
    const { userId } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const startIndex = (page - 1) * limit;
    const sortBy = req.query.sortBy || "created_at";
    const sortOrder = req.query.sortOrder === "asc" ? true : false;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "사용자 ID가 필요합니다.",
      });
    }

    // 상품 정보 조회 쿼리
    let query = supabase
      .from("products")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order(sortBy, { ascending: sortOrder })
      .range(startIndex, startIndex + limit - 1);

    // 필터링 조건 추가
    if (req.query.category && req.query.category !== "undefined") {
      query = query.eq("category", req.query.category);
    }

    if (req.query.status && req.query.status !== "undefined") {
      query = query.eq("status", req.query.status);
    }

    if (req.query.search && req.query.search !== "undefined") {
      query = query.or(
        `title.ilike.%${req.query.search}%, content.ilike.%${req.query.search}%`
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
    logger.error("상품 목록 조회 오류:", error);
    return res.status(500).json({
      success: false,
      message: "상품 목록을 불러오는 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 특정 상품 정보 조회
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "상품 ID가 필요합니다.",
      });
    }

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("product_id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          message: "해당 ID의 상품을 찾을 수 없습니다.",
        });
      }
      throw error;
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    logger.error(`상품 정보 조회 오류 (ID: ${req.params.id}):`, error);
    return res.status(500).json({
      success: false,
      message: "상품 정보를 불러오는 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 상품 등록
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const createProduct = async (req, res) => {
  try {
    const {
      userId,
      name,
      description,
      price,
      category,
      imageUrl,
      stock,
      options,
    } = req.body;

    if (!userId || !name || !price) {
      return res.status(400).json({
        success: false,
        message: "필수 정보가 누락되었습니다.",
      });
    }

    const { data, error } = await supabase
      .from("products")
      .insert([
        {
          user_id: userId,
          name,
          description,
          price,
          category,
          image_url: imageUrl,
          stock,
          options,
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return res.status(201).json({
      success: true,
      message: "상품이 등록되었습니다.",
      data,
    });
  } catch (error) {
    logger.error("상품 등록 오류:", error);
    return res.status(500).json({
      success: false,
      message: "상품 등록 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 상품 정보 업데이트
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, category, imageUrl, stock, options } =
      req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "상품 ID가 필요합니다.",
      });
    }

    const { data, error } = await supabase
      .from("products")
      .update({
        name,
        description,
        price,
        category,
        image_url: imageUrl,
        stock,
        options,
        updated_at: new Date().toISOString(),
      })
      .eq("product_id", id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return res.status(200).json({
      success: true,
      message: "상품 정보가 업데이트되었습니다.",
      data,
    });
  } catch (error) {
    logger.error(`상품 정보 업데이트 오류 (ID: ${req.params.id}):`, error);
    return res.status(500).json({
      success: false,
      message: "상품 정보 업데이트 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 상품 삭제
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "상품 ID가 필요합니다.",
      });
    }

    const { error } = await supabase
      .from("products")
      .delete()
      .eq("product_id", id);

    if (error) {
      throw error;
    }

    return res.status(200).json({
      success: true,
      message: "상품이 삭제되었습니다.",
    });
  } catch (error) {
    logger.error(`상품 삭제 오류 (ID: ${req.params.id}):`, error);
    return res.status(500).json({
      success: false,
      message: "상품 삭제 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

module.exports = {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
