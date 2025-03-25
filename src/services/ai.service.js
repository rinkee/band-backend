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
 * @param {string|Date} postTime - 게시물 작성 시간 (선택적)
 * @returns {Promise<Object|Array>} - 추출된 상품 정보 또는 상품 정보 배열
 */
async function extractProductInfo(content, postTime = null) {
  try {
    if (!content || content.trim() === "") {
      logger.warn("빈 콘텐츠로 ChatGPT API 호출이 시도되었습니다.");
      return {
        title: "내용 없음",
        basePrice: 0,
        priceOptions: [],
        quantity: null,
        quantityText: null,
        category: "기타",
        status: "판매중",
        tags: [],
        features: [],
        pickupInfo: null,
        pickupDate: null,
        pickupType: null,
      };
    }

    logger.info("ChatGPT API 호출 시작");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "당신은 게시물 텍스트에서 상품 정보를 정확하게 추출하는 도우미입니다. 반드시 JSON 형식으로만 응답해야 합니다. 정보가 부족해도 최대한 추측하여 JSON 형식으로 응답하세요. 여러 상품이 있을 경우 모든 상품을 찾아내서 배열로 반환해야 합니다.",
        },
        {
          role: "user",
          content: `다음 텍스트에서 모든 상품 정보를 추출해주세요. 여러 상품이 있는 경우 모든 상품을 추출해주세요:
                  
텍스트: ${content}
게시물 작성 시간: ${postTime}
게시물 작성 시간과 픽업 정보를 비교해서 픽업 데이트 정보를 넣어주세요
다음 형식으로 JSON 응답을 제공해주세요. 다른 텍스트는 포함하지 마세요:

상품이 하나인 경우:
{
  "title": "상품명",
  "basePrice": 숫자(가장 낮은 가격, 원단위),
  "priceOptions": [
    {"quantity": 수량(숫자), "price": 가격(숫자), "description": "옵션설명"}
  ],
  "quantityText": "용량/개수 정보 (예: 400g, 10개입)",
  "quantity": 숫자(판매 단위 수량, 없으면 1),
  "category": "카테고리(식품/의류/생활용품/기타 중 선택)",
  "status": "판매중 또는 품절",
  "tags": ["관련태그1", "관련태그2"],
  "features": ["특징1", "특징2", "특징3"],
  "pickupInfo": "픽업 정보 (예: 내일화요일수령, 오늘월요일오후2시도착)",
  "pickupDate": "픽업 날짜 (예: 2025-03-25)",
  "pickupType": "픽업 유형 (예: 도착, 수령, 픽업, 전달)",
  "multipleProducts": false
}

여러 상품이 있는 경우(여러 번호로 구분된 상품들, 또는 여러 상품이 나열된 경우):
{
  "multipleProducts": true,
  "products": [
    {
      "title": "상품1명",
      "basePrice": 숫자,
      "priceOptions": [{"quantity": 수량, "price": 가격, "description": "설명"}],
      "quantityText": "용량 정보",
      "quantity": 수량,
      "category": "카테고리",
      "status": "판매중",
      "tags": ["태그1"],
      "features": ["특징1"],
      "pickupInfo": "픽업 정보",
      "pickupDate": "픽업 날짜",
      "pickupType": "픽업 유형"
    },
    {
      "title": "상품2명",
      "basePrice": 숫자,
      // ... 다른 상품2 정보
    },
    // ... 더 많은 상품들
  ],
  "commonPickupInfo": "모든 상품에 공통적인 픽업 정보",
  "commonPickupDate": "모든 상품에 공통적인 픽업 날짜",
  "commonPickupType": "모든 상품에 공통적인 픽업 유형"
}

상품이 여러 개인지 확인하려면 다음을 살펴보세요:
1. 번호로 구분된 항목들 (1️⃣, 2️⃣, 1), 2), 1., 2. 등)
2. 여러 가격이 다른 항목들이 나열된 경우
3. 여러 제품명이 명확하게 구분되는 경우
4. 게시물 내용에 "불발분"이라는 단어가 있으면 해당 게시물은 여러 상품을 포함할 가능성이 높습니다.

여러 가격 옵션이 있는 경우 모두 추출하세요(예: 1팩 2900원, 2팩 5000원).
상품 정보가 부족하더라도 반드시 위 형식의 JSON으로만 응답하세요.
가격이 없는 경우 0으로 설정하세요.
quantity는 반드시 숫자로만 설정하세요. 용량 정보는 quantityText에 문자열로 넣어주세요.
상품명이 없는 경우 텍스트에서 가장 관련성 높은 단어를 사용하세요.`,
        },
      ],
      temperature: 0.2, // 더 낮은 온도로 설정하여 일관된 형식 유도
      response_format: { type: "json_object" },
    });

    const contentText = response.choices[0].message.content;
    logger.info("ChatGPT API 원본 응답:");
    logger.info("=== API 응답 시작 ===");
    logger.info(contentText);
    logger.info("=== API 응답 끝 ===");

    try {
      // 응답이 JSON 형식인지 확인
      if (
        !contentText.trim().startsWith("{") ||
        !contentText.trim().endsWith("}")
      ) {
        logger.error("API 응답이 올바른 JSON 형식이 아닙니다:", contentText);
        throw new Error("API 응답이 올바른 JSON 형식이 아닙니다");
      }

      // JSON 문자열을 객체로 변환
      let result = JSON.parse(contentText);

      // 여러 상품이 있는지 확인
      if (
        result.multipleProducts &&
        Array.isArray(result.products) &&
        result.products.length > 0
      ) {
        logger.info(
          `여러 상품 감지: ${result.products.length}개의 상품이 추출되었습니다.`
        );

        // 각 상품에 공통 픽업 정보 적용
        const processedProducts = result.products.map((product) => {
          return processProduct(
            {
              ...product,
              pickupInfo: product.pickupInfo || result.commonPickupInfo || null,
              pickupDate: product.pickupDate || result.commonPickupDate || null,
              pickupType: product.pickupType || result.commonPickupType || null,
            },
            postTime
          );
        });

        // 여러 상품 정보 반환
        return {
          multipleProducts: true,
          products: processedProducts,
        };
      }

      // 단일 상품인 경우
      return processProduct(result, postTime);
    } catch (parseError) {
      logger.error("JSON 파싱 오류:", parseError);
      // 기본값 설정
      const defaultProduct = {
        title: "제목 추출 실패",
        basePrice: 0,
        priceOptions: [{ quantity: 1, price: 0, description: "기본가" }],
        quantity: 1,
        quantityText: null,
        category: "기타",
        status: "판매중",
        tags: [],
        features: [],
        pickupInfo: null,
        pickupDate: null,
        pickupType: null,
        multipleProducts: false,
      };

      logger.info(
        "파싱 오류로 기본값 사용:",
        JSON.stringify(defaultProduct, null, 2)
      );
      return defaultProduct;
    }
  } catch (error) {
    logger.error("OpenAI API 호출 중 오류 발생:", error);
    // 오류 발생시 기본값 반환
    return {
      title: "API 오류",
      basePrice: 0,
      priceOptions: [],
      quantity: 1,
      quantityText: null,
      category: "기타",
      status: "판매중",
      tags: [],
      features: [],
      pickupInfo: null,
      pickupDate: null,
      pickupType: null,
      multipleProducts: false,
    };
  }
}

