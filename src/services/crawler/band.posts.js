// src/services/crawler/band.posts.js
const BandAuth = require("./band.auth");
const {
  safeParseDate,
  extractPriceFromContent,
  generateSimpleId,
} = require("./band.utils");
const logger = require("../../config/logger");
const cheerio = require("cheerio");

/**
 * 밴드 게시물 크롤링 관련 클래스
 */
class BandPosts extends BandAuth {
  /**
   * 생성자
   * @param {string} bandId - 밴드 ID
   * @param {Object} options - 옵션
   */
  constructor(bandId, options = {}) {
    super();
    if (!bandId) {
      throw new Error("밴드 ID는 필수 값입니다.");
    }
    this.bandId = bandId;
    this.allPostUrls = [];
    this.currentPostIndex = 0;
    this.crawlStartTime = 0;

    // 기본 옵션 설정
    this.options = {
      numPostsToLoad: 5,
      ...options,
    };
  }

  /**
   * 게시물 스크롤링
   * @param {number} count - 로드할 게시물 수
   * @returns {Promise<number>} - 로드된 게시물 수
   */
  async scrollToLoadPosts(count) {
    logger.info(`${count}개의 게시물을 로드하기 위해 스크롤링 시작`);

    let loadedPostsCount = 0;
    let lastPostsCount = 0;
    let scrollAttempts = 0;

    // 직접 HTML 구조 검사 및 게시물 카드 디버깅
    await this.page.evaluate(() => {
      const firstCard = document.querySelector(".cCard");
      console.log(
        "첫 번째 카드 HTML:",
        firstCard ? firstCard.outerHTML.substring(0, 500) : "없음"
      );

      // 모든 a 태그 링크 출력
      if (firstCard) {
        const links = firstCard.querySelectorAll("a");
        console.log(`첫 번째 카드 내 링크 수: ${links.length}`);
        links.forEach((link, i) => {
          console.log(`링크 ${i + 1}: ${link.href}, 클래스: ${link.className}`);
        });
      }
    });

    while (loadedPostsCount < count && scrollAttempts < 20) {
      // 현재 로드된 게시물 수 확인
      loadedPostsCount = await this.page.evaluate(() => {
        return document.querySelectorAll(".cCard").length;
      });

      logger.info(`현재 로드된 게시물 수: ${loadedPostsCount}/${count}`);

      // 목표에 도달했으면 종료
      if (loadedPostsCount >= count) {
        break;
      }

      // 이전 로드 수와 같다면 스크롤 시도 횟수 증가
      if (loadedPostsCount === lastPostsCount) {
        scrollAttempts++;

        // 여러 번 시도해도 로드되지 않으면 현재 게시물만 처리하고 진행
        if (scrollAttempts >= 5 && loadedPostsCount > 0) {
          logger.warn(
            `${scrollAttempts}회 시도 후에도 더 많은 게시물이 로드되지 않아 진행합니다.`
          );
          break;
        }
      } else {
        // 새로운 게시물이 로드되었으면 시도 횟수 초기화
        scrollAttempts = 0;
        lastPostsCount = loadedPostsCount;
      }

      // 페이지 맨 아래로 스크롤
      await this.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      // 새 게시물 로드 대기
      await new Promise((r) => setTimeout(r, 2000));
    }

    // 브라우저 개발자 도구에서의 디버깅을 위한 코드 추가
    await this.page.evaluate(() => {
      console.log("===== 게시물 URL 추출 디버깅 정보 =====");
      // 모든 카드 요소 순회
      const cards = document.querySelectorAll(".cCard");
      console.log(`총 ${cards.length}개 카드 발견`);

      cards.forEach((card, i) => {
        console.log(`카드 ${i + 1} 정보:`);

        // 데이터 속성 확인
        const postId = card.getAttribute("data-post-id");
        const href = card.getAttribute("data-href");
        console.log(`- data-post-id: ${postId || "없음"}`);
        console.log(`- data-href: ${href || "없음"}`);

        // 카드 내 모든 링크 확인
        const links = card.querySelectorAll("a");
        console.log(`- 링크 수: ${links.length}`);
        links.forEach((link, j) => {
          console.log(
            `  링크 ${j + 1}: ${link.href}, 텍스트: ${link.innerText.substring(
              0,
              20
            )}`
          );
        });

        // 클릭 이벤트 핸들러 확인
        console.log(`- 클릭 가능: ${card.onclick ? "예" : "아니오"}`);
      });
    });

    logger.info(`스크롤링 완료: ${loadedPostsCount}개 게시물 로드됨`);
    return loadedPostsCount;
  }

