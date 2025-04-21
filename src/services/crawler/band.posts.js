// src/services/crawler/band.posts.js

const BandAuth = require("./band.auth");
const {
  // --- 필요한 유틸리티 함수들 ---
  safeParseDate,
  hasClosingKeywords,
  generateOrderUniqueId, // 수정된 버전 필요 시 업데이트
  generatePostUniqueId,
  generateCustomerUniqueId,
  extractNumberedProducts, // <<<--- band.utils.js에 구현 필요
  generateProductUniqueIdForItem, // <<<--- band.utils.js에 구현 필요
  extractEnhancedOrderFromComment, // 댓글에서 주문 상세 추출
  contentHasPriceIndicator, // 가격 표시 감지
  generateBarcodeFromProductId, // <<<--- 바코드 생성 함수 추가
} = require("./band.utils");
const logger = require("../../config/logger");
const cheerio = require("cheerio");
const crypto = require("crypto");

// UUID v4 생성 함수
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * 밴드 게시물 크롤링 관련 클래스
 */
class BandPosts extends BandAuth {
  /**
   * 생성자
   * @param {string} bandNumber - 밴드 ID
   * @param {Object} options - 옵션
   */
  constructor(bandNumber, options = {}) {
    super();
    if (!bandNumber) {
      throw new Error("밴드 ID는 필수 값입니다.");
    }
    this.bandNumber = bandNumber;
    this.crawlStartTime = 0;
    this.options = { ...options };
    this.aiService = options.aiService || null; // 생성자 주입 방식 유지

    // logger.debug(`BandPosts 인스턴스 생성됨: bandNumber=${bandNumber}`);
  }

  /**
   * 상태 업데이트 콜백 함수 설정
   * @param {Function} callback - 상태 업데이트 시 호출될 콜백 함수
   */
  setOnStatusUpdate(callback) {
    this.onStatusUpdate = callback;
    logger.info("상태 업데이트 콜백이 설정되었습니다.");
  }

  /**
   * 내부 상태 업데이트 메소드
   * @param {string} status - 상태 ('processing', 'failed', 'completed' 등)
   * @param {string} message - 상태 메시지
   * @param {number} progress - 진행률 (0-100)
   */
  _updateStatus(status, message, progress) {
    if (this.onStatusUpdate && typeof this.onStatusUpdate === "function") {
      try {
        this.onStatusUpdate(status, message, progress);
      } catch (callbackError) {
        logger.error(
          `상태 업데이트 콜백 함수 실행 중 오류: ${callbackError.message}`,
          callbackError
        );
      }
    } else {
      const progressText =
        progress !== undefined ? ` 진행률: ${progress}% |` : "";
      logger.info(
        `[상태 업데이트]${progressText} 상태: ${status} | 메시지: ${message}`
      );
    }
  }

  // scrollToLoadPosts 함수는 변경 없음 (v_improved/v_working 동일)
  async scrollToLoadPosts(count) {
    logger.info(`게시물 스크롤링 시작`);
    let loadedPostsCount = 0;
    let lastPostsCount = 0;
    let scrollAttempts = 0;
    const MAX_SCROLL_ATTEMPTS = 50;

    while (loadedPostsCount < count && scrollAttempts < MAX_SCROLL_ATTEMPTS) {
      loadedPostsCount = await this.page.evaluate(() => {
        return document.querySelectorAll(".cCard").length;
      });

      if (loadedPostsCount >= count) break;
      if (loadedPostsCount === lastPostsCount) {
        scrollAttempts++;
        if (scrollAttempts >= 10 && loadedPostsCount > 0) {
          logger.warn(
            `더 이상 게시물이 로드되지 않는 것으로 판단됩니다 (${loadedPostsCount}개 로드됨).`
          );
          break;
        }
      } else {
        scrollAttempts = 0;
        lastPostsCount = loadedPostsCount;
      }

      await this.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      await new Promise((r) => setTimeout(r, 3000));
    }

    logger.info(`스크롤링 완료: ${loadedPostsCount}개 게시물 로드됨`);
    return loadedPostsCount;
  }

  /**
   * 게시물 상세 정보 추출 (v_working의 안정적인 버전 사용)
   * @returns {Promise<Object|null>} - 게시물 상세 정보 객체 또는 null
   */
  async extractPostDetailFromPage() {
    if (!this.page) {
      logger.error("페이지 없음. 추출 불가.");
      throw new Error("페이지 초기화 안됨");
    }
    const currentUrl = this.page.url();
    try {
      const isBlockedOrNotFound = await this.page.evaluate(() => {
        const blockKeywords = [
          "삭제되었거나",
          "찾을 수 없습니다",
          "삭제된 게시글",
          "존재하지 않는 게시글",
          "권한이 없습니다",
          "접근할 수 없습니다",
          "찾을 수 없는 페이지",
          "비공개 설정된 글",
        ];
        const bodyText = document.body.innerText || "";
        const errorContainer =
          document.querySelector(".errorContainer") ||
          document.querySelector(".bandDeletedPost");
        const errorText = errorContainer ? errorContainer.innerText : "";
        return blockKeywords.some(
          (keyword) => bodyText.includes(keyword) || errorText.includes(keyword)
        );
      });
      if (isBlockedOrNotFound) {
        logger.warn(`삭제/접근 불가 게시물: ${currentUrl}`);
        return null;
      }

      try {
        await this.page.waitForSelector(
          ".postSubject, .postWriterInfoWrap, .postText, .txtBody",
          { timeout: 10000 }
        );
      } catch (waitError) {
        logger.warn(
          `필수 콘텐츠 대기 실패 (${currentUrl}): ${waitError.message}`
        );
      }

      try {
        await this.page.waitForSelector(".sCommentList", {
          visible: true,
          timeout: 5000,
        });
      } catch (e) {
        logger.warn(
          `댓글 영역 로딩 실패 (${currentUrl}): ${e.message}. 계속 진행.`
        );
      }

      // 이전 댓글 로드 로직 (v_working과 동일)
      const prevButtonSelector =
        "button[data-uiselector='previousCommentButton']";
      let commentLoadAttempts = 0;
      const MAX_COMMENT_LOAD_ATTEMPTS = 30; // 이전 댓글 로드 시도 횟수
      while (
        (await this.page.$(prevButtonSelector)) &&
        commentLoadAttempts < MAX_COMMENT_LOAD_ATTEMPTS
      ) {
        logger.info(
          `이전 댓글 버튼 클릭 (시도 ${
            commentLoadAttempts + 1
          }) - ${currentUrl}`
        );
        try {
          await this.page.click(prevButtonSelector);
          // 대기 시간 증가 (네트워크 상태 고려)
          await new Promise((resolve) =>
            setTimeout(resolve, 2000 + Math.random() * 1000)
          );
          commentLoadAttempts++;
        } catch (clickError) {
          logger.warn(`이전 댓글 버튼 클릭 오류: ${clickError.message}. 중단.`);
          break; // 오류 발생 시 중단
        }
      }
      if (commentLoadAttempts >= MAX_COMMENT_LOAD_ATTEMPTS)
        logger.warn(`최대 댓글 로드 시도 도달 (${currentUrl}).`);

      const content = await this.page.content();
      const $ = cheerio.load(content);

      const postIdMatch = currentUrl.match(/\/post\/(\d+)/);
      if (!postIdMatch || !postIdMatch[1]) {
        logger.error(
          `표준 숫자 Post ID를 URL에서 찾을 수 없습니다: ${currentUrl}. 이 게시물 처리를 중단합니다.`
        );
        return null;
      }
      const postId = postIdMatch[1]; // 문자열 형태의 ID

      // --- v_working의 상세 추출 로직 ---
      const authorName = // v_working의 선택자 사용
        $(".postWriterInfoWrap .text, .userName").first().text().trim() ||
        "작성자 불명";

      let postTitle = $(".postSubject").first().text().trim() || ""; // 초기화

      const postContent = $(".postBody .dPostTextView .txtBody") // v_working의 선택자 사용
        .map((index, element) => $(element).text().trim())
        .get()
        .join("\n");

      // 제목이 없으면 내용 첫 줄 사용
      if (!postTitle && postContent)
        postTitle = postContent.split("\n")[0].substring(0, 50);
      if (!postTitle) postTitle = authorName || "제목 없음"; // 작성자 이름 또는 기본값

      const postTimeText =
        $(".postListInfoWrap .time, .etcArea .time").first().attr("title") ||
        $(".postListInfoWrap .time, .etcArea .time").first().text().trim() ||
        "";

      // 조회수 추출 (v_working 로직)
      const readCountText = $("._postReaders strong, .postMeta .count")
        .text()
        .trim();
      const readCountMatch =
        readCountText.match(/읽음\s*(\d+)/) ||
        readCountText.match(/(\d+)\s*명 읽음/) ||
        readCountText.match(/(\d+)/);
      const readCount = readCountMatch ? parseInt(readCountMatch[1], 10) : 0;

      const imageUrls = []; // 이미지 URL 추출 (v_working 로직)
      $(".imageListInner img, ._imageListView img, .attachedImage img").each(
        (i, el) => {
          const src = $(el).attr("src") || $(el).attr("data-src");
          if (src && !src.startsWith("data:image")) {
            // 고해상도 URL 시도 (옵션)
            const highResSrc = src.replace(/\[\d+x\d+\]/, "");
            imageUrls.push(highResSrc || src);
          }
        }
      );

      const comments = []; // 댓글 추출 (v_working 로직 - author 키 사용!)
      $(".cComment, .uCommentList li").each((index, el) => {
        const author = // <<<--- 'author' 키 사용
          $(el)
            .find(
              "button[data-uiselector='authorNameButton'] strong.name, .writerName"
            )
            .first()
            .text()
            .trim() || "익명";
        let commentContent = $(el)
          .find("p.txt._commentContent, .commentBody .text")
          .first()
          .text()
          .trim();
        // 대체 선택자
        if (!commentContent)
          commentContent = $(el).find(".comment_content").first().text().trim();
        const commentTime =
          $(el).find("time.time, .commentDate").first().attr("title") ||
          $(el).find("time.time, .commentDate").first().text().trim();

        if (commentContent)
          comments.push({
            author: author, // <<<--- 'author' 키 사용
            content: commentContent,
            time: commentTime,
          });
        else
          logger.warn(`댓글 내용 추출 실패 (Index ${index}) on ${currentUrl}`);
      });
      // --- 추출 로직 끝 ---

      logger.info(
        `게시물 ID ${postId} (${currentUrl}) - 댓글 ${comments.length}개 추출 완료`
      );

      // 반환 객체 구조 (v_working 기준)
      return {
        postId: postId, // 문자열 ID
        bandNumber: this.bandNumber,
        postTitle: postTitle,
        postContent: postContent,
        postTime: postTimeText,
        authorName: authorName, // <<<--- 추가됨
        readCount: readCount, // <<<--- 추가됨
        commentCount: comments.length,
        imageUrls: imageUrls, // <<<--- 추가됨
        comments: comments, // author 키 사용
        crawledAt: new Date().toISOString(),
        postUrl: currentUrl,
      };
    } catch (e) {
      logger.error(
        `게시물 상세 정보 추출 중 오류 (${currentUrl}): ${e.message}`,
        e.stack
      );
      return null;
    }
  }