/**
 * 단일 상품 정보를 처리하는 내부 함수
 * @param {Object} productInfo - 처리할 상품 정보
 * @param {string|Date} postTime - 게시물 작성 시간
 * @returns {Object} - 처리된 상품 정보
 */
function processProduct(productInfo, postTime) {
  // 필수 필드 검증 및 기본값 설정
  productInfo.title = productInfo.title || "제목 없음";
  productInfo.basePrice =
    typeof productInfo.basePrice === "number" ? productInfo.basePrice : 0;
  productInfo.priceOptions = Array.isArray(productInfo.priceOptions)
    ? productInfo.priceOptions
    : [];

  // 가격 옵션 데이터 타입 확인 및 변환
  productInfo.priceOptions = productInfo.priceOptions.map((option) => ({
    quantity: typeof option.quantity === "number" ? option.quantity : 1,
    price: typeof option.price === "number" ? option.price : 0,
    description: option.description || "기본",
  }));

  // 가격 옵션이 없는 경우 기본 가격으로 옵션 생성
  if (productInfo.priceOptions.length === 0 && productInfo.basePrice > 0) {
    productInfo.priceOptions = [
      { quantity: 1, price: productInfo.basePrice, description: "기본가" },
    ];
  }

  // 수량 정보 처리
  productInfo.quantityText = productInfo.quantityText || null;
  productInfo.quantity =
    typeof productInfo.quantity === "number" ? productInfo.quantity : 1;

  productInfo.category = productInfo.category || "기타";
  productInfo.status = productInfo.status || "판매중";
  productInfo.tags = Array.isArray(productInfo.tags) ? productInfo.tags : [];
  productInfo.features = Array.isArray(productInfo.features)
    ? productInfo.features
    : [];

  // 픽업 정보 처리 - pickupDate가 이미 유효한 ISO 문자열인 경우 변환 생략
  if (
    productInfo.pickupDate &&
    typeof productInfo.pickupDate === "string" &&
    productInfo.pickupDate.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  ) {
    logger.info(`유효한 ISO 날짜 문자열 확인됨: ${productInfo.pickupDate}`);
  } else if (
    productInfo.pickupDate &&
    typeof productInfo.pickupDate === "string" &&
    productInfo.pickupDate.trim() !== ""
  ) {
    try {
      // YYYY-MM-DD 형식인 경우 시간 추가
      if (productInfo.pickupDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
        productInfo.pickupDate = `${productInfo.pickupDate}T12:00:00.000Z`;
      } else {
        // 다른 형식이면 pickupInfo를 사용하여 추출
        const pickupDateInfo = extractPickupDate(
          productInfo.pickupInfo || productInfo.pickupDate,
          postTime
        );
        productInfo.pickupDate = pickupDateInfo.date;
        productInfo.pickupType = pickupDateInfo.type || productInfo.pickupType;
      }
    } catch (error) {
      logger.error(`pickupDate 변환 오류: ${error.message}`);
      // 오류 발생 시 내일 날짜로 설정
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(12, 0, 0, 0);
      productInfo.pickupDate = tomorrow.toISOString();
    }
  } else if (productInfo.pickupInfo) {
    try {
      const pickupDateInfo = extractPickupDate(
        productInfo.pickupInfo,
        postTime
      );
      productInfo.pickupDate = pickupDateInfo.date;
      productInfo.pickupType = pickupDateInfo.type;
    } catch (error) {
      logger.error(`pickupInfo 처리 오류: ${error.message}`);
      productInfo.pickupDate = null;
      productInfo.pickupType = null;
    }
  }

  return productInfo;
}