  /**
   * 게시물 상세 정보 추출
   * @returns {Promise<Object|null>} - 게시물 상세 정보
   */
  async extractPostDetailFromPage() {
    try {
      logger.info("게시물 상세 정보 추출 시작");

      try {
        await Promise.race([
          this.page.waitForSelector(".postWrap", {
            visible: true,
            timeout: 15000,
          }),
          this.page.waitForSelector(".postMain", {
            visible: true,
            timeout: 15000,
          }),
          this.page.waitForSelector(".postText", {
            visible: true,
            timeout: 15000,
          }),
          this.page.waitForSelector(".dPostCommentMainView", {
            visible: true,
            timeout: 15000,
          }),
        ]);
      } catch (waitError) {
        logger.warn(
          `기본 셀렉터 대기 실패: ${waitError.message}, 대체 방법 시도`
        );
        // 더 긴 시간 동안 페이지 로드 완료 대기

        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      // 현재 URL 확인
      const currentUrl = await this.page.url();
      logger.info(`현재 URL: ${currentUrl}`);

      // URL에서 postId와 bandId 추출
      let postId = "unknown";
      let bandId = this.bandId || "";

      const postIdMatch = currentUrl.match(/\/post\/(\d+)/);
      if (postIdMatch && postIdMatch[1]) {
        postId = postIdMatch[1];
      } else {
        // URL에서 추출 실패 시 페이지 내에서 추출 시도
        postId = await this.page.evaluate(() => {
          const metaTag = document.querySelector('meta[property="og:url"]');
          if (metaTag) {
            const url = metaTag.content;
            const match = url.match(/\/post\/(\d+)/);
            return match
              ? match[1]
              : `unknown_${Date.now()}_${Math.random()
                  .toString(36)
                  .substring(2, 8)}`;
          }
          return `unknown_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 8)}`;
        });
      }

      const bandIdMatch = currentUrl.match(/\/band\/([^\/]+)/);
      if (bandIdMatch && bandIdMatch[1]) {
        bandId = bandIdMatch[1];
      }

      logger.info(`추출된 게시물 ID: ${postId}, 밴드 ID: ${bandId}`);

      // Cheerio를 사용하여 HTML 파싱
      const content = await this.page.content();
      const $ = cheerio.load(content);

      // 게시물 제목 추출
      let postTitle = "";
      if ($(".postWriterInfoWrap .text").length > 0) {
        postTitle = $(".postWriterInfoWrap .text").text().trim();
      }

      // 게시물 내용 추출
      let postContent = "";
      if ($(".postText .txtBody").length > 0) {
        postContent = $(".postText .txtBody").text().trim();
      } else if ($(".txtBody").length > 0) {
        postContent = $(".txtBody").text().trim();
      }

      // 게시물 시간 추출
      let postTime = "";
      if ($(".postListInfoWrap .time").length > 0) {
        postTime = $(".postListInfoWrap .time").text().trim();
      }

      // 작성자 이름 추출
      let authorName = "";
      if ($(".postWriterInfoWrap .text").length > 0) {
        authorName = $(".postWriterInfoWrap .text").text().trim();
      }

      // 조회수 추출 (현재 페이지에서는 읽은 사람 수로 대체)
      let readCount = 0;
      if ($("._postReaders strong").length > 0) {
        const readCountText = $("._postReaders strong").text().trim();
        const match = readCountText.match(/\d+/);
        if (match) {
          readCount = parseInt(match[0], 10);
        }
      }

      // 조회수 추출 (현재 페이지에서는 읽은 사람 수로 대체)
      let commentCount = 0;
      if ($(".comment count").length > 0) {
        const readCountText = $(".comment count").text().trim();
        const match = readCountText.match(/\d+/);
        if (match) {
          commentCount = parseInt(match[0], 10);
        }
      }

      // 이미지 URL 추출
      const imageUrls = [];
      $(".imageListInner img").each((i, el) => {
        const src = $(el).attr("src");
        if (src) {
          imageUrls.push(src);
        }
      });

      // 결과 객체 생성 (댓글은 별도 함수에서 처리)
      const postDetail = {
        postId,
        bandId,
        postTitle,
        postContent,
        postTime,
        authorName,
        readCount,
        commentCount: commentCount, // 댓글 수는 나중에 설정
        imageUrls,
        comments: [], // 댓글은 나중에 설정
        crawledAt: new Date().toISOString(),
      };

      logger.info(
        `게시물 정보 추출 완료: ID=${postId}, 제목=${postTitle}, 작성자=${authorName}`
      );
      return postDetail;
    } catch (e) {
      logger.error(`게시물 상세 정보 추출 중 오류 발생: ${e.message}`);
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

      // 현재 밴드에 연결된 userId 찾기 (임시로 생성하거나 기존 유저 조회)
      let userId = await this.getOrCreateUserIdForBand();

      // 상품 데이터 준비
      const products = posts.map((post) => ({
        user_id: userId,
        title: post.postTitle || "제목 없음",
        description: post.postContent || "",
        price: 0,
        original_price: 0,
        status: "판매중",
        band_post_id: post.postId,
        band_post_url: `https://band.us/band/${this.bandId}/post/${post.postId}`,
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

      // Supabase에 상품 저장
      const { data, error } = await this.supabase
        .from("products")
        .upsert(products, {
          onConflict: "band_post_id",
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
  async crawlPostDetail(naverId, naverPassword, maxPosts = 5) {
    try {
      this.crawlStartTime = Date.now();
      logger.info("Band 게시물 상세 정보 크롤링 시작");

      // options.numPostsToLoad 갱신
      if (maxPosts) {
        this.options.numPostsToLoad = maxPosts;
      }

      // 밴드 페이지 접속
      await this.accessBandPage(naverId, naverPassword);

      // 게시물 로드를 위한 스크롤링
      const totalLoadedPosts = await this.scrollToLoadPosts(
        this.options.numPostsToLoad
      );

      if (totalLoadedPosts === 0) {
        logger.warn("로드된 게시물이 없어 크롤링을 중단합니다.");
        return { success: false, error: "로드된 게시물이 없습니다." };
      }

      logger.info(
        `총 ${totalLoadedPosts}개의 게시물이 로드되었습니다. URL 수집 시작...`
      );

      // URL 수집 방식 개선 - 다양한 선택자 시도
      let postUrls = await this.page.evaluate(() => {
        // 모든 가능한 선택자를 시도
        const cardLinks = Array.from(
          document.querySelectorAll('.cCard a[href*="/post/"]')
        )
          .map((a) => a.href)
          .filter((href) => href.includes("/post/"));

        // 대체 선택자 (카드 내부의 모든 링크에서 post를 포함하는 것)
        if (cardLinks.length === 0) {
          const allLinks = Array.from(document.querySelectorAll(".cCard a"))
            .map((a) => a.href)
            .filter((href) => href.includes("/post/"));

          if (allLinks.length > 0) {
            return allLinks;
          }
        }

        // 데이터 속성을 통한 선택
        if (cardLinks.length === 0) {
          return Array.from(document.querySelectorAll(".cCard[data-post-id]"))
            .map((card) => {
              const postId = card.getAttribute("data-post-id");
              const bandId = window.location.pathname.split("/")[2];
              if (postId && bandId) {
                return `https://band.us/band/${bandId}/post/${postId}`;
              }
              return null;
            })
            .filter((url) => url !== null);
        }

        return cardLinks;
      });

      // 중복 URL 제거 및 유효한 URL만 필터링
      postUrls = [...new Set(postUrls)].filter(
        (url) => url && typeof url === "string" && url.includes("/post/")
      );

      logger.info(
        `중복 제거 후 크롤링할 고유 게시물 URL 수: ${postUrls.length}`
      );

      const results = [];

      // 각 URL에 대해 크롤링 시도
      for (
        let i = 0;
        i < Math.min(postUrls.length, this.options.numPostsToLoad);
        i++
      ) {
        const postUrl = postUrls[i];
        logger.info(
          `게시물 URL 처리 중 (${i + 1}/${Math.min(
            postUrls.length,
            this.options.numPostsToLoad
          )}): ${postUrl}`
        );

        // 각 URL 사이에 지연 시간 추가 (2-5초 랜덤)
        if (i > 0) {
          const delay = 2000 + Math.floor(Math.random() * 3000);
          logger.info(`다음 URL 처리 전 ${delay}ms 대기 중...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        try {
          // 재시도 로직 추가
          let success = false;
          let attemptCount = 0;
          const maxAttempts = 3;

          while (!success && attemptCount < maxAttempts) {
            attemptCount++;
            try {
              logger.info(
                `URL 접근 시도 ${attemptCount}/${maxAttempts}: ${postUrl}`
              );

              // 타임아웃 증가 (이미 60초로 설정되어 있음)
              await this.page.goto(postUrl, {
                waitUntil: "networkidle2",
                timeout: 60000,
              });

              // 추가 대기 시간으로 페이지 안정화
              await new Promise((resolve) => setTimeout(resolve, 1500));

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
                throw navError;
              }

              // 실패 시 대기 시간을 점점 늘림 (지수 백오프)
              const waitTime = 3000 * Math.pow(2, attemptCount - 1);
              logger.warn(`URL 접근 실패, ${waitTime}ms 후 재시도...`);
              await new Promise((resolve) => setTimeout(resolve, waitTime));
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
          // 오류로 인한 지연 추가
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }

      logger.info(`총 ${results.length}개 게시물 크롤링 완료`);
      return { success: true, data: results };
    } catch (e) {
      logger.error(`게시물 상세 정보 크롤링 중 오류 발생: ${e.message}`);
      return { success: false, error: e.message };
    }
  }
  /**
   * 게시물 상세 정보 Supabase 저장
   * @param {Array} detailedPosts - 저장할 게시물 목록
   */
  async saveDetailPostsToSupabase(detailedPosts) {
    try {
      this.updateTaskStatus(
        "processing",
        "상품 상세 정보 및 주문 정보 Supabase 저장 중",
        93
      );

      const supabase = require("../../config/supabase").supabase;

      let totalCommentCount = 0;
      let postsWithComments = 0;
      let newOrdersCount = 0;
      let updatedOrdersCount = 0;

      // user_id 가져오기
      const userId = await this.getOrCreateUserIdForBand();

      // 디버깅을 위한 로그 추가
      logger.info(`사용할 user_id: ${userId} (타입: ${typeof userId})`);

      // 전체 데이터 준비
      const productsToInsert = [];
      const postsToInsert = [];
      const ordersToInsert = [];
      const customersToInsert = [];

      // 데이터 변환 (for문 사용)
      for (const post of detailedPosts) {
        if (!post.postId || post.postId === "undefined") {
          post.postId = `unknown_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 9)}`;
          logger.warn(
            `유효하지 않은 postId 감지, 대체 ID 사용: ${post.postId}`
          );
        }

        const { comments = [], ...postData } = post;
        const commentCount = comments.length || 0;

        // 가격 추출 - 게시물 내용에서 가격 추출
        const extractedPrice = extractPriceFromContent(post.postContent || "");

        if (commentCount > 0) {
          postsWithComments++;
          logger.info(
            `상품 ID: ${post.postId} - 주문 ${commentCount}개 저장 준비 중`
          );
        }
        totalCommentCount += commentCount;

        // 상품 정보 준비
        const productData = {
          user_id: userId,
          title: post.postTitle || "제목 없음",
          description: post.postContent || "",
          original_content: post.postContent || "",
          price: extractedPrice,
          original_price: extractedPrice,
          status: "판매중",
          band_post_id: parseInt(post.postId, 10) || 0,
          band_id: parseInt(this.bandId, 10) || 0,
          band_post_url: `https://band.us/band/${this.bandId}/post/${post.postId}`,
          category: "기타",
          tags: [],
          comment_count: commentCount,
          order_summary: {
            total_orders: commentCount,
            pending_orders: commentCount,
            confirmed_orders: 0,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // 상품 데이터 추가
        productsToInsert.push(productData);

        // 게시글 정보 준비
        const postDataToInsert = {
          user_id: userId,
          band_id: parseInt(this.bandId, 10) || 0,
          band_post_id: parseInt(post.postId, 10) || 0,
          author_name: post.authorName || "",
          title: post.postTitle || "제목 없음",
          content: post.postContent || "",
          posted_at: post.postTime ? safeParseDate(post.postTime) : new Date(),
          comment_count: commentCount,
          view_count: post.readCount || 0,
          crawled_at: new Date(),
          is_product: true,
          band_post_url: `https://band.us/band/${this.bandId}/post/${post.postId}`,
          media_urls: post.imageUrls || [],
          status: "활성",
          updated_at: new Date(),
        };

        // 게시글 데이터 추가
        postsToInsert.push(postDataToInsert);

        // 댓글을 주문으로 변환하여 준비
        if (comments && comments.length > 0) {
          for (let index = 0; index < comments.length; index++) {
            const comment = comments[index];

            // 시간 처리를 위한 안전한 날짜 변환
            const orderTime = safeParseDate(comment.time);

            // 댓글 식별자
            const bandCommentId = `${post.postId}_comment_${index}`;

            // 시간 정보를 기반으로 orderId 생성
            const orderId = `${this.bandId}_${
              post.postId
            }_${orderTime.getTime()}`;
            const customerName = comment.author || "익명";

            // 수량 추출
            const quantity = extractQuantityFromComment(comment.content);

            // 주문 정보 준비
            const orderData = {
              user_id: userId,
              product_id: post.postId,
              customer_name: customerName,
              customer_band_id: "",
              customer_profile: "",
              quantity: quantity,
              price: extractedPrice,
              total_amount: extractedPrice * quantity,
              comment: comment.content || "",
              status: "주문완료",
              ordered_at: orderTime,
              band_comment_id: bandCommentId,
              band_id: this.bandId,
              band_comment_url: `https://band.us/band/${this.bandId}/post/${post.postId}#comment`,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };

            // 주문 데이터 추가
            ordersToInsert.push(orderData);
            newOrdersCount++;

            // 고객 정보 준비
            const customerData = {
              user_id: userId,
              name: customerName,
              band_user_id: "",
              band_id: this.bandId,
              total_orders: 1,
              first_order_at: orderTime,
              last_order_at: orderTime,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };

            // 고객 데이터 추가
            customersToInsert.push(customerData);
          }
        }
      }

      if (detailedPosts.length === 0) {
        logger.warn("Supabase에 저장할 상품이 없습니다.");
        this.updateTaskStatus("processing", "저장할 상품이 없습니다.", 94);
        return;
      }

      // 개별 테이블에 직접 저장 방식으로 변경
      logger.info("개별 테이블에 직접 저장 시작...");

      // 1. 상품(products) 테이블 저장
      if (productsToInsert.length > 0) {
        try {
          logger.info(`${productsToInsert.length}개 상품 정보 저장 시도 중...`);

          // 배치 단위로 처리 (Supabase 제한 고려)
          const batchSize = 50;
          for (let i = 0; i < productsToInsert.length; i += batchSize) {
            const batch = productsToInsert.slice(i, i + batchSize);

            const { error: productsError } = await supabase
              .from("products")
              .upsert(batch, {
                onConflict: "band_id,band_post_id",
                returning: "minimal",
              });

            if (productsError) {
              logger.error(`상품 일부 저장 중 오류: ${productsError.message}`);
              throw new Error(`상품 저장 실패: ${productsError.message}`);
            }

            logger.info(
              `${i + batch.length}/${productsToInsert.length} 상품 저장 완료`
            );
          }

          logger.info(
            `모든 상품 정보 저장 완료 (${productsToInsert.length}개)`
          );
        } catch (productsError) {
          logger.error(`상품 정보 저장 오류: ${productsError.message}`);
          this.updateTaskStatus(
            "failed",
            `상품 정보 저장 실패: ${productsError.message}`,
            93
          );
          throw productsError;
        }
      }

      // 2. 게시글(posts) 테이블 저장
      if (postsToInsert.length > 0) {
        try {
          logger.info(`${postsToInsert.length}개 게시글 정보 저장 시도 중...`);

          // 배치 단위로 처리
          const batchSize = 50;
          for (let i = 0; i < postsToInsert.length; i += batchSize) {
            const batch = postsToInsert.slice(i, i + batchSize);

            const { error: postsError } = await supabase
              .from("posts")
              .upsert(batch, {
                onConflict: "band_id,band_post_id",
                returning: "minimal",
              });

            if (postsError) {
              logger.error(`게시글 일부 저장 중 오류: ${postsError.message}`);
              throw new Error(`게시글 저장 실패: ${postsError.message}`);
            }

            logger.info(
              `${i + batch.length}/${postsToInsert.length} 게시글 저장 완료`
            );
          }

          logger.info(`모든 게시글 정보 저장 완료 (${postsToInsert.length}개)`);
        } catch (postsError) {
          logger.error(`게시글 정보 저장 오류: ${postsError.message}`);
          this.updateTaskStatus(
            "failed",
            `게시글 정보 저장 실패: ${postsError.message}`,
            93
          );
          throw postsError;
        }
      }

      // 3. 주문(orders) 테이블 저장
      if (ordersToInsert.length > 0) {
        try {
          logger.info(`${ordersToInsert.length}개 주문 정보 저장 시도 중...`);

          // 배치 단위로 처리
          const batchSize = 50;
          for (let i = 0; i < ordersToInsert.length; i += batchSize) {
            const batch = ordersToInsert.slice(i, i + batchSize);

            const { error: ordersError } = await supabase
              .from("orders")
              .upsert(batch, {
                onConflict: "band_id,band_post_id",
                returning: "minimal",
              });

            if (ordersError) {
              logger.error(`주문 일부 저장 중 오류: ${ordersError.message}`);
              throw new Error(`주문 저장 실패: ${ordersError.message}`);
            }

            logger.info(
              `${i + batch.length}/${ordersToInsert.length} 주문 저장 완료`
            );
          }

          logger.info(`모든 주문 정보 저장 완료 (${ordersToInsert.length}개)`);
        } catch (ordersError) {
          logger.error(`주문 정보 저장 오류: ${ordersError.message}`);
          this.updateTaskStatus(
            "failed",
            `주문 정보 저장 실패: ${ordersError.message}`,
            93
          );
          throw ordersError;
        }
      }

      // 4. 고객(customers) 테이블 저장
      if (customersToInsert.length > 0) {
        try {
          logger.info(
            `${customersToInsert.length}개 고객 정보 저장 시도 중...`
          );

          // 배치 단위로 처리
          const batchSize = 50;
          for (let i = 0; i < customersToInsert.length; i += batchSize) {
            const batch = customersToInsert.slice(i, i + batchSize);

            const { error: customersError } = await supabase
              .from("customers")
              .upsert(batch, {
                onConflict: "band_id,band_post_id",
                returning: "minimal",
              });

            if (customersError) {
              logger.error(`고객 일부 저장 중 오류: ${customersError.message}`);
              throw new Error(`고객 저장 실패: ${customersError.message}`);
            }

            logger.info(
              `${i + batch.length}/${customersToInsert.length} 고객 저장 완료`
            );
          }

          logger.info(
            `모든 고객 정보 저장 완료 (${customersToInsert.length}개)`
          );
        } catch (customersError) {
          logger.error(`고객 정보 저장 오류: ${customersError.message}`);
          this.updateTaskStatus(
            "failed",
            `고객 정보 저장 실패: ${customersError.message}`,
            93
          );
          throw customersError;
        }
      }

      logger.info(
        `총 ${detailedPosts.length}개의 상품 중 ${postsWithComments}개의 상품에 주문이 있음`
      );
      logger.info(
        `Supabase 저장 완료: ${productsToInsert.length}개 상품, ${postsToInsert.length}개 게시글, ${ordersToInsert.length}개 주문, ${customersToInsert.length}개 고객 정보`
      );

      this.updateTaskStatus(
        "processing",
        `${detailedPosts.length}개 상품, ${newOrdersCount}개 주문이 저장되었습니다.`,
        95
      );
    } catch (error) {
      this.updateTaskStatus(
        "failed",
        `Supabase에 상품 상세 정보 저장 중 오류 발생: ${error.message}`,
        93
      );
      logger.error(`Supabase 저장 오류: ${error.message}`);
      throw error;
    }
  }
}

module.exports = BandPosts;
