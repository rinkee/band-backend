// test/simple-debug.js
const puppeteer = require("puppeteer");
const fs = require("fs");

async function debugComments() {
  console.log("밴드 댓글 디버깅 시작");

  const bandId = "82443310"; // 테스트할 밴드 ID
  const postId = "26120"; // 테스트할 게시물 ID

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--window-size=1280,720",
      ],
      defaultViewport: { width: 1280, height: 720 },
    });

    const page = await browser.newPage();

    // 네트워크 요청 모니터링 설정
    const commentRequests = [];
    page.on("request", (request) => {
      const url = request.url();
      if (
        url.includes("/api/") &&
        (url.includes("comment") || url.includes("Comment"))
      ) {
        commentRequests.push({
          url,
          method: request.method(),
          time: new Date().toISOString(),
        });
        console.log(`[요청] 댓글 관련 API: ${url}`);
      }
    });

    // 네트워크 응답 모니터링
    page.on("response", async (response) => {
      const url = response.url();
      if (
        url.includes("/api/") &&
        (url.includes("comment") || url.includes("Comment"))
      ) {
        try {
          const responseText = await response.text();
          console.log(`[응답] 댓글 API 응답 코드: ${response.status()}`);
          console.log(`[응답] 댓글 API 응답 길이: ${responseText.length}`);
          // 필요시 응답 내용을 파일로 저장
          fs.writeFileSync("comment_api_response.json", responseText);
        } catch (e) {
          console.log(`[응답] 텍스트 추출 오류: ${e.message}`);
        }
      }
    });

    // 콘솔 로그 모니터링
    page.on("console", (msg) => {
      console.log(`[브라우저 콘솔] ${msg.type()}: ${msg.text()}`);
    });

    // 네이버 로그인 페이지로 이동
    await page.goto("https://band.us/home", { waitUntil: "networkidle2" });
    console.log("밴드 홈페이지 로드 완료");

    // 네이버 로그인 버튼 클릭
    const naverLoginBtn = await page.$(".login_naver");
    if (naverLoginBtn) {
      await naverLoginBtn.click();
      await page.waitForNavigation({ waitUntil: "networkidle2" });
      console.log("네이버 로그인 페이지로 이동 완료");

      // ID와 비밀번호 입력 필드 찾기
      const idField = await page.$("#id");
      const pwField = await page.$("#pw");

      if (idField && pwField) {
        await idField.type("bibimember");
        await pwField.type("");

        // 로그인 버튼 클릭
        const loginButton = await page.$(".btn_login");
        if (loginButton) {
          await loginButton.click();
          await page.waitForNavigation({ waitUntil: "networkidle2" });
          console.log("로그인 성공");
        }
      }
    } else {
      console.log("이미 로그인되어 있거나 로그인 버튼을 찾을 수 없습니다.");
    }

    // 게시물 페이지로 이동
    const postUrl = `https://band.us/band/${bandId}/post/${postId}`;
    console.log(`게시물 페이지로 이동: ${postUrl}`);
    await page.goto(postUrl, { waitUntil: "networkidle2", timeout: 30000 });
    console.log("게시물 페이지 로드 완료");

    // 잠시 대기
    console.log("페이지 안정화를 위해 3초 대기...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 페이지 HTML 저장 (1차)
    const initialHtml = await page.content();
    fs.writeFileSync("page_initial.html", initialHtml);
    console.log("초기 HTML을 page_initial.html로 저장했습니다.");

    // 댓글 카운트 버튼 찾기 및 클릭
    console.log("댓글 버튼 찾기 시도...");
    const commentBtnInfo = await page.evaluate(() => {
      // 댓글 수 정보 확인
      const countElements = document.querySelectorAll(
        "span.count, .count.-commentCount"
      );
      const counts = [];
      countElements.forEach((el) => {
        counts.push({
          text: el.textContent.trim(),
          className: el.className,
          parentClass: el.parentElement ? el.parentElement.className : "none",
        });
      });

      // 댓글 관련 버튼 찾기
      const btns = [];
      const commentBtns = document.querySelectorAll(
        '._commentCountBtn, ._commentCountLayerBtn, .count.-commentCount, [class*="comment"][class*="count"], .uIconComments, button[class*="comment"]'
      );
      commentBtns.forEach((btn) => {
        btns.push({
          text: btn.textContent.trim(),
          className: btn.className,
          tagName: btn.tagName,
          clickable: btn.tagName === "BUTTON" || btn.tagName === "A",
        });
      });

      return { counts, btns };
    });

    console.log("댓글 카운트 정보:", commentBtnInfo.counts);
    console.log("댓글 버튼 정보:", commentBtnInfo.btns);

    // 댓글 버튼 클릭
    const clickResult = await page.evaluate(() => {
      const commentCountBtn = document.querySelector(
        '._commentCountBtn, ._commentCountLayerBtn, .count.-commentCount, [class*="comment"][class*="count"]'
      );
      if (commentCountBtn) {
        console.log("댓글 카운트 버튼 찾음:", commentCountBtn.textContent);
        commentCountBtn.click();
        return { success: true, element: commentCountBtn.className };
      }

      const commentIconBtn = document.querySelector(
        '._commentLayerBtn, .uIconComments, button[class*="comment"]'
      );
      if (commentIconBtn) {
        console.log("댓글 아이콘 버튼 찾음");
        commentIconBtn.click();
        return { success: true, element: commentIconBtn.className };
      }

      return { success: false, message: "댓글 버튼을 찾을 수 없음" };
    });

    console.log("댓글 버튼 클릭 결과:", clickResult);

    // 클릭 후 대기
    console.log("댓글 로딩을 위해 5초 대기...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // 클릭 후 HTML 저장
    const afterClickHtml = await page.content();
    fs.writeFileSync("page_after_click.html", afterClickHtml);
    console.log("클릭 후 HTML을 page_after_click.html로 저장했습니다.");

    // DOM 변화 확인
    const domChanges = await page.evaluate(() => {
      // 댓글 컨테이너 존재 확인
      const commentContainers = document.querySelectorAll(
        '.sCommentList, ._heightDetectAreaForComment, .commentListWrap, .commentList, .commentUl, [class*="comment"][class*="list"]'
      );

      // 댓글 관련 요소들 확인
      const commentElements = document.querySelectorAll(
        '.cComment, .comment, div[class*="comment-item"], .commentItem, .gListItem, .sCommentItem, [class*="comment"][class*="item"], li.uComment, .commentWrap > li'
      );

      return {
        containers: Array.from(commentContainers).map((el) => ({
          className: el.className,
          childCount: el.children.length,
          html:
            el.children.length > 0
              ? el.children[0].outerHTML.substring(0, 150)
              : "empty",
        })),
        elements: Array.from(commentElements).map((el) => ({
          className: el.className,
          text:
            el.textContent.substring(0, 50) +
            (el.textContent.length > 50 ? "..." : ""),
        })),
      };
    });

    console.log("댓글 컨테이너:", domChanges.containers);
    console.log("댓글 요소:", domChanges.elements);

    // 더 보기 버튼 찾기 및 클릭
    const moreButtonInfo = await page.evaluate(() => {
      const selectors = [
        ".viewMoreComments",
        ".cmtMore",
        ".more_comment",
        ".btn_cmt_more",
        "a[class*='more']",
        "button[class*='more']",
        "[class*='comment'][class*='more']",
        ".-moreCommentList",
        ".-moreComment",
      ];

      const buttons = [];
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          elements.forEach((el) => {
            buttons.push({
              selector,
              className: el.className,
              text: el.textContent.trim(),
              visible: el.offsetParent !== null,
            });

            // 버튼 클릭 시도
            if (el.offsetParent !== null) {
              el.click();
            }
          });
        }
      }

      return buttons;
    });

    console.log("더보기 버튼 정보:", moreButtonInfo);

    // 최종 대기
    console.log("최종 로딩을 위해 3초 대기...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 최종 HTML 저장
    const finalHtml = await page.content();
    fs.writeFileSync("page_final.html", finalHtml);
    console.log("최종 HTML을 page_final.html로 저장했습니다.");

    // 최종 댓글 추출
    const comments = await page.evaluate(() => {
      // 모든 댓글 관련 선택자 시도
      const commentSelectors = [
        ".cComment",
        ".comment",
        'div[class*="comment-item"]',
        ".commentItem",
        ".gListItem",
        ".sCommentItem",
        '[class*="comment"][class*="item"]',
        "li.uComment",
        ".commentWrap > li",
        ".sCommentList > li",
        "._commentListCollectionView > li",
        ".dPostCommentList ._commentListCollectionView li",
      ];

      let allComments = [];

      for (const selector of commentSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          console.log(
            `선택자 '${selector}'로 ${elements.length}개 댓글 요소 발견`
          );

          const commentsFromSelector = Array.from(elements).map((el) => {
            // 작성자 추출 시도
            const authorSelectors = [
              "strong.name",
              ".profileName",
              ".userName",
              ".authorName",
              '[class*="profile"] [class*="name"]',
              ".name",
            ];

            let author = null;
            for (const authorSelector of authorSelectors) {
              const authorEl = el.querySelector(authorSelector);
              if (authorEl && authorEl.textContent.trim()) {
                author = authorEl.textContent.trim();
                break;
              }
            }

            // 내용 추출 시도
            const contentSelectors = [
              ".txt",
              ".commentText",
              ".commentContent",
              '[class*="comment"] [class*="text"]',
              '[class*="comment"] [class*="content"]',
            ];

            let content = null;
            for (const contentSelector of contentSelectors) {
              const contentEl = el.querySelector(contentSelector);
              if (contentEl && contentEl.textContent.trim()) {
                content = contentEl.textContent.trim();
                break;
              }
            }

            // 시간 추출 시도
            const timeSelectors = [
              "time.time",
              ".date",
              ".commentTime",
              '[class*="comment"] [class*="time"]',
              '[class*="comment"] [class*="date"]',
            ];

            let time = null;
            for (const timeSelector of timeSelectors) {
              const timeEl = el.querySelector(timeSelector);
              if (timeEl) {
                time =
                  timeEl.getAttribute("title") || timeEl.textContent.trim();
                break;
              }
            }

            return {
              author: author || "작성자 없음",
              content: content || "내용 없음",
              time: time || "시간 정보 없음",
              selector,
              html: el.outerHTML.substring(0, 150) + "...",
            };
          });

          allComments = [...allComments, ...commentsFromSelector];
        }
      }

      return {
        count: allComments.length,
        comments: allComments,
      };
    });

    console.log(`댓글 추출 결과: 총 ${comments.count}개 댓글 발견`);
    comments.comments.forEach((comment, i) => {
      console.log(`댓글 ${i + 1}:
  작성자: ${comment.author}
  내용: ${comment.content}
  시간: ${comment.time}
  선택자: ${comment.selector}
  HTML 미리보기: ${comment.html}
  -------------------`);
    });

    // 디버깅 요약 정보 저장
    const debugSummary = {
      commentRequests,
      commentBtnInfo,
      clickResult,
      domChanges,
      moreButtonInfo,
      comments,
    };
    fs.writeFileSync(
      "debug_summary.json",
      JSON.stringify(debugSummary, null, 2)
    );
    console.log("디버깅 요약 정보를 debug_summary.json으로 저장했습니다.");

    // 브라우저 종료
    await browser.close();
    console.log("디버깅 완료");
  } catch (error) {
    console.error("디버깅 오류:", error.message);
    if (browser) await browser.close();
    process.exit(1);
  }
}

debugComments().catch(console.error);
