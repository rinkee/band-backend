// @ts-nocheck
// supabase/functions/band-get-posts/index.ts - NO JWT AUTH (Security Risk!)
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersGet, createJsonResponseHeaders } from "../_shared/cors.ts"; // CORS 헬퍼 (경로 확인!)
// === 응답 헤더 미리 생성 ===
const responseHeaders = createJsonResponseHeaders(corsHeadersGet);

const AI_MODEL = "gemini-2.5-flash-lite-preview-06-17";

// JSON 직렬화 안전 함수 (순환 참조 방지)
function safeJsonStringify(obj, space = null) {
  try {
    if (obj === null || obj === undefined) {
      return null;
    }

    // 1단계: 기본 타입 체크
    if (typeof obj === "string") {
      // 이미 문자열이면 JSON인지 확인
      try {
        JSON.parse(obj);
        return obj; // 이미 유효한 JSON 문자열
      } catch {
        // JSON이 아닌 일반 문자열이면 JSON으로 변환
        return JSON.stringify(obj);
      }
    }

    if (typeof obj === "number" || typeof obj === "boolean") {
      return JSON.stringify(obj);
    }

    // 2단계: 객체/배열 정리
    const cache = new Set();
    const cleanObj = JSON.parse(
      JSON.stringify(obj, (key, value) => {
        // 순환 참조 방지
        if (typeof value === "object" && value !== null) {
          if (cache.has(value)) {
            return "[Circular Reference]";
          }
          cache.add(value);
        }

        // 문제가 될 수 있는 값들 정리
        if (value === undefined) return null;
        if (typeof value === "function") return "[Function]";
        if (typeof value === "symbol") return "[Symbol]";
        if (typeof value === "bigint") return value.toString();

        // NaN, Infinity 처리
        if (typeof value === "number") {
          if (isNaN(value)) return null;
          if (!isFinite(value)) return null;
        }

        // 빈 객체나 배열 처리
        if (typeof value === "object" && value !== null) {
          if (Array.isArray(value) && value.length === 0) return [];
          if (Object.keys(value).length === 0) return {};
        }

        return value;
      })
    );

    // 3단계: JSON 문자열 생성
    const result = JSON.stringify(cleanObj, null, space);

    // 4단계: 결과 검증 - 다시 파싱해서 유효한 JSON인지 확인
    JSON.parse(result);

    // 5단계: 크기 검증 (PostgreSQL JSON 필드 제한 고려)
    if (result.length > 1000000) {
      // 1MB 제한
      console.warn("JSON 데이터가 너무 큽니다. 요약된 버전을 반환합니다.");
      return JSON.stringify({
        summary: "Data too large",
        originalSize: result.length,
        timestamp: new Date().toISOString(),
        sample: result.substring(0, 1000) + "...",
      });
    }

    return result;
  } catch (error) {
    console.error(
      "JSON stringify error:",
      error.message,
      "Original object type:",
      typeof obj
    );

    // 매우 안전한 fallback JSON 반환
    try {
      return JSON.stringify({
        error: "JSON serialization failed",
        message: error.message,
        originalType: typeof obj,
        timestamp: new Date().toISOString(),
      });
    } catch (fallbackError) {
      // 최후의 수단
      return (
        '{"error":"Critical JSON serialization failure","timestamp":"' +
        new Date().toISOString() +
        '"}'
      );
    }
  }
}
// --- AI 댓글 분석 함수 (Gemini API 호출) ---
// --- AI 댓글 분석 함수 (Gemini API 호출) ---
async function extractOrdersFromCommentsAI(
  postInfo,
  comments,
  bandNumber,
  postId
) {
  const aiApiKey = Deno.env.get("GOOGLE_API_KEY");
  const aiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=${aiApiKey}`;

  if (!aiApiKey || !aiEndpoint || !aiEndpoint.includes("?key=")) {
    console.warn(
      "AI API 키 또는 엔드포인트가 올바르게 구성되지 않았습니다. AI 분석을 건너뜁니다."
    );
    return [];
  }

  if (!comments || comments.length === 0) {
    console.log("[AI 댓글 분석] 댓글이 없어서 AI 분석을 건너뜁니다.");
    return [];
  }

  try {
    console.log(
      `[AI 댓글 분석] ${comments.length}개 댓글에 대한 AI 배치 분석 시작`
    );

    // 게시물 상품 정보 요약 (참고용)
    const productsSummary = postInfo.products
      .map((product, index) => {
        const optionsStr =
          product.priceOptions
            ?.map(
              (opt) =>
                `${opt.description || `${opt.quantity}개`} ${opt.price}원`
            )
            .join(", ") || "옵션 없음";
        return `${index + 1}번 상품: '${product.title}' (옵션: ${optionsStr})`;
      })
      .join("\n");

    // 댓글 정보 요약 (작성자 정보 포함)
    const commentsSummary = comments
      .map((comment, index) => {
        return `댓글 #${index + 1} (key: ${comment.commentKey}, 작성자: ${
          comment.author
        }): "${comment.content}"`;
      })
      .join("\n");

    const systemInstructions = `
당신은 게시물에서 상품정보와 주문 맥락을 파악해서 고객들에 댓글에 단 주문을 orderData로 변환하는  AI입니다. 주어진 게시물과 댓글을 분석하여 정확한 주문 정보를 JSON으로 추출해야 합니다.

### **🚨 가장 중요한 원칙 (절대 위반 금지) 🚨**
- **옵션은 그 자체가 하나의 상품 단위입니다.**
- **(예시)**: 상품명(수량예시) ex)사과 반박스 (12개) 자체가 하나의 상품 단위입니다. 고객이 상품명(수량예시)을 주문하면, 주문 수량(\`quantity\`)은 **1**입니다. 절대로 상품명(수량예시)에 있는 숫자를 수량으로 사용하면 안 됩니다.

### **분석 절차**

**1단계: 게시물의 판매 방식 파악**
- **옵션 판매 방식**: "1번: 반박스(8개)", "2번: 1박스(17과)" 처럼 번호나 이름으로 구분된 명확한 옵션이 있나요?
- **단일 상품 방식**: 옵션 없이 단일 상품(예: 맛조개 400g)만 판매하나요?

**2단계: 댓글 분석 및 주문 추출 (CASE 별 처리)**

**CASE 1: '옵션 판매' 게시물의 경우 (가장 우선)**
- **목표**: 고객이 **어떤 옵션**을 **몇 개** 주문했는지 정확히 찾아냅니다.
- **🚨 정확한 키워드 매칭 원칙 🚨**:
  - 댓글의 키워드를 게시물의 상품명/옵션명과 **정확히** 매칭해야 합니다
  - **예시**: 댓글 "오징어1"은 "오징어" 상품과 매칭, "병어" 상품과 매칭하면 안됩니다
  - **숫자 분리**: "오징어1"에서 "오징어"는 상품명, "1"은 수량으로 분리 분석
  - **유사 단어 주의**: "오징어"와 "병어"는 완전히 다른 상품입니다
  - **🔥 괄호 내 용도 키워드 우선 매칭**: 게시물에 "(제육용)", "(찌개용)" 등의 용도가 명시된 경우, 댓글의 "제육", "찌개" 키워드는 해당 용도와 정확히 매칭해야 합니다
  - **예시**: "제육1" → "돼지후지살(제육용)"과 매칭, "돼지앞다리살(찌개용)"과 매칭하면 안됩니다
- **분석 방법**:
  - 댓글의 키워드를 게시물의 옵션 설명과 **정확히** 매칭
  - 옵션 설명 내 숫자를 보고 주문하는 경우도 고려
  - 옵션명이나 번호로 직접 지정하는 경우 우선 처리
- **출력 (매우 중요)**:
  - \`productItemNumber\`: 고객이 선택한 **옵션의 번호**
  - \`quantity\`: 해당 **옵션의 주문 개수**
- **판단 이유(reason) 작성**: "게시물이 옵션 판매 방식임을 확인. 댓글 '원본댓글내용'에서 '매칭된키워드'를 인지하여 X번 상품(상품명)으로 매칭함."
- **🔥 용도별 매칭 예시**:
  - 댓글 "제육1" + 게시물 "돼지후지살(제육용)" → 정확한 매칭 ✅
  - 댓글 "제육1" + 게시물 "돼지앞다리살(찌개용)" → 잘못된 매칭 ❌
  - 댓글 "찌개1" + 게시물 "돼지앞다리살(찌개용)" → 정확한 매칭 ✅

**CASE 2: '여러 상품' 게시물의 경우**
- **목표**: 각 상품별로 개별 주문을 생성합니다.
- **🔥 중요 원칙**: 
  - 한 댓글에서 여러 상품을 주문하면 각각 별도의 주문 객체를 생성해야 합니다.
  - 상품이 게시물에 존재하고 수량이 명시되어 있으면 **절대 주문을 제외하지 마세요**.
  - **🚨 용도별 정확한 매칭**: "(제육용)", "(찌개용)" 등 괄호 내 용도가 있으면 댓글 키워드와 정확히 매칭
- **분석 방법**:
  - 댓글에서 "상품키워드 + 수량" 패턴을 찾아 분리
  - 각 상품키워드를 게시물의 상품 정보와 **정확히** 매칭 (용도 키워드 우선)
  - 쉼표, 공백, 줄바꿈 등으로 구분된 여러 주문 감지
- **출력**: 각 상품마다 개별 주문 객체 생성
- **판단 이유(reason) 작성**: "여러 상품 주문 감지. 댓글 '원본댓글내용'에서 '매칭된키워드'를 인지하여 X번 상품(상품명)으로 매칭함."

**CASE 3: '단일 상품' 게시물의 경우**
- **목표**: 고객의 요청을 기본 판매 단위로 나눠 수량을 계산합니다.
- **분석 방법**:
  - 게시물에서 기본 판매 단위 식별
  - 댓글의 수량을 기본 단위로 환산
- **출력**:
  - \`productItemNumber\`: 항상 \`1\`
  - \`quantity\`: 계산된 최종 수량

### **[분석 대상 정보]**

**1. 게시물 본문 (Source of Truth)**:
${postInfo.content}

**2. 게시물 상품 정보 (참고용)**:
${productsSummary}

**3. 분석할 댓글 목록**:
${commentsSummary}

### **[기타 규칙]**
- **isOrder**: 주문 의도가 명확하면 \`true\`.
- **isAmbiguous**: 판단이 애매할 때만 \`true\`.
- **여러 상품 주문**: 한 댓글에서 여러 상품을 주문하면 각각 개별 주문 객체로 생성해야 합니다.
- **주문 제외 금지**: 상품이 게시물에 존재하고 수량이 명시되어 있으면 절대 주문을 제외하지 마세요.

---
🔥 **최종 출력 형식 (반드시 준수)**:
{
  "orders": [
    {
      "commentKey": "댓글의 고유 키",
      "isOrder": true,
      "isAmbiguous": false,
      "productItemNumber": 1,
      "quantity": 1,
      "reason": "댓글 '김광희 3110 상무점 오징어1'에서 '오징어1'을 인지하여 1번 상품(오징어)으로 매칭함.",
      "commentContent": "원본 댓글 내용 전체",
      "author": "댓글 작성자명"
    },
    {
      "commentKey": "댓글의 고유 키",
      "isOrder": true,
      "isAmbiguous": false,
      "productItemNumber": 2,
      "quantity": 2,
      "reason": "댓글 '홍길동 병어2'에서 '병어2'를 인지하여 2번 상품(병어)으로 매칭함.",
      "commentContent": "원본 댓글 내용 전체",
      "author": "댓글 작성자명"
    }
  ]
}
`.trim();

    // API 요청 본문 생성
    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: systemInstructions,
            },
          ],
        },
      ],
    };

    const response = await fetch(aiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(
        `AI API HTTP 오류: ${response.status} ${response.statusText}`
      );
    }

    const result = await response.json();
    const responseText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText) {
      throw new Error("AI 응답에서 텍스트를 찾을 수 없습니다.");
    }

    const cleanedJsonString = responseText
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsedResult = JSON.parse(cleanedJsonString);

    if (
      !parsedResult ||
      !Array.isArray(parsedResult.orders) ||
      parsedResult.orders.length !== comments.length
    ) {
      console.warn(
        `[AI 댓글 분석] 경고: AI 응답의 주문 수가 원본 댓글 수와 다릅니다. AI 응답 수: ${
          parsedResult.orders?.length || 0
        }, 댓글 수: ${comments.length}`
      );
    }
    return parsedResult.orders || [];
  } catch (error) {
    console.error("[AI 댓글 분석] AI 처리 중 심각한 오류 발생:", error.message);
    return []; // 오류 발생 시 빈 배열 반환하여 시스템 중단 방지
  }
}

// --- 취소 댓글 처리 함수 ---
async function processCancellationComments(
  supabase,
  userId,
  comments,
  postKey,
  bandKey,
  bandNumber
) {
  try {
    console.log(`[취소 처리] 게시물 ${postKey}의 댓글에서 취소 요청 확인 시작`);

    // 취소 관련 키워드 패턴
    const cancellationPatterns = [
      /취소/i,
      /주문\s*취소/i,
      /취소해\s*주세요/i,
      /취소\s*요청/i,
      /취소할게요/i,
      /취소\s*해주세요/i,
      /주문\s*취소\s*합니다/i,
    ];

    // 댓글들을 시간순으로 정렬 (작성 시간 기준)
    const sortedComments = [...comments].sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeA - timeB;
    });

    let cancellationCount = 0;

    for (let i = 0; i < sortedComments.length; i++) {
      const comment = sortedComments[i];
      const commentContent = comment.content?.trim() || "";

      // 취소 댓글인지 확인
      const isCancellation = cancellationPatterns.some((pattern) =>
        pattern.test(commentContent)
      );

      if (isCancellation) {
        console.log(
          `[취소 감지] 댓글: "${commentContent}" (작성자: ${comment.author})`
        );

        // 이 사용자의 이전 주문들을 찾아서 취소 처리
        const authorUserNo = comment.authorUserNo || comment.author_user_no;

        if (authorUserNo) {
          await cancelPreviousOrders(
            supabase,
            userId,
            postKey,
            bandKey,
            bandNumber,
            authorUserNo,
            comment.createdAt,
            commentContent
          );
          cancellationCount++;
        } else {
          console.log(
            `[취소 처리] 댓글 작성자 정보가 없어 취소 처리할 수 없습니다: "${commentContent}"`
          );
        }
      }
    }

    if (cancellationCount > 0) {
      console.log(
        `[취소 처리] 총 ${cancellationCount}개의 취소 댓글 처리 완료`
      );
    }
  } catch (error) {
    console.error(`[취소 처리] 오류:`, error);
  }
}

