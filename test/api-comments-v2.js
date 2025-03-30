const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

async function extractCommentsFromAPI() {
  console.log("API 요청을 통한 댓글 추출 테스트 시작 (v2)");

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

    // 네트워크 트래픽 로깅 활성화 (개발자 도구 네트워크 패널과 유사)
    await page.setRequestInterception(false); // 요청 가로채기 비활성화

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

    // CDP 세션 생성 (Chrome DevTools Protocol)
    const client = await page.target().createCDPSession();
    await client.send("Network.enable");

    // 모든 요청 로깅
    const networkRequests = [];
    const networkResponses = {};

    client.on("Network.requestWillBeSent", (request) => {
      networkRequests.push(request);
    });

    client.on("Network.responseReceived", async (response) => {
      if (
        response.response.url.includes("/api/") ||
        response.response.url.includes("comment") ||
        response.response.url.includes("Comment")
      ) {
        networkResponses[response.requestId] = response;
        console.log(`[응답] URL: ${response.response.url}`);
      }
    });

    client.on("Network.loadingFinished", async (event) => {
      const response = networkResponses[event.requestId];
      if (response) {
        try {
          const responseBody = await client.send("Network.getResponseBody", {
            requestId: event.requestId,
          });

          if (responseBody.body) {
            // 댓글 관련 응답만 저장
            if (
              response.response.url.includes("comment") ||
              response.response.url.includes("Comment") ||
              responseBody.body.includes("comment") ||
              responseBody.body.includes("Comment")
            ) {
              console.log(`[네트워크] 응답 캡처: ${response.response.url}`);

              // 파일로 응답 저장
              const fileName = `network_response_${Date.now()}.json`;
              fs.writeFileSync(fileName, responseBody.body);

              // JSON으로 파싱 시도 (댓글 추출)
              try {
                if (
                  responseBody.body.startsWith("{") ||
                  responseBody.body.startsWith("[")
                ) {
                  const jsonData = JSON.parse(responseBody.body);

                  // 댓글 관련 데이터 탐색 및 저장
                  if (
                    jsonData.result_data?.comments ||
                    jsonData.result_data?.commentList ||
                    jsonData.comments ||
                    jsonData.items
                  ) {
                    fs.writeFileSync(
                      `comment_data_${Date.now()}.json`,
                      responseBody.body
                    );
                    console.log(
                      `댓글 데이터 발견! comment_data_*.json 파일로 저장했습니다.`
                    );
                  }
                }
              } catch (err) {
                console.log(`JSON 파싱 오류: ${err.message}`);
              }
            }
          }
        } catch (err) {
          console.log(`응답 본문 가져오기 오류: ${err.message}`);
        }
      }
    });

    // 브라우저 콘솔 로그 모니터링
    page.on("console", (msg) => {
      console.log(`[브라우저 콘솔] ${msg.type()}: ${msg.text()}`);
    });

    // 게시물 페이지로 이동
    const postUrl = `https://band.us/band/${bandId}/post/${postId}`;
    console.log(`게시물 페이지로 이동: ${postUrl}`);
    await page.goto(postUrl, { waitUntil: "networkidle2", timeout: 30000 });
    console.log("게시물 페이지 로드 완료");

    // 페이지 HTML 저장 (디버깅용)
    const initialHtml = await page.content();
    fs.writeFileSync("page_initial_v2.html", initialHtml);

    // 댓글 버튼 클릭 - 여러 방법으로 시도
    console.log("페이지 요소 스캔 중...");

    // 페이지 내의 모든 요소에 대한 정보 수집 (디버깅용)
    await page.evaluate(() => {
      const allElements = Array.from(document.querySelectorAll("*"));
      console.log(`페이지 내 총 ${allElements.length}개 요소 확인`);

      // 댓글 관련 요소 탐색
      allElements.forEach((el) => {
        if (el.textContent && el.textContent.includes("댓글")) {
          console.log(
            "댓글 관련 요소 발견:",
            el.tagName,
            el.className,
            el.id,
            el.textContent.trim().substring(0, 20)
          );
        }
      });

      // 댓글 갯수 표시 요소 확인
      const commentCountElements = Array.from(
        document.querySelectorAll(".count")
      );
      commentCountElements.forEach((el) => {
        console.log("카운트 요소:", el.textContent.trim(), el.className);
      });
    });

    // 댓글 버튼 클릭
    let commentBtnClicked = false;

    // 네이버 밴드에서 사용하는 댓글 버튼 클래스들
    const commentBtnSelectors = [
      "._commentCountBtn",
      ".comment._commentCountBtn",
      "._commentCountLayerBtn",
      ".count.-commentCount",
      '[class*="comment"][class*="count"]',
      ".uIconComments",
      'span[class*="comment"]',
    ];

    // 모든 선택자 시도
    for (const selector of commentBtnSelectors) {
      if (commentBtnClicked) break;

      const hasButton = await page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        if (btn) {
          console.log(`댓글 버튼 발견: ${sel}, 내용: ${btn.textContent}`);
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
        // 모든 가능한 클릭 가능 요소 수집
        const allButtons = document.querySelectorAll("button, a, span, div");

        for (const btn of allButtons) {
          // 텍스트에 '댓글'이 포함되어 있으면 클릭
          if (btn.textContent && btn.textContent.includes("댓글")) {
            console.log(
              "댓글 텍스트 포함 요소 클릭:",
              btn.tagName,
              btn.className,
              btn.textContent.trim()
            );
            btn.click();
            return true;
          }
        }
        return false;
      });
    }

    // 클릭 후 페이지 상태 저장
    const afterClickHtml = await page.content();
    fs.writeFileSync("page_after_click_v2.html", afterClickHtml);

    if (commentBtnClicked) {
      console.log("댓글 버튼 클릭 완료. 네트워크 요청을 기다립니다...");
    } else {
      console.log(
        "댓글 버튼을 찾을 수 없습니다. 다른 방법으로 댓글 영역을 탐색합니다."
      );

      // 페이지에서 댓글 영역 확인
      await page.evaluate(() => {
        // 댓글 목록 또는 컨테이너 찾기
        const commentSelectors = [
          ".commentList",
          ".commentArea",
          ".commentBox",
          ".commentWrap",
          '[class*="comment"][class*="list"]',
          '[class*="comment"][class*="item"]',
        ];

        for (const selector of commentSelectors) {
          const container = document.querySelector(selector);
          if (container) {
            console.log(`댓글 컨테이너 발견: ${selector}`);
            console.log(`컨테이너 내 요소 수: ${container.children.length}`);

            // 컨테이너 내 요소 분석
            Array.from(container.children).forEach((child, index) => {
              if (index < 5) {
                // 처음 5개만 로그
                console.log(
                  `- 자식 ${index + 1}: ${child.tagName}, ${child.className}`
                );
              }
            });

            break;
          }
        }
      });
    }

    // 페이지 내 모든 댓글 관련 요소 검사
    const commentScanResults = await page.evaluate(() => {
      const results = {};

      // 클래스 이름에 'comment'가 포함된 모든 요소
      const commentElements = document.querySelectorAll('[class*="comment"]');
      results.commentClassElements = commentElements.length;

      // 텍스트에 '댓글'이 포함된 모든 요소
      const commentTextElements = Array.from(
        document.querySelectorAll("*")
      ).filter((el) => el.textContent && el.textContent.includes("댓글"));
      results.commentTextElements = commentTextElements.length;

      // 댓글 내용 추출 시도
      const possibleComments = [];

      // 일반적인 댓글 구조 (작성자-내용-시간)
      document.querySelectorAll('[class*="comment"]').forEach((el) => {
        // 댓글 블록 내부에서 작성자, 내용, 시간 정보 찾기
        let authorEl = el.querySelector(
          '[class*="author"], [class*="name"], [class*="writer"]'
        );
        let contentEl = el.querySelector(
          '[class*="content"], [class*="text"], [class*="body"]'
        );
        let timeEl = el.querySelector('[class*="time"], [class*="date"]');

        if (contentEl) {
          possibleComments.push({
            author: authorEl ? authorEl.textContent.trim() : "작성자 정보 없음",
            content: contentEl.textContent.trim(),
            time: timeEl ? timeEl.textContent.trim() : "시간 정보 없음",
          });
        }
      });

      results.possibleComments = possibleComments;
      return results;
    });

    console.log(
      `댓글 관련 클래스 요소: ${commentScanResults.commentClassElements}개`
    );
    console.log(
      `댓글 텍스트 포함 요소: ${commentScanResults.commentTextElements}개`
    );
    console.log(`가능한 댓글: ${commentScanResults.possibleComments.length}개`);

    if (commentScanResults.possibleComments.length > 0) {
      console.log("발견된 댓글:");
      commentScanResults.possibleComments.forEach((comment, i) => {
        console.log(`댓글 ${i + 1}:
  작성자: ${comment.author}
  내용: ${comment.content}
  시간: ${comment.time}
  ---------------------`);
      });

      // 결과 저장
      fs.writeFileSync(
        "comment_scan_results.json",
        JSON.stringify(commentScanResults.possibleComments, null, 2)
      );
      console.log(
        "댓글 스캔 결과를 comment_scan_results.json 파일로 저장했습니다."
      );
    }

    // 네트워크 응답 캡처 대기
    console.log("네트워크 응답을 캡처하기 위해 30초 대기...");
    await new Promise((resolve) => setTimeout(resolve, 30000));

    // 최종 페이지 상태 저장
    const finalHtml = await page.content();
    fs.writeFileSync("page_final_v2.html", finalHtml);

    // 최종 스캔
    const finalCommentScan = await page.evaluate(() => {
      const results = {};

      // 클래스 이름에 'comment'가 포함된 모든 요소
      const commentElements = document.querySelectorAll('[class*="comment"]');
      results.commentClassElements = commentElements.length;

      // 댓글 내용 추출 시도
      const possibleComments = [];

      // 일반적인 댓글 구조 (작성자-내용-시간)
      document.querySelectorAll('[class*="comment"]').forEach((el) => {
        // 댓글 블록 내부에서 작성자, 내용, 시간 정보 찾기
        let authorEl = el.querySelector(
          '[class*="author"], [class*="name"], [class*="writer"]'
        );
        let contentEl = el.querySelector(
          '[class*="content"], [class*="text"], [class*="body"]'
        );
        let timeEl = el.querySelector('[class*="time"], [class*="date"]');

        if (contentEl) {
          possibleComments.push({
            author: authorEl ? authorEl.textContent.trim() : "작성자 정보 없음",
            content: contentEl.textContent.trim(),
            time: timeEl ? timeEl.textContent.trim() : "시간 정보 없음",
          });
        }
      });

      results.possibleComments = possibleComments;
      return results;
    });

    console.log(
      `최종 댓글 관련 클래스 요소: ${finalCommentScan.commentClassElements}개`
    );
    console.log(
      `최종 가능한 댓글: ${finalCommentScan.possibleComments.length}개`
    );

    if (finalCommentScan.possibleComments.length > 0) {
      console.log("최종 발견된 댓글:");
      finalCommentScan.possibleComments.forEach((comment, i) => {
        console.log(`댓글 ${i + 1}:
  작성자: ${comment.author}
  내용: ${comment.content}
  시간: ${comment.time}
  ---------------------`);
      });

      // 결과 저장
      fs.writeFileSync(
        "final_comment_results.json",
        JSON.stringify(finalCommentScan.possibleComments, null, 2)
      );
      console.log(
        "최종 댓글 결과를 final_comment_results.json 파일로 저장했습니다."
      );
    }

    // 브라우저 종료
    await browser.close();
    console.log("댓글 추출 테스트 완료 (v2)");
  } catch (error) {
    console.error("오류 발생:", error.message);
    if (browser) await browser.close();
    process.exit(1);
  }
}

extractCommentsFromAPI().catch(console.error);
