// 테스트 파일
import { corsHeadersGet, createJsonResponseHeaders } from "../_shared/cors.ts";
const responseHeaders = createJsonResponseHeaders(corsHeadersGet);

Deno.serve(async (req) => {
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: responseHeaders,
  });
});

// 댓글 파싱 테스트
function testCommentParsing() {
  // 기존 방식 테스트 케이스
  const testCases = [
    // 기존 밴드 방식
    {
      input: "1번 2개요",
      expected: [{ itemNumber: 1, quantity: 2, isAmbiguous: false }],
    },
    {
      input: "2세트요",
      expected: [{ itemNumber: 1, quantity: 2, isAmbiguous: true }],
    },
    {
      input: "3번 5개 주문합니다",
      expected: [{ itemNumber: 3, quantity: 5, isAmbiguous: false }],
    },

    // 새로운 밴드 방식 (4자리 숫자 포함)
    {
      input: "김은희/1958/상무점/떡갈비 2개",
      expected: [{ itemNumber: 1, quantity: 2, isAmbiguous: true }],
    },
    {
      input: "박지수/1985/금남로점/갈비탕 3개",
      expected: [{ itemNumber: 1, quantity: 3, isAmbiguous: true }],
    },
    {
      input: "이영수/2024/본점/비빔밥 1개",
      expected: [{ itemNumber: 1, quantity: 1, isAmbiguous: true }],
    },

    // 전화번호 포함 케이스
    {
      input: "010-1234-5678 떡갈비 5개",
      expected: [{ itemNumber: 1, quantity: 5, isAmbiguous: true }],
    },

    // 년도 표기 케이스
    {
      input: "1975년생 김철수 갈비 4개",
      expected: [{ itemNumber: 1, quantity: 4, isAmbiguous: true }],
    },

    // 혼합 케이스
    {
      input: "김은희/1958/상무점/1번 3개",
      expected: [{ itemNumber: 1, quantity: 3, isAmbiguous: false }],
    },

    // 취소/마감 케이스
    { input: "마감입니다", expected: [] },
    { input: "취소요", expected: [] },
  ];

  console.log("🧪 댓글 파싱 테스트 시작...");

  testCases.forEach((testCase, index) => {
    const result = extractEnhancedOrderFromComment(testCase.input);
    const isMatch =
      JSON.stringify(result) === JSON.stringify(testCase.expected);

    console.log(`\n테스트 ${index + 1}: ${isMatch ? "✅ 통과" : "❌ 실패"}`);
    console.log(`입력: "${testCase.input}"`);
    console.log(`예상: ${JSON.stringify(testCase.expected)}`);
    console.log(`결과: ${JSON.stringify(result)}`);
  });
}

// 테스트 실행 (주석 해제해서 사용)
// testCommentParsing();
