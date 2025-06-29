// @ts-nocheck
// supabase/functions/band-get-posts-postkey/index.ts - 특정 post_key 게시물만 처리 - NO JWT AUTH (Security Risk!)
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

    const cache = new Set();
    const cleanObj = JSON.parse(
      JSON.stringify(obj, (key, value) => {
        if (typeof value === "object" && value !== null) {
          if (cache.has(value)) {
            return "[Circular Reference]";
          }
          cache.add(value);
        }
        // undefined 값 제거
        if (value === undefined) {
          return null;
        }
        // NaN, Infinity 처리
        if (typeof value === "number") {
          if (isNaN(value) || !isFinite(value)) {
            return null;
          }
        }
        return value;
      })
    );

    const result = JSON.stringify(cleanObj, null, space);

    // 결과 검증 - 다시 파싱해서 유효한 JSON인지 확인
    JSON.parse(result);

    return result;
  } catch (error) {
    console.error("JSON stringify error:", error, "Original object:", obj);
    // 매우 간단한 fallback JSON 반환
    return JSON.stringify({
      error: "JSON serialization failed",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
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

    // 게시물 상품 정보 요약
    const productsSummary = postInfo.products
      .map((product, index) => {
        const optionsStr =
          product.priceOptions
            ?.map((opt) => `${opt.quantity}개 ${opt.price}원`)
            .join(", ") || "";
        return `${index + 1}번 상품: ${product.title} - 기본가격: ${
          product.basePrice
        }원, 옵션: ${optionsStr}`;
      })
      .join("\n");

    // 댓글 정보 요약 (commentKey 포함)
    const commentsSummary = comments
      .map((comment, index) => {
        return `댓글${index + 1}: "${comment.content}" (작성자: ${
          comment.author?.name || "unknown"
        }, 시간: ${comment.createdAt}, 키: ${comment.commentKey})`;
      })
      .join("\n");

    const systemInstructions = `
당신은 댓글에서 주문 정보를 정확하게 추출하는 도우미입니다. 반드시 JSON 형식으로만 응답해야 하며, 그 외 텍스트는 절대 포함하지 마세요.

※ 🔥 **중요: 여러 상품 주문 처리 규칙** 🔥

**한 댓글에서 여러 상품을 주문한 경우 반드시 개별 주문으로 분리하세요:**

🚨 **절대 지켜야 할 규칙**: 
1. **상품명 키워드를 게시물의 상품 정보와 정확히 매칭하세요**
2. 한 상품당 하나의 주문만 생성하세요 (중복 생성 금지)
3. 수량을 정확히 파싱하세요 
4. 같은 상품을 여러 번 언급해도 하나로 통합하세요
5. **불필요한 추가 주문 생성 금지**

예시 분석:
- **"키워드1+수량, 키워드2+수량" 패턴** → **정확히 2개 주문**:
  1) 첫 번째 상품의 해당 수량 주문 (별도 주문)
  2) 두 번째 상품의 해당 수량 주문 (별도 주문)

- **"키워드1+수량 키워드2+수량" 패턴** → **정확히 2개 주문**:
  1) 첫 번째 상품의 해당 수량 주문 (별도 주문)  
  2) 두 번째 상품의 해당 수량 주문 (별도 주문)

- **수량이 명시된 여러 상품** → **각각 개별 주문으로 분리**:
  1) 각 상품의 키워드와 게시물 정보를 매칭하여 정확한 productItemNumber 결정
  2) 각 상품의 정확한 수량으로 개별 주문 생성

※ 주문 정보 추출 핵심 규칙:

1. **명확한 주문 의도 판별**: 다음과 같은 댓글은 주문으로 처리하세요.
   - 구체적인 수량이 명시된 경우: "2개요", "3개 주문", "5개 부탁드려요"
   - 상품 번호가 명시된 경우: "1번 2개", "2번 상품 1개"
   - 명확한 주문 의도: "주문할게요", "예약해주세요", "신청합니다"
   - **패턴 기반 주문**: "작성자명/숫자" 형태 (예: "김지연0381 상무/5", "홍길동/3", "이영희 대리/2")
   - **단순 숫자**: 댓글이 주로 숫자로만 구성된 경우 (예: "5", "3개", "2통")
   - **암묵적 주문**: 상품 게시물에서 단순히 수량만 언급한 경우도 주문 의도로 판단

   **❌ 주문이 아닌 댓글들 (반드시 제외하세요)**:
   - **공지/안내**: "마감되었습니다", "완판되었습니다", "재고 없음", "품절"
   - **문의**: "가격이 얼마인가요?", "언제 배송되나요?", "재고 있나요?"
   - **취소**: "취소해주세요", "주문 취소", "환불 요청", "취소할게요", "취소 요청"
   - **감사/인사**: "감사합니다", "잘 받았습니다", "수고하세요"
   - **일반 대화**: "좋네요", "맛있겠어요", "다음에 주문할게요"
   
   **🚨 취소 댓글 특별 처리**: 
   - 취소 관련 댓글은 isOrder: false로 처리하되, reason에 "취소 댓글"임을 명시하세요
   - 예: "취소해주세요" → {"isOrder": false, "reason": "취소 댓글 - 이전 주문 취소 요청"}

2. **상품 특정 규칙** (게시물 내용과 상품 정보를 함께 고려):
   - 상품 번호 명시: "1번", "2번" 등 명시적으로 상품을 지정한 경우 해당 상품으로 처리
   - **상품명 키워드 매칭**: 댓글에 상품명의 핵심 키워드가 포함된 경우 해당 상품으로 처리
     * 게시물의 상품 정보에서 각 상품의 **핵심 키워드**를 추출하여 매칭
     * **수량 파싱 패턴**: "키워드+숫자" (예: "사과2", "참외3", "빵1", "쿠키5" 등)
     * 상품명에 포함된 **구별되는 단어**를 기준으로 정확히 매칭
     * **번호가 명시된 경우 우선**: "1번", "2번" 등이 있으면 해당 번호 사용
   - **게시물 내용 기반 매칭**: 게시물에서 언급된 상품명/가격 정보와 댓글 내용을 종합하여 판단
   - 상품 지정이 애매한 경우: isAmbiguous: true로 설정하고 가장 가능성 높은 상품 추천
   - 단일 상품인 경우: 자동으로 해당 상품으로 처리

3. **수량 추출 규칙** (유연한 해석):
   - **상품별 개별 수량**: "간장2, 고추장1" → 간장 2개, 고추장 1개 (각각 별도 주문)
   - **상품명+숫자 패턴**: "간장1 고추장1" → 간장 1개, 고추장 1개 (각각 별도 주문)
   - 명확한 숫자: "2개", "3개", "5개 주문" → 해당 숫자
   - **패턴 내 숫자**: "김지연/5", "홍길동 대리/3" → 슬래시 뒤 숫자를 수량으로 인식
   - **단순 숫자**: "5", "3", "2" (단독 숫자) → 해당 숫자를 수량으로 인식
   - **한글 숫자**: "하나", "둘", "셋", "다섯" → 해당하는 아라비아 숫자로 변환
   - 단위가 붙은 숫자 제외: "300g", "2kg", "500ml" → 수량이 아님 (무게/용량 단위)
   
   **❌ 주문 의도가 없는 경우는 절대 처리하지 마세요**:
   - 수량이 있어도 명백히 주문이 아닌 문맥: "5시에 마감", "2일 후 배송", "3번째 문의"
   - 공지성 댓글에서의 숫자: "1차 마감", "2차 입고 예정"
   - 수량 미명시 + 주문 의도 있음: 1개로 처리 (단, 명백히 주문인 경우만)

※ 여러 상품 주문 예시:
✅ 개별 주문으로 분리해야 할 댓글들:

**❌ 절대 주문으로 처리하면 안 되는 댓글들**:
- "마감되었습니다" → isOrder: false (공지성 댓글)
- "완판되었습니다" → isOrder: false (공지성 댓글)  
- "재고 없음" → isOrder: false (공지성 댓글)
- "품절입니다" → isOrder: false (공지성 댓글)
- "가격이 얼마인가요?" → isOrder: false (문의 댓글)
- "언제 배송되나요?" → isOrder: false (문의 댓글)
- "감사합니다" → isOrder: false (인사 댓글)
- "잘 받았습니다" → isOrder: false (인사 댓글)
- "좋네요" → isOrder: false (일반 댓글)
- "맛있겠어요" → isOrder: false (일반 댓글)

**범용적인 분석 방법**:

1. **댓글에서 상품 키워드와 수량 추출**:
   - "키워드1+숫자, 키워드2+숫자" 패턴 인식
   - 각 키워드를 게시물의 상품 정보와 매칭

2. **게시물 상품 정보와 매칭**:
   - 1번 상품의 제목에서 핵심 키워드 추출 → 댓글의 키워드와 비교
   - 2번 상품의 제목에서 핵심 키워드 추출 → 댓글의 키워드와 비교
   - 가장 유사한 상품으로 productItemNumber 결정

3. **각 매칭된 상품별로 개별 주문 생성**:
   - 주문1: commentKey: "동일", productItemNumber: X, quantity: Y, isOrder: true
   - 주문2: commentKey: "동일", productItemNumber: Z, quantity: W, isOrder: true

4. **주문 생성 규칙**:
   - 한 댓글에서 N개 상품이 인식되면 정확히 N개 주문만 생성
   - 중복이나 불필요한 주문 생성 금지
   - 각 상품의 정확한 수량 반영

**중요**: 한 댓글에서 여러 상품을 언급하면 반드시 orders 배열에 여러 개의 주문 객체를 포함해야 합니다!

출력 형식:
{
  "orders": [
    {
      "commentKey": "댓글 고유키",
      "commentContent": "원본 댓글 내용", 
      "author": "작성자",
      "isOrder": true/false,
      "isAmbiguous": true/false,
      "productItemNumber": 숫자 또는 null,
      "quantity": 숫자 또는 null,
      "expectedUnitPrice": 숫자 또는 null,
      "expectedTotalPrice": 숫자 또는 null,
      "reason": "판별 이유 설명"
    }
  ]
}`;

    const userContent = `
다음 게시물과 댓글들을 분석하여 주문 정보를 추출해주세요:

=== 게시물 정보 ===
작성시간: ${postInfo.postTime}
내용: ${postInfo.content}

=== 상품 정보 ===
${productsSummary}

🔥 **상품 매핑 규칙**:
- 각 상품의 제목에서 핵심 키워드를 추출하여 댓글과 매칭하세요
- 가장 유사도가 높은 상품으로 productItemNumber를 결정하세요
- 번호가 명시된 경우("1번", "2번" 등) 해당 번호를 우선 사용하세요

=== 댓글들 ===
${commentsSummary}

위 규칙에 따라 각 댓글을 분석하여 JSON 형식으로 응답해주세요.`;

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
      console.error("Invalid AI response structure:", result);
      throw new Error("AI 응답에서 유효한 텍스트(JSON)를 찾을 수 없습니다.");
    }

    console.log("[AI 댓글 분석] AI 원본 응답 수신 완료");

    // JSON 파싱
    let jsonStr = responseText;
    const codeBlockRegex = /```(?:json)?([\s\S]*?)```/;
    const matches = jsonStr.match(codeBlockRegex);
    if (matches && matches[1]) {
      jsonStr = matches[1].trim();
    }

    if (!jsonStr.startsWith("{")) {
      const startIdx = jsonStr.indexOf("{");
      const endIdx = jsonStr.lastIndexOf("}");
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        jsonStr = jsonStr.substring(startIdx, endIdx + 1);
      }
    }

    const parsedResult = JSON.parse(jsonStr);

    if (!parsedResult.orders || !Array.isArray(parsedResult.orders)) {
      throw new Error("AI 응답에 orders 배열이 없습니다");
    }

    console.log(
      `[AI 댓글 분석] ${parsedResult.orders.length}개 댓글 분석 결과 받음`
    );

    // 🔥 디버깅: 여러 상품 주문 분석 결과 로깅
    const multipleOrderComments = parsedResult.orders.reduce((acc, order) => {
      if (!acc[order.commentKey]) {
        acc[order.commentKey] = [];
      }
      acc[order.commentKey].push(order);
      return acc;
    }, {});

    Object.entries(multipleOrderComments).forEach(([commentKey, orders]) => {
      if (orders.length > 1) {
        console.log(
          `[AI 다중주문 감지] 댓글 ${commentKey}: ${orders.length}개 주문 분리됨`
        );
        orders.forEach((order, index) => {
          console.log(
            `  주문${index + 1}: ${order.productItemNumber}번 상품, 수량: ${
              order.quantity
            }, 내용: "${order.commentContent}"`
          );
        });
      }
    });

    return parsedResult.orders;
  } catch (error) {
    console.error("[AI 댓글 분석] 실패:", error);
    return [];
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
basePrice: 유효한 판매 가격 옵션 중 가장 기본 단위(보통 quantity: 1)의 가격입니다. 유효한 가격이 없으면 0으로 설정합니다.
상품 구분 (multipleProducts):
true (여러 상품): 상품명이 명확히 다르거나(예: 사과, 배), 종류가 다르거나(예: 빨간 파프리카, 노란 파프리카), 번호/줄바꿈으로 구분된 경우. 특히 빵집 메뉴처럼 여러 품목이 나열된 경우에 해당합니다.
false (단일 상품): 동일 상품의 용량/수량별 옵션만 있는 경우(예: 우유 500ml, 우유 1L / 1봉 5000원, 2봉 3000원 ).
[JSON 필드 정의]
title: [M월D일] 상품명 형식. 날짜는 게시물 작성 시간 기준. 상품명은 괄호/부가정보 없이 자연스럽게 띄어쓰기(예: [5월17일] 성주꿀참외).
priceOptions: [{ "quantity": 숫자, "price": 숫자, "description": "옵션설명" }] 배열.
quantity: 주문 단위 수량 (예: '2봉지' 주문 시 quantity: 2). 내용물 개수(예: 12알)가 아님.
description: 주문 단위를 명확히 설명하는 텍스트 (예: "1봉지(6알)", "2봉지(12알)").
basePrice에 해당하는 옵션도 반드시 포함해야 합니다.
quantity (루트): 상품의 기본 판매 단위 수량 (보통 1).
quantityText: 기본 판매 단위를 설명하는 텍스트 (예: "1봉지", "1개").
productId: prod_${bandNumber}_${postId}_${itemNumber} 형식으로 생성.
stockQuantity: 명확한 재고 수량만 숫자로 추출 (예: "5개 한정" -> 5). 불명확하면 null.
pickupDate: "내일", "5월 10일", "3시 이후" 등의 텍스트를 게시물 작성 시간 기준으로 YYYY-MM-DDTHH:mm:ss.sssZ 형식으로 변환. 기간이 명시된 경우(예: 6/1~6/2), 가장 늦은 날짜를 기준으로 설정.
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
      "quantityText": "1개",
      "quantity": 1,
      "category": "식품",
      "status": "판매중",
      "tags": [],
      "features": [],
      "pickupInfo": "픽업 안내",
      "pickupDate": "YYYY-MM-DDTHH:mm:ss.sssZ",
      "pickupType": "픽업",
      "stockQuantity": null
    }
  ]
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
  "quantityText": "1봉지",
  "quantity": 1,
  "category": "식품",
  "status": "판매중",
  "tags": ["#특가"],
  "features": [],
  "pickupInfo": "오늘 오후 2시 이후 수령",
  "pickupDate": "YYYY-MM-DDTHH:mm:ss.sssZ",
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
      // console.log("[AI 분석] AI 원본 응답 텍스트 수신 완료.");
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
function extractEnhancedOrderFromComment(commentText) {
  const o = [];
  if (
    !commentText ||
    commentText.toLowerCase().includes("마감") ||
    commentText.toLowerCase().includes("취소")
  )
    return o;
  const pT = commentText.replace(/\s+/g, " ").trim();

  // 4자리 숫자는 개인정보(전화번호, 년도 등)로 판단하여 제외하는 함수
  function isValidOrderNumber(num) {
    return num >= 1 && num <= 999; // 1~999 사이의 숫자만 주문 관련 숫자로 인정
  }

  // "번" 패턴 먼저 검사 (예: "1번 2개", "3번 5개")
  const er = /(\d+)\s*번(?:[^\d\n]*?)(\d+)/g;
  let em = false;
  let m;
  while ((m = er.exec(pT)) !== null) {
    const i = parseInt(m[1]);
    const q = parseInt(m[2]);
    if (
      !isNaN(i) &&
      isValidOrderNumber(i) &&
      !isNaN(q) &&
      isValidOrderNumber(q)
    ) {
      o.push({
        itemNumber: i,
        quantity: q,
        isAmbiguous: false,
      });
      em = true;
    }
  }

  // "번" 패턴이 없거나 매칭되지 않은 경우, 일반 숫자에서 주문 수량 추출
  if (!pT.includes("번") || !em) {
    // 4자리 숫자와 개인정보 패턴을 제외한 숫자만 추출
    const nr = /(\d+)/g;
    const foundNumbers = [];

    while ((m = nr.exec(pT)) !== null) {
      const num = parseInt(m[1]);
      if (!isNaN(num) && isValidOrderNumber(num)) {
        foundNumbers.push(num);
      }
    }

    // 개인정보 패턴 감지 및 제외
    // 예: "김은희/1958/상무점/떡갈비 2개" -> 1958은 년도로 판단하여 제외, 2만 주문수량으로 인정
    const personalInfoPatterns = [
      /\/\d{4}\//, // /년도/ 패턴 (예: /1958/)
      /\d{4}-\d{2}-\d{2}/, // 날짜 패턴
      /\d{3}-\d{4}-\d{4}/, // 전화번호 패턴
      /\d{4}\s*년/, // 년도 패턴 (예: 1958년)
    ];

    // 개인정보 패턴이 포함된 숫자들을 찾아서 제외
    const excludeNumbers = new Set();
    personalInfoPatterns.forEach((pattern) => {
      const matches = pT.match(pattern);
      if (matches) {
        matches.forEach((match) => {
          const nums = match.match(/\d+/g);
          if (nums) {
            nums.forEach((num) => {
              const n = parseInt(num);
              if (n >= 1000) {
                // 4자리 이상 숫자는 제외
                excludeNumbers.add(n);
              }
            });
          }
        });
      }
    });

    // 유효한 주문 수량만 추출 (개인정보로 판단된 숫자 제외)
    const validQuantities = foundNumbers.filter(
      (num) => !excludeNumbers.has(num)
    );

    // 가장 작은 유효한 숫자를 주문 수량으로 사용 (일반적으로 주문 수량은 작은 숫자)
    if (validQuantities.length > 0 && !em) {
      const quantity = Math.min(...validQuantities);
      o.push({
        itemNumber: 1,
        quantity: quantity,
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
function generateOrderUniqueId(bandNumber, postId, commentKey, itemIdentifier) {
  return `order_${bandNumber}_${postId}_${commentKey}_item${itemIdentifier}`;
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
// 특정 게시물만 가져오는 함수
async function fetchSpecificBandPost(userId, postKey, supabase) {
  console.log(`사용자 ${userId}의 특정 게시물 ${postKey} 가져오기`);

  let bandAccessToken = null;
  let bandKey = null;
  let bandNumber = null;

  try {
    // 사용자 토큰 및 키 조회
    const { data, error } = await supabase
      .from("users")
      .select("band_access_token, band_key, band_number")
      .eq("user_id", userId)
      .single();

    if (error || !data?.band_access_token)
      throw new Error(
        `Band access token not found or DB error for user ${userId}: ${error?.message}`
      );

    bandAccessToken = data.band_access_token;
    bandKey = data.band_key;
    bandNumber = data.band_number;
  } catch (e) {
    console.error("Error fetching Band credentials:", e.message);
    throw e;
  }

  // 특정 게시물 조회를 위한 API URL
  // Band API에서는 전체 게시물을 가져와서 필터링하는 방식 사용
  const apiUrl = new URL(BAND_POSTS_API_URL);
  apiUrl.searchParams.set("access_token", bandAccessToken);
  if (bandKey) apiUrl.searchParams.set("band_key", bandKey);
  apiUrl.searchParams.set("limit", "200"); // 충분한 수량으로 설정하여 특정 게시물을 찾을 가능성 높임

  try {
    console.log(`특정 게시물 조회를 위한 밴드 API 호출: ${apiUrl.toString()}`);
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

    // 특정 postKey와 일치하는 게시물 찾기
    const targetPost = items.find((post) => post.post_key === postKey);

    if (!targetPost) {
      console.warn(`특정 게시물 ${postKey}을 찾을 수 없습니다.`);
      return {
        posts: [],
        bandKey: bandKey || "",
        bandNumber: bandNumber || "",
      };
    }

    const processedPost = {
      postKey: targetPost.post_key,
      bandKey: targetPost.band_key || bandKey,
      author: targetPost.author
        ? {
            name: targetPost.author.name,
            userNo: targetPost.author.user_key,
            profileImageUrl: targetPost.author.profile_image_url,
          }
        : null,
      content: targetPost.content,
      createdAt: targetPost.created_at,
      commentCount: targetPost.comment_count ?? 0,
      status: "활성",
      postedAt: targetPost.created_at,
      latestComments:
        targetPost.latest_comments?.map((c) => ({
          createdAt: c.created_at,
        })) || [],
      photos: targetPost.photos?.map((p) => p.url) || [],
    };

    console.log(`특정 게시물 ${postKey}을 성공적으로 가져왔습니다.`);
    return {
      posts: [processedPost],
      bandKey: bandKey || "",
      bandNumber: bandNumber || "",
    };
  } catch (error) {
    console.error("Error during specific Band post fetch:", error.message);
    throw error;
  }
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
    // AI 분류 결과 저장
    const classificationResult = isProductPost ? "상품게시물" : "일반게시물";
    const classificationReason =
      aiAnalysisResult?.reason ||
      (isProductPost ? "AI가 상품 정보를 감지함" : "상품 정보 없음");

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
      products_data: aiAnalysisResult
        ? safeJsonStringify(aiAnalysisResult)
        : null,
      multiple_products: aiAnalysisResult?.multipleProducts || false,
      ai_classification_result: classificationResult,
      ai_classification_reason: classificationReason,
      ai_classification_at: new Date().toISOString(),
    };

    // Post upsert 상세 로그 제거 (간소화)

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
  post = null // 게시물 정보 추가
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
    // --- 1. 게시물 관련 상품 정보 미리 조회 ---
    const { data: productsData, error: productsError } = await supabase
      .from("products")
      .select("*") // 필요한 필드만 선택하는 것이 더 효율적일 수 있음
      .eq("post_key", postKey)
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

    // AI 적용 시나리오 판별 - 현재는 모든 댓글에 AI 적용
    const shouldUseAI = comments.length > 0; // 댓글이 있으면 무조건 AI 적용

    // 나중에 최적화할 때 사용할 조건들 (주석 처리)
    // const shouldUseAI =
    //   isMultipleProductsPost ||
    //   comments.some((comment) => {
    //     const content = comment.content?.toLowerCase() || "";
    //     // 애매한 댓글 패턴 감지
    //     return (
    //       content.includes("한개요") ||
    //       content.includes("취소요") ||
    //       (content.includes("개") && !content.includes("번")) ||
    //       content === "네" ||
    //       content === "좋아요"
    //     );
    //   });

    if (shouldUseAI) {
      try {
        // AI 분석 진행 로그 (간소화)

        // 게시물 정보 준비 (게시물 내용 포함)
        const postInfo = {
          products: Array.from(productMap.values()).map((product) => ({
            title: product.title,
            basePrice: product.base_price,
            priceOptions: product.price_options || [],
          })),
          content: post?.content || "", // 실제 게시물 내용 포함
          postTime: post?.createdAt || new Date().toISOString(), // 실제 게시물 시간
        };

        aiOrderResults = await extractOrdersFromCommentsAI(
          postInfo,
          comments,
          bandNumber,
          postKey
        );

        if (aiOrderResults && aiOrderResults.length > 0) {
          useAIResults = true;
          console.log(
            `[주문 생성] AI 분석 완료: ${aiOrderResults.length}개 댓글 분석됨`
          );
        } else {
          console.log(
            `[주문 생성] AI 분석 결과가 없어서 기존 규칙 기반 로직으로 fallback`
          );
        }
      } catch (aiError) {
        console.error(
          `[주문 생성] AI 분석 실패, 기존 로직으로 fallback:`,
          aiError
        );
      }
    } else {
      console.log(`[주문 생성] 댓글이 없어 AI 분석을 건너뜁니다.`);
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
        // --- 4.4. 댓글에서 주문 정보 추출 (AI 결과 우선 사용) ---
        let orderItems = [];
        let isProcessedAsOrder = false;
        let aiAnalyzed = false;

        // AI 결과가 있으면 우선 사용
        if (useAIResults && aiOrderResults.length > 0) {
          // 같은 commentKey를 가진 모든 AI 결과를 찾기 (여러 상품 주문 처리)
          const aiResults = aiOrderResults.filter(
            (result) => result.commentKey === commentKey
          );

          if (aiResults.length > 0) {
            aiAnalyzed = true;

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
              }));
              isProcessedAsOrder = true;
              processingSummary.aiDetectedOrders += orderResults.length;

              // 🔥 디버깅: 여러 주문 아이템 생성 로깅
              if (orderResults.length > 1) {
                console.log(
                  `[주문생성 다중아이템] 댓글 ${commentKey}: ${orderResults.length}개 주문 아이템 생성`
                );
                orderItems.forEach((item, index) => {
                  console.log(
                    `  아이템${index + 1}: ${item.itemNumber}번 상품, 수량: ${
                      item.quantity
                    }`
                  );
                });
              }
            } else {
              // AI가 주문이 아니라고 판단한 경우 건너뛰기
              processingSummary.aiSkippedNonOrders++;
              continue;
            }
          }
        }

        // AI 결과가 없거나 해당 댓글 결과가 없으면 기존 로직 사용
        if (!aiAnalyzed) {
          const extractedOrderItems =
            extractEnhancedOrderFromComment(commentContent);
          if (extractedOrderItems && extractedOrderItems.length > 0) {
            // 추출 성공 시 모든 항목 사용
            orderItems = extractedOrderItems;
            isProcessedAsOrder = true;
          } else {
            // 추출 실패 시: 기본 주문 생성 (아이템 1, 수량 1)
            orderItems = [
              {
                itemNumber: 1,
                quantity: 1,
                isAmbiguous: true,
              },
            ];
            isProcessedAsOrder = true;
          }
          processingSummary.ruleBasedOrders += orderItems.length;
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
              bandKey,
              postKey,
              commentKey,
              `${itemNumber}_${orderIndex}`
            );

            // AI 분석 결과를 JSON으로 저장 (가격 정보 포함)
            const aiExtractionResult = orderItem
              ? {
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
                }
              : null;

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
              ai_extraction_result: aiExtractionResult
                ? safeJsonStringify(aiExtractionResult)
                : null,
            };
            orders.push(orderData);
            processingSummary.generatedOrders++;

            // 🔥 디버깅: 개별 주문 생성 로깅
            console.log(
              `[주문생성] ${orderId} - ${orderItem.itemNumber}번 상품 ${quantity}개 (댓글: ${commentKey})`
            );
          } // End of orderItems loop

          // 🔥 디버깅: 댓글당 최종 주문 개수 로깅
          if (orderItems.length > 1) {
            console.log(
              `[주문생성 완료] 댓글 ${commentKey}에서 총 ${orderItems.length}개 주문 생성됨`
            );
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

    console.log(
      `[주문 생성 완료] ${processingSummary.generatedOrders}개 주문 생성 (AI: ${aiOrderCount}, 규칙: ${ruleOrderCount}, 스킵: ${skippedCount})`
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
      .select("product_id, base_price, price_options, item_number, title") // 필요한 컬럼만 select
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
    const postKey = params.get("post_key"); // 특정 게시물 키 (필수)

    // 🧪 테스트 모드 파라미터 추가
    const testMode = params.get("testMode")?.toLowerCase() === "true";

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

    if (!postKey)
      return new Response(
        JSON.stringify({
          success: false,
          message: "쿼리 파라미터 'post_key'가 필요합니다.",
        }),
        {
          status: 400,
          headers: responseHeaders,
        }
      );

    // 🧪 테스트 모드 로깅
    if (testMode) {
      console.log(
        `🧪 테스트 모드 실행: userId=${userId}, postKey=${postKey} - 데이터베이스에 저장하지 않음`
      );
    }
    const processWithAI = params.get("processAI")?.toLowerCase() !== "false";
    console.log(
      `band-get-posts-postkey 호출됨 (인증 없음): userId=${userId}, postKey=${postKey}, processAI=${processWithAI}, testMode=${testMode}`
    );

    // === 메인 로직 ===
    // 1. 특정 Band 게시물 가져오기
    console.log(`[1단계] 특정 게시물 ${postKey} 가져오는 중...`);
    const { posts, bandKey, bandNumber } = await fetchSpecificBandPost(
      userId,
      postKey,
      supabase
    );
    console.log(`[1단계] 특정 게시물 조회 완료: ${posts.length}개`);
    if (!Array.isArray(posts))
      throw new Error("Failed to fetch posts or invalid format.");

    // 특정 게시물을 찾지 못한 경우
    if (posts.length === 0) {
      console.warn(`게시물 ${postKey}을 찾을 수 없습니다.`);
      return new Response(
        JSON.stringify({
          success: false,
          message: `게시물 ${postKey}을 찾을 수 없습니다.`,
          data: [],
        }),
        {
          status: 404,
          headers: responseHeaders,
        }
      );
    }
    let postsWithAnalysis = [];
    let postsToUpdateCommentInfo = [];
    // 2. DB 기존 게시물 조회
    console.log(`[2단계] DB에서 특정 게시물 ${postKey} 정보 가져오는 중...`);
    const dbPostsMap = new Map();
    if (posts.length > 0) {
      try {
        const { data: dbPosts, error: dbError } = await supabase
          .from("posts")
          .select(
            "post_key, comment_count, last_checked_comment_at, is_product"
          )
          .eq("user_id", userId)
          .eq("post_key", postKey); // 특정 post_key만 조회
        if (dbError) throw dbError;

        if (dbPosts && dbPosts.length > 0) {
          const dbPost = dbPosts[0];
          dbPostsMap.set(dbPost.post_key, {
            comment_count: dbPost.comment_count,
            last_checked_comment_at: dbPost.last_checked_comment_at
              ? new Date(dbPost.last_checked_comment_at).getTime()
              : 0,
            is_product: dbPost.is_product,
          });
          console.log(`[2단계] 기존 게시물 ${postKey}을 DB에서 찾았습니다.`);
        } else {
          console.log(
            `[2단계] 게시물 ${postKey}이 DB에 없습니다. (신규 게시물)`
          );
        }
      } catch (error) {
        console.error(`[2단계] DB post fetch error: ${error.message}`);
      }

      // 4. 특정 게시물 처리
      console.log(`[4단계] 특정 게시물 ${postKey} 처리 중...`);
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
                  author: c.author,
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
                  const { orders, customers } = await generateOrderData(
                    supabase,
                    userId,
                    newComments,
                    postKey,
                    bandKey,
                    bandNumber,
                    productMapForNewPost
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
              (apiPost.commentCount || 0) > (dbPostData?.comment_count || 0);
            // 댓글 업데이트 필요: 기존 게시물이고 댓글 수 증가
            if (needsCommentUpdate) {
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
                    const { orders, customers } = await generateOrderData(
                      supabase,
                      userId,
                      newComments,
                      postKey,
                      bandKey,
                      bandNumber,
                      productMap,
                      apiPost // 게시물 정보 추가
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
      `[7단계] 특정 게시물 ${postKey} 처리 완료. ${postsWithAnalysis.length}개의 게시물 결과를 반환합니다.`
    );
    // 🧪 테스트 모드에서 추가 정보 제공
    const responseData = {
      success: true,
      testMode, // 🧪 테스트 모드 플래그 포함
      data: postsWithAnalysis,
      postKey: postKey, // 처리된 특정 게시물 키 포함
      message: testMode
        ? `🧪 테스트 모드 완료 - 게시물 ${postKey} 분석 (저장 안함)`
        : `게시물 ${postKey} 처리 완료`,
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
    console.error(
      "Unhandled error in band-get-posts-postkey (No Auth):",
      error
    );

    // postKey를 안전하게 가져오기
    const errorPostKey =
      new URL(req.url).searchParams.get("post_key") || "unknown";

    return new Response(
      JSON.stringify({
        success: false,
        message: `특정 게시물 ${errorPostKey} 처리 중 심각한 오류 발생`,
        error: error.message,
        postKey: errorPostKey,
      }),
      {
        status: 500,
        headers: responseHeaders,
      }
    );
  }
});
