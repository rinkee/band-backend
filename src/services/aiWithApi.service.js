// src/services/ai.service.js
const { OpenAI } = require("openai");
const dotenv = require("dotenv");
const logger = require("../config/logger");
const { GoogleGenerativeAI } = require("@google/generative-ai"); // Import Gemini SDK

dotenv.config();

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY); // Use your Gemini API key env variable
const geminiModel = genAI.getGenerativeModel({
  model: "gemini-2.0-flash-lite", // Specify Gemini model
  // Configure for JSON output and temperature
  generationConfig: {
    responseMimeType: "application/json", // Crucial for enforcing JSON output
    temperature: 0.3, // Set temperature
  },
});

/**
 * 텍스트에서 상품 정보를 추출하는 함수 (Gemini 버전)
 * saveDetailPostsSupabase에서 사용중
 * @param {string} content - 크롤링한 게시물 내용
 * @param {string|Date} postTime - 게시물 작성 시간 (선택적)
 * @param {string} bandNumber - 밴드 번호

 * @returns {Promise<Object|Array>} - 추출된 상품 정보 또는 상품 정보 배열
 */
async function extractProductInfo(content, postTime = null, postKey) {
  // <<<--- 재시도 관련 설정 --- START --->>>
  const MAX_RETRIES = 2; // 최대 재시도 횟수 (총 3번 시도: 기본 1 + 재시도 2)
  const RETRY_DELAY_MS = 1000; // 재시도 간 지연 시간 (1초)
  // <<<--- 재시도 관련 설정 --- END --->>>

  let retries = 0; // 현재 재시도 횟수

  while (retries < MAX_RETRIES) {
    try {
      if (!content || content.trim() === "") {
        logger.warn("빈 콘텐츠로 Gemini API 호출이 시도되었습니다.");
        return getDefaultProduct("내용 없음");
      }

      logger.info("Gemini API 호출 시작");

      // --- Combine System and User instructions into a single prompt for Gemini ---
      const systemInstructions = `
당신은 게시물 텍스트에서 상품 정보를 정확하게 추출하는 도우미입니다. 반드시 JSON 형식으로만 응답해야 하며, 그 외 텍스트는 절대 포함하지 마세요.
※ 상품 정보 추출 핵심 규칙:
basePrice 필드:
반드시 고객이 실제로 구매할 수 있는 가장 낮은 '판매 가격'이어야 합니다. (일반적으로 가장 기본 단위 옵션의 가격)
원가, 정상가, 시중가, 마트/편의점 가격 등 참고용 가격은 절대 basePrice에 넣지 마세요.
🔥동일 단위/수량에 대한 가격 처리: 만약 동일한 판매 단위 (예: '1통', '1개')에 대해 여러 가격이 연달아 또는 근접하게 표시되면 (예: 1통 13,900원 -> 10,900원 또는 게시글 예시처럼 1통 13,900원 바로 아래 1통 10,900원), 일반적으로 가장 마지막에 언급되거나, 명시적으로 '할인가', '판매가'로 표시되거나, 가장 낮은 가격이 실제 판매 가격일 가능성이 높습니다. 이 가격을 basePrice 및 priceOptions 포함 대상으로 고려하세요. 그 외 동일 단위에 대한 다른 가격들은 '원가', '정상가', '시중가' 등으로 간주하여 basePrice 및 priceOptions에서 반드시 제외해야 합니다.
만약 여러 유효한 판매 가격 옵션이 있다면 (priceOptions 참고), 그중 가장 기본 단위(보통 quantity가 1인 옵션)의 판매 가격을 basePrice로 설정하는 것을 권장합니다. 만약 quantity: 1 옵션이 없다면, 유효한 옵션 중 가장 낮은 가격을 basePrice로 설정하세요.
텍스트에 유효한 판매 가격이 단 하나만 명시된 경우, 그 가격이 basePrice가 됩니다.
유효한 판매 가격 정보가 전혀 없으면 0으로 설정하세요.
priceOptions 배열:
고객이 실제로 선택하여 구매할 수 있는 모든 유효한 '판매 가격 옵션'만 포함해야 합니다.
각 옵션은 { "quantity": 숫자, "price": 숫자, "description": "옵션 설명" } 형식으로 배열에 넣으세요.
🔥 quantity 필드: 이 필드는 고객이 해당 가격 옵션을 선택할 때 주문하는 '판매 단위'의 수량을 나타냅니다. 예를 들어, "오렌지 1봉지(6알) 8,900원", "오렌지 2봉지(12알) 16,900원" 옵션이 있다면, 고객은 '봉지' 단위로 주문하므로 quantity는 각각 1, 2가 됩니다. 이는 총 가격 계산 로직(calculateOptimalPrice 함수 등)에서 orderQuantity (주문 단위 수량)와 직접적으로 비교/계산되는 값입니다. 내용물의 총 개수(6알, 12알)가 아니라, 고객이 주문하는 판매 단위(봉지, 박스, 세트, 묶음 등)의 개수를 정확히 입력해야 합니다.
description 필드: 해당 옵션에 대한 구체적인 설명을 포함합니다. 판매 단위, 해당 단위에 포함된 내용물 정보(개수, 중량 등), 할인 정보 등을 명확히 기재하여 quantity가 나타내는 판매 단위의 실제 구성을 알 수 있도록 해야 합니다. (예: "1봉지(6알)", "2봉지(12알)", "1세트(3개입)", "2세트(총 6개)", "500g 팩", "1kg 팩")
basePrice로 설정된 가격 정보(가장 기본 단위 옵션)도 priceOptions 배열 안에 반드시 포함되어야 합니다.
텍스트에 유효한 판매 가격이 단 하나만 명시된 경우, 해당 가격 정보를 포함하는 옵션 객체 하나만 이 배열에 넣으세요. (예: [{ "quantity": 1, "price": 8900, "description": "1봉지(6알)" }])
🔥중요: 위 1번 규칙에 따라 '원가', '정상가', '참고용 가격'으로 판단된 금액은 이 배열에 절대 포함시키지 마십시오.
단일 상품 vs. 여러 상품:
🔥게시물에 명확히 다른 상품(예: 사과, 배)이나 동일 품목이라도 종류/색상(빨간 파프리카, 노란 파프리카)이 다른 상품이 여러 개 있으면 multipleProducts를 true로 설정하고, 각 상품 정보를 products 배열에 담으세요. 특히 '1번', '2번' 또는 '1️⃣', '2️⃣' 와 같이 번호가 매겨진 목록 형태는 여러 상품일 가능성이 매우 높으므로 주의 깊게 분석하세요.
동일 상품에 대한 수량/단위별 가격 차이는 여러 상품이 아니라, 단일 상품의 priceOptions로 처리해야 합니다. 이 경우 multipleProducts는 false입니다.
기타 필드:
title: 상품의 핵심 명칭만 간결하게 추출합니다. (수량/단위 정보는 반드시 제외)
  🔥 **날짜 접두사:** 맨 앞에 반드시 **\`[M월D일]\` 형식**으로 게시물 작성 시간의 월과 일을 포함하세요. (예: 5월 2일이면 \`[5월2일]\`).
  🔥 **상품명:** 날짜 접두사 바로 뒤에 **자연스러운 상품명**을 공백 하나로 구분하여 붙입니다.
      - **띄어쓰기:** 원문 텍스트의 불필요한 띄어쓰기나 줄바꿈을 제거하고, 일반적인 상품명 표기법에 따라 자연스럽게 띄어씁니다. 고유명사나 복합명사는 적절히 붙여 씁니다. (예: "성주 꿀 참외" -> \`성주꿀참외\` 또는 \`성주 꿀참외\`, "블랙 라벨 오렌지" -> \`블랙라벨오렌지\`, "메주리알 장조림" -> \`메주리알장조림\` 또는 \`메주리알 장조림\`) AI가 가장 자연스럽다고 판단하는 형태로 정제하세요.
  🔥 **특수문자/괄호:** 상품명 자체에는 괄호 \`()\` 를 포함하지 마세요. 원산지 등 부가 정보도 포함하지 마세요. (예:마늘 (국내산) -> 마늘)
      
  - **최종 형식 예시:**
      - \`[5월2일] 성주꿀참외\`
      - \`[12월25일] 블랙라벨오렌지\`
      - \`[5월2일] 메주리알 장조림\`
      - \`[5월2일] 마늘 국내산\`
🔥 quantity (루트 레벨): 상품의 가장 기본적인 판매 단위 수량을 나타냅니다. 예를 들어, 상품이 기본적으로 '1봉지' 단위로 판매된다면 이 값은 1입니다. '2개 묶음'으로만 판매된다면 기본 판매 단위는 '묶음'이므로, 이 값은 1입니다. 이 값은 priceOptions 배열 내 quantity와 직접적인 연관성은 없으며, 상품 자체의 최소 판매 단위를 나타냅니다. 대부분의 경우 1로 설정됩니다.
🔥 quantityText: 루트 레벨 quantity에 해당하는 기본 판매 단위를 설명하는 텍스트입니다. (예: "1봉지", "1세트", "1개", "500g 팩") 내용물 정보(예: 6알)는 여기에 포함하지 않고, priceOptions의 description에서 상세히 설명합니다.
productId: prod_bandNumber_postId_itemNumber 형식으로 생성. itemNumber는 게시물 본문에 명시된 상품 번호(1번, 2번...) 또는 순서대로 부여. 여러 상품일 경우 각 상품 객체 내에 포함. 단일 상품 시 기본 1 또는 명시된 번호 사용.
category: 상품 분류 (예: "식품", "의류", "생활용품", "기타" 등)
status: 판매 상태 (예: "판매중", "품절", "예약중", "마감" 등). 재고 정보(stockQuantity)와 연관지어 판단하세요. (예: stockQuantity가 0이면 "품절")
tags: 상품 관련 키워드 배열 (예: ["#특가", "#국내산", "#당일배송"])
features: 상품의 주요 특징 배열 (예: ["유기농 인증", "무료 배송"])
pickupInfo: 픽업/배송 관련 안내 문구 (예: "내일 오후 2시 일괄 배송")
pickupDate: "내일", "5월 10일", "다음주 화요일", "지금부터" ,"2시 이후" ,"3시 부터" 등의 정보를 게시물 작성 시간 기준으로 해석하여 YYYY-MM-DD 또는 YYYY-MM-DDTHH:mm:ss.sssZ 형식으로 설정. "지금부터"는 게시물 작성 시간(또는 현재 시간)으로 해석 가능.
pickupType: 픽업/배송 방식 (예: "도착", "수령", "픽업", "배송", "전달")
🔥stockQuantity: 재고 수량을 나타내는 숫자입니다. "5개 남음", "3세트 한정" 등 명확한 숫자가 있으면 해당 숫자를 추출하세요. "1통 여유", "1개 가능" 등 특정 단위와 함께 남은 수량이 언급되면 해당 숫자(여기서는 1)를 추출합니다. "한정 수량", "재고 문의", "여유분" 등 구체적인 숫자가 없거나 불명확하면 null을 반환하세요.
※ 출력 형식:
여러 상품일 경우 (multipleProducts: true):
{
  "multipleProducts": true,
  "products": [
    {
      "productId": "prod_${postKey}_1", // 예시, 실제 값으로 대체
      "itemNumber": 1,
      "title": "[5월2일] 상품명1", // <<< 예시 수정
      "basePrice": 숫자, // 상품1 기본 단위(quantity:1) 가격
      "priceOptions": [
        { "quantity": 1, "price": 숫자, "description": "상품1 옵션1 설명 (예: 1팩(6개입))" }, // 주문 단위 수량: 1
        { "quantity": 2, "price": 숫자, "description": "상품1 옵션2 설명 (예: 2팩(12개입) 할인)" } // 주문 단위 수량: 2
      ],
      "quantityText": "상품1 기본 단위 설명 (예: 1팩)", // 기본 판매 단위
      "quantity": 1, // 상품1의 기본 판매 단위 수량 (보통 1)
      "category": "분류",
      "status": "상태",
      "tags": ["태그배열"],
      "features": ["특징배열"],
      "pickupInfo": "픽업/배송 정보",
      "pickupDate": "날짜",
      "pickupType": "방식",
      "stockQuantity": 숫자 또는 null
    },
    // ... 추가 상품 ...
  ]
}
Use code with caution.
Json
단일 상품일 경우 (multipleProducts: false):
{
  "multipleProducts": false,
  "productId": "prod_${postKey}_1", // 예시, 실제 값으로 대체
  "itemNumber": 1, // 또는 해당 상품 번호
  "title": "[5월2일] 퓨어스펙 블랙라벨 오렌지", // <<< 예시 수정
  "basePrice": 8900, // 기본 단위(1봉지) 가격
  "priceOptions": [
    { "quantity": 1, "price": 8900, "description": "1봉지(6알)" }, // quantity: 주문 단위 수량 = 1
    { "quantity": 2, "price": 16900, "description": "2봉지(12알)" } // quantity: 주문 단위 수량 = 2
  ],
  "quantityText": "1봉지", // 기본 판매 단위 설명 (내용물 정보는 description에)
  "quantity": 1, // 기본 판매 단위 수량 (1봉지)
  "category": "식품",
  "status": "판매중",
  "tags": ["#특가", "#최고급"],
  "features": ["72과 사이즈"],
  "pickupInfo": "오늘 오후 2시 이후 수령 예약은 댓글로 남겨주세요!",
  "pickupDate": "YYYY-MM-DDTHH:mm:ss.sssZ", // 실제 날짜로 변환 필요
  "pickupType": "수령",
  "stockQuantity": null
}

    `.trim();

      const userContent = `
다음 텍스트에서 상품 정보를 위 규칙과 형식에 맞춰 JSON으로 추출해주세요:

텍스트:
\`\`\`
${content}
\`\`\`

게시물 작성 시간: ${postTime}
게시물 키 (productId 생성에 사용): ${postKey}
`.trim();

      const prompt = `${systemInstructions}\n\n${userContent}`; // 시스템 지침과 사용자 요청 결합

      // --- Call Gemini API ---
      const response = await geminiModel.generateContent(prompt);
      const responseText = await response.response.text(); // 생성된 텍스트 (JSON) 추출

      logger.info("Gemini API 원본 응답:"); // 로그 메시지 업데이트
      logger.info("=== API 응답 시작 ===");
      logger.info(responseText);
      logger.info("=== API 응답 끝 ===");

      try {
        // 응답 시작/끝 문자 확인 (선택적이지만, Gemini가 JSON을 잘 생성하는지 초기 확인에 도움)
        if (
          !responseText.trim().startsWith("{") ||
          !responseText.trim().endsWith("}")
        ) {
          // Gemini의 responseMimeType 설정으로 인해 이 오류는 발생하지 않을 것으로 예상되지만, 방어적으로 남겨둡니다.
          logger.warn(
            "Gemini API 응답이 JSON 객체 형식이 아닐 수 있습니다. 파싱 시도."
          );
          // throw new Error("API 응답이 올바른 JSON 형식이 아닙니다"); // 필요시 에러 발생
        }

        const result = JSON.parse(responseText);

        // 기존 코드: productName -> title 변환 (유지)
        if (result.productName && !result.title)
          result.title = result.productName;

        // 여러 상품 처리 로직 (기존과 동일하게 유지)
        if (
          result.multipleProducts === true && // 명시적으로 true인지 확인
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
            // processProduct는 단일 상품을 처리하므로, multipleProducts: false 인 객체를 반환함
            const processedMergedProduct = processProduct(
              mergedProduct,
              postTime
            );
            return {
              multipleProducts: false, // 병합되었으므로 단일 상품
              products: [processedMergedProduct], // 배열로 감싸기
            };
          }

          logger.info(
            `여러 상품 감지: ${result.products.length}개의 상품이 추출되었습니다.`
          );

          // 여기가 핵심 수정 부분: products 배열에 하나의 상품만 있으면 단일 상품으로 처리
          if (result.products.length === 1) {
            logger.info(
              "multipleProducts가 true로 설정되었지만 실제 상품은 1개입니다. 단일 상품으로 처리합니다."
            );

            const singleProduct = result.products[0];
            // 상품 객체에서 multipleProducts 필드 제거 (혼란 방지)
            const { multipleProducts: _unused, ...cleanProduct } =
              singleProduct;

            // processProduct 호출 시 자동으로 multipleProducts: false 처리됨
            const processedSingleProduct = processProduct(
              {
                ...cleanProduct,
                // 공통 픽업 정보 병합 (선택적)
                pickupInfo:
                  cleanProduct.pickupInfo || result.commonPickupInfo || null,
                pickupDate:
                  cleanProduct.pickupDate || result.commonPickupDate || null,
                pickupType:
                  cleanProduct.pickupType || result.commonPickupType || null,
              },
              postTime
            );
            return {
              multipleProducts: false, // 병합되었으므로 단일 상품
              products: [processedSingleProduct], // 배열로 감싸기
            };
          }

          // 실제 여러 상품 처리
          const processedProducts = result.products.map((product) => {
            return processProduct(
              {
                ...product,
                // 공통 픽업 정보 병합 (선택적)
                pickupInfo:
                  product.pickupInfo || result.commonPickupInfo || null,
                pickupDate:
                  product.pickupDate || result.commonPickupDate || null,
                pickupType:
                  product.pickupType || result.commonPickupType || null,
              },
              postTime
            );
          });

          // 최종 반환: multipleProducts: true 와 처리된 상품 배열
          return {
            multipleProducts: true,
            products: processedProducts,
          };
        }

        // 단일 상품 처리 (기존과 동일하게 유지)
        const processedSingleProduct = processProduct(result, postTime);
        return {
          multipleProducts: false, // 단일 상품이므로 false
          products: [processedSingleProduct], // 배열로 감싸서 반환
        };
      } catch (parseError) {
        logger.error("JSON 파싱 오류:", parseError);
        logger.error("파싱 실패한 내용:", responseText); // 파싱 실패 시 원본 내용 로깅
        return getDefaultProduct("JSON 파싱 실패"); // 에러 메시지 명확화
      }
    } catch (error) {
      // Gemini API 호출 자체의 에러 처리
      logger.error("Gemini API 호출 중 오류 발생:", error);
      // Gemini 관련 에러 정보 로깅 (있다면)
      if (error.response) {
        logger.error("Gemini API 오류 응답:", error.response);
      }

      retries++; // 재시도 횟수 증가

      // 최대 재시도 횟수를 초과하면 루프 종료하고 기본값 반환
      if (retries > MAX_RETRIES) {
        logger.error(`최대 재시도 횟수(${MAX_RETRIES}) 초과. 기본값 반환.`);
        return getDefaultProduct("API 오류 (최대 재시도 초과)");
      }

      // 재시도 전 잠시 대기
      logger.info(`${RETRY_DELAY_MS / 1000}초 후 재시도합니다...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return getDefaultProduct("API 오류");
    }
  }

  // 이 부분은 루프가 정상적으로 종료되지 않았을 때(이론상 발생하기 어려움) 도달할 수 있음
  // 안전을 위해 기본값 반환
  logger.warn("재시도 로직 후 예기치 않게 함수 종료됨. 기본값 반환.");
  return getDefaultProduct("알 수 없는 오류");
}
/**
 * Gemini API 호출 중 오류가 발생하거나, 제품 정보가 부족할 때 기본 상품 정보를 반환하는 함수
 * @param {string} [reason="정보 없음"] - 기본 상품 제목에 사용할 오류나 기본값 사유
 * @returns {Object} - 기본 상품 정보를 포함하는 객체 (multipleProducts: false, products: [defaultProdData])
 */
function getDefaultProduct(reason = "정보 없음") {
  // 기본 상품 객체 생성 (이전 로직과 유사)
  const defaultProdData = {
    title: reason, // 오류나 기본값 사유를 제목으로 사용
    basePrice: 0,
    priceOptions: [{ quantity: 1, price: 0, description: "기본가" }],
    quantity: 1,
    quantityText: null,
    category: "기타",
    status: "판매중", // 또는 "오류" 등으로 설정 가능
    tags: [],
    features: [],
    pickupInfo: null,
    pickupDate: null,
    pickupType: null,
    // 여기에 multipleProducts: false 를 넣지 않습니다.
  };

  // <<< 수정: 최종 반환 구조 >>>
  return {
    multipleProducts: false, // 기본값은 항상 단일 상품(오류 표시용)으로 간주
    products: [defaultProdData], // 기본 상품 데이터를 배열에 담아 반환
    // 필요시 에러 상태를 명시적으로 추가할 수도 있음
    // error: `기본값 반환됨: ${reason}`
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
        productInfo.pickupDate = `${productInfo.pickupDate}T20:00:00.000Z`;
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
  getDefaultProduct,
};