  // savePostsToSupabase 함수는 변경 없음 (v_improved/v_working 동일)
  async savePostsToSupabase(posts) {
    // ... (기존 코드와 동일) ...
  }

  /**
   * 증분 크롤링 구현 (v_improved의 병렬 탭 방식 사용)
   */
  async crawlPostDetail(userId, naverId, naverPassword, maxPosts = 100) {
    try {
      this.crawlStartTime = Date.now();
      logger.info(`병렬 탭 증분 크롤링 시작, maxPosts=${maxPosts}`);

      // 1) 로그인+밴드 접속
      await this.accessBandPage(userId, naverId, naverPassword);
      await this.page.goto(`https://band.us/band/${this.bandNumber}`, {
        waitUntil: "networkidle2", // 메인 페이지는 networkidle2 유지
        timeout: 60000,
      });

      // 2) 최신 ID 및 lastSaved 읽기
      const latest = await this.getLatestPostId();
      if (!latest) {
        logger.error("최신 게시물 ID를 찾을 수 없어 크롤링 중단.");
        return { success: false, error: "최신 ID 없음" };
      }
      logger.info(`최신 ID: ${latest}`);

      const { data: urow, error: uerr } = await this.supabase
        .from("users")
        .select("last_crawled_post_id")
        .eq("user_id", userId)
        .single();

      // 오류 처리 개선: uerr가 존재하고, '결과 없음' 오류가 아닐 경우에만 throw
      if (uerr && uerr.code !== "PGRST116") throw uerr;
      const lastSaved = urow?.last_crawled_post_id || "0"; // 문자열 ID로 처리 (혹은 숫자 0)
      logger.debug(`기존 last_crawled_post_id=${lastSaved}`);

      // 3) 크롤링할 ID 리스트 준비
      let current = parseInt(latest, 10);
      // lastSaved가 문자열일 수 있으므로 숫자로 변환하여 비교
      const stopAt = parseInt(lastSaved, 10); // ID 비교는 숫자로
      const toCrawl = []; // 크롤링할 숫자 ID 목록
      for (let i = 0; i < maxPosts && current > stopAt; i++, current--) {
        toCrawl.push(current);
      }
      logger.info(`크롤링 대상 count: ${toCrawl.length}`);
      if (toCrawl.length === 0) {
        logger.info("크롤링할 새 게시물이 없습니다.");
        return { success: true, data: [] }; // 빈 배열 반환
      }

      // 4) 탭 두 개 띄우기
      const pageA = await this.browser.newPage();
      const pageB = await this.browser.newPage();

      // dialog 핸들러 등록 함수
      const attachDialogHandler = (page, name) => {
        page.on("dialog", async (dialog) => {
          logger.warn(
            `[${name}] dialog 발생: ${dialog.message()}. 자동으로 닫습니다.`
          );
          await dialog.accept();
        });
      };

      attachDialogHandler(this.page, "main");
      attachDialogHandler(pageA, "tabA");
      attachDialogHandler(pageB, "tabB");

      const results = []; // 추출된 상세 정보 저장 배열
      const start = Date.now();
      const TIMEOUT = 30 * 60 * 1000; // 30분 타임아웃

      // 5) 2개씩 묶어서 병렬 처리
      for (let i = 0; i < toCrawl.length; i += 2) {
        if (Date.now() - start > TIMEOUT) {
          logger.warn("크롤링 시간 초과로 중단합니다.");
          break;
        }

        const batch = toCrawl.slice(i, i + 2); // 숫자 ID 배치
        await Promise.all(
          batch.map(async (postIdNum, idx) => {
            // postIdNum은 숫자
            const page = idx === 0 ? pageA : pageB;
            const postIdStr = String(postIdNum); // URL 및 로깅에는 문자열 사용
            const url = `https://band.us/band/${this.bandNumber}/post/${postIdStr}`;
            logger.debug(
              `병렬 시도 ID=${postIdStr} on ${idx === 0 ? "A" : "B"}`
            );

            try {
              // 페이지 이동 (domcontentloaded 사용, 타임아웃 설정)
              await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 45000, // 타임아웃 약간 늘림 (45초)
              });
              // 짧은 대기 시간 (렌더링 보장)
              await new Promise((r) => setTimeout(r, 1000));

              // 데이터 추출 (v_working의 안정적인 버전 호출)
              // this 컨텍스트를 유지하면서 호출하기 위해 .call 사용
              const detail = await this.extractPostDetailFromPage.call({
                page: page,
              }); // 컨텍스트 전달

              if (!detail) {
                logger.debug(
                  `ID ${postIdStr}: 상세 정보 추출 실패 또는 건너뜀 (null 반환)`
                );
                return; // detail이 null이면 다음으로
              }

              // 마감 체크 로직 (v_improved 와 유사하게 적용)
              // detail 객체에 pickupDate 필드가 없으므로 이 부분은 제거 또는 수정 필요
              // const pickupDate = detail.pickupDate ? new Date(detail.pickupDate) : null;
              const closedByKeyword = detail.comments.some((c) =>
                hasClosingKeywords(c.content)
              );
              // const today = new Date();
              // today.setHours(0, 0, 0, 0);
              // const isClosedDate = pickupDate && pickupDate < today;

              // 마감 키워드가 없으면 결과에 추가 (pickupDate 조건 제거)
              if (!closedByKeyword) {
                // 성공적으로 추출된 데이터 추가 (v_working 포맷)
                results.push(detail);
                logger.info(`ID ${postIdStr}: 데이터 수집됨`);
              } else {
                logger.debug(`ID ${postIdStr}: 마감 키워드로 인해 제외됨`);
              }
            } catch (err) {
              // 개별 게시물 오류 로깅 (오류 스택 포함)
              logger.error(
                `ID ${postIdStr} 처리 중 오류: ${err.message}`,
                err.stack
              );
              // 특정 오류 유형에 따른 처리 (예: 타임아웃)
              if (err.name === "TimeoutError") {
                logger.warn(
                  `ID ${postIdStr}: 페이지 로드 타임아웃 발생. 건너뜁니다.`
                );
              }
            }
          })
        );
      } // 병렬 처리 루프 종료

