const BandComments = require("../src/services/crawler/band.comments");
const fs = require("fs");

async function testBandComments() {
  console.log("BandComments 클래스 테스트 시작");

  const bandNumber = "82443310";
  const postId = "26123";

  let crawler;

  try {
    // BandComments 인스턴스 생성 (밴드 ID 제공)
    crawler = new BandComments(bandNumber, {
      useCache: false,
      skipLogin: false,
    });

    // 초기화
    console.log("크롤러 초기화 시작...");
    await crawler.initialize();
    console.log("크롤러 초기화 완료");

    // 로그인 확인
    console.log("로그인 상태 확인 중...");
    const isLoggedIn = await crawler.checkLoginStatus();
    console.log(`로그인 상태: ${isLoggedIn ? "로그인됨" : "로그인되지 않음"}`);

    if (!isLoggedIn) {
      console.log(
        "로그인이 필요합니다. 자동으로 저장된 쿠키를 사용해 로그인을 시도합니다."
      );
      const loginSuccess = await crawler.ensureLoggedIn();

      if (!loginSuccess) {
        console.log("로그인에 실패했습니다. 테스트를 종료합니다.");
        await crawler.closeBrowser();
        return;
      }
      console.log("로그인 성공!");
    }

    // 게시물 페이지로 이동
    const postUrl = `https://band.us/band/${bandNumber}/post/${postId}`;
    console.log(`게시물 페이지로 이동: ${postUrl}`);
    await crawler.navigateTo(postUrl);
    console.log("게시물 페이지 로드 완료");

    // 대기
    console.log("페이지 안정화를 위해 5초 대기...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // 모든 댓글 로드
    console.log("모든 댓글 로드 시작");
    const commentsLoaded = await crawler.loadAllComments();

    if (commentsLoaded) {
      console.log("댓글 로드 성공!");

      // 게시물 상세 정보 추출 (댓글 포함)
      console.log("게시물 상세 정보 및 댓글 추출 시작");
      const postDetails = await crawler.extractPostDetailFromPage();

      if (postDetails) {
        // 결과 출력
        console.log(`게시물 제목: ${postDetails.postTitle || "N/A"}`);
        console.log(`작성자: ${postDetails.authorName || "N/A"}`);
        console.log(
          `내용: ${(postDetails.postContent || "N/A").substring(0, 100)}...`
        );
        console.log(`댓글 수: ${postDetails.commentCount || 0}`);

        // 댓글 출력
        if (postDetails.comments && postDetails.comments.length > 0) {
          console.log("\n=== 댓글 목록 ===");
          postDetails.comments.forEach((comment, index) => {
            console.log(`\n댓글 ${index + 1}:`);
            console.log(`  작성자: ${comment.author || comment.name || "N/A"}`);
            console.log(`  내용: ${comment.content || "N/A"}`);
            console.log(
              `  시간: ${comment.time || comment.timestamp || "N/A"}`
            );
          });
        } else {
          console.log("추출된 댓글이 없습니다.");
        }

        // 결과 저장
        fs.writeFileSync(
          "band_post_with_comments.json",
          JSON.stringify(postDetails, null, 2)
        );
        console.log(
          "\n결과를 band_post_with_comments.json 파일로 저장했습니다."
        );
      } else {
        console.log("게시물 상세 정보 추출에 실패했습니다.");
      }
    } else {
      console.log("댓글 로드에 실패했습니다.");
    }
  } catch (error) {
    console.error("테스트 중 오류 발생:", error);
  } finally {
    // 브라우저 종료
    if (crawler && crawler.closeBrowser) {
      try {
        await crawler.closeBrowser();
        console.log("브라우저 종료됨");
      } catch (err) {
        console.error("브라우저 종료 중 오류:", err.message);
      }
    }
    console.log("BandComments 클래스 테스트 완료");
  }
}

// 테스트 실행
testBandComments().catch(console.error);
