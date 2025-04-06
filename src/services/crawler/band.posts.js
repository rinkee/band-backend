// src/services/crawler/band.posts.js
const BandAuth = require("./band.auth");
const {
  // --- 필요한 유틸리티 함수들 ---
  safeParseDate,
  hasClosingKeywords,
  generateOrderUniqueId, // 수정된 버전 필요
  generatePostUniqueId,
  generateCustomerUniqueId,
  extractNumberedProducts, // <<<--- band.utils.js에 구현 필요
  generateProductUniqueIdForItem, // <<<--- band.utils.js에 구현 필요
  extractEnhancedOrderFromComment,
  contentHasPriceIndicator,
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
    super(); // 부모 클래스(BandAuth) 생성자 호출
    if (!bandNumber) {
      throw new Error("밴드 ID는 필수 값입니다.");
    }
    this.bandNumber = bandNumber;
    this.crawlStartTime = 0;
    this.options = { ...options }; // 전달된 옵션 저장
    this.aiService = options.aiService || null; // AI 서비스 설정

    // 디버깅: 생성자 호출 확인
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
    // 디버깅: _updateStatus 호출 확인
    // logger.debug(`_updateStatus 호출됨: status=${status}, message=${message}, progress=${progress}, this.onStatusUpdate 존재여부=${!!this.onStatusUpdate}`);

    if (this.onStatusUpdate && typeof this.onStatusUpdate === "function") {
      // 콜백 함수가 있으면 호출
      try {
        this.onStatusUpdate(status, message, progress);
      } catch (callbackError) {
        logger.error(
          `상태 업데이트 콜백 함수 실행 중 오류: ${callbackError.message}`,
          callbackError
        );
      }
    } else {
      // 콜백 없으면 기본 로깅
      const progressText =
        progress !== undefined ? ` 진행률: ${progress}% |` : "";
      logger.info(
        `[상태 업데이트]${progressText} 상태: ${status} | 메시지: ${message}`
      );
    }
  }

  /**
   * 게시물 스크롤링
   * @param {number} count - 로드할 게시물 수
   * @returns {Promise<number>} - 로드된 게시물 수
   */
  async scrollToLoadPosts(count) {
    logger.info(`게시물 스크롤링 시작`);
    let loadedPostsCount = 0;
    let lastPostsCount = 0;
    let scrollAttempts = 0;

    // 더 많은 스크롤 시도 허용
    const MAX_SCROLL_ATTEMPTS = 50;

    // count 값을 매우 크게 설정하여 모든 게시물을 로드하려고 시도
    // 스크롤을 계속해서 시도하다가 더 이상 새 게시물이 로드되지 않으면 종료
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

      // 스크롤 다운
      await this.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      // 조금 더 긴 대기 시간 설정
      await new Promise((r) => setTimeout(r, 3000));
    }

    logger.info(`스크롤링 완료: ${loadedPostsCount}개 게시물 로드됨`);
    return loadedPostsCount;
  }

  /**
   * 게시물 상세 정보 추출
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
        /* ... 차단 키워드 확인 ... */
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

      // 댓글 영역 로드를 시도하되, 타임아웃 발생 시 빈 배열로 처리
      try {
        await this.page.waitForSelector(".sCommentList", {
          visible: true,
          timeout: 5000,
        });
      } catch (e) {
        console.warn(
          "댓글 영역이 없거나 로딩되지 않았습니다. (오류: " + e.message + ")"
        );
      }

      const prevButtonSelector =
        "button[data-uiselector='previousCommentButton']";
      let commentLoadAttempts = 0;
      const MAX_COMMENT_LOAD_ATTEMPTS = 30;
      while (
        (await this.page.$(prevButtonSelector)) &&
        commentLoadAttempts < MAX_COMMENT_LOAD_ATTEMPTS
      ) {
        /* ... 이전 댓글 로드 ... */
        logger.info(
          `이전 댓글 버튼 클릭 (시도 ${
            commentLoadAttempts + 1
          }) - ${currentUrl}`
        );
        try {
          await this.page.click(prevButtonSelector);
          await new Promise((resolve) =>
            setTimeout(resolve, 1500 + Math.random() * 500)
          );
          commentLoadAttempts++;
        } catch (clickError) {
          logger.warn(`이전 댓글 버튼 클릭 오류: ${clickError.message}. 중단.`);
          break;
        }
      }
      if (commentLoadAttempts >= MAX_COMMENT_LOAD_ATTEMPTS)
        logger.warn(`최대 댓글 로드 시도 도달.`);

      const content = await this.page.content();
      const $ = cheerio.load(content);

      const postIdMatch = currentUrl.match(/\/post\/(\d+)/);
      const postId = postIdMatch?.[1] || `generated_${generateUUID()}`;
      if (!postIdMatch)
        logger.warn(
          `표준 Post ID 형식 아님: ${currentUrl}. 임시 ID 생성: ${postId}`
        );

      const authorName =
        $(".postWriterInfoWrap .text, .userName").first().text().trim() ||
        "작성자 불명";
      let postTitle = $(".postSubject").first().text().trim() || authorName;
      const postContent =
        $(".postText .txtBody, .postContent ._postContent")
          .first()
          .text()
          .trim() || "";
      if (!postTitle && postContent)
        postTitle = postContent.split("\n")[0].substring(0, 50);
      if (!postTitle) postTitle = "제목 없음";

      const postTimeText =
        $(".postListInfoWrap .time, .etcArea .time").first().attr("title") ||
        $(".postListInfoWrap .time, .etcArea .time").first().text().trim() ||
        "";
      const readCountText = $("._postReaders strong, .postMeta .count")
        .text()
        .trim();
      const readCountMatch =
        readCountText.match(/읽음\s*(\d+)/) ||
        readCountText.match(/(\d+)\s*명 읽음/) ||
        readCountText.match(/(\d+)/);
      const readCount = readCountMatch ? parseInt(readCountMatch[1], 10) : 0;

      const imageUrls = [];
      $(".imageListInner img, ._imageListView img, .attachedImage img").each(
        (i, el) => {
          /* ... 이미지 URL 추출 ... */
          const src = $(el).attr("src") || $(el).attr("data-src");
          if (src && !src.startsWith("data:image")) {
            const highResSrc = src.replace(/\[\d+x\d+\]/, "");
            imageUrls.push(highResSrc || src);
          }
        }
      );

      const comments = [];
      $(".cComment, .uCommentList li").each((index, el) => {
        /* ... 댓글 추출 ... */
        const commentAuthor =
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
        if (!commentContent)
          commentContent = $(el).find(".comment_content").first().text().trim();
        const commentTime =
          $(el).find("time.time, .commentDate").first().attr("title") ||
          $(el).find("time.time, .commentDate").first().text().trim();
        if (commentContent)
          comments.push({
            author: commentAuthor,
            content: commentContent,
            time: commentTime,
          });
        else
          logger.warn(`댓글 내용 추출 실패 (Index ${index}) on ${currentUrl}`);
      });

      logger.info(
        `게시물 ID ${postId} (${currentUrl}) - 댓글 ${comments.length}개 추출 완료`
      );

      return {
        postId: postId,
        bandNumber: this.bandNumber,
        postTitle: postTitle,
        postContent: postContent,
        postTime: postTimeText,
        authorName: authorName,
        readCount: readCount,
        commentCount: comments.length,
        imageUrls: imageUrls,
        comments: comments,
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
  /**
   * 게시물 데이터 Supabase 저장
   * @param {Array} posts - 저장할 게시물 목록
   */
  async savePostsToSupabase(posts) {
    try {
      this.updateTaskStatus("processing", "상품 정보 Supabase 저장 중", 85);
      let userId = await this.getOrCreateUserIdForBand();
      const products = posts.map((post) => ({
        user_id: userId,
        title: post.postTitle || "제목 없음",
        description: post.postContent || "",
        price: 0,
        original_price: 0,
        status: "판매중",
        post_number: post.postId,
        band_post_url: `https://band.us/band/${this.bandNumber}/post/${post.postId}`,
        category: "기타",
        tags: [],
        order_summary: {
          total_orders: 0,
          pending_orders: 0,
          confirmed_orders: 0,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      const { data, error } = await this.supabase
        .from("products")
        .upsert(products, {
          onConflict: "post_number",
          ignoreDuplicates: false,
        });
      if (error) {
        throw error;
      }
      this.updateTaskStatus(
        "processing",
        `${posts.length}개의 상품이 Supabase에 저장되었습니다.`,
        90
      );
    } catch (error) {
      this.updateTaskStatus(
        "failed",
        `Supabase에 상품 저장 중 오류 발생: ${error.message}`,
        85
      );
      throw error;
    }
  }

  /**
   * 게시물 상세 정보 크롤링
   * @param {string} naverId - 네이버 ID
   * @param {string} naverPassword - 네이버 비밀번호
   * @param {number} maxPosts - 크롤링할 최대 게시물 수
   * @returns {Promise<Object>} - 크롤링 결과
   */
  async crawlPostDetail(naverId, naverPassword, maxPosts = 100) {
    try {
      this.crawlStartTime = Date.now();
      logger.info(`밴드 게시물 크롤링 시작 (최대 ${maxPosts}개)`);

      // options.numPostsToLoad 갱신
      if (maxPosts) {
        this.options.numPostsToLoad = maxPosts;
      }

      // 밴드 페이지 접속
      await this.accessBandPage(naverId, naverPassword);

      // 최신 게시물로 이동 (밴드 메인 페이지)
      const bandMainUrl = `https://band.us/band/${this.bandNumber}`;
      await this.page.goto(bandMainUrl, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      let alertDetected = false;

      this.page.on("dialog", async (dialog) => {
        const message = dialog.message();
        logger.warn(`alert 감지됨: ${message}`);
        if (
          message.includes("삭제되었거나") ||
          message.includes("삭제") ||
          message.includes("권한") ||
          message.includes("찾을 수 없습니다")
        ) {
          alertDetected = true;
        }
        await dialog.dismiss(); // 자동으로 확인 눌러줌
      });

      if (alertDetected) {
        logger.warn(`접근할 수 없는 게시물: ${postUrl} (삭제/권한 없음 등)`);
        return { success: false, error: "접근할 수 없는 게시물" };
      }

      // 최신 게시물의 ID 가져오기
      const latestPostId = await this.getLatestPostId();

      if (!latestPostId) {
        logger.warn("최신 게시물 ID를 찾을 수 없어 크롤링을 중단합니다.");
        return { success: false, error: "최신 게시물 ID를 찾을 수 없습니다." };
      }

      logger.info(`최신 게시물 ID: ${latestPostId}`);

      const results = [];
      let currentPostId = parseInt(latestPostId, 10);
      const endPostId = Math.max(1, currentPostId - maxPosts + 1);

      // 크롤링 시작 시간 기록
      const startTime = Date.now();
      // 최대 실행 시간 (30분)
      const MAX_EXECUTION_TIME = 30 * 60 * 1000;

      // 게시물 ID를 순차적으로 감소시키며 크롤링
      for (let i = 0; i < maxPosts && currentPostId >= endPostId; i++) {
        // 실행 시간 체크 - 30분 이상 실행 시 종료
        const currentTime = Date.now();
        if (currentTime - startTime > MAX_EXECUTION_TIME) {
          logger.warn(
            `최대 실행 시간(30분)이 경과하여 크롤링을 중단합니다. 현재 ${results.length}개 수집됨.`
          );
          break;
        }

        // 현재 진행률 업데이트
        if (this.onStatusUpdate) {
          const progress = Math.min(90, Math.floor((i / maxPosts) * 100));
          this.onStatusUpdate(
            "processing",
            `게시물 크롤링 진행 중 (${i + 1}/${maxPosts})`,
            progress
          );
        }

        const postUrl = `https://band.us/band/${this.bandNumber}/post/${currentPostId}`;

        try {
          logger.info(
            `게시물 크롤링 시도 (${i + 1}/${maxPosts}): ID ${currentPostId}`
          );

          // 재시도 로직 수정 - 최대 1번만 재시도
          let success = false;
          let attemptCount = 0;
          const maxAttempts = 2; // 3에서 2로 변경 (초기 시도 + 1번 재시도)

          while (!success && attemptCount < maxAttempts) {
            attemptCount++;

            if (attemptCount > 1) {
              logger.info(
                `URL 접근 재시도 ${attemptCount}/${maxAttempts}: ${postUrl}`
              );
            }

            try {
              // 타임아웃 감소 (60초에서 30초로)
              await this.page.goto(postUrl, {
                waitUntil: "domcontentloaded", // networkidle2 대신 더 빠른 domcontentloaded 사용
                timeout: 30000, // 타임아웃 시간 절반으로 감소
              });

              // 불필요한 대기 시간 감소 (1.5초에서 0.5초로)
              await new Promise((resolve) => setTimeout(resolve, 500));

              // 빠른 404 확인 - URL 확인 전에 먼저 수행
              const is404 = await this.page.evaluate(() => {
                return (
                  document.body.textContent.includes("찾을 수 없는 페이지") ||
                  document.body.textContent.includes("삭제된 게시글") ||
                  document.body.textContent.includes("존재하지 않는 게시글")
                );
              });

              if (is404) {
                logger.warn(
                  `존재하지 않는 게시물 ID: ${currentPostId}, 다음 게시물로 즉시 넘어갑니다.`
                );
                throw new Error("존재하지 않는 게시물");
              }

              // URL 유효성 확인
              const currentUrl = await this.page.url();
              if (!currentUrl.includes("/post/")) {
                logger.warn(
                  `유효하지 않은 게시물 URL로 이동됨: ${currentUrl}, 원래 URL: ${postUrl}`
                );
                throw new Error("유효하지 않은 게시물 URL");
              }

              success = true;
            } catch (navError) {
              if (attemptCount >= maxAttempts) {
                logger.warn(
                  `최대 재시도 횟수 도달, 다음 게시물로 넘어갑니다: ${currentPostId}`
                );
                throw navError;
              }

              // 실패 시 대기 시간도 줄임 (짧게 1초만 대기)
              logger.warn(`URL 접근 실패, 1000ms 후 한 번만 재시도...`);
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }

          // 게시물 상세 정보 추출 전 컨텐츠 로드 확인
          try {
            await this.page.waitForSelector(".postWrap, .postMain, .txtBody", {
              timeout: 10000,
              visible: true,
            });
          } catch (selectorError) {
            logger.warn(
              `컨텐츠 로드 대기 중 타임아웃: ${selectorError.message}`
            );
            // 계속 진행 (일부 페이지는 구조가 다를 수 있음)
          }

          // 게시물 상세 정보 추출
          const postDetail = await this.extractPostDetailFromPage();

          if (postDetail) {
            results.push(postDetail);
            logger.info(`게시물 데이터 추출 성공: ${postDetail.postId}`);
          } else {
            logger.warn(`게시물 데이터 추출 실패: ${postUrl}`);
          }
        } catch (e) {
          logger.error(
            `게시물 URL 처리 중 오류 발생: ${e.message}, URL: ${postUrl}`
          );
          // 오류로 인한 지연도 최소화 (2초에서 0.5초로)
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        // 다음 게시물 ID로 이동
        currentPostId--;

        // 게시물 간 지연 시간도 감소 (2-4초에서 0.5-1초로)
        const delay = 500 + Math.floor(Math.random() * 500);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      logger.info(`총 ${results.length}개 게시물 크롤링 완료`);
      // 마지막 상태 업데이트
      if (this.onStatusUpdate) {
        this.onStatusUpdate(
          "processing",
          `게시물 크롤링 완료: ${results.length}개 수집됨`,
          95
        );
      }

      return { success: true, data: results };
    } catch (e) {
      logger.error(`게시물 상세 정보 크롤링 중 오류 발생: ${e.message}`);
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
   * 게시물 상세 정보 Supabase 저장 (AI 우선 분석, 다중 상품, 트랜잭션 처리 via Edge Function)
   * @param {Array<Object>} detailedPosts - 저장할 게시물 목록
   * @param {string} userId - 사용자 ID
   * @param {boolean} processWithAI - AI 처리 활성화 여부
   */
  async saveDetailPostsToSupabase(
    detailedPosts,
    userId,
    processWithAI = true // AI 사용을 기본으로
  ) {
    // --- 사전 검사 ---
    if (!userId) {
      const msg = "userId 필수";
      logger.error(msg);
      this._updateStatus("failed", msg, 90);
      throw new Error(msg);
    }
    if (!this.supabase) {
      const msg = "Supabase 클라이언트 없음";
      logger.error(msg);
      this._updateStatus("failed", msg, 90);
      throw new Error(msg);
    }
    if (!this.bandNumber) {
      const msg = "밴드 ID 없음";
      logger.error(msg);
      this._updateStatus("failed", msg, 90);
      throw new Error(msg);
    }
    if (!detailedPosts || detailedPosts.length === 0) {
      logger.info("저장할 게시물 없음");
      this._updateStatus("completed", "저장할 데이터 없음", 100);
      return;
    }

    this._updateStatus(
      "processing",
      "상품 및 주문 정보 준비 중 (AI 분석 우선)",
      90
    );
    const supabase = this.supabase;
    const bandNumberNumeric = parseInt(this.bandNumber, 10);
    let extractProductInfoAI;

    if (processWithAI) {
      try {
        // extractProductInfo 함수 가져오기
        extractProductInfoAI =
          require("../../services/ai.service").extractProductInfo;
      } catch (error) {
        logger.error(`AI 서비스 로드 중 오류: ${error.message}`);
        extractProductInfoAI = null;
      }
    }
    try {
      // --- 데이터 준비 배열 ---
      const postsToUpsert = [];
      const productsToUpsert = [];
      const ordersToUpsert = [];
      const customersToUpsertMap = new Map();

      // --- 제외 고객 목록 가져오기 ---
      let excludedCustomers = [];
      try {
        // *** 중요: 'profiles' 및 PK 컬럼 'id'를 실제 사용하는 테이블/컬럼명으로 변경하세요 ***
        const { data: userData, error: userError } = await supabase
          .from("users")
          .select("excluded_customers")
          .eq("user_id", userId)
          .single();
        if (userError && userError.code !== "PGRST116") {
          logger.error(`제외 고객 조회 오류: ${userError.message}`);
        } else if (userData?.excluded_customers) {
          excludedCustomers = []
            .concat(userData.excluded_customers)
            .map((name) => (typeof name === "string" ? name.trim() : null))
            .filter(Boolean);
          logger.info(`제외 고객 로드: ${excludedCustomers.length}명`);
        } else {
          logger.info(`제외 고객 목록 없음.`);
        }
      } catch (fetchError) {
        logger.error(`제외 고객 조회 예외: ${fetchError.message}`, fetchError);
      }

      // --- 기존 게시물 ID 가져오기 ---
      let existingBandPostIds = new Set();
      const bandPostIdsToCheck = detailedPosts
        .map((post) => parseInt(post.postId, 10))
        .filter((id) => !isNaN(id) && id > 0);
      if (bandPostIdsToCheck.length > 0) {
        try {
          const { data: existingPosts, error: checkError } = await supabase
            .from("posts")
            .select("post_number")
            .eq("user_id", userId)
            .eq("band_number", bandNumberNumeric)
            .in("post_number", bandPostIdsToCheck);
          if (checkError) {
            logger.error(`기존 게시물 ID 확인 DB 오류: ${checkError.message}`);
          } else if (existingPosts) {
            existingPosts.forEach((p) => {
              if (p.post_number) existingBandPostIds.add(p.post_number);
            });
            logger.info(`기존 Band Post ID 개수: ${existingBandPostIds.size}`);
          }
        } catch (dbCheckError) {
          logger.error(
            `기존 게시물 ID 확인 예외: ${dbCheckError.message}`,
            dbCheckError
          );
        }
      }

      this._updateStatus(
        "processing",
        `${detailedPosts.length}개 게시물 데이터 분석/변환 중...`,
        91
      );
      logger.info(`${detailedPosts.length}개 게시물 처리 시작 (AI 분석 우선)`);

      // --- 크롤링된 게시물 메인 루프 ---
      for (const post of detailedPosts) {
        const originalBandPostIdStr = post.postId;
        let originalBandPostIdNum = parseInt(originalBandPostIdStr, 10);
        if (isNaN(originalBandPostIdNum)) {
          originalBandPostIdNum = null;
        }
        const uniquePostId = generatePostUniqueId(
          userId,
          this.bandNumber,
          originalBandPostIdStr
        );
        const postContent = post.postContent || "";
        const postedAt =
          safeParseDate(post.postTime) ||
          new Date(post.crawledAt) ||
          new Date();
        const postUrl =
          post.postUrl ||
          `https://band.us/band/${this.bandNumber}/post/${originalBandPostIdStr}`;
        const isNewPost = originalBandPostIdNum
          ? !existingBandPostIds.has(originalBandPostIdNum)
          : true;

        let isProductPost = false;
        const productMap = new Map(); // itemNumber -> uniqueProductId
        let aiProductResult = null;

        // --- 게시물 데이터 기본 구조 생성 ---
        const postData = {
          post_id: uniquePostId,
          user_id: userId,
          band_number: bandNumberNumeric,
          post_number: originalBandPostIdNum,
          band_post_url: postUrl,
          author_name: post.authorName || "작성자 불명",
          title: post.postTitle || "제목 없음",
          content: postContent,
          posted_at: postedAt.toISOString(),
          comment_count: post.commentCount || 0,
          view_count: post.readCount || 0,
          image_urls: post.imageUrls || [],
          is_product: false, // 기본값 false
          status: "활성",
          crawled_at: new Date(post.crawledAt).toISOString(),
          updated_at: new Date().toISOString(),
          item_list: [], // 초기화
        };

        // --- AI 분석 또는 기본 가격 확인 ---
        const mightBeProduct = contentHasPriceIndicator(postContent);
        logger.debug(
          `게시물 ${originalBandPostIdStr}: 가격표시(${mightBeProduct}), AI처리(${!!extractProductInfoAI}), 새글(${isNewPost})`
        );

        if (
          extractProductInfoAI &&
          isNewPost &&
          postContent.trim() &&
          mightBeProduct
        ) {
          logger.info(`게시물 ID ${originalBandPostIdStr}: AI 분석 시도...`);
          try {
            // AI 호출 시 bandNumber, postId 전달 추가 (AI가 ID 생성에 활용하도록)
            aiProductResult = await extractProductInfoAI(
              postContent,
              post.postTime,
              this.bandNumber,
              post.postId
            );
            logger.info(`게시물 ID ${originalBandPostIdStr}: AI 분석 완료.`);
            if (
              aiProductResult &&
              (aiProductResult.title || aiProductResult.products?.length > 0)
            ) {
              // AI가 유효한 상품 정보를 반환했는지 확인
              isProductPost = true;
              postData.is_product = true;
              // AI 결과가 제목 제공 시 업데이트
              if (!aiProductResult.multipleProducts && aiProductResult.title) {
                postData.title = aiProductResult.title;
              } else if (
                aiProductResult.multipleProducts &&
                aiProductResult.products?.length > 0
              ) {
                postData.title =
                  aiProductResult.products[0].title || postData.title;
              }
            } else {
              logger.warn(
                `게시물 ID ${originalBandPostIdStr}: AI가 유효한 상품 정보를 반환하지 않음.`
              );
              isProductPost = false; // AI가 상품 없다고 판단하면 상품 아님
              postData.is_product = false;
            }
          } catch (aiError) {
            logger.error(
              `게시물 ID ${originalBandPostIdStr} AI 분석 오류: ${aiError.message}`
            );
            isProductPost = false; // AI 오류 시 상품 아닌 것으로 간주 (안전한 선택)
            postData.is_product = false;
          }
        } else {
          // AI 미사용 시, 가격 표시 여부로만 판단 (상품 목록은 비어있게 됨)
          isProductPost = mightBeProduct;
          postData.is_product = isProductPost;
          logger.info(
            `게시물 ID ${originalBandPostIdStr}: AI 분석 건너뜀. 가격표시(${mightBeProduct}) 기반 상품 여부 판단.`
          );
        }

        // --- 상품 정보 처리 (isProductPost가 true이고 AI 결과가 있을 때) ---
        if (isProductPost && aiProductResult) {
          let productsFromAI = [];
          if (
            aiProductResult.multipleProducts &&
            Array.isArray(aiProductResult.products)
          ) {
            productsFromAI = aiProductResult.products;
            logger.info(
              `게시물 ID ${originalBandPostIdStr}: AI가 ${productsFromAI.length}개 상품 반환.`
            );
          } else if (
            !aiProductResult.multipleProducts &&
            aiProductResult.title
          ) {
            productsFromAI = [aiProductResult]; // 단일 상품을 배열로
            logger.info(
              `게시물 ID ${originalBandPostIdStr}: AI가 단일 상품 반환.`
            );
          }

          for (const item of productsFromAI) {
            // *** 중요: AI가 itemNumber를 반환하도록 프롬프트 수정 필요 ***
            // AI가 itemNumber 안주면 기본값 1 또는 파싱 시도
            const itemNumber =
              typeof item.itemNumber === "number" ? item.itemNumber : 1;
            if (typeof item.itemNumber !== "number") {
              logger.warn(
                `AI 결과에서 상품 "${item.title}"의 itemNumber 누락. 기본값 1 사용.`
              );
            }

            const uniqueProductId = generateProductUniqueIdForItem(
              userId,
              this.bandNumber,
              originalBandPostIdStr,
              itemNumber
            );
            productMap.set(itemNumber, uniqueProductId);

            // --- VVV 가격 결정 로직 수정 VVV ---
            let determinedSalePrice = 0; // 최종적으로 사용할 가격 변수

            // 1. AI가 제공한 basePrice가 유효한 숫자인지 확인 (0보다 큰 경우 우선 사용)
            if (typeof item.basePrice === "number" && item.basePrice > 0) {
              determinedSalePrice = item.basePrice;
              logger.debug(
                `ID ${originalBandPostIdStr}, 상품 ${item.title}: AI 제공 basePrice (${determinedSalePrice}) 사용.`
              );
            }
            // 2. basePrice가 유효하지 않고, priceOptions가 존재하며 비어있지 않은 경우
            else if (
              Array.isArray(item.priceOptions) &&
              item.priceOptions.length > 0
            ) {
              const firstOptionPrice = item.priceOptions[0].price;
              // 첫 번째 옵션의 가격이 유효한 숫자인지 확인
              if (
                typeof firstOptionPrice === "number" &&
                firstOptionPrice >= 0
              ) {
                // 0원일 수도 있으므로 >= 0 체크
                determinedSalePrice = firstOptionPrice;
                logger.warn(
                  `ID ${originalBandPostIdStr}, 상품 ${item.title}: AI basePrice(${item.basePrice})가 유효하지 않아 priceOptions[0].price (${determinedSalePrice}) 사용.`
                );
              } else {
                logger.error(
                  `ID ${originalBandPostIdStr}, 상품 ${item.title}: priceOptions[0].price (${firstOptionPrice})도 유효하지 않음. 기본값 0 사용.`
                );
              }
            }
            // 3. 그 외의 경우 (basePrice, priceOptions 모두에서 가격 추출 실패)
            else {
              logger.error(
                `ID ${originalBandPostIdStr}, 상품 ${item.title}: basePrice(${item.basePrice}) 및 priceOptions에서 유효 가격 추출 실패. 기본값 0 사용.`
              );
            }
            // --- ^^^ 가격 결정 로직 수정 ^^^ ---

            const productData = {
              product_id: uniqueProductId,
              user_id: userId,
              post_id: uniquePostId,
              post_number: originalBandPostIdStr, // postId가 문자열일 수 있으므로 원본 사용
              item_number: itemNumber,
              title: item.title || "제목 없음",
              content: postContent || "",
              base_price: determinedSalePrice, // 결정된 판매 가격
              original_price:
                item.originalPrice !== null &&
                item.originalPrice !== determinedSalePrice
                  ? item.originalPrice
                  : null, // 원가
              price_options:
                Array.isArray(item.priceOptions) && item.priceOptions.length > 0
                  ? item.priceOptions
                  : [
                      {
                        quantity: 1,
                        price: determinedSalePrice,
                        description: "기본가",
                      },
                    ],
              quantity: typeof item.quantity === "number" ? item.quantity : 1,
              quantity_text: item.quantityText || null,
              category: item.category || "기타",
              tags: Array.isArray(item.tags) ? item.tags : [],
              features: Array.isArray(item.features) ? item.features : [],
              status: item.status || "판매중",
              pickup_info: item.pickupInfo || null,
              pickup_date: item.pickupDate || null, // 이미 ISO 문자열 또는 null로 처리됨
              pickup_type: item.pickupType || null,
              // --- stockQuantity 처리 추가 ---
              // AI 결과에서 stockQuantity 필드를 가져오고, 유효한 숫자가 아니면 null로 설정
              stock_quantity:
                typeof item.stockQuantity === "number" &&
                Number.isInteger(item.stockQuantity) &&
                item.stockQuantity >= 0
                  ? item.stockQuantity
                  : null,
              // --- order_summary 등 나머지 필드 ---
              order_summary: { total_orders: 0, total_quantity: 0 }, // 초기화
              created_at: postedAt.toISOString(),
              updated_at: new Date().toISOString(),
            };
            productsToUpsert.push(productData);
            postData.item_list.push({
              itemNumber: itemNumber,
              productId: uniqueProductId,
              title: productData.title,
              price: determinedSalePrice,
            });
          }
        } // --- 상품 정보 처리 끝 ---

        postsToUpsert.push(postData); // 게시물 정보는 항상 저장 목록에 추가

        // --- VVV 댓글 처리 (모든 댓글을 ordersToUpsert에 추가) VVV ---
        let isClosedByComment = false; // 게시물 전체 마감 여부 플래그
        const orderSummaryUpdates = new Map(); // 상품별 집계용

        // 댓글이 있는 경우에만 루프 실행
        if (post.comments && post.comments.length > 0) {
          logger.debug(
            `ID ${originalBandPostIdStr}: 댓글/주문 처리 시작. 댓글 수: ${post.comments.length}`
          );

          // 모든 댓글을 순회
          for (let index = 0; index < post.comments.length; index++) {
            const comment = post.comments[index];
            const customerName = comment.author
              ? comment.author.trim()
              : "익명";
            const commentContent = comment.content || "";
            const commentTime = safeParseDate(comment.time) || postedAt;

            // --- 1. 제외 고객 확인 ---
            if (excludedCustomers.includes(customerName)) {
              logger.debug(
                `ID ${originalBandPostIdStr}, 댓글 ${index}: 제외 고객(${customerName}) 스킵`
              );
              continue; // 이 댓글 처리 건너뛰기
            }

            // --- 2. 고객 데이터 준비/업데이트 (항상 실행) ---
            // !!! 중요: uniqueCustomerId 생성 로직 검토 필요 !!!
            const uniqueCustomerId = generateCustomerUniqueId(
              userId,
              this.bandNumber,
              post.postId,
              index
            );
            if (!customersToUpsertMap.has(uniqueCustomerId)) {
              // 고객 정보가 없으면 새로 생성 (total_orders/spent는 0으로 초기화)
              customersToUpsertMap.set(uniqueCustomerId, {
                customer_id: uniqueCustomerId,
                user_id: userId,
                band_number: bandNumberNumeric,
                name: customerName,
                band_profile_name: customerName,
                total_orders: 0,
                total_spent: 0,
                first_order_at: null,
                last_order_at: null,
                notes: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              });
            }
            const customerData = customersToUpsertMap.get(uniqueCustomerId);
            // 고객 정보는 항상 최신 시간으로 업데이트
            customerData.updated_at = new Date().toISOString();

            // --- 3. 모든 댓글에 대한 orderData 기본 생성 ---
            const bandCommentId = `${originalBandPostIdStr}_comment_${index}`;
            // 각 댓글/주문 레코드의 고유 ID (orders 테이블의 PK)
            const uniqueCommentOrderId = `order_${bandNumberNumeric}_${post.postId}_${index}`;

            let orderData = {
              order_id: uniqueCommentOrderId,
              user_id: userId,
              // post_id: uniquePostId, // <<<--- 삭제 또는 다른 용도로 사용
              post_number: originalBandPostIdNum, // <<<--- post_number 키 사용 (밴드 게시물 번호)
              band_number: bandNumberNumeric,
              customer_id: uniqueCustomerId,
              comment: commentContent,
              ordered_at: commentTime.toISOString(), // <<<--- 키 이름 변경: ordered_at
              band_comment_id: bandCommentId,
              band_comment_url: originalBandPostIdNum
                ? `${postUrl}#${bandCommentId}`
                : null,
              // --- 주문 관련 필드 초기화 ---
              product_id: null,
              quantity: null,
              item_number: null, // 추가됨
              price: null,
              // price_per_unit: null, // 옵션 1 (단가만 저장) 선택 시 제거
              total_amount: null, // <<<--- price와 의미가 겹치므로 명확화 필요. 여기서는 첫 항목 총액 저장 가정.
              price_option_description: null,
              status: "주문완료", // <<<--- 기존 코드 확인 필요 ('댓글'에서 시작하는 것이 더 일반적)
              extracted_items_details: null,
              is_ambiguous: false, // 추가됨
              // --- 타임스탬프 ---
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };

            // --- 4. 마감 키워드 확인 ---
            // 마감 키워드가 있으면 게시물/상품 상태 업데이트 플래그 설정 (루프 종료 후 처리 가능)
            if (!isClosedByComment && hasClosingKeywords(commentContent)) {
              isClosedByComment = true; // 게시물 전체 마감 플래그 설정
              logger.info(
                `ID ${originalBandPostIdStr} - 댓글(${index}) 에서 마감 키워드 감지`
              );
              // orderData.status = '마감댓글'; // 필요 시 이 댓글의 상태 변경
            }

            // --- 5. 주문 정보 추출 및 orderData 업데이트 (상품 게시물이고, 게시물이 마감되지 않았을 경우) ---
            // isProductPost: 게시물이 상품 게시물인지 여부 (AI 또는 가격 지표로 판단)
            // productMap: 게시물 내 상품 정보 (itemNumber -> productId 매핑)
            if (isProductPost && productMap.size > 0 && !isClosedByComment) {
              const extractedItems = extractEnhancedOrderFromComment(
                commentContent,
                logger
              ); // 댓글에서 주문 정보 추출

              // 주문 정보가 추출된 경우
              if (extractedItems.length > 0) {
                orderData.extracted_items_details = extractedItems; // 추출된 모든 항목 정보 저장

                let firstValidItemProcessed = false; // 댓글 내 첫 유효 주문 처리 플래그
                let commentTotalAmount = 0; // 댓글 내 총 주문 금액

                // 추출된 각 주문 항목 처리
                for (const orderItem of extractedItems) {
                  let itemNumberToUse = orderItem.itemNumber;
                  let targetProductId = null;

                  // 상품 번호 결정 (모호성 처리 포함)
                  if (orderItem.isAmbiguous) {
                    // 번호 없는 주문: 상품 1개일 때만 처리
                    if (productMap.size === 1) {
                      itemNumberToUse = Array.from(productMap.keys())[0];
                      targetProductId = productMap.get(itemNumberToUse);
                      logger.info(
                        `ID ${originalBandPostIdStr}, 댓글 ${index}: 모호한 주문 -> 단일 상품(${itemNumberToUse})으로 가정`
                      );
                    } else {
                      logger.warn(
                        `ID ${originalBandPostIdStr}, 댓글 ${index}: 모호한 주문 처리 불가 (다중 상품)`
                      );
                      continue; // 이 주문 항목 건너뛰기
                    }
                  } else {
                    // 번호 있는 주문: productMap에서 상품 ID 찾기
                    itemNumberToUse = orderItem.itemNumber;
                    targetProductId = productMap.get(itemNumberToUse);
                  }

                  // 유효한 상품 ID 확인
                  if (!targetProductId) {
                    logger.warn(
                      `ID ${originalBandPostIdStr}, 댓글 ${index}: 유효하지 않은 상품 번호 (${itemNumberToUse})`
                    );
                    continue; // 이 주문 항목 건너뛰기
                  }

                  // 상품 정보 조회 (메모리에서)
                  const productInfo = productsToUpsert.find(
                    (p) => p.product_id === targetProductId
                  );
                  if (!productInfo) {
                    logger.error(
                      `Logic Error: Product ${targetProductId} not found in memory.`
                    );
                    continue; // 오류 상황, 이 주문 항목 건너뛰기
                  }

                  const itemTotal = productInfo.base_price * orderItem.quantity;
                  commentTotalAmount += itemTotal; // 댓글 내 합계 금액 누적

                  // --- orderData의 대표 주문 정보 업데이트 (첫 유효 항목 기준) ---
                  if (!firstValidItemProcessed) {
                    const unitPrice =
                      typeof productInfo.base_price === "number"
                        ? productInfo.base_price
                        : 0;
                    const itemTotal = unitPrice * orderItem.quantity;

                    orderData.product_id = targetProductId;
                    orderData.quantity = orderItem.quantity;
                    orderData.item_number = itemNumberToUse; // <<<--- 값 할당
                    // orderData.price_per_unit = unitPrice; // 옵션 1 선택 시 제거
                    orderData.price = unitPrice; // <<<--- 옵션 1: 단가 저장
                    orderData.total_amount = itemTotal; // <<<--- 옵션 1: 첫 항목 총액 저장 (또는 제거 고려)
                    orderData.price_option_description = `${itemNumberToUse}번 (${productInfo.title})`;
                    orderData.is_ambiguous = orderItem.isAmbiguous;
                    firstValidItemProcessed = true;
                  }

                  // --- 고객 집계 정보 업데이트 (유효 주문 항목 발생 시) ---
                  // 고객별 총 주문 '항목' 수와 총 금액 업데이트
                  customerData.total_orders += 1;
                  customerData.total_spent += itemTotal;
                  // 첫 주문/마지막 주문 시간 업데이트
                  if (!customerData.first_order_at)
                    customerData.first_order_at = commentTime.toISOString();
                  customerData.last_order_at = commentTime.toISOString();

                  // --- 상품 집계 정보 업데이트 (메모리에서) ---
                  // 상품별 주문 건수 및 수량 업데이트
                  if (!orderSummaryUpdates.has(targetProductId))
                    orderSummaryUpdates.set(targetProductId, {
                      orders: 0,
                      quantity: 0,
                    });
                  const summary = orderSummaryUpdates.get(targetProductId);
                  summary.orders += 1;
                  summary.quantity += orderItem.quantity;
                } // 추출된 주문 항목 루프(extractedItems) 끝

                // (선택) total_amount를 댓글 내 총 합계로 업데이트
                // if (firstValidItemProcessed && orderData.total_amount !== commentTotalAmount) {
                //    orderData.total_amount = commentTotalAmount;
                // }
              } // if (extractedItems.length > 0) 끝
            } // if (isProductPost && ...) 끝

            // --- 6. 최종 가공된 orderData 추가 전 숫자 포함 여부 확인 ---
            // 정규식을 사용하여 댓글 내용에 숫자가 있는지 검사합니다.
            const containsDigit = /\d/.test(commentContent);

            if (containsDigit) {
              // 숫자가 포함된 경우에만 ordersToUpsert 배열에 추가
              ordersToUpsert.push(orderData);
              logger.debug(
                `ID ${originalBandPostIdStr}, 댓글 ${index}: 숫자 포함, 저장 대상 추가.`
              );
            } else {
              // 숫자가 없는 경우 건너뛰고 로그 남기기 (선택 사항)
              logger.debug(
                `ID ${originalBandPostIdStr}, 댓글 ${index}: 숫자 미포함, 저장 건너뜀. 내용: "${commentContent}"`
              );
            }
          } // 댓글 루프(for index) 끝
        } // if (post.comments && ...) 끝
        else {
          logger.debug(`ID ${originalBandPostIdStr}: 처리할 댓글 없음`);
        }

        // --- 게시물 루프 종료 후, 마감 플래그 처리 (옵션) ---
        // isClosedByComment 플래그가 true이면, 해당 게시물 및 관련 상품 상태를 '마감'으로 일괄 업데이트 가능
        if (isClosedByComment) {
          logger.info(
            `ID ${originalBandPostIdStr}: 댓글에서 마감 감지됨. 게시물/상품 상태 업데이트.`
          );
          const postInArray = postsToUpsert.find(
            (p) => p.post_id === uniquePostId
          );
          if (postInArray && postInArray.status !== "마감")
            postInArray.status = "마감";
          productsToUpsert.forEach((prod) => {
            if (prod.post_id === uniquePostId && prod.status !== "마감")
              prod.status = "마감";
          });
        }

        // --- 상품 주문 요약 최종 업데이트 ---
        // orderSummaryUpdates 맵에 집계된 정보를 실제 productsToUpsert 배열의 상품 데이터에 반영
        orderSummaryUpdates.forEach((summary, productId) => {
          const productToUpdate = productsToUpsert.find(
            (p) => p.product_id === productId
          );
          if (productToUpdate) {
            // 덮어쓰기 방식 (RPC 사용 권장)
            productToUpdate.order_summary.total_orders = summary.orders;
            productToUpdate.order_summary.total_quantity = summary.quantity;
            productToUpdate.updated_at = new Date().toISOString(); // 업데이트 시간 갱신
            logger.debug(
              `ID ${originalBandPostIdStr}, 상품 ${productId}: 주문 요약 업데이트 완료.`
            );
          }
        });
        // --- ^^^ 댓글 처리 로직 끝 ^^^ ---

        // 상품 주문 요약 최종 업데이트
        orderSummaryUpdates.forEach((summary, productId) => {
          /* ... 요약 업데이트 ... */
          const productToUpdate = productsToUpsert.find(
            (p) => p.product_id === productId
          );
          if (productToUpdate) {
            productToUpdate.order_summary.total_orders = summary.orders;
            productToUpdate.order_summary.total_quantity = summary.quantity;
            productToUpdate.updated_at = new Date().toISOString();
          }
        });
      } // --- 게시물 루프 종료 ---

      // --- 데이터베이스 저장: Edge Function 호출 ---
      this._updateStatus(
        "processing",
        `DB 저장을 위한 데이터 준비 완료...`,
        93
      );
      const customersArray = Array.from(customersToUpsertMap.values());
      if (
        customersArray.length === 0 &&
        postsToUpsert.length === 0 &&
        productsToUpsert.length === 0 &&
        ordersToUpsert.length === 0
      ) {
        logger.info("DB 저장할 데이터 없음.");
        this._updateStatus("completed", "DB 저장할 데이터 없음", 100);
        return;
      }
      const payload = {
        customers: customersArray,
        posts: postsToUpsert,
        products: productsToUpsert,
        orders: ordersToUpsert,
      };
      logger.info(
        `Edge Function 호출 전 데이터 개수: customers=${customersArray.length}, posts=${postsToUpsert.length}, products=${productsToUpsert.length}, orders=${ordersToUpsert.length}`
      );
      logger.info("Supabase Edge Function 'save-crawled-data' 호출 시도...");
      const { data, error } = await supabase.functions.invoke(
        "save-crawled-data",
        { body: payload }
      );
      if (error) {
        logger.error(`Edge Function 호출 오류: ${error.message}`, error);
        let detailedErrorMsg = error.message;
        if (error.context?.error?.message)
          detailedErrorMsg = `${error.message} (상세: ${error.context.error.message})`;
        this._updateStatus(
          "failed",
          `DB 저장 실패 (Edge Function): ${detailedErrorMsg}`,
          95
        );
        throw new Error(`데이터 저장 Edge Function 실패: ${detailedErrorMsg}`);
      }
      logger.info("Edge Function 호출 성공.", data);
      this._updateStatus("completed", `DB 저장 완료 (Edge Function 사용)`, 100);
    } catch (error) {
      logger.error(
        `데이터 처리/저장 중 오류 발생: ${error.message}`,
        error.stack
      );
      try {
        this._updateStatus(
          "failed",
          `데이터 처리/저장 중 오류: ${error.message}`,
          95
        );
      } catch (statusUpdateError) {
        logger.error("오류 처리 중 상태 업데이트 실패:", statusUpdateError);
      }
      throw error;
    }
  } // --- saveDetailPostsToSupabase 종료 ---
}

module.exports = BandPosts;