      // 6) 탭 닫기
      await pageA.close();
      await pageB.close();

      logger.info(`병렬 크롤링 완료, 총 ${results.length}개 게시물 수집`);

      // 7) last_crawled_post_id 업데이트
      if (toCrawl.length > 0) {
        // 크롤링 시도한 ID 중 가장 작은 ID (크롤링 성공 여부와 관계없이 진행된 ID 기준)
        const lowestCrawledId = String(toCrawl[toCrawl.length - 1]);
        const currentLastSaved = parseInt(lastSaved, 10);
        const newLastSavedId = String(
          Math.max(currentLastSaved, parseInt(lowestCrawledId, 10))
        );

        logger.debug(
          `업데이트 할 last_crawled_post_id 계산: ${newLastSavedId} (기존: ${lastSaved}, 이번 크롤링 최저 시도 ID: ${lowestCrawledId})`
        );

        // 실제 저장된 ID보다 더 낮은 ID로 업데이트되지 않도록 방지
        if (parseInt(newLastSavedId, 10) > currentLastSaved) {
          const { error: uup } = await this.supabase
            .from("users")
            .update({ last_crawled_post_id: newLastSavedId }) // 문자열로 업데이트
            .eq("user_id", userId);
          if (uup)
            logger.error(`last_crawled_post_id 업데이트 오류: ${uup.message}`);
          else
            logger.debug(
              `last_crawled_post_id → ${newLastSavedId} 업데이트 완료`
            );
        } else {
          logger.debug(
            `last_crawled_post_id (${lastSaved}) 가 최신이므로 업데이트하지 않습니다.`
          );
        }
      }

