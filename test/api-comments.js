const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

async function extractCommentsFromAPI() {
  console.log("API 요청을 통한 댓글 추출 테스트 시작");

  const bandId = "82443310"; // 테스트할 밴드 ID
  const postId = "26123"; // 테스트할 게시물 ID

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false, // 화면에 표시
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--window-size=1280,720",
      ],
      defaultViewport: { width: 1280, height: 720 },
    });

    const page = await browser.newPage();

    // 저장된 쿠키 로드
    const cookiesPath = path.join(__dirname, "../cookies/bibimember.json");
    if (!fs.existsSync(cookiesPath)) {
      throw new Error(`쿠키 파일을 찾을 수 없습니다: ${cookiesPath}`);
    }

    const cookieFile = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
    const cookies = cookieFile.cookies || cookieFile;

    if (!Array.isArray(cookies)) {
      throw new Error("쿠키 파일 형식이 올바르지 않습니다.");
    }

    await page.setCookie(...cookies);
    console.log(`${cookies.length}개의 쿠키를 로드했습니다.`);

    // 네트워크 요청/응답 모니터링 설정 및 데이터 저장 변수
    const apiResponses = [];

    // 네트워크 요청 가로채기
    await page.setRequestInterception(true);

    // 가로챈 요청 처리 - 모든 요청 허용
    page.on("request", (request) => {
      request.continue();
    });

    // 응답 모니터링
    page.on("response", async (response) => {
      const url = response.url();
      if (
        url.includes("/api/") &&
        (url.includes("comment") || url.includes("Comment")) &&
        response.status() === 200
      ) {
        try {
          // API 응답 저장
          const responseText = await response.text();
          const contentType = response.headers()["content-type"] || "";

          if (
            contentType.includes("application/json") ||
            responseText.startsWith("{")
          ) {
            const responseData = {
              url,
              status: response.status(),
              contentType,
              data: JSON.parse(responseText),
              time: new Date().toISOString(),
            };

            apiResponses.push(responseData);
            console.log(`[응답] 댓글 API 응답 캡처: ${url}`);

            // 응답 파일로 저장
            fs.writeFileSync(
              `comment_api_${apiResponses.length}.json`,
              responseText
            );
          }
        } catch (e) {
          console.log(`[응답] 처리 오류: ${e.message}`);
        }
      }
    });

    // 콘솔 로그 모니터링
    page.on("console", (msg) => {
      if (msg.text().includes("comment") || msg.text().includes("Comment")) {
        console.log(`[브라우저 콘솔] ${msg.type()}: ${msg.text()}`);
      }
    });

    // 게시물 페이지로 이동
    const postUrl = `https://band.us/band/${bandId}/post/${postId}`;
    console.log(`게시물 페이지로 이동: ${postUrl}`);
    await page.goto(postUrl, { waitUntil: "networkidle2", timeout: 30000 });
    console.log("게시물 페이지 로드 완료");

    // 댓글 버튼 클릭 - 여러 방법으로 시도
    let commentBtnClicked = false;

    // 네이버 밴드에서 사용하는 댓글 버튼 클래스들
    const commentBtnSelectors = [
      "._commentCountBtn",
      "._commentCountLayerBtn",
      ".count.-commentCount",
      '[class*="comment"][class*="count"]',
      ".uIconComments",
    ];

    // 모든 선택자 시도
    for (const selector of commentBtnSelectors) {
      if (commentBtnClicked) break;

      const hasButton = await page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      }, selector);

      if (hasButton) {
        console.log(`댓글 버튼 클릭 완료 (선택자: ${selector})`);
        commentBtnClicked = true;
      }
    }

    if (!commentBtnClicked) {
      console.log(
        "선택자로 댓글 버튼을 찾지 못했습니다. 모든 버튼 중 댓글 관련 버튼 찾기"
      );

      // 모든 버튼 중 댓글이 포함된 버튼 찾기
      commentBtnClicked = await page.evaluate(() => {
        const allButtons = document.querySelectorAll(
          'button, a, span[class*="comment"]'
        );
        for (const btn of allButtons) {
          if (
            btn.textContent.includes("댓글") ||
            (btn.className && btn.className.includes("comment"))
          ) {
            btn.click();
            return true;
          }
        }
        return false;
      });
    }

    if (commentBtnClicked) {
      console.log("댓글 버튼 클릭 완료. API 요청을 기다립니다...");
    } else {
      console.log("댓글 버튼을 찾을 수 없습니다. 그대로 진행합니다.");
    }

    // API 요청이 완료될 때까지 대기
    console.log("API 응답을 캡처하기 위해 15초 대기...");
    await new Promise((resolve) => setTimeout(resolve, 15000));

    // 저장된 API 응답에서 댓글 추출
    console.log(`총 ${apiResponses.length}개의 API 응답을 캡처했습니다.`);

    // 모든 API 응답에서 댓글 정보 추출
    const comments = [];
    for (const response of apiResponses) {
      try {
        // 댓글 목록 추출 시도 (여러 경로 시도)
        const commentData = response.data;

        if (commentData.result_data?.comments) {
          // 일반적인 형식 (result_data.comments)
          const extractedComments = commentData.result_data.comments;
          console.log(`API에서 ${extractedComments.length}개 댓글 추출 성공`);

          for (const comment of extractedComments) {
            comments.push({
              author:
                comment.author_name ||
                comment.authorName ||
                comment.name ||
                "작성자 없음",
              content:
                comment.body || comment.content || comment.text || "내용 없음",
              time:
                comment.created_at ||
                comment.createdAt ||
                comment.date ||
                comment.time ||
                "시간 정보 없음",
            });
          }
        } else if (commentData.result_data?.commentList) {
          // 또 다른 가능한 경로 (result_data.commentList)
          const extractedComments = commentData.result_data.commentList;
          console.log(
            `API에서 ${extractedComments.length}개 댓글 추출 성공 (commentList)`
          );

          for (const comment of extractedComments) {
            comments.push({
              author:
                comment.author_name ||
                comment.authorName ||
                comment.name ||
                "작성자 없음",
              content:
                comment.body || comment.content || comment.text || "내용 없음",
              time:
                comment.created_at ||
                comment.createdAt ||
                comment.date ||
                comment.time ||
                "시간 정보 없음",
            });
          }
        } else if (commentData.items) {
          // 또 다른 가능한 경로 (items)
          const extractedComments = commentData.items;
          console.log(
            `API에서 ${extractedComments.length}개 댓글 추출 성공 (items)`
          );

          for (const comment of extractedComments) {
            comments.push({
              author:
                comment.author_name ||
                comment.authorName ||
                comment.name ||
                "작성자 없음",
              content:
                comment.body || comment.content || comment.text || "내용 없음",
              time:
                comment.created_at ||
                comment.createdAt ||
                comment.date ||
                comment.time ||
                "시간 정보 없음",
            });
          }
        } else {
          // 응답에서 댓글 정보를 찾지 못한 경우, 전체 응답 구조를 분석
          console.log(
            `API 응답에서 댓글을 찾을 수 없습니다. 응답 구조:`,
            JSON.stringify(Object.keys(commentData), null, 2)
          );

          // JSON 저장 (디버깅용)
          fs.writeFileSync(
            `unknown_response_${apiResponses.indexOf(response)}.json`,
            JSON.stringify(commentData, null, 2)
          );
        }
      } catch (error) {
        console.error(`API 응답 처리 중 오류: ${error.message}`);
      }
    }

    // 댓글 정보 출력 및 저장
    console.log(`총 ${comments.length}개의 댓글을 추출했습니다.`);

    if (comments.length > 0) {
      // 댓글 출력
      comments.forEach((comment, i) => {
        console.log(`댓글 ${i + 1}:
  작성자: ${comment.author}
  내용: ${comment.content}
  시간: ${comment.time}
  ---------------------`);
      });

      // 결과 저장
      const results = {
        postUrl,
        commentCount: comments.length,
        comments,
      };

      fs.writeFileSync(
        "comment_results_api.json",
        JSON.stringify(results, null, 2)
      );
      console.log(
        "댓글 추출 결과를 comment_results_api.json 파일로 저장했습니다."
      );
    } else {
      console.log("추출된 댓글이 없습니다.");

      // 현재 페이지의 HTML 저장 (디버깅용)
      const pageHtml = await page.content();
      fs.writeFileSync("page_no_comments.html", pageHtml);
      console.log("페이지 HTML을 page_no_comments.html 파일로 저장했습니다.");
    }

    // 브라우저 종료
    await browser.close();
    console.log("댓글 추출 테스트 완료");
  } catch (error) {
    console.error("오류 발생:", error.message);
    if (browser) await browser.close();
    process.exit(1);
  }
}

extractCommentsFromAPI().catch(console.error);
