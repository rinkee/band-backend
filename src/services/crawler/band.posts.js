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
  calculateOptimalPrice, // <<<--- 최적 가격 계산 함수 추가
  updateTaskStatusInDB, // <<<--- DB 상태 업데이트 함수 추가
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
      if (commentLoadAttempts >= MAX_COMMENT_LOAD_ATTEMPTS) {
        logger.warn(`최대 댓글 로드 시도 도달 (${currentUrl}).`);
      }

      // --- 이전 댓글 버튼이 사라질 때까지 대기 --- START ---
      try {
        logger.info(
          `모든 댓글 로드를 위해 '${prevButtonSelector}' 버튼이 사라지기를 기다립니다...`
        );
        await this.page.waitForSelector(prevButtonSelector, {
          hidden: true, // <<<--- 버튼이 숨겨지거나 DOM에서 제거될 때까지 대기
          timeout: 15000, // <<<--- 최대 대기 시간 설정 (예: 15초, 필요시 조정)
        });
        logger.info(
          `'${prevButtonSelector}' 버튼 사라짐 확인. 모든 댓글 로딩 완료 추정.`
        );
      } catch (error) {
        // 타임아웃 발생 시: 버튼이 계속 남아있거나, 예상보다 오래 걸림
        if (error.name === "TimeoutError") {
          logger.warn(
            `'${prevButtonSelector}' 버튼이 제한 시간 내에 사라지지 않았습니다. 댓글이 완전히 로드되지 않았을 수 있습니다.`
          );
          // 계속 진행하거나, 오류로 처리할 수 있음
        } else {
          // 다른 예외 상황
          logger.error(
            `'${prevButtonSelector}' 대기 중 오류 발생: ${error.message}`
          );
        }
      }
      // --- 이전 댓글 버튼이 사라질 때까지 대기 --- END ---

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
   * * @param {string} taskId // <<<--- taskId 파라미터 확인
   * @returns {Promise<Object>}
   */
  async crawlAndSave(
    userId,
    naverId,
    naverPassword,
    maxScrollAttempts = 50,
    processWithAI = true,
    daysLimit,
    taskId
  ) {
    this.taskId = taskId; // <<<--- 인스턴스 변수에 taskId 저장
    let lastProgress = 0; // 마지막 진행률 추적
    // 상태 업데이트 래퍼 함수 (진행률 추적 포함)
    // --- DB 상태 업데이트를 위한 래퍼 함수 (편의용) ---
    const updateDbStatus = async (status, message, progress, error = null) => {
      // taskId가 유효한 경우에만 DB 업데이트 시도
      if (taskId) {
        await updateTaskStatusInDB(taskId, status, message, progress, error);
      } else {
        logger.warn("taskId가 없어 DB 상태를 업데이트할 수 없습니다.");
      }
      // 로컬 상태 업데이트(_updateStatus)는 필요 시 별도 호출 또는 통합
      // this._updateStatus(status, message, progress);
    };
    // --- 래퍼 함수 끝 ---

    try {
      this.crawlStartTime = Date.now();

      logger.info(
        `목록 기반 증분 크롤링 및 저장 시작 (daysLimit=${daysLimit}, maxScrollAttempts=${maxScrollAttempts})`
      );
      updateDbStatus("processing", "크롤링 초기화 및 로그인...", 5);

      // 1. 로그인 및 밴드 페이지 이동
      await this.accessBandPage(userId, naverId, naverPassword);
      updateDbStatus("processing", "밴드 페이지 이동...", 20);
      await this.page.goto(`https://band.us/band/${this.bandNumber}`, {
        waitUntil: "networkidle0",
        timeout: 60000,
      }); // networkidle0으로 변경 시도
      console.log(`[${this.taskId}] 밴드 페이지 이동...`);

      await this.page.goto("https://band.us/band/82443310/", {
        waitUntil: "networkidle2",
        timeout: 30000,
      });
      // 기다릴 요소 선택자 (개발자 도구를 사용하여 확인하세요)
      const selector = "div.uWidget.-displayBlock.gCursorPointer"; // 또는 div[data-viewname="DPostPhotoListView"]

      await this.page.waitForSelector(selector, { timeout: 5000 }); // 5초 동안 기다립니다.

      await this.page.addStyleTag({
        content: `${selector} { display: none !important; }`,
      });

      // 2. 기존 데이터 로드 (last_crawled_post_id, existingPostsMap)
      updateDbStatus("processing", "기존 데이터 로드...", 25);
      const { data: urow, error: uerr } = await this.supabase
        .from("users")
        .select("last_crawled_post_id")
        .eq("user_id", userId)
        .single();
      if (uerr && uerr.code !== "PGRST116") throw uerr;
      const lastCrawledPostId = urow?.last_crawled_post_id || "0";
      logger.debug(`기존 last_crawled_post_id=${lastCrawledPostId}`);
      console.log(`[${this.taskId}] 기존 데이터 로드...`);

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
      console.log(`[${this.taskId}] 기존 게시물 기본 정보 로드...`);

      // 3. 페이지 스크롤 및 기본 정보 수집
      updateDbStatus(
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
        updateDbStatus("completed", "처리할 새 게시물 없음", 100);
        logger.info("스크롤 결과 처리할 새 게시물이 없습니다.");
        console.log(`[${this.taskId}] 처리할 새 게시물 없음`);
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
      updateDbStatus("processing", "상세 크롤링 대상 선정 중...", 60);
      console.log(`[${this.taskId}] 상세 크롤링 대상 선정 중...`);
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
          console.log(
            `[${this.taskId}] ID ${item.postId}: 상세 크롤링 대상 추가 (이유: ${
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
          console.log(
            `[${this.taskId}] ID ${item.postId}: 상세 크롤링 제외 (이유: ${reason})`
          );
        }
      }
      logger.info(
        `총 ${toCrawlDetailsUrls.length}개의 게시물 상세 크롤링 대상 선정.`
      );
      console.log(
        `[${this.taskId}] 총 ${toCrawlDetailsUrls.length}개의 게시물 상세 크롤링 대상 선정.`
      );
      // 5. 병렬 상세 크롤링 실행
      updateDbStatus(
        "processing",
        `${toCrawlDetailsUrls.length}개 상세 정보 크롤링 중...`,
        70
      );
      console.log(
        `[${this.taskId}] ${toCrawlDetailsUrls.length}개 상세 정보 크롤링 중...`
      );
      const detailedResults = []; // 상세 정보 저장 배열
      if (toCrawlDetailsUrls.length > 0) {
        const pageA = await this.browser.newPage();
        const pageB = await this.browser.newPage();

        // 이미지 로딩 방지 및 스타일 추가 함수
        const configurePage = async (page) => {
          await page.setRequestInterception(true); // Request interception enabled BEFORE adding listeners
          page.on("request", (req) => {
            if (req.resourceType() === "image") {
              req.abort();
            } else {
              req.continue();
            }
          });
          // await page.addStyleTag({
          //   content: `div.uWidget.-displayBlock.gCursorPointer { display: none !important; }`,
          // });
        };

        await configurePage(pageA);
        await configurePage(pageB); //Await the configuration for both pages

        // ... (dialog 핸들러 부착) ...
        const attachDialogHandler = (page, name) => {
          page.on("dialog", async (dialog) => {
            logger.warn(`[${name}] dialog: ${dialog.message()}. closing.`);
            console.log(
              `[${this.taskId}] [${name}] dialog: ${dialog.message()}. closing.`
            );
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
            console.log(
              `[${this.taskId}] 상세 크롤링 시도 ID=${postId} on ${
                idx === 0 ? "A" : "B"
              }`
            );
            try {
              await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 45000,
              });
              await new Promise((r) => setTimeout(r, 1000));

              await page.addStyleTag({
                content: `.uWidget.expanded { display: none !important; }`,
              });

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
                  console.log(
                    `[${this.taskId}] ID ${detail.postId}: 상세 내용(${reason})에서 마감 키워드 발견. status='마감' 설정.`
                  );
                  detail.status = "마감"; // 크롤링 결과 객체에 '마감' 상태 설정
                } else {
                  logger.info(
                    `ID ${detail.postId}: 상세 정보 수집됨 (마감 아님).`
                  );
                  console.log(
                    `[${this.taskId}] ID ${detail.postId}: 상세 정보 수집됨 (마감 아님).`
                  );
                  // detail.status = "활성"; // 필요 시 기본 상태 설정
                }

                // --- 추가 로그 ---
                if (postId === "문제_게시물_ID_입력") {
                  logger.debug(
                    `[상세 크롤링 후 상태 ${postId}] 최종 detail.status: ${
                      detail.status || "활성(기본값)"
                    }`
                  );
                }
                // --- 추가 로그 끝 ---
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
          updateDbStatus(
            "processing",
            `${detailedResults.length}개 상세 정보 수집 완료 (${
              i + batchSize
            }/${toCrawlDetailsUrls.length})`,
            Math.min(95, progress)
          );
          console.log(
            `[${this.taskId}] ${
              detailedResults.length
            }개 상세 정보 수집 완료 (${i + batchSize}/${
              toCrawlDetailsUrls.length
            })`
          );
        } // end for batch
        await pageA.close();
        await pageB.close(); // 탭 닫기
      }
      logger.info(
        `상세 크롤링 완료, 총 ${detailedResults.length}개 게시물 데이터 확보`
      );
      console.log(
        `[${this.taskId}] 상세 크롤링 완료, 총 ${detailedResults.length}개 게시물 데이터 확보`
      );

      // 6. DB 저장 (saveDetailPostsToSupabase 호출)
      updateDbStatus(
        "processing",
        `${detailedResults.length}개 데이터 DB 저장 시도...`,
        95
      );
      console.log(
        `[${this.taskId}] ${detailedResults.length}개 데이터 DB 저장 시도...`
      );
      if (detailedResults.length > 0) {
        await this.saveDetailPostsToSupabase(
          detailedResults,
          userId,
          processWithAI
        );
      } else {
        logger.info("DB에 저장할 상세 크롤링 결과 없음.");
        updateDbStatus("completed", "저장할 새 데이터 없음", 100);
        console.log(`[${this.taskId}] DB에 저장할 상세 크롤링 결과 없음.`);
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

      updateDbStatus(
        "completed",
        `크롤링 및 저장 완료 (${detailedResults.length}개 처리)`,
        100
      );
      console.log(
        `[${this.taskId}] 크롤링 및 저장 완료 (${detailedResults.length}개 처리)`
      );
      return { success: true, data: detailedResults }; // 최종 결과 반환
    } catch (e) {
      logger.error(`crawlAndSave 전체 프로세스 에러: ${e.message}`, e.stack);
      updateDbStatus("failed", `크롤링 실패: ${e.message}`, 100);
      console.log(`[${this.taskId}] 크롤링 실패: ${e.message}`);
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

              // --- 추가 로그 ---
              if (postId === "문제_게시물_ID_입력") {
                // 특정 ID만 로깅
                logger.debug(
                  `[상세 크롤링 마감 체크 ${postId}] 본문 마감 감지: ${closedByContent}, 댓글 마감 감지: ${closedByComment}`
                );
                if (closedByComment) {
                  const closingComments = detail.comments.filter((c) =>
                    hasClosingKeywords(c.content)
                  );
                  logger.debug(
                    `  마감 키워드 포함 댓글 내용: ${JSON.stringify(
                      closingComments
                    )}`
                  );
                }
              }
              // --- 추가 로그 끝 ---
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
   * 게시물 상세 정보 Supabase 저장 (최종 버전: 주문 요약 포함)
   * @param {Array<Object>} detailedPosts - 저장할 게시물 목록
   * @param {string} userId - 사용자 ID
   * @param {boolean} processWithAI - AI 처리 활성화 여부
   */
  async saveDetailPostsToSupabase(detailedPosts, userId, processWithAI = true) {
    // --- 1. 사전 검사 ---
    if (!userId) throw new Error("userId 필수");
    if (!this.supabase) throw new Error("Supabase 클라이언트 없음");
    if (!this.bandNumber) throw new Error("밴드 ID 없음");
    if (!detailedPosts || detailedPosts.length === 0) {
      logger.info("저장할 게시물 없음");
      if (this._updateStatus)
        this._updateStatus("completed", "저장할 데이터 없음", 100);
      return;
    }

    if (this._updateStatus)
      this._updateStatus("processing", "DB 저장 준비 중...", 85);
    const supabase = this.supabase;
    const bandNumberStr = this.bandNumber;

    // --- 2. AI 서비스 로드 ---
    let extractProductInfoAI = null;
    if (processWithAI) {
      try {
        extractProductInfoAI =
          require("../../services/ai.service").extractProductInfo;
        if (extractProductInfoAI) logger.info("AI 서비스 로드됨.");
        else logger.warn("AI 서비스 함수를 찾을 수 없습니다.");
      } catch (error) {
        logger.error(`AI 서비스 로드 중 오류: ${error.message}`);
      }
    }
    if (processWithAI && !extractProductInfoAI)
      logger.warn("AI 처리가 요청되었으나 AI 서비스 로드 실패.");

    try {
      // --- 3. Upsert 대상 배열 및 Map 초기화 ---
      const postsToUpsert = [];
      const productsToUpsert = [];
      const ordersToUpsert = [];
      const customersToUpsertMap = new Map(); // custId -> custData

      // --- 4. 제외 고객 로드 ---
      let excludedCustomers = [];
      try {
        const { data: userData, error: userError } = await supabase
          .from("users")
          .select("excluded_customers")
          .eq("user_id", userId)
          .single();
        if (userError && userError.code !== "PGRST116") throw userError;
        if (userData?.excluded_customers)
          excludedCustomers = userData.excluded_customers
            .filter((n) => typeof n === "string")
            .map((n) => n.trim());
        logger.info(`제외 고객 ${excludedCustomers.length}명 로드됨.`);
      } catch (e) {
        logger.error(`제외 고객 조회 중 오류: ${e.message}`);
      }

      // --- 5. 기존 게시물 및 상품 정보 로드 ---
      const postNumbersStrings = detailedPosts
        .map((p) => p.postId)
        .filter(Boolean);
      const existingPostsMap = new Map(); // postNumStr -> postData
      let existingProductsFullMap = new Map(); // postNumStr -> Map(itemNumber -> productData)
      if (postNumbersStrings.length > 0) {
        if (this._updateStatus)
          this._updateStatus("processing", "기존 데이터 조회 중...", 87);
        try {
          const { data: posts, error: postsErr } = await supabase
            .from("posts")
            .select(
              "post_id, content, comment_count, is_product, status, post_number, updated_at"
            )
            .eq("user_id", userId)
            .eq("band_number", bandNumberStr)
            .in("post_number", postNumbersStrings);
          if (postsErr) throw postsErr;
          (posts || []).forEach((p) => existingPostsMap.set(p.post_number, p));
          logger.debug(`${existingPostsMap.size}개 기존 게시물 정보 로드됨`);

          const { data: products, error: prodErr } = await supabase
            .from("products")
            .select("*")
            .eq("user_id", userId)
            .eq("band_number", bandNumberStr)
            .in("post_number", postNumbersStrings);
          if (prodErr) throw prodErr;
          (products || []).forEach((p) => {
            if (!existingProductsFullMap.has(p.post_number))
              existingProductsFullMap.set(p.post_number, new Map());
            existingProductsFullMap.get(p.post_number).set(p.item_number, p);
          });
          logger.debug(
            `${existingProductsFullMap.size}개 게시물 기존 상품 상세 정보 로드됨`
          );
        } catch (e) {
          logger.error(`기존 데이터 로드 중 오류: ${e.message}`, e.stack);
          if (this._updateStatus)
            this._updateStatus("failed", `DB 조회 오류: ${e.message}`, 90);
          throw e;
        }
      }

      if (this._updateStatus)
        this._updateStatus("processing", "데이터 변경분 분석/변환 중...", 91);
      logger.info(`${detailedPosts.length}개 게시물 처리 시작`);

      // --- 6. 메인 루프: 각 크롤링된 게시물 처리 ---
      for (const crawledPost of detailedPosts) {
        const postNumStr = crawledPost.postId;
        if (!postNumStr) {
          logger.warn(`잘못된 postId (빈 값), 건너뜁니다.`);
          continue;
        }
        const postNumInt = parseInt(postNumStr, 10);
        if (isNaN(postNumInt)) {
          logger.warn(`잘못된 postId (${postNumStr}), 건너뜁니다.`);
          continue;
        }

        const uniquePostId = generatePostUniqueId(
          userId,
          bandNumberStr,
          postNumStr
        );
        const crawledContent = crawledPost.postContent || "";
        const crawledComments = crawledPost.comments || [];
        const crawledCommentCount =
          crawledPost.commentCount || crawledComments.length;
        const postedAt =
          safeParseDate(crawledPost.postTime) ||
          new Date(crawledPost.crawledAt) ||
          new Date();
        const postUrl =
          crawledPost.postUrl ||
          `https://band.us/band/${bandNumberStr}/post/${postNumStr}`;

        // 변경 감지 및 AI 분석 조건 설정
        const existingPost = existingPostsMap.get(postNumStr);
        const isNewPost = !existingPost;
        const contentChanged =
          !isNewPost && existingPost?.content !== crawledContent;
        const commentCountStored = existingPost?.comment_count ?? 0;
        const newCommentsExist = crawledCommentCount > commentCountStored;
        const commentCountDiff = Math.max(
          0,
          crawledCommentCount - commentCountStored
        );
        let postNeedsUpdate = isNewPost;
        let productNeedsUpdate = false;
        let runAI = false;
        let isProductPost = existingPost ? existingPost.is_product : false;
        const productMap = new Map(); // itemNumber -> productId
        let newProductsFromAI = [];

        const mightBeProduct = contentHasPriceIndicator(crawledContent);
        if (
          extractProductInfoAI &&
          (isNewPost || contentChanged) &&
          mightBeProduct
        )
          runAI = true;
        else if (!isNewPost && !contentChanged && existingPost?.is_product)
          isProductPost = true;
        else if ((isNewPost || contentChanged) && mightBeProduct)
          isProductPost = true;
        else isProductPost = false;
        if (!isNewPost && isProductPost !== existingPost?.is_product)
          postNeedsUpdate = true;

        // AI 분석 실행 (필요시)
        if (runAI) {
          try {
            const aiResult = await extractProductInfoAI(
              crawledContent,
              crawledPost.postTime,
              bandNumberStr,
              postNumStr,
              crawledPost.imageUrls
            );
            if (aiResult && (aiResult.products?.length > 0 || aiResult.title)) {
              isProductPost = true;
              productNeedsUpdate = true;
              postNeedsUpdate = true;
              const productsFromAIResult = aiResult.multipleProducts
                ? aiResult.products
                : [{ ...aiResult, itemNumber: 1 }];
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
                const existingProdFull = existingProductsFullMap
                  .get(postNumStr)
                  ?.get(idx);
                const newItemData = item;
                const productBarcode = await generateBarcodeFromProductId(
                  prodId,
                  userId
                ); // await + userId
                const productData = {
                  /* ... AI 결과와 기존 정보 병합, barcode 포함 ... */
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
                    newItemData.basePrice ?? existingProdFull?.base_price ?? 0,
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
                newProductsFromAI.push(productData);
                const existingIndex = productsToUpsert.findIndex(
                  (p) => p.product_id === prodId
                );
                if (existingIndex > -1)
                  productsToUpsert[existingIndex] = {
                    ...productsToUpsert[existingIndex],
                    ...productData,
                  };
                else productsToUpsert.push(productData);
              }
            } else {
              isProductPost = false;
              if (!isNewPost && existingPost?.is_product) {
                postNeedsUpdate = true;
                productNeedsUpdate = true;
              }
            }
          } catch (e) {
            logger.error(
              `ID ${postNumStr} AI 분석 중 오류: ${e.message}`,
              e.stack
            );
            isProductPost = existingPost?.is_product ?? false;
          }
        }

        // AI 미실행 + 기존 상품 처리 (for...of 루프 및 await 사용)
        if (!runAI && isProductPost) {
          const existingProdsForPost = existingProductsFullMap.get(postNumStr);
          if (existingProdsForPost) {
            for (const [
              itemNumber,
              existingProdFull,
            ] of existingProdsForPost.entries()) {
              if (existingProdFull) {
                const prodId = existingProdFull.product_id;
                productMap.set(itemNumber, prodId);
                let productBarcode = null;
                try {
                  productBarcode = await generateBarcodeFromProductId(
                    prodId,
                    userId
                  );
                } catch (barcodeError) {
                  // await + userId
                  logger.error(
                    `[Barcode Gen - No AI] ID ${prodId}: ${barcodeError.message}`
                  );
                }
                const productData = {
                  /* ... 기존 데이터 기반, barcode 포함 ... */
                  product_id: prodId,
                  user_id: userId,
                  post_id: uniquePostId,
                  band_number: bandNumberStr,
                  post_number: postNumStr,
                  item_number: itemNumber,
                  band_post_url: postUrl,
                  title: existingProdFull.title || "제목 없음",
                  content: existingProdFull.content || crawledContent || "",
                  base_price: existingProdFull.base_price ?? 0,
                  original_price: existingProdFull.original_price,
                  price_options: existingProdFull.price_options || [],
                  quantity: existingProdFull.quantity ?? 1,
                  quantity_text: existingProdFull.quantity_text || null,
                  category: existingProdFull.category || "기타",
                  tags: existingProdFull.tags || [],
                  features: existingProdFull.features || [],
                  status: existingProdFull.status || "판매중",
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
                  updated_at: new Date().toISOString(),
                  barcode: existingProdFull.barcode || productBarcode,
                };
                const existingIndex = productsToUpsert.findIndex(
                  (p) => p.product_id === prodId
                );
                if (existingIndex === -1) {
                  productsToUpsert.push(productData);
                  if (!productNeedsUpdate) productNeedsUpdate = true;
                  if (!postNeedsUpdate) postNeedsUpdate = true;
                } else {
                  productsToUpsert[existingIndex].updated_at =
                    new Date().toISOString();
                }
              }
            }
          }
        }

        // 게시물 데이터 준비
        const postData = {
          post_id: uniquePostId,
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
            crawledPost.status === "마감"
              ? "마감"
              : existingPost?.status === "마감"
              ? "마감"
              : "활성",
          crawled_at: new Date(crawledPost.crawledAt).toISOString(),
          updated_at: new Date().toISOString(),
          item_list: [],
        };
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

        // --- 댓글(Order) 처리 ---
        let isClosedByNewComment = false;
        if (newCommentsExist) postNeedsUpdate = true;

        if (isProductPost && newCommentsExist && commentCountDiff > 0) {
          postNeedsUpdate = true;
          const newComments = crawledComments.slice(-commentCountDiff);
          const startingCommentIndex = commentCountStored;
          logger.info(
            `ID ${postNumStr}: ${commentCountDiff}개 신규 댓글 처리 시작 (인덱스: ${startingCommentIndex}).`
          );

          for (let i = 0; i < newComments.length; i++) {
            const cm = newComments[i];
            const originalCommentIndex = startingCommentIndex + i;
            const author = cm.author?.trim() || "익명";
            const text = cm.content || "";
            const ctime = safeParseDate(cm.time) || postedAt;

            if (!text || excludedCustomers.includes(author)) continue;

            // 고객 데이터 준비/업데이트
            const custId = generateCustomerUniqueId(
              userId,
              bandNumberStr,
              postNumStr,
              originalCommentIndex
            );
            if (!customersToUpsertMap.has(custId))
              customersToUpsertMap.set(custId, {
                customer_id: custId,
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
            const custData = customersToUpsertMap.get(custId);
            custData.updated_at = new Date().toISOString();

            // Order 데이터 초기화
            const bandCommentId = `${postNumStr}_comment_${originalCommentIndex}`;
            const uniqueCommentOrderId = `order_${bandNumberStr}_${postNumStr}_${originalCommentIndex}`;
            let orderData = {
              order_id: uniqueCommentOrderId,
              user_id: userId,
              post_number: postNumStr,
              band_number: bandNumberStr,
              customer_id: custId,
              comment: text,
              ordered_at: ctime.toISOString(),
              band_comment_id: bandCommentId,
              band_comment_url: `${postUrl}#${bandCommentId}`,
              customer_name: author,
              product_id: null,
              item_number: null,
              quantity: null,
              price: 0,
              total_amount: 0,
              price_option_description: null,
              status: "주문완료",
              sub_status: null,
              extracted_items_details: null,
              is_ambiguous: false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };

            if (!isClosedByNewComment && hasClosingKeywords(text))
              isClosedByNewComment = true;

            let processedAsOrder = false;
            let calculatedTotalAmount = 0; // Reset for each comment

            // 주문 정보 추출 및 처리
            if (isProductPost && productMap.size > 0 && !isClosedByNewComment) {
              const extractedItems = extractEnhancedOrderFromComment(
                text,
                logger
              );

              if (extractedItems.length > 0) {
                // 명시적 주문 추출 성공
                orderData.extracted_items_details = extractedItems;
                let firstValidItemProcessed = false;
                for (const orderItem of extractedItems) {
                  let itemNumberToUse = orderItem.itemNumber;
                  let targetProductId = null;
                  let isAmbiguousNow = orderItem.isAmbiguous;
                  // 상품 ID 결정 로직 ...
                  if (isAmbiguousNow) {
                    if (productMap.size === 1) {
                      [itemNumberToUse, targetProductId] = Array.from(
                        productMap.entries()
                      )[0];
                      isAmbiguousNow = false;
                    } else if (productMap.has(1)) {
                      targetProductId = productMap.get(1);
                      itemNumberToUse = 1;
                    } else if (productMap.size > 0) {
                      [itemNumberToUse, targetProductId] = Array.from(
                        productMap.entries()
                      )[0];
                    }
                  } else {
                    targetProductId = productMap.get(itemNumberToUse);
                    if (!targetProductId) {
                      isAmbiguousNow = true; /* ... 폴백 ID 결정 ... */
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
                  if (!targetProductId) continue;
                  const productInfo =
                    productsToUpsert.find(
                      (p) => p.product_id === targetProductId
                    ) ||
                    existingProductsFullMap
                      .get(postNumStr)
                      ?.get(itemNumberToUse);
                  if (!productInfo) {
                    logger.warn(
                      `ID ${postNumStr}, Item ${itemNumberToUse}: 상품 정보 없음.`
                    );
                    continue;
                  }

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
                    isAmbiguousNow = true;

                  const productOptions = productInfo.price_options || [];
                  const fallbackPrice =
                    typeof productInfo.base_price === "number"
                      ? productInfo.base_price
                      : 0;
                  calculatedTotalAmount = calculateOptimalPrice(
                    quantity,
                    productOptions,
                    fallbackPrice
                  ); // 계산 값 저장

                  if (!firstValidItemProcessed) {
                    orderData.product_id = targetProductId;
                    orderData.item_number = itemNumberToUse;
                    orderData.quantity = quantity;
                    orderData.price = fallbackPrice;
                    orderData.total_amount = calculatedTotalAmount;
                    orderData.price_option_description = productInfo.title
                      ? `${itemNumberToUse}번 (${productInfo.title})`
                      : `${itemNumberToUse}번`;
                    orderData.is_ambiguous = isAmbiguousNow;
                    orderData.sub_status = isAmbiguousNow ? "확인필요" : null;
                    firstValidItemProcessed = true;
                  }
                  custData.total_orders = (custData.total_orders || 0) + 1;
                  custData.total_spent =
                    (custData.total_spent || 0) + calculatedTotalAmount; // 계산된 값 사용
                  if (!custData.first_order_at)
                    custData.first_order_at = ctime.toISOString();
                  custData.last_order_at = ctime.toISOString();
                  processedAsOrder = true;
                }
              } else if (/\d/.test(text)) {
                // 폴백 1: 주문 추출 실패 & 숫자 포함
                logger.warn(
                  `ID ${postNumStr} 댓글 ${originalCommentIndex}: 폴백 처리`
                );
                let targetProductId = null;
                let itemNumberToUse = 1;
                let productInfo = null;
                // 폴백 상품 ID 결정 ...
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

                if (targetProductId)
                  productInfo =
                    productsToUpsert.find(
                      (p) => p.product_id === targetProductId
                    ) ||
                    existingProductsFullMap
                      .get(postNumStr)
                      ?.get(itemNumberToUse);

                const quantity = 1; // 수량 추출
                const productOptions = productInfo?.price_options || [];
                const fallbackPrice =
                  typeof productInfo?.base_price === "number"
                    ? productInfo.base_price
                    : 0;
                calculatedTotalAmount = calculateOptimalPrice(
                  quantity,
                  productOptions,
                  fallbackPrice
                ); // 계산 값 저장

                orderData.product_id = targetProductId;
                orderData.item_number = itemNumberToUse;
                orderData.quantity = quantity;
                orderData.price = fallbackPrice;
                orderData.total_amount = calculatedTotalAmount;
                orderData.price_option_description = productInfo
                  ? `${itemNumberToUse}번 (${productInfo.title}) - 추정`
                  : "상품 정보 불명 - 추정";
                orderData.sub_status = "확인필요";
                orderData.is_ambiguous = true;

                if (targetProductId) {
                  custData.total_orders = (custData.total_orders || 0) + 1;
                  custData.total_spent =
                    (custData.total_spent || 0) + calculatedTotalAmount; // 계산된 값 사용
                  if (!custData.first_order_at)
                    custData.first_order_at = ctime.toISOString();
                  custData.last_order_at = ctime.toISOString();
                }
                processedAsOrder = true;
              }
            } // end if (isProductPost && ...)

            // 최종 저장 결정 (숫자 포함 시)
            const containsDigit = /\d/.test(text);
            if (containsDigit) {
              if (orderData.quantity === null) {
                // 폴백 2: 수량 정보 누락
                logger.warn(
                  `ID ${postNumStr} 댓글 ${originalCommentIndex}: 최종 폴백 처리`
                );
                const quantity = 1; // 수량 추출
                let targetProductId = orderData.product_id;
                let itemNumberToUse = orderData.item_number;
                let productInfo = null;
                // 상품 정보 결정 ...
                if (!targetProductId && isProductPost && productMap.size > 0) {
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
                if (targetProductId) {
                  productInfo =
                    productsToUpsert.find(
                      (p) => p.product_id === targetProductId
                    ) ||
                    existingProductsFullMap
                      .get(postNumStr)
                      ?.get(itemNumberToUse);
                }

                const productOptions = productInfo?.price_options || [];
                const fallbackPrice =
                  typeof productInfo?.base_price === "number"
                    ? productInfo.base_price
                    : 0;
                calculatedTotalAmount = calculateOptimalPrice(
                  quantity,
                  productOptions,
                  fallbackPrice
                ); // 계산 값 저장

                orderData.quantity = quantity;
                orderData.product_id = orderData.product_id || targetProductId;
                orderData.item_number =
                  orderData.item_number || itemNumberToUse;
                orderData.price = orderData.price ?? fallbackPrice;
                orderData.total_amount = calculatedTotalAmount; // 계산된 총액 저장
                orderData.price_option_description =
                  orderData.price_option_description ||
                  (productInfo
                    ? `${itemNumberToUse}번 (${productInfo.title}) - 최종 추정`
                    : "상품 정보 불명 - 최종 추정");
                orderData.sub_status = "확인필요";
                orderData.is_ambiguous = true;

                if (targetProductId) {
                  // 고객 지출액 업데이트 (폴백 2)
                  custData.total_orders = (custData.total_orders || 0) + 1;
                  custData.total_spent =
                    (custData.total_spent || 0) + calculatedTotalAmount; // 계산된 값 사용
                  if (!custData.first_order_at)
                    custData.first_order_at = ctime.toISOString();
                  custData.last_order_at = ctime.toISOString();
                }
              }
              // 저장 목록에 추가
              ordersToUpsert.push(orderData);
              logger.debug(
                `ID ${postNumStr} 댓글 ${originalCommentIndex}: 저장 대상 추가 (Total: ${orderData.total_amount}, Ambiguous: ${orderData.is_ambiguous})`
              );
            } else {
              logger.debug(
                `ID ${postNumStr} 댓글 ${originalCommentIndex}: 숫자 미포함, 저장 건너뜀.`
              );
            }
          } // end for newComments
        } // end if newCommentsExist

        // 마감 처리 및 Upsert 대상 추가
        const shouldBeClosed =
          crawledPost.status === "마감" || isClosedByNewComment;
        if (shouldBeClosed && postData.status !== "마감") {
          // --- 게시물 상태 변경 로그 ---
          const previousPostStatusInDB = existingPost
            ? existingPost.status
            : "신규";
          if (existingPost && previousPostStatusInDB !== "마감") {
            logger.info(
              `[마감 상태 변경 감지] 게시물 ID ${postNumStr}: DB 상태(${previousPostStatusInDB}) -> '마감'으로 변경됩니다. (사유: ${
                crawledPost.status === "마감"
                  ? "크롤링시 키워드"
                  : "새 댓글 키워드"
              })`
            );
          } else if (!existingPost) {
            logger.info(
              `[마감 상태 감지] 신규 게시물 ID ${postNumStr}: '마감' 상태로 생성됩니다. (사유: ${
                crawledPost.status === "마감"
                  ? "크롤링시 키워드"
                  : "새 댓글 키워드"
              })`
            );
          }
          // --- 게시물 상태 변경 로그 끝 ---
          postData.status = "마감";
          postNeedsUpdate = true;
          productNeedsUpdate = true;
          logger.info(
            `ID ${postNumStr}: ${
              crawledPost.status === "마감" ? "크롤링시" : "새댓글"
            } 키워드로 마감 처리됨.`
          );
          // 관련 상품 마감 처리
          const productsToMarkClosedInUpsert = productsToUpsert.filter(
            (p) => p.post_number === postNumStr && p.status !== "마감"
          );
          productsToMarkClosedInUpsert.forEach((p) => {
            p.status = "마감";
            p.updated_at = new Date().toISOString();
          });
          const existingProdsMapForPost =
            existingProductsFullMap.get(postNumStr);
          if (existingProdsMapForPost) {
            existingProdsMapForPost.forEach((existingProdInfo) => {
              const alreadyInUpsert = productsToUpsert.some(
                (p) => p.product_id === existingProdInfo.product_id
              );
              if (!alreadyInUpsert && existingProdInfo.status !== "마감") {
                productsToUpsert.push({
                  product_id: existingProdInfo.product_id,
                  user_id: userId,
                  status: "마감",
                  updated_at: new Date().toISOString(),
                });
              }
            });
          }
        }
        if (postNeedsUpdate) {
          const existingPostIndex = postsToUpsert.findIndex(
            (p) => p.post_id === uniquePostId
          );
          if (existingPostIndex === -1) postsToUpsert.push(postData);
          else
            postsToUpsert[existingPostIndex] = {
              ...postsToUpsert[existingPostIndex],
              ...postData,
              updated_at: new Date().toISOString(),
            };
        }
        if (productNeedsUpdate) {
          // AI 결과 추가는 이미 위에서 처리됨
          // 마감 시 상태 변경을 위한 추가 로직은 위 마감 블록에서 처리됨
        }
      } // --- 메인 루프 종료 ---

      // --- 7. 최종 주문 요약 계산 및 적용 ---
      const finalOrderSummaryUpdates = new Map();
      logger.debug("Calculating final order summaries...");
      for (const order of ordersToUpsert) {
        if (
          order.product_id &&
          typeof order.quantity === "number" &&
          order.quantity > 0
        ) {
          const productId = order.product_id;
          if (!finalOrderSummaryUpdates.has(productId))
            finalOrderSummaryUpdates.set(productId, { orders: 0, quantity: 0 });
          const summary = finalOrderSummaryUpdates.get(productId);
          summary.orders += 1;
          summary.quantity += order.quantity;
        }
      }
      logger.debug(
        `Applying final order summaries to ${finalOrderSummaryUpdates.size} products...`
      );
      finalOrderSummaryUpdates.forEach((summary, productId) => {
        const productIndex = productsToUpsert.findIndex(
          (p) => p.product_id === productId
        );
        if (productIndex > -1) {
          productsToUpsert[productIndex].order_summary = summary;
          productsToUpsert[productIndex].updated_at = new Date().toISOString();
          logger.debug(
            `Product ${productId} final order_summary updated: ${JSON.stringify(
              summary
            )}`
          );
        } else {
          logger.warn(
            `Could not find product ${productId} in productsToUpsert for final summary.`
          );
        }
      });
      logger.debug("Finished applying final order summaries.");

      // --- 8. Edge Function 호출 준비 및 실행 ---
      if (this._updateStatus)
        this._updateStatus("processing", `DB 저장 데이터 준비...`, 93);
      const customersArray = Array.from(customersToUpsertMap.values());
      if (
        customersArray.length === 0 &&
        postsToUpsert.length === 0 &&
        productsToUpsert.length === 0 &&
        ordersToUpsert.length === 0
      ) {
        if (this._updateStatus)
          this._updateStatus("completed", "DB 업데이트 변경 사항 없음", 100);
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
      if (this._updateStatus)
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
        if (this._updateStatus)
          this._updateStatus("failed", `DB 저장 실패: ${detailedErrorMsg}`, 95);
        throw new Error(`Edge Function Error: ${detailedErrorMsg}`);
      }
      logger.info(`Edge Function 실행 결과: ${JSON.stringify(data)}`);
      if (this._updateStatus)
        this._updateStatus("completed", "DB 저장 완료", 100);
    } catch (e) {
      logger.error(
        `saveDetailPostsToSupabase 전체 프로세스 중 오류: ${e.message}`,
        e.stack
      );
      if (this._updateStatus)
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
