// src/services/crawler/band.comments.js
const BandPosts = require("./band.posts");
const {
  safeParseDate,
  extractQuantityFromComment,
  hasClosingKeywords,
} = require("./band.utils");
const { extractPriceFromContent } = require("./band.utils");
const logger = require("../../config/logger");

/**
 * 밴드 댓글 크롤링 관련 클래스
 */
class BandComments extends BandPosts {
  constructor(bandNumber, options = {}) {
    super(bandNumber, options);
    // 모든 댓글을 저장할 전역 저장소
    this.allOrdersToSave = [];
    this.allCustomersToSave = new Map();
    this.processedCommentIds = new Set();
  }

  /**
   * 모든 댓글 로드
   * @returns {Promise<boolean>} - 성공 여부
   */
  async loadAllComments() {
    try {
      console.log(`댓글 로드 시작...`);

      // 댓글 영역 확인
      const hasCommentSection = await this.page.evaluate(() => {
        return !!document.querySelector(
          ".dPostCommentMainView, .commentWrap, .sCommentList"
        );
      });

      if (!hasCommentSection) {
        // 댓글 버튼 클릭이 필요한 경우
        console.log(`댓글 버튼 찾기 및 클릭 시도...`);
        const commentBtnClicked = await this.page.evaluate(() => {
          // 댓글 버튼 찾기 시도
          const selectors = [
            "._commentCountBtn",
            ".comment._commentCountBtn",
            "span.comment",
            ".count.-commentCount",
            '[class*="comment"][class*="count"]',
            ".uIconComments",
            'button[class*="comment"]',
          ];

          for (const selector of selectors) {
            const btn = document.querySelector(selector);
            if (btn) {
              console.log(
                `댓글 버튼 발견: ${selector}, 내용: ${btn.textContent}`
              );
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
          console.log(`댓글 버튼 클릭 완료. 댓글 로드 대기...`);
        } else {
          console.log(
            `댓글 버튼을 찾지 못했거나 이미 댓글이 표시되어 있습니다.`
          );
        }
      } else {
        console.log(`댓글 영역이 이미 표시되어 있습니다.`);
      }

      // 댓글 컨테이너가 로드될 때까지 대기
      try {
        // 댓글 컨테이너 선택자들
        const commentContainerSelectors = [
          ".dPostCommentMainView",
          ".sCommentList",
          ".commentWrap",
          '[class*="comment"][class*="list"]',
        ];

        // 모든 선택자에 대해 대기 시도
        let containerFound = false;
        for (const selector of commentContainerSelectors) {
          try {
            await this.page.waitForSelector(selector, {
              visible: true,
              timeout: 10000,
            });
            console.log(`댓글 컨테이너 발견! (${selector})`);
            containerFound = true;
            break;
          } catch (e) {
            // 이 선택자로는 찾지 못함, 다음 선택자 시도
          }
        }

        if (!containerFound) {
          console.log(`지정된 선택자로 댓글 컨테이너를 찾지 못했습니다.`);
          throw new Error("댓글 컨테이너를 찾을 수 없습니다.");
        }

        // 댓글이 완전히 로드될 시간 추가 대기
        console.log(`댓글이 완전히 로드될 때까지 5초 대기...`);
        try {
          // this.page.waitForTimeout 대신 일반 Promise 타이머 사용
          await new Promise((resolve) => setTimeout(resolve, 5000));
        } catch (error) {
          console.error(`대기 중 오류: ${error.message}`);
        }

        // 댓글 수 확인
        const commentCount = await this.page.evaluate(() => {
          // 댓글 카운트 표시 요소에서 댓글 수 확인
          const countElements = document.querySelectorAll(
            ".comment .count, [class*='comment'][class*='count']"
          );
          for (const el of countElements) {
            const countText = el.textContent.trim();
            const count = parseInt(countText.replace(/[^0-9]/g, ""), 10);
            if (!isNaN(count)) {
              console.log(`댓글 수 발견: ${count}개`);
              return count;
            }
          }

          // 또는 이미 로드된 댓글 요소 수로 추정
          const visibleComments = document.querySelectorAll(".cComment").length;
          console.log(`화면에 표시된 댓글 수: ${visibleComments}개`);
          return visibleComments;
        });

        console.log(`댓글 수: ${commentCount}개`);

        // 댓글이 20개 이상인 경우 "이전 댓글" 버튼 반복 클릭
        if (commentCount >= 20) {
          console.log(
            `댓글이 많습니다(${commentCount}개). 이전 댓글 로드를 시도합니다...`
          );

          let prevButtonClicked = true;
          let prevButtonClickCount = 0;
          const MAX_PREV_BUTTON_CLICKS = 10; // 최대 10번 시도 (200개 댓글 정도까지 대응)

          while (
            prevButtonClicked &&
            prevButtonClickCount < MAX_PREV_BUTTON_CLICKS
          ) {
            // "이전 댓글" 버튼 클릭
            prevButtonClicked = await this.page.evaluate(() => {
              // 이전 댓글 버튼 찾기 (다양한 선택자 시도)
              const prevButtons = document.querySelectorAll(
                '.prevComment, button[data-uiselector="previousCommentButton"], button.prevComment, [class*="prev"][class*="comment"], button:nth-child(1)'
              );

              for (const btn of prevButtons) {
                if (
                  btn.offsetParent !== null &&
                  (btn.textContent.includes("이전 댓글") ||
                    btn.textContent.includes("이전댓글") ||
                    btn.className.includes("prevComment") ||
                    btn.getAttribute("data-uiselector") ===
                      "previousCommentButton")
                ) {
                  console.log(
                    `"이전 댓글" 버튼 발견: ${
                      btn.className || btn.getAttribute("data-uiselector")
                    }`
                  );
                  // 버튼 클릭 여부 확인을 위해 버튼에 표시
                  btn.setAttribute("data-clicked", "true");
                  btn.click();
                  return true;
                }
              }

              // 버튼을 찾지 못한 경우
              console.log("이전 댓글 버튼을 찾지 못했습니다.");
              return false;
            });

            if (prevButtonClicked) {
              prevButtonClickCount++;
              console.log(
                `"이전 댓글" 버튼 클릭 완료 (${prevButtonClickCount}/${MAX_PREV_BUTTON_CLICKS}). 댓글 로드 대기...`
              );
              // 댓글 로드 대기
              await new Promise((resolve) => setTimeout(resolve, 3000));
            }
          }

          // "첫 댓글로" 버튼 클릭 시도
          const firstCommentButtonClicked = await this.page.evaluate(() => {
            const firstButtons = document.querySelectorAll(
              '.goFirstComment, button[data-uiselector="goFirstCommentButton"], button:nth-child(2)'
            );

            for (const btn of firstButtons) {
              if (
                btn.offsetParent !== null &&
                (btn.textContent.includes("첫 댓글로") ||
                  btn.className.includes("goFirstComment") ||
                  btn.getAttribute("data-uiselector") ===
                    "goFirstCommentButton")
              ) {
                console.log(
                  `"첫 댓글로" 버튼 발견: ${
                    btn.className || btn.getAttribute("data-uiselector")
                  }`
                );
                btn.click();
                return true;
              }
            }
            return false;
          });

          if (firstCommentButtonClicked) {
            console.log(`"첫 댓글로" 버튼 클릭 완료. 추가 로드 대기...`);
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
        } else {
          // 댓글이 20개 미만인 경우 기존 방식대로 단일 버튼 클릭
          // "이전 댓글" 버튼 클릭 (한 번만 클릭)
          const prevButtonClicked = await this.page.evaluate(() => {
            // 이전 댓글 버튼 찾기
            const prevButtons = document.querySelectorAll(
              '.prevComment, button[data-uiselector="previousCommentButton"], button'
            );

            for (const btn of prevButtons) {
              if (
                btn.offsetParent !== null &&
                (btn.textContent.includes("이전 댓글") ||
                  btn.textContent.includes("이전댓글") ||
                  btn.className.includes("prevComment"))
              ) {
                console.log(`"이전 댓글" 버튼 발견: ${btn.className}`);
                btn.click();
                return true;
              }
            }
            return false;
          });

          if (prevButtonClicked) {
            console.log(`"이전 댓글" 버튼 클릭 완료. 추가 댓글 로드 대기...`);
            // 이전 댓글 로드 대기
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }

          // "첫 댓글로" 버튼 클릭 시도 (한 번만 시도)
          const firstCommentButtonClicked = await this.page.evaluate(() => {
            const firstButtons = document.querySelectorAll(
              '.goFirstComment, button[data-uiselector="goFirstCommentButton"], button'
            );

            for (const btn of firstButtons) {
              if (
                btn.offsetParent !== null &&
                (btn.textContent.includes("첫 댓글로") ||
                  btn.className.includes("goFirstComment"))
              ) {
                console.log(`"첫 댓글로" 버튼 발견: ${btn.className}`);
                btn.click();
                return true;
              }
            }
            return false;
          });

          if (firstCommentButtonClicked) {
            console.log(`"첫 댓글로" 버튼 클릭 완료. 추가 로드 대기...`);
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
        }

        // "더보기" 버튼 클릭 (한 번만 클릭)
        const moreButtonClicked = await this.page.evaluate(() => {
          const moreButtons = document.querySelectorAll(
            '.viewMoreComments, .cmtMore, .more_comment, [class*="more"], .uiMoreComments, button.moreComment, button[data-uiselector="moreCommentButton"]'
          );

          for (const btn of moreButtons) {
            if (
              btn.offsetParent !== null &&
              (btn.textContent.includes("더보기") ||
                btn.textContent.includes("더 보기") ||
                btn.textContent.includes("더 불러오기") ||
                btn.className.includes("moreComment"))
            ) {
              console.log(
                `"더보기" 버튼 발견: ${
                  btn.className || btn.getAttribute("data-uiselector")
                }`
              );
              btn.click();
              return true;
            }
          }

          // 모든 버튼에서 "더보기" 텍스트 검색
          const allButtons = document.querySelectorAll("button");
          for (const btn of allButtons) {
            if (
              btn.offsetParent !== null &&
              (btn.textContent.includes("더보기") ||
                btn.textContent.includes("더 보기") ||
                btn.textContent.includes("더 불러오기"))
            ) {
              console.log(
                `일반 버튼에서 "더보기" 발견: ${btn.textContent.trim()}`
              );
              btn.click();
              return true;
            }
          }

          return false;
        });

        if (moreButtonClicked) {
          console.log(`"더보기" 버튼 클릭 완료. 추가 댓글 로드 대기...`);
          // this.page.waitForTimeout 대신 일반 Promise 타이머 사용
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }

        // 모든 댓글이 로드되었는지 확인 및 로깅
        const commentsCount = await this.page.evaluate(() => {
          const comments = document.querySelectorAll(".cComment");
          console.log(`발견된 댓글 요소 수: ${comments.length}`);
          return comments.length;
        });

        console.log(
          `모든 댓글이 로드되었습니다. 총 ${commentsCount}개의 댓글이 발견됨.`
        );
        return true;
      } catch (error) {
        console.error(`댓글 로드 중 오류: ${error.message}`);
        return false;
      }
    } catch (error) {
      console.error(`댓글 로드 중 오류: ${error.message}`);
      return false;
    }
  }

  /**
   * 댓글 수집 및 처리
   * @param {Object} postDetail - 게시물 상세 정보
   * @returns {Promise<Object>} - 댓글이 추가된 게시물 상세 정보
   */
  async extractAndProcessComments(postDetail) {
    try {
      // 댓글 요소 찾기
      const comments = await this.page.evaluate(() => {
        // 밴드에서 사용하는 댓글 요소 선택자들
        const commentSelectors = [
          ".cComment", // 기본 댓글 컨테이너
          ".commentItem", // 다른 가능한 댓글 클래스
          ".dPostCommentItem", // 새로운 UI 댓글 아이템
          "[class*='comment'][class*='item']", // 부분 클래스 매칭
          ".dPostCommentMainView .cell_comment", // 새로운 UI
          ".comment_item", // 일반적인 네이밍
          ".commentListItem", // 추가 가능한 선택자
          ".replyItem", // 답글 포함
          ".dPostComment", // 추가 가능한 선택자
          ".replyWrap .reply", // 답글 포함
        ];

        console.log(`댓글 요소 찾기 시작...`);

        // 모든 선택자에 대해 시도
        let commentElements = [];
        for (const selector of commentSelectors) {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            console.log(
              `${selector} 선택자로 ${elements.length}개 댓글 요소 발견`
            );
            commentElements = Array.from(elements);
            break;
          }
        }

        // 선택자로 찾지 못한 경우 fallback - 모든 댓글 컨테이너 시도
        if (commentElements.length === 0) {
          console.log(
            `기본 선택자로 댓글을 찾지 못함, 모든 가능한 요소 검색 중...`
          );

          // 댓글 관련 클래스명을 가진 모든 요소 검색
          const allElements = document.querySelectorAll("*");
          const commentRelatedElements = Array.from(allElements).filter(
            (el) => {
              if (!el.className) return false;

              const className = el.className.toString().toLowerCase();
              return (
                className.includes("comment") ||
                className.includes("reply") ||
                className.includes("cmt") ||
                el.getAttribute("data-viewname")?.includes("Comment")
              );
            }
          );

          console.log(
            `댓글 관련 클래스를 가진 요소: ${commentRelatedElements.length}개`
          );

          // 댓글 내용을 포함할 가능성이 있는 요소만 필터링
          for (const el of commentRelatedElements) {
            // 이미 댓글 목록에 있는 요소의 자식은 제외
            if (commentElements.some((existing) => existing.contains(el))) {
              continue;
            }

            // 텍스트 내용이 있고 너무 짧지 않은 요소만 포함
            const textContent = el.textContent?.trim();
            if (textContent && textContent.length > 5) {
              commentElements.push(el);
            }
          }
        }

        console.log(`댓글 후보 요소 수: ${commentElements.length}`);

        // 댓글 고유성 확보를 위한 Map 사용
        const uniqueComments = new Map();

        // 댓글 추출 로직 강화
        commentElements.forEach((element, idx) => {
          // 작성자 선택자 다양화
          const nameSelectors = [
            ".writeInfo .nameWrap strong.name",
            ".writeInfo strong.name",
            ".writeInfo .name",
            ".userName",
            ".uName",
            ".dAuthorInfo strong",
            "strong.name",
            ".name",
            ".nick",
            ".writer",
            "button[data-uiselector='authorNameButton'] strong.name",
            "[class*='author']",
            "[class*='writer']",
            "[class*='name']",
          ];

          // 내용 선택자 다양화
          const contentSelectors = [
            ".txt._commentContent",
            ".commentText",
            ".txt",
            "p.txt",
            ".comment_text",
            ".dPostCommentContent",
            "[class*='content']",
            "[class*='text']",
            ".message",
            "p",
          ];

          // 시간 선택자 다양화
          const timeSelectors = [
            ".func .time",
            ".date",
            ".time",
            "time.time",
            ".commentTime",
            ".timestamp",
            "[class*='time']",
            "[class*='date']",
          ];

          // 작성자 찾기
          let name = "";
          for (const selector of nameSelectors) {
            const el = element.querySelector(selector);
            if (el) {
              name = el.textContent.trim();
              break;
            }
          }

          // 내용 찾기
          let content = "";
          for (const selector of contentSelectors) {
            const el = element.querySelector(selector);
            if (el) {
              content = el.textContent.trim();
              if (content.length > 0) break;
            }
          }

          // 시간 찾기
          let time = "";
          for (const selector of timeSelectors) {
            const el = element.querySelector(selector);
            if (el) {
              time = el.getAttribute("title") || el.textContent.trim();
              break;
            }
          }

          // 작성자나 내용이 추출되지 않았을 경우 엘리먼트 자체 텍스트 확인
          if (!name || !content) {
            const elementText = element.textContent.trim();

            // 텍스트에서 작성자와 내용 추정 시도
            if (elementText.length > 0) {
              // 엘리먼트의 첫 줄을 작성자로, 나머지를 내용으로 추정
              const lines = elementText
                .split("\n")
                .filter((line) => line.trim().length > 0);

              if (lines.length >= 2) {
                if (!name) name = lines[0].trim();
                if (!content) content = lines.slice(1).join(" ").trim();
              } else if (lines.length === 1) {
                // 한 줄만 있으면 내용으로 사용
                if (!content) content = lines[0].trim();
                if (!name) name = "익명";
              }
            }
          }

          // 내용과 작성자가 있는 경우만 유효한 댓글로 간주
          if (content) {
            // 이름이 없으면 익명으로 처리
            if (!name) name = "익명";

            // 댓글 고유 키 생성 (작성자 + 내용 + 시간)
            const commentKey = `${name}|${content}|${time}`;

            // 중복되지 않은 댓글만 추가
            if (!uniqueComments.has(commentKey)) {
              uniqueComments.set(commentKey, {
                name,
                content,
                time,
              });

              // 로깅 (처음 10개 댓글)
              if (uniqueComments.size <= 10) {
                console.log(
                  `댓글 ${
                    uniqueComments.size
                  } 추출: ${name}, "${content.substring(0, 30)}..."`
                );
              }
            }
          }
        });

        console.log(`총 ${uniqueComments.size}개의 고유한 댓글 추출 완료`);
        return Array.from(uniqueComments.values());
      });

      console.log(
        `게시물 ID ${postDetail.postId} - 댓글 수: ${comments.length} (중복 제거 후)`
      );

      return {
        ...postDetail,
        comments,
      };
    } catch (error) {
      logger.error(`댓글 추출 중 오류 발생: ${error.message}`);
      throw error;
    }
  }

  /**
   * 특정 게시물의 댓글만 크롤링
   * @param {string} naverId - 네이버 ID
   * @param {string} naverPassword - 네이버 비밀번호
   * @param {string} postId - 게시물 ID
   * @returns {Promise<Object>} - 크롤링 결과
   */
  async crawlPostComments(naverId, naverPassword, postId) {
    try {
      logger.info(`게시물 ${postId} 댓글 크롤링 시작`);

      // 밴드 페이지 접속
      await this.accessBandPage(naverId, naverPassword);

      // 게시물 페이지로 이동
      const postUrl = `https://band.us/band/${this.bandNumber}/post/${postId}`;
      logger.info(`게시물 페이지로 이동: ${postUrl}`);

      // 페이지 이동 시도
      try {
        await this.page.goto(postUrl, {
          waitUntil: "domcontentloaded",
          timeout: 10000,
        });

        logger.info("페이지 기본 로딩 완료");

        // 삭제된 게시물 확인 (더 빠른 감지를 위해 waitForFunction 사용)
        try {
          await this.page.waitForFunction(
            () => {
              const blockKeywords = [
                "삭제되었거나",
                "찾을 수 없습니다.",
                "삭제된 게시글",
                "존재하지 않는 게시글",
                "권한이 없습니다",
                "접근할 수 없습니다",
                "찾을 수 없는 페이지",
              ];
              return blockKeywords.some((keyword) =>
                document.body.innerText.includes(keyword)
              );
            },
            { timeout: 3000 } // 3초 안에 삭제 메시지가 나타나는지 확인
          );

          // 삭제된 게시물이 감지됨
          logger.info(
            `게시물 ${postId}가 삭제되었거나 접근할 수 없습니다. 다음 게시물로 넘어갑니다.`
          );
          return {
            success: true,
            data: {
              postId,
              status: "deleted",
              message: "게시물이 삭제되었거나 접근할 수 없습니다",
            },
          };
        } catch (timeoutError) {
          // 삭제 메시지가 나타나지 않음 = 정상 게시물
          logger.info("게시물이 정상적으로 존재합니다.");
        }

        // 게시물 컨텐츠가 로드될 때까지 대기
        await this.page.waitForFunction(
          () => {
            const postWrap = document.querySelector(".postWrap");
            const postMain = document.querySelector(".postMain");
            const postText = document.querySelector(".postText");
            const txtBody = document.querySelector(".txtBody");
            return postWrap || postMain || postText || txtBody;
          },
          { timeout: 10000 }
        );

        logger.info("게시물 컨텐츠 로딩 완료");

        // 추가 대기 시간
        await this.waitForTimeout(1000);
      } catch (navigationError) {
        logger.error(`페이지 로딩 중 오류 발생: ${navigationError.message}`);
        return {
          success: true,
          data: {
            postId,
            status: "error",
            message: navigationError.message,
          },
        };
      }

      // 게시물 상세 정보 추출
      const postDetail = await this.extractPostDetailFromPage();

      if (!postDetail) {
        return {
          success: true,
          data: {
            postId,
            status: "no_content",
            message: "게시물 정보를 추출할 수 없습니다",
          },
        };
      }

      // 댓글 추출 및 처리
      const enrichedPostDetail = await this.extractAndProcessComments(
        postDetail
      );

      logger.info(
        `게시물 ${postId}에서 ${enrichedPostDetail.comments.length}개 댓글 추출 완료`
      );

      return {
        success: true,
        data: {
          ...enrichedPostDetail,
          status: "success",
        },
      };
    } catch (error) {
      logger.error(`게시물 댓글 크롤링 오류: ${error.message}`);
      return {
        success: true,
        data: {
          postId,
          status: "error",
          message: error.message,
        },
      };
    }
  }

  /**
   * 댓글 데이터를 Supabase에 저장
   * @param {Object} postDetail - 댓글이 포함된 게시물 정보
   * @param {boolean} shouldSaveImmediately - 즉시 저장 여부, false인 경우 댓글을 수집만 함
   * @returns {Promise<Object>} - 저장 결과
   */
  async saveCommentsToSupabase(postDetail, shouldSaveImmediately = true) {
    try {
      logger.info(`게시물 ${postDetail.postId}의 댓글을 처리합니다`);

      // 사용자 ID 가져오기
      const userId = await this.getOrCreateUserIdForBand();

      // 게시물 가격 추출
      const extractedPrice = extractPriceFromContent(
        postDetail.postContent || ""
      );

      // 댓글이 없으면 종료
      if (!postDetail.comments || postDetail.comments.length === 0) {
        logger.info("저장할 댓글이 없습니다");
        return { success: true, message: "저장할 댓글이 없습니다" };
      }

      // 댓글에 마감/종료 키워드가 있는지 확인
      let hasClosingKeyword = false;
      for (const comment of postDetail.comments) {
        if (hasClosingKeywords(comment.content)) {
          hasClosingKeyword = true;
          logger.info(
            `게시물 ${postDetail.postId}에서 마감 키워드가 발견되었습니다: "${comment.content}"`
          );
          break;
        }
      }

      // 마감 키워드가 있으면 상품 상태 업데이트
      if (hasClosingKeyword) {
        try {
          logger.info(
            `게시물 ${postDetail.postId}의 상태를 '마감'으로 업데이트합니다.`
          );

          // 상품 테이블 업데이트
          await this.supabase
            .from("products")
            .update({
              status: "마감",
              updated_at: new Date().toISOString(),
            })
            .eq("post_number", postDetail.postId);

          // 게시글 테이블 업데이트
          await this.supabase
            .from("posts")
            .update({
              status: "마감",
              updated_at: new Date().toISOString(),
            })
            .eq("post_number", postDetail.postId);

          logger.info(
            `게시물 ${postDetail.postId}의 상태가 '마감'으로 업데이트되었습니다.`
          );
        } catch (error) {
          logger.error(`상태 업데이트 오류: ${error.message}`);
        }
      }

      // 중복 방지를 위한 댓글 내용-시간 매핑
      const commentContentTimeMap = new Map();
      const orderIdMap = new Map();

      // 주문 데이터 준비
      const ordersToInsert = [];

      for (let index = 0; index < postDetail.comments.length; index++) {
        const comment = postDetail.comments[index];

        // 댓글 내용과 시간을 조합한 키 생성
        const commentKey = `${comment.content}_${
          comment.commentTime || comment.commentTimeTitle || comment.time
        }`;

        // 고유 ID 생성
        const bandCommentId = `${postDetail.postId}_comment_${index}`;

        // 이미 전역적으로 처리된 댓글인지 확인
        if (this.processedCommentIds.has(bandCommentId)) {
          logger.info(`이미 처리된 댓글 ID: ${bandCommentId}, 스킵합니다.`);
          continue;
        }

        // 이미 처리된 댓글인지 확인
        if (commentContentTimeMap.has(commentKey)) {
          logger.info(
            `중복 댓글 감지: "${comment.content.substring(
              0,
              20
            )}...", 스킵합니다.`
          );
          continue;
        }
        commentContentTimeMap.set(commentKey, true);

        // 전역 처리 목록에 추가
        this.processedCommentIds.add(bandCommentId);

        // 수량 추출
        const quantityInfo = extractQuantityFromComment(comment.content);
        const { quantity, unit } = quantityInfo;

        // 시간 변환
        const orderTime = safeParseDate(
          comment.commentTime || comment.commentTimeTitle || comment.time
        );

        const orderId = `${this.bandNumber}_${
          postDetail.postId
        }_${orderTime.getTime()}`;

        // 중복 주문 ID 확인
        if (orderIdMap.has(orderId) || orderIdMap.has(bandCommentId)) {
          logger.info(`중복 주문 ID 감지: ${orderId}, 스킵합니다.`);
          continue;
        }
        orderIdMap.set(orderId, true);
        orderIdMap.set(bandCommentId, true);

        // 상품 정보 조회 시도
        let productData = null;
        let productPrice = extractedPrice;
        let priceOptions = [];

        try {
          // 상품 정보 조회
          const { data: product, error: productError } = await this.supabase
            .from("products")
            .select("*")
            .eq("post_number", postDetail.postId)
            .single();

          if (!productError && product) {
            productData = product;
            productPrice = product.base_price || extractedPrice;

            // 가격 옵션 파싱
            if (product.price_options) {
              try {
                priceOptions =
                  typeof product.price_options === "string"
                    ? JSON.parse(product.price_options)
                    : product.price_options;
              } catch (e) {
                logger.error(`가격 옵션 파싱 오류: ${e.message}`);
              }
            }
          }
        } catch (err) {
          logger.error(`상품 정보 조회 중 오류: ${err.message}`);
        }

        // 단위에 따른 가격 계산
        let finalPrice = productPrice;
        let totalAmount = productPrice * quantity;
        let priceOptionUsed = "기본가";

        // "줄" 단위 처리
        if (
          unit === "줄" ||
          unit.includes("줄") ||
          unit.includes("line") ||
          unit.includes("라인")
        ) {
          logger.info(`줄 단위 주문 감지: ${comment.content}`);

          if (Array.isArray(priceOptions) && priceOptions.length > 0) {
            // 줄 단위 옵션 찾기
            const lineOption = priceOptions.find(
              (opt) =>
                opt.description &&
                (opt.description.includes("줄") ||
                  opt.description.includes("line") ||
                  opt.description.includes("라인"))
            );

            if (lineOption) {
              finalPrice = lineOption.price;
              totalAmount = lineOption.price * quantity;
              priceOptionUsed = `${
                lineOption.description || "줄"
              } x ${quantity}`;
              logger.info(
                `줄 단위 가격 적용: ${lineOption.price} x ${quantity} = ${totalAmount}`
              );
            }
          }
        } else if (Array.isArray(priceOptions) && priceOptions.length > 0) {
          // 다른 단위 처리
          const matchingOption = priceOptions.find(
            (opt) =>
              opt.quantity === quantity ||
              (opt.description &&
                opt.description.includes(`${quantity}${unit}`))
          );

          if (matchingOption) {
            finalPrice = matchingOption.price;
            totalAmount = matchingOption.price;
            priceOptionUsed =
              matchingOption.description || `${quantity}${unit}`;
            logger.info(`매칭 옵션 가격 적용: ${matchingOption.price}`);
          } else {
            // 기본 가격 사용
            totalAmount = productPrice * quantity;
            priceOptionUsed = `${unit || "개"} x ${quantity}`;
            logger.info(
              `기본 가격 적용: ${productPrice} x ${quantity} = ${totalAmount}`
            );
          }
        }

        // 주문 데이터 생성
        const orderData = {
          order_id: orderId,
          user_id: userId,
          product_id: productData ? productData.product_id : postDetail.postId,
          band_number: this.bandNumber,
          post_number: postDetail.postId,
          customer_name: comment.name || "익명",
          quantity: quantity,
          price: finalPrice,
          total_amount: totalAmount,
          comment: comment.content || "",
          status: "ordered",
          ordered_at: orderTime.toISOString(),
          band_comment_id: bandCommentId,
          band_comment_url: `https://band.us/band/${this.bandNumber}/post/${postDetail.postId}#comment`,
          price_option_used: priceOptionUsed,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        ordersToInsert.push(orderData);

        // 전역 주문 저장소에 추가
        this.allOrdersToSave.push(orderData);

        // 고객 정보 수집
        const customerName = comment.name || "익명";
        const customerId = `${this.bandNumber}_customer_${customerName.replace(
          /\s+/g,
          "_"
        )}`;

        // 고객 정보가 없으면 추가
        if (!this.allCustomersToSave.has(customerId)) {
          this.allCustomersToSave.set(customerId, {
            customer_id: customerId,
            user_id: userId,
            name: customerName,
            band_user_id: customerName.replace(/\s+/g, "_"),
            band_number: this.bandNumber,
            total_orders: 1,
            first_order_at: new Date().toISOString(),
            last_order_at: new Date().toISOString(),
          });
        }
      }

      // 게시물 댓글 수 업데이트
      await this.supabase
        .from("products")
        .update({
          comment_count: postDetail.comments.length,
          updated_at: new Date().toISOString(),
        })
        .eq("post_number", postDetail.postId);

      // 이번 게시물에서 추가된 주문 수
      const addedOrdersCount = ordersToInsert.length;

      // 즉시 저장 모드가 아니면 주문 데이터만 누적하고 반환
      if (!shouldSaveImmediately) {
        logger.info(
          `${addedOrdersCount}개 댓글 처리 완료, 데이터 수집 모드로 작동 중`
        );
        return {
          success: true,
          count: addedOrdersCount,
          message: `${addedOrdersCount}개의 댓글이 처리되었습니다 (저장 대기 중)`,
          totalCollected: this.allOrdersToSave.length,
        };
      }

      // 여기서부터는 즉시 저장 모드일 때 실행됨

      // 중복 주문 제거 (최종 저장 전)
      const uniqueOrders = [];
      const seenOrderIds = new Set();

      for (const order of this.allOrdersToSave) {
        if (!seenOrderIds.has(order.band_comment_id)) {
          seenOrderIds.add(order.band_comment_id);
          uniqueOrders.push(order);
        } else {
          logger.info(
            `중복 주문 제거: ${order.band_comment_id}, 고객명: ${order.customer_name}`
          );
        }
      }

      logger.info(
        `중복 제거 후 주문 수: ${uniqueOrders.length}/${this.allOrdersToSave.length}`
      );

      // 고객 정보를 배열로 변환
      const customersToInsert = Array.from(this.allCustomersToSave.values());

      // Supabase에 저장
      const { data, error } = await this.supabase
        .from("orders")
        .upsert(uniqueOrders, {
          onConflict: "band_comment_id",
          ignoreDuplicates: false,
        });

      if (error) {
        throw error;
      }

      // 고객 정보 저장 (있는 경우)
      if (customersToInsert.length > 0) {
        try {
          logger.info(
            `${customersToInsert.length}개의 고객 정보를 저장합니다.`
          );
          const { error: customerError } = await this.supabase
            .from("customers")
            .upsert(customersToInsert, {
              onConflict: "customer_id",
              ignoreDuplicates: true,
            });

          if (customerError) {
            logger.error(`고객 정보 저장 중 오류: ${customerError.message}`);
          } else {
            logger.info(`${customersToInsert.length}개의 고객 정보 저장 완료`);
          }
        } catch (custError) {
          logger.error(`고객 정보 저장 중 예외 발생: ${custError.message}`);
          // 고객 정보 저장 실패는 크리티컬 오류가 아니므로 진행
        }
      }

      // 저장 후 전역 저장소 초기화
      this.allOrdersToSave = [];
      this.allCustomersToSave = new Map();
      this.processedCommentIds = new Set();

      logger.info(`${uniqueOrders.length}개의 댓글이 주문으로 저장되었습니다`);

      return {
        success: true,
        count: uniqueOrders.length,
        message: `${uniqueOrders.length}개의 댓글이 주문으로 저장되었습니다`,
      };
    } catch (error) {
      logger.error(`댓글 저장 오류: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 수집된 모든 댓글을 최종 저장
   * @returns {Promise<Object>} - 저장 결과
   */
  async saveAllCollectedComments() {
    try {
      logger.info(`전역 저장소에 수집된 모든 댓글을 저장합니다...`);

      if (this.allOrdersToSave.length === 0) {
        logger.info("저장할 댓글이 없습니다");
        return { success: true, message: "저장할 댓글이 없습니다" };
      }

      // 강제로 즉시 저장 모드로 설정하여 saveCommentsToSupabase 호출
      return await this.saveCommentsToSupabase(
        { postId: "final-save", comments: [] },
        true
      );
    } catch (error) {
      logger.error(`모든 댓글 저장 오류: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async extractPostDetailFromPage() {
    try {
      console.log(`게시물 상세 정보 추출 시작...`);

      // 삭제되었거나 접근이 차단된 게시물인지 확인
      const isBlocked = await this.page.evaluate(() => {
        const blockKeywords = [
          "삭제되었거나",
          "찾을 수 없습니다.",
          "삭제된 게시글",
          "존재하지 않는 게시글",
          "권한이 없습니다",
          "접근할 수 없습니다",
          "찾을 수 없는 페이지",
        ];
        return blockKeywords.some((keyword) =>
          document.body.innerText.includes(keyword)
        );
      });

      if (isBlocked) {
        console.warn("삭제되었거나 접근이 차단된 게시물");
        return null;
      }

      // 게시물 요소가 로드될 때까지 대기
      await this.page.waitForSelector(
        ".postWrap, .postMain, .postText, .txtBody",
        {
          visible: true,
          timeout: 5000,
        }
      );

      // 게시물 기본 정보 추출
      const currentUrl = await this.page.url();
      const postIdMatch = currentUrl.match(/\/post\/(\d+)/);
      const postId = postIdMatch?.[1] || `unknown_${Date.now()}`;

      // 페이지 콘텐츠를 기반으로 게시물 상세 정보 추출
      const postDetail = await this.page.evaluate(() => {
        // 게시물 작성자
        const authorName =
          document
            .querySelector(".postWriterInfoWrap .text")
            ?.textContent?.trim() ||
          document.querySelector(".uName")?.textContent?.trim() ||
          "";

        // 게시물 제목 (작성자명을 제목으로 사용)
        const postTitle = authorName;

        // 게시물 내용
        const postContent =
          document.querySelector(".postText .txtBody")?.textContent?.trim() ||
          document.querySelector(".txtBody")?.textContent?.trim() ||
          "";

        // 게시물 작성 시간
        const postTime =
          document
            .querySelector(".postListInfoWrap .time")
            ?.textContent?.trim() ||
          document.querySelector(".time")?.textContent?.trim() ||
          "";

        // 조회수
        const readCountText =
          document.querySelector("._postReaders strong")?.textContent?.trim() ||
          "0";
        const readCount = parseInt(readCountText.match(/\d+/)?.[0] || "0", 10);

        // 이미지 URL 추출
        const imageUrls = [];
        document.querySelectorAll(".imageListInner img").forEach((img) => {
          const src = img.getAttribute("src");
          if (src) imageUrls.push(src);
        });

        return {
          postTitle,
          postContent,
          postTime,
          authorName,
          readCount,
          imageUrls,
        };
      });

      // 댓글 추출 - 성공한 방식으로 개선
      console.log(`댓글 추출 시작...`);
      const comments = await this.page.evaluate(() => {
        const results = [];

        // 댓글 항목 선택자
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

      // 중복 제거: 같은 작성자, 내용을 가진 댓글만 하나로 유지
      const uniqueComments = [];
      const seen = new Set();

      for (const comment of comments) {
        const key = `${comment.author}|${comment.content}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueComments.push(comment);
        }
      }

      // 최종 결과 조합
      const result = {
        postId,
        bandNumber: this.bandNumber,
        ...postDetail,
        commentCount: uniqueComments.length,
        comments: uniqueComments,
        crawledAt: new Date().toISOString(),
      };

      console.log(
        `게시물 상세 정보 추출 완료: 제목="${result.postTitle}", 댓글 ${result.commentCount}개`
      );
      return result;
    } catch (error) {
      console.error(`게시물 상세 정보 추출 중 오류: ${error.message}`);
      return null;
    }
  }
}

module.exports = BandComments;
