// test/extract-comments-with-cookie.js
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

async function extractCommentsWithCookie() {
  console.log("저장된 쿠키를 사용한 댓글 추출 테스트 시작");

  const bandNumber = "82443310"; // 테스트할 밴드 ID
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
      throw new Error(
        `쿠키 파일을 찾을 수 없습니다: ${cookiesPath}. 먼저 login-save-cookies.js를 실행하세요.`
      );
    }

    const cookieFile = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
    // cookies 배열 안에 쿠키 객체들이 있는 형식인지 확인
    const cookies = cookieFile.cookies || cookieFile;

    if (!Array.isArray(cookies)) {
      throw new Error("쿠키 파일 형식이 올바르지 않습니다.");
    }

    await page.setCookie(...cookies);
    console.log(`${cookies.length}개의 쿠키를 로드했습니다.`);

    // 밴드 홈페이지로 이동하여 로그인 확인
    await page.goto("https://band.us/home", { waitUntil: "networkidle2" });

    const isLoggedIn = await page.evaluate(() => {
      return (
        !!document.querySelector(".profileInner") ||
        !!document.querySelector(".uName") ||
        !!document.querySelector(".userArea")
      );
    });

    if (!isLoggedIn) {
      console.log("쿠키로 로그인에 실패했습니다. 직접 로그인을 시도합니다.");

      // 밴드 홈페이지로 이동
      await page.goto("https://band.us/home", { waitUntil: "networkidle2" });

      throw new Error(
        "쿠키 로그인에 실패했습니다. 쿠키가 만료되었을 수 있습니다. 다시 로그인해주세요."
      );
    }

    console.log("쿠키를 사용한 로그인 확인 완료");

    // 네트워크 요청/응답 모니터링 설정
    page.on("request", (request) => {
      const url = request.url();
      if (
        url.includes("/api/") &&
        (url.includes("comment") || url.includes("Comment"))
      ) {
        console.log(`[요청] 댓글 API 요청: ${url}`);
      }
    });

    page.on("response", async (response) => {
      const url = response.url();
      if (
        url.includes("/api/") &&
        (url.includes("comment") || url.includes("Comment"))
      ) {
        console.log(`[응답] 댓글 API 응답 상태: ${response.status()}`);
        try {
          const responseText = await response.text();
          console.log(
            `[응답] 댓글 API 응답 크기: ${responseText.length} bytes`
          );
          fs.writeFileSync("comment_api_response.json", responseText);
        } catch (e) {
          console.log(`[응답] 텍스트 추출 오류: ${e.message}`);
        }
      }
    });

    // 브라우저 콘솔 로그 모니터링
    page.on("console", (msg) => {
      console.log(`[브라우저 콘솔] ${msg.type()}: ${msg.text()}`);
    });

    // 게시물 페이지로 이동
    const postUrl = `https://band.us/band/${bandNumber}/post/${postId}`;
    console.log(`게시물 페이지로 이동: ${postUrl}`);
    await page.goto(postUrl, { waitUntil: "networkidle2", timeout: 30000 });
    console.log("게시물 페이지 로드 완료");

    // 잠시 대기
    console.log("페이지 안정화를 위해 3초 대기...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 현재 HTML 저장
    const initialHtml = await page.content();
    fs.writeFileSync("page_before_click.html", initialHtml);

    // 댓글 카운트 및 댓글 버튼 찾기
    console.log("댓글 영역 확인 중...");
    const commentInfo = await page.evaluate(() => {
      // 댓글 수 표시 요소 찾기
      const countElements = document.querySelectorAll(
        'span.count, .count.-commentCount, span[class*="comment"]'
      );
      const counts = [];
      countElements.forEach((el) => {
        counts.push({
          text: el.textContent.trim(),
          className: el.className,
          outerHTML: el.outerHTML.substring(0, 100),
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
          outerHTML: btn.outerHTML.substring(0, 100),
        });
      });

      // 모든 링크 및 버튼 찾기 (댓글 관련 요소 찾기 위함)
      const allButtons = [];
      const allBtns = document.querySelectorAll("button, a");
      allBtns.forEach((btn) => {
        if (
          btn.textContent.includes("댓글") ||
          btn.className.includes("comment")
        ) {
          allButtons.push({
            text: btn.textContent.trim(),
            className: btn.className,
            tagName: btn.tagName,
            outerHTML: btn.outerHTML.substring(0, 100),
          });
        }
      });

      return { counts, btns, allButtons };
    });

    console.log("댓글 수 표시 요소:", commentInfo.counts);
    console.log("댓글 버튼:", commentInfo.btns);
    console.log("모든 댓글 관련 버튼:", commentInfo.allButtons);

    // 댓글 영역 표시 시도 (1차: 댓글 카운트 버튼 클릭)
    let commentBtnClicked = false;

    if (commentInfo.btns.length > 0) {
      // 첫 번째 댓글 버튼 클릭 시도
      console.log("댓글 버튼 클릭 시도...");
      commentBtnClicked = await page.evaluate(() => {
        const commentBtn = document.querySelector(
          '._commentCountBtn, ._commentCountLayerBtn, .count.-commentCount, [class*="comment"][class*="count"]'
        );
        if (commentBtn) {
          commentBtn.click();
          return true;
        }
        return false;
      });
    }

    if (!commentBtnClicked && commentInfo.allButtons.length > 0) {
      // 모든 댓글 관련 버튼 클릭 시도
      console.log("일반 버튼에서 댓글 관련 버튼 클릭 시도...");
      commentBtnClicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll("button, a");
        for (const btn of buttons) {
          if (
            btn.textContent.includes("댓글") ||
            btn.className.includes("comment")
          ) {
            btn.click();
            return true;
          }
        }
        return false;
      });
    }

    if (commentBtnClicked) {
      console.log("댓글 버튼 클릭 완료. 10초 대기...");
      // 댓글이 로드될 때까지 더 오래 대기
      await new Promise((resolve) => setTimeout(resolve, 10000));
    } else {
      console.log("댓글 버튼을 찾을 수 없습니다. 그대로 진행합니다.");
    }

    // 클릭 후 HTML 저장
    const afterClickHtml = await page.content();
    fs.writeFileSync("page_after_click.html", afterClickHtml);

    // 댓글 영역 확인
    const commentElements = await page.evaluate(() => {
      // 댓글 컨테이너 찾기
      const containers = [];
      const containerSelectors = [
        ".sCommentList",
        "._heightDetectAreaForComment",
        ".commentListWrap",
        ".commentList",
        ".commentUl",
        '[class*="comment"][class*="list"]',
        ".dPostCommentList",
        ".cCommentList",
      ];

      for (const selector of containerSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          elements.forEach((el) => {
            containers.push({
              selector,
              className: el.className,
              childCount: el.children.length,
              html: el.innerHTML.substring(0, 200) + "...",
            });
          });
        }
      }

      // 댓글 요소 찾기
      const comments = [];
      const commentSelectors = [
        ".sCommentItem",
        ".gListItem",
        ".commentItem",
        '[class*="comment"][class*="item"]',
        "li.uComment",
        ".commentWrap > li",
        "._commentListCollectionView > li",
        "._commentList > li",
        ".dCommentListCollectionView .uListContainer > li",
        ".dPostCommentMainView li",
        ".sCommentList li",
      ];

      for (const selector of commentSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          elements.forEach((el) => {
            comments.push({
              selector,
              className: el.className,
              text: el.textContent.trim().substring(0, 50) + "...",
              html: el.innerHTML.substring(0, 200) + "...",
            });
          });
        }
      }

      // 로딩 확인 (로딩 요소가 존재하면 아직 로딩 중)
      const loadingElements = document.querySelectorAll(
        '.loadingPage, .loading, .spinner, [class*="loading"]'
      );
      const isLoading = loadingElements.length > 0;

      return { containers, comments, isLoading };
    });

    console.log("댓글 컨테이너 수:", commentElements.containers.length);
    console.log("댓글 요소 수:", commentElements.comments.length);
    console.log("로딩 중:", commentElements.isLoading);

    // 더보기 버튼 찾기 및 클릭
    const hasMoreButton = await page.evaluate(() => {
      const moreButtons = document.querySelectorAll(
        '.viewMoreComments, .cmtMore, .more_comment, [class*="more"]'
      );
      let clicked = false;

      if (moreButtons.length > 0) {
        for (const btn of moreButtons) {
          if (btn.offsetParent !== null) {
            // 화면에 보이는 버튼인지 확인
            btn.click();
            clicked = true;
            break;
          }
        }
      }

      return clicked;
    });

    if (hasMoreButton) {
      console.log("더보기 버튼 클릭 완료. 3초 대기...");
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } else {
      console.log("더보기 버튼을 찾을 수 없습니다.");
    }

    // 최종 댓글 추출
    console.log("최종 댓글 추출 중...");
    const comments = await page.evaluate(() => {
      // 브라우저 콘솔에 디버그 정보 출력
      console.log("댓글 추출 시작: 댓글 요소 찾기");

      // 페이지 내에서 모든 li 요소를 순회하면서 댓글 관련 요소 찾기
      let commentItems = [];

      // 방법 1: 클래스명으로 찾기
      const commentSelectors = [
        "li.gListItem",
        "li.sCommentItem",
        "li.commentItem",
        'li[class*="comment"]',
        ".commentListWrap li",
        ".commentList li",
        ".sCommentList li",
        ".cCommentList li",
        'div[class*="comment"] li',
      ];

      for (const selector of commentSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          console.log(`'${selector}'로 ${elements.length}개 댓글 요소 발견`);
          for (const el of elements) {
            commentItems.push(el);
          }
        }
      }

      // 방법 2: 내용으로 댓글 추정하기 (backup)
      if (commentItems.length === 0) {
        console.log("클래스로 댓글을 찾지 못함. 내용으로 추정");
        const allLiElements = document.querySelectorAll("li");
        for (const li of allLiElements) {
          // 텍스트 내용이 있고, 작성자/시간 같은 요소가 있는지 확인
          if (
            li.textContent.trim().length > 10 &&
            (li.querySelector(".name") ||
              li.querySelector(".time") ||
              li.querySelector(".date"))
          ) {
            commentItems.push(li);
          }
        }
      }

      console.log(`총 ${commentItems.length}개의 댓글 요소 후보 발견`);

      // 댓글에서 데이터 추출
      const extractedComments = [];
      for (const item of commentItems) {
        // 작성자 추출
        let author = null;
        const authorElements = [
          item.querySelector("strong.name"),
          item.querySelector(".profileName"),
          item.querySelector(".userName"),
          item.querySelector(".authorName"),
          item.querySelector('[class*="profile"] [class*="name"]'),
          item.querySelector(".name"),
          item.querySelector(".nick"),
          item.querySelector('[class*="author"]'),
        ];

        for (const el of authorElements) {
          if (el && el.textContent.trim()) {
            author = el.textContent.trim();
            break;
          }
        }

        // 내용 추출
        let content = null;
        const contentElements = [
          item.querySelector(".txt"),
          item.querySelector(".commentText"),
          item.querySelector(".commentContent"),
          item.querySelector('[class*="comment"] [class*="text"]'),
          item.querySelector('[class*="comment"] [class*="content"]'),
          item.querySelector("p"),
        ];

        for (const el of contentElements) {
          if (el && el.textContent.trim()) {
            content = el.textContent.trim();
            break;
          }
        }

        // 텍스트 내용이 없으면 li 요소의 textContent에서 작성자 이름을 제외한 부분을 추출
        if (!content && author) {
          const fullText = item.textContent.trim();
          // 작성자 이름을 제외한 부분을 내용으로 간주
          content = fullText.replace(author, "").trim();
        }

        // 시간 추출
        let time = null;
        const timeElements = [
          item.querySelector("time.time"),
          item.querySelector(".date"),
          item.querySelector(".commentTime"),
          item.querySelector('[class*="comment"] [class*="time"]'),
          item.querySelector('[class*="comment"] [class*="date"]'),
        ];

        for (const el of timeElements) {
          if (el) {
            time = el.getAttribute("title") || el.textContent.trim();
            break;
          }
        }

        // 최소한 작성자나 내용이 있는 경우에만 추가
        if (author || content) {
          extractedComments.push({
            author: author || "작성자 없음",
            content: content || "내용 없음",
            time: time || "시간 정보 없음",
          });

          console.log(
            `댓글 발견 - 작성자: ${author || "익명"}, 내용: ${
              content ? content.substr(0, 20) + "..." : "내용 없음"
            }`
          );
        }
      }

      // 중복 제거: 같은 작성자, 내용을 가진 댓글은 하나만 유지
      const uniqueComments = [];
      const seen = new Set();

      for (const comment of extractedComments) {
        const key = `${comment.author}|${comment.content}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueComments.push(comment);
        }
      }

      console.log(
        `최종적으로 ${uniqueComments.length}개의 고유 댓글 추출 완료`
      );
      return uniqueComments;
    });

    // 댓글 출력
    comments.forEach((comment, i) => {
      console.log(`댓글 ${i + 1}:
  작성자: ${comment.author}
  내용: ${comment.content}
  시간: ${comment.time}
  ---------------------`);
    });

    // 최종 결과 저장
    const results = {
      postUrl,
      commentCount: comments.length,
      comments,
    };

    fs.writeFileSync("comment_results.json", JSON.stringify(results, null, 2));
    console.log("댓글 추출 결과를 comment_results.json 파일로 저장했습니다.");

    // 브라우저 종료
    await browser.close();
    console.log("댓글 추출 테스트 완료");
  } catch (error) {
    console.error("오류 발생:", error.message);
    if (browser) await browser.close();
    process.exit(1);
  }
}

extractCommentsWithCookie().catch(console.error);
