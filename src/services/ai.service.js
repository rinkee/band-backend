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
 * saveDetailPostsSupabase에서 사용중
 * @param {string} content - 크롤링한 게시물 내용
 * @param {string|Date} postTime - 게시물 작성 시간 (선택적)
 * @returns {Promise<Object|Array>} - 추출된 상품 정보 또는 상품 정보 배열
 */
async function extractProductInfo(
  content,
  postTime = null,
  bandNumber,
  postId
) {
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
당신은 게시물 텍스트에서 상품 정보를 정확하게 추출하는 도우미입니다. 반드시 JSON 형식으로만 응답해야 하며, 그 외 텍스트는 절대 포함하지 마세요.

※ 상품 정보 추출 핵심 규칙:

1.  basePrice 필드:
    *   반드시 고객이 실제로 구매할 수 있는 가장 낮은 '판매 가격'이어야 합니다.
    *   원가, 정상가, 시중가, 마트/편의점 가격 등 참고용 가격은 절대 basePrice에 넣지 마세요.
    *   만약 여러 판매 가격 옵션이 있다면 (priceOptions 참고), 그중 가장 낮은 가격을 basePrice로 설정해야 합니다.
    *   텍스트에 판매 가격이 단 하나만 명시된 경우, 그 가격이 basePrice가 됩니다.
    *   유효한 판매 가격 정보가 전혀 없으면 0으로 설정하세요.

2.  priceOptions 배열:
    *   고객이 선택할 수 있는 모든 유효한 '판매 가격 옵션'을 포함해야 합니다.
    *   수량 (1개, 2개), 포장 단위 (1팩, 1박스), 중량 (500g, 1kg) 등에 따라 가격이 달라지는 경우, 각 옵션을 { "quantity": 숫자, "price": 숫자, "description": "옵션 설명" } 형식으로 배열에 넣으세요.
    *   basePrice로 설정된 가격도 priceOptions 배열 안에 반드시 포함되어야 합니다. (일반적으로 quantity가 1인 옵션 또는 가장 낮은 가격의 옵션)
    *   텍스트에 판매 가격이 단 하나만 명시된 경우, 해당 가격 정보를 포함하는 옵션 객체 하나만 이 배열에 넣으세요. (예: [{ "quantity": 1, "price": 10000, "description": "기본" }])
    *   참고용 가격(원가, 시중가 등)은 절대 이 배열에 포함시키지 마세요.

3.  단일 상품 vs. 여러 상품:
    *   게시물에 명확히 다른 상품(예: 사과, 배)이나 동일 품목이라도 종류/색상(빨간 파프리카, 노란 파프리카)이 다른 상품이 여러 개 있으면 multipleProducts를 true로 설정하고, 각 상품 정보를 products 배열에 담으세요.
    *   동일 상품에 대한 수량/단위별 가격 차이는 여러 상품이 아니라, 단일 상품의 priceOptions로 처리해야 합니다. 이 경우 multipleProducts는 false입니다.

4.  기타 필드:
    *   title: 상품의 핵심 명칭 (수량/단위 제외 권장. 예: "아보카도", "씨앗젓갈")
    *   quantity: 판매의 기본 단위 수량 (예: "2개 묶음" 상품이면 1, 낱개 상품이면 1)
    *   quantityText: 판매 단위를 설명하는 텍스트 (예: "1팩(600g)", "2개 묶음")
    *   productId: prod_bandNumber_postId_itemNumber 형식으로 생성. itemNumber는 게시물 본문에 명시된 상품 번호(1번, 2번...) 또는 순서대로 부여. 여러 상품일 경우 각 상품 객체 내에 포함.
    *   category: 상품 분류 (예: "식품", "의류", "생활용품", "기타" 등)
    *   status: 판매 상태 (예: "판매중", "품절", "예약중", "마감" 등)
    *   tags: 상품 관련 키워드 배열 (예: ["#특가", "#국내산", "#당일배송"])
    *   features: 상품의 주요 특징 배열 (예: ["유기농 인증", "무료 배송"])
    *   pickupInfo: 픽업/배송 관련 안내 문구 (예: "내일 오후 2시 일괄 배송")
    *   pickupDate: "내일", "5월 10일", "다음주 화요일" 등의 정보를 게시물 작성 시간 기준으로 해석하여 YYYY-MM-DD 또는 YYYY-MM-DDTHH:mm:ss.sssZ 형식으로 설정.
    *   pickupType: 픽업/배송 방식 (예: "도착", "수령", "픽업", "배송", "전달")
    *   stockQuantity: 재고 수량 (숫자). "5개 남음" 등 명확한 숫자가 있으면 해당 숫자를 추출하고, "한정 수량", "재고 문의" 등 숫자 정보가 없으면 null 반환. 추출 불가능하면 null.

※ 출력 형식:

# 여러 상품일 경우 (multipleProducts: true):
{
  "multipleProducts": true,
  "products": [
    {
      "productId": "prod_...", // 형식 준수
      "itemNumber": 1,
      "title": "상품명1",
      "basePrice": 숫자, // 상품1의 가장 낮은 판매 가격
      "priceOptions": [ /* 상품1의 판매 가격 옵션 */ ],
      "quantityText": "상품1 단위 설명",
      "quantity": 숫자,
      "category": "분류",
      "status": "상태",
      "tags": ["태그배열"],
      "features": ["특징배열"],
      "pickupInfo": "픽업/배송 정보",
      "pickupDate": "날짜",
      "pickupType": "방식",
      "stockQuantity": 숫자 또는 null // 재고 수량 추가
    },
    {
      "productId": "prod_...", // 형식 준수
      "itemNumber": 2,
      "title": "상품명2",
      "basePrice": 숫자, // 상품2의 가장 낮은 판매 가격
      "priceOptions": [ /* 상품2의 판매 가격 옵션 */ ],
      "quantityText": "상품2 단위 설명",
      "quantity": 숫자,
      "category": "분류",
      "status": "상태",
      "tags": ["태그배열"],
      "features": ["특징배열"],
      "pickupInfo": "픽업/배송 정보",
      "pickupDate": "날짜",
      "pickupType": "방식",
      "stockQuantity": 숫자 또는 null // 재고 수량 추가
    }
  ]
}

# 단일 상품일 경우 (multipleProducts: false):
{
  "multipleProducts": false,
  "productId": "prod_...", // 형식 준수
  "itemNumber": 1, // 또는 해당 상품 번호
  "title": "상품명",
  "basePrice": 숫자, // 유일하거나 가장 낮은 판매 가격
  "priceOptions": [
    // 판매 가격 옵션들 (최소 1개 이상, basePrice 값 포함)
    { "quantity": 1, "price": 10000, "description": "기본" },
    { "quantity": 2, "price": 18000, "description": "2개 구매 시" }
  ],
  "quantityText": "단위 설명",
  "quantity": 숫자,
  "category": "분류",
  "status": "상태",
  "tags": ["태그배열"],
  "features": ["특징배열"],
  "pickupInfo": "픽업/배송 정보",
  "pickupDate": "날짜",
  "pickupType": "방식",
  "stockQuantity": 숫자 또는 null // 재고 수량 추가
}
      `.trim(),
        },
        {
          role: "user",
          content: `다음 텍스트에서 상품 정보를 추출해주세요:

텍스트: ${content}
게시물 작성 시간: ${postTime}

밴드아이디: ${bandNumber},
포스트아이디: ${postId}
`.trim(),
        },
      ],
      temperature: 0.3,
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

      // 기존 코드: productName -> title 변환
      if (result.productName && !result.title)
        result.title = result.productName;

      // 여러 상품 처리
      if (
        result.multipleProducts &&
        Array.isArray(result.products) &&
        result.products.length > 0
      ) {
        // 여러 상품 처리

        const mergedProduct = detectAndMergeQuantityBasedProducts(
          result.products
        );

        // 통합된 상품이 있으면 사용
        if (mergedProduct) {
          logger.info("수량 기반 상품들을 하나의 상품으로 통합했습니다.");
          return processProduct(mergedProduct, postTime);
        }

        logger.info(
          `여러 상품 감지: ${result.products.length}개의 상품이 추출되었습니다.`
        );

        // 여기가 핵심 수정 부분: products 배열에 하나의 상품만 있으면 단일 상품으로 처리
        if (result.products.length === 1) {
          logger.info(
            "multipleProducts가 true로 설정되었지만 실제 상품은 1개입니다. 단일 상품으로 처리합니다."
          );

          // 단일 상품으로 변환하여 반환 (내부 multipleProducts 필드 제거)
          const singleProduct = result.products[0];

          // 상품 객체에서 multipleProducts 필드 제거 (혼란 방지)
          const { multipleProducts: _unused, ...cleanProduct } = singleProduct;

          return processProduct(
            {
              ...cleanProduct,
              pickupInfo:
                cleanProduct.pickupInfo || result.commonPickupInfo || null,
              pickupDate:
                cleanProduct.pickupDate || result.commonPickupDate || null,
              pickupType:
                cleanProduct.pickupType || result.commonPickupType || null,
              // multipleProducts 필드 제거됨 - 단일 상품이므로 false로 처리됨
            },
            postTime
          );
        }

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

  // multipleProducts 속성 삭제 (중복 및 혼란 방지)
  // 단일 상품은 항상 multipleProducts가 false
  if (productInfo.multipleProducts !== undefined) {
    delete productInfo.multipleProducts;
  }

  // 최상위 레벨에서 여러 상품을 표현하기 위한 multipleProducts는 제외

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

/**
 * 수량 기반으로 여러 상품으로 잘못 인식된 케이스를 감지하고 통합하는 함수
 * @param {Array} products - 상품 목록
 * @returns {Object|null} - 통합된 상품 또는 통합 불가 시 null
 */
function detectAndMergeQuantityBasedProducts(products) {
  // 최소 2개 이상의 상품이 있어야 함
  if (!products || products.length < 2) return null;

  // 모든 상품 제목에서 수량 패턴 추출
  const titlePatterns = products.map((product) => {
    // 제목에서 수량 패턴 추출 (예: "아보카도 1알", "아보카도 2알")
    const match = product.title.match(
      /^(.*?)(?:\s+(\d+)\s*([알개봉팩세트박스통]+))?$/
    );
    if (!match) return null;

    const [_, baseName, quantity, unit] = match;
    return {
      product,
      baseName: baseName.trim(),
      quantity: quantity ? parseInt(quantity) : 1,
      unit: unit || "",
    };
  });

  // 수량 패턴이 없는 상품이 있으면 통합 불가
  if (titlePatterns.some((pattern) => pattern === null)) return null;

  // 기본 이름이 모두 같은지 확인 (대소문자, 앞뒤 공백 무시)
  const baseNames = new Set(
    titlePatterns.map((p) => p.baseName.toLowerCase().trim())
  );
  if (baseNames.size !== 1) return null;

  // 단위가 모두 같거나 비슷한지 확인
  const units = new Set(titlePatterns.map((p) => p.unit.toLowerCase().trim()));
  const similarUnits = [
    "개",
    "알",
    "과",
    "낱개",
    "각",
    "봉",
    "봉지",
    "팩",
    "통",
  ];
  const isSimilarUnits = Array.from(units).every(
    (unit) => similarUnits.includes(unit) || unit === ""
  );

  if (units.size > 2 && !isSimilarUnits) return null;

  // 모든 조건 만족 시 통합된 상품 생성
  const baseName = titlePatterns[0].baseName;
  const unit = Array.from(units)[0] || titlePatterns[0].unit;

  // 통합된 priceOptions 생성
  const priceOptions = titlePatterns.map((pattern) => ({
    quantity: pattern.quantity,
    price: pattern.product.basePrice,
    description: `${pattern.quantity}${unit}`,
  }));

  // 가격 옵션을 수량 순으로 정렬
  priceOptions.sort((a, b) => a.quantity - b.quantity);

  // 통합된 상품 생성
  const mergedProduct = {
    title: baseName, // "아보카도"와 같이 기본 이름만 사용
    basePrice: priceOptions[0].price, // 가장 작은 수량의 가격을 기본 가격으로
    priceOptions, // 통합된 가격 옵션
    // 첫 번째 상품의 다른 속성들 복사
    quantity: 1,
    quantityText: titlePatterns[0].product.quantityText || null,
    category: titlePatterns[0].product.category || "기타",
    status: titlePatterns[0].product.status || "판매중",
    tags: titlePatterns[0].product.tags || [],
    features: titlePatterns[0].product.features || [],
    pickupInfo: titlePatterns[0].product.pickupInfo || null,
    pickupDate: titlePatterns[0].product.pickupDate || null,
    pickupType: titlePatterns[0].product.pickupType || null,
  };

  logger.info(
    `수량 기반으로 ${products.length}개 상품이 1개 상품으로 통합되었습니다: ${baseName}`
  );
  logger.info(`통합된 가격 옵션: ${JSON.stringify(priceOptions)}`);

  return mergedProduct;
}

module.exports = {
  extractProductInfo,
  extractPickupDate,
};
