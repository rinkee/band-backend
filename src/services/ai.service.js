// src/services/ai.service.js
const { OpenAI } = require("openai");
const dotenv = require("dotenv");
const logger = require("../config/logger");

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * 텍스트에서 상품 정보를 추출하는 함수
 * @param {string} content - 크롤링한 게시물 내용
 * @returns {Promise<Object>} - 추출된 상품 정보
 */
async function extractProductInfo(content) {
  try {
    if (!content || content.trim() === "") {
      logger.warn("빈 콘텐츠로 ChatGPT API 호출이 시도되었습니다.");
      return {
        title: "내용 없음",
        price: 0,
        category: "기타",
        status: "판매중",
        tags: [],
      };
    }

    logger.info("ChatGPT API 호출 시작");

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "당신은 게시물 텍스트에서 상품 정보를 정확하게 추출하는 도우미입니다. 반드시 JSON 형식으로만 응답해야 합니다. 정보가 부족해도 최대한 추측하여 JSON 형식으로 응답하세요.",
        },
        {
          role: "user",
          content: `다음 텍스트에서 상품 정보를 추출해주세요:
                  
텍스트: ${content}

다음 정보를 추출하여 JSON 형식으로만 응답해주세요. 다른 텍스트는 포함하지 마세요:
{
  "title": "상품명",
  "price": 숫자(원),
  "category": "카테고리(식품/의류/생활용품/기타 중 선택)",
  "status": "판매중 또는 품절",
  "tags": ["관련태그1", "관련태그2"]
}

상품 정보가 부족하더라도 반드시 위 형식의 JSON으로만 응답하세요. 
가격이 없는 경우 0으로 설정하세요. 
상품명이 없는 경우 텍스트에서 가장 관련성 높은 단어를 사용하세요.
상품 정보가 전혀 없는 경우에도 기본값으로 {"title": "제목 없음", "price": 0, "category": "기타", "status": "판매중", "tags": []} 으로 응답하세요.`,
        },
      ],
      temperature: 0.2, // 더 낮은 온도로 설정하여 일관된 형식 유도
    });

    const contentText = response.choices[0].message.content;
    logger.info("ChatGPT API 원본 응답:");
    logger.info("=== API 응답 시작 ===");
    logger.info(contentText);
    logger.info("=== API 응답 끝 ===");

    // JSON 문자열을 객체로 변환
    let productInfo;
    try {
      // JSON 형식으로 응답이 오지 않았을 경우를 대비해 정규식으로 JSON 부분 추출
      const jsonMatch = contentText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        productInfo = JSON.parse(jsonMatch[0]);
        logger.info(
          "추출된 JSON 데이터:",
          JSON.stringify(productInfo, null, 2)
        );
      } else {
        logger.warn("JSON 형식 응답을 찾을 수 없습니다. 기본값 사용");
        throw new Error("JSON 형식 응답을 찾을 수 없습니다");
      }

      // 필수 필드 검증 및 기본값 설정
      productInfo.title = productInfo.title || "제목 없음";
      productInfo.price =
        typeof productInfo.price === "number" ? productInfo.price : 0;
      productInfo.category = productInfo.category || "기타";
      productInfo.status = productInfo.status || "판매중";
      productInfo.tags = Array.isArray(productInfo.tags)
        ? productInfo.tags
        : [];

      logger.info("가공 완료된 데이터:", JSON.stringify(productInfo, null, 2));
    } catch (parseError) {
      logger.error("JSON 파싱 오류:", parseError);
      // 기본값 설정
      productInfo = {
        title: "제목 추출 실패",
        price: 0,
        category: "기타",
        status: "판매중",
        tags: [],
      };
    }

    return productInfo;
  } catch (error) {
    logger.error("OpenAI API 호출 중 오류 발생:", error);
    // 오류 발생시 기본값 반환
    return {
      title: "API 오류",
      price: 0,
      category: "기타",
      status: "판매중",
      tags: [],
    };
  }
}

module.exports = {
  extractProductInfo,
};
