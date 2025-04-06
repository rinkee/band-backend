const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

async function extractCommentsBySelector() {
  console.log("댓글 컨테이너 로드 대기 후 추출 테스트 시작");

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
      throw new Error(`쿠키 파일을 찾을 수 없습니다: ${cookiesPath}`);
    }

    const cookieFile = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
    const cookies = cookieFile.cookies || cookieFile;

    if (!Array.isArray(cookies)) {
      throw new Error("쿠키 파일 형식이 올바르지 않습니다.");
    }

    await page.setCookie(...cookies);
    console.log(`${cookies.length}개의 쿠키를 로드했습니다.`);

    // 로그 모니터링
    page.on("console", (msg) => {
      console.log(`[브라우저] ${msg.text()}`);
    });

    // 게시물 페이지로 이동
    const postUrl = `https://band.us/band/${bandNumber}/post/${postId}`;
    console.log(`게시물 페이지로 이동: ${postUrl}`);
    await page.goto(postUrl, { waitUntil: "networkidle2", timeout: 30000 });
    console.log("게시물 페이지 로드 완료");

    // 5초 대기 (페이지 안정화)
    console.log("페이지 안정화를 위해 5초 대기...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // 댓글 버튼 클릭 전 페이지 저장
    const beforeClickHtml = await page.content();
    fs.writeFileSync("page_before_comment_click.html", beforeClickHtml);

    // 댓글 버튼 클릭
    console.log("댓글 버튼 찾기 및 클릭...");
    const commentBtnClicked = await page.evaluate(() => {
      // 댓글 버튼 찾기 시도
      const selectors = [
        "._commentCountBtn",
        ".comment._commentCountBtn",
        "span.comment",
        ".count.-commentCount",
        '[class*="comment"][class*="count"]',
      ];

      for (const selector of selectors) {
        const btn = document.querySelector(selector);
        if (btn) {
          console.log(`댓글 버튼 발견: ${selector}, 내용: ${btn.textContent}`);
          btn.click();
          return true;
        }
      }

      // 위의 선택자로 찾지 못했다면 텍스트로 찾기
      const allElements = document.querySelectorAll("*");
      for (const el of allElements) {
        if (
          el.textContent &&
          el.textContent.includes("댓글") &&
          (el.tagName === "BUTTON" ||
            el.tagName === "A" ||
            el.tagName === "SPAN")
        ) {
          console.log(
            `텍스트로 댓글 버튼 발견: ${el.tagName}, ${el.className}`
          );
          el.click();
          return true;
        }
      }

      return false;
    });

    if (commentBtnClicked) {
      console.log("댓글 버튼 클릭 완료");
    } else {
      console.log(
        "댓글 버튼을 찾지 못했습니다. 이미 댓글 영역이THE 표시되고 있는지 확인합니다."
      );
    }

    // 댓글 영역이 로드될 때까지 대기
    console.log("댓글 컨테이너가 로드될 때까지 대기...");

    try {
      // 댓글 컨테이너 선택자 (사용자가 제공한 정확한 선택자)
      const commentContainerSelector = ".dPostCommentMainView";

      // 댓글 컨테이너가 로드될 때까지 대기 (최대 20초)
      await page.waitForSelector(commentContainerSelector, {
        visible: true,
        timeout: 20000,
      });
      console.log("댓글 컨테이너 발견!");

      // 댓글이 완전히 로드될 시간 추가 대기
      console.log("댓글이 완전히 로드될 때까지 추가로 5초 대기...");
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // 댓글 컨테이너 로드 후 HTML 저장
      const afterLoadHtml = await page.content();
      fs.writeFileSync("page_with_comments.html", afterLoadHtml);

      // 댓글 추출
      console.log("댓글 추출 시작...");
      const comments = await page.evaluate(() => {
        const results = [];

        // 댓글 항목 선택자 (정확한 구조 기반)
        const commentItems = document.querySelectorAll(".cComment");
        console.log(`댓글 아이템 발견: ${commentItems.length}개`);

        commentItems.forEach((item, index) => {
          // 작성자 이름
          const nameEl = item.querySelector("strong.name");
          const name = nameEl ? nameEl.textContent.trim() : "작성자 정보 없음";

          // 댓글 내용
          const contentEl = item.querySelector("p.txt._commentContent");
          const content = contentEl
            ? contentEl.textContent.trim()
            : "내용 없음";

          // 작성 시간
          const timeEl = item.querySelector("time.time");
          const time = timeEl
            ? timeEl.getAttribute("title") || timeEl.textContent.trim()
            : "시간 정보 없음";

          // 댓글 객체 생성
          results.push({
            index: index + 1,
            author: name,
            content: content,
            time: time,
          });

          console.log(
            `댓글 ${index + 1} 추출 완료: ${name}, ${content.substring(
              0,
              20
            )}...`
          );
        });

        return results;
      });

      // 댓글 출력
      console.log(`총 ${comments.length}개의 댓글을 추출했습니다.`);
      comments.forEach((comment) => {
        console.log(`댓글 ${comment.index}:
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
        "comment_results_selector.json",
        JSON.stringify(results, null, 2)
      );
      console.log(
        "댓글 추출 결과를 comment_results_selector.json 파일로 저장했습니다."
      );
    } catch (error) {
      console.error(`댓글 컨테이너 대기 중 오류: ${error.message}`);

      // 오류 발생 시 현재 페이지 상태 저장
      const errorPageHtml = await page.content();
      fs.writeFileSync("page_error.html", errorPageHtml);
      console.log("오류 상태의 페이지를 page_error.html 파일로 저장했습니다.");

      // 대체 방법으로 댓글 찾기 시도
      console.log("대체 방법으로 댓글 찾기 시도...");
      const alternativeComments = await page.evaluate(() => {
        const results = [];

        // 다양한 선택자로 댓글 요소 찾기 시도
        const commentSelectors = [
          ".cComment",
          ".commentItem",
          ".sCommentItem",
          '[class*="comment"][class*="item"]',
          ".sCommentList > div",
          ".dPostCommentMainView .cComment",
        ];

        let foundComments = [];

        for (const selector of commentSelectors) {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            console.log(
              `선택자 '${selector}'로 ${elements.length}개 댓글 요소 발견`
            );
            foundComments = Array.from(elements);
            break;
          }
        }

        foundComments.forEach((item, index) => {
          // 작성자 이름 (다양한 선택자 시도)
          let name = "작성자 정보 없음";
          const nameSelectors = [
            "strong.name",
            ".name",
            ".userName",
            ".profileName",
            '[class*="name"]',
          ];
          for (const sel of nameSelectors) {
            const el = item.querySelector(sel);
            if (el && el.textContent.trim()) {
              name = el.textContent.trim();
              break;
            }
          }

          // 댓글 내용 (다양한 선택자 시도)
          let content = "내용 없음";
          const contentSelectors = [
            "p.txt",
            ".commentText",
            ".txt",
            ".commentContent",
            '[class*="content"]',
          ];
          for (const sel of contentSelectors) {
            const el = item.querySelector(sel);
            if (el && el.textContent.trim()) {
              content = el.textContent.trim();
              break;
            }
          }

          // 작성 시간 (다양한 선택자 시도)
          let time = "시간 정보 없음";
          const timeSelectors = [
            "time.time",
            ".time",
            ".date",
            ".commentTime",
            '[class*="time"]',
          ];
          for (const sel of timeSelectors) {
            const el = item.querySelector(sel);
            if (el) {
              time = el.getAttribute("title") || el.textContent.trim();
              break;
            }
          }

          // 댓글 객체 생성
          results.push({
            index: index + 1,
            author: name,
            content: content,
            time: time,
          });
        });

        return results;
      });

      if (alternativeComments.length > 0) {
        console.log(
          `대체 방법으로 ${alternativeComments.length}개의 댓글을 추출했습니다.`
        );
        alternativeComments.forEach((comment) => {
          console.log(`댓글 ${comment.index}:
  작성자: ${comment.author}
  내용: ${comment.content}
  시간: ${comment.time}
  ---------------------`);
        });

        // 결과 저장
        const results = {
          postUrl,
          commentCount: alternativeComments.length,
          comments: alternativeComments,
          note: "대체 방법으로 추출된 댓글입니다.",
        };

        fs.writeFileSync(
          "comment_results_alternative.json",
          JSON.stringify(results, null, 2)
        );
        console.log(
          "대체 방법으로 추출한 댓글 결과를 comment_results_alternative.json 파일로 저장했습니다."
        );
      } else {
        console.log("대체 방법으로도 댓글을 찾지 못했습니다.");
      }
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

extractCommentsBySelector().catch(console.error);
