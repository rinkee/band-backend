// src/controllers/products.controller.js - 상품 관련 컨트롤러
const { createClient } = require("@supabase/supabase-js");
const logger = require("../config/logger");
const { extractProductInfo } = require("../services/ai.service");

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
    const limit = parseInt(req.query.limit) || 10; // 기본값 10으로 설정 (프론트엔드와 맞추거나 조정)
    const startIndex = (page - 1) * limit;
    const sortBy = req.query.sortBy || "posted_at"; // 기본 정렬 created_at으로 변경 가능성 있음 (updated_at?)
    const sortOrder = req.query.sortOrder === "asc" ? true : false;

    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "사용자 ID가 필요합니다." });
    }

    let query = supabase
      .from("products")
      .select("*", { count: "exact" }) // count 옵션 확인
      .eq("user_id", userId);

    // 상태 필터링 (req.query.status 값이 "all"이 아닐 때만 적용)
    if (
      req.query.status &&
      req.query.status !== "all" &&
      req.query.status !== "undefined"
    ) {
      query = query.eq("status", req.query.status);
    }

    // 검색 필터링
    // !!! 여기가 문제일 가능성이 높음 !!!
    if (req.query.search && req.query.search !== "undefined") {
      const searchTerm = req.query.search;
      // or 조건으로 title 또는 barcode 에서 검색 (ilike는 대소문자 구분 안 함)
      query = query.or(
        `title.ilike.%${searchTerm}%,barcode.ilike.%${searchTerm}%`
      );
      // console.log(`Applying search filter: ${searchTerm}`); // 디버깅 로그 추가
    }

    // 정렬 및 페이지네이션 적용
    query = query
      .order(sortBy, { ascending: sortOrder })
      .range(startIndex, startIndex + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    const totalItems = count || 0; // count가 null일 경우 0으로 처리
    const totalPages = Math.ceil(totalItems / limit);

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        // --- 필드명 수정 ---
        totalItems: totalItems, // 'total' -> 'totalItems'
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
    const { name, memo, base_price, category, imageUrl, stock, options } =
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
        memo,
        base_price,
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

/**
 * 크롤링한 콘텐츠로부터 상품 정보 추출 및 저장
 * @param {Object} crawledData - 크롤링된 데이터
 * @param {string} userId - 사용자 ID
 * @returns {Promise<Object>} - 저장된 상품 정보
 */
async function processAndSaveProduct(crawledData, userId) {
  try {
    logger.info(`크롤링 데이터 처리 시작: ${crawledData.title}`);

    // 콘텐츠 텍스트에서 AI를 이용해 상품 정보 추출
    const productInfo = await extractProductInfo(crawledData.content);

    // 상품 ID 생성 (밴드 ID와 게시물 ID 조합)
    const productId = `${crawledData.bandNumber}_product_${crawledData.postId}`;

    // 데이터베이스에 저장할 상품 객체 생성
    const product = {
      product_id: productId,
      user_id: userId,
      band_number: crawledData.bandNumber,
      title: productInfo.title || crawledData.title,
      content: crawledData.content,
      price: productInfo.price || 0,
      original_price: productInfo.price || 0,
      quantity: 1,
      category: productInfo.category || "기타",
      tags: productInfo.tags || [],
      status: productInfo.status || "판매중",
      post_number: crawledData.postId,
      band_post_url: crawledData.url,
    };

    logger.info(
      `상품 정보 생성 완료: ${product.title}, 가격: ${product.price}원`
    );

    // 데이터베이스에 저장
    const { data, error } = await supabase
      .from("products")
      .upsert(product, { onConflict: "product_id" })
      .select();

    if (error) {
      logger.error("상품 정보 저장 중 오류 발생:", error);
      throw error;
    }

    logger.info(`상품 정보 저장 완료: ${product.product_id}`);
    return data[0];
  } catch (error) {
    logger.error("상품 정보 처리 및 저장 중 오류 발생:", error);
    throw error;
  }
}

/**
 * 상품 정보 부분 업데이트 (바코드 등)
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const patchProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;
    const updateData = req.body;

    if (!id || !userId) {
      return res
        .status(400)
        .json({ success: false, message: "상품 ID와 사용자 ID가 필요합니다." });
    }

    const fieldsToUpdate = {};
    const fieldMapping = {
      title: "title",
      base_price: "base_price",
      status: "status",
      barcode: "barcode",
      memo: "memo",
      pickup_info: "pickup_info",
      pickup_date: "pickup_date",
      quantity: "quantity",
      barcode_options: "barcode_options",
    };

    Object.keys(updateData).forEach((frontendField) => {
      if (
        updateData[frontendField] !== undefined &&
        fieldMapping[frontendField]
      ) {
        const backendField = fieldMapping[frontendField];
        let value = updateData[frontendField];

        //  Improved Pickup Date Handling
        if (frontendField === "pickup_date") {
          if (value === null || value === "") {
            value = null; // Explicitly set to null if empty
          } else if (typeof value === "string" && !value.includes("T")) {
            try {
              value = new Date(value).toISOString();
            } catch (dateParseError) {
              logger.error(
                `Invalid pickup_date format: ${value}.  Using NULL.`
              );
              value = null;
            }
          }
        }

        fieldsToUpdate[backendField] = value;
        logger.info(
          `상품 ID ${id}의 ${backendField}를 업데이트합니다: ${JSON.stringify(
            value
          )}`
        );
      }
    });

    fieldsToUpdate.updated_at = new Date().toISOString();

    if (Object.keys(fieldsToUpdate).length === 1 && fieldsToUpdate.updated_at) {
      return res
        .status(400)
        .json({ success: false, message: "업데이트할 정보가 없습니다." });
    }

    // ... (권한 확인 로직은 동일) ...

    const { data, error } = await supabase
      .from("products")
      .update(fieldsToUpdate)
      .eq("product_id", id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      throw error; // Re-throw the error for higher-level handling
    }

    return res.status(200).json({
      success: true,
      message: "상품 정보가 업데이트되었습니다.",
      data,
    });
  } catch (error) {
    logger.error(`상품 정보 부분 업데이트 오류 (ID: ${req.params.id}):`, error);
    // Improved error response - include error details and status code
    return res.status(error.code === 22007 ? 400 : 500).json({
      success: false,
      message: "상품 정보 업데이트 중 오류가 발생했습니다.",
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
  patchProduct,
  processAndSaveProduct,
};
