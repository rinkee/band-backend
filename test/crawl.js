const BandComments = require("../src/services/crawler/band.comments");
const logger = require("../src/config/logger");
const readline = require("readline");
require("dotenv").config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function testCrawlComments() {
  try {
    logger.info("댓글 크롤링 테스트 시작");

    // 테스트할 밴드 ID와 게시물 ID 설정
    const bandNumber = "82443310"; // 테스트할 밴드 ID
    const postIds = ["26111", "26112", "26113"]; // 여러 게시물 ID 테스트

    // BandComments 인스턴스 생성
    const crawler = new BandComments(bandNumber);

    // 네이버 계정 정보 설정
    const naverId = process.env.NAVER_ID;
    const naverPassword = process.env.NAVER_PASSWORD;

    if (!naverId || !naverPassword) {
      throw new Error("네이버 계정 정보가 환경 변수에 설정되지 않았습니다.");
    }

    // 여러 게시물에 대해 크롤링 실행
    for (const postId of postIds) {
      logger.info(`게시물 ${postId} 크롤링 시작`);

      const result = await crawler.crawlPostComments(
        naverId,
        naverPassword,
        postId
      );

      if (result.success) {
        if (result.data.status === "deleted") {
          logger.info(`게시물 ${postId}: ${result.data.message}`);
          continue;
        }

        if (result.data.status === "error") {
          logger.error(`게시물 ${postId}: ${result.data.message}`);
          continue;
        }

        if (result.data.status === "no_content") {
          logger.warn(`게시물 ${postId}: ${result.data.message}`);
          continue;
        }

        logger.info(
          `게시물 ${postId} 크롤링 성공: ${result.data.comments.length}개의 댓글 추출됨`
        );

        // 댓글 데이터 출력
        result.data.comments.forEach((comment, index) => {
          logger.info(
            `댓글 ${index + 1}: 작성자="${
              comment.name
            }", 내용="${comment.content.substring(0, 30)}..."`
          );
        });
      }
    }

    // 브라우저 종료
    await crawler.close();
  } catch (error) {
    logger.error(`테스트 중 오류 발생: ${error.message}`);
  } finally {
    rl.close();
  }
}

// 테스트 실행
testCrawlComments();