/**
 * 텍스트에서 픽업 날짜 정보를 추출하는 함수
 * @param {string} text - 픽업 정보가 포함된 텍스트
 * @param {string|Date} postTime - 게시물 작성 시간 (선택적)
 * @returns {Object} - 추출된 날짜 정보
 */
function extractPickupDate(text, postTime = null) {
  if (!text) return { date: null, type: null, original: null };

  try {
    // 게시물 작성 시간 확인 (기준 날짜로 사용)
    let baseDate = postTime ? new Date(postTime) : new Date();

    // 날짜가 정상적으로 변환되지 않으면 현재 날짜 사용
    if (isNaN(baseDate.getTime())) {
      logger.warn(
        `유효하지 않은 postTime: ${postTime}, 현재 시간을 사용합니다.`
      );
      baseDate = new Date();
    }

    // 픽업/수령 관련 키워드
    const pickupKeywords = ["도착", "배송", "수령", "픽업", "전달"];

    // 요일 매핑 테이블
    const dayMapping = {
      월: 1,
      화: 2,
      수: 3,
      목: 4,
      금: 5,
      토: 6,
      일: 0,
      월요일: 1,
      화요일: 2,
      수요일: 3,
      목요일: 4,
      금요일: 5,
      토요일: 6,
      일요일: 0,
    };

    // 시간 정보 정규식
    const timeRegex = /(\d{1,2})시(\d{1,2}분)?/;

    // 날짜 관련 패턴
    // 예: "오늘월요일오후2시도착", "내일화요일도착입니다", "내일화요일수령입니다"
    const today = new Date(baseDate);
    today.setHours(0, 0, 0, 0); // 시간 초기화

    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const patterns = [
      // 오늘 + 요일 패턴
      { regex: /오늘\s*([월화수목금토일])(요일)?/i, dayOffset: 0 },
      // 내일 + 요일 패턴
      { regex: /내일\s*([월화수목금토일])(요일)?/i, dayOffset: 1 },
      // 모레 + 요일 패턴
      { regex: /모레\s*([월화수목금토일])(요일)?/i, dayOffset: 2 },
      // 다음주 + 요일 패턴
      { regex: /다음주\s*([월화수목금토일])(요일)?/i, dayOffset: 7 },
      // n월 m일 패턴
      { regex: /(\d{1,2})월\s*(\d{1,2})일/, isFullDate: true },
      // m일 패턴 (당월 가정)
      { regex: /(\d{1,2})일/, isDateOnly: true },
    ];

    let pickupDate = null;
    let pickupType = null;
    let originalText = null;

    // 픽업 정보에 날짜 형식 문자열("2025-03-25" 등)이 있는지 확인
    const dateStringMatch = text.match(/\d{4}-\d{2}-\d{2}/);
    if (dateStringMatch) {
      try {
        const dateStr = dateStringMatch[0];
        // 유효한 날짜 문자열 확인 (YYYY-MM-DD)
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          const tempDate = new Date(`${dateStr}T12:00:00Z`);

          // 유효한 날짜인지 확인
          if (!isNaN(tempDate.getTime())) {
            pickupDate = tempDate;
            originalText = text;

            // 픽업 유형 찾기
            for (const keyword of pickupKeywords) {
              if (text.includes(keyword)) {
                pickupType = keyword;
                break;
              }
            }

            return {
              date: pickupDate.toISOString(),
              type: pickupType || "수령",
              original: originalText,
            };
          }
        }
      } catch (e) {
        logger.error(`날짜 파싱 오류: ${e.message}`);
        // 오류 발생 시 다음 단계로 진행
      }
    }

    // "내일", "모레" 같은 키워드 확인
    if (text.includes("내일")) {
      pickupDate = new Date(tomorrow);
    } else if (text.includes("모레")) {
      const moreDt = new Date(today);
      moreDt.setDate(today.getDate() + 2);
      pickupDate = moreDt;
    } else if (text.includes("오늘")) {
      pickupDate = new Date(today);
    }

    // 픽업/수령 관련 문장 추출
    const lines = text.split(/[\.。\n]/);
    for (const line of lines) {
      // 픽업 키워드가 포함된 문장 찾기
      const hasPickupKeyword = pickupKeywords.some((keyword) =>
        line.includes(keyword)
      );
      if (!hasPickupKeyword) continue;

      originalText = line.trim();

      // 픽업 유형 추출
      for (const keyword of pickupKeywords) {
        if (line.includes(keyword)) {
          pickupType = keyword;
          break;
        }
      }

      // 이미 내일/모레 등으로 날짜가 설정된 경우 패턴 매칭은 건너뜀
      if (pickupDate) continue;

      // 패턴 매칭을 통한 날짜 추출
      for (const pattern of patterns) {
        const match = line.match(pattern.regex);
        if (!match) continue;

        if (pattern.isFullDate) {
          // n월 m일 형식
          const month = parseInt(match[1], 10) - 1; // JavaScript 월은 0-11
          const day = parseInt(match[2], 10);
          try {
            pickupDate = new Date(today.getFullYear(), month, day);

            // 이미 지난 날짜인 경우 내년으로 설정
            if (pickupDate < today) {
              pickupDate.setFullYear(today.getFullYear() + 1);
            }
          } catch (e) {
            logger.error(`날짜 생성 오류 (n월 m일): ${e.message}`);
            continue;
          }
        } else if (pattern.isDateOnly) {
          // m일 형식 (당월 가정)
          const day = parseInt(match[1], 10);
          try {
            pickupDate = new Date(today.getFullYear(), today.getMonth(), day);

            // 이미 지난 날짜인 경우 다음 달로 설정
            if (pickupDate < today) {
              pickupDate.setMonth(today.getMonth() + 1);
            }
          } catch (e) {
            logger.error(`날짜 생성 오류 (m일): ${e.message}`);
            continue;
          }
        } else {
          // 오늘/내일/모레 + 요일 형식
          const dayOfWeek = dayMapping[match[1]];

          if (dayOfWeek !== undefined) {
            // 기준일 설정 (오늘, 내일, 모레, 다음주)
            const baseDateTemp = new Date(today);
            baseDateTemp.setDate(today.getDate() + pattern.dayOffset);

            try {
              // 요일 맞추기
              const currentDay = baseDateTemp.getDay();
              const daysUntilTargetDay = (dayOfWeek - currentDay + 7) % 7;

              pickupDate = new Date(baseDateTemp);
              pickupDate.setDate(baseDateTemp.getDate() + daysUntilTargetDay);
            } catch (e) {
              logger.error(`날짜 계산 오류: ${e.message}`);
              continue;
            }
          }
        }

        if (pickupDate) break;
      }

      // 시간 정보 추출
      if (pickupDate) {
        const timeMatch = line.match(timeRegex);
        if (timeMatch) {
          try {
            const hour = parseInt(timeMatch[1], 10);
            const minute = timeMatch[2]
              ? parseInt(timeMatch[2].replace("분", ""), 10)
              : 0;

            // 오전/오후 구분
            let adjustedHour = hour;
            if (line.includes("오후") && hour < 12) {
              adjustedHour = hour + 12;
            } else if (line.includes("오전") && hour === 12) {
              adjustedHour = 0;
            }

            pickupDate.setHours(adjustedHour, minute, 0, 0);
          } catch (e) {
            logger.error(`시간 설정 오류: ${e.message}`);
            // 오류 발생 시 기본 시간 유지
          }
        } else {
          // 시간이 명시되지 않은 경우 기본값 설정
          pickupDate.setHours(12, 0, 0, 0);
        }
      }

      if (pickupDate) break;
    }

    // 미정 텍스트가 있거나 날짜 추출 실패 시 내일 정오로 설정
    if (text.includes("미정") || !pickupDate) {
      pickupDate = new Date(tomorrow);
      pickupDate.setHours(12, 0, 0, 0);
    }

    // 픽업 타입이 없는 경우 기본값 설정
    if (!pickupType) {
      if (text.includes("도착")) {
        pickupType = "도착";
      } else if (text.includes("수령")) {
        pickupType = "수령";
      } else if (text.includes("픽업")) {
        pickupType = "픽업";
      } else {
        pickupType = "수령";
      }
    }

    // 최종 결과 반환 전 유효한 날짜인지 확인
    if (pickupDate && !isNaN(pickupDate.getTime())) {
      return {
        date: pickupDate.toISOString(),
        type: pickupType,
        original: originalText || text,
      };
    } else {
      // 유효하지 않은 날짜면 내일로 설정
      const defaultDate = new Date(tomorrow);
      defaultDate.setHours(12, 0, 0, 0);
      return {
        date: defaultDate.toISOString(),
        type: pickupType,
        original: originalText || text,
      };
    }
  } catch (error) {
    // 전체 함수에 try-catch 추가하여 어떤 오류가 발생해도 기본값 반환
    logger.error(`extractPickupDate 오류: ${error.message}`);
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 1);
    defaultDate.setHours(12, 0, 0, 0);

    return {
      date: defaultDate.toISOString(),
      type: "수령",
      original: text,
    };
  }
}

module.exports = {
  extractProductInfo,
  extractPickupDate,
};