// --- 이전 주문 취소 처리 함수 ---
async function cancelPreviousOrders(
  supabase,
  userId,
  postKey,
  bandKey,
  bandNumber,
  authorUserNo,
  cancellationTime,
  cancellationComment
) {
  try {
    // 이 사용자의 해당 게시물에서 취소 댓글 이전의 주문들을 찾기
    const { data: existingOrders, error: ordersError } = await supabase
      .from("orders")
      .select(
        "id, order_id, created_at, sub_status, customer_name, quantity, total_price"
      )
      .eq("user_id", userId)
      .eq("post_key", postKey)
      .eq("band_key", bandKey)
      .eq("author_user_no", authorUserNo)
      .neq("sub_status", "취소요청") // 이미 취소 요청된 것은 제외
      .neq("sub_status", "취소완료") // 이미 취소 완료된 것은 제외
      .order("created_at", { ascending: false });

    if (ordersError) {
      console.error(`[취소 처리] 기존 주문 조회 오류:`, ordersError);
      return;
    }

    if (!existingOrders || existingOrders.length === 0) {
      console.log(
        `[취소 처리] 사용자 ${authorUserNo}의 게시물 ${postKey}에서 취소할 주문이 없습니다`
      );
      return;
    }

    // 취소 댓글 시간 이전의 주문들만 필터링
    const cancellationDate = new Date(cancellationTime);
    const ordersToCancel = existingOrders.filter((order) => {
      const orderDate = new Date(order.created_at);
      return orderDate < cancellationDate;
    });

    if (ordersToCancel.length === 0) {
      console.log(`[취소 처리] 취소 댓글 이전에 생성된 주문이 없습니다`);
      return;
    }

    // 주문들의 sub_status를 '취소요청'으로 업데이트
    const orderIds = ordersToCancel.map((order) => order.id);

    const { error: updateError } = await supabase
      .from("orders")
      .update({
        sub_status: "취소요청",
        updated_at: new Date().toISOString(),
      })
      .in("id", orderIds);

    if (updateError) {
      console.error(`[취소 처리] 주문 상태 업데이트 오류:`, updateError);
      return;
    }

    // 성공 로그
    console.log(
      `[취소 처리] 사용자 ${authorUserNo}의 ${ordersToCancel.length}개 주문 상태를 '취소요청'으로 변경`
    );
    ordersToCancel.forEach((order) => {
      console.log(
        `  - 주문 ID: ${order.order_id}, 고객: ${order.customer_name}, 수량: ${order.quantity}, 금액: ${order.total_price}`
      );
    });

    // 취소 로그 저장 (선택적)
    try {
      await supabase.from("order_logs").insert({
        user_id: userId,
        post_key: postKey,
        band_key: bandKey,
        action: "취소요청",
        details: {
          author_user_no: authorUserNo,
          cancelled_orders: ordersToCancel.length,
          cancellation_comment: cancellationComment,
          order_ids: ordersToCancel.map((o) => o.order_id),
        },
        created_at: new Date().toISOString(),
      });
    } catch (logError) {
      // 로그 저장 실패는 무시 (주요 기능에 영향 없음)
      console.warn(`[취소 처리] 로그 저장 실패:`, logError);
    }
  } catch (error) {
    console.error(`[취소 처리] cancelPreviousOrders 오류:`, error);
  }
}

