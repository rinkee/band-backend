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
  /**
   * 모든 댓글 로드
   * @returns {Promise<boolean>} - 성공 여부
   */
  async loadAllComments() {
    try {
      this.updateTaskStatus("processing", "모든 댓글 로드 중", 60);

      // 크롤링 시작 시간
      const startTime = Date.now();
      // 최대 실행 시간 (10분)
      const MAX_EXECUTION_TIME = 10 * 60 * 1000;

      // 댓글이 있는지 확인
      const hasComments = await this.page.evaluate(() => {
        const commentElement =
          document.querySelector(".commentBox") ||
          document.querySelector(".cmt_area") ||
          document.querySelector("[class*='comment']");
        return !!commentElement;
      });

      if (!hasComments) {
        this.updateTaskStatus(
          "processing",
          "댓글이 없거나 댓글 영역을 찾을 수 없습니다",
          65
        );
        return false;
      }

      // 댓글 더보기 버튼 클릭 (다양한 선택자 시도)
      const commentSelectors = [
        ".viewMoreComments",
        ".cmtMore",
        ".more_comment",
        ".btn_cmt_more",
        "a[class*='more']",
        "button[class*='more']",
        "a[class*='comment']",
        "button[class*='comment']",
        "[class*='comment'][class*='more']",
      ];

      let totalComments = 0;
      let prevCommentCount = -1;
      let attemptCount = 0;
      const MAX_ATTEMPTS = 30; // 최대 시도 횟수
      const MAX_NO_CHANGE_ATTEMPTS = 5; // 변화 없는 최대 시도 횟수
      let noChangeCount = 0;

      // 댓글이 더 이상 로드되지 않을 때까지 더보기 버튼 클릭
      while (attemptCount < MAX_ATTEMPTS) {
        // 실행 시간 체크 - 최대 실행 시간을 초과하면 종료
        const currentTime = Date.now();
        if (currentTime - startTime > MAX_EXECUTION_TIME) {
          this.updateTaskStatus(
            "processing",
            `최대 실행 시간(10분)이 경과하여 댓글 로드를 중단합니다. 현재 ${prevCommentCount}개 로드됨.`,
            75
          );
          break;
        }

        try {
          // 현재 댓글 수 확인
          const currentCommentCount = await this.page.evaluate(() => {
            const comments = document.querySelectorAll(
              '.comment, .cmt_item, [class*="comment-item"]'
            );
            return comments.length;
          });

          this.updateTaskStatus(
            "processing",
            `현재 로드된 댓글 수: ${currentCommentCount}`,
            65
          );

          // 댓글 수가 변하지 않으면 카운터 증가
          if (currentCommentCount === prevCommentCount) {
            noChangeCount++;
            // 여러 번 시도해도 댓글 수가 변하지 않으면 더 이상 댓글이 없다고 판단
            if (noChangeCount >= MAX_NO_CHANGE_ATTEMPTS) {
              this.updateTaskStatus(
                "processing",
                "더 이상 댓글을 로드할 수 없습니다",
                75
              );
              break;
            }
          } else {
            // 댓글 수가 변했다면 카운터 초기화
            noChangeCount = 0;
            prevCommentCount = currentCommentCount;
          }

          // 더보기 버튼 찾기 및 클릭 시도
          let buttonClicked = false;

          for (const selector of commentSelectors) {
            try {
              const isVisible = await this.page.evaluate((sel) => {
                const btn = document.querySelector(sel);
                if (!btn) return false;

                const rect = btn.getBoundingClientRect();
                return (
                  rect.width > 0 &&
                  rect.height > 0 &&
                  window.getComputedStyle(btn).display !== "none" &&
                  window.getComputedStyle(btn).visibility !== "hidden"
                );
              }, selector);

              if (isVisible) {
                // 버튼이 보이면 클릭
                await this.page.click(selector).catch(() => {});
                buttonClicked = true;

                // 클릭 후 데이터 로드 대기
                await this.page.waitForTimeout(1000);

                // 스크롤을 조금 내려 댓글 영역이 보이도록 함
                await this.page.evaluate(() => {
                  const commentArea =
                    document.querySelector(".commentBox") ||
                    document.querySelector(".cmt_area") ||
                    document.querySelector("[class*='comment']");
                  if (commentArea) {
                    commentArea.scrollIntoView({
                      behavior: "smooth",
                      block: "center",
                    });
                  }
                });

                // 네트워크 요청 완료 대기
                await this.page.waitForTimeout(500);
                break;
              }
            } catch (btnError) {
              // 이 선택자에 대한 오류는 무시하고 다음 선택자 시도
              continue;
            }
          }

          // 더 이상 더보기 버튼이 없으면 완료
          if (!buttonClicked) {
            this.updateTaskStatus(
              "processing",
              "더 이상 더보기 버튼이 없습니다",
              75
            );
            break;
          }

          attemptCount++;
        } catch (loopError) {
          this.updateTaskStatus(
            "processing",
            `댓글 로드 중 오류 발생: ${loopError.message}`,
            70
          );
          attemptCount++;
          // 오류가 발생해도 계속 시도
          await this.page.waitForTimeout(1000);
        }
      }

      // 최종 댓글 수 확인
      totalComments = await this.page.evaluate(() => {
        const comments = document.querySelectorAll(
          '.comment, .cmt_item, [class*="comment-item"]'
        );
        return comments.length;
      });

      this.updateTaskStatus(
        "processing",
        `총 ${totalComments}개의 댓글을 로드했습니다`,
        80
      );
      return true;
    } catch (error) {
      this.updateTaskStatus(
        "processing",
        `댓글 로드 중 오류 발생: ${error.message}`,
        60
      );
      logger.error(`댓글 로드 오류: ${error.message}`);
      // 오류가 발생해도 프로세스 계속 진행
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
      // 댓글 영역 로드
      await this.loadAllComments();

      // 댓글 추출
      const comments = await this.page.evaluate(() => {
        const commentElements = document.querySelectorAll(".cComment");
        const extractedComments = [];

        console.log(`브라우저에서 발견된 댓글 수: ${commentElements.length}`);

        commentElements.forEach((comment, idx) => {
          try {
            // 작성자 찾기 - 여러 가능한 선택자 시도
            let author = "";
            const authorElement =
              comment.querySelector(".writeInfo .name") ||
              comment.querySelector(".writeInfo strong.name") ||
              comment.querySelector(".userName") ||
              comment.querySelector(".uName") ||
              comment.querySelector(".dAuthorInfo strong");

            if (authorElement) {
              author = authorElement.textContent.trim();
            }

            // 내용 찾기
            let content = "";
            const contentElement =
              comment.querySelector(".txt._commentContent") ||
              comment.querySelector(".commentText") ||
              comment.querySelector(".txt") ||
              comment.querySelector("p.txt");

            if (contentElement) {
              content = contentElement.textContent.trim();
            }

            // 시간 찾기
            let time = "";
            const timeElement =
              comment.querySelector(".func .time") ||
              comment.querySelector(".date") ||
              comment.querySelector(".time");

            if (timeElement) {
              // title 속성에서 정확한 날짜 가져오기
              time =
                timeElement.getAttribute("title") ||
                timeElement.textContent.trim();
            }

            // 유효한 내용이 있을 때만 추가
            if (content) {
              extractedComments.push({
                author: author || "작성자 미상",
                content,
                time: time || new Date().toISOString(),
              });
            }
          } catch (err) {
            console.error(`${idx}번째 댓글 추출 중 오류:`, err.message);
          }
        });

        return extractedComments;
      });

      // 댓글 정보 로깅
      logger.info(`총 ${comments.length}개의 댓글을 추출했습니다`);

      // 댓글 데이터 가공 및 반환
      if (comments.length > 0) {
        const processedComments = comments.map((comment, index) => {
          return {
            index,
            name: comment.author,
            content: comment.content,
            commentTime: comment.time,
            commentTimeTitle: comment.time,
            isManager: false,
            profileImageUrl: "",
            isSecret: false,
          };
        });

        // 게시물 객체에 댓글 추가
        postDetail.comments = processedComments;
        postDetail.commentCount = processedComments.length;
      }

      return postDetail;
    } catch (error) {
      logger.error(`댓글 추출 및 처리 중 오류: ${error.message}`);
      // 오류가 있어도 원본 게시물 정보 반환
      return postDetail;
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
      const postUrl = `https://band.us/band/${this.bandId}/post/${postId}`;
      logger.info(`게시물 페이지로 이동: ${postUrl}`);

      await this.page.goto(postUrl, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      // 게시물 상세 정보 추출
      const postDetail = await this.extractPostDetailFromPage();

      if (!postDetail) {
        throw new Error("게시물 정보를 추출할 수 없습니다");
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
        data: enrichedPostDetail,
      };
    } catch (error) {
      logger.error(`게시물 댓글 크롤링 오류: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 댓글 데이터를 Supabase에 저장
   * @param {Object} postDetail - 댓글이 포함된 게시물 정보
   * @returns {Promise<Object>} - 저장 결과
   */
  async saveCommentsToSupabase(postDetail) {
    try {
      logger.info(`게시물 ${postDetail.postId}의 댓글을 저장합니다`);

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
            .eq("band_post_id", postDetail.postId);

          // 게시글 테이블 업데이트
          await this.supabase
            .from("posts")
            .update({
              status: "마감",
              updated_at: new Date().toISOString(),
            })
            .eq("band_post_id", postDetail.postId);

          logger.info(
            `게시물 ${postDetail.postId}의 상태가 '마감'으로 업데이트되었습니다.`
          );
        } catch (error) {
          logger.error(`상태 업데이트 오류: ${error.message}`);
        }
      }

      // 주문 데이터 준비
      const ordersToInsert = postDetail.comments.map((comment, index) => {
        // 수량 추출
        const quantity = extractQuantityFromComment(comment.content);

        // 시간 변환
        const orderTime = safeParseDate(
          comment.commentTime || comment.commentTimeTitle
        );

        // 고유 ID 생성
        const bandCommentId = `${postDetail.postId}_comment_${index}`;
        const orderId = `${this.bandId}_${
          postDetail.postId
        }_${orderTime.getTime()}`;

        return {
          user_id: userId,
          product_id: postDetail.postId,
          band_id: this.bandId,
          band_post_id: postDetail.postId,
          customer_name: comment.name || "익명",
          quantity: quantity,
          price: extractedPrice,
          total_amount: extractedPrice * quantity,
          comment: comment.content || "",
          status: "ordered",
          ordered_at: orderTime.toISOString(),
          band_comment_id: bandCommentId,
          band_comment_url: `https://band.us/band/${this.bandId}/post/${postDetail.postId}#comment`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      });

      // 고객 정보 준비
      const customersToInsert = [];
      const seenCustomerIds = new Set();

      // 고객 정보 수집 (중복 제거)
      for (const comment of postDetail.comments) {
        const customerName = comment.name || "익명";
        const customerId = `${this.bandId}_customer_${customerName.replace(
          /\s+/g,
          "_"
        )}`;

        if (!seenCustomerIds.has(customerId)) {
          seenCustomerIds.add(customerId);
          customersToInsert.push({
            customer_id: customerId,
            user_id: userId,
            name: customerName,
            band_user_id: customerName.replace(/\s+/g, "_"),
            band_id: this.bandId,
            total_orders: 1,
            first_order_at: new Date().toISOString(),
            last_order_at: new Date().toISOString(),
          });
        }
      }

      // Supabase에 저장
      const { data, error } = await this.supabase
        .from("orders")
        .upsert(ordersToInsert, {
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

      // 게시물 댓글 수 업데이트
      await this.supabase
        .from("products")
        .update({
          comment_count: postDetail.comments.length,
          updated_at: new Date().toISOString(),
        })
        .eq("band_post_id", postDetail.postId);

      logger.info(
        `${ordersToInsert.length}개의 댓글이 주문으로 저장되었습니다`
      );

      return {
        success: true,
        count: ordersToInsert.length,
        message: `${ordersToInsert.length}개의 댓글이 주문으로 저장되었습니다`,
      };
    } catch (error) {
      logger.error(`댓글 저장 오류: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = BandComments;
