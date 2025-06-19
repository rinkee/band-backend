const { extractOrdersFromComments } = require("../src/services/ai.service");

// 테스트 데이터
const testPostInfo = {
  products: [
    {
      title: "[6월18일] 성주꿀참외",
      basePrice: 15000,
      priceOptions: [
        { quantity: 1, price: 15000, description: "1박스(5kg)" },
        { quantity: 2, price: 28000, description: "2박스(10kg)" },
      ],
    },
    {
      title: "[6월18일] 애플망고",
      basePrice: 25000,
      priceOptions: [
        { quantity: 1, price: 25000, description: "1박스(2kg)" },
        { quantity: 2, price: 45000, description: "2박스(4kg)" },
      ],
    },
  ],
  content: "오늘 입고된 성주꿀참외와 애플망고 판매합니다!",
  postTime: "2024-06-18T10:00:00.000Z",
};

const testComments = [
  {
    content: "1번 2개 주문할게요",
    author: "김철수",
    timestamp: "2024-06-18T10:05:00.000Z",
    commentKey: "comment_1",
  },
  {
    content: "한개요",
    author: "이영희",
    timestamp: "2024-06-18T10:07:00.000Z",
    commentKey: "comment_2",
  },
  {
    content: "2번 상품 1개 주문합니다",
    author: "박민수",
    timestamp: "2024-06-18T10:10:00.000Z",
    commentKey: "comment_3",
  },
  {
    content: "가격이 어떻게 되나요?",
    author: "정수진",
    timestamp: "2024-06-18T10:12:00.000Z",
    commentKey: "comment_4",
  },
  {
    content: "취소요",
    author: "최영수",
    timestamp: "2024-06-18T10:15:00.000Z",
    commentKey: "comment_5",
  },
  {
    content: "참외 3개 부탁드려요",
    author: "강미영",
    timestamp: "2024-06-18T10:18:00.000Z",
    commentKey: "comment_6",
  },
];

async function testAICommentAnalysis() {
  console.log("=== AI 댓글 분석 테스트 시작 ===\n");

  try {
    console.log("테스트 게시물 정보:");
    console.log(`- 상품 개수: ${testPostInfo.products.length}개`);
    testPostInfo.products.forEach((product, index) => {
      console.log(
        `- ${index + 1}번: ${product.title} (${product.basePrice}원)`
      );
    });

    console.log("\n테스트 댓글:");
    testComments.forEach((comment, index) => {
      console.log(`${index + 1}. "${comment.content}" (${comment.author})`);
    });

    console.log("\n--- AI 분석 시작 ---");
    const startTime = Date.now();

    const results = await extractOrdersFromComments(
      testPostInfo,
      testComments,
      "band123",
      "post456"
    );

    const endTime = Date.now();
    console.log(`AI 분석 완료 (소요시간: ${endTime - startTime}ms)\n`);

    console.log("=== AI 분석 결과 ===");
    if (results && results.length > 0) {
      results.forEach((result, index) => {
        console.log(`\n${index + 1}. 댓글: "${result.commentContent}"`);
        console.log(`   작성자: ${result.author}`);
        console.log(
          `   주문 여부: ${result.isOrder ? "✅ 주문" : "❌ 비주문"}`
        );
        console.log(
          `   모호함: ${result.isAmbiguous ? "⚠️ 모호함" : "✅ 명확함"}`
        );
        console.log(`   상품 번호: ${result.productItemNumber || "N/A"}`);
        console.log(`   수량: ${result.quantity || "N/A"}`);
        console.log(`   판별 이유: ${result.reason}`);
      });

      // 요약 통계
      const orderCount = results.filter((r) => r.isOrder).length;
      const nonOrderCount = results.filter((r) => !r.isOrder).length;
      const ambiguousCount = results.filter((r) => r.isAmbiguous).length;

      console.log("\n=== 분석 요약 ===");
      console.log(`총 댓글: ${results.length}개`);
      console.log(`주문 댓글: ${orderCount}개`);
      console.log(`비주문 댓글: ${nonOrderCount}개`);
      console.log(`모호한 댓글: ${ambiguousCount}개`);
    } else {
      console.log("❌ AI 분석 결과가 없습니다.");
    }
  } catch (error) {
    console.error("❌ 테스트 실패:", error);
  }
}

// 환경 변수 체크
if (!process.env.GOOGLE_API_KEY) {
  console.error("❌ GOOGLE_API_KEY 환경변수가 설정되지 않았습니다.");
  console.log("다음 명령어로 API 키를 설정하세요:");
  console.log('export GOOGLE_API_KEY="your_api_key_here"');
  process.exit(1);
}

// 테스트 실행
testAICommentAnalysis()
  .then(() => {
    console.log("\n=== 테스트 완료 ===");
  })
  .catch((error) => {
    console.error("테스트 실행 오류:", error);
    process.exit(1);
  });
