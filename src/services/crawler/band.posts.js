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

  /**
   * 게시물 목록 스크롤 및 기본 정보 수집 (날짜 기준 중단)
   * @param {string} lastCrawledPostId - 상세 크롤링 대상 선정 시 사용될 수 있음 (스크롤 중단에는 사용 안 함)
   * @param {number} daysLimit - 스크롤 중단 기준일 (며칠 전까지 스크롤할지)
   * @param {number} checkInterval - 스크롤 후 대기 시간 (ms)
   * @param {number} safetyScrollLimit - 예기치 않은 무한 스크롤 방지를 위한 안전 제한 횟수
   * @returns {Promise<Array<Object>>} - 수집된 게시물 기본 정보 배열
   */
  async scrollToLoadAndGetBasicInfo(
    lastCrawledPostId = "0", // 스크롤 중단 조건에는 사용 안 하지만, 호출 함수에서 필요할 수 있음
    daysLimit = 5,
    checkInterval = 3000,
    safetyScrollLimit = 200 // 무한 스크롤 방지 안전장치 (필요시 조정)
  ) {
    logger.info(
      // 로그 메시지 수정: lastId 언급 제거
      `게시물 목록 스크롤 및 기본 정보 수집 시작 (${daysLimit}일 이내까지)`
    );
    const basicPostInfoList = new Map(); // postId를 키로 사용하여 중복 방지
    let scrollAttempts = 0;
    let consecutiveNoChange = 0; // 새 게시물 로드 안 됨 연속 횟수
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - daysLimit);
    thresholdDate.setHours(0, 0, 0, 0); // 기준일 자정으로 설정
    logger.debug(`스크롤 중단 기준 날짜: ${thresholdDate.toISOString()}`);

    // maxScrollAttempts 대신 while(true) 사용하고 내부에서 break
    while (true) {
      scrollAttempts++;
      logger.debug(`스크롤 시도 #${scrollAttempts}`);

      // 안전 제한 초과 시 강제 중단
      if (scrollAttempts > safetyScrollLimit) {
        logger.warn(
          `안전 스크롤 제한(${safetyScrollLimit}) 도달. 스크롤 강제 중단.`
        );
        break;
      }

      // 현재 화면의 게시물 정보 가져오기
      const currentBatchInfo = await this.page.evaluate(() => {
        const items = [];
        // 선택자 확인 및 최신화 필요 시 진행
        document
          .querySelectorAll(".postWrap .cCard article._postMainWrap")
          .forEach((card) => {
            try {
              // postId, postUrl, commentCount, postTime 추출 로직 유지
              const linkElement = card.querySelector(
                "div.postWriterInfoWrap a.text" // 이 선택자는 UI 변경에 따라 달라질 수 있음
              );
              const postUrl = linkElement?.href;
              const postIdMatch = postUrl?.match(/\/post\/(\d+)/);
              const postId = postIdMatch?.[1];

              const commentCountElement = card.querySelector(
                "button._commentCountBtn span.count" // 이 선택자도 변경될 수 있음
              );
              const commentCountText =
                commentCountElement?.innerText.trim() ?? "0";
              const commentCount =
                parseInt(commentCountText.replace(/[^0-9]/g, ""), 10) || 0;

              const timeElement = card.querySelector(
                "div.postListInfoWrap time.time" // 이 선택자도 변경될 수 있음
              );
              // title 속성 우선 사용, 없으면 innerText 사용
              const postTime = timeElement
                ? timeElement.getAttribute("title") ||
                  timeElement.innerText.trim()
                : null;

              if (postId && postUrl) {
                items.push({ postId, postUrl, commentCount, postTime });
              }
            } catch (e) {
              // 개별 카드 오류는 무시하고 계속 진행
              console.error("Error processing card in evaluate:", e.message);
            }
          });
        return items;
      });

      // 이번 스크롤 배치에서 가장 오래된 게시물의 날짜 (초기값: 현재 시간)
      let oldestPostDateInBatch = new Date();
      let stopScrolling = false; // 스크롤 중단 플래그
      let newPostsFound = 0; // 이번 스크롤에서 새로 발견된 게시물 수
      let batchHasParsableDate = false; // 이번 배치에 파싱 가능한 날짜가 있었는지 여부

      // 수집된 정보 처리 및 날짜 기준 확인
      for (const item of currentBatchInfo) {
        // Map에 없는 새로운 게시물만 처리
        if (!basicPostInfoList.has(item.postId)) {
          newPostsFound++;
          basicPostInfoList.set(item.postId, {
            postUrl: item.postUrl,
            commentCount: item.commentCount,
            postTime: item.postTime,
          });

          // 날짜 파싱 시도 (상대 시간 제외)
          if (item.postTime) {
            const isRelativeTime = /전|어제|오늘|방금/i.test(item.postTime);
            if (!isRelativeTime) {
              const parsedDate = safeParseDate(item.postTime); // 유틸리티 함수 사용
              if (parsedDate) {
                batchHasParsableDate = true; // 파싱 가능한 날짜 발견
                // 현재 배치에서 가장 오래된 날짜 업데이트
                if (parsedDate < oldestPostDateInBatch) {
                  oldestPostDateInBatch = parsedDate;
                }
              }
              // else {
              //   logger.warn(`날짜 파싱 실패: postId=${item.postId}, postTime=${item.postTime}`);
              // }
            }
          }
        }
      }

      logger.debug(
        `이번 스크롤에서 새로운 게시물 ${newPostsFound}개 발견. 총 ${basicPostInfoList.size}개 정보 수집됨.`
      );
      if (batchHasParsableDate) {
        logger.debug(
          `이번 배치에서 가장 오래된 게시물 날짜: ${oldestPostDateInBatch.toISOString()}`
        );
      } else if (currentBatchInfo.length > 0 && newPostsFound > 0) {
        // 새 게시물이 발견되었으나 파싱 가능한 날짜가 없는 경우 로그
        logger.debug(
          `이번 배치에서 유효한 날짜 정보를 가진 게시물을 찾지 못했습니다.`
        );
      }

      // --- 스크롤 중단 조건 체크 ---

      // 조건 1: 날짜 기준
      // 파싱 가능한 날짜가 있었고, 그 중 가장 오래된 날짜가 기준일 이전이면 중단
      if (batchHasParsableDate && oldestPostDateInBatch < thresholdDate) {
        logger.info(
          `가장 오래된 날짜(${oldestPostDateInBatch.toLocaleDateString()})가 기준(${thresholdDate.toLocaleDateString()}) 이전. 스크롤 중단.`
        );
        stopScrolling = true;
      }

      // 조건 2: 더 이상 새 게시물 로드 안 됨
      // 이번 스크롤에서 새 게시물이 없고, 이전에 수집된 게시물이 있다면 카운트 증가
      if (newPostsFound === 0 && basicPostInfoList.size > 0) {
        consecutiveNoChange++;
        logger.debug(`새 게시물 로드 안 됨 연속 ${consecutiveNoChange}회`);
        // 연속 횟수 조정 (예: 5회)
        if (consecutiveNoChange >= 5) {
          logger.warn(`5회 연속 스크롤해도 새 게시물 로드 안됨. 스크롤 중단.`);
          stopScrolling = true;
        }
      } else {
        // 새 게시물이 발견되면 연속 카운트 초기화
        consecutiveNoChange = 0;
      }

      // 중단 조건 만족 시 루프 탈출
      if (stopScrolling) {
        break;
      }

      // 페이지 맨 아래로 스크롤
      await this.page.evaluate(() =>
        window.scrollTo(0, document.body.scrollHeight)
      );
      // 다음 스크롤 전 대기 (네트워크 및 렌더링 시간 고려)
      await new Promise((r) =>
        setTimeout(r, checkInterval + Math.random() * 1000)
      ); // 약간의 랜덤 딜레이 추가
    } // end while

    logger.info(
      `스크롤링 및 기본 정보 수집 완료: 총 ${basicPostInfoList.size}개 게시물 정보 확보.`
    );

    // 수집된 정보를 배열 형태로 변환하여 반환
    return Array.from(basicPostInfoList.entries()).map(([postId, info]) => ({
      postId,
      ...info,
    }));
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

      // try {
      //   await this.page.waitForSelector(
      //     ".postSubject, .postWriterInfoWrap, .postText, .txtBody",
      //     { timeout: 10000 }
      //   );
      // } catch (waitError) {
      //   logger.warn(
      //     `필수 콘텐츠 대기 실패 (${currentUrl}): ${waitError.message}`
      //   );
      // }

      try {
        await this.page.waitForSelector(".dPostCommentMainView", {
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
          await new Promise((resolve) =>
            setTimeout(resolve, 2000 + Math.random() * 1000)
          );
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

      // --- START: 댓글 로딩 보장을 위해 페이지 맨 아래로 스크롤하는 코드 추가 ---
      try {
        logger.debug(`페이지 맨 아래로 스크롤 시도 - ${currentUrl}`);
        await this.page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        // 스크롤 후 잠시 대기하여 콘텐츠 로딩 시간 확보
        await new Promise((resolve) => setTimeout(resolve, 1500)); // 1.5초 대기 (필요시 조정)
        logger.debug(`페이지 맨 아래로 스크롤 완료 및 대기 - ${currentUrl}`);
      } catch (scrollError) {
        logger.warn(
          `페이지 맨 아래로 스크롤 중 오류 발생 (${currentUrl}): ${scrollError.message}`
        );
      }
      // --- END: 스크롤 코드 추가 ---

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
        const isSecret = $(el).find(".secretGuideBox").length > 0; // 비밀 댓글인지
        const author = // <<<--- 'author' 키 사용
          $(el)
            .find(
              "button[data-uiselector='authorNameButton'] strong.name, .writerName"
            )
            .first()
            .text()
            .trim() || "익명";
        const commentTime =
          $(el).find("time.time, .commentDate").first().attr("title") ||
          $(el).find("time.time, .commentDate").first().text().trim();
        let commentContent = null;
        if (isSecret) {
          commentContent = "[비밀 댓글]"; // 비밀 댓글 내용 대체
          // 또는 비밀 댓글임을 나타내는 다른 정보 추출
        } else {
          commentContent = $(el)
            .find("p.txt._commentContent, .commentBody .text")
            .first()
            .text()
            .trim();
        }

        // author 정보가 있고, 내용(또는 비밀댓글 표시)이 있으면 comments 배열에 추가
        if (author && commentContent) {
          comments.push({
            author: author,
            content: commentContent,
            time: commentTime,
            isSecret: isSecret, // 비밀 댓글 여부 플래그 추가 (선택 사항)
          });
        } else if (isSecret && author) {
          // 작성자만 있고 비밀 댓글 표시인 경우
          comments.push({
            author: author,
            content: "[비밀 댓글]",
            time: commentTime,
            isSecret: true,
          });
        } else {
          logger.warn(
            `댓글 정보 추출 실패 (Index ${index}, Secret: ${isSecret}) on ${currentUrl}`
          );
        }
      });
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
   * 메인 크롤링 함수 (스크롤 -> 대상 선정 -> 상세 크롤링 -> 저장 함수 호출)
   * @param {string} userId
   * @param {string} naverId
   * @param {string} naverPassword
   * @param {number} [maxScrollAttempts=50] - 스크롤 시도 횟수
   * @param {boolean} [processWithAI=true] - AI 사용 여부
   * @returns {Promise<Object>}
   */
  async crawlAndSave(
    userId,
    naverId,
    naverPassword,
    maxScrollAttempts = 50,
    processWithAI = true,
    daysLimit
  ) {
    try {
      this.crawlStartTime = Date.now();

      logger.info(
        `목록 기반 증분 크롤링 및 저장 시작 (daysLimit=${daysLimit}, maxScrollAttempts=${maxScrollAttempts})`
      );
      this._updateStatus("processing", "크롤링 초기화 및 로그인...", 5);

      // 1. 로그인 및 밴드 페이지 이동
      await this.accessBandPage(userId, naverId, naverPassword);
      this._updateStatus("processing", "밴드 페이지 이동...", 20);
      await this.page.goto(`https://band.us/band/${this.bandNumber}`, {
        waitUntil: "networkidle0",
        timeout: 60000,
      }); // networkidle0으로 변경 시도

      // 2. 기존 데이터 로드 (last_crawled_post_id, existingPostsMap)
      this._updateStatus("processing", "기존 데이터 로드...", 25);
      const { data: urow, error: uerr } = await this.supabase
        .from("users")
        .select("last_crawled_post_id")
        .eq("user_id", userId)
        .single();
      if (uerr && uerr.code !== "PGRST116") throw uerr;
      const lastCrawledPostId = urow?.last_crawled_post_id || "0";
      logger.debug(`기존 last_crawled_post_id=${lastCrawledPostId}`);

      const { data: existingPostsData, error: postsErr } = await this.supabase
        .from("posts")
        .select("post_number::text, comment_count, status, posted_at") // posted_at 추가
        .eq("user_id", userId)
        .eq("band_number", this.bandNumber)
        .order("posted_at", { ascending: false })
        .limit(3000); // 최근 3000개 정도 로드
      if (postsErr) throw postsErr;
      const existingPostsMap = new Map(
        existingPostsData?.map((p) => [
          p.post_number,
          { commentCount: p.comment_count, status: p.status },
        ]) || []
      );
      logger.debug(`${existingPostsMap.size}개 기존 게시물 기본 정보 로드됨`);

      // 3. 페이지 스크롤 및 기본 정보 수집
      this._updateStatus(
        "processing",
        "게시물 목록 스캔 및 기본 정보 수집 중...",
        30
      );
      const basicPostInfoList = await this.scrollToLoadAndGetBasicInfo(
        lastCrawledPostId,
        daysLimit,
        undefined, // checkInterval 기본값 사용
        maxScrollAttempts > 0 ? maxScrollAttempts * 4 : 200 // safetyScrollLimit 설정 (기존 max 값 활용)
      );
      if (basicPostInfoList.length === 0) {
        this._updateStatus("completed", "처리할 새 게시물 없음", 100);
        logger.info("스크롤 결과 처리할 새 게시물이 없습니다.");
        // 최신 ID 업데이트 로직은 여기에 추가할 수 있음 (스크롤 결과가 없더라도 최신 ID는 있을 수 있음)
        const latestPostIdOnPage = await this.getLatestPostId();
        if (
          latestPostIdOnPage &&
          parseInt(latestPostIdOnPage, 10) > parseInt(lastCrawledPostId, 10)
        ) {
          // ... last_crawled_post_id 업데이트 로직 ...
        }
        return { success: true, data: [] };
      }

      // 4. 상세 크롤링 대상 선정
      this._updateStatus("processing", "상세 크롤링 대상 선정 중...", 60);
      const toCrawlDetailsUrls = [];
      let latestPostIdInList = "0"; // 이번 스크롤에서 발견된 가장 최신 ID
      const detailThresholdDate = new Date();
      detailThresholdDate.setDate(detailThresholdDate.getDate() - 14); // 너무 오래된 글 상세 크롤링 제외

      for (const item of basicPostInfoList) {
        const currentPostIdNum = parseInt(item.postId, 10);
        const lastCrawledPostIdNum = parseInt(lastCrawledPostId, 10);
        const postDate = safeParseDate(item.postTime);

        if (isNaN(currentPostIdNum)) continue;

        // 이번 스크롤 목록 중 최신 ID 갱신 (last_crawled_post_id 업데이트 목적)
        if (currentPostIdNum > parseInt(latestPostIdInList, 10)) {
          latestPostIdInList = item.postId;
        }

        const existingInfo = existingPostsMap.get(item.postId);
        const isNew = !existingInfo; // DB에 없는 새로운 게시물인가?
        const commentCountChanged = // 댓글 수가 변경되었는가?
          existingInfo &&
          item.commentCount !== null && // 스크롤 시 댓글 수가 유효하게 수집되었고
          existingInfo.commentCount !== item.commentCount; // DB 값과 다른가
        const isClosedInDB = existingInfo && existingInfo.status === "마감"; // DB에서 이미 마감 처리된 게시물인가?
        // 상세 크롤링 제외 기준일보다 오래된 게시물인가? (파싱된 날짜 기준)
        const isOldPostForDetail = postDate && postDate < detailThresholdDate;

        // --- 상세 크롤링 조건 수정 ---
        // 조건 1: 새로운 게시물이면서 너무 오래되지 않았는가? (lastCrawledPostId 비교 제거)
        const shouldCrawlNew = isNew && !isOldPostForDetail;
        // 조건 2: 기존 게시물이면서 댓글이 변경되었고, 마감 상태가 아니며, 너무 오래되지 않았는가?
        const shouldCrawlExisting =
          existingInfo &&
          commentCountChanged &&
          !isClosedInDB &&
          !isOldPostForDetail;

        if (shouldCrawlNew || shouldCrawlExisting) {
          toCrawlDetailsUrls.push(item.postUrl); // URL을 리스트에 추가
          logger.info(
            `ID ${item.postId}: 상세 크롤링 대상 추가 (이유: ${
              shouldCrawlNew ? "신규(기간내)" : "댓글변경(미마감,기간내)"
            })`
          );
        } else {
          // 제외 사유 로깅 개선
          let reason = "알 수 없음";
          if (isNew && isOldPostForDetail) {
            reason = "신규(오래됨)";
          } else if (existingInfo && isOldPostForDetail) {
            reason = "기존(오래됨)";
          } else if (existingInfo && isClosedInDB) {
            reason = "기존(DB마감)";
          } else if (existingInfo && !commentCountChanged) {
            reason = "기존(변경없음)";
          } else if (isNew && !shouldCrawlNew) {
            // 이 경우는 isOldPostForDetail = true 뿐임
            reason = "신규(오래됨)";
          } else if (existingInfo && !shouldCrawlExisting) {
            // 댓글 변경 없거나, 마감되었거나, 오래됨
            if (isOldPostForDetail) reason = "기존(오래됨)";
            else if (isClosedInDB) reason = "기존(DB마감)";
            else reason = "기존(변경없음)";
          }
          logger.debug(`ID ${item.postId}: 상세 크롤링 제외 (이유: ${reason})`);
        }
      }
      logger.info(
        `총 ${toCrawlDetailsUrls.length}개의 게시물 상세 크롤링 대상 선정.`
      );
      // 5. 병렬 상세 크롤링 실행
      this._updateStatus(
        "processing",
        `${toCrawlDetailsUrls.length}개 상세 정보 크롤링 중...`,
        70
      );
      const detailedResults = []; // 상세 정보 저장 배열
      if (toCrawlDetailsUrls.length > 0) {
        const pageA = await this.browser.newPage();
        const pageB = await this.browser.newPage();
        // ... (dialog 핸들러 부착) ...
        const attachDialogHandler = (page, name) => {
          page.on("dialog", async (dialog) => {
            logger.warn(`[${name}] dialog: ${dialog.message()}. closing.`);
            await dialog.accept();
          });
        };
        attachDialogHandler(pageA, "tabA");
        attachDialogHandler(pageB, "tabB");

        const batchSize = 2;
        for (let i = 0; i < toCrawlDetailsUrls.length; i += batchSize) {
          const batchUrls = toCrawlDetailsUrls.slice(i, i + batchSize);
          const batchPromises = batchUrls.map(async (url, idx) => {
            const page = idx === 0 ? pageA : pageB;
            const postIdMatch = url.match(/\/post\/(\d+)/);
            const postId = postIdMatch ? postIdMatch[1] : "Unknown";
            logger.debug(
              `상세 크롤링 시도 ID=${postId} on ${idx === 0 ? "A" : "B"}`
            );
            try {
              await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 45000,
              });
              await new Promise((r) => setTimeout(r, 1000));

              // 상세 정보 추출 함수 호출
              const detail = await this.extractPostDetailFromPage.call({
                page: page,
              });

              if (detail) {
                // --- 마감 키워드 체크 (댓글과 본문 모두 확인) --- START
                const closedByComment = detail.comments.some((c) =>
                  hasClosingKeywords(c.content)
                );
                const closedByContent = hasClosingKeywords(
                  detail.postContent || ""
                ); // 본문 확인 추가 (null/undefined 방지)

                if (closedByComment || closedByContent) {
                  // 본문 또는 댓글 중 하나라도 마감이면
                  const reason = `${closedByContent ? "본문" : ""}${
                    closedByComment ? (closedByContent ? ", 댓글" : "댓글") : ""
                  }`;
                  logger.info(
                    `ID ${detail.postId}: 상세 내용(${reason})에서 마감 키워드 발견. status='마감' 설정.`
                  );
                  detail.status = "마감"; // 크롤링 결과 객체에 '마감' 상태 설정
                } else {
                  logger.info(
                    `ID ${detail.postId}: 상세 정보 수집됨 (마감 아님).`
                  );
                  // detail.status = "활성"; // 필요 시 기본 상태 설정
                }
                // --- 마감 키워드 체크 --- END
                detailedResults.push(detail); // 마감 상태가 반영된 detail 객체 저장
              } else {
                logger.warn(`ID ${postId}: 상세 정보 추출 실패 (null 반환)`);
              }
            } catch (err) {
              logger.error(
                `ID ${postId} 상세 크롤링 오류: ${err.message}`,
                err.stack
              );
              if (err.name === "TimeoutError")
                logger.warn(`ID ${postId}: 페이지 로드 타임아웃.`);
            }
          });
          await Promise.all(batchPromises); // 현재 배치 완료 대기

          const progress =
            70 + Math.floor(((i + batchSize) / toCrawlDetailsUrls.length) * 25);
          this._updateStatus(
            "processing",
            `${detailedResults.length}개 상세 정보 수집 완료 (${
              i + batchSize
            }/${toCrawlDetailsUrls.length})`,
            Math.min(95, progress)
          );
        } // end for batch
        await pageA.close();
        await pageB.close(); // 탭 닫기
      }
      logger.info(
        `상세 크롤링 완료, 총 ${detailedResults.length}개 게시물 데이터 확보`
      );

      // 6. DB 저장 (saveDetailPostsToSupabase 호출)
      this._updateStatus(
        "processing",
        `${detailedResults.length}개 데이터 DB 저장 시도...`,
        95
      );
      if (detailedResults.length > 0) {
        await this.saveDetailPostsToSupabase(
          detailedResults,
          userId,
          processWithAI
        );
      } else {
        logger.info("DB에 저장할 상세 크롤링 결과 없음.");
        this._updateStatus("completed", "저장할 새 데이터 없음", 100);
      }

      // 7. last_crawled_post_id 업데이트 (latestPostIdInList 사용)
      if (
        latestPostIdInList !== "0" &&
        parseInt(latestPostIdInList, 10) > parseInt(lastCrawledPostId, 10)
      ) {
        const { error: uup } = await this.supabase
          .from("users")
          .update({ last_crawled_post_id: latestPostIdInList })
          .eq("user_id", userId);
        if (uup)
          logger.error(`last_crawled_post_id 업데이트 오류: ${uup.message}`);
        else
          logger.info(
            `last_crawled_post_id → ${latestPostIdInList} 업데이트 완료`
          );
      } else {
        logger.debug(
          `last_crawled_post_id (${lastCrawledPostId}) 가 최신이므로 업데이트하지 않습니다.`
        );
      }

      this._updateStatus(
        "completed",
        `크롤링 및 저장 완료 (${detailedResults.length}개 처리)`,
        100
      );
      return { success: true, data: detailedResults }; // 최종 결과 반환
    } catch (e) {
      logger.error(`crawlAndSave 전체 프로세스 에러: ${e.message}`, e.stack);
      this._updateStatus("failed", `크롤링 실패: ${e.message}`, 100);
      return { success: false, error: e.message };
    }
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
    if (!userId) throw new Error("userId 필수");
    if (!this.supabase) throw new Error("Supabase 클라이언트 없음");
    if (!this.bandNumber) throw new Error("밴드 ID 없음");
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
    const bandNumberStr = this.bandNumber;

    // --- AI 서비스 로드 (선택 사항) ---
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
      let existingProductsFullMap = new Map();

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
            .select("*")
            .eq("user_id", userId)
            .eq("band_number", bandNumberStr)
            .in("post_number", postNumbersStrings);

          if (prodErr) throw prodErr;
          // 조회 결과를 existingProductsFullMap에 저장 (중첩 Map 구조)
          (products || []).forEach((p) => {
            if (!existingProductsFullMap.has(p.post_number)) {
              existingProductsFullMap.set(p.post_number, new Map());
            }
            existingProductsFullMap.get(p.post_number).set(p.item_number, p); // item_number를 키로 사용
          });
          logger.debug(
            `${existingProductsFullMap.size}개 게시물에 대한 기존 상품 상세 정보 로드됨`
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

        // <<<--- 로그 추가 --- START --->>>
        if (postNumStr === "26778") {
          logger.debug(
            `[Debug 26778] Processing post. crawledCommentCount: ${
              crawledPost.commentCount
            }, Initial isProductPost guess based on existingPost: ${
              existingPost ? existingPost.is_product : "N/A (New)"
            }`
          );
        }
        // <<<--- 로그 추가 --- END --->>>

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
          const existingProds = existingProductsFullMap.get(postNumStr) || [];
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

        // <<<--- 로그 추가 --- START --->>>
        if (postNumStr === "26778") {
          logger.debug(
            `[Debug 26778] After AI/Indicator Check - isProductPost: ${isProductPost}, mightBeProduct: ${mightBeProduct}, runAI: ${runAI}`
          );
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

                // --- ★★★ 상품 데이터 병합 시작 ★★★ ---
                const existingProdFull = existingProductsFullMap
                  .get(postNumStr)
                  ?.get(idx); // 기존 상세 정보 가져오기
                logger.debug(
                  `[Merge Check - AI] ID: ${postNumStr}, Item: ${idx}, Existing Product Full:`,
                  existingProdFull ? "Found" : "Not Found (undefined)"
                );
                if (existingProdFull)
                  logger.debug(
                    `[Merge Check - AI] Existing base_price: ${existingProdFull.base_price}`
                  );

                const newItemData = item; // AI 결과가 새 정보
                logger.debug(
                  `[Merge Check - AI] ID: ${postNumStr}, Item: ${idx}, New AI Data basePrice: ${newItemData.basePrice}`
                );

                const productBarcode = generateBarcodeFromProductId(prodId);

                const productData = {
                  product_id: prodId,
                  user_id: userId,
                  post_id: uniquePostId,
                  band_number: bandNumberStr,
                  post_number: postNumStr,
                  item_number: idx,
                  band_post_url: postUrl,
                  title:
                    newItemData.title || existingProdFull?.title || "제목 없음",
                  content:
                    newItemData.content ||
                    existingProdFull?.content ||
                    crawledContent ||
                    "",
                  base_price:
                    newItemData.basePrice ?? existingProdFull?.base_price ?? 0, // AI 필드명 사용
                  original_price:
                    newItemData.originalPrice ??
                    existingProdFull?.original_price,
                  price_options:
                    newItemData.priceOptions ||
                    existingProdFull?.price_options ||
                    [],
                  quantity:
                    newItemData.quantity ?? existingProdFull?.quantity ?? 1,
                  quantity_text:
                    newItemData.quantityText ||
                    existingProdFull?.quantity_text ||
                    null,
                  category:
                    newItemData.category ||
                    existingProdFull?.category ||
                    "기타",
                  tags: newItemData.tags || existingProdFull?.tags || [],
                  features:
                    newItemData.features || existingProdFull?.features || [],
                  status:
                    newItemData.status || existingProdFull?.status || "판매중",
                  pickup_info:
                    newItemData.pickupInfo ||
                    existingProdFull?.pickup_info ||
                    null,
                  pickup_date:
                    newItemData.pickupDate ||
                    existingProdFull?.pickup_date ||
                    null,
                  pickup_type:
                    newItemData.pickupType ||
                    existingProdFull?.pickup_type ||
                    null,
                  stock_quantity:
                    newItemData.stockQuantity ??
                    existingProdFull?.stock_quantity,
                  order_summary: existingProdFull?.order_summary || {
                    total_orders: 0,
                    total_quantity: 0,
                  },
                  created_at:
                    existingProdFull?.created_at || postedAt.toISOString(),
                  updated_at: new Date().toISOString(),
                  barcode: existingProdFull?.barcode || productBarcode,
                };

                newProductsFromAI.push(productData); // 임시 배열에 추가
                // Upsert 배열에 추가/업데이트
                const existingIndexInUpsert = productsToUpsert.findIndex(
                  (p) => p.product_id === prodId
                );
                if (existingIndexInUpsert > -1) {
                  productsToUpsert[existingIndexInUpsert] = {
                    ...productsToUpsert[existingIndexInUpsert],
                    ...productData,
                  };
                } else {
                  logger.debug(
                    `[Upsert Check - AI] Adding product to productsToUpsert: ${prodId}, base_price: ${productData.base_price}`
                  );
                  productsToUpsert.push(productData);
                }
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

        // --- ★★★ AI 미실행 + 기존 상품 존재 시 처리 로직 (로그 포함된 버전) ★★★ ---
        if (!runAI && isProductPost) {
          const existingProdsForPost = existingProductsFullMap.get(postNumStr);
          if (existingProdsForPost) {
            existingProdsForPost.forEach((existingProdFull, itemNumber) => {
              if (existingProdFull) {
                const prodId = existingProdFull.product_id;
                productMap.set(itemNumber, prodId); // 기존 상품 정보도 productMap에 추가

                logger.debug(
                  `[Merge Check - No AI] ID: ${postNumStr}, Item: ${itemNumber}, Processing based on existing data.`
                );
                logger.debug(
                  `[Merge Check - No AI] Existing base_price: ${existingProdFull.base_price}`
                );
                let productBarcode = null; // 기본값 null

                try {
                  logger.debug(
                    `[Barcode Gen - No AI] Generating barcode for prodId: ${prodId}`
                  );
                  productBarcode = generateBarcodeFromProductId(prodId);
                  logger.debug(
                    `[Barcode Gen - No AI] Generated barcode: ${productBarcode} for prodId: ${prodId}`
                  );
                } catch (barcodeError) {
                  logger.error(
                    `[Barcode Gen - No AI] Error generating barcode for prodId ${prodId}: ${barcodeError.message}`
                  );
                  // 바코드 생성 실패 시 null 유지 또는 기본값 설정 가능
                }

                const newItemData = {};
                const productData = {
                  // 기존 데이터 기반으로 생성
                  product_id: prodId,
                  user_id: userId,
                  post_id: uniquePostId,
                  band_number: bandNumberStr,
                  post_number: postNumStr,
                  item_number: itemNumber,
                  band_post_url: postUrl,
                  title: existingProdFull.title || "제목 없음",
                  content: existingProdFull.content || crawledContent || "",
                  base_price: existingProdFull.base_price ?? 0, // 기존값 사용
                  original_price: existingProdFull.original_price,
                  price_options: existingProdFull.price_options || [],
                  quantity: existingProdFull.quantity ?? 1,
                  quantity_text: existingProdFull.quantity_text || null,
                  category: existingProdFull.category || "기타",
                  tags: existingProdFull.tags || [],
                  features: existingProdFull.features || [],
                  status: existingProdFull.status || "판매중", // 기존 상태 유지
                  pickup_info: existingProdFull.pickup_info || null,
                  pickup_date: existingProdFull.pickup_date || null,
                  pickup_type: existingProdFull.pickup_type || null,
                  stock_quantity: existingProdFull.stock_quantity,
                  order_summary: existingProdFull.order_summary || {
                    total_orders: 0,
                    total_quantity: 0,
                  },
                  created_at:
                    existingProdFull.created_at || postedAt.toISOString(),
                  updated_at: new Date().toISOString(), // 업데이트 시간 갱신
                  barcode: existingProdFull.barcode || productBarcode,
                };

                // Upsert 배열에 추가 (중복 처리)
                const existingIndexInUpsert = productsToUpsert.findIndex(
                  (p) => p.product_id === prodId
                );
                if (existingIndexInUpsert === -1) {
                  logger.debug(
                    `[Upsert Check - No AI] Adding product to productsToUpsert: ${prodId}, base_price: ${productData.base_price}`
                  );
                  productsToUpsert.push(productData);
                  // AI 실행 안했어도 기존 상품 업데이트 위해 플래그 설정 필요 시
                  if (!productNeedsUpdate) productNeedsUpdate = true;
                  if (!postNeedsUpdate) postNeedsUpdate = true; // 연관 게시물도 업데이트 필요
                } else {
                  // 이미 있다면 updated_at 갱신 등 필요한 처리
                  productsToUpsert[existingIndexInUpsert].updated_at =
                    new Date().toISOString();
                }
              } else {
                logger.warn(
                  `[Merge Check - No AI] ID: ${postNumStr}, Item: ${itemNumber}, existingProdFull is unexpectedly undefined.`
                );
              }
            }); // end forEach existingProdsForPost
          } else {
            logger.warn(
              `[Merge Check - No AI] ID: ${postNumStr}, No existing products found in map despite isProductPost being true.`
            );
          }
        } // end if (!runAI && isProductPost)

        // --- 4) 게시물(Post) 데이터 준비 (v_working 추출 데이터 사용) ---
        // --- 게시물(Post) 데이터 준비 ---
        const postData = {
          /* ... (이전과 동일하게 postData 생성) ... */ post_id: uniquePostId,
          user_id: userId,
          band_number: bandNumberStr,
          post_number: postNumStr,
          band_post_url: postUrl,
          author_name: crawledPost.authorName || "작성자 불명",
          title: crawledPost.postTitle || "제목 없음",
          content: crawledContent,
          posted_at: postedAt.toISOString(),
          comment_count: crawledCommentCount,
          view_count: crawledPost.readCount || 0,
          image_urls: crawledPost.imageUrls || [],
          is_product: isProductPost,

          status:
            crawledPost.status === "마감" // 1순위: 크롤링 시 마감 판정된 경우
              ? "마감"
              : existingPost?.status === "마감" // 2순위: DB에 이미 마감으로 저장된 경우
              ? "마감"
              : "활성", // 그 외 기본 '활성'
          crawled_at: new Date(crawledPost.crawledAt).toISOString(),
          updated_at: new Date().toISOString(),
          item_list: [], // 초기화 후 아래에서 채움
        };

        // item_list 업데이트
        const productsForThisPost = productsToUpsert.filter(
          (p) => p.post_number === postNumStr
        );
        if (isProductPost && productsForThisPost.length > 0) {
          postData.item_list = productsForThisPost.map((p) => ({
            itemNumber: p.item_number,
            productId: p.product_id,
            title: p.title,
            price: p.base_price,
          }));
          if (!postNeedsUpdate) postNeedsUpdate = true;
        } else if (isProductPost && existingPost?.item_list) {
          postData.item_list = existingPost.item_list;
        }

        // --- 5) 댓글(Order) 처리 (새로운 댓글만, 안정적 저장 방식) ---
        let isClosedByNewComment = false;

        if (postNumStr === "26778") {
          logger.debug(
            `[Debug 26778] Before comment processing block - isProductPost: ${isProductPost}, newCommentsExist: ${newCommentsExist}, commentCountDiff: ${commentCountDiff}`
          );
        }

        if (newCommentsExist) {
          postNeedsUpdate = true;
          logger.debug(
            `ID ${postNumStr}: 댓글 수 변경 감지됨 (${commentCountStored} -> ${crawledCommentCount}), Post 업데이트 대상.`
          );
        }

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
                    productsToUpsert.find(
                      (p) => p.product_id === targetProductId
                    ) || // 현재 처리 중인 upsert 데이터 우선
                    existingProductsFullMap
                      .get(postNumStr)
                      ?.get(itemNumberToUse); // Map에서 .get()으로 조회

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
                    // status/sub_status 설정
                    if (orderData.is_ambiguous) {
                      orderData.sub_status = orderData.sub_status || "확인필요"; // 기존 sub_status 유지 또는 설정
                    } else {
                      orderData.sub_status = null; // 모호하지 않으면 sub_status 초기화
                    }
                    firstValidItemProcessed = true;
                  }

                  // 고객/상품 요약 업데이트
                  custData.total_orders = (custData.total_orders || 0) + 1;
                  custData.total_spent =
                    (custData.total_spent || 0) + itemTotal;
                  if (!custData.first_order_at)
                    custData.first_order_at = ctime.toISOString();
                  custData.last_order_at = ctime.toISOString();

                  // if (!orderSummaryUpdates.has(targetProductId))
                  //   orderSummaryUpdates.set(targetProductId, {
                  //     orders: 0,
                  //     quantity: 0,
                  //   });
                  // const summary = orderSummaryUpdates.get(targetProductId);
                  // summary.orders += 1;
                  // summary.quantity += quantity;

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
                    Array.from(
                      existingProductsFullMap.get(postNumStr)?.values() || []
                    ).find(
                      // <--- 수정된 부분
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
                // status/sub_status 설정
                if (orderData.is_ambiguous) {
                  orderData.sub_status = orderData.sub_status || "확인필요"; // 기존 sub_status 유지 또는 설정
                } else {
                  orderData.sub_status = null; // 모호하지 않으면 sub_status 초기화
                }

                // 고객/상품 요약 업데이트 (product_id 있을 때만)
                if (targetProductId) {
                  custData.total_orders = (custData.total_orders || 0) + 1;
                  custData.total_spent =
                    (custData.total_spent || 0) + itemTotal;
                  if (!custData.first_order_at)
                    custData.first_order_at = ctime.toISOString();
                  custData.last_order_at = ctime.toISOString();

                  // if (!orderSummaryUpdates.has(targetProductId))
                  //   orderSummaryUpdates.set(targetProductId, {
                  //     orders: 0,
                  //     quantity: 0,
                  //   });
                  // const summary = orderSummaryUpdates.get(targetProductId);
                  // summary.orders += 1;
                  // summary.quantity += quantity;
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
                      Array.from(
                        existingProductsFullMap.get(postNumStr)?.values() || []
                      ).find(
                        // <--- 수정된 부분
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

        const shouldBeClosed =
          crawledPost.status === "마감" || isClosedByNewComment;

        // --- 6) 상태 업데이트 (마감 처리 - v_improved) ---
        // 마감 상태여야 하는데, 현재 postData 객체의 상태가 아직 '마감'이 아니라면 마감 처리를 진행
        if (shouldBeClosed && postData.status !== "마감") {
          postData.status = "마감"; // postData 상태를 '마감'으로 최종 확정
          postNeedsUpdate = true; // 게시물 정보 업데이트 필요 플래그 설정
          productNeedsUpdate = true; // 관련 상품 정보 업데이트 필요 플래그 설정

          // 어떤 이유로 마감되었는지 로깅
          const closeReason =
            crawledPost.status === "마감" ? "본문/댓글(크롤링시)" : "새 댓글";
          logger.info(
            `ID ${postNumStr}: ${closeReason} 키워드로 인해 마감 처리됨.`
          );

          // --- 이 게시물과 관련된 모든 상품들의 상태를 '마감'으로 변경하는 로직 ---

          // 1. 현재 DB에 저장(Upsert)하기 위해 준비 중인 상품 목록(productsToUpsert)에서
          //    이 게시물에 해당하고 아직 '마감' 상태가 아닌 상품들을 찾아 상태 변경
          const productsToMarkClosedInUpsert = productsToUpsert.filter(
            (p) => p.post_number === postNumStr && p.status !== "마감"
          );
          productsToMarkClosedInUpsert.forEach((p) => {
            p.status = "마감"; // 상태를 '마감'으로 변경
            p.updated_at = new Date().toISOString(); // 업데이트 시간 갱신
            logger.debug(
              `ID ${postNumStr}: Upsert 대상 상품 ${p.item_number} 마감 상태로 변경 (${closeReason})`
            );
          });

          // 2. DB에는 이미 존재하지만, 이번 Upsert 대상 목록에는 아직 포함되지 않은 기존 상품들도
          //    '마감' 상태로 업데이트하기 위해 productsToUpsert 목록에 추가
          const existingProdsMapForPost =
            existingProductsFullMap.get(postNumStr); // 해당 게시물의 기존 상품 정보 가져오기
          if (existingProdsMapForPost) {
            existingProdsMapForPost.forEach((existingProdInfo) => {
              // 현재 Upsert 목록에 이미 해당 상품이 있는지 확인
              const alreadyInUpsert = productsToUpsert.some(
                (p) => p.product_id === existingProdInfo.product_id
              );
              // Upsert 목록에 없고 & DB 상의 상태가 '마감'이 아닐 경우에만 처리
              if (!alreadyInUpsert && existingProdInfo.status !== "마감") {
                // '마감' 상태 업데이트를 위한 최소 정보만 포함하여 Upsert 목록에 추가
                productsToUpsert.push({
                  product_id: existingProdInfo.product_id,
                  user_id: userId, // 사용자 ID는 필수
                  status: "마감", // 상태를 '마감'으로 설정
                  updated_at: new Date().toISOString(), // 업데이트 시간 갱신
                });
                logger.debug(
                  `ID ${postNumStr}: 기존 상품 ${existingProdInfo.item_number} 마감 처리 위해 upsert 추가 (${closeReason})`
                );
              }
            });
          }
          // --- 관련 상품들 마감 처리 로직 끝 ---
        } // end if (shouldBeClosed && postData.status !== "마감")

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
            const existingProds = existingProductsFullMap.get(postNumStr) || [];
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
        // if (orderSummaryUpdates.size > 0) {
        //   orderSummaryUpdates.forEach((summary, productId) => {
        //     let productToUpdate = productsToUpsert.find(
        //       (p) => p.product_id === productId
        //     );
        //     if (productToUpdate) {
        //       // 이미 upsert 대상에 있으면 요약 정보 업데이트
        //       productToUpdate.order_summary = summary;
        //       productToUpdate.updated_at = new Date().toISOString();
        //       logger.debug(
        //         `ID ${postNumStr}: 상품 ${productId} 요약 업데이트 (기존 upsert 대상)`
        //       );
        //     } else {
        //       // upsert 대상에 없으면 요약 정보만 업데이트하는 객체 추가
        //       productsToUpsert.push({
        //         product_id: productId,
        //         user_id: userId, // userId 필요
        //         order_summary: summary,
        //         updated_at: new Date().toISOString(),
        //       });
        //       logger.debug(
        //         `ID ${postNumStr}: 상품 ${productId} 요약 업데이트 위해 upsert 추가`
        //       );
        //     }

        //     // 상품 요약 변경 시 게시물도 업데이트 필요할 수 있음
        //     if (!postNeedsUpdate) {
        //       const existingPostIndex = postsToUpsert.findIndex(
        //         (p) => p.post_id === uniquePostId
        //       );
        //       if (existingPostIndex === -1) {
        //         // postData를 복사하여 updated_at만 갱신 후 추가
        //         postsToUpsert.push({
        //           ...postData,
        //           updated_at: new Date().toISOString(),
        //         });
        //       } else {
        //         postsToUpsert[existingPostIndex].updated_at =
        //           new Date().toISOString();
        //       }
        //       postNeedsUpdate = true; // 플래그 설정
        //       logger.debug(
        //         `ID ${postNumStr}: 상품 요약 변경으로 Post 업데이트 대상 추가`
        //       );
        //     } else {
        //       // 이미 업데이트 대상이면 updated_at만 갱신
        //       const postInArray = postsToUpsert.find(
        //         (p) => p.post_id === uniquePostId
        //       );
        //       if (postInArray)
        //         postInArray.updated_at = new Date().toISOString();
        //     }
        //   });
        // } // end if orderSummaryUpdates
      } // end for detailedPosts (메인 루프 종료)

      // --- 최종 주문 요약 정보 계산 및 적용 ---
      const finalOrderSummaryUpdates = new Map();

      // ... (이전 답변의 최종 요약 계산 및 적용 로직 사용) ...
      for (const order of ordersToUpsert) {
        if (
          order.product_id &&
          typeof order.quantity === "number" &&
          order.quantity > 0
        ) {
          if (!finalOrderSummaryUpdates.has(order.product_id)) {
            finalOrderSummaryUpdates.set(order.product_id, {
              orders: 0,
              quantity: 0,
            });
          }
          const summary = finalOrderSummaryUpdates.get(order.product_id);
          summary.orders += 1;
          summary.quantity += order.quantity;
        }
      }
      finalOrderSummaryUpdates.forEach((summary, productId) => {
        const productIndex = productsToUpsert.findIndex(
          (p) => p.product_id === productId
        );
        if (productIndex > -1) {
          productsToUpsert[productIndex].order_summary = summary; // 덮어쓰기 (필요시 합산 로직 추가)
          productsToUpsert[productIndex].updated_at = new Date().toISOString();
          logger.debug(
            `상품 ${productId}의 주문 요약 정보 최종 업데이트됨: ${JSON.stringify(
              summary
            )}`
          );
        } else {
          logger.warn(
            `주문 요약 업데이트 대상 상품 ${productId}을(를) 최종 Upsert 목록에서 찾을 수 없습니다.`
          );
        }
      });

      // --- Edge Function 호출 준비 ---
      this._updateStatus(
        "processing",
        `DB 저장을 위한 최종 데이터 준비...`,
        93
      );
      const customersArray = Array.from(customersToUpsertMap.values());

      // 최종 데이터 확인 로그
      logger.debug("Final data prepared for Edge Function:");
      logger.debug(`Posts to upsert: ${postsToUpsert.length}`);
      logger.debug(
        `Products to upsert (count only): ${productsToUpsert.length}`
      );
      logger.debug(`Orders to upsert: ${ordersToUpsert.length}`);
      logger.debug(`Customers to upsert: ${customersArray.length}`);

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
