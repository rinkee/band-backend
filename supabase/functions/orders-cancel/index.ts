// supabase/functions/band-get-posts/index.ts - NO JWT AUTH (Security Risk!)
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersGet, createJsonResponseHeaders } from "../_shared/cors.ts"; // CORS 헬퍼 (경로 확인!)
// === 응답 헤더 미리 생성 ===
const responseHeaders = createJsonResponseHeaders(corsHeadersGet);
// --- AI 정보 추출 함수 (Gemini API 호출 가정) ---
async function extractProductInfoAI(content, postTime = null, postKey) {
  console.log(`[AI 분석] postKey: ${postKey}에 대한 분석 시작.`);
  // ⚠️ 실제 환경 변수 이름으로 변경하세요 (예: GEMINI_API_KEY)
  const aiApiKey = Deno.env.get("GOOGLE_API_KEY");
  // ⚠️ Gemini API 엔드포인트 확인 필요 (예시)
  const aiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${aiApiKey}`; // 모델명 확인 및 엔드포인트 확인
  const parsedPostTime = postTime
    ? safeParseDate(postTime).toLocaleDateString("ko-KR", {
        month: "long",
        day: "numeric",
      })
    : "알수없음"; // 예: "5월 4일"
  if (!aiApiKey || !aiEndpoint || !aiEndpoint.includes("?key=")) {
    // 엔드포인트 형식 체크 추가
    console.warn(
      "AI API 키 또는 엔드포인트가 올바르게 구성되지 않았습니다. 대체 정보를 사용합니다."
    );
    // AI API 설정이 잘못된 경우, 기본 상품 정보 반환
    return getDefaultProduct("AI API 설정 오류");
  }
  // --- 상세 프롬프트 구성 ---
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
게시물 작성 시간: ${
    postTime ? safeParseDate(postTime).toISOString() : "알 수 없음"
  }
게시물 키 (참고용): ${postKey}
`.trim();
  // Gemini API 요청 본문 형식 (모델 및 API 버전 확인 필요)
  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: `${systemInstructions}\n\n${userContent}`,
          },
        ],
      },
    ],
  };
  // --- 재시도 로직 포함 API 호출 ---
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 1000;
  let retries = 0;
  while (retries <= MAX_RETRIES) {
    try {
      console.log(`[AI 분석] AI API 호출 (시도 ${retries + 1})...`);
      const response = await fetch(aiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        throw new Error(
          `AI API HTTP 오류: ${response.status} ${
            response.statusText
          } - ${await response.text()}`
        );
      }
      const result = await response.json();
      // Gemini 응답 구조에서 텍스트(JSON) 추출 (실제 응답 확인 필요)
      const responseText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!responseText) {
        console.error("Invalid AI response structure:", result);
        throw new Error("AI 응답에서 유효한 텍스트(JSON)를 찾을 수 없습니다.");
      }
      console.log("[AI 분석] AI 원본 응답 텍스트 수신 완료.");
      // console.debug("Raw AI Response:\n", responseText); // 필요시 로깅
      // JSON 파싱
      let parsedResult;
      try {
        // 마크다운 코드 블록 처리
        let jsonStr = responseText;
        // 코드 블록 제거 (```json 또는 ``` 형식 제거)
        const codeBlockRegex = /```(?:json)?([\s\S]*?)```/;
        const matches = jsonStr.match(codeBlockRegex);
        if (matches && matches[1]) {
          // 코드 블록 내용만 추출
          jsonStr = matches[1].trim();
        }
        // 여전히 JSON이 아닌 경우 첫 번째 { 부터 마지막 } 까지 추출 시도
        if (!jsonStr.startsWith("{")) {
          const startIdx = jsonStr.indexOf("{");
          const endIdx = jsonStr.lastIndexOf("}");
          if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
            jsonStr = jsonStr.substring(startIdx, endIdx + 1);
          }
        }
        console.log(
          `[AI 분석] 전처리된 JSON 문자열 (앞부분): ${jsonStr.substring(
            0,
            50
          )}...`
        );
        // 이제 정제된 JSON 문자열 파싱
        parsedResult = JSON.parse(jsonStr);
      } catch (parseError) {
        console.error("AI response JSON parsing error:", parseError);
        console.error("Content that failed parsing:", responseText);
        throw new Error(`AI 응답 JSON 파싱 실패: ${parseError.message}`);
      }
      console.log("[AI 분석] AI 응답 파싱 성공.");
      // --- AI 결과 후처리 및 검증 ---
      let finalResult = null; // null 가능성
      if (
        parsedResult.multipleProducts === true &&
        Array.isArray(parsedResult.products) &&
        parsedResult.products.length > 0
      ) {
        // 여러 상품 처리 (병합 로직 포함)
        const mergedProduct = detectAndMergeQuantityBasedProducts(
          parsedResult.products
        );
        if (mergedProduct) {
          const processedMerged = processProduct(mergedProduct, postTime);
          finalResult = {
            multipleProducts: false,
            products: [processedMerged],
          };
        } else if (parsedResult.products.length === 1) {
          // multiple:true 인데 상품 1개
          const processedSingle = processProduct(
            {
              ...parsedResult.products[0],
            },
            postTime
          );
          finalResult = {
            multipleProducts: false,
            products: [processedSingle],
          };
        } else {
          // 실제 여러 상품
          const processedProducts = parsedResult.products.map((p) =>
            processProduct(
              {
                ...p,
              },
              postTime
            )
          );
          finalResult = {
            multipleProducts: true,
            products: processedProducts,
          };
        }
      } else if (
        parsedResult.multipleProducts === false &&
        parsedResult.title
      ) {
        // 단일 상품 처리
        const processedSingle = processProduct(parsedResult, postTime);
        finalResult = {
          multipleProducts: false,
          products: [processedSingle],
        };
      } else {
        // 유효한 상품 정보 없는 경우
        console.warn(
          "AI result format is valid JSON but lacks expected product data:",
          parsedResult
        );
        // 유효한 상품 정보 없으면 null 반환 결정 가능
        // return null; // 여기서 null 반환 결정
      }
      // --- 최종 결과 유효성 검사 ---
      // products 배열이 있고, 최소 하나의 유효한 상품(예: title 존재)이 있는지 확인
      if (
        finalResult &&
        finalResult.products &&
        finalResult.products.length > 0 &&
        finalResult.products.some(
          (p) =>
            p.title &&
            !p.title.includes("AI 분석 필요") &&
            !p.title.includes("정보 없음")
        )
      ) {
        console.log("[AI 분석] 처리 성공, 유효한 상품이 발견되었습니다.");
        finalResult.products.forEach((p, idx) => {
          // productId 생성 추가
          if (!p.productId)
            p.productId = generateProductUniqueIdForItem(
              "tempUser",
              "tempBand",
              postKey,
              p.itemNumber ?? idx + 1
            ); // userId, bandNumber는 save 시 재설정될 수 있음
        });
        return finalResult; // 유효한 결과 반환
      } else {
        console.warn(
          "[AI 분석] 처리 완료되었지만 유효한 상품이 추출되지 않았습니다. null을 반환합니다."
        );
        return null; // <<<--- 유효 상품 없으면 null 반환
      }
      // --- 최종 결과 유효성 검사 끝 ---
    } catch (error) {
      console.error(`AI API 호출 오류 (시도 ${retries + 1}):`, error.message);
      retries++;
      if (retries > MAX_RETRIES) {
        console.error("AI API 호출 실패. null을 반환합니다.");
        return null; // <<<--- 최대 재시도 초과 시 null 반환
      }
      console.log(`${RETRY_DELAY_MS / 1000}초 후 AI 호출 재시도 중...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  } // end while loop
  // 루프 종료 후 (오류 발생 시 위에서 null 반환됨)
  console.warn("AI 분석 루프가 예기치 않게 종료되었습니다. null을 반환합니다.");
  return null; // <<<--- 예기치 않은 종료 시 null 반환
}
// 기본 상품 정보를 반환하는 함수
function getDefaultProduct(reason = "정보 없음") {
  const defaultDate = new Date().toISOString();
  const defaultProdData = {
    title: `[AI 분석 필요] ${reason}`,
    basePrice: 0,
    priceOptions: [
      {
        quantity: 1,
        price: 0,
        description: "정보 없음",
      },
    ],
    quantity: 1,
    quantityText: "1개",
    category: "미분류",
    status: "정보 필요",
    tags: [],
    features: [],
    pickupInfo: "",
    pickupDate: null,
    pickupType: "",
    stockQuantity: null,
    itemNumber: 1,
  };
  return {
    multipleProducts: false,
    products: [defaultProdData],
  };
}
function safeParseDate(dateString) {
  try {
    if (dateString instanceof Date) return dateString;
    if (typeof dateString === "number") return new Date(dateString);
    if (typeof dateString === "string") {
      // 표준 ISO 날짜 형식 시도
      const d = new Date(dateString);
      if (!isNaN(d.getTime())) return d;
      // 한국어 날짜 형식 파싱 로직 (예: "2023년 12월 25일", "오늘", "내일")
      if (dateString.includes("오늘")) {
        return new Date();
      } else if (dateString.includes("내일")) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow;
      } else if (dateString.includes("어제")) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday;
      } else if (dateString.match(/\d+월\s*\d+일/)) {
        // "5월 10일" 형식 처리
        const matches = dateString.match(/(\d+)월\s*(\d+)일/);
        if (matches && matches.length >= 3) {
          const month = parseInt(matches[1]) - 1; // 0-based 월
          const day = parseInt(matches[2]);
          const today = new Date();
          const result = new Date(today.getFullYear(), month, day);
          // 날짜가 과거인 경우 다음 해로 설정
          if (
            result < today &&
            (today.getMonth() - month > 1 ||
              (today.getMonth() === 11 && month === 0))
          ) {
            result.setFullYear(today.getFullYear() + 1);
          }
          return result;
        }
      }
    }
  } catch (error) {
    console.error("Date parsing error:", error);
  }
  // 기본값: 현재 날짜
  return new Date();
}
function extractPickupDate(text, postTime = null) {
  if (!text)
    return {
      date: null,
      type: null,
      original: null,
    };
  let extractedDate = null;
  let extractedType = null;
  const today = postTime ? safeParseDate(postTime) : new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const originalText = text;
  text = text.toLowerCase().replace(/\s+/g, " ").trim();
  // 픽업/배송 타입 키워드 검색
  const pickupKeywords = ["픽업", "수령", "방문", "찾아가기", "받아가기"];
  const deliveryKeywords = ["배송", "배달", "도착", "보내드림", "전달"];
  for (const keyword of pickupKeywords) {
    if (text.includes(keyword)) {
      extractedType = "픽업";
      break;
    }
  }
  if (!extractedType) {
    for (const keyword of deliveryKeywords) {
      if (text.includes(keyword)) {
        extractedType = "배송";
        break;
      }
    }
  }
  // 기본 픽업/배송 타입 (찾지 못했을 경우)
  if (!extractedType) {
    extractedType = "수령"; // 기본값
  }
  // 날짜 추출 로직
  if (text.includes("오늘")) {
    extractedDate = new Date(today);
  } else if (text.includes("내일")) {
    extractedDate = tomorrow;
  } else if (text.includes("모레") || text.includes("모래")) {
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(today.getDate() + 2);
    extractedDate = dayAfterTomorrow;
  } else if (text.match(/(\d+)월\s*(\d+)일/)) {
    // "5월 10일" 형식 처리
    const matches = text.match(/(\d+)월\s*(\d+)일/);
    if (matches && matches.length >= 3) {
      const month = parseInt(matches[1]) - 1; // 0-indexed 월
      const day = parseInt(matches[2]);
      extractedDate = new Date(today.getFullYear(), month, day);
      // 날짜가 과거인 경우 다음 해로 설정
      if (extractedDate < today) {
        extractedDate.setFullYear(today.getFullYear() + 1);
      }
    }
  } else if (text.match(/다음\s*(주|달)/)) {
    // 다음 주/달 처리
    if (text.includes("다음 주") || text.includes("다음주")) {
      extractedDate = new Date(today);
      extractedDate.setDate(today.getDate() + 7);
    } else if (text.includes("다음 달") || text.includes("다음달")) {
      extractedDate = new Date(today);
      extractedDate.setMonth(today.getMonth() + 1);
      extractedDate.setDate(1); // 다음 달 1일로 설정
    }
  }
  // 시간 정보 추출
  let hour = 12; // 기본값 정오
  let minute = 0;
  if (extractedDate) {
    // 오전/오후 및 시간 추출
    const timeMatch = text.match(/(\d+)시\s*(\d+)?분?/);
    const amPmMatch = text.match(/(오전|오후|아침|저녁|밤|낮)/);
    if (timeMatch) {
      hour = parseInt(timeMatch[1]);
      if (timeMatch[2]) minute = parseInt(timeMatch[2]);
      // 오전/오후 조정
      if (amPmMatch) {
        const amPm = amPmMatch[1];
        if (
          (amPm === "오후" || amPm === "저녁" || amPm === "밤") &&
          hour < 12
        ) {
          hour += 12;
        } else if ((amPm === "오전" || amPm === "아침") && hour === 12) {
          hour = 0;
        }
      } else if (hour < 8) {
        // 시간만 명시된 경우 상황에 따라 추측 (예: 2시 -> 14시로 가정)
        hour += 12;
      }
      extractedDate.setHours(hour, minute, 0, 0);
    } else {
      // 시간이 명시되지 않은 경우 기본 시간 설정
      extractedDate.setHours(hour, 0, 0, 0);
    }
  } else {
    // 날짜 정보가 없는 경우 기본값으로 내일 정오 설정
    extractedDate = tomorrow;
    extractedDate.setHours(hour, 0, 0, 0);
  }
  return {
    date: extractedDate ? extractedDate.toISOString() : null,
    type: extractedType,
    original: originalText,
  };
}
function processProduct(productInfo, postTime) {
  if (!productInfo) return getDefaultProduct("정보 없음").products[0];
  // 픽업 정보 추출 및 설정
  const pickupDetails = extractPickupDate(
    productInfo.pickupInfo || productInfo.pickupDate,
    postTime
  );
  productInfo.pickupDate = pickupDetails.date;
  productInfo.pickupType = productInfo.pickupType || pickupDetails.type;
  // 필요하지 않은 속성 제거
  if (productInfo.multipleProducts !== undefined) {
    delete productInfo.multipleProducts;
  }
  // 가격 옵션 검증 및 정리
  if (!productInfo.priceOptions || !Array.isArray(productInfo.priceOptions)) {
    productInfo.priceOptions = [];
  }
  // 최소 하나의 가격 옵션이 있는지 확인
  if (
    productInfo.priceOptions.length === 0 &&
    typeof productInfo.basePrice === "number" &&
    productInfo.basePrice > 0
  ) {
    productInfo.priceOptions = [
      {
        quantity: 1,
        price: productInfo.basePrice,
        description: productInfo.quantityText || "기본옵션",
      },
    ];
  }
  // basePrice가 없거나 0이면서 priceOptions가 있는 경우 자동 설정
  if (
    (!productInfo.basePrice || productInfo.basePrice === 0) &&
    productInfo.priceOptions &&
    productInfo.priceOptions.length > 0
  ) {
    const firstOption = productInfo.priceOptions[0];
    productInfo.basePrice = firstOption.price;
  }
  // 기본 상품 상태 검사 및 설정
  if (!productInfo.status) {
    productInfo.status = "판매중";
  }
  // stockQuantity가 0인 경우 '품절'로 상태 변경
  if (productInfo.stockQuantity === 0) {
    productInfo.status = "품절";
  }
  // 기본 필드 보장
  if (!productInfo.tags) productInfo.tags = [];
  if (!productInfo.features) productInfo.features = [];
  if (!productInfo.category) productInfo.category = "기타";
  if (!productInfo.quantity) productInfo.quantity = 1;
  if (!productInfo.quantityText) productInfo.quantityText = "1개";
  return productInfo;
}
function detectAndMergeQuantityBasedProducts(products) {
  if (!products || !Array.isArray(products) || products.length <= 1) {
    return null; // 병합할 필요가 없음
  }
  // 동일한 상품명을 가진 제품들 중 itemNumber/번호가 다른 제품을 식별
  // 예: "[5월1일] 사과" 제품이 1번, 2번, 3번으로 나뉘어 있을 수 있음
  // 제목에서 날짜 부분 제거 후 공백 제거하여 비교용 제목 생성
  const normalizedTitles = products.map((p) => {
    const title = p.title || "";
    return title.replace(/\[\d+월\d+일\]|\[\d+\/\d+\]/, "").trim(); // 날짜 패턴 제거
  });
  // 제목이 동일한 제품 그룹 식별
  const titleGroups = {};
  normalizedTitles.forEach((title, index) => {
    if (!titleGroups[title]) {
      titleGroups[title] = [];
    }
    titleGroups[title].push(index);
  });
  // 동일 제목을 가진 그룹 중 가장 큰 그룹 찾기
  let largestGroupTitle = "";
  let largestGroupSize = 0;
  for (const [title, indices] of Object.entries(titleGroups)) {
    if (indices.length > largestGroupSize) {
      largestGroupTitle = title;
      largestGroupSize = indices.length;
    }
  }
  // 동일 제품이 없으면 null 반환
  if (largestGroupSize <= 1) {
    return null;
  }
  // 동일 제품으로 판단된 제품들의 인덱스
  const sameProductIndices = titleGroups[largestGroupTitle];
  // 병합 대상 제품들
  const productsToMerge = sameProductIndices.map((idx) => products[idx]);
  // 병합할 첫 번째 제품을 기반으로 함
  const mergedProduct = {
    ...productsToMerge[0],
  };
  // 가격 옵션 병합 준비
  let allPriceOptions = [];
  productsToMerge.forEach((p) => {
    if (p.priceOptions && Array.isArray(p.priceOptions)) {
      // 각 가격 옵션에 해당 상품의 itemNumber 정보 추가
      const enhancedOptions = p.priceOptions.map((opt) => ({
        ...opt,
        itemNumber: p.itemNumber || 1,
        originalDescription: opt.description || "",
      }));
      allPriceOptions = [...allPriceOptions, ...enhancedOptions];
    }
  });
  // 중복 제거 및 정렬
  const uniqueOptions = Array.from(
    new Set(allPriceOptions.map((opt) => `${opt.quantity}-${opt.price}`))
  ).map((key) => {
    const [quantity, price] = key.split("-").map(Number);
    const matchingOpts = allPriceOptions.filter(
      (opt) => opt.quantity === quantity && opt.price === price
    );
    // 같은 quantity-price 조합에 대해 첫 번째 설명 사용
    return {
      quantity,
      price,
      description:
        matchingOpts[0].originalDescription || `${quantity}개 ${price}원`,
    };
  });
  // quantity 오름차순으로 정렬
  uniqueOptions.sort((a, b) => a.quantity - b.quantity);
  // 최종 병합 제품 구성
  mergedProduct.priceOptions = uniqueOptions;
  // basePrice 설정: 가장 낮은 quantity의 가격 사용
  if (uniqueOptions.length > 0) {
    const lowestQuantityOption = uniqueOptions.sort(
      (a, b) => a.quantity - b.quantity
    )[0];
    mergedProduct.basePrice = lowestQuantityOption.price;
  }
  // itemNumber는 첫 번째 상품의 것을 사용
  mergedProduct.itemNumber = productsToMerge[0].itemNumber || 1;
  // 재고 정보가 있다면 합산
  const validStockQuantities = productsToMerge
    .map((p) => p.stockQuantity)
    .filter((q) => typeof q === "number");
  if (validStockQuantities.length > 0) {
    mergedProduct.stockQuantity = validStockQuantities.reduce(
      (sum, q) => sum + q,
      0
    );
  }
  return mergedProduct;
}
// --- AI 관련 함수 끝 ---
// --- Band 유틸리티 함수 ---
function contentHasPriceIndicator(content) {
  if (!content) return false;
  // 1. 키워드 확인
  const keywordRegex = /수령|픽업|도착|예약|주문|특가|정상가|할인가|가격|원|₩/;
  const hasKeyword = keywordRegex.test(content);
  // logger.debug(`[Price Indicator Step 1] hasKeyword: ${hasKeyword} for content starting with: ${content.substring(0, 30)}`);
  if (!hasKeyword) {
    return false;
  }
  // 2. 세 자리 이상의 숫자 확인 (점, 쉼표, 아무 구분자 없어도 됨)
  // 예: 100, 1000, 10000, 000, 29.000, 27,900 등 모두 포함
  const numberRegex = /\d{3,}/g; // 세 자리 이상 숫자
  const numbersFound = content.match(numberRegex);
  // logger.debug(`[Price Indicator Step 2] numbersFound: ${JSON.stringify(numbersFound)} for content starting with: ${content.substring(0, 30)}`);
  if (!numbersFound) {
    return false;
  }
  // 3. 찾은 숫자 중 100 이상인 숫자가 있는지 확인
  let foundPriceLikeNumber = false;
  for (const numStr of numbersFound) {
    const num = parseInt(numStr.replace(/,/g, ""), 10);
    const isPriceLike = !isNaN(num) && num >= 100;
    // logger.debug(`[Price Indicator Step 3] Checking number '${numStr}' -> parsed: ${num}, isPriceLike: ${isPriceLike}`);
    if (isPriceLike) {
      foundPriceLikeNumber = true;
      break;
    }
  }
  const hasPriceLikeNumber = foundPriceLikeNumber;
  // logger.debug(`[Price Indicator Step 4] Final result: hasKeyword=${hasKeyword}, hasPriceLikeNumber=${hasPriceLikeNumber}`);
  return hasKeyword && hasPriceLikeNumber;
}
function extractNumberedProducts(content) {
  if (!content) return [];
  // 줄별로 분리
  const lines = content.split("\n");
  const products = [];
  // 번호 지정 상품 패턴
  // 1. '1번. 상품명 10,000원'
  // 2. '1. 상품명 10,000원'
  // 3. ①상품명 10,000원
  const numberPatterns = [
    /^\s*(\d+)[번호]\.\s*(.*?)(?:\s*[\:：]\s*|\s+)(\d{1,3}(?:,\d{3})*)\s*원/i,
    /^\s*(\d+)\.\s*(.*?)(?:\s*[\:：]\s*|\s+)(\d{1,3}(?:,\d{3})*)\s*원/i,
    /^\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*(.*?)(?:\s*[\:：]\s*|\s+)(\d{1,3}(?:,\d{3})*)\s*원/i,
    /^\s*(\d+)[번호][\.:]?\s*(.*?)\s*(\d{1,3}(?:,\d{3})*)\s*원/i,
    /^\s*(\d+)[\.:]\s*(.*?)\s*(\d{1,3}(?:,\d{3})*)\s*원/i,
    /^\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*(.*?)\s*(\d{1,3}(?:,\d{3})*)\s*원/i,
  ];
  // 특수문자 번호를 숫자로 변환하는 맵
  const specialNumMap = {
    "①": 1,
    "②": 2,
    "③": 3,
    "④": 4,
    "⑤": 5,
    "⑥": 6,
    "⑦": 7,
    "⑧": 8,
    "⑨": 9,
    "⑩": 10,
  };
  for (const line of lines) {
    let found = false;
    // 패턴 1, 2: 숫자 + 번호/. + 상품명 + 가격
    for (const pattern of numberPatterns.slice(0, 2)) {
      const match = line.match(pattern);
      if (match) {
        const itemNumber = parseInt(match[1]);
        const title = match[2].trim();
        const price = parseInt(match[3].replace(/,/g, ""));
        products.push({
          itemNumber,
          title,
          price,
          description: `${itemNumber}번 상품`,
        });
        found = true;
        break;
      }
    }
    // 패턴 3: 특수문자 번호
    if (!found) {
      const match = line.match(numberPatterns[2]);
      if (match) {
        const specialNum = line.charAt(0);
        const itemNumber = specialNumMap[specialNum] || 1;
        const title = match[1].trim();
        const price = parseInt(match[2].replace(/,/g, ""));
        products.push({
          itemNumber,
          title,
          price,
          description: `${itemNumber}번 상품`,
        });
        found = true;
      }
    }
    // 패턴 4, 5: 숫자 + 번호/. + 상품명 + 가격 (콜론 없는 버전)
    if (!found) {
      for (const pattern of numberPatterns.slice(3, 5)) {
        const match = line.match(pattern);
        if (match) {
          const itemNumber = parseInt(match[1]);
          const title = match[2].trim();
          const price = parseInt(match[3].replace(/,/g, ""));
          products.push({
            itemNumber,
            title,
            price,
            description: `${itemNumber}번 상품`,
          });
          found = true;
          break;
        }
      }
    }
    // 패턴 6: 특수문자 번호 (콜론 없는 버전)
    if (!found) {
      const match = line.match(numberPatterns[5]);
      if (match) {
        const specialNum = line.charAt(0);
        const itemNumber = specialNumMap[specialNum] || 1;
        const title = match[1].trim();
        const price = parseInt(match[2].replace(/,/g, ""));
        products.push({
          itemNumber,
          title,
          price,
          description: `${itemNumber}번 상품`,
        });
      }
    }
  }
  return products;
}
function extractEnhancedOrderFromComment(commentText) {
  const o = [];
  if (
    !commentText ||
    commentText.toLowerCase().includes("마감") ||
    commentText.toLowerCase().includes("취소")
  )
    return o;
  const pT = commentText.replace(/\s+/g, " ").trim();
  const er = /(\d+)\s*번(?:[^\d\n]*?)(\d+)/g;
  let em = false;
  let m;
  while ((m = er.exec(pT)) !== null) {
    const i = parseInt(m[1]);
    const q = parseInt(m[2]);
    if (!isNaN(i) && i > 0 && !isNaN(q) && q > 0) {
      o.push({
        itemNumber: i,
        quantity: q,
        isAmbiguous: false,
      });
      em = true;
    }
  }
  if (!pT.includes("번") || !em) {
    const nr = /(\d+)/g;
    while ((m = nr.exec(pT)) !== null) {
      const q = parseInt(m[1]);
      if (!isNaN(q) && q > 0 && !em)
        o.push({
          itemNumber: 1,
          quantity: q,
          isAmbiguous: true,
        });
    }
  }
  return o;
}
function generateProductUniqueIdForItem(
  userId,
  bandNumber,
  originalPostId,
  itemNumber
) {
  return `prod_${bandNumber}_${originalPostId}_item${itemNumber}`;
}
function generateOrderUniqueId(bandNumber, postId, commentKey, itemNumber) {
  return `order_${bandNumber}_${postId}_${commentKey}_item${itemNumber}`;
}
function generateCustomerUniqueId(userId, authorUserNo) {
  return `cust_${userId}_${authorUserNo}`;
}
function calculateOptimalPrice(
  orderQuantity,
  priceOptions,
  fallbackUnitPrice = 0
) {
  if (typeof orderQuantity !== "number" || orderQuantity <= 0) return 0;
  const validOpts = (Array.isArray(priceOptions) ? priceOptions : []).filter(
    (o) =>
      typeof o.quantity === "number" &&
      o.quantity > 0 &&
      typeof o.price === "number" &&
      o.price >= 0
  );
  if (validOpts.length === 0)
    return Math.round(fallbackUnitPrice * orderQuantity);
  validOpts.sort((a, b) => b.quantity - a.quantity);
  let rem = orderQuantity;
  let cost = 0;
  for (const opt of validOpts) {
    if (rem >= opt.quantity) {
      const n = Math.floor(rem / opt.quantity);
      cost += n * opt.price;
      rem -= n * opt.quantity;
    }
  }
  if (rem > 0) {
    let unitP = fallbackUnitPrice;
    const singleOpt = validOpts.find((o) => o.quantity === 1);
    if (singleOpt) unitP = singleOpt.price;
    else {
      const sOpt = validOpts[validOpts.length - 1];
      if (sOpt) unitP = sOpt.price / sOpt.quantity;
    }
    cost += rem * unitP;
  }
  return Math.round(cost);
}
// --- Band 유틸리티 함수 끝 ---
// --- 외부 서비스 호출 구현 ---
// ⚠️ TODO: 실제 Band API 엔드포인트 및 인증 방식으로 수정 필요
const BAND_POSTS_API_URL = "https://openapi.band.us/v2/band/posts"; // 예시 URL
const COMMENTS_API_URL = "https://openapi.band.us/v2.1/band/post/comments";
async function fetchBandPosts(userId, limit, supabase) {
  console.log(`사용자 ${userId}의 밴드 게시물 가져오기, 제한 ${limit}`);
  let bandAccessToken = null;
  let bandKey = null; // API 스펙에 따라 필요 여부 결정
  let bandNumber = null; // band_number 변수 추가
  try {
    // 사용자 토큰 및 키 조회
    const { data, error } = await supabase
      .from("users")
      .select("band_access_token, band_key, band_number") // band_number 필드 추가
      .eq("user_id", userId)
      .single();
    if (error || !data?.band_access_token)
      throw new Error(
        `Band access token not found or DB error for user ${userId}: ${error?.message}`
      );
    bandAccessToken = data.band_access_token;
    bandKey = data.band_key; // band_key 컬럼 존재 및 필요 여부 확인
    bandNumber = data.band_number; // band_number 값 설정
  } catch (e) {
    console.error("Error fetching Band credentials:", e.message);
    throw e; // 에러 발생 시 함수 중단
  }
  let allPosts = [];
  let nextParams = {};
  let hasMore = true;
  const apiPageLimit = 20; // Band API 페이지당 제한 (확인 필요)
  while (hasMore && allPosts.length < limit) {
    const currentLimit = Math.min(apiPageLimit, limit - allPosts.length); // 이번 페이지에서 가져올 개수
    const apiUrl = new URL(BAND_POSTS_API_URL);
    apiUrl.searchParams.set("access_token", bandAccessToken);
    if (bandKey) apiUrl.searchParams.set("band_key", bandKey); // bandKey가 필요하다면 추가
    apiUrl.searchParams.set("limit", currentLimit.toString());
    Object.entries(nextParams).forEach(([key, value]) =>
      apiUrl.searchParams.set(key, value)
    );
    try {
      console.log(`밴드 API 호출: ${apiUrl.toString()}`);
      const response = await fetch(apiUrl.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
      if (!response.ok)
        throw new Error(
          `Band API error: ${response.statusText} - ${await response.text()}`
        );
      const result = await response.json();
      if (result.result_code !== 1 || !result.result_data)
        throw new Error(
          `Band API logical error: ${result.result_code} - ${JSON.stringify(
            result.result_data
          )}`
        );
      const data = result.result_data;
      const items = data.items || [];
      const processedPosts = items.map((post) => ({
        postKey: post.post_key,
        bandKey: post.band_key || bandKey,
        author: post.author
          ? {
              name: post.author.name,
              userNo: post.author.user_key,
              profileImageUrl: post.author.profile_image_url,
            }
          : null,
        content: post.content,
        createdAt: post.created_at,
        commentCount: post.comment_count ?? 0,
        status: "활성",
        postedAt: post.created_at,
        latestComments:
          post.latest_comments?.map((c) => ({
            createdAt: c.created_at,
          })) || [],
        photos: post.photos?.map((p) => p.url) || [],
      }));
      allPosts = allPosts.concat(processedPosts);
      // 다음 페이지 처리
      if (data.paging && data.paging.next_params && allPosts.length < limit) {
        nextParams = data.paging.next_params;
        hasMore = true;
        await new Promise((resolve) => setTimeout(resolve, 300)); // Rate limit 방지
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error("Error during Band posts fetch:", error.message);
      // 페이지 조회 실패 시 다음 페이지 시도 중단 또는 재시도 로직 추가 가능
      hasMore = false; // 일단 중단
      // throw error; // 필요 시 에러 전파
    }
  }
  console.log(`총 ${allPosts.length}개의 게시물을 가져왔습니다.`);
  return {
    posts: allPosts.slice(0, limit),
    bandKey: bandKey || "",
    bandNumber: bandNumber || "",
  };
}
async function fetchBandComments(userId, postKey, bandKey, supabase) {
  console.log(`게시물 ${postKey}, 밴드 ${bandKey}의 댓글을 가져오는 중`);
  let bandAccessToken = null;
  try {
    // 토큰 조회
    const { data, error } = await supabase
      .from("users")
      .select("band_access_token")
      .eq("user_id", userId)
      .single();
    if (error || !data?.band_access_token)
      throw new Error(
        `Band token not found for user ${userId}: ${error?.message}`
      );
    bandAccessToken = data.band_access_token;
  } catch (e) {
    console.error("Error fetching token for comments:", e.message);
    throw e;
  }
  let allComments = [];
  let nextParams = {};
  let hasMore = true;
  let latestTs = null;
  const apiPageLimit = 50;
  while (hasMore) {
    const apiUrl = new URL(COMMENTS_API_URL);
    apiUrl.searchParams.set("access_token", bandAccessToken);
    apiUrl.searchParams.set("band_key", bandKey);
    apiUrl.searchParams.set("post_key", postKey);
    apiUrl.searchParams.set("limit", apiPageLimit.toString());
    Object.entries(nextParams).forEach(([key, value]) =>
      apiUrl.searchParams.set(key, value)
    );
    try {
      const response = await fetch(apiUrl.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
      if (!response.ok)
        throw new Error(
          `Band API comments error: ${
            response.statusText
          } - ${await response.text()}`
        );
      const result = await response.json();
      if (result.result_code !== 1 || !result.result_data)
        throw new Error(
          `Band API comments logical error: ${result.result_code}`
        );
      const data = result.result_data;
      const items = data.items || [];
      const processed = items.map((c) => {
        const ts = c.created_at; // timestamp ms 가정
        if (ts && (latestTs === null || ts > latestTs)) latestTs = ts;
        return {
          commentKey: c.comment_key,
          postKey: postKey,
          bandKey: bandKey,
          author: c.author
            ? {
                name: c.author.name,
                userNo: c.author.user_key,
                profileImageUrl: c.author.profile_image_url,
              }
            : null,
          content: c.content,
          createdAt: ts,
        };
      });
      allComments = allComments.concat(processed);
      if (data.paging && data.paging.next_params) {
        nextParams = data.paging.next_params;
        hasMore = true;
        await new Promise((resolve) => setTimeout(resolve, 200)); // Rate limit
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error(
        `Error fetching comments for post ${postKey}:`,
        error.message
      );
      hasMore = false; // 오류 발생 시 중단
    }
  }
  console.log(
    `게시물 ${postKey}에서 ${allComments.length}개의 댓글을 가져왔습니다. 최신 타임스탬프: ${latestTs}`
  );
  return {
    comments: allComments,
    latestTimestamp: latestTs,
  };
}
// --- 외부 서비스 호출 구현 끝 ---
// --- DB 저장 헬퍼 ---
async function savePostAndProducts(
  supabase,
  userId,
  post,
  aiAnalysisResult,
  bandKey,
  aiExtractionStatus = "not_attempted" // 추가: AI 추출 상태 매개변수
) {
  if (!userId || !post || !post.postKey) {
    console.error("Invalid inputs for savePostAndProducts");
    return null;
  }
  // AI 분석 결과가 없으면 상품 없는 일반 게시물로 처리
  const isProductPost = !!(
    aiAnalysisResult &&
    Array.isArray(aiAnalysisResult.products) &&
    aiAnalysisResult.products.length > 0 &&
    aiAnalysisResult.products[0] &&
    aiAnalysisResult.products[0].productId
  );
  const postId = userId + "_post_" + post.postKey;
  const dateObject = new Date(post.createdAt);
  try {
    // 1. posts 테이블에 게시물 정보 Upsert
    const postDataToUpsert = {
      post_id: postId,
      user_id: userId,
      band_key: bandKey,
      content: post.content || "",
      title:
        isProductPost && aiAnalysisResult?.products[0]?.title
          ? aiAnalysisResult.products[0].title
          : post.content?.substring(0, 50) || "무제",
      author_name: post.author?.name || "",
      author_id: post.author?.user_id || "",
      comment_count: post.commentCount || 0,
      status: "활성",
      posted_at: dateObject.toISOString(),
      is_product: isProductPost || aiExtractionStatus === "failed",
      updated_at: new Date().toISOString(),
      post_key: post.postKey,
      ai_extraction_status: aiExtractionStatus,
    };
    const { data: upsertedPostData, error: postUpsertError } = await supabase
      .from("posts")
      .upsert(postDataToUpsert, {
        onConflict: "post_id",
        ignoreDuplicates: false,
      })
      .select("post_id")
      .single();
    if (postUpsertError) {
      console.error(
        `Post ${post.postKey} Supabase 저장 오류:`,
        postUpsertError
      );
      return null;
    }
    if (!upsertedPostData || !upsertedPostData.post_id) {
      console.error(`Failed to get post ID after upsert for ${post.postKey}`);
      return null;
    }
    console.log(
      `Post ${post.postKey} upserted in Supabase (ID: ${upsertedPostData.post_id}, AI 추출 상태: ${aiExtractionStatus}).`
    );
    // 2. products 테이블에 상품 정보 Upsert (성공적인 AI 분석 결과가 있을 경우에만)
    if (
      upsertedPostData.post_id &&
      isProductPost &&
      aiAnalysisResult?.products &&
      aiExtractionStatus === "success"
    ) {
      for (const product of aiAnalysisResult.products) {
        try {
          const productId = product.productId;
          if (!productId) {
            console.log(
              `Post ${post.postKey}: 상품에 productId가 없어 저장을 건너뜁니다.`
            );
            continue;
          }
          const productDataToUpsert = {
            product_id: productId,
            post_id: upsertedPostData.post_id,
            user_id: userId,
            band_key: bandKey,
            post_number: post.postKey,
            item_number: product.itemNumber || 1,
            title: product.title || "",
            content: post.content || "",
            base_price: product.basePrice || 0,
            price_options: product.priceOptions || [],
            quantity: product.quantity || 1,
            quantity_text: product.quantityText || "1개",
            category: product.category || "기타",
            tags: product.tags || [],
            features: product.features || [],
            status: product.status || "판매중",
            pickup_info: product.pickupInfo || "",
            pickup_date: product.pickupDate
              ? new Date(product.pickupDate).toISOString()
              : null,
            pickup_type: product.pickupType || "",
            stock_quantity: product.stockQuantity || null,
            barcode: "",
            updated_at: new Date().toISOString(),
            posted_at: dateObject.toISOString(),
          };
          const { error: productUpsertError } = await supabase
            .from("products")
            .upsert(productDataToUpsert, {
              onConflict: "product_id",
              ignoreDuplicates: false,
            });
          if (productUpsertError) {
            console.error(
              `Product ${productId} (Post ${post.postKey}) Supabase 저장 오류:`,
              productUpsertError
            );
            continue;
          }
          console.log(
            `Product ${productId} (Post ${post.postKey}) upserted in Supabase.`
          );
        } catch (dbError) {
          console.error(
            `Product (Post ${post.postKey}, Item ${product.itemNumber}) Supabase 저장 오류:`,
            dbError
          );
          // 개별 상품 저장 실패는 로깅만 하고 계속 진행
        }
      }
    }
    return upsertedPostData.post_id; // 성공 시 게시물 ID 반환
  } catch (error) {
    console.error(
      `savePostAndProducts 함수 오류 (Post ${post.postKey}):`,
      error
    );
    return null;
  }
}
// 댓글 데이터로부터 주문 정보를 생성하는 함수 (수정됨)
async function generateOrderData(
  supabase,
  userId,
  comments,
  postKey,
  bandKey,
  bandNumber
) {
  const orders = [];
  const customers = new Map();
  const processingSummary = {
    // 처리 요약 정보 (선택적)
    totalCommentsProcessed: comments.length,
    generatedOrders: 0,
    generatedCustomers: 0,
    skippedExcluded: 0,
    skippedClosing: 0,
    skippedMissingInfo: 0,
    errors: [],
  };
  if (!comments || comments.length === 0) {
    console.log(`[주문 생성] 게시물 ${postKey}에 처리할 댓글이 없습니다`);
    return {
      orders,
      customers,
    };
  }
  console.log(
    `[주문 생성] 게시물 ${postKey}의 ${comments.length}개 댓글 처리 시작`
  );
  try {
    // --- 1. 게시물 관련 상품 정보 미리 조회 ---
    const { data: productsData, error: productsError } = await supabase
      .from("products")
      .select("*") // 필요한 필드만 선택하는 것이 더 효율적일 수 있음
      .eq("post_number", postKey)
      .eq("user_id", userId);
    if (productsError) {
      console.error(
        `[주문 생성] Products fetch error for post ${postKey}:`,
        productsError
      );
      // 상품 정보 없이 진행하면 주문 생성이 어려우므로 빈 결과 반환
      processingSummary.errors.push({
        type: "db_product_fetch",
        message: productsError.message,
      });
      return {
        orders,
        customers,
      };
    }
    if (!productsData || productsData.length === 0) {
      console.log(
        `[주문 생성] 게시물 ${postKey}에 대한 DB에서 상품을 찾을 수 없습니다. 주문을 생성할 수 없습니다.`
      );
      // 상품 없으면 주문 생성 불가
      return {
        orders,
        customers,
      };
    }
    // 상품 정보를 item_number를 키로 하는 Map으로 변환 (매칭 용이성)
    const productMap = new Map();
    productsData.forEach((p) => {
      if (p.item_number !== null && typeof p.item_number === "number") {
        productMap.set(p.item_number, p);
      }
    });
    console.log(
      `[주문 생성] 게시물 ${postKey}에 대한 ${productMap.size}개의 상품을 가져왔습니다.`
    );
    const isMultipleProductsPost = productMap.size > 1; // 상품 종류가 2개 이상인지 여부
    // --- 2. 제외 고객 목록 조회 (함수 시작 시 한 번만) ---
    let excludedCustomers = [];
    try {
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("excluded_customers")
        .eq("user_id", userId)
        .single();
      if (userError && userError.code !== "PGRST116") {
        // 결과 없음 오류(PGRST116)는 무시
        throw userError;
      }
      if (
        userData?.excluded_customers &&
        Array.isArray(userData.excluded_customers)
      ) {
        excludedCustomers = userData.excluded_customers
          .filter((name) => typeof name === "string") // 타입 가드 사용
          .map((name) => name.trim());
      }
      console.log(
        `[주문 생성] 사용자 ${userId}에 대한 제외 고객 목록 가져옴:`,
        excludedCustomers
      );
    } catch (e) {
      console.error(
        `[주문 생성] Error fetching excluded customers for user ${userId}: ${e.message}`
      );
      processingSummary.errors.push({
        type: "db_excluded_fetch",
        message: e.message,
      });
      // 오류 발생해도 빈 목록으로 계속 진행
    }
    // --- 3. 댓글 순회 및 처리 ---
    for (const comment of comments) {
      let bandKey = null;
      try {
        // --- 3.1. 기본 정보 추출 및 유효성 검사 ---
        bandKey = comment.bandKey || null; // bandKey 가져오기
        const authorName = comment.author?.name?.trim();
        const authorUserNo = comment.author?.userNo; // Supabase Function에서는 userNo 사용
        const authorProfileUrl = comment.author?.profileImageUrl;
        const commentContent = comment.content;
        const createdAt = safeParseDate(comment.createdAt); // 날짜 파싱
        const commentKey = comment.commentKey;
        if (
          !authorName ||
          !authorUserNo ||
          !commentContent ||
          !createdAt ||
          !commentKey ||
          !postKey ||
          !bandKey
        ) {
          console.warn(
            `[주문 생성] Skipping comment due to missing basic info: commentKey=${commentKey}, postKey=${postKey}, bandKey=${bandKey}`
          );
          processingSummary.skippedMissingInfo++;
          continue;
        }
        // --- 3.2. 제외 고객 필터링 ---
        if (excludedCustomers.includes(authorName)) {
          console.log(
            `[주문 생성] Skipping excluded customer: ${authorName} (comment ${commentKey})`
          );
          processingSummary.skippedExcluded++;
          continue;
        }
        // --- 3.3. 마감 키워드 확인 ---
        // 여기서는 마감 키워드 발견 시 해당 댓글만 건너뜁니다.
        // (기존 로직처럼 이후 댓글 처리를 중단하려면 별도 플래그 필요)
        // if (hasClosingKeywords(commentContent)) {
        //     console.log(`[주문 생성] Skipping closing keyword comment by ${authorName} (comment ${commentKey})`);
        //     processingSummary.skippedClosing++;
        //     continue;
        // }
        // --- 3.4. 댓글에서 주문 정보 추출 ---
        const extractedOrderItems =
          extractEnhancedOrderFromComment(commentContent);
        let representativeItem = null;
        let isProcessedAsOrder = false;
        if (extractedOrderItems && extractedOrderItems.length > 0) {
          // 추출 성공 시 첫 번째 항목 사용
          representativeItem = extractedOrderItems[0];
          console.log(
            `[주문 생성] Processing extracted item for comment ${commentKey}:`,
            representativeItem
          );
          isProcessedAsOrder = true; // 일단 주문으로 처리 시도
        } else {
          // 추출 실패 시: 내용에 숫자가 포함되어 있으면 기본 주문 생성 시도
          if (/\d/.test(commentContent)) {
            console.log(
              `[주문 생성] No specific order extracted for comment ${commentKey}, but contains digits. Creating default order.`
            );
            representativeItem = {
              itemNumber: 1,
              quantity: 1,
              isAmbiguous: false,
            };
            isProcessedAsOrder = true;
          } else {
            console.log(
              `[주문 생성] Skipping comment ${commentKey} as no order info extracted and no digits found.`
            );
            continue;
          }
        }
        // --- 3.5. 주문으로 처리 결정 시 ---
        if (isProcessedAsOrder && representativeItem) {
          // --- 3.5.1. 고객 정보 생성 또는 업데이트 준비 ---
          const customerId = generateCustomerUniqueId(userId, authorUserNo);
          if (!customers.has(customerId)) {
            customers.set(customerId, {
              customer_id: customerId,
              user_id: userId,
              band_key: bandKey,
              band_user_id: authorUserNo,
              customer_name: authorName,
              profile_image: authorProfileUrl || "",
              first_order_at: createdAt.toISOString(),
              last_order_at: createdAt.toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
            processingSummary.generatedCustomers++;
          } else {
            // 기존 고객 정보 업데이트 (마지막 주문 시간 등)
            const existingCustomer = customers.get(customerId);
            if (new Date(existingCustomer.last_order_at) < createdAt) {
              existingCustomer.last_order_at = createdAt.toISOString();
            }
            existingCustomer.updated_at = new Date().toISOString();
            existingCustomer.customer_name = authorName; // 이름 업데이트될 수 있으므로 갱신
            existingCustomer.profile_image = authorProfileUrl || ""; // 프로필 이미지 업데이트
          }
          // --- 3.5.2. 상품 매칭 및 가격 계산 ---
          let isAmbiguous = representativeItem.isAmbiguous || false;
          let productId = null;
          let itemNumber = representativeItem.itemNumber || 1;
          let quantity = representativeItem.quantity || 1;
          let basePriceForOrder = 0;
          let calculatedTotalAmount = 0;
          let priceOptionDescription = null; // 가격 옵션 설명
          let subStatusList = [];
          let matchedExactly = false; // 정확히 매칭되었는지 여부
          let productInfo = null; // 매칭된 상품 정보
          // itemNumber로 상품 찾기
          if (itemNumber !== null && productMap.has(itemNumber)) {
            productInfo = productMap.get(itemNumber);
            if (productInfo && productInfo.product_id) {
              productId = productInfo.product_id;
              matchedExactly = !isAmbiguous;
              console.log(
                `  [PID Match] Exact match for comment ${commentKey}: productId=${productId}, itemNumber=${itemNumber}`
              );
            } else {
              console.warn(
                `  [PID Match Warning] Comment ${commentKey}: Product info found for itemNumber ${itemNumber}, but product_id is missing.`
              );
              productInfo = null; // 유효하지 않으면 null 처리
            }
          }
          // 매칭 실패 또는 모호한 경우 itemNumber 1로 폴백 시도
          if (!productId && productMap.has(1)) {
            const defaultProductInfo = productMap.get(1);
            if (defaultProductInfo && defaultProductInfo.product_id) {
              productId = defaultProductInfo.product_id;
              productInfo = defaultProductInfo;
              itemNumber = 1; // itemNumber 1로 확정
              isAmbiguous = true; // 폴백했으므로 모호함
              console.log(
                `  [PID Fallback] Comment ${commentKey}: Using default productId=${productId} (itemNumber set to 1).`
              );
              if (!subStatusList.includes("상품 추정"))
                subStatusList.push("상품 추정");
            } else {
              console.warn(
                `  [PID Fallback Warning] Comment ${commentKey}: Default product (itemNumber 1) found, but product_id is missing.`
              );
              productInfo = null;
            }
          }
          // 최종 productId 확인
          if (!productId || !productInfo) {
            console.error(
              `  [PID Match Failed] Comment ${commentKey}: Could not determine valid productId. Order will have null productId and 0 price.`
            );
            if (!subStatusList.includes("상품 매칭 불가"))
              subStatusList.push("상품 매칭 불가");
            isAmbiguous = true;
            productInfo = null;
          }
          // 가격 계산
          if (productInfo) {
            const productOptions = productInfo.price_options || [];
            const fallbackPrice =
              typeof productInfo.base_price === "number"
                ? productInfo.base_price
                : 0;
            basePriceForOrder = fallbackPrice;
            try {
              calculatedTotalAmount = calculateOptimalPrice(
                quantity,
                productOptions,
                fallbackPrice
              );
              console.log(
                `  [Price Calc] Comment ${commentKey}: BasePrice=${basePriceForOrder}, Quantity=${quantity}, Total=${calculatedTotalAmount}`
              );
              // 가격 옵션 설명 (옵션)
              const matchingOption = productOptions.find(
                (opt) => opt.quantity === quantity
              );
              if (matchingOption) {
                priceOptionDescription =
                  matchingOption.description || `${quantity} 단위 옵션`;
              } else if (quantity === 1) {
                // 기본 수량일 때
                priceOptionDescription = productInfo.title
                  ? `기본 (${productInfo.title})`
                  : "기본 가격";
              } else {
                priceOptionDescription = productInfo.title
                  ? `${quantity}개 (${productInfo.title})`
                  : `${quantity}개`;
              }
            } catch (calcError) {
              console.error(
                `  [Price Calc Error] Comment ${commentKey}: Error during calculateOptimalPrice: ${calcError.message}`
              );
              calculatedTotalAmount = 0;
              if (!subStatusList.includes("금액 계산 오류"))
                subStatusList.push("금액 계산 오류");
              isAmbiguous = true;
            }
          } else {
            console.warn(
              `  [Price Calc Skip] Comment ${commentKey}: Skipping calculation due to missing productInfo.`
            );
            basePriceForOrder = 0;
            calculatedTotalAmount = 0;
            if (!subStatusList.includes("가격 확인 불가"))
              subStatusList.push("가격 확인 불가");
          }
          // --- 3.5.3. 최종 주문 상태 결정 ---
          let finalSubStatus =
            subStatusList.length > 0 ? subStatusList.join(", ") : null;
          // 댓글에 숫자가 없는 경우에만 '확인필요' 상태 추가
          if (!/\d/.test(commentContent)) {
            if (!finalSubStatus) {
              finalSubStatus = "확인필요"; // 숫자가 없으면 기본 '확인필요'
            } else if (!finalSubStatus.includes("확인필요")) {
              finalSubStatus += ", 확인필요"; // 다른 상태와 함께 '확인필요' 추가
            }
          }
          // 여러 상품 게시물인데 정확히 매칭되지 않은 경우 '상품 지정 모호' 추가
          if (
            isMultipleProductsPost &&
            productId &&
            !matchedExactly &&
            (!finalSubStatus || !finalSubStatus.includes("상품 확인 필요"))
          ) {
            finalSubStatus = finalSubStatus
              ? `${finalSubStatus}, 상품 확인 필요`
              : "상품 확인 필요";
          }
          // --- 3.5.4. 주문 데이터 객체 생성 ---
          const orderId = generateOrderUniqueId(
            bandKey,
            postKey,
            commentKey,
            itemNumber
          ); // 고유 ID 생성
          const orderData = {
            order_id: orderId,
            customer_id: customerId,
            user_id: userId,
            band_key: bandKey,
            band_number: bandNumber,
            post_key: postKey,
            post_number: null,
            comment_key: commentKey,
            customer_name: authorName,
            product_id: productId,
            item_number: itemNumber,
            quantity: quantity,
            price: basePriceForOrder,
            total_amount: calculatedTotalAmount,
            status: "주문완료",
            sub_status: finalSubStatus,
            comment: commentContent,
            ordered_at: createdAt.toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          orders.push(orderData);
          processingSummary.generatedOrders++;
          console.log(
            `[주문 생성] Generated order ${orderId} for comment ${commentKey}`
          );
        }
      } catch (error) {
        console.error(
          `[주문 생성] Error processing comment ${comment?.commentKey} on post ${postKey}: ${error.message}`,
          error.stack
        );
        processingSummary.errors.push({
          commentKey: comment?.commentKey,
          postKey: postKey,
          error: error.message,
        });
      }
    } // End of comment loop
    console.log(
      `[주문 생성] Finished processing for post ${postKey}. Summary: ${JSON.stringify(
        processingSummary
      )}`
    );
    return {
      orders,
      customers,
    };
  } catch (error) {
    // 함수 전체의 최상위 오류 처리
    console.error(`[주문 생성] Unhandled error for post ${postKey}:`, error);
    processingSummary.errors.push({
      type: "function_error",
      message: error.message,
    });
    // 오류 발생 시에도 현재까지 처리된 데이터라도 반환할 수 있도록 함
    return {
      orders,
      customers,
    };
  }
}
// --- DB 저장 헬퍼 (savePostAndProducts - 위 유틸리티 섹션에서 정의됨) ---
// 환경 변수로부터 URL 생성
// ========================================================================
// === 메인 함수 로직 시작 ===
// ========================================================================
Deno.serve(async (req) => {
  // OPTIONS 처리
  if (req.method === "OPTIONS")
    return new Response(null, {
      headers: corsHeadersGet,
      status: 204,
    });
  // GET 외 거부
  if (req.method !== "GET")
    return new Response(
      JSON.stringify({
        success: false,
        message: "허용되지 않는 메소드 (GET)",
      }),
      {
        status: 405,
        headers: responseHeaders,
      }
    );
  let supabase;
  try {
    // Supabase 클라이언트 초기화
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey)
      throw new Error("Missing Supabase URL or Service Role Key");
    supabase = createClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    console.log("Supabase client initialized.");
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        message: error.message,
      }),
      {
        status: 500,
        headers: responseHeaders,
      }
    );
  }
  try {
    // URL 파라미터 추출
    const url = new URL(req.url);
    const params = url.searchParams;
    const userId = params.get("userId");
    if (!userId)
      return new Response(
        JSON.stringify({
          success: false,
          message: "쿼리 파라미터 'userId'가 필요합니다.",
        }),
        {
          status: 400,
          headers: responseHeaders,
        }
      );
    const requestedLimit = parseInt(params.get("limit") || "100", 10);
    const processingLimit = Math.min(
      requestedLimit > 0 ? requestedLimit : 100,
      200
    );
    const processWithAI = params.get("processAI")?.toLowerCase() !== "false";
    console.log(
      `band-get-posts 호출됨 (인증 없음): userId=${userId}, limit=${processingLimit}, processAI=${processWithAI}`
    );
    // === 메인 로직 ===
    // 1. Band API 게시물 가져오기
    console.log(`[1단계] 밴드 API에서 게시물 가져오는 중...`);
    const { posts, bandKey, bandNumber } = await fetchBandPosts(
      userId,
      processingLimit,
      supabase
    ); // Supabase client 전달
    console.log(`[1단계] ${posts.length}개의 게시물을 가져왔습니다.`);
    if (!Array.isArray(posts))
      throw new Error("Failed to fetch posts or invalid format.");
    let postsWithAnalysis = [];
    let postsToUpdateCommentInfo = [];
    // 2. DB 기존 게시물 조회
    console.log(`[2단계] DB에서 기존 게시물 정보 가져오는 중...`);
    const dbPostsMap = new Map();
    if (posts.length > 0) {
      try {
        const postKeys = posts.map((p) => p.postKey).filter(Boolean);
        if (postKeys.length > 0) {
          const { data: dbPosts, error: dbError } = await supabase
            .from("posts")
            .select(
              "post_key, comment_count, last_checked_comment_at, is_product"
            )
            .eq("user_id", userId)
            .in("post_key", postKeys);
          if (dbError) throw dbError;
          dbPosts?.forEach((dbPost) => {
            dbPostsMap.set(dbPost.post_key, {});
          });
          console.log(
            `[2단계] ${dbPostsMap.size}개의 기존 게시물을 찾았습니다.`
          );
        } else {
          console.log("[2단계] API에서 유효한 게시물 키가 없습니다.");
        }
      } catch (error) {
        console.error(`[2단계] DB post fetch error: ${error.message}`);
      }
      // 4. 게시물 순회 및 처리
      console.log(`[4단계] ${posts.length}개의 API 게시물 처리 중...`);
      const processingPromises = posts.map(async (apiPost) => {
        if (
          !apiPost ||
          !apiPost.postKey ||
          !apiPost.bandKey ||
          !apiPost.author
        ) {
          console.warn("Skipping invalid post data:", apiPost);
          return null; // 유효하지 않으면 null 반환하여 나중에 필터링
        }
        const postKey = apiPost.postKey;
        const dbPostData = dbPostsMap.get(postKey);
        const isNewPost = !dbPostData;
        let aiAnalysisResult = null;
        let savedPostId = null;
        let processCommentsAndOrders = false;
        let postProcessingError = null; // 게시물별 오류 저장
        let aiExtractionStatus = "not_attempted"; // AI 추출 상태 초기값
        console.log(
          `  -> 게시물 ${postKey} 처리 중 (${isNewPost ? "신규" : "기존"})`
        );
        try {
          // 개별 게시물 처리 try-catch
          if (isNewPost) {
            // === 신규 게시물 처리 ===
            const mightBeProduct = contentHasPriceIndicator(apiPost.content);
            if (mightBeProduct && processWithAI) {
              try {
                const postTime = apiPost.createdAt;
                aiAnalysisResult = await extractProductInfoAI(
                  apiPost.content,
                  postTime,
                  postKey
                );
                // AI 분석 결과 검증 - 유효한 상품 정보가 있는지 확인
                const hasValidProducts = !!(
                  aiAnalysisResult &&
                  aiAnalysisResult.products &&
                  aiAnalysisResult.products.length > 0 &&
                  aiAnalysisResult.products.some(
                    (p) =>
                      p.title &&
                      !p.title.includes("AI 분석 필요") &&
                      !p.title.includes("정보 없음") &&
                      p.basePrice > 0
                  )
                );
                if (hasValidProducts) {
                  // 유효한 상품 정보가 있는 경우 - 성공 처리
                  aiExtractionStatus = "success";
                  aiAnalysisResult.products = aiAnalysisResult.products.map(
                    (p) =>
                      processProduct(
                        {
                          ...p,
                        },
                        postTime
                      )
                  );
                  aiAnalysisResult.products.forEach((p, idx) => {
                    if (!p.productId) {
                      p.productId = generateProductUniqueIdForItem(
                        userId,
                        bandKey,
                        postKey,
                        p.itemNumber ?? idx + 1
                      );
                    }
                  });
                  processCommentsAndOrders = true;
                } else {
                  // 유효한 상품 정보가 없는 경우 - 실패 처리
                  console.log(`게시물 ${postKey}: AI로 상품 정보 추출 실패`);
                  aiExtractionStatus = "failed";
                  // 상품 정보는 없지만 게시물 정보는 저장하기 위해 빈 상품 정보 설정
                  aiAnalysisResult = getDefaultProduct("AI 추출 실패");
                }
              } catch (aiError) {
                // AI 호출 자체가 실패한 경우
                console.error(
                  `게시물 ${postKey}: AI 분석 중 오류 발생`,
                  aiError
                );
                aiExtractionStatus = "error";
                aiAnalysisResult = getDefaultProduct(
                  `AI 오류: ${aiError.message}`
                );
              }
            } else {
              // 상품 게시물이 아닌 경우
              aiExtractionStatus = mightBeProduct
                ? "not_attempted"
                : "not_product";
              aiAnalysisResult = getDefaultProduct(
                mightBeProduct ? "AI 비활성화" : "상품 아님"
              );
            }
            // DB 저장 - 모든 게시물을 저장하되 AI 추출 상태를 함께 저장
            savedPostId = await savePostAndProducts(
              supabase,
              userId,
              apiPost,
              aiAnalysisResult,
              bandKey,
              aiExtractionStatus
            );
            if (!savedPostId) throw new Error("Post save failed"); // 저장 실패 시 오류 발생
            // 댓글 처리 및 주문 생성 - 성공적으로 상품 추출된 경우에만
            if (
              processCommentsAndOrders &&
              (apiPost.commentCount ?? 0) > 0 &&
              aiExtractionStatus === "success"
            ) {
              let newComments = [];
              try {
                const { comments } = await fetchBandComments(
                  userId,
                  postKey,
                  bandKey,
                  supabase
                );
                newComments = comments.map((c) => ({
                  ...c,
                  post_key: postKey,
                  band_key: bandKey,
                  commentKey: c.commentKey,
                  createdAt: c.createdAt,
                  author: c.author,
                }));
              } catch (commentError) {
                console.error(
                  `  Comment fetch error for new post ${postKey}: ${commentError.message}`
                );
              }
              if (newComments.length > 0) {
                try {
                  const { orders, customers } = await generateOrderData(
                    supabase,
                    userId,
                    newComments,
                    postKey,
                    bandKey,
                    bandNumber
                  );
                  // 주문/고객 저장
                  if (orders.length > 0) {
                    const { error } = await supabase
                      .from("orders")
                      .upsert(orders, {
                        onConflict: "order_id",
                      });
                    if (error)
                      console.error(
                        `    Order save error (post ${postKey}): ${error.message}`
                      );
                    else console.log(`    Saved ${orders.length} orders.`);
                  }
                  const customersArray = Array.from(customers.values());
                  if (customersArray.length > 0) {
                    const { error } = await supabase
                      .from("customers")
                      .upsert(customersArray, {
                        onConflict: "customer_id",
                      });
                    if (error)
                      console.error(
                        `    Customer save error (post ${postKey}): ${error.message}`
                      );
                    else
                      console.log(
                        `    Saved ${customersArray.length} customers.`
                      );
                  }
                } catch (genError) {
                  console.error(
                    `  Order generation error for new post ${postKey}: ${genError.message}`
                  );
                }
              }
            }
          } else {
            // === 기존 게시물 처리 ===
            savedPostId = `${userId}_post_${postKey}`;
            // 이미 처리된 일반 게시물(is_product=false)은 스킵
            if (
              dbPostData.is_product === false &&
              dbPostData.ai_extraction_status !== "failed"
            ) {
              return {
                ...apiPost,
                aiAnalysisResult: null,
                dbPostId: savedPostId,
              };
            }
            // 이전에 AI 추출 실패한 게시물은 재시도
            const needsAiRetry =
              dbPostData.is_product === true &&
              (dbPostData.ai_extraction_status === "failed" ||
                dbPostData.ai_extraction_status === "error");
            if (needsAiRetry && processWithAI) {
              console.log(
                `재시도: 게시물 ${postKey}의 상품 정보 추출 (이전 상태: ${dbPostData.ai_extraction_status})`
              );
              try {
                const postTime = apiPost.createdAt;
                aiAnalysisResult = await extractProductInfoAI(
                  apiPost.content,
                  postTime,
                  postKey
                );
                const hasValidProducts = !!(
                  aiAnalysisResult &&
                  aiAnalysisResult.products &&
                  aiAnalysisResult.products.length > 0 &&
                  aiAnalysisResult.products.some(
                    (p) =>
                      p.title &&
                      !p.title.includes("AI 분석 필요") &&
                      !p.title.includes("정보 없음") &&
                      p.basePrice > 0
                  )
                );
                if (hasValidProducts) {
                  aiExtractionStatus = "success";
                  aiAnalysisResult.products = aiAnalysisResult.products.map(
                    (p) =>
                      processProduct(
                        {
                          ...p,
                        },
                        postTime
                      )
                  );
                  aiAnalysisResult.products.forEach((p, idx) => {
                    if (!p.productId) {
                      p.productId = generateProductUniqueIdForItem(
                        userId,
                        bandKey,
                        postKey,
                        p.itemNumber ?? idx + 1
                      );
                    }
                  });
                  // 재시도 성공 시 DB 업데이트
                  savedPostId = await savePostAndProducts(
                    supabase,
                    userId,
                    apiPost,
                    aiAnalysisResult,
                    bandKey,
                    aiExtractionStatus
                  );
                  if (!savedPostId) throw new Error("Post retry save failed");
                  // 성공적으로 상품 추출 후 댓글 처리
                  if ((apiPost.commentCount ?? 0) > 0) {
                    // (여기에 댓글 처리 로직)
                  }
                } else {
                  // 재시도해도 실패한 경우
                  console.log(
                    `재시도 실패: 게시물 ${postKey}의 상품 정보 추출`
                  );
                  aiExtractionStatus = "failed";
                  // DB 상태 업데이트 (여전히 실패 상태)
                  await savePostAndProducts(
                    supabase,
                    userId,
                    apiPost,
                    null,
                    bandKey,
                    aiExtractionStatus
                  );
                }
              } catch (retryError) {
                console.error(
                  `재시도 오류: 게시물 ${postKey}의 상품 정보 추출`,
                  retryError
                );
                aiExtractionStatus = "error";
                await savePostAndProducts(
                  supabase,
                  userId,
                  apiPost,
                  null,
                  bandKey,
                  aiExtractionStatus
                );
              }
            }
            const needsCommentUpdate =
              (apiPost.commentCount || 0) > (dbPostData.comment_count || 0);
            if (needsCommentUpdate && aiExtractionStatus === "success") {
              let latestTimestamp = null;
              let newComments = [];
              try {
                const { comments: fullComments, latestTimestamp: ts } =
                  await fetchBandComments(userId, postKey, bandKey, supabase);
                latestTimestamp = ts;
                const lastCheckedTs = dbPostData.last_checked_comment_at || 0;
                newComments = fullComments
                  .filter((c) => c.createdAt > lastCheckedTs)
                  .map((c) => ({
                    ...c,
                    post_key: postKey,
                    band_key: bandKey,
                    commentKey: c.commentKey,
                    createdAt: c.createdAt,
                    author: c.author,
                  }));
                if (newComments.length > 0) {
                  try {
                    const { orders, customers } = await generateOrderData(
                      supabase,
                      userId,
                      newComments,
                      postKey,
                      bandKey,
                      bandNumber
                    );
                    if (orders.length > 0) {
                      /* ... 주문 저장 ... */
                    }
                    const customersArray = Array.from(customers.values());
                    if (customersArray.length > 0) {
                      /* ... 고객 저장 ... */
                    }
                  } catch (genError) {
                    console.error(
                      `  New comment order generation error for post ${postKey}: ${genError.message}`
                    );
                  }
                }
              } catch (commentError) {
                console.error(
                  `  Error fetching/processing comments for post ${postKey}: ${commentError.message}`
                );
              }
              // 업데이트 정보 추가
              const newLastChecked = latestTimestamp
                ? new Date(latestTimestamp).toISOString()
                : new Date().toISOString();
              postsToUpdateCommentInfo.push({
                post_id: savedPostId,
                comment_count: apiPost.commentCount ?? 0,
                last_checked_comment_at: newLastChecked,
              });
            }
          }
          // 성공적으로 처리된 게시물 정보 반환
          return {
            ...apiPost,
            aiAnalysisResult,
            dbPostId: savedPostId,
            aiExtractionStatus,
          };
        } catch (error) {
          console.error(
            `Error processing post ${postKey}: ${error.message}`,
            error.stack
          );
          // 오류 발생 시에도 정보 반환 (에러 포함)
          return {
            postKey: apiPost.postKey,
            bandKey: apiPost.bandKey,
            processingError: error.message,
            aiExtractionStatus: aiExtractionStatus || "error",
          };
        }
      }); // End map
      // 모든 게시물 처리 Promise 완료 기다리기
      const processedResults = await Promise.all(processingPromises);
      // null (유효하지 않은 데이터) 및 성공/실패 결과 분리 가능
      postsWithAnalysis = processedResults.filter((result) => result !== null);
      console.log(
        `[4단계] ${postsWithAnalysis.length}개의 게시물을 처리했습니다.`
      );
      // 5. 댓글 정보 일괄 업데이트
      if (postsToUpdateCommentInfo.length > 0) {
        console.log(
          `[5단계] ${postsToUpdateCommentInfo.length}개의 게시물에 대한 댓글 정보를 일괄 업데이트하는 중...`
        );
        try {
          const { error: updateError } = await supabase
            .from("posts")
            .upsert(postsToUpdateCommentInfo, {
              onConflict: "post_id",
            });
          if (updateError) throw updateError;
          console.log("[5단계] 댓글 정보 일괄 업데이트가 성공했습니다.");
        } catch (error) {
          console.error(
            `[5단계] 댓글 정보 일괄 업데이트 오류: ${error.message}`
          );
        }
      }
    } else {
      console.log("[5단계] 댓글 정보 업데이트가 필요한 게시물이 없습니다.");
    }
    // 6. 사용자의 last_crawl_at 업데이트
    try {
      const currentTimestamp = new Date().toISOString();
      const { error: userUpdateError } = await supabase
        .from("users")
        .update({
          last_crawl_at: currentTimestamp,
        })
        .eq("user_id", userId);
      if (userUpdateError) {
        console.error(
          `[6단계] 사용자 last_crawl_at 업데이트 오류: ${userUpdateError.message}`
        );
      } else {
        console.log(
          `[6단계] 사용자 ${userId}의 last_crawl_at을 ${currentTimestamp}로 업데이트했습니다.`
        );
      }
    } catch (error) {
      console.error(
        `[6단계] 사용자 last_crawl_at 업데이트 중 예외 발생: ${error.message}`
      );
    }
    // 7. 최종 결과 반환
    console.log(
      `[7단계] 처리 완료. ${postsWithAnalysis.length}개의 게시물 결과를 반환합니다.`
    );
    return new Response(
      JSON.stringify({
        success: true,
        data: postsWithAnalysis,
      }),
      {
        status: 200,
        headers: responseHeaders,
      }
    );
  } catch (error) {
    // 함수 전체의 최상위 오류 처리
    console.error("Unhandled error in band-get-posts (No Auth):", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "밴드 게시물 처리 중 심각한 오류 발생",
        error: error.message,
      }),
      {
        status: 500,
        headers: responseHeaders,
      }
    );
  }
});
