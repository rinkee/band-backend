// src/services/products.service.js - 상품 데이터 처리 서비스
const { createClient } = require("@supabase/supabase-js");
const logger = require("../config/logger");
const { extractProductInfo } = require("./ai.service");

// Supabase 클라이언트 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * 크롤링한 밴드 게시물에서 상품 정보를 추출하고 저장하는 함수
 * @param {Object} postData - 크롤링한 게시물 데이터
 * @param {string} userId - 사용자 ID
 * @returns {Promise<Object>} - 저장된 상품 정보
 */
const processAndSaveProduct = async (postData, userId) => {
  try {
    logger.info(`게시물 ID ${postData.postId}에서 상품 정보 추출 시작`);
    logger.info(`게시물 내용: ${postData.content.substring(0, 100)}...`);

    if (!postData.content || postData.content.trim() === "") {
      logger.warn(`게시물 ID ${postData.postId}의 콘텐츠가 비어있습니다.`);
      throw new Error("게시물 콘텐츠가 비어있습니다.");
    }

    // 1. ChatGPT API를 사용하여 게시물 콘텐츠에서 상품 정보 추출
    logger.info(`게시물 ID ${postData.postId} - ChatGPT API 호출 중...`);
    const productInfo = await extractProductInfo(postData.content);
    logger.info(
      `게시물 ID ${postData.postId} - 추출된 상품 정보:`,
      JSON.stringify(productInfo, null, 2)
    );

    // 2. 상품 ID 생성 (밴드 ID와 게시물 ID 조합)
    const productId = `${postData.bandNumber}_product_${postData.postId}`;

    // 3. 저장할 상품 객체 생성
    const product = {
      product_id: productId,
      user_id: userId,
      band_number: postData.bandNumber,
      title: productInfo.title || postData.title || "제목 없음",
      content: postData.content,
      base_price: productInfo.basePrice || 0,
      price_options: productInfo.priceOptions || [
        {
          quantity: 1,
          price: productInfo.basePrice || 0,
          description: "기본가",
        },
      ],
      quantity: productInfo.quantity || null,
      original_price: productInfo.basePrice || 0,
      category: productInfo.category || "기타",
      tags: productInfo.tags || [],
      features: productInfo.features || [],
      status: productInfo.status || "판매중",
      delivery_info: productInfo.deliveryInfo || null,
      delivery_date: productInfo.deliveryDate || null,
      delivery_type: productInfo.deliveryType || null,
      post_number: postData.postId,
      band_post_url:
        postData.url ||
        `https://band.us/band/${postData.bandNumber}/post/${postData.postId}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    logger.info(
      `게시물 ID ${postData.postId} - 저장할 상품 객체:`,
      JSON.stringify(product, null, 2)
    );

    // 4. Supabase에 상품 정보 저장 (이미 있는 경우 업데이트)
    logger.info(`게시물 ID ${postData.postId} - Supabase에 저장 시도 중...`);
    const { data, error } = await supabase
      .from("products")
      .upsert(product, { onConflict: "product_id" })
      .select();

    if (error) {
      logger.error(`상품 저장 오류 (ID: ${productId}):`, error);
      throw new Error(`상품 저장 중 오류 발생: ${error.message}`);
    }

    logger.info(`상품 정보 저장 완료: ${productId}`);
    logger.info(`저장된 상품 데이터:`, JSON.stringify(data[0], null, 2));
    return data[0];
  } catch (error) {
    logger.error(`게시물 ID: ${postData.postId} 처리 중 오류:`, error);
    throw error;
  }
};

/**
 * 여러 게시물에서 상품 정보를 추출하고 저장하는 함수
 * @param {Array} postsData - 크롤링한 게시물 데이터 배열
 * @param {string} userId - 사용자 ID
 * @returns {Promise<Object>} - 저장 결과 통계
 */
const processBulkProducts = async (postsData, userId) => {
  try {
    logger.info(`${postsData.length}개의 게시물에서 상품 정보 추출 시작`);

    // 유효한 사용자 ID 확인
    if (!userId) {
      throw new Error("사용자 ID가 제공되지 않았습니다.");
    }

    const results = {
      total: postsData.length,
      success: 0,
      failed: 0,
      products: [],
    };

    // 각 게시물에 대해 순차적으로 처리
    for (const postData of postsData) {
      try {
        // postId가 유효한지 확인
        if (!postData.postId) {
          throw new Error("게시물 ID가 정의되지 않았습니다.");
        }

        const product = await processAndSaveProduct(postData, userId);
        results.success++;
        results.products.push({
          id: product.product_id,
          title: product.title,
          price: product.price,
          status: "success",
        });
      } catch (error) {
        results.failed++;
        results.products.push({
          postId: postData.postId || "unknown",
          error: error.message,
          status: "failed",
        });
      }
    }

    logger.info(
      `상품 정보 처리 완료: 성공 ${results.success}개, 실패 ${results.failed}개`
    );
    return results;
  } catch (error) {
    logger.error("대량 상품 정보 처리 중 오류:", error);
    throw error;
  }
};

module.exports = {
  processAndSaveProduct,
  processBulkProducts,
};
