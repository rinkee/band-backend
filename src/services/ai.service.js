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
      return getDefaultProduct("내용 없음");
    }

    const hasPrice = /[0-9]+[,0-9]*\s*(원|만원|천원|\$|€|¥|￦|달러)/.test(
      content
    );
    if (!hasPrice) {
      logger.info("가격 정보가 없어 상품이 아닌 것으로 판단됩니다.");
      return getDefaultProduct("상품 정보 없음");
    }

    logger.info("ChatGPT API 호출 시작");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
당신은 게시물 텍스트에서 상품 정보를 정확하게 추출하는 도우미입니다. 반드시 JSON 형식으로만 응답해야 하며, 동일 상품에 다양한 가격이 존재할 경우 priceOptions에 담고, multipleProducts는 false로 설정해야 합니다. 여러 상품이 있을 경우 모든 상품을 찾아내서 배열로 반환해야 합니다.
      

※ 아래 조건을 반드시 따르세요:

1. 서로 다른 품목(예: 방풍나물, 파프리카 등)이 함께 있을 경우:
   - multipleProducts는 true로 설정합니다.
   - products 배열 안에 각각의 상품을 JSON 객체로 넣습니다.
   - 각 상품은 아래 구조를 따릅니다.
   - 단, products 배열 안의 각 상품은 multipleProducts를 false로 유지합니다.

2. 같은 품목이 다양한 가격/옵션으로 나올 경우:
   - multipleProducts는 false로 설정합니다.
   - priceOptions 배열에 옵션을 추가합니다.


3. 실제 밴드에서 고객이 구매 가능한 판매 가격만 추출하세요. 
   - 예: "1세트 4,900원", "2세트 9,500원" → O
   - 예: "편의점 판매가 3,200원" → X (참고용 정가, 제외)

4. 광고 문구나 비교를 위한 참고 가격(GS편의점, 마트 가격 등)은 priceOptions에 넣지 마세요.

5. 판매 단위가 명확하면 quantity는 항상 1로 지정하고, 구성품 정보는 quantityText로 작성하세요.
   - 예: "10봉 1세트" → quantity: 1, quantityText: "10봉묶음"

6. 여러 가격이 같은 상품의 옵션일 경우 priceOptions에 배열로 포함하고, multipleProducts는 false로 유지합니다.

7. 다른 품목이면 multipleProducts는 true로 설정하고 각각 개별 객체로 배열 반환하세요.

8. 응답은 반드시 JSON 형식만 반환하고, 그 외 텍스트는 포함하지 마세요.

9. 가격이 없으면 basePrice는 0, quantity는 1로 설정하세요.

10. pickupDate는 "내일", "오늘" 등 키워드를 보고 게시일 기준으로 추정하세요.
      `.trim(),
        },
        {
          role: "user",
          content: `다음 텍스트에서 상품 정보를 추출해주세요:

텍스트: ${content}
게시물 작성 시간: ${postTime}

출력 형식:
{
  "multipleProducts": true,
  "products": [
  {
    "title": "상품명",
    "basePrice": 숫자,
    "priceOptions": [
      { "quantity": 수량(숫자), "price": 가격(숫자), "description": "옵션 설명" }
    ],
    "quantityText": "10봉묶음 또는 1팩, 300g 등",
    "quantity": 판매단위 수량 (예: 1세트면 1),
    "category": "식품/의류/생활용품/기타",
    "status": "판매중 또는 품절",
    "tags": ["태그1", "태그2"],
    "features": ["특징1", "특징2"],
    "pickupInfo": "내일 도착 등",
    "pickupDate": "2025-03-27",
    "pickupType": "도착, 수령, 픽업, 전달 등",
    "multipleProducts": false
  }
  ]
}`,
        },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const contentText = response.choices[0].message.content;
    logger.info("ChatGPT API 원본 응답:");
    logger.info("=== API 응답 시작 ===");
    logger.info(contentText);
    logger.info("=== API 응답 끝 ===");

    try {
      if (
        !contentText.trim().startsWith("{") ||
        !contentText.trim().endsWith("}")
      ) {
        throw new Error("API 응답이 올바른 JSON 형식이 아닙니다");
      }

      const result = JSON.parse(contentText);

      // 👇 여기를 추가!
      if (result.productName && !result.title)
        result.title = result.productName;

      if (
        result.multipleProducts &&
        Array.isArray(result.products) &&
        result.products.length > 0
      ) {
        logger.info(
          `여러 상품 감지: ${result.products.length}개의 상품이 추출되었습니다.`
        );
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
        return {
          multipleProducts: true,
          products: processedProducts,
        };
      }

      return processProduct(result, postTime);
    } catch (parseError) {
      logger.error("JSON 파싱 오류:", parseError);
      return getDefaultProduct("제목 추출 실패");
    }
  } catch (error) {
    logger.error("OpenAI API 호출 중 오류 발생:", error);
    return getDefaultProduct("API 오류");
  }
}

function getDefaultProduct(title = "제목 없음") {
  return {
    title,
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