// --- AI 정보 추출 함수 (Gemini API 호출 가정) ---
async function extractProductInfoAI(content, postTime = null, postKey) {
  // console.log(`[AI 분석] postKey: ${postKey}에 대한 분석 시작.`);
  // ⚠️ 실제 환경 변수 이름으로 변경하세요 (예: GEMINI_API_KEY)
  const aiApiKey = Deno.env.get("GOOGLE_API_KEY");
  // ⚠️ Gemini API 엔드포인트 확인 필요 (예시)
  const aiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=${aiApiKey}`; // 모델명 확인 및 엔드포인트 확인
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
당신은 텍스트에서 상품 정보를 추출하여 지정된 JSON 형식으로만 응답하는 AI입니다. 다른 텍스트는 절대 포함하지 마세요.
[핵심 추출 규칙]
가격 판별 (매우 중요):
오직 고객이 실제로 지불하는 '판매 가격'만 추출하세요. 원가, 정상가, 시중가 등은 모두 무시합니다.
할인 처리: 동일 단위에 가격이 여러 개 표시되면(예: 13,900원 -> 10,900원), 항상 마지막/가장 낮은 가격을 '판매 가격'으로 간주합니다.
가격을 절대 나누지 마세요: '3팩 묶음', '2개입 세트' 처럼 여러 개가 포함된 묶음 상품의 가격이 명시된 경우, 그 가격은 묶음 전체에 대한 가격입니다. 절대로 낱개 가격으로 나누어 계산하지 마세요.
basePrice: 유효한 판매 가격 옵션 중 가장 기본 단위(보통 quantity: 1)의 가격입니다. 유효한 가격이 없으면 0으로 설정합니다.
🔥 quantity 필드 (priceOptions 내): 고객이 주문하는 '판매 단위'의 개수만을 나타냅니다. 절대로 무게, 용량, 내용물 개수가 아닙니다!
- ✅ 올바른 예시:
  • "오렌지 1봉지(6알) 8,900원" → quantity: 1 (봉지 1개)
  • "오렌지 2봉지(12알) 16,900원" → quantity: 2 (봉지 2개)  
  • "맛조개 400g" → quantity: 1 (상품 1개, 400g은 내용량일 뿐)
  • "사과 3kg" → quantity: 1 (상품 1개, 3kg은 내용량일 뿐)
- ❌ 잘못된 예시:
  • "맛조개 400g" → quantity: 400 (절대 안됨!)
  • "사과 3kg" → quantity: 3 (절대 안됨!)
  • "오렌지 1봉지(6알)" → quantity: 6 (절대 안됨!)
고객이 "맛조개 2개 주세요"라고 하면 quantity: 2인 옵션을 찾는 것입니다. 무게나 용량은 quantity와 전혀 관계없습니다.
상품 구분 (multipleProducts):
true (여러 상품): 상품명이 명확히 다르거나(예: 사과, 배), 종류가 다르거나(예: 빨간 파프리카, 노란 파프리카), 번호/줄바꿈으로 구분된 경우. 특히 빵집 메뉴처럼 여러 품목이 나열된 경우에 해당합니다.
false (단일 상품): 동일 상품의 용량/수량별 옵션만 있는 경우(예: 우유 500ml, 우유 1L / 1봉 5000원, 2봉 3000원 ).
keywordMappings :
- **고유성 원칙**: 키워드는 다른 상품과 명확히 구별되는 **고유한 단어**여야 합니다.
  - **애매한 일반 명사 절대 금지**: '복숭아'처럼 여러 상품에 해당될 수 있는 일반 명사는 절대 키워드로 사용하지 마세요.
  - **해결책**: '대극천', '조대홍'처럼 구체적인 품종이나 고유 명칭을 키워드로 사용하세요.
  - **예외**: 게시물에 '복숭아' 상품이 단 하나만 존재할 경우에만 '복숭아'를 키워드로 사용할 수 있습니다.
- **고객 사용 단어**: 고객이 실제로 주문할 때 사용할 단어("대극천 1개 혹은 대극천 복숭아 1개")를 상상하여 추출합니다.
- **🔥 부분 키워드 포함**: 상품명이 길거나 복합어일 경우 고객이 축약어로 주문할 가능성을 고려해야 합니다.
  - **예시 1**: "콩나물"과 "녹두나물" → "콩나물", "녹두나물", "콩", "녹두" 모두 포함
  - **예시 2**: "대천복숭아"와 "조대홍복숭아" → "대천", "조대홍" (겹치는 "복숭아"는 제외)
  - **예시 3**: "빨간파프리카"와 "노란파프리카" → "빨간", "노란", "빨간파프리카", "노란파프리카"
- **🔥 괄호 안 용도 표기 필수 포함**: 상품명에 (제육용), (찌개용), (구이용) 등의 용도가 괄호로 표기된 경우, 괄호 안의 단어를 반드시 키워드에 포함하세요.
  - **예시 1**: "돼지후지살(제육용)" → "제육", "제육용", "후지살", "돼지후지살" 모두 포함
  - **예시 2**: "돼지앞다리살(찌개용)" → "찌개", "찌개용", "앞다리살", "돼지앞다리살" 모두 포함
  - **예시 3**: "한우등심(구이용)" → "구이", "구이용", "등심", "한우등심" 모두 포함
- **단위/수량 제외**: "1키로", "1팩" 등은 키워드가 아닙니다.
- **번호 포함**: "1번", "2번" 같은 키워드는 항상 포함합니다.
- **🔥 인덱스 규칙**: productIndex는 반드시 1부터 시작합니다. (0이 아님! itemNumber와 동일해야 함)


주의사항:
- 다른 상품과 구별되는 고유한 키워드여야 함
- 단위나 수량은 키워드에 포함하지 않음 ("1키로", "1팩" 등은 제외)
- 고객이 "참외요", "대극천1개" 같이 주문할 때 사용할 단어
[JSON 필드 정의]
title: [M월D일] 상품명 형식. 날짜는 게시물 작성 시간 기준. 상품명은 괄호/부가정보 없이 자연스럽게 띄어쓰기(예: [5월17일] 성주꿀참외).
priceOptions: [{ "quantity": 숫자, "price": 숫자, "description": "옵션설명" }] 배열.
🔥 **(중요) 최종 판매가만 포함:** 게시물에 여러 가격이 표시된 경우(예: 정가, 할인가, 특가), 고객이 실제로 지불하는 **가장 낮은 최종 가격만** 이 배열에 포함해야 합니다. 이전 가격(정가, 시중가 등)은 절대 포함하지 마세요.
quantity: 판매 단위의 개수만! 무게/용량/내용물 개수 절대 금지! (예: "2봉지" → quantity: 2, "맛조개 400g" → quantity: 1)
description: 주문 단위를 명확히 설명하는 텍스트 (예: "1봉지(6알)", "맛조개 400g").
basePrice에 해당하는 옵션도 반드시 포함해야 합니다.
🔥 quantity (루트 레벨): 상품의 가장 기본적인 판매 단위 수량을 나타냅니다. 예를 들어, 상품이 기본적으로 '1봉지' 단위로 판매된다면 이 값은 1입니다. '2개 묶음'으로만 판매된다면 기본 판매 단위는 '묶음'이므로, 이 값은 1입니다. 이 값은 priceOptions 배열 내 quantity와 직접적인 연관성은 없으며, 상품 자체의 최소 판매 단위를 나타냅니다. 대부분의 경우 1로 설정됩니다.
🔥 quantityText: 고객이 실제로 주문할 때 사용할 것 같은 순수 단위 단어만 추출. 게시물의 문맥을 고려하여 실제 주문 단위로 판단하세요.
- 식품류: "팩", "통", "세트", "봉지", "개" 등
- 무게/용량 상품: "개", "키로", "kg", "그람", "g" 등 (고객이 "맛조개 2개", "사과 3키로" 방식으로 주문)
- 화장품/생활용품: "개", "병", "튜브", "용기" 등
- 의류/잡화: "개", "벌", "켤레" 등
- 예시1: "2세트(10개)" → quantityText: "세트"
- 예시2: "애호박 2통" → quantityText: "통"  
- 예시3: "맛조개 400g" → quantityText: "개" (고객이 "맛조개 2개"로 주문)
- 예시4: "사과 3kg" → quantityText: "키로" 또는 "개" (게시물 문맥에 따라)
- 예시5: "블루베리 4팩" → quantityText: "팩"
- 예시6: "우유 500ml" → quantityText: "개" (우유 1개, 2개로 주문)
- 주의: 고객의 실제 주문 방식을 고려하세요. "400g 상품"이라도 고객이 "2개 주세요"라고 할 가능성이 높으면 quantityText: "개"입니다.
productId: "prod_" + postKey + "_" + itemNumber 형식으로 생성 (itemNumber는 상품 번호).
stockQuantity: 명확한 재고 수량만 숫자로 추출 (예: "5개 한정" -> 5). 불명확하면 null.
pickupDate: "내일", "5월 10일", "3시 이후" 등의 텍스트를 게시물 작성 시간 기준으로 YYYY-MM-DDTHH:mm:ss.sssZ 형식으로 변환. 기간이 명시된 경우(예: 6/1~6/2), 가장 늦은 날짜를 기준으로 설정.
keywordMappings: { "키워드": { "productIndex": 숫자 } } 형식의 객체. 위에서 설명한 '주문 키워드 추출' 규칙에 따라 생성된 키워드와 상품 인덱스(1부터 시작)의 매핑입니다. **이 필드는 필수입니다.**
[JSON 출력 형식]
1. 여러 상품일 경우:
Generated json
{
  "multipleProducts": true,
  "products": [
    {
      "productId": "prod_...",
      "itemNumber": 1,
      "title": "[5월17일] 상품명1",
      "basePrice": 10000,
      "priceOptions": [
        { "quantity": 1, "price": 10000, "description": "옵션 설명 1" }
      ],
      "quantityText": "개",
      "quantity": 1,
      "category": "식품",
      "status": "판매중",
      "tags": [],
      "features": [],
      "pickupInfo": "픽업 안내",
      "pickupDate": "YYYY-MM-DDTHH:mm:ss.sssZ",
      "pickupType": "픽업",
      "stockQuantity": null,
      
    },
    
  ],
  "keywordMappings": {
        "대극천": { "productIndex": 1 },
        "조대홍": { "productIndex": 2 },
        "참외": { "productIndex": 3 },
        "포도": { "productIndex": 4 },
        "1번": { "productIndex": 1 },
        "2번": { "productIndex": 2 },
        "3번": { "productIndex": 3 },
        "4번": { "productIndex": 4 }
      }
  
}
Use code with caution.
Json
2. 단일 상품일 경우:
Generated json
{
  "multipleProducts": false,
  "productId": "prod_...",
  "itemNumber": 1,
  "title": "[5월17일] 블랙라벨 오렌지",
  "basePrice": 8900,
  "priceOptions": [
    { "quantity": 1, "price": 8900, "description": "1봉지(6알)" },
    { "quantity": 2, "price": 16900, "description": "2봉지(12알)" }
  ],
  "quantityText": "봉지",
  "quantity": 1,
  "category": "식품",
  "status": "판매중",
  "tags": ["#특가"],
  "features": [],
  "pickupInfo": "오늘 오후 2시 이후 수령",
  "pickupDate": "YYYY-MM-DDTHH:mm:ss.sssZ",
  "pickupType": "수령",
  "stockQuantity": null,
  "keywordMappings": {
    "블랙라벨오렌지": { "productIndex": 1 },
    "블랙라벨 오렌지": { "productIndex": 1 },  
    "오렌지": { "productIndex": 1 },
    "블랙라벨": { "productIndex": 1 },
    "블랙": { "productIndex": 1 },
    "1번": { "productIndex": 1 }
  }
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
      // console.log(`[AI 분석] AI API 호출 (시도 ${retries + 1})...`);
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

      // 🔥 [디버깅 로그] AI가 반환한 원본 JSON 텍스트를 확인합니다.
      console.log("================ AI Raw Response Start ================");
      console.log(responseText);
      console.log("================ AI Raw Response End ==================");

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
        // console.log(
        //   `[AI 분석] 전처리된 JSON 문자열 (앞부분): ${jsonStr.substring(
        //     0,
        //     50
        //   )}...`
        // );
        // 이제 정제된 JSON 문자열 파싱
        parsedResult = JSON.parse(jsonStr);
      } catch (parseError) {
        console.error("AI response JSON parsing error:", parseError);
        console.error("Content that failed parsing:", responseText);
        throw new Error(`AI 응답 JSON 파싱 실패: ${parseError.message}`);
      }
      // console.log("[AI 분석] AI 응답 파싱 성공.");
      // --- AI 결과 후처리 및 검증 ---
      let finalResult = null; // null 가능성
      if (
        parsedResult.multipleProducts === true &&
        Array.isArray(parsedResult.products) &&
        parsedResult.products.length > 0
      ) {
        // 숫자 이모지나 명확한 번호가 있는지 확인 (이모지 1️⃣, 2️⃣, 3️⃣ 등이 있을 경우)
        const hasNumberEmojis = parsedResult.products.some(
          (p) =>
            p.title &&
            (p.title.includes("1️⃣") ||
              p.title.includes("2️⃣") ||
              p.title.includes("3️⃣"))
        );

        // 상품 이름이 모두 다른지 확인
        const productNames = parsedResult.products.map((p) => {
          // 상품 이름에서 날짜와 숫자 제거
          const title = p.title || "";
          return title
            .replace(/\[\d+월\d+일\]|\[\d+\/\d+\]/, "")
            .trim()
            .replace(/^\d+[.:\s]/, "");
        });

        // 중복 제거 후 이름이 다른 경우 = 실제 여러 상품
        const uniqueNames = new Set(productNames);
        const hasDifferentNames = uniqueNames.size > 1;

        // 실제로 다른 제품이 있거나, 숫자 이모지가 포함된 경우 - 여러 상품으로 처리
        if (
          hasDifferentNames ||
          hasNumberEmojis ||
          parsedResult.products.length >= 3
        ) {
          // 실제 여러 상품으로 처리
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
            keywordMappings: parsedResult.keywordMappings,
          };
        } else {
          // 병합이 필요한 경우 (유사한 상품들일 때만)
          const mergedProduct = detectAndMergeQuantityBasedProducts(
            parsedResult.products
          );

          if (mergedProduct) {
            const processedMerged = processProduct(mergedProduct, postTime);
            finalResult = {
              multipleProducts: false,
              products: [processedMerged],
              keywordMappings: parsedResult.keywordMappings,
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
              keywordMappings: parsedResult.keywordMappings,
            };
          } else {
            // 병합 실패했으나 여러 상품으로 판단됨
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
              keywordMappings: parsedResult.keywordMappings,
            };
          }
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
          keywordMappings: parsedResult.keywordMappings,
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
        // console.log("[AI 분석] 처리 성공, 유효한 상품이 발견되었습니다.");
        finalResult.products.forEach((p, idx) => {
          // productId 생성 추가
          if (!p.productId)
            p.productId = generateProductUniqueIdForItem(
              "tempUser",
              postKey,
              p.itemNumber ?? idx + 1
            ); // userId는 save 시 재설정될 수 있음
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
  // AI가 이미 올바른 형식의 pickupDate를 제공했는지 확인
  const hasValidPickupDate =
    productInfo.pickupDate &&
    typeof productInfo.pickupDate === "string" &&
    (productInfo.pickupDate.includes("T") ||
      productInfo.pickupDate.match(/^\d{4}-\d{2}-\d{2}/));

  if (hasValidPickupDate) {
    // AI가 이미 올바른 pickupDate를 제공한 경우 그대로 사용
    // console.log(
    //   `[processProduct] AI가 제공한 pickupDate 사용: ${productInfo.pickupDate}`
    // );
    // pickupType만 확인해서 없으면 기본값 설정
    if (!productInfo.pickupType) {
      productInfo.pickupType = "수령"; // 기본값
    }
  } else {
    // AI가 pickupDate를 제대로 제공하지 않은 경우에만 extractPickupDate 호출
    // console.log(
    //   `[processProduct] pickupInfo로부터 날짜 추출 시도: ${productInfo.pickupInfo}`
    // );
    const pickupDetails = extractPickupDate(
      productInfo.pickupInfo || productInfo.pickupDate,
      postTime
    );
    productInfo.pickupDate = pickupDetails.date;
    productInfo.pickupType = productInfo.pickupType || pickupDetails.type;
  }
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
      (a, b) => b.quantity - a.quantity
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

  const lowerContent = content.toLowerCase();

  // 1. 판매 관련 핵심 키워드 확인 (기존과 동일하게 유지 또는 필요시 확장)
  const salesKeywords = [
    "주문",
    "예약",
    "판매",
    "가격",
    "공구",
    "특가",
    "할인", // '할인가', '정상가' 등도 포함 가능
    "만원",
    "천원",
    "원",
    "냥",
    "₩", // 통화 관련 키워드
    // 필요에 따라 추가적인 판매 유도 키워드 (예: "팝니다", "드려요" 등)
  ];
  let hasSalesKeyword = false;
  for (const keyword of salesKeywords) {
    if (lowerContent.includes(keyword.toLowerCase())) {
      hasSalesKeyword = true;
      break;
    }
  }

  if (!hasSalesKeyword) {
    // console.log("[Debug] 판매 관련 키워드 없음");
    return false;
  }

  // 2. 가격으로 해석될 수 있는 숫자 패턴 찾기 및 검증
  //    패턴: (숫자)[구분자](숫자3자리)[구분자](숫자3자리)... 또는 (숫자 연속)
  //    구분자: 쉼표(,), 점(.), 작은따옴표(')
  //    최소 100 이상의 값을 찾아야 함. "000"으로 끝나는 것도 고려 (예: "10.000")

  // 정규식 설명:
  // \b: 단어 경계 (숫자 앞뒤로 다른 문자가 붙어있는 것을 방지. 예: "상품10000개")
  // (\d{1,3}): 1~3자리 숫자로 시작 (첫 번째 숫자 그룹)
  // (?:['.,]\d{3})*: 선택적 그룹 (?: ... )
  //   ['.,]: 쉼표, 점, 작은따옴표 중 하나
  //   \d{3}: 정확히 3자리 숫자
  //   이 그룹이 0번 이상 반복 (*). 즉, "1,000", "1.000.000", "1'000" 등을 커버
  // |\d{3,}: 또는 (\b 없이) 세 자리 이상 연속된 숫자 (예: "10000", "500") - "000"도 여기에 해당
  const priceNumberRegex = /\b(?:\d{1,3}(?:['.,]\d{3})*|\d{3,})\b|\d{3,}/g;
  // 단어 경계(\b)를 사용하면 "10000원"의 "10000"은 잘 잡지만, "10.000원"의 "10.000"은 ".000" 부분 때문에 \b가 애매해질 수 있음.
  // 좀 더 관대한 정규식: 구분자 포함하여 숫자로 보이는 부분을 모두 추출
  const flexiblePriceNumberRegex = /(\d[\d',.]*\d|\d{3,})/g;

  const potentialPriceStrings = content.match(flexiblePriceNumberRegex);
  // console.log("[Debug] 찾은 숫자 문자열 후보:", potentialPriceStrings);

  if (!potentialPriceStrings) {
    // console.log("[Debug] 가격 숫자 후보 없음");
    return false;
  }

  let foundSignificantPrice = false;
  for (const priceStr of potentialPriceStrings) {
    // 숫자 외 문자(쉼표, 점, 작은따옴표 등) 모두 제거
    const cleanedNumStr = priceStr.replace(/['.,]/g, "");

    // "000"으로만 구성된 경우 (예: ".000" 에서 "000"만 남은 경우)는 유효한 가격으로 보지 않음.
    // 하지만 "10000" 에서 뒤의 "000"을 의미하는게 아니므로, 전체 숫자를 봐야함.
    // cleanedNumStr 자체가 유효한 숫자인지, 그리고 100 이상인지 확인
    if (/^\d+$/.test(cleanedNumStr)) {
      // 순수 숫자로만 이루어져 있는지 확인
      const num = parseInt(cleanedNumStr, 10);
      // console.log(`[Debug] 문자열: "${priceStr}" -> 정리: "${cleanedNumStr}" -> 숫자: ${num}`);
      if (!isNaN(num) && num >= 100) {
        // 추가 조건: 해당 숫자가 "원" 또는 "₩"과 가깝게 위치하거나,
        // 특정 가격 패턴 (예: "10,000원", "가격: 15000")에 부합하는지 확인하면 더 정확해짐.
        // 여기서는 일단 100 이상이고 판매 키워드가 있으면 상품으로 간주 (단순화 유지)

        // 해당 숫자 주변의 텍스트를 조금 더 확인하여 문맥을 파악 (선택적 강화)
        // 예: "10,000원" -> "원"이 바로 뒤에 오는지
        // 예: "가격 10000" -> "가격"이 근처에 있는지
        // 현재는 hasSalesKeyword 에서 "원", "₩", "가격"을 이미 체크했으므로,
        // 100 이상의 숫자가 발견되면 가격일 가능성이 높다고 판단.

        foundSignificantPrice = true;
        break;
      }
    }
  }

  if (!foundSignificantPrice) {
    console.log("[Debug] 100 이상의 유의미한 가격 숫자 없음");
    return false;
  }

  // (선택적) 도착/수령 안내 게시물 패턴 제외 로직
  // 이전에 논의된 isLikelyArrivalNotice와 유사한 로직을 여기에 추가하거나,
  // 또는 별도의 함수로 호출하여 그 결과를 반영할 수 있습니다.
  // 예시: (매우 간단한 버전)
  const arrivalListPattern =
    /^\s*(?:\d+\.|[①-⑩])\s*.*?[\-👉:]*\s*(?:도착|수령|입고|완료)\s*$/gm;
  const arrivalMatches = content.match(arrivalListPattern);
  // 만약 도착 목록 패턴이 2개 이상이고, 명확한 'xxxx원' 또는 'xx만원' 같은 직접적인 가격표현이 없다면 도착안내로 간주
  if (
    arrivalMatches &&
    arrivalMatches.length >= 2 &&
    !lowerContent.match(/\d{1,3}(?:,\d{3})*\s*원|\d+\s*만원|\d+\s*₩/)
  ) {
    console.log("[Debug] 도착 안내 목록 패턴 발견, 상품 아님으로 판단");
    return false;
  }

  console.log("[Debug] 최종 판단: 상품 게시물");
  return true; // 판매 키워드 O, 100 이상의 가격 숫자 O, (선택적으로) 도착 안내 패턴 아님
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

// 🔥 단위 기반 패턴 매칭 함수 (사용자 요구사항에 맞게 개선)
function extractOrderByUnitPattern(commentText, productMap) {
  if (!commentText || !productMap || productMap.size === 0) {
    return null;
  }

  // 텍스트 정규화
  const text = commentText
    .replace(/,/g, "")
    .replace(/([가-힣])(\d)/g, "$1 $2") // "2세트" -> "2 세트"
    .replace(/(\d)([가-힣])/g, "$1 $2") // "세트2" -> "세트 2"
    .trim()
    .toLowerCase();

  const foundOrders = [];

  // 취소/마감 댓글 체크
  if (text.includes("마감") || text.includes("취소") || text.includes("완판")) {
    return null;
  }

  // 각 상품의 quantity_text를 기준으로 패턴 매칭 시도
  for (const [itemNumber, productInfo] of productMap) {
    const quantityText = productInfo.quantity_text; // 이제 순수 단위만 저장됨 ("팩", "통", "세트")
    const priceOptions = productInfo.price_options || [];

    // 🔥 1단계: quantity_text 기반 강화된 매칭
    if (quantityText) {
      console.log(
        `[단위 체크] 상품 ${itemNumber}번의 quantity_text: "${quantityText}"`
      );

      // 1-1: 명시적 단위 매칭 ("2세트", "3팩", "호박 2통이요" 등)
      const unitPatterns = [
        new RegExp(`(\\d+)\\s*${quantityText}(?:[가-힣]*)?`, "i"), // "2팩", "3세트", "2통이요"
        new RegExp(`${quantityText}\\s*(\\d+)`, "i"), // "팩2", "세트3"
      ];

      for (const pattern of unitPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const numberStr = match[1];
          // 🔥 4자리 이상이거나 0으로 시작하는 3자리+ 숫자는 전화번호로 간주하고 제외
          if (
            numberStr.length >= 4 ||
            (numberStr.length >= 3 && numberStr.startsWith("0"))
          ) {
            console.log(
              `[quantity_text 명시적 매칭] "${commentText}" → ${numberStr}은 전화번호로 간주, 건너뜀 (길이: ${
                numberStr.length
              }, 0시작: ${numberStr.startsWith("0")})`
            );
            continue; // 다음 패턴으로
          }

          const quantity = parseInt(numberStr);
          if (quantity >= 1 && quantity <= 999) {
            foundOrders.push({
              itemNumber: itemNumber,
              quantity: quantity,
              matchedUnit: quantityText,
              matchType: "quantity-text-explicit",
              isAmbiguous: false,
              processingMethod: "quantity-text-pattern",
            });

            console.log(
              `[quantity_text 명시적 매칭] "${commentText}" → ${quantity}${quantityText} (상품 ${itemNumber}번)`
            );
            return foundOrders; // 성공하면 즉시 반환
          }
        }
      }

      // 1-2: 🔥 단순 숫자 매칭 (quantity_text가 댓글에 없어도 숫자만으로 매칭)
      // 예: quantity_text="통", 댓글="1" → 1통으로 해석
      const simpleNumberMatch = text.match(/^\s*(\d+)\s*$/); // 순수 숫자만
      if (simpleNumberMatch && simpleNumberMatch[1]) {
        const numberStr = simpleNumberMatch[1];
        // 🔥 4자리 이상이거나 0으로 시작하는 3자리+ 숫자는 전화번호로 간주하고 제외
        if (
          numberStr.length >= 4 ||
          (numberStr.length >= 3 && numberStr.startsWith("0"))
        ) {
          console.log(
            `[quantity_text 숫자 매칭] "${commentText}" → ${numberStr}은 전화번호로 간주, 건너뜀 (길이: ${
              numberStr.length
            }, 0시작: ${numberStr.startsWith("0")})`
          );
          continue; // 다음 상품으로
        }

        const quantity = parseInt(numberStr);
        if (quantity >= 1 && quantity <= 999) {
          foundOrders.push({
            itemNumber: itemNumber,
            quantity: quantity,
            matchedUnit: quantityText,
            matchType: "quantity-text-number-only",
            isAmbiguous: false,
            processingMethod: "quantity-text-pattern",
          });

          console.log(
            `[quantity_text 숫자 매칭] "${commentText}" → ${quantity}${quantityText} (상품 ${itemNumber}번)`
          );
          return foundOrders; // 성공하면 즉시 반환
        }
      }
    }

    // 1-3: 🔥 보편적 단위 "개" 매칭 (quantity_text가 다른 단위여도 "개"로 주문 가능)
    // 예: quantity_text="통", 댓글="호박 2개요" → 2통으로 해석
    const universalPatterns = [
      new RegExp(`(\\d+)\\s*개`, "i"), // "2개", "3개요"
    ];

    for (const pattern of universalPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const numberStr = match[1];
        // 🔥 4자리 이상이거나 0으로 시작하는 3자리+ 숫자는 전화번호로 간주하고 제외
        if (
          numberStr.length >= 4 ||
          (numberStr.length >= 3 && numberStr.startsWith("0"))
        ) {
          console.log(
            `[개 단위 매칭] "${commentText}" → ${numberStr}은 전화번호로 간주, 건너뜀 (길이: ${
              numberStr.length
            }, 0시작: ${numberStr.startsWith("0")})`
          );
          continue; // 다음 패턴으로
        }

        const quantity = parseInt(numberStr);
        if (quantity >= 1 && quantity <= 999) {
          // 🔥 패키지 옵션 우선 체크 (예: "10개" → "2세트(10개)" 옵션 찾기)
          for (const [itemNumber, productInfo] of productMap) {
            const priceOptions = productInfo.price_options || [];
            const quantityText = productInfo.quantity_text;

            if (priceOptions.length > 0) {
              // A. 숫자+단위 → 패키지 옵션 매칭 ("1박스" → "한박스", "2세트" → "2세트")
              for (const option of priceOptions) {
                const desc = option.description?.toLowerCase() || "";

                // "1박스" → "한박스", "2세트" → "2세트" 등 매칭
                const unitLower = quantityText?.toLowerCase() || "";
                console.log(
                  `🔍 [패키지 매칭 디버깅] 상품 ${itemNumber}번: desc="${desc}", unitLower="${unitLower}", quantity=${quantity}`
                );

                if (desc.includes(unitLower)) {
                  // 한글 숫자 매칭 ("1" → "한", "2" → "이", "3" → "삼")
                  const koreanNumbers = {
                    1: "한",
                    2: "이",
                    3: "삼",
                    4: "사",
                    5: "오",
                    6: "육",
                    7: "칠",
                    8: "팔",
                    9: "구",
                    10: "십",
                  };
                  const koreanNum = koreanNumbers[quantity];

                  console.log(
                    `🔍 [패키지 매칭 디버깅] koreanNum="${koreanNum}", 매칭 패턴들: "${koreanNum}${unitLower}", "${quantity}${unitLower}"`
                  );

                  // 더 정확한 패턴 매칭
                  const condition1 =
                    koreanNum && desc === `${koreanNum}${unitLower}`;
                  const condition2 = desc === `${quantity}${unitLower}`;
                  const condition3 =
                    desc.startsWith(`${koreanNum}${unitLower}`) && koreanNum;
                  const condition4 = desc.startsWith(`${quantity}${unitLower}`);

                  console.log(
                    `🔍 [패키지 매칭 디버깅] 조건1(한글정확): ${condition1}, 조건2(숫자정확): ${condition2}, 조건3(한글시작): ${condition3}, 조건4(숫자시작): ${condition4}`
                  );

                  if (condition1 || condition2 || condition3 || condition4) {
                    // 🔥 패키지 옵션에서 실제 세트 수 추출 ("2세트" → 2, "한박스" → 1)
                    const setMatch = option.description?.match(/(\d+)세트/);
                    const boxMatch =
                      option.description?.match(/(한|두|세|네|다섯)박스/);
                    let actualQuantity = option.quantity || 1;

                    if (setMatch) {
                      actualQuantity = parseInt(setMatch[1]);
                    } else if (boxMatch) {
                      const boxNumbers = {
                        한: 1,
                        두: 2,
                        세: 3,
                        네: 4,
                        다섯: 5,
                      };
                      actualQuantity = boxNumbers[boxMatch[1]] || 1;
                    } else if (option.description?.includes("반박스")) {
                      actualQuantity = 1; // 반박스는 1개로 처리
                    }

                    foundOrders.push({
                      itemNumber: itemNumber,
                      quantity: actualQuantity, // 🔥 실제 세트/박스 수 사용
                      matchedNumber: quantity,
                      selectedOption: option.description,
                      matchType: "package-option",
                      isAmbiguous: false,
                      processingMethod: "package-option-unit",
                    });

                    console.log(
                      `[단위 패키지 매칭] "${commentText}" → ${option.description} ${actualQuantity}개 주문 (상품 ${itemNumber}번)`
                    );
                    return foundOrders;
                  }
                }
              }

              // B. 개수 기반 매칭 ("10개요" → "2세트(10개)" 옵션 찾기)
              for (const option of priceOptions) {
                const optionMatch = option.description?.match(/(\d+)개/);
                if (optionMatch && parseInt(optionMatch[1]) === quantity) {
                  // 🔥 패키지 옵션에서 실제 세트 수 추출 ("2세트(10개)" → 2)
                  const setMatch = option.description?.match(/(\d+)세트/);
                  const actualQuantity = setMatch
                    ? parseInt(setMatch[1])
                    : option.quantity || 1;

                  foundOrders.push({
                    itemNumber: itemNumber,
                    quantity: actualQuantity, // 🔥 실제 세트 수 사용
                    matchedNumber: quantity,
                    selectedOption: option.description,
                    matchType: "package-option",
                    isAmbiguous: false,
                    processingMethod: "package-option-count",
                  });

                  console.log(
                    `[개수 패키지 매칭] "${commentText}" → ${option.description} ${actualQuantity}개 주문 (상품 ${itemNumber}번)`
                  );
                  return foundOrders;
                }
              }
            }
          }

          // 패키지 옵션이 없거나 매칭되지 않으면 기본 단위 매칭
          const firstItem = productMap.keys().next().value;
          if (firstItem) {
            foundOrders.push({
              itemNumber: firstItem,
              quantity: quantity,
              matchedUnit: "개",
              actualUnit: quantityText, // 실제 상품 단위
              matchType: "universal-unit",
              isAmbiguous: false,
              processingMethod: "quantity-text-pattern",
            });

            console.log(
              `[보편적 단위 매칭] "${commentText}" → ${quantity}개 (실제: ${quantity}${quantityText}, 상품 ${itemNumber}번)`
            );
            return foundOrders; // 성공하면 즉시 반환
          }
        }
      }
    }

    // 🔥 2단계: 추가 패키지 옵션 매칭 (순수 숫자나 다른 패턴)
    if (priceOptions.length > 0) {
      // "10", "20" 등 순수 숫자나 "10요" 등에서 숫자 추출
      const numberMatch = text.match(/^\s*(\d+)(?:요|개요)?\s*$/);
      if (numberMatch && numberMatch[1]) {
        const numberStr = numberMatch[1];
        // 🔥 4자리 이상이거나 0으로 시작하는 3자리+ 숫자는 전화번호로 간주하고 제외
        if (
          numberStr.length >= 4 ||
          (numberStr.length >= 3 && numberStr.startsWith("0"))
        ) {
          console.log(
            `[패키지 옵션 매칭] "${commentText}" → ${numberStr}은 전화번호로 간주, 건너뜀 (길이: ${
              numberStr.length
            }, 0시작: ${numberStr.startsWith("0")})`
          );
          continue; // 다음 상품으로
        }

        const mentionedNumber = parseInt(numberStr);

        // 패키지 옵션에서 해당 개수와 일치하는 옵션 찾기
        for (const option of priceOptions) {
          // 옵션 설명에서 개수 추출 ("2세트(10개)" → 10)
          const optionMatch = option.description?.match(/(\d+)개/);
          if (optionMatch && parseInt(optionMatch[1]) === mentionedNumber) {
            // 🔥 패키지 옵션에서 실제 세트 수 추출 ("2세트(10개)" → 2)
            const setMatch = option.description?.match(/(\d+)세트/);
            const actualQuantity = setMatch
              ? parseInt(setMatch[1])
              : option.quantity || 1;

            foundOrders.push({
              itemNumber: itemNumber,
              quantity: actualQuantity, // 🔥 실제 세트 수 사용
              matchedNumber: mentionedNumber, // 댓글에서 언급된 숫자 (예: 10)
              selectedOption: option.description, // 선택된 옵션 (예: "2세트(10개)")
              matchType: "package-option",
              isAmbiguous: false,
              processingMethod: "package-option-numeric",
            });

            console.log(
              `[숫자 패키지 매칭] "${commentText}" → ${option.description} ${actualQuantity}개 주문 (상품 ${itemNumber}번)`
            );
            return foundOrders; // 성공하면 즉시 반환
          }
        }
      }
    }
  }

  // 🔥 2단계: quantity_text가 없는 상품들에 대한 단순 숫자 매칭
  // "2" 댓글 등을 처리하기 위해 추가
  const simpleNumberMatch = text.match(/^\s*(\d+)\s*$/); // 순수 숫자만
  if (simpleNumberMatch && simpleNumberMatch[1]) {
    const numberStr = simpleNumberMatch[1];
    // 🔥 4자리 이상이거나 0으로 시작하는 3자리+ 숫자는 전화번호로 간주하고 제외
    if (
      numberStr.length >= 4 ||
      (numberStr.length >= 3 && numberStr.startsWith("0"))
    ) {
      console.log(
        `[단순 숫자 매칭] "${commentText}" → ${numberStr}은 전화번호로 간주, 패턴 처리 불가 (길이: ${
          numberStr.length
        }, 0시작: ${numberStr.startsWith("0")})`
      );
      return null;
    }

    const quantity = parseInt(numberStr);
    if (quantity >= 1 && quantity <= 999) {
      // 첫 번째 상품에 매칭
      const firstItem = productMap.keys().next().value;
      if (firstItem) {
        foundOrders.push({
          itemNumber: firstItem,
          quantity: quantity,
          matchedUnit: "개", // 기본 단위
          matchType: "simple-number",
          isAmbiguous: false,
          processingMethod: "simple-number-pattern",
        });

        console.log(
          `[단순 숫자 매칭] "${commentText}" → ${quantity}개 (상품 ${firstItem}번)`
        );
        return foundOrders;
      }
    }
  }

  return foundOrders.length > 0 ? foundOrders : null;
}

// 키워드 매칭을 통한 주문 추출 함수 (여러 항목 처리 가능하도록 수정)
function extractOrderByKeywordMatching(commentText, keywordMappings) {
  if (
    !commentText ||
    !keywordMappings ||
    Object.keys(keywordMappings).length === 0
  ) {
    return null;
  }

  const text = commentText.toLowerCase().trim();
  const foundOrders = [];

  // 키워드와 수량을 함께 찾는 패턴들
  const patterns = [
    /(\d+)\s*(\S+)/g, // "4 파프리카", "2봉이요"
    /(\S+)\s*(\d+)/g, // "파프리카 4", "봉 2"
  ];

  for (const [keyword, mapping] of Object.entries(keywordMappings)) {
    if (text.includes(keyword.toLowerCase())) {
      // 키워드 주변에서 수량 찾기
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const [fullMatch, part1, part2] = match;

          // 키워드가 매치에 포함되어 있는지 확인
          if (fullMatch.toLowerCase().includes(keyword.toLowerCase())) {
            const quantity1 = parseInt(part1);
            const quantity2 = parseInt(part2);

            const quantity = !isNaN(quantity1) ? quantity1 : quantity2;

            // 🔥 원본 문자열도 체크해서 0으로 시작하는 숫자 제외
            const originalStr1 = part1;
            const originalStr2 = part2;
            const relevantStr = !isNaN(quantity1) ? originalStr1 : originalStr2;

            // 🔥 4자리 이상이거나 0으로 시작하는 3자리+ 숫자는 전화번호로 간주하고 제외
            if (
              relevantStr.length >= 4 ||
              (relevantStr.length >= 3 && relevantStr.startsWith("0"))
            ) {
              console.log(
                `[키워드 매칭] "${commentText}" → ${quantity}(${relevantStr})은 전화번호로 간주, 건너뜀 (길이: ${
                  relevantStr.length
                }, 0시작: ${relevantStr.startsWith("0")})`
              );
              continue; // 다음 매치로
            }

            if (quantity >= 1 && quantity <= 999) {
              foundOrders.push({
                itemNumber: mapping.productIndex,
                quantity: quantity,
                matchType: "keyword-matching",
                keyword: keyword,
                isAmbiguous: false,
              });
              break; // 키워드당 하나의 주문만
            }
          }
        }
      }
    }
  }

  return foundOrders.length > 0 ? foundOrders : null;
}

// 🔍 1단계: 숫자 체크 전용 함수 (사용자 요구사항 1번)
function checkNumberPatternOnly(commentText) {
  if (!commentText || typeof commentText !== "string") {
    return {
      number_check: false,
      only_numbers: false,
      valid_numbers: [],
      debug_info: {
        error: "invalid_input",
        original_text: commentText,
      },
    };
  }

  const text = commentText.toLowerCase().trim();

  console.log(`[1단계 숫자체크] 입력: "${commentText}"`);

  // 🔍 1-1: 모든 숫자 패턴 추출 (부분 매칭 방지를 위해 완전한 숫자만)
  const numberMatches = [];
  const numberPattern = /\d+/g;
  let match;
  while ((match = numberPattern.exec(text)) !== null) {
    const numberStr = match[0];
    // 4자리 이상이거나 0으로 시작하는 3자리+ 숫자는 전화번호로 간주하고 제외
    if (
      numberStr.length >= 4 ||
      (numberStr.length >= 3 && numberStr.startsWith("0"))
    ) {
      console.log(
        `[1단계 숫자체크] 전화번호로 간주하여 제외: "${numberStr}" (길이: ${
          numberStr.length
        }, 0시작: ${numberStr.startsWith("0")})`
      );
      continue;
    }
    // 1-3자리 숫자만 추가
    if (numberStr.length >= 1 && numberStr.length <= 3) {
      numberMatches.push(numberStr);
    }
  }

  console.log(
    `[1단계 숫자체크] 숫자 패턴 추출: ${
      numberMatches.length > 0 ? `[${numberMatches.join(", ")}]` : "없음"
    }`
  );

  // 🔍 1-2: 유효한 숫자 필터링 (1-999 범위)
  const validNumbers = numberMatches.filter((num) => {
    const n = parseInt(num);
    return n >= 1 && n <= 999;
  });

  console.log(
    `[1단계 숫자체크] 유효한 숫자 (1-999): [${validNumbers.join(", ")}]`
  );

  // 🔍 1-3: 시간 표현 필터링 ("8시", "14:30" 등)
  const nonTimeNumbers = validNumbers.filter((num) => {
    const beforeNum = text.indexOf(num) > 0 ? text[text.indexOf(num) - 1] : "";
    const afterNum = text[text.indexOf(num) + num.length] || "";
    const isTimeExpression =
      afterNum === "시" || beforeNum === ":" || afterNum === ":";

    if (isTimeExpression) {
      console.log(
        `[1단계 숫자체크] 시간 표현 제외: "${num}" (앞: "${beforeNum}", 뒤: "${afterNum}")`
      );
    }

    return !isTimeExpression;
  });

  console.log(
    `[1단계 숫자체크] 시간 표현 제외 후: [${nonTimeNumbers.join(", ")}]`
  );

  // 🔍 1-4: 숫자만 있는 경우 체크 (예: "3", "5")
  const onlyNumbers = /^\s*\d{1,3}\s*$/.test(text);
  console.log(`[1단계 숫자체크] 숫자만 있는 패턴: ${onlyNumbers}`);

  // 🔍 1-5: 최종 number_check 결과
  const number_check = nonTimeNumbers.length > 0;

  const result = {
    number_check,
    only_numbers: onlyNumbers,
    valid_numbers: nonTimeNumbers,
    debug_info: {
      original_text: commentText,
      normalized_text: text,
      raw_matches: numberMatches || [],
      valid_range_numbers: validNumbers,
      filtered_numbers: nonTimeNumbers,
    },
  };

  console.log(
    `[1단계 숫자체크] 최종결과: number_check=${number_check}, only_numbers=${onlyNumbers}`
  );

  // 🔥 사용자 요구사항: "숫자만 있다면 그건 주문임"
  if (onlyNumbers) {
    console.log(`[1단계 숫자체크] ⭐ 숫자만 있는 패턴 감지! 주문 확실성 높음`);
  }

  // 🔥 사용자 요구사항: "1, 2, 3과 같은 숫자가 감지되면 주문일 확률이 높음"
  if (number_check && !onlyNumbers) {
    console.log(`[1단계 숫자체크] ⭐ 숫자 감지! 주문일 확률 높음`);
  }

  return result;
}

function shouldUsePatternProcessing(commentText, productMap) {
  if (!commentText || !productMap || productMap.size === 0) {
    return { shouldUsePattern: false, reason: "invalid_input" };
  }

  // 🔥 0단계: 무게/용량 단위 필터링 (가장 먼저 체크!)
  const weightVolumePattern =
    /(그람|그램|키로|킬로|키로그람|키로그램|킬로그람|킬로그램|kg|g\b|ml|리터|l\b)/i;
  if (weightVolumePattern.test(commentText)) {
    console.log(
      `[처리 방식 결정] "${commentText}" → 무게/용량 단위 감지, AI 처리로 전환`
    );
    return { shouldUsePattern: false, reason: "weight_volume_unit_detected" };
  }

  // 🔥 개선: 전화번호 등 무관한 숫자 제외 후 주문 관련 숫자만 카운트
  // 0으로 시작하는 4자리+ 숫자와 일반 4자리+ 숫자를 모두 제외
  const allNumberMatches = [];
  const numberPattern = /\d+/g;
  let match;
  while ((match = numberPattern.exec(commentText)) !== null) {
    const numberStr = match[0];
    // 4자리 이상이거나 0으로 시작하는 3자리+ 숫자는 전화번호로 간주
    if (
      numberStr.length >= 4 ||
      (numberStr.length >= 3 && numberStr.startsWith("0"))
    ) {
      continue; // 전화번호로 간주하고 제외
    }
    allNumberMatches.push(numberStr);
  }

  // 4자리 이상 연속 숫자는 전화번호/ID로 간주하고 제외
  const orderRelevantNumbers = allNumberMatches.filter((num) => {
    // 🔥 개선: 문자열 길이로 체크 (0으로 시작하는 4자리 숫자 처리)
    if (num.length >= 4) {
      // 4자리 이상은 전화번호/ID로 간주
      return false;
    }
    const numValue = parseInt(num);
    // 주문 수량은 보통 1-999 범위
    return numValue >= 1 && numValue <= 999;
  });

  if (orderRelevantNumbers.length >= 2) {
    console.log(
      `[처리 방식 결정] "${commentText}" → 주문 관련 숫자 2개 이상 감지 (${orderRelevantNumbers.join(
        ", "
      )}), AI 처리로 전환 (전체 숫자: ${allNumberMatches.join(", ")})`
    );
    return {
      shouldUsePattern: false,
      reason: "multiple_order_numbers_detected",
    };
  }

  // 전화번호만 있고 주문 숫자가 1개면 패턴 처리 가능
  if (allNumberMatches.length !== orderRelevantNumbers.length) {
    console.log(
      `[처리 방식 결정] "${commentText}" → 전화번호/ID 필터링됨 (${allNumberMatches
        .filter((num) => num.length >= 4 || parseInt(num) > 999)
        .join(", ")}), 주문 숫자: ${orderRelevantNumbers.join(", ")}`
    );
  }

  // 🔍 1단계: 새로운 숫자 체크 (사용자 요구사항 1번)
  const numberCheckResult = checkNumberPatternOnly(commentText);
  const { number_check, only_numbers, valid_numbers } = numberCheckResult;

  const text = commentText.toLowerCase().trim();

  // 기존 로직 유지 (2-4단계는 나중에 개선 예정)
  // quantity_text 확인 (상품 수가 1개면 해당 상품의 quantity_text, 여러 개면 어떤 것이든 있는지)
  let hasQuantityText = false;
  for (const [itemNumber, productInfo] of productMap) {
    if (productInfo.quantity_text && productInfo.quantity_text.trim()) {
      const quantityText = productInfo.quantity_text.toLowerCase();
      if (text.includes(quantityText)) {
        hasQuantityText = true;
        break;
      }
    }
  }

  // '개' 단위 체크
  const hasGaeUnit = /\d+\s*개/.test(text);

  console.log(
    `[처리 방식 결정] "${commentText}": 숫자=${number_check}, quantity_text=${hasQuantityText}, 개단위=${hasGaeUnit}`
  );

  // 결정 로직 (기존 유지, 1단계만 개선된 버전 사용)
  if (number_check && hasQuantityText) {
    return {
      shouldUsePattern: true,
      reason: "clear_number_with_quantity_text",
    };
  } else if (!number_check && hasQuantityText) {
    return {
      shouldUsePattern: false,
      reason: "no_clear_number_but_has_quantity_text",
    };
  } else if (number_check && !hasQuantityText) {
    if (hasGaeUnit) {
      // 🤔 "개" 단위는 범용적이므로 AI 처리 (사용자 고민 중인 부분)
      return {
        shouldUsePattern: false,
        reason: "number_with_gae_unit_ambiguous",
      };
    } else {
      // 명백한 숫자만 있음 → 패턴 처리
      return { shouldUsePattern: true, reason: "clear_number_only" };
    }
  } else {
    // 숫자도 quantity_text도 없음 → AI 처리
    return { shouldUsePattern: false, reason: "no_clear_pattern" };
  }
}

function extractEnhancedOrderFromComment(commentText) {
  if (!commentText) return null;

  // 텍스트 정규화
  const text = commentText.replace(/,/g, " ").replace(/\\n/g, " ").trim();
  const foundOrders = [];

  // 4자리 숫자(전화번호, 연도 등)를 필터링하기 위한 헬퍼 함수
  function isValidQuantity(q) {
    return q >= 1 && q <= 999;
  }

  // --- 패턴 1: "1번 2개", "3번 5" (가장 구체적인 패턴) ---
  const numberedItemPattern = /(\d+)\s*번\s*(\d+)/g;
  let match;
  while ((match = numberedItemPattern.exec(text)) !== null) {
    const itemNumber = parseInt(match[1]);
    const quantity = parseInt(match[2]);

    if (isValidQuantity(itemNumber) && isValidQuantity(quantity)) {
      foundOrders.push({
        itemNumber: itemNumber,
        quantity: quantity,
        matchType: "pattern-numbered",
        isAmbiguous: false,
      });
    }
  }

  // "X번 Y" 패턴이 발견되면, 가장 정확한 정보이므로 즉시 반환
  if (foundOrders.length > 0) {
    return foundOrders;
  }

  // --- 패턴 2: 댓글에 있는 모든 숫자 추출 (Fallback용) ---
  const genericNumberPattern = /(\d+)/g;
  const numbersFound = [];
  while ((match = genericNumberPattern.exec(text)) !== null) {
    const numberStr = match[1];
    // 🔥 4자리 이상이거나 0으로 시작하는 3자리+ 숫자는 전화번호로 간주하고 제외
    if (
      numberStr.length >= 4 ||
      (numberStr.length >= 3 && numberStr.startsWith("0"))
    ) {
      console.log(
        `[Enhanced 주문 추출] "${commentText}" → ${numberStr}은 전화번호로 간주, 건너뜀 (길이: ${
          numberStr.length
        }, 0시작: ${numberStr.startsWith("0")})`
      );
      continue;
    }
    numbersFound.push(parseInt(numberStr));
  }

  // 유효한 수량만 필터링 (1-999 범위)
  const validQuantities = numbersFound.filter(isValidQuantity);

  if (validQuantities.length > 0) {
    // 🔥 중복 주문 방지: 여러 숫자 중 가장 작은 값 하나만 선택 (일반적으로 주문 수량은 작은 숫자)
    const bestQuantity = Math.min(...validQuantities);

    foundOrders.push({
      itemNumber: 1, // 상품 번호는 알 수 없으므로 '1'로 가정 (모호함)
      quantity: bestQuantity,
      matchType: "pattern-isolated-number",
      isAmbiguous: true, // 상품 번호를 추정했으므로 '모호함'으로 표시
    });

    console.log(
      `[중복 방지] "${commentText}" → 수량 ${bestQuantity}개 선택 (후보: ${validQuantities.join(
        ", "
      )}), 단일 주문만 생성`
    );

    return foundOrders;
  }

  return null; // 매칭되는 패턴이 없으면 null 반환
}

function generateProductUniqueIdForItem(userId, originalPostId, itemNumber) {
  return `prod_${originalPostId}_item${itemNumber}`;
}
function generateOrderUniqueId(postId, commentKey, itemIdentifier) {
  return `order_${postId}_${commentKey}_item${itemIdentifier}`;
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

  if (validOpts.length === 0) {
    return Math.round(fallbackUnitPrice * orderQuantity);
  }

  // 정확히 일치하는 수량 옵션 찾기 (우선순위 1)
  const exactMatch = validOpts.find((opt) => opt.quantity === orderQuantity);
  if (exactMatch) {
    console.log(
      `[가격 계산] 정확한 수량 매칭: ${orderQuantity}개 → ${exactMatch.price}원`
    );
    return Math.round(exactMatch.price);
  }

  // 단일 상품 가격 옵션 찾기 (우선순위 2)
  const singleOption = validOpts.find((opt) => opt.quantity === 1);
  if (singleOption) {
    const totalPrice = singleOption.price * orderQuantity;
    console.log(
      `[가격 계산] 단일 상품 기준: ${orderQuantity}개 × ${singleOption.price}원 = ${totalPrice}원`
    );
    return Math.round(totalPrice);
  }

  // fallback: base_price 사용 (우선순위 3)
  const totalPrice = fallbackUnitPrice * orderQuantity;
  console.log(
    `[가격 계산] Fallback 기준: ${orderQuantity}개 × ${fallbackUnitPrice}원 = ${totalPrice}원`
  );
  return Math.round(totalPrice);
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
              description: post.author.description || "",
              role: post.author.role || "",
              user_key: post.author.user_key || "",
              profile_image_url: post.author.profile_image_url || "",
            }
          : null,
        content: post.content || "",
        createdAt: post.created_at,
        commentCount: post.comment_count ?? 0,
        emotion_count: post.emotion_count ?? 0,
        status: "활성",
        postedAt: post.created_at,
        // photos 배열 전체를 저장 (URL과 메타데이터 포함)
        photos: post.photos || [],
        // 별도로 URL만 추출한 배열도 제공
        photoUrls: post.photos?.map((p) => p.url) || [],
        // 최근 댓글들 - API에서 제공하는 실제 데이터 매핑
        latest_comments: post.latest_comments
          ? post.latest_comments.map((comment) => ({
              body: comment.body || "",
              author: comment.author
                ? {
                    name: comment.author.name || "",
                    description: comment.author.description || "",
                    role: comment.author.role || "",
                    user_key: comment.author.user_key || "",
                    profile_image_url: comment.author.profile_image_url || "",
                  }
                : null,
              created_at: comment.created_at || 0,
            }))
          : [],
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
      const processed = items.map((c, index) => {
        const ts = c.created_at; // timestamp ms 가정
        if (ts && (latestTs === null || ts > latestTs)) latestTs = ts;

        // 모든 댓글에 대해 author 구조 확인 (디버깅용)
        if (index < 3) {
          // 처음 3개 댓글만 로깅
          // console.log(
          //   `[DEBUG] 댓글 ${index + 1} 원본 author:`,
          //   JSON.stringify(c.author, null, 2)
          // );
        }

        const mappedComment = {
          commentKey: c.comment_key,
          postKey: postKey,
          bandKey: bandKey,
          author: c.author
            ? {
                name: c.author.name,
                userNo: c.author.user_key, // 실제 API 응답의 user_key 필드 사용
                user_key: c.author.user_key, // 호환성을 위해 추가
                profileImageUrl: c.author.profile_image_url,
              }
            : null,
          content: c.content, // 실제 API 응답의 content 필드 사용
          createdAt: ts,
        };

        // 처음 3개 댓글의 매핑 결과도 로그 출력
        if (index < 3) {
          // console.log(
          //   `[DEBUG] 댓글 ${index + 1} 매핑 결과:`,
          //   JSON.stringify(mappedComment, null, 2)
          // );
        }

        return mappedComment;
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
    // AI 분류 결과 저장
    const classificationResult = isProductPost ? "상품게시물" : "일반게시물";
    const classificationReason =
      aiAnalysisResult?.reason ||
      (isProductPost ? "AI가 상품 정보를 감지함" : "상품 정보 없음");

    // 🔥 [수정] keyword_mappings 추출 로직 개선
    let finalKeywordMappings = null;
    if (aiAnalysisResult) {
      if (aiAnalysisResult.keywordMappings) {
        // 여러 상품 분석 결과에서 직접 추출
        finalKeywordMappings = aiAnalysisResult.keywordMappings;
      } else if (
        !aiAnalysisResult.multipleProducts &&
        aiAnalysisResult.products &&
        aiAnalysisResult.products[0]?.keywordMappings
      ) {
        // 단일 상품 분석 결과에서 추출
        finalKeywordMappings = aiAnalysisResult.products[0].keywordMappings;
      }
    }

    // 🔥 [추가] keywordMappings를 productIndex 기준으로 정렬
    if (finalKeywordMappings) {
      const sortedEntries = Object.entries(finalKeywordMappings).sort(
        ([, aValue], [, bValue]) => {
          return (aValue.productIndex || 0) - (bValue.productIndex || 0);
        }
      );
      finalKeywordMappings = Object.fromEntries(sortedEntries);
    }

    // 이미지 URL들 추출 (route.js와 동일한 방식)
    const imageUrls = post.photos ? post.photos.map((photo) => photo.url) : [];

    // 1. posts 테이블에 게시물 정보 Upsert

    // JSON 데이터 사전 검증
    let productsDataJson = null;
    if (aiAnalysisResult) {
      try {
        productsDataJson = safeJsonStringify(aiAnalysisResult);
        // 추가 검증: 생성된 JSON이 유효한지 확인
        if (productsDataJson && productsDataJson !== "null") {
          JSON.parse(productsDataJson); // 파싱 테스트
          console.log(
            `[JSON 검증] products_data 검증 성공 (길이: ${productsDataJson.length})`
          );
        }
      } catch (jsonError) {
        console.error(
          `[JSON 검증] products_data 생성 실패:`,
          jsonError.message
        );
        productsDataJson = JSON.stringify({
          error: "AI analysis result serialization failed",
          message: jsonError.message,
          timestamp: new Date().toISOString(),
        });
      }
    }

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
      author_description: post.author?.description || "", // 추가
      author_profile: post.author?.profile_image_url || "", // 추가
      author_user_key: post.author?.user_key || "", // 추가
      comment_count: post.commentCount || 0,
      emotion_count: post.emotion_count || 0, // 추가
      status: "활성",
      posted_at: dateObject.toISOString(),
      is_product: isProductPost || aiExtractionStatus === "failed",
      updated_at: new Date().toISOString(),
      post_key: post.postKey,
      image_urls: imageUrls.length > 0 ? imageUrls : null, // 추가
      photos_data: post.photos || null, // 추가
      latest_comments:
        post.latest_comments &&
        Array.isArray(post.latest_comments) &&
        post.latest_comments.length > 0
          ? post.latest_comments
          : null, // 추가
      ai_extraction_status: aiExtractionStatus,
      products_data: productsDataJson,
      multiple_products: aiAnalysisResult?.multipleProducts || false,
      keyword_mappings: finalKeywordMappings, // 수정된 키워드 매핑 정보 저장
      ai_classification_result: classificationResult,
      ai_classification_reason: classificationReason,
      ai_classification_at: new Date().toISOString(),
    };

    // 🔥 [디버깅 로그] DB에 저장하기 직전의 'posts' 테이블 데이터를 확인합니다.
    console.log("================ Upserting Post Data ================");
    console.log(JSON.stringify(postDataToUpsert, null, 2));
    console.log("=====================================================");

    const { data: upsertedPostData, error: postUpsertError } = await supabase
      .from("posts")
      .upsert(postDataToUpsert, {
        onConflict: "post_id",
        ignoreDuplicates: false,
      })
      .select("post_id")
      .single();
    if (postUpsertError) {
      console.error(`Post ${post.postKey} Supabase 저장 오류:`, {
        error: postUpsertError,
        message: postUpsertError.message,
        code: postUpsertError.code,
        details: postUpsertError.details,
        hint: postUpsertError.hint,
        dataAttempted: {
          postId: postDataToUpsert.post_id,
          title: postDataToUpsert.title,
          content_length: postDataToUpsert.content?.length || 0,
          products_data_length: postDataToUpsert.products_data?.length || 0,
        },
      });
      throw new Error("Post save failed");
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
      aiAnalysisResult?.products
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
          // --- tags, features 값을 text[] 형식으로 변환 ---
          let tagsForDb;
          if (Array.isArray(product.tags)) {
            // 이미 배열이면, 각 요소가 문자열인지 확인하고 문자열 배열로 만듦
            tagsForDb = product.tags.map((tag) => String(tag));
          } else if (
            typeof product.tags === "string" &&
            product.tags.trim() !== ""
          ) {
            // 쉼표 등으로 구분된 문자열이면 배열로 분리 (구분자 확인 필요)
            tagsForDb = product.tags
              .split(/[,，\s]+/)
              .map((tag) => tag.trim())
              .filter(Boolean);
          } else {
            // 그 외의 경우 빈 배열
            tagsForDb = [];
          }
          let featuresForDb; // features도 동일하게 처리
          if (Array.isArray(product.features)) {
            featuresForDb = product.features.map((f) => String(f));
          } else if (
            typeof product.features === "string" &&
            product.features.trim() !== ""
          ) {
            featuresForDb = product.features
              .split(/[,，\s]+/)
              .map((f) => f.trim())
              .filter(Boolean);
          } else {
            featuresForDb = [];
          }
          // --------------------------------------------
          const productDataToUpsert = {
            product_id: productId,
            post_id: upsertedPostData.post_id,
            user_id: userId,
            band_key: bandKey,
            post_key: post.postKey,
            item_number: product.itemNumber || 1,
            title: product.title || "",
            content: post.content || "",
            base_price: product.basePrice || 0,
            price_options: product.priceOptions || [],
            quantity: product.quantity || 1,
            quantity_text: product.quantityText || "1개",
            category: product.category || "기타",
            tags: tagsForDb,
            features: featuresForDb,
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
            products_data: safeJsonStringify(aiAnalysisResult),
          };

          // console.log(
          //   `Upserting product (productId=${productDataToUpsert.product_id}): `,
          //   JSON.stringify(productDataToUpsert)
          // );

          const { error } = await supabase
            .from("products")
            .upsert(productDataToUpsert, {
              onConflict: "product_id",
              ignoreDuplicates: false,
            });
          if (error) {
            console.error(
              `Product ${productId} (Post ${post.postKey}) Supabase 저장 오류:`,
              error
            );
            continue;
          }
          // console.log(
          //   `Product ${productId} (Post ${post.postKey}) upserted in Supabase.`
          // );
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
/**
 * 댓글 데이터로부터 주문 정보를 생성하는 함수 (수정됨)
 * @param supabase Supabase 클라이언트
 * @param userId 사용자 ID
 * @param comments 댓글 객체 배열
 * @param postKey 게시물 키
 * @param bandKey 밴드 키
 * @param bandNumber 밴드 번호
 * @param productMap 상품 정보 Map (key: itemNumber, value: productData) - <<< 추가된 파라미터
 * @returns 생성된 주문과 고객 정보
 */ async function generateOrderData(
  supabase,
  userId,
  comments,
  postKey,
  bandKey,
  bandNumber,
  productMap,
  post = null, // 게시물 정보 추가
  userSettings = null // 사용자 설정 추가
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
    aiDetectedOrders: 0,
    aiSkippedNonOrders: 0,
    ruleBasedOrders: 0,
    errors: [],
  };
  if (!comments || comments.length === 0) {
    // console.log(`[주문 생성] 게시물 ${postKey}에 처리할 댓글이 없습니다`);
    return {
      orders,
      customers,
    };
  }
  // --- 1. productMap 유효성 검사 (이제 파라미터로 받음) ---
  if (!productMap || productMap.size === 0) {
    console.log(
      `[주문 생성] 게시물 ${postKey}에 대한 상품 정보(productMap)가 제공되지 않았거나 비어있습니다. 주문을 생성할 수 없습니다.`
    );
    // 상품 정보 없으면 주문 생성 불가
    return {
      orders,
      customers,
    };
  }
  console.log(
    `[주문 생성] 게시물 ${postKey}의 ${comments.length}개 댓글 처리 시작`
  );
  try {
    // --- 1. 게시물 관련 상품 정보 및 키워드 매핑 정보 미리 조회 ---
    const { data: productsData, error: productsError } = await supabase
      .from("products")
      .select("*") // 필요한 필드만 선택하는 것이 더 효율적일 수 있음
      .eq("post_key", postKey)
      .eq("user_id", userId);

    // 게시물에서 키워드 매핑 정보 조회
    let keywordMappings = {};
    try {
      const { data: postData, error: postError } = await supabase
        .from("posts")
        .select("keyword_mappings")
        .eq("post_key", postKey)
        .eq("user_id", userId)
        .single();

      if (postError && postError.code !== "PGRST116") {
        console.warn(`[키워드 매핑] 게시물 조회 실패: ${postError.message}`);
      } else if (postData?.keyword_mappings) {
        keywordMappings = postData.keyword_mappings;
        console.log(
          `[키워드 매핑] 게시물 ${postKey}의 키워드 ${
            Object.keys(keywordMappings).length
          }개 로드됨`
        );
      }
    } catch (e) {
      console.warn(`[키워드 매핑] 조회 중 오류: ${e.message}`);
    }
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
      // console.log(
      //   `[주문 생성] 게시물 ${postKey}에 대한 DB에서 상품을 찾을 수 없습니다. 주문을 생성할 수 없습니다.`
      // );
      // 상품 없으면 주문 생성 불가
      return {
        orders,
        customers,
      };
    }
    // 상품 정보를 item_number를 키로 하는 Map으로 변환 (매칭 용이성)
    productsData.forEach((p) => {
      if (p.item_number !== null && typeof p.item_number === "number") {
        productMap.set(p.item_number, p);
      }
    });
    // console.log(
    //   `[주문 생성] 게시물 ${postKey}에 대한 ${productMap.size}개의 상품을 가져왔습니다.`
    // );
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
      // 제외 고객 목록 로그 제거 (간소화)
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
    // --- 3. AI 댓글 분석 시도 (적용 시나리오 확인) ---
    let aiOrderResults = [];
    let useAIResults = false;
    let patternProcessedComments = new Set(); // 패턴으로 처리된 댓글 추적

    // 📊 처리 전략 결정 (이미 위에서 선언됨)
    console.log(
      `[최적화] 게시물 ${postKey}: ${productMap.size}개 상품, ${comments.length}개 댓글`
    );

    // 🔍 1단계: 명확한 패턴 댓글 사전 분류
    const clearPatternComments = [];
    const ambiguousComments = [];

    comments.forEach((comment, index) => {
      const content = comment.content?.trim() || "";

      // 명확한 패턴 감지
      const isClearPattern =
        /\d+\s*번\s*\d+/g.test(content) || // "1번 2개", "3번 5개"
        /^\d+$/.test(content) || // "5", "3" (숫자만)
        /^\d+개$/.test(content) || // "2개", "5개"
        /^[가-힣]+\d+$/.test(content) || // "사과2", "참외3"
        /취소|마감|완판|품절/.test(content) || // 취소/공지 댓글
        /감사|잘받았|수고/.test(content); // 인사 댓글

      if (isClearPattern) {
        clearPatternComments.push({ ...comment, originalIndex: index });
      } else {
        ambiguousComments.push({ ...comment, originalIndex: index });
      }
    });

    console.log(
      `[최적화] 명확한 패턴: ${clearPatternComments.length}개, 애매한 댓글: ${ambiguousComments.length}개`
    );

    // 🚀 2단계: 처리 전략 결정
    let shouldUseAI = false;
    let commentsForAI = [];

    // 사용자가 다중 상품 게시물에서 AI 강제 처리를 활성화했는지 확인
    const forceAiProcessing = userSettings?.force_ai_processing === true;

    if (isMultipleProductsPost) {
      if (forceAiProcessing) {
        // 🔥 AI 강제 처리: 모든 댓글을 AI로 처리
        shouldUseAI = true;
        commentsForAI = comments; // 모든 댓글
        console.log(
          `[AI 강제 처리] 다중 상품 게시물에서 AI 강제 처리 설정 활성화: ${comments.length}개 모든 댓글을 AI로 처리`
        );
      } else {
        // 기존 로직: 애매한 댓글만 AI 처리
        if (ambiguousComments.length > 0) {
          shouldUseAI = true;
          commentsForAI = ambiguousComments;
          console.log(
            `[최적화] 다중 상품 게시물: ${ambiguousComments.length}개 댓글만 AI 처리`
          );
        }
      }
    } else {
      // 단일 상품: 패턴으로 대부분 처리, 정말 애매한 것만 AI
      const reallyAmbiguous = ambiguousComments.filter((comment) => {
        const content = comment.content?.toLowerCase() || "";
        return (
          content.includes("한개요") ||
          content.includes("좋아요") ||
          content === "네" ||
          content.includes("주문") ||
          /[가-힣]+\s*[가-힣]+/.test(content)
        ); // 복잡한 문장
      });

      if (reallyAmbiguous.length > 0) {
        shouldUseAI = true;
        commentsForAI = reallyAmbiguous;
        console.log(
          `[최적화] 단일 상품 게시물: ${reallyAmbiguous.length}개 정말 애매한 댓글만 AI 처리`
        );
      }
    }

    // 🤖 3단계: AI 처리 (필요한 경우만)
    if (shouldUseAI && commentsForAI.length > 0) {
      try {
        console.log(
          `[AI 최적화] ${commentsForAI.length}개 댓글에 대해서만 AI 분석 시작`
        );

        const postInfo = {
          products: Array.from(productMap.values()).map((product) => ({
            title: product.title,
            basePrice: product.base_price,
            priceOptions: product.price_options || [],
          })),
          content: post?.content || "",
          postTime: post?.createdAt || new Date().toISOString(),
        };

        aiOrderResults = await extractOrdersFromCommentsAI(
          postInfo,
          commentsForAI, // 선별된 댓글만 AI 처리
          bandNumber,
          postKey
        );

        if (aiOrderResults && aiOrderResults.length > 0) {
          useAIResults = true;
          console.log(
            `[AI 최적화] AI 분석 완료: ${aiOrderResults.length}개 결과 (${commentsForAI.length}개 중)`
          );

          // AI 처리된 댓글들을 추적
          commentsForAI.forEach((comment) => {
            patternProcessedComments.add(comment.commentKey);
          });
        }
      } catch (aiError) {
        console.error(
          `[AI 최적화] AI 분석 실패, 패턴 기반으로 fallback:`,
          aiError.message
        );
      }
    } else {
      console.log(`[최적화] AI 처리 불필요 - 모든 댓글을 패턴으로 처리`);
    }

    // --- 4. 취소 댓글 감지 및 처리 ---
    await processCancellationComments(
      supabase,
      userId,
      comments,
      postKey,
      bandKey,
      bandNumber
    );

    // --- 5. 댓글 순회 및 처리 ---
    for (let i = 0; i < comments.length; i++) {
      const comment = comments[i];
      try {
        // --- 4.1. 기본 정보 추출 및 유효성 검사 ---
        const authorName = comment.author?.name?.trim();
        const authorUserNo = comment.author?.userNo || comment.author?.user_key; // 두 필드 모두 확인
        const authorProfileUrl = comment.author?.profileImageUrl;
        const commentContent = comment.content;
        const createdAt = safeParseDate(comment.createdAt); // 날짜 파싱
        const commentKey = comment.commentKey;

        // [디버깅] 모든 댓글에 대해 상세 로깅
        // console.log(
        //   `[주문생성 디버깅] 댓글 ${commentKey || "NO_KEY"}:`,
        //   JSON.stringify(
        //     {
        //       authorName,
        //       authorUserNo,
        //       commentContent: commentContent?.substring(0, 50) + "...",
        //       commentKey,
        //       originalAuthor: comment.author,
        //     },
        //     null,
        //     2
        //   )
        // );

        if (!authorUserNo) {
          console.warn(
            `[DEBUG] authorUserNo 누락 - 원본 댓글 author 구조:`,
            JSON.stringify(comment.author, null, 2)
          );
        }

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
          console.warn(
            `[DEBUG] 누락된 필드 상세: authorName="${authorName}", authorUserNo="${authorUserNo}", commentContent="${commentContent}", createdAt="${createdAt}", commentKey="${commentKey}"`
          );
          console.warn(
            `[DEBUG] 원본 댓글 author 구조:`,
            JSON.stringify(comment.author, null, 2)
          );
          processingSummary.skippedMissingInfo++;
          continue;
        }
        // --- 3.2. 제외 고객 필터링 ---
        if (excludedCustomers.includes(authorName)) {
          // console.log(
          //   `[주문 생성] Skipping excluded customer: ${authorName} (comment ${commentKey})`
          // );
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
        // --- 4.4. 🔥 새로운 스마트 주문 추출 (quantity_text 기반 판단) ---
        let orderItems = [];
        let isProcessedAsOrder = false;
        let processingMethod = "none";

        // 🧠 1단계: 처리 방식 결정 (AI 강제 처리 우선 확인)
        const forceAiProcessing = userSettings?.force_ai_processing === true;

        // AI 강제 처리가 활성화되고 다중 상품 게시물이면 AI 우선 처리
        if (forceAiProcessing && isMultipleProductsPost && useAIResults) {
          console.log(
            `[AI 강제 처리] 댓글 "${commentContent.substring(
              0,
              30
            )}..." → AI 결과 우선 확인`
          );

          // AI 결과 먼저 확인
          const aiResults = aiOrderResults.filter(
            (result) => result.commentKey === commentKey
          );

          if (aiResults.length > 0) {
            const orderResults = aiResults.filter((result) => result.isOrder);

            if (orderResults.length > 0) {
              // AI 결과를 사용
              orderItems = orderResults.map((aiResult) => ({
                itemNumber: aiResult.productItemNumber || 1,
                quantity: aiResult.quantity || 1,
                isAmbiguous: aiResult.isAmbiguous || false,
                aiAnalyzed: true,
                aiReason: aiResult.reason,
                isOrder: aiResult.isOrder,
                reason: aiResult.reason,
                commentContent: aiResult.commentContent,
                author: aiResult.author,
                processingMethod: "ai",
              }));
              isProcessedAsOrder = true;
              processingMethod = "ai";
              processingSummary.aiDetectedOrders += orderResults.length;

              console.log(
                `[AI 강제 처리 성공] 댓글 "${commentContent.substring(
                  0,
                  30
                )}..." → ${orderItems.length}개 주문 (AI 우선)`
              );
            } else {
              // AI가 주문이 아니라고 판단한 경우
              processingSummary.aiSkippedNonOrders++;
              console.log(
                `[AI 강제 처리] 댓글 "${commentContent.substring(
                  0,
                  30
                )}..." → 주문 아님 (AI 판단)`
              );
              continue;
            }
          } else {
            // AI 결과가 없는 경우에도 AI 처리를 강제하므로 패턴 처리 건너뛰기
            console.log(
              `[AI 강제 처리] 댓글 "${commentContent.substring(
                0,
                30
              )}..." → AI 결과 없음, 패턴 처리 건너뛰기`
            );
            continue;
          }
        }

        // AI 강제 처리가 적용되지 않았거나 AI 결과가 없는 경우 기존 로직 적용
        if (!isProcessedAsOrder) {
          const processingDecision = shouldUsePatternProcessing(
            commentContent,
            productMap
          );

          console.log(
            `[처리 결정] "${commentContent.substring(0, 30)}..." → ${
              processingDecision.shouldUsePattern ? "패턴" : "AI"
            } 처리 (${processingDecision.reason})`
          );

          if (processingDecision.shouldUsePattern) {
            // 🔧 패턴 처리 시도
            let extractedOrderItems = null;

            // 🥇 1단계: 단위 기반 패턴 매칭 시도 (가장 우선 - 정확도 높음)
            extractedOrderItems = extractOrderByUnitPattern(
              commentContent,
              productMap
            );

            // 🥈 2단계: 단위 매칭 실패 시 키워드 매칭 시도
            if (!extractedOrderItems || extractedOrderItems.length === 0) {
              extractedOrderItems = extractOrderByKeywordMatching(
                commentContent,
                keywordMappings
              );
            }

            // 키워드 매칭 결과를 배열로 변환
            if (extractedOrderItems && !Array.isArray(extractedOrderItems)) {
              extractedOrderItems = [extractedOrderItems];
            }

            // 🥉 3단계: 기본 패턴 매칭 시도 (마지막 패턴 기반 시도)
            if (!extractedOrderItems || extractedOrderItems.length === 0) {
              extractedOrderItems =
                extractEnhancedOrderFromComment(commentContent);
            }

            if (extractedOrderItems && extractedOrderItems.length > 0) {
              // 🔧 중복 제거: productName 기준으로 첫 번째 항목만 유지
              const uniqueItems = [];
              const seenProducts = new Set();

              for (const item of extractedOrderItems) {
                const productKey =
                  item.productName || item.itemNumber || "unknown";
                if (!seenProducts.has(productKey)) {
                  uniqueItems.push(item);
                  seenProducts.add(productKey);
                }
              }

              // 패턴 추출 성공
              orderItems = uniqueItems.map((item) => ({
                ...item,
                aiAnalyzed: false,
                processingMethod: "pattern",
              }));
              isProcessedAsOrder = true;
              processingMethod = "pattern";
              processingSummary.ruleBasedOrders += orderItems.length;

              console.log(
                `[패턴 처리 성공] 댓글 "${commentContent.substring(
                  0,
                  30
                )}..." → ${orderItems.length}개 주문`
              );
            } else {
              // 패턴 처리 실패 → AI로 넘김
              console.log(
                `[패턴 처리 실패] 댓글 "${commentContent.substring(
                  0,
                  30
                )}..." → AI 처리로 전환`
              );
            }
          }
        }

        // 🤖 AI 처리 (기존 로직: 패턴 실패 시)
        // 단일 상품 게시물이거나, 다중 상품 게시물이지만 force_ai_processing이 비활성화된 경우
        if (
          !isProcessedAsOrder &&
          useAIResults &&
          aiOrderResults.length > 0 &&
          (!forceAiProcessing || !isMultipleProductsPost)
        ) {
          const aiResults = aiOrderResults.filter(
            (result) => result.commentKey === commentKey
          );

          if (aiResults.length > 0) {
            // 주문인 결과들만 필터링
            const orderResults = aiResults.filter((result) => result.isOrder);

            if (orderResults.length > 0) {
              // 각 AI 결과를 개별 주문 아이템으로 변환
              orderItems = orderResults.map((aiResult) => ({
                itemNumber: aiResult.productItemNumber || 1,
                quantity: aiResult.quantity || 1,
                isAmbiguous: aiResult.isAmbiguous || false,
                aiAnalyzed: true,
                aiReason: aiResult.reason,
                isOrder: aiResult.isOrder,
                reason: aiResult.reason,
                commentContent: aiResult.commentContent,
                author: aiResult.author,
                processingMethod: "ai",
              }));
              isProcessedAsOrder = true;
              processingMethod = "ai";
              processingSummary.aiDetectedOrders += orderResults.length;

              console.log(
                `[AI 처리] 댓글 "${commentContent.substring(0, 30)}..." → ${
                  orderItems.length
                }개 주문`
              );
            } else {
              // AI가 주문이 아니라고 판단한 경우
              processingSummary.aiSkippedNonOrders++;
              console.log(
                `[AI 처리] 댓글 "${commentContent.substring(
                  0,
                  30
                )}..." → 주문 아님`
              );
              continue;
            }
          }
        }
        // 🚫 3단계: 패턴도 AI도 실패한 경우 처리 불가
        if (!isProcessedAsOrder) {
          console.log(
            `[처리 불가] 댓글 "${commentContent.substring(
              0,
              30
            )}..." → 패턴/AI 모두 실패로 건너뜀`
          );
          continue;
        }
        // --- 3.5. 주문으로 처리 결정 시 ---
        if (isProcessedAsOrder && orderItems.length > 0) {
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

          // --- 3.5.2. 각 주문 아이템에 대해 개별 주문 생성 ---
          for (
            let orderIndex = 0;
            orderIndex < orderItems.length;
            orderIndex++
          ) {
            const orderItem = orderItems[orderIndex];

            // --- 상품 매칭 및 가격 계산 ---
            let isAmbiguous = orderItem.isAmbiguous || false;
            let productId = null;
            let itemNumber = orderItem.itemNumber || 1;
            let quantity = orderItem.quantity || 1;
            let basePriceForOrder = 0;
            let calculatedTotalAmount = 0;
            let priceOptionDescription = null; // 가격 옵션 설명
            let matchedExactly = false; // 정확히 매칭되었는지 여부
            let productInfo = null; // 매칭된 상품 정보

            // itemNumber로 상품 찾기
            if (itemNumber !== null && productMap.has(itemNumber)) {
              productInfo = productMap.get(itemNumber);
              if (productInfo && productInfo.product_id) {
                productId = productInfo.product_id;
                matchedExactly = !isAmbiguous;
              } else {
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
                // PID Fallback 로그 제거 (간소화)
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
              isAmbiguous = true;
              productInfo = null;
            }

            // 🔥 가격 계산 (패키지 옵션 지원)
            if (productInfo) {
              const productOptions = productInfo.price_options || [];
              const fallbackPrice =
                typeof productInfo.base_price === "number"
                  ? productInfo.base_price
                  : 0;
              basePriceForOrder = fallbackPrice;

              try {
                // 패키지 옵션이 선택된 경우 특별 처리
                if (
                  orderItem.matchType === "package-option" &&
                  orderItem.selectedOption
                ) {
                  // 선택된 패키지 옵션으로 가격 계산
                  const selectedPackage = productOptions.find(
                    (opt) => opt.description === orderItem.selectedOption
                  );

                  if (selectedPackage) {
                    // 🔥 패키지 옵션은 이미 완성된 가격이므로 quantity 곱하지 않음
                    calculatedTotalAmount = selectedPackage.price;
                    priceOptionDescription = selectedPackage.description;
                    // 🔥 단가는 패키지 가격을 수량으로 나눈 값
                    basePriceForOrder = Math.round(
                      selectedPackage.price / quantity
                    );

                    console.log(
                      `[패키지 가격] "${commentContent}" → ${priceOptionDescription} (${calculatedTotalAmount}원, 단가: ${basePriceForOrder}원)`
                    );
                  } else {
                    // 패키지 옵션을 찾지 못한 경우 기본 계산
                    calculatedTotalAmount = calculateOptimalPrice(
                      quantity,
                      productOptions,
                      fallbackPrice
                    );
                    priceOptionDescription = "기본가";
                  }
                } else {
                  // 기존 가격 계산 로직
                  calculatedTotalAmount = calculateOptimalPrice(
                    quantity,
                    productOptions,
                    fallbackPrice
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
                }
              } catch (calcError) {
                console.error(
                  `  [Price Calc Error] Comment ${commentKey}: Error during calculateOptimalPrice: ${calcError.message}`
                );
                calculatedTotalAmount = 0;
                isAmbiguous = true;
              }
            } else {
              console.warn(
                `  [Price Calc Skip] Comment ${commentKey}: Skipping calculation due to missing productInfo.`
              );
              basePriceForOrder = 0;
              calculatedTotalAmount = 0;
            }

            // --- 3.5.3. 최종 주문 상태 결정 ---
            // sub_status는 간단한 주문 상태만 저장 (확인필요, 미수령, 완료 등)
            let finalSubStatus = null;

            // 댓글에 숫자가 없는 경우 또는 모호한 경우
            if (!/\d/.test(commentContent) || isAmbiguous) {
              finalSubStatus = "확인필요";
            }
            // 여러 상품 게시물인데 정확히 매칭되지 않은 경우
            else if (isMultipleProductsPost && productId && !matchedExactly) {
              finalSubStatus = "확인필요";
            }
            // 기본값 (정상적인 주문) - 수령일 고려
            else {
              // 수령일이 있는 경우 현재 날짜와 비교하여 상태 결정
              if (productInfo && productInfo.pickup_date) {
                try {
                  const pickupDate = new Date(productInfo.pickup_date);
                  const currentDate = new Date();
                  // 시간을 제거하고 날짜만 비교
                  pickupDate.setHours(23, 59, 59, 999); // 수령일 당일 23:59:59까지
                  currentDate.setHours(0, 0, 0, 0); // 현재일 00:00:00부터

                  if (currentDate > pickupDate) {
                    // 수령일이 지났으면 미수령
                    finalSubStatus = "미수령";
                  } else {
                    // 수령일이 아직 안 지났으면 null (정상 주문)
                    finalSubStatus = null;
                  }
                } catch (dateError) {
                  console.warn(
                    `  [Date Parse Error] Comment ${commentKey}: Invalid pickup_date format: ${productInfo.pickup_date}`
                  );
                  finalSubStatus = null; // 날짜 파싱 오류 시 기본값
                }
              } else {
                // 수령일 정보가 없으면 기본값 null
                finalSubStatus = null;
              }
            }

            // --- 3.5.4. 주문 데이터 객체 생성 ---
            // 개별 주문 ID 생성 (orderIndex 추가하여 고유성 보장)
            const orderId = generateOrderUniqueId(
              postKey,
              commentKey,
              `${itemNumber}_${orderIndex}`
            );

            // 🔥 [수정] 처리 방식에 따라 저장될 JSON 데이터 구조화
            let extractionResultForDb = null;
            if (orderItem) {
              if (processingMethod === "ai") {
                // AI 처리 결과 저장
                extractionResultForDb = {
                  processingMethod: "ai",
                  isOrder: orderItem.isOrder,
                  reason: orderItem.reason,
                  isAmbiguous: orderItem.isAmbiguous,
                  productItemNumber: orderItem.itemNumber,
                  quantity: orderItem.quantity,
                  commentContent: orderItem.commentContent,
                  author: orderItem.author,
                  expectedUnitPrice: orderItem.expectedUnitPrice || null,
                  expectedTotalPrice: orderItem.expectedTotalPrice || null,
                  actualUnitPrice: basePriceForOrder,
                  actualTotalPrice: calculatedTotalAmount,
                  priceMatchAccuracy: orderItem.expectedTotalPrice
                    ? Math.abs(
                        1 -
                          Math.abs(
                            calculatedTotalAmount - orderItem.expectedTotalPrice
                          ) /
                            orderItem.expectedTotalPrice
                      )
                    : null,
                };
              } else {
                // 패턴 또는 Fallback 처리 결과 저장
                extractionResultForDb = {
                  processingMethod: processingMethod, // 'pattern' 또는 'fallback'
                  isAmbiguous: orderItem.isAmbiguous,
                  productItemNumber: orderItem.itemNumber,
                  quantity: orderItem.quantity,
                  matchedKeyword: orderItem.matchedKeyword || null,
                  matchType: orderItem.matchType || null,
                  actualUnitPrice: basePriceForOrder,
                  actualTotalPrice: calculatedTotalAmount,
                  // 🔥 패키지 옵션 정보 추가
                  selectedOption: orderItem.selectedOption || null,
                  matchedNumber: orderItem.matchedNumber || null,
                  matchedUnit: orderItem.matchedUnit || null,
                };
              }
            }

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
              processing_method: processingMethod || "unknown", // 처리 방식 저장
              price_option_used: priceOptionDescription || "기본가", // 🔥 패키지 옵션 정보 포함
              ai_extraction_result: extractionResultForDb
                ? safeJsonStringify(extractionResultForDb)
                : null,
            };
            orders.push(orderData);
            processingSummary.generatedOrders++;

            // 🔥 디버깅: 개별 주문 생성 로깅
            // console.log(
            //   `[주문생성] ${orderId} - ${orderItem.itemNumber}번 상품 ${quantity}개 (댓글: ${commentKey})`
            // );
          } // End of orderItems loop

          // 🔥 디버깅: 댓글당 최종 주문 개수 로깅
          if (orderItems.length > 1) {
            // console.log(
            //   `[주문생성 완료] 댓글 ${commentKey}에서 총 ${orderItems.length}개 주문 생성됨`
            // );
          }
          // console.log(
          //   `[주문 생성] Generated order ${orderId} for comment ${commentKey}`
          // );
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
    // 간소화된 요약 로그
    const aiOrderCount = processingSummary.aiDetectedOrders;
    const ruleOrderCount = processingSummary.ruleBasedOrders;
    const skippedCount =
      processingSummary.aiSkippedNonOrders +
      processingSummary.skippedExcluded +
      processingSummary.skippedMissingInfo;

    // 📊 최적화 성과 리포트
    const totalAICallsOptimized =
      comments.length - (commentsForAI?.length || 0);
    const optimizationRate =
      comments.length > 0
        ? Math.round((totalAICallsOptimized / comments.length) * 100)
        : 0;

    console.log(`[🚀 최적화 완료] 게시물 ${postKey}:`);
    console.log(`  📝 총 댓글: ${processingSummary.totalCommentsProcessed}개`);
    console.log(`  🎯 패턴 처리: ${ruleOrderCount}개 주문`);
    console.log(`  🤖 AI 처리: ${aiOrderCount}개 주문`);
    console.log(`  ⚡ 총 주문: ${processingSummary.generatedOrders}개`);
    console.log(`  👥 고객: ${processingSummary.generatedCustomers}개`);
    console.log(
      `  💡 AI 호출 최적화: ${totalAICallsOptimized}개 댓글 패턴 처리 (${optimizationRate}% 절약)`
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
// 헬퍼 함수: DB에서 특정 게시물의 상품 정보 가져오기
async function fetchProductMapForPost(supabase, userId, postKey) {
  // console.log(`[fetchProductMap] Start for post ${postKey}`);
  const productMap = new Map();
  try {
    const { data: products, error } = await supabase
      .from("products")
      .select(
        "product_id, base_price, price_options, item_number, title, quantity_text"
      ) // quantity_text 추가
      .eq("user_id", userId)
      .eq("post_key", postKey);
    if (error) {
      console.error(
        `[fetchProductMap] DB Error for post ${postKey}: ${error.message}`
      );
      throw error; // 오류 발생 시 상위로 전파
    }
    // console.log(
    //   `[fetchProductMap] Fetched ${
    //     products?.length ?? 0
    //   } products for post ${postKey}`
    // );
    if (products && products.length > 0) {
      products.forEach((p) => {
        const itemNumKey =
          typeof p.item_number === "number" && p.item_number > 0
            ? p.item_number
            : 1;
        if (p.product_id) {
          productMap.set(itemNumKey, {
            // 필요한 데이터만 Map에 저장
            product_id: p.product_id,
            base_price: p.base_price,
            price_options: p.price_options || [],
            title: p.title,
            quantity_text: p.quantity_text, // 순수 단위 추가
          });
        } else {
          console.warn(
            `[fetchProductMap] Product missing product_id for post ${postKey}, item_number ${itemNumKey}`
          );
        }
      });
    }
  } catch (e) {
    console.error(
      `[fetchProductMap] Exception for post ${postKey}: ${e.message}`,
      e.stack
    );
    throw e; // 에러 재전파
  }
  console.log(
    `[fetchProductMap] End for post ${postKey}, map size: ${productMap.size}`
  );
  return productMap;
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
  // GET과 POST 외 거부
  if (req.method !== "GET" && req.method !== "POST")
    return new Response(
      JSON.stringify({
        success: false,
        message: "허용되지 않는 메소드 (GET 또는 POST만 허용)",
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
    // URL 파라미터 또는 POST body에서 파라미터 추출
    let userId, testMode, processingLimit, processWithAI;

    if (req.method === "GET") {
      // GET 요청: URL 파라미터에서 추출
      const url = new URL(req.url);
      const params = url.searchParams;
      userId = params.get("userId");
      testMode = params.get("testMode")?.toLowerCase() === "true";
      processWithAI = params.get("processAI")?.toLowerCase() !== "false";
    } else if (req.method === "POST") {
      // POST 요청: body에서 추출
      const body = await req.json();
      userId = body.userId;
      testMode = body.testMode === true;
      processWithAI = body.processAI !== false;
    }

    if (!userId)
      return new Response(
        JSON.stringify({
          success: false,
          message: "파라미터 'userId'가 필요합니다.",
        }),
        {
          status: 400,
          headers: responseHeaders,
        }
      );

    // 🧪 테스트 모드 로깅
    if (testMode) {
      console.log(
        `🧪 테스트 모드 실행: userId=${userId} - 데이터베이스에 저장하지 않음`
      );
    }
    // 사용자 설정에서 post_fetch_limit 조회
    const { data: userSettings, error: userSettingsError } = await supabase
      .from("users")
      .select("post_fetch_limit")
      .eq("user_id", userId)
      .single();

    const defaultLimit = userSettings?.post_fetch_limit || 200; // 사용자 설정값 또는 기본값 200

    // 사용자 설정이 있으면 그것을 우선 사용, 파라미터는 사용자 설정이 없을 때만 적용
    if (userSettings?.post_fetch_limit) {
      // 사용자 설정이 있으면 무조건 그것을 사용 (파라미터 무시)
      processingLimit = userSettings.post_fetch_limit;
    } else {
      // 사용자 설정이 없으면 파라미터 또는 기본값 사용
      let requestedLimit;
      if (req.method === "GET") {
        const url = new URL(req.url);
        requestedLimit = parseInt(
          url.searchParams.get("limit") || defaultLimit.toString(),
          10
        );
      } else {
        const body = await req.json();
        requestedLimit = parseInt(body.limit || defaultLimit.toString(), 10);
      }
      processingLimit = requestedLimit > 0 ? requestedLimit : defaultLimit;
    }

    // 🧪 테스트 모드에서는 처리량 제한 (최대 5개)
    const maxLimit = testMode ? 5 : 1000; // 최대 1000개까지 허용
    processingLimit = Math.min(processingLimit, maxLimit);

    if (userSettingsError) {
      console.warn(
        `사용자 설정 조회 실패: ${userSettingsError.message}, 기본값 200 사용`
      );
    } else {
      // 파라미터 값 표시 (GET/POST 구분)
      let limitParam = "없음";
      if (req.method === "GET") {
        const url = new URL(req.url);
        limitParam = url.searchParams.get("limit") || "없음";
      } else if (req.method === "POST") {
        // POST의 경우 body에서 이미 처리됨
        limitParam = "POST body에서 처리됨";
      }
      console.log(
        `사용자 ${userId}의 게시물 제한 설정: ${
          userSettings?.post_fetch_limit || "미설정(기본값 200)"
        }${
          limitParam !== "없음" ? `, 파라미터: ${limitParam}` : ""
        } → 실제 가져올 개수: ${processingLimit}개`
      );
    }

    console.log(
      `band-get-posts 호출됨 (${req.method}): userId=${userId}, limit=${processingLimit}, processAI=${processWithAI}, testMode=${testMode}`
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
          dbPosts.forEach((dbPost) => {
            dbPostsMap.set(dbPost.post_key, {
              comment_count: dbPost.comment_count,
              last_checked_comment_at: dbPost.last_checked_comment_at
                ? new Date(dbPost.last_checked_comment_at).getTime()
                : 0,
              // <<< 변경 시작: is_product 정보 저장 >>>
              is_product: dbPost.is_product,
            });
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
      // 실제 주문 수를 확인하고 업데이트하기 위한 배열
      const postsToUpdateCommentInfo = [];
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
        // console.log(
        //   `  -> 게시물 ${postKey} 처리 중 (${isNewPost ? "신규" : "기존"})`
        // );
        // console.log(
        //   `  -> 기존 댓글 ${dbPostData?.comment_count ?? 0}개 api 댓글 ${
        //     apiPost.commentCount ?? 0
        //   }개`
        // );
        // --- 👇 [수정 1] 변수 초기화 위치 및 기본값 설정 👇 ---
        let finalCommentCountForUpdate =
          apiPost.commentCount ?? (dbPostData?.comment_count || 0); // 기본값: API 값 또는 DB 값
        let latestCommentTimestampForUpdate = null; // 업데이트할 마지막 확인 시간 (초기 null)
        // last_checked_comment_at의 경우, 성공 시에만 값을 할당하므로 초기값은 null이 더 적합합니다.
        let successfullyProcessedNewComments = false; // 새 댓글 처리 성공 여부 플래그
        // --- 👆 [수정 1] 변수 초기화 위치 및 기본값 설정 👆 ---
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

                  // 🧪 테스트 모드에서는 DB 저장 건너뛰기
                  if (!testMode) {
                    await savePostAndProducts(
                      supabase,
                      userId,
                      apiPost,
                      null,
                      bandKey,
                      aiExtractionStatus
                    );
                  } else {
                    console.log(
                      `🧪 테스트 모드: 게시물 ${postKey} 실패 상태 저장 건너뛰기`
                    );
                  }
                }
              } catch (aiError) {
                // AI 호출 자체가 실패한 경우
                console.error(
                  `게시물 ${postKey}: AI 분석 중 오류 발생`,
                  aiError
                );
                aiExtractionStatus = "error";

                // 🧪 테스트 모드에서는 DB 저장 건너뛰기
                if (!testMode) {
                  await savePostAndProducts(
                    supabase,
                    userId,
                    apiPost,
                    null,
                    bandKey,
                    aiExtractionStatus
                  );
                } else {
                  console.log(
                    `🧪 테스트 모드: 게시물 ${postKey} 오류 상태 저장 건너뛰기`
                  );
                }
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
            // 🧪 테스트 모드에서는 DB 저장 건너뛰기
            if (!testMode) {
              savedPostId = await savePostAndProducts(
                supabase,
                userId,
                apiPost,
                aiAnalysisResult,
                bandKey,
                aiExtractionStatus
              );
            } else {
              // 테스트 모드: 임시 ID 생성
              savedPostId = `test_${postKey}`;
              console.log(`🧪 테스트 모드: 게시물 ${postKey} 임시 ID 사용`);
            }
            // --- 👇 [수정 2 - 신규 게시물] 업데이트 목록 추가 시점 변경 👇 ---
            // 신규 게시물 처리가 모두 끝난 후, 계산된 값으로 업데이트 목록에 추가
            if (savedPostId) {
              // 게시물 저장이 성공했을 경우에만
              const updateInfo = {
                post_id: savedPostId,
                comment_count: finalCommentCountForUpdate,
              };
              // 새 댓글 처리 성공 시 (또는 처리할 새 댓글 없었을 시) + 유효한 타임스탬프 있을 시
              if (
                successfullyProcessedNewComments &&
                latestCommentTimestampForUpdate
              ) {
                updateInfo.last_checked_comment_at =
                  latestCommentTimestampForUpdate;
              }
              postsToUpdateCommentInfo.push(updateInfo);
              console.log(
                `    - [신규] 댓글 정보 업데이트 예정 (post_id: ${savedPostId}, count: ${
                  updateInfo.comment_count
                }, checked_at: ${updateInfo.last_checked_comment_at ?? "없음"})`
              );
            }
            // --- 👆 [수정 2 - 신규 게시물] 업데이트 목록 추가 시점 변경 👆 ---
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
                  author: c.author
                    ? {
                        name: c.author.name,
                        userNo: c.author.user_key,
                        profileImageUrl: c.author.profile_image_url,
                      }
                    : null,
                  content: c.content,
                }));
              } catch (commentError) {
                console.error(
                  `  Comment fetch error for new post ${postKey}: ${commentError.message}`
                );
              }
              if (newComments.length > 0) {
                try {
                  const productMapForNewPost = new Map();
                  if (aiAnalysisResult && aiAnalysisResult.products) {
                    aiAnalysisResult.products.forEach((p) => {
                      if (p.itemNumber != null && p.productId) {
                        productMapForNewPost.set(p.itemNumber, p); // AI 결과로 productMap 구성
                      }
                    });
                  }
                  // 사용자 설정 조회 (force_ai_processing)
                  let userSettings = null;
                  try {
                    const { data: userData, error: userError } = await supabase
                      .from("users")
                      .select("force_ai_processing")
                      .eq("user_id", userId)
                      .single();

                    if (userError && userError.code !== "PGRST116") {
                      console.warn(
                        `[사용자 설정] 조회 실패: ${userError.message}`
                      );
                    } else if (userData) {
                      userSettings = userData;
                      console.log(
                        `[사용자 설정] force_ai_processing: ${userData.force_ai_processing}`
                      );
                    }
                  } catch (settingsError) {
                    console.warn(
                      `[사용자 설정] 조회 오류: ${settingsError.message}`
                    );
                  }

                  const { orders, customers } = await generateOrderData(
                    supabase,
                    userId,
                    newComments,
                    postKey,
                    bandKey,
                    bandNumber,
                    productMapForNewPost,
                    apiPost, // 게시물 정보 전달
                    userSettings // 사용자 설정 전달
                  );
                  // 🧪 테스트 모드에서는 주문/고객 저장 건너뛰기
                  if (!testMode) {
                    // 주문 저장
                    if (orders.length > 0) {
                      const { error } = await supabase
                        .from("orders")
                        .upsert(orders, {
                          onConflict: "order_id",
                          ignoreDuplicates: true,
                        });
                      if (error)
                        console.error(
                          `    Order save error (post ${postKey}): ${error.message}`
                        );
                      else console.log(`    Saved ${orders.length} orders.`);
                    }

                    // 고객 저장
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
                  } else {
                    console.log(
                      `🧪 테스트 모드: ${orders.length}개 주문, ${
                        Array.from(customers.values()).length
                      }개 고객 저장 건너뛰기`
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
              dbPostData?.is_product === false &&
              dbPostData?.ai_extraction_status !== "failed"
            ) {
              return {
                ...apiPost,
                aiAnalysisResult: null,
                dbPostId: savedPostId,
              };
            }
            // 이전에 AI 추출 실패한 게시물은 재시도
            const needsAiRetry =
              dbPostData?.is_product === true &&
              (dbPostData?.ai_extraction_status === "failed" ||
                dbPostData?.ai_extraction_status === "error");
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
              (apiPost.commentCount || 0) > (dbPostData?.comment_count || 0);
            // 댓글 업데이트 필요: 기존 게시물이고 댓글 수 증가 (또는 테스트 모드)
            if (needsCommentUpdate || testMode) {
              if (dbPostData?.is_product === false) {
                console.log(
                  `    - 게시물 ${postKey}: '상품 아님' 표시, 댓글 처리 스킵`
                );
              } else {
                try {
                  // 1) 댓글 전부 fetch
                  const { comments: fullComments, latestTimestamp } =
                    await fetchBandComments(userId, postKey, bandKey, supabase);

                  // 2) 마지막 체크 이후 댓글만 필터
                  const lastCheckedTs = dbPostData.last_checked_comment_at || 0;
                  const newComments = fullComments
                    .filter((c) => c.createdAt > lastCheckedTs)
                    .map((c) => ({
                      ...c,
                      post_key: postKey,
                      band_key: bandKey,
                    }));

                  // 3) 상품 정보 Map 정의
                  const productMap = await fetchProductMapForPost(
                    supabase,
                    userId,
                    postKey
                  );

                  // 4) 신규 댓글이 있으면 주문/고객 생성
                  if (newComments.length > 0) {
                    // 사용자 설정 조회 (force_ai_processing)
                    let userSettings = null;
                    try {
                      const { data: userData, error: userError } =
                        await supabase
                          .from("users")
                          .select("force_ai_processing")
                          .eq("user_id", userId)
                          .single();

                      if (userError && userError.code !== "PGRST116") {
                        console.warn(
                          `[사용자 설정] 조회 실패: ${userError.message}`
                        );
                      } else if (userData) {
                        userSettings = userData;
                        console.log(
                          `[사용자 설정] force_ai_processing: ${userData.force_ai_processing}`
                        );
                      }
                    } catch (settingsError) {
                      console.warn(
                        `[사용자 설정] 조회 오류: ${settingsError.message}`
                      );
                    }

                    const { orders, customers } = await generateOrderData(
                      supabase,
                      userId,
                      newComments,
                      postKey,
                      bandKey,
                      bandNumber,
                      productMap,
                      apiPost, // 게시물 정보 추가
                      userSettings // 사용자 설정 전달
                    );
                    // 🧪 테스트 모드에서는 주문/고객 저장 건너뛰기
                    if (!testMode) {
                      // 주문 저장
                      if (orders.length) {
                        const { error: oErr } = await supabase
                          .from("orders")
                          .upsert(orders, {
                            onConflict: "order_id",
                            ignoreDuplicates: true,
                          });
                        if (oErr) console.error("Order save error:", oErr);
                      }
                      // 고객 저장
                      const custArr = Array.from(customers.values());
                      if (custArr.length) {
                        const { error: cErr } = await supabase
                          .from("customers")
                          .upsert(custArr, { onConflict: "customer_id" });
                        if (cErr) console.error("Customer save error:", cErr);
                      }
                    } else {
                      console.log(
                        `🧪 테스트 모드: ${orders.length}개 주문, ${
                          Array.from(customers.values()).length
                        }개 고객 저장 건너뛰기`
                      );
                    }

                    console.log(
                      `    - ${newComments.length}개의 신규 댓글 주문/고객 처리 완료 (Post ${postKey})`
                    );
                  } else {
                    console.log(
                      `    - 게시물 ${postKey}: 마지막 체크 이후 신규 댓글 없음`
                    );
                  }

                  // 4) 댓글 수 + last_checked_comment_at 무조건 업데이트
                  const newCount = fullComments.length;
                  const newChecked = latestTimestamp
                    ? new Date(latestTimestamp).toISOString()
                    : new Date().toISOString();
                  postsToUpdateCommentInfo.push({
                    post_id: savedPostId,
                    comment_count: newCount,
                    last_checked_comment_at: newChecked,
                  });
                  console.log(
                    `    - [업데이트] post_id=${savedPostId} 댓글 수=${newCount}, checked_at=${newChecked}`
                  );
                } catch (err) {
                  console.error(
                    `    - 댓글 처리 오류 (post ${postKey}): ${err.message}. 재시도 예정.`
                  );
                  // 실패 시 업데이트 건너뛰어 재시도 보장
                }
              }
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
          // --- 👇 [수정 5] DB 업데이트 로직 (upsert -> update) 👇 ---
          const updatePromises = postsToUpdateCommentInfo.map(
            async (updateInfo) => {
              // 업데이트할 필드 객체 동적 생성
              const fieldsToUpdate = {
                comment_count: updateInfo.comment_count,
              };
              // last_checked_comment_at 필드가 있을 때만 추가
              if (updateInfo.last_checked_comment_at) {
                fieldsToUpdate.last_checked_comment_at =
                  updateInfo.last_checked_comment_at;
              }
              // update().eq() 사용
              const { error } = await supabase
                .from("posts")
                .update(fieldsToUpdate)
                .eq("post_id", updateInfo.post_id); // post_id로 특정 레코드 지정
              if (error) {
                console.error(
                  `Post ${updateInfo.post_id} 댓글 정보 업데이트 오류:`,
                  error
                );
              } else {
                console.log(
                  `  - Post ${updateInfo.post_id} 업데이트 성공:`,
                  fieldsToUpdate
                );
              }
            }
          );
          await Promise.all(updatePromises);
          console.log("[5단계] 댓글 정보 일괄 업데이트 시도 완료.");
          // --- 👆 [수정 5] DB 업데이트 로직 (upsert -> update) 👆 ---
        } catch (updateError) {
          console.error(
            `[5단계] 댓글 정보 일괄 업데이트 중 예외 발생: ${updateError.message}`
          );
        }
      } else {
        console.log("[5단계] 댓글 정보 업데이트가 필요한 게시물이 없습니다.");
      }
    } else {
      console.log("[5단계] 댓글 정보 업데이트가 필요한 게시물이 없습니다.");
    }
    // 🧪 테스트 모드에서는 사용자 last_crawl_at 업데이트 건너뛰기
    if (!testMode) {
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
    } else {
      console.log("🧪 테스트 모드: 사용자 last_crawl_at 업데이트 건너뛰기");
    }
    // 7. 최종 결과 반환
    console.log(
      `[7단계] 처리 완료. ${postsWithAnalysis.length}개의 게시물 결과를 반환합니다.`
    );
    // 🧪 테스트 모드에서 추가 정보 제공
    const responseData = {
      success: true,
      testMode, // 🧪 테스트 모드 플래그 포함
      data: postsWithAnalysis,
      message: testMode
        ? `🧪 테스트 모드 완료 - ${postsWithAnalysis.length}개 게시물 분석 (저장 안함)`
        : undefined,
    };

    // 테스트 모드에서 댓글 파싱 분석 정보 추가
    if (testMode) {
      console.log("🧪 테스트 모드: 실제 댓글 데이터 가져와서 파싱 테스트 진행");

      const commentParsingTests = [];
      const postsWithCommentsForTest = postsWithAnalysis.filter(
        (p) => (p.commentCount || 0) > 0
      );

      // 댓글이 있는 게시물들에 대해 실제 댓글 가져와서 파싱 테스트
      for (const post of postsWithCommentsForTest) {
        try {
          const { comments } = await fetchBandComments(
            userId,
            post.postKey,
            post.bandKey,
            supabase
          );

          // 최대 5개 댓글만 테스트 (성능상)
          const testComments = comments.slice(0, 5);

          for (const comment of testComments) {
            // 실제 댓글 텍스트로 파싱 테스트
            const orderInfo = extractEnhancedOrderFromComment(comment.content);

            commentParsingTests.push({
              postKey: post.postKey,
              productTitle:
                post.aiAnalysisResult?.products?.[0]?.title || "상품정보 없음",
              originalComment: comment.content,
              commentAuthor: comment.author?.name || "익명",
              commentCreatedAt: comment.createdAt,
              extractedOrders: orderInfo,
              parsedSuccessfully: orderInfo && orderInfo.length > 0,
              totalQuantity: orderInfo
                ? orderInfo.reduce((sum, order) => sum + order.quantity, 0)
                : 0,
              hasPhoneOrYear: /(\d{4}|010-\d{4}-\d{4})/.test(comment.content),
              productPrice:
                post.aiAnalysisResult?.products?.[0]?.basePrice || 0,
            });
          }
        } catch (error) {
          console.error(
            `테스트 모드에서 댓글 가져오기 오류 (${post.postKey}): ${error.message}`
          );
        }
      }

      const testAnalysis = {
        totalPosts: postsWithAnalysis.length,
        postsWithComments: postsWithCommentsForTest.length,
        totalComments: postsWithAnalysis.reduce(
          (sum, p) => sum + (p.commentCount || 0),
          0
        ),
        postsWithProducts: postsWithAnalysis.filter(
          (p) =>
            p.aiAnalysisResult &&
            p.aiAnalysisResult.products &&
            p.aiAnalysisResult.products.length > 0
        ).length,
        commentDetails: postsWithCommentsForTest.map((p) => ({
          postKey: p.postKey,
          commentCount: p.commentCount,
          hasProducts: !!(
            p.aiAnalysisResult &&
            p.aiAnalysisResult.products &&
            p.aiAnalysisResult.products.length > 0
          ),
          productTitle:
            p.aiAnalysisResult?.products?.[0]?.title || "상품정보 없음",
          latestComments: p.latestComments || [],
        })),
        commentParsingTests: commentParsingTests,
      };
      responseData.testAnalysis = testAnalysis;
    }

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: responseHeaders,
    });
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