      return { success: true, data: results }; // 수집된 상세 정보 반환
    } catch (e) {
      logger.error(`crawlPostDetail 전체 프로세스 에러: ${e.message}`, e.stack);
      return { success: false, error: e.message };
    }
  }

  /**
   * 최신 게시물 ID 가져오기
   * @returns {Promise<string|null>} - 최신 게시물 ID 또는 null
   */
  async getLatestPostId() {
    try {
      // 다양한 선택자로 최신 게시물 가져오기 시도
      const latestPostId = await this.page.evaluate(() => {
        // 우선 카드 형태의 게시물에서 href 속성 찾기
        const cardLinks = Array.from(
          document.querySelectorAll('.cCard a[href*="/post/"]')
        );
        if (cardLinks.length > 0) {
          const href = cardLinks[0].href;
          const match = href.match(/\/post\/(\d+)/);
          if (match && match[1]) {
            return match[1];
          }
        }

        // 대체 선택자: data-post-id 속성이 있는 요소
        const cardElements = Array.from(
          document.querySelectorAll(".cCard[data-post-id]")
        );
        if (cardElements.length > 0) {
          return cardElements[0].getAttribute("data-post-id");
        }

        // 기타 가능한 선택자들 시도
        const postLinks = Array.from(
          document.querySelectorAll('a[href*="/post/"]')
        );
        if (postLinks.length > 0) {
          const href = postLinks[0].href;
          const match = href.match(/\/post\/(\d+)/);
          if (match && match[1]) {
            return match[1];
          }
        }

        return null;
      });

      return latestPostId;
    } catch (error) {
      logger.error(`최신 게시물 ID 가져오기 오류: ${error.message}`);
      return null;
    }
  }

  /**
   * 게시물 상세 정보 Supabase 저장 (병렬 크롤링 결과 처리, AI 우선, 새 댓글만 처리, 안정적 주문 저장, 바코드)
   * @param {Array<Object>} detailedPosts - 저장할 게시물 목록 (v_working 포맷)
   * @param {string} userId - 사용자 ID
   * @param {boolean} processWithAI - AI 처리 활성화 여부
   */
  async saveDetailPostsToSupabase(detailedPosts, userId, processWithAI = true) {
    // --- 사전 검사 ---
    if (!userId) {
      /* ... */ throw new Error("userId 필수");
    }
    if (!this.supabase) {
      /* ... */ throw new Error("Supabase 클라이언트 없음");
    }
    if (!this.bandNumber) {
      /* ... */ throw new Error("밴드 ID 없음");
    }
    if (!detailedPosts || detailedPosts.length === 0) {
      logger.info("저장할 게시물 없음");
      this._updateStatus("completed", "저장할 데이터 없음", 100);
      return;
    }

    this._updateStatus(
      "processing",
      "DB 저장 준비 중 (AI 분석, 새 댓글 처리)",
      85 // 진행률 조정
    );
    const supabase = this.supabase;
    // bandNumber 처리는 text 기준으로 (v_improved 유지)
    const bandNumberStr = this.bandNumber;

    // AI 서비스 로드 (직접 require 사용 - v_improved 방식)
    let extractProductInfoAI = null;
    if (processWithAI) {
      try {
        extractProductInfoAI =
          require("../../services/ai.service").extractProductInfo;
        if (extractProductInfoAI) {
          logger.info("AI 서비스 (extractProductInfo) 로드됨.");
        } else {
          logger.warn(
            "AI 서비스 (extractProductInfo) 로드 시도했으나 함수를 찾을 수 없습니다."
          );
        }
      } catch (error) {
        logger.error(`AI 서비스 로드 중 오류: ${error.message}`);
        extractProductInfoAI = null;
      }
    }
    if (processWithAI && !extractProductInfoAI) {
      logger.warn("AI 처리가 요청되었으나, AI 서비스 로드에 실패했습니다.");
    }

    try {
      // --- Upsert 대상 배열들 ---
      const postsToUpsert = [];
      const productsToUpsert = [];
      const ordersToUpsert = [];
      const customersToUpsertMap = new Map();

      // --- 제외 고객 로드 (v_improved 방식) ---
      let excludedCustomers = [];
      try {
        const { data: userData, error: userError } = await supabase
          .from("users")
          .select("excluded_customers")
          .eq("user_id", userId)
          .single();
        if (userError && userError.code !== "PGRST116") throw userError;
        if (userData?.excluded_customers) {
          excludedCustomers = userData.excluded_customers
            .filter((n) => typeof n === "string")
            .map((n) => n.trim());
        }
        logger.info(`제외 고객 ${excludedCustomers.length}명 로드됨`);
      } catch (e) {
        logger.error(`제외 고객 조회 중 오류: ${e.message}`);
      }

      // --- 1) 기존 게시물 및 상품 정보 한 번에 불러오기 (v_improved 방식 - text 키 사용) ---
      const postNumbersStrings = detailedPosts
        .map((p) => p.postId) // 문자열 postId 사용
        .filter(Boolean); // null 또는 빈 문자열 제외

      const existingPostsMap = new Map();
      const existingProductsMap = new Map();

      if (postNumbersStrings.length > 0) {
        this._updateStatus(
          "processing",
          "기존 게시물/상품 정보 조회 중...",
          87
        );
        try {
          // 기존 게시물 (posts) - 필요한 필드 확인 (v_working 추출 기준)
          const { data: posts, error: postsErr } = await supabase
            .from("posts")
            .select(
              "post_id, content, comment_count, is_product, status, post_number, updated_at" // 필요한 최소 필드 + updated_at
            )
            .eq("user_id", userId)
            .eq("band_number", bandNumberStr) // 문자열 밴드 번호
            .in("post_number", postNumbersStrings); // 문자열 게시물 번호 목록

          if (postsErr) throw postsErr;
          (posts || []).forEach((p) => existingPostsMap.set(p.post_number, p));
          logger.debug(`${existingPostsMap.size}개의 기존 게시물 정보 로드됨`);

          // 기존 상품 (products)
          const { data: products, error: prodErr } = await supabase
            .from("products")
            .select(
              "product_id, post_number, item_number, status, order_summary"
            )
            .eq("user_id", userId)
            .eq("band_number", bandNumberStr)
            .in("post_number", postNumbersStrings);

          if (prodErr) throw prodErr;
          (products || []).forEach((p) => {
            if (!existingProductsMap.has(p.post_number))
              existingProductsMap.set(p.post_number, []);
            existingProductsMap.get(p.post_number).push({
              product_id: p.product_id,
              item_number: p.item_number,
              status: p.status,
              order_summary: p.order_summary || {
                total_orders: 0,
                total_quantity: 0,
              },
            });
          });
          logger.debug(
            `${existingProductsMap.size}개 게시물에 대한 기존 상품 정보 로드됨`
          );
        } catch (e) {
          logger.error(`기존 데이터 로드 중 오류: ${e.message}`, e.stack);
          this._updateStatus("failed", `DB 조회 오류: ${e.message}`, 90);
          throw e;
        }
      }

      this._updateStatus(
        "processing",
        `${detailedPosts.length}개 게시물 변경분 분석/변환 중...`,
        91
      );
      logger.info(
        `${detailedPosts.length}개 게시물 처리 시작 (새 댓글 처리, 안정적 주문 저장)`
      );

      // --- 메인 루프 ---
      for (const crawledPost of detailedPosts) {
        const postNumStr = crawledPost.postId; // 문자열 ID
        if (!postNumStr) {
          logger.warn(`잘못된 postId 발견 (빈 값), 건너뜁니다.`);
          continue;
        }
        const postNumInt = parseInt(postNumStr, 10); // 숫자 ID (DB 저장용, 필요시)
        if (isNaN(postNumInt)) {
          logger.warn(
            `잘못된 postId 발견 (${crawledPost.postId}), 건너뜁니다.`
          );
          continue;
        }

        const uniquePostId = generatePostUniqueId(
          userId,
          bandNumberStr,
          postNumStr
        );
        const crawledContent = crawledPost.postContent || "";
        // 댓글은 'author' 키를 가지고 있음 (v_working 추출 기준)
        const crawledComments = crawledPost.comments || [];
        const crawledCommentCount =
          crawledPost.commentCount || crawledComments.length; // commentCount 우선 사용
        const postedAt =
          safeParseDate(crawledPost.postTime) ||
          new Date(crawledPost.crawledAt) ||
          new Date();
        const postUrl =
          crawledPost.postUrl ||
          `https://band.us/band/${bandNumberStr}/post/${postNumStr}`;

        // --- 변경 감지 로직 (v_improved) ---
        const existingPost = existingPostsMap.get(postNumStr);
        const isNewPost = !existingPost;
        const contentChanged =
          !isNewPost && existingPost?.content !== crawledContent;
        const commentCountStored = existingPost?.comment_count ?? 0;
        const newCommentsExist = crawledCommentCount > commentCountStored;
        const commentCountDiff = Math.max(
          0,
          crawledCommentCount - commentCountStored
        ); // 음수 방지

        let postNeedsUpdate = isNewPost;
        let productNeedsUpdate = false; // AI 또는 상태 변경 시 true
        let runAI = false;
        let isProductPost = existingPost ? existingPost.is_product : false;
        const productMap = new Map(); // itemNumber -> productId
        let newProductsFromAI = []; // AI가 생성한 상품 데이터 임시 저장

        // --- 2) AI 분석 조건 결정 (v_improved) ---
        const mightBeProduct = contentHasPriceIndicator(crawledContent);
        if (
          extractProductInfoAI &&
          (isNewPost || contentChanged) &&
          mightBeProduct
        ) {
          runAI = true;
          logger.info(
            `ID ${postNumStr}: 신규/내용 변경 및 가격 지표 -> AI 분석 대상.`
          );
        } else if (!isNewPost && !contentChanged && existingPost?.is_product) {
          isProductPost = true;
          const existingProds = existingProductsMap.get(postNumStr) || [];
          existingProds.forEach(({ product_id, item_number }) => {
            productMap.set(item_number, product_id);
          });
          logger.info(
            `ID ${postNumStr}: 기존 상품 & 변경 없음 -> AI 스킵 (${productMap.size}개 상품 로드).`
          );
        } else if ((isNewPost || contentChanged) && mightBeProduct) {
          isProductPost = true; // AI 없어도 가격 지표 있으면 일단 상품으로 간주
          if (!isNewPost && !existingPost?.is_product) postNeedsUpdate = true;
          logger.info(
            `ID ${postNumStr}: 가격 지표 기반 상품 간주 (AI 스킵 또는 비대상).`
          );
        } else {
          // 가격 지표 없고, (신규거나 내용변경 없거나 기존 상품 아님)
          isProductPost = false;
          if (!isNewPost && existingPost?.is_product) postNeedsUpdate = true; // 상품->상품 아님 변경
        }

        // --- 3) AI 분석 실행 (필요한 경우) ---
        if (runAI) {
          try {
            logger.debug(`ID ${postNumStr}: AI 분석 호출 시작...`);
            // AI 서비스 호출 (재시도 로직은 ai.service.js 내부에 구현됨)
            const aiResult = await extractProductInfoAI(
              crawledContent,
              crawledPost.postTime, // 게시물 작성 시간
              bandNumberStr, // 밴드 번호 (문자열)
              postNumStr, // 게시물 번호 (문자열)
              crawledPost.imageUrls // 이미지 URL 목록 전달
            );
            logger.debug(`ID ${postNumStr}: AI 분석 호출 완료.`);

            if (aiResult && (aiResult.products?.length > 0 || aiResult.title)) {
              isProductPost = true;
              productNeedsUpdate = true; // AI 결과 반영 위해 업데이트 필요
              postNeedsUpdate = true;

              // AI 결과 파싱 (v_improved 로직 사용)
              const productsFromAIResult = aiResult.multipleProducts
                ? aiResult.products
                : [{ ...aiResult, itemNumber: 1 }]; // 단일 결과도 배열로

              for (const item of productsFromAIResult) {
                const idx =
                  typeof item.itemNumber === "number" && item.itemNumber > 0
                    ? item.itemNumber
                    : 1;
                const prodId = generateProductUniqueIdForItem(
                  userId,
                  bandNumberStr,
                  postNumStr,
                  idx
                );
                productMap.set(idx, prodId);

                // 가격 결정 로직 (v_working 또는 수정된 v_improved 로직 적용)
                let salePrice = 0;
                if (typeof item.basePrice === "number" && item.basePrice > 0) {
                  salePrice = item.basePrice;
                } else if (
                  Array.isArray(item.priceOptions) &&
                  item.priceOptions.length > 0 &&
                  typeof item.priceOptions[0].price === "number"
                ) {
                  salePrice = item.priceOptions[0].price;
                } else {
                  logger.warn(
                    `ID ${postNumStr}, 상품 ${idx}: AI 가격 정보 (basePrice, priceOptions) 부재 또는 유효하지 않음. 0원으로 설정.`
                  );
                }

                const existingProdInfo = (
                  existingProductsMap.get(postNumStr) || []
                ).find((p) => p.item_number === idx);

                // --- 상품 데이터 생성 (바코드 포함!) ---
                const productData = {
                  product_id: prodId,
                  user_id: userId,
                  post_id: uniquePostId, // 내부 참조용 UUID
                  post_number: postNumStr, // 밴드 게시물 번호 (문자열)
                  band_number: bandNumberStr, // 밴드 번호 (문자열)
                  item_number: idx,
                  title: item.title || "제목 없음",
                  content: crawledContent, // 게시물 본문 저장
                  base_price: salePrice,
                  band_post_url: postUrl, // 상품 테이블에도 URL 추가 (옵션)
                  original_price:
                    item.originalPrice !== null &&
                    item.originalPrice !== salePrice
                      ? item.originalPrice
                      : null,
                  price_options:
                    Array.isArray(item.priceOptions) &&
                    item.priceOptions.length > 0
                      ? item.priceOptions
                      : [
                          {
                            quantity: 1,
                            price: salePrice,
                            description: "기본가",
                          },
                        ],
                  quantity:
                    typeof item.quantity === "number" ? item.quantity : 1,
                  quantity_text: item.quantityText || null, // 수량 텍스트 (옵션)
                  category: item.category || "기타",
                  tags: Array.isArray(item.tags) ? item.tags : [],
                  features: Array.isArray(item.features) ? item.features : [],
                  status:
                    item.status ||
                    (existingProdInfo ? existingProdInfo.status : "판매중"), // 상태 유지 또는 기본값
                  pickup_info: item.pickupInfo || null,
                  pickup_date: item.pickupDate || null, // AI가 ISO 문자열로 제공 가정
                  pickup_type: item.pickupType || null,
                  stock_quantity:
                    Number.isInteger(item.stockQuantity) &&
                    item.stockQuantity >= 0
                      ? item.stockQuantity
                      : null,
                  order_summary: existingProdInfo?.order_summary || {
                    total_orders: 0,
                    total_quantity: 0,
                  }, // 기존 요약 유지 또는 초기화
                  created_at: postedAt.toISOString(), // 게시물 작성 시간 기준
                  updated_at: new Date().toISOString(),
                  barcode: generateBarcodeFromProductId(prodId), // <<<--- 바코드 생성!
                };
                newProductsFromAI.push(productData); // 임시 배열에 추가
              }
              logger.info(
                `ID ${postNumStr}: AI 분석 완료, ${productMap.size}개 상품 생성/업데이트 준비.`
              );
            } else {
              // AI 결과가 있지만 상품 정보가 없는 경우
              isProductPost = false; // 상품 아님으로 간주
              if (!isNewPost && existingPost?.is_product) {
                postNeedsUpdate = true; // 기존 상품이었으면 업데이트 필요
                productNeedsUpdate = true; // 기존 상품 상태 변경 필요
              }
              logger.info(`ID ${postNumStr}: AI 분석 결과 상품 정보 없음.`);
            }
          } catch (e) {
            logger.error(
              `ID ${postNumStr} AI 분석 중 오류: ${e.message}`,
              e.stack
            );
            // AI 오류 시 기존 상품 상태 유지 또는 기본값 (상품 아님)
            isProductPost = existingPost ? existingPost.is_product : false;
          }
        } // end if(runAI)

        // --- 4) 게시물(Post) 데이터 준비 (v_working 추출 데이터 사용) ---
        const postData = {
          post_id: uniquePostId,
          user_id: userId,
          band_number: bandNumberStr, // 문자열
          post_number: postNumStr, // 문자열
          band_post_url: postUrl,
          author_name: crawledPost.authorName || "작성자 불명", // v_working 추출
          title: crawledPost.postTitle || "제목 없음", // v_working 추출
          content: crawledContent,
          posted_at: postedAt.toISOString(),
          comment_count: crawledCommentCount, // v_working 추출
          view_count: crawledPost.readCount || 0, // v_working 추출
          image_urls: crawledPost.imageUrls || [], // v_working 추출
          is_product: isProductPost, // AI 또는 가격 지표로 결정된 값
          status: existingPost ? existingPost.status : "활성", // 기존 상태 유지 또는 기본값
          crawled_at: new Date(crawledPost.crawledAt).toISOString(),
          updated_at: new Date().toISOString(), // 항상 최신 시간
          item_list: [], // 초기화
        };

        // item_list 업데이트 (AI로 상품 생성/업데이트 시)
        if (
          isProductPost &&
          productNeedsUpdate &&
          newProductsFromAI.length > 0
        ) {
          postData.item_list = newProductsFromAI.map((p) => ({
            itemNumber: p.item_number,
            productId: p.product_id,
            title: p.title,
            price: p.base_price,
          }));
        } else if (isProductPost && existingPost?.item_list) {
          // AI 처리 안 했거나 실패했고, 기존 상품 목록 있으면 유지
          postData.item_list = existingPost.item_list;
        }

        // --- 5) 댓글(Order) 처리 (새로운 댓글만, 안정적 저장 방식) ---
        let isClosedByNewComment = false;
        const orderSummaryUpdates = new Map(); // 상품별 주문/수량 집계

        // 새 댓글이 있을 경우에만 처리 (v_improved 방식)
        if (isProductPost && newCommentsExist && commentCountDiff > 0) {
          postNeedsUpdate = true; // 새 댓글 처리 시 게시물 업데이트 필요 간주
          const newComments = crawledComments.slice(-commentCountDiff); // 새로운 댓글만 추출
          const startingCommentIndex = commentCountStored; // DB에 저장된 댓글 수부터 시작

          logger.info(
            `ID ${postNumStr}: ${commentCountDiff}개 신규 댓글 처리 시작 (시작 인덱스: ${startingCommentIndex}).`
          );

          for (let i = 0; i < newComments.length; i++) {
            const cm = newComments[i]; // author 키 포함됨
            const originalCommentIndex = startingCommentIndex + i; // 실제 댓글 순번
            // 댓글 작성자 이름 (author 키 사용)
            const author = cm.author?.trim() || "익명";
            const text = cm.content || "";
            const ctime = safeParseDate(cm.time) || postedAt;

            if (!text) continue; // 내용 없는 댓글 건너뛰기
            if (excludedCustomers.includes(author)) {
              logger.debug(
                `ID ${postNumStr} 댓글 ${originalCommentIndex}: 제외 고객(${author})`
              );
              continue;
            }

            // --- 고객 데이터 준비/업데이트 (v_improved 방식) ---
            const custId = generateCustomerUniqueId(
              userId,
              bandNumberStr,
              postNumStr,
              originalCommentIndex
            );
            if (!customersToUpsertMap.has(custId)) {
              customersToUpsertMap.set(custId, {
                /* ... 고객 초기 정보 ... */ customer_id: custId,
                user_id: userId,
                band_number: bandNumberStr,
                name: author,
                band_profile_name: author,
                total_orders: 0,
                total_spent: 0,
                first_order_at: null,
                last_order_at: null,
                notes: `첫 댓글 인덱스: ${originalCommentIndex}`,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              });
            }
            const custData = customersToUpsertMap.get(custId);
            custData.updated_at = new Date().toISOString(); // 항상 업데이트 시간 갱신

            // --- 모든 새 댓글에 대한 orderData 기본 생성 (v_working 구조 참고) ---
            const bandCommentId = `${postNumStr}_comment_${originalCommentIndex}`;
            const uniqueCommentOrderId = `order_${bandNumberStr}_${postNumStr}_${originalCommentIndex}`;
            let orderData = {
              order_id: uniqueCommentOrderId,
              user_id: userId,
              post_number: postNumStr, // 문자열 게시물 번호
              band_number: bandNumberStr, // 문자열 밴드 번호
              customer_id: custId,
              comment: text,
              ordered_at: ctime.toISOString(), // 주문 시간 (댓글 시간)
              band_comment_id: bandCommentId,
              band_comment_url: `${postUrl}#${bandCommentId}`,
              customer_name: author,
              product_id: null, // 초기화
              item_number: null, // 초기화
              quantity: null, // 초기화
              price: null, // 초기화 (단가)
              total_amount: null, // 초기화 (총액)
              price_option_description: null, // 초기화
              status: "주문완료", // 기본 상태 (v_working 방식은 '댓글' 이었을 수 있음, 확인 필요)
              sub_status: null, // <<< sub_status 컬럼 추가 및 기본값 null

              extracted_items_details: null, // 추출된 상세 정보 (JSON)
              is_ambiguous: false, // 모호성 플래그
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };

            // 마감 키워드 확인 (v_improved)
            if (!isClosedByNewComment && hasClosingKeywords(text)) {
              isClosedByNewComment = true;
              logger.info(
                `ID ${postNumStr} 댓글 ${originalCommentIndex}: 마감 키워드 발견.`
              );
            }

            let processedAsOrder = false; // 주문으로 처리되었는지 플래그

            // --- 주문 정보 추출 및 업데이트 (v_working의 안정적 로직 적용) ---
            // 상품 게시물이고, productMap이 있고, 마감 댓글이 아닐 때 시도
            if (isProductPost && productMap.size > 0 && !isClosedByNewComment) {
              const extractedItems = extractEnhancedOrderFromComment(
                text,
                logger
              );

              if (extractedItems.length > 0) {
                // 주문 정보 추출 성공 시
                orderData.extracted_items_details = extractedItems;
                let firstValidItemProcessed = false;

                for (const orderItem of extractedItems) {
                  // 상품 번호 결정 및 폴백 로직 (v_working 참조)
                  let itemNumberToUse = orderItem.itemNumber;
                  let targetProductId = null;
                  let isAmbiguousNow = orderItem.isAmbiguous;

                  if (isAmbiguousNow) {
                    // 번호 없는 모호한 주문
                    if (productMap.size === 1) {
                      // 단일 상품이면 확정
                      itemNumberToUse = Array.from(productMap.keys())[0];
                      targetProductId = productMap.get(itemNumberToUse);
                      isAmbiguousNow = false;
                    } else if (productMap.has(1)) {
                      // 다중 상품이면 1번 시도
                      targetProductId = productMap.get(1);
                      itemNumberToUse = 1;
                    } else if (productMap.size > 0) {
                      // 1번 없으면 첫번째 상품
                      [itemNumberToUse, targetProductId] = Array.from(
                        productMap.entries()
                      )[0];
                    }
                  } else {
                    // 번호 있는 주문
                    targetProductId = productMap.get(itemNumberToUse);
                    if (!targetProductId) {
                      // 번호가 있지만 상품 목록에 없음 -> 모호 처리 및 폴백
                      isAmbiguousNow = true;
                      if (productMap.size === 1) {
                        [itemNumberToUse, targetProductId] = Array.from(
                          productMap.entries()
                        )[0];
                      } else if (productMap.has(1)) {
                        targetProductId = productMap.get(1);
                        itemNumberToUse = 1;
                      } else if (productMap.size > 0) {
                        [itemNumberToUse, targetProductId] = Array.from(
                          productMap.entries()
                        )[0];
                      }
                    }
                  }

                  if (!targetProductId) continue; // 상품 ID 최종 결정 못하면 이 항목 건너뜀

                  // 상품 정보 조회 (메모리)
                  const productInfo =
                    newProductsFromAI.find(
                      (p) => p.product_id === targetProductId
                    ) || // AI 결과 우선
                    (existingProductsMap.get(postNumStr) || []).find(
                      (p) => p.product_id === targetProductId
                    ); // 없으면 기존 상품

                  if (!productInfo) continue; // 상품 정보 없으면 처리 불가

                  // 수량 결정 (기본값 1)
                  const quantity =
                    typeof orderItem.quantity === "number" &&
                    orderItem.quantity > 0
                      ? orderItem.quantity
                      : 1;
                  if (
                    quantity === 1 &&
                    !(
                      typeof orderItem.quantity === "number" &&
                      orderItem.quantity > 0
                    )
                  )
                    isAmbiguousNow = true; // 수량 추론 시 모호

                  const unitPrice =
                    typeof productInfo.base_price === "number"
                      ? productInfo.base_price
                      : 0;
                  const itemTotal = unitPrice * quantity;

                  // 첫 유효 항목 기준으로 orderData 업데이트
                  if (!firstValidItemProcessed) {
                    orderData.product_id = targetProductId;
                    orderData.item_number = itemNumberToUse;
                    orderData.quantity = quantity;
                    orderData.price = unitPrice;
                    orderData.total_amount = itemTotal;
                    orderData.price_option_description = productInfo.title
                      ? `${itemNumberToUse}번 (${productInfo.title})`
                      : `${itemNumberToUse}번`;
                    orderData.is_ambiguous = isAmbiguousNow;
                    if (isAmbiguousNow) orderData.status = "확인필요";
                    firstValidItemProcessed = true;
                  }

                  // 고객/상품 요약 업데이트
                  custData.total_orders = (custData.total_orders || 0) + 1;
                  custData.total_spent =
                    (custData.total_spent || 0) + itemTotal;
                  if (!custData.first_order_at)
                    custData.first_order_at = ctime.toISOString();
                  custData.last_order_at = ctime.toISOString();

                  if (!orderSummaryUpdates.has(targetProductId))
                    orderSummaryUpdates.set(targetProductId, {
                      orders: 0,
                      quantity: 0,
                    });
                  const summary = orderSummaryUpdates.get(targetProductId);
                  summary.orders += 1;
                  summary.quantity += quantity;

                  processedAsOrder = true;
                } // end for (orderItem)
              } else if (/\d/.test(text)) {
                // 주문 추출 실패 & 숫자 포함 시 폴백 (v_working 방식)
                logger.warn(
                  `ID ${postNumStr} 댓글 ${originalCommentIndex}: 주문 추출 실패, 숫자 포함 -> 폴백 처리`
                );
                let targetProductId = null;
                let itemNumberToUse = 1;
                let productInfo = null;
                let unitPrice = 0;
                const quantity = 1;

                // 폴백 상품 ID 결정
                if (productMap.size === 1) {
                  [itemNumberToUse, targetProductId] = Array.from(
                    productMap.entries()
                  )[0];
                } else if (productMap.has(1)) {
                  targetProductId = productMap.get(1);
                  itemNumberToUse = 1;
                } else if (productMap.size > 0) {
                  [itemNumberToUse, targetProductId] = Array.from(
                    productMap.entries()
                  )[0];
                }

                if (targetProductId) {
                  productInfo =
                    newProductsFromAI.find(
                      (p) => p.product_id === targetProductId
                    ) ||
                    (existingProductsMap.get(postNumStr) || []).find(
                      (p) => p.product_id === targetProductId
                    );
                  if (productInfo)
                    unitPrice =
                      typeof productInfo.base_price === "number"
                        ? productInfo.base_price
                        : 0;
                }

                const itemTotal = unitPrice * quantity;

                // orderData 업데이트 (폴백 값)
                orderData.product_id = targetProductId;
                orderData.item_number = itemNumberToUse;
                orderData.quantity = quantity;
                orderData.price = unitPrice;
                orderData.total_amount = itemTotal;
                orderData.price_option_description = productInfo
                  ? `${itemNumberToUse}번 (${productInfo.title}) - 추정`
                  : "상품 정보 불명 - 추정";

                orderData.sub_status = "확인필요"; // <<< sub_status를 '확인필요'로 설정
                orderData.is_ambiguous = true; // 부가 정보로 모호했음을 기록 (선택 사항)

                // 고객/상품 요약 업데이트 (product_id 있을 때만)
                if (targetProductId) {
                  custData.total_orders = (custData.total_orders || 0) + 1;
                  custData.total_spent =
                    (custData.total_spent || 0) + itemTotal;
                  if (!custData.first_order_at)
                    custData.first_order_at = ctime.toISOString();
                  custData.last_order_at = ctime.toISOString();

                  if (!orderSummaryUpdates.has(targetProductId))
                    orderSummaryUpdates.set(targetProductId, {
                      orders: 0,
                      quantity: 0,
                    });
                  const summary = orderSummaryUpdates.get(targetProductId);
                  summary.orders += 1;
                  summary.quantity += quantity;
                }
                processedAsOrder = true;
              }
            } // end if (isProductPost && ...)

            // --- 최종 저장 결정 (v_working의 느슨한 방식 - 숫자 포함 여부) ---
            const containsDigit = /\d/.test(text);
            if (containsDigit) {
              // quantity가 null이면 1로 설정 (폴백 등에서 설정 안됐을 경우 대비)
              if (orderData.quantity === null) {
                orderData.quantity = 1;
                // product_id가 없으면 최종 폴백 시도 (매우 방어적)
                if (
                  !orderData.product_id &&
                  isProductPost &&
                  productMap.size > 0
                ) {
                  let targetProductId = null;
                  let itemNumberToUse = 1;
                  let productInfo = null;
                  let unitPrice = 0;
                  if (productMap.size === 1) {
                    [itemNumberToUse, targetProductId] = Array.from(
                      productMap.entries()
                    )[0];
                  } else if (productMap.has(1)) {
                    targetProductId = productMap.get(1);
                    itemNumberToUse = 1;
                  } else if (productMap.size > 0) {
                    [itemNumberToUse, targetProductId] = Array.from(
                      productMap.entries()
                    )[0];
                  }

                  if (targetProductId) {
                    productInfo =
                      newProductsFromAI.find(
                        (p) => p.product_id === targetProductId
                      ) ||
                      (existingProductsMap.get(postNumStr) || []).find(
                        (p) => p.product_id === targetProductId
                      );
                    if (productInfo)
                      unitPrice =
                        typeof productInfo.base_price === "number"
                          ? productInfo.base_price
                          : 0;
                  }
                  orderData.product_id = targetProductId;
                  orderData.item_number = itemNumberToUse;
                  orderData.price = unitPrice;
                  orderData.total_amount = unitPrice * orderData.quantity; // quantity는 1
                  orderData.price_option_description = productInfo
                    ? `${itemNumberToUse}번 (${productInfo.title}) - 최종 추정`
                    : "상품 정보 불명 - 최종 추정";
                }

                orderData.sub_status = "확인필요"; // <<< sub_status를 '확인필요'로 설정
                orderData.is_ambiguous = true; // 부가 정보로 모호했음을 기록 (선택 사항)
              }
              // 숫자 포함 댓글은 일단 저장 대상에 추가
              ordersToUpsert.push(orderData);
              logger.debug(
                `ID ${postNumStr} 댓글 ${originalCommentIndex}: 저장 대상 추가 (Product ID: ${orderData.product_id}, Qty: ${orderData.quantity}, Ambiguous: ${orderData.is_ambiguous})`
              );
            } else {
              logger.debug(
                `ID ${postNumStr} 댓글 ${originalCommentIndex}: 숫자 미포함, 저장 건너뜀.`
              );
            }
          } // end for newComments
        } // end if newCommentsExist

        // --- 6) 상태 업데이트 (마감 처리 - v_improved) ---
        if (isClosedByNewComment && postData.status !== "마감") {
          postData.status = "마감";
          postNeedsUpdate = true;
          productNeedsUpdate = true; // 관련 상품도 마감 처리 필요
          logger.info(`ID ${postNumStr}: 신규 댓글로 마감 처리됨.`);
        }

        // --- 7) Upsert 대상 추가 (v_improved) ---
        if (postNeedsUpdate) {
          // postsToUpsert 배열에 이미 있는지 확인 후 추가 또는 업데이트
          const existingPostIndex = postsToUpsert.findIndex(
            (p) => p.post_id === uniquePostId
          );
          if (existingPostIndex === -1) {
            postsToUpsert.push(postData);
            logger.debug(
              `ID ${postNumStr}: Post upsert 대상 추가 (이유: ${
                isNewPost
                  ? "신규"
                  : contentChanged
                  ? "내용변경"
                  : newCommentsExist
                  ? "댓글변경"
                  : "상태변경"
              })`
            );
          } else {
            // 기존 항목 업데이트 (최신 정보 반영)
            postsToUpsert[existingPostIndex] = {
              ...postsToUpsert[existingPostIndex], // 기존 데이터 유지
              ...postData, // 최신 데이터 덮어쓰기
              updated_at: new Date().toISOString(), // 업데이트 시간 갱신
            };
            logger.debug(
              `ID ${postNumStr}: Post upsert 대상 업데이트 (기존 항목)`
            );
          }
        }

        // Product: AI 결과 반영 또는 상태 변경 시 추가 (v_improved)
        if (productNeedsUpdate) {
          // AI로 생성된 상품 추가
          productsToUpsert.push(...newProductsFromAI);
          if (newProductsFromAI.length > 0) {
            logger.debug(
              `ID ${postNumStr}: ${newProductsFromAI.length}개 상품 upsert 대상 추가 (AI 결과)`
            );
          }

          // 마감 처리 시 기존 상품 상태 업데이트
          if (isClosedByNewComment) {
            const existingProds = existingProductsMap.get(postNumStr) || [];
            for (const prodInfo of existingProds) {
              const alreadyInUpsert = productsToUpsert.some(
                (p) => p.product_id === prodInfo.product_id
              );
              if (!alreadyInUpsert && prodInfo.status !== "마감") {
                // 상태만 업데이트하는 객체 추가 (Edge Function에서 merge 필요)
                productsToUpsert.push({
                  product_id: prodInfo.product_id,
                  user_id: userId,
                  status: "마감",
                  updated_at: new Date().toISOString(),
                });
                logger.debug(
                  `ID ${postNumStr}: 기존 상품 ${prodInfo.item_number} 마감 처리 위해 upsert 추가`
                );
              } else if (alreadyInUpsert) {
                // 이미 upsert 대상이면 상태만 마감으로 변경
                const prodToUpdate = productsToUpsert.find(
                  (p) => p.product_id === prodInfo.product_id
                );
                if (prodToUpdate && prodToUpdate.status !== "마감") {
                  prodToUpdate.status = "마감";
                  prodToUpdate.updated_at = new Date().toISOString();
                  logger.debug(
                    `ID ${postNumStr}: Upsert 대상 상품 ${prodInfo.item_number} 마감 상태로 변경`
                  );
                }
              }
            }
          }
        }

        // --- 8) 상품 주문 요약 업데이트 적용 (v_improved) ---
        if (orderSummaryUpdates.size > 0) {
          orderSummaryUpdates.forEach((summary, productId) => {
            let productToUpdate = productsToUpsert.find(
              (p) => p.product_id === productId
            );
            if (productToUpdate) {
              // 이미 upsert 대상에 있으면 요약 정보 업데이트
              productToUpdate.order_summary = summary;
              productToUpdate.updated_at = new Date().toISOString();
              logger.debug(
                `ID ${postNumStr}: 상품 ${productId} 요약 업데이트 (기존 upsert 대상)`
              );
            } else {
              // upsert 대상에 없으면 요약 정보만 업데이트하는 객체 추가
              productsToUpsert.push({
                product_id: productId,
                user_id: userId, // userId 필요
                order_summary: summary,
                updated_at: new Date().toISOString(),
              });
              logger.debug(
                `ID ${postNumStr}: 상품 ${productId} 요약 업데이트 위해 upsert 추가`
              );
            }

            // 상품 요약 변경 시 게시물도 업데이트 필요할 수 있음
            if (!postNeedsUpdate) {
              const existingPostIndex = postsToUpsert.findIndex(
                (p) => p.post_id === uniquePostId
              );
              if (existingPostIndex === -1) {
                // postData를 복사하여 updated_at만 갱신 후 추가
                postsToUpsert.push({
                  ...postData,
                  updated_at: new Date().toISOString(),
                });
              } else {
                postsToUpsert[existingPostIndex].updated_at =
                  new Date().toISOString();
              }
              postNeedsUpdate = true; // 플래그 설정
              logger.debug(
                `ID ${postNumStr}: 상품 요약 변경으로 Post 업데이트 대상 추가`
              );
            } else {
              // 이미 업데이트 대상이면 updated_at만 갱신
              const postInArray = postsToUpsert.find(
                (p) => p.post_id === uniquePostId
              );
              if (postInArray)
                postInArray.updated_at = new Date().toISOString();
            }
          });
        } // end if orderSummaryUpdates
      } // end for detailedPosts (메인 루프 종료)

      // --- Edge Function 호출 (v_improved 방식) ---
      this._updateStatus(
        "processing",
        `DB 저장을 위한 최종 데이터 준비...`,
        93
      );
      const customersArray = Array.from(customersToUpsertMap.values());

      if (
        customersArray.length === 0 &&
        postsToUpsert.length === 0 &&
        productsToUpsert.length === 0 &&
        ordersToUpsert.length === 0
      ) {
        this._updateStatus("completed", "DB 업데이트할 변경 사항 없음", 100);
        logger.info("DB 업데이트할 변경 사항 없음");
        return;
      }

      logger.info(
        `DB 업데이트 대상: Posts ${postsToUpsert.length}, Products ${productsToUpsert.length}, Orders ${ordersToUpsert.length}, Customers ${customersArray.length}`
      );

      const payload = {
        userId,
        customers: customersArray,
        posts: postsToUpsert,
        products: productsToUpsert,
        orders: ordersToUpsert,
      };
      const payloadString = JSON.stringify(payload);
      logger.debug(
        `Edge Function 페이로드 크기: ${payloadString.length} bytes`
      );

      this._updateStatus(
        "processing",
        `Edge Function 호출하여 DB 저장 중...`,
        95
      );
      const { data, error } = await supabase.functions.invoke(
        "save-crawled-data",
        { body: payload }
      );

      if (error) {
        logger.error(
          `Edge Function 'save-crawled-data' 호출 오류: ${error.message}`,
          error
        );
        const detailedErrorMsg = error.context?.errorMessage || error.message;
        this._updateStatus(
          "failed",
          `DB 저장 실패 (Edge Function): ${detailedErrorMsg}`,
          95
        );
        throw new Error(`Edge Function Error: ${detailedErrorMsg}`);
      }

      logger.info(`Edge Function 실행 결과: ${JSON.stringify(data)}`);
      this._updateStatus("completed", "DB 저장 완료 (Edge Function)", 100);
    } catch (e) {
      logger.error(
        `saveDetailPostsToSupabase 전체 프로세스 중 오류: ${e.message}`,
        e.stack
      );
      this._updateStatus("failed", `처리 중 오류: ${e.message}`, 95);
      throw e; // 에러를 다시 던져서 상위 호출자가 알 수 있도록 함
    }
  } // --- saveDetailPostsToSupabase 종료 ---

  // crawlSinglePostDetail 함수는 v_improved 버전 사용 (안정적 추출 함수 호출하도록 수정)
  async crawlSinglePostDetail(userId, naverId, naverPassword, postId) {
    // ... (v_improved의 입력값 검증, 페이지 이동 로직 동일) ...
    if (!postId) {
      /* ... */ return null;
    }
    const numericPostId = parseInt(postId, 10);
    if (isNaN(numericPostId)) {
      /* ... */ return null;
    }

    logger.info(`단일 게시물 크롤링 시작: ID ${postId}`);
    if (this._updateStatus)
      this._updateStatus("processing", `게시물 ${postId} 크롤링 시작...`, 0);

    try {
      await this.accessBandPage(userId, naverId, naverPassword);
      if (this._updateStatus)
        this._updateStatus(
          "processing",
          `게시물 ${postId} 페이지 접근 시도...`,
          10
        );

      const postUrl = `https://band.us/band/${this.bandNumber}/post/${numericPostId}`;

      logger.info(`URL 이동 시도: ${postUrl}`);
      try {
        await this.page.goto(postUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await new Promise((r) => setTimeout(r, 500)); // 렌더링 대기
      } catch (navError) {
        const msg = `게시물 ${postId} 페이지 이동 실패: ${navError.message}`;
        logger.error(msg, navError);
        if (this._updateStatus) this._updateStatus("failed", msg, 100);
        return null;
      }

      const currentUrl = this.page.url();
      if (!currentUrl.includes(`/post/${numericPostId}`)) {
        const msg = `게시물 ${postId} 접근 실패: 잘못된 URL(${currentUrl})로 이동됨.`;
        logger.warn(msg);
        if (this._updateStatus) this._updateStatus("failed", msg, 100);
        return null;
      }

      // 삭제/비공개 확인 (evaluate 내부 로직은 v_improved 와 동일)
      const isBlockedOrNotFound = await this.page.evaluate(() => {
        const blockKeywords = [
          "삭제되었거나",
          "찾을 수 없습니다",
          /*...*/ "비공개 설정된 글",
        ];
        const bodyText = document.body.innerText || "";
        const errorContainer =
          document.querySelector(".errorContainer") ||
          document.querySelector(".bandDeletedPost");
        const errorText = errorContainer ? errorContainer.innerText : "";
        return blockKeywords.some(
          (keyword) => bodyText.includes(keyword) || errorText.includes(keyword)
        );
      });

      if (isBlockedOrNotFound) {
        const msg = `게시물 ${postId} 접근 불가 (삭제/비공개 등).`;
        logger.warn(msg);
        if (this._updateStatus) this._updateStatus("failed", msg, 100);
        return null;
      }

      // --- 데이터 추출 (안정적인 v_working 버전 호출) ---
      if (this._updateStatus)
        this._updateStatus(
          "processing",
          `게시물 ${postId} 데이터 추출 중...`,
          50
        );
      // this 컨텍스트 유지 중요
      const postDetail = await this.extractPostDetailFromPage.call({
        page: this.page,
      });

      if (postDetail) {
        logger.info(`단일 게시물 데이터 추출 성공: ID ${postId}`);
        // bandNumber와 userId 추가 (필요시)
        postDetail.bandNumber = this.bandNumber;
        postDetail.userId = userId;
        if (this._updateStatus)
          this._updateStatus("completed", `게시물 ${postId} 크롤링 완료`, 100);
        return postDetail; // 추출된 데이터 반환
      } else {
        const msg = `게시물 ${postId} 데이터 추출 실패 (extractPostDetailFromPage 반환 값 없음).`;
        logger.warn(msg);
        if (this._updateStatus) this._updateStatus("failed", msg, 100);
        return null;
      }
    } catch (error) {
      const msg = `단일 게시물 크롤링 중 오류 (ID: ${postId}): ${error.message}`;
      logger.error(msg, error.stack);
      if (this._updateStatus) this._updateStatus("failed", msg, 100);
      return null;
    } finally {
      // 브라우저 닫기 로직은 여기서 제외 (호출 측에서 관리)
    }
  } // --- crawlSinglePostDetail 종료 ---
} // BandPosts 클래스 종료

module.exports = BandPosts;
