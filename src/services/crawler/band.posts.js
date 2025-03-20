// src/services/crawler/band.posts.js
const BandAuth = require("./band.auth");
const {
  safeParseDate,
  extractPriceFromContent,
  generateSimpleId,
  extractQuantityFromComment, // 이 줄 추가
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
    await this.page.evaluate(() => {
      const firstCard = document.querySelector(".cCard");
      console.log(
        "첫 번째 카드 HTML:",
        firstCard ? firstCard.outerHTML.substring(0, 500) : "없음"
      );
      if (firstCard) {
        const links = firstCard.querySelectorAll("a");
        console.log(`첫 번째 카드 내 링크 수: ${links.length}`);
        links.forEach((link, i) => {
          console.log(`링크 ${i + 1}: ${link.href}, 클래스: ${link.className}`);
        });
      }
    });

    while (loadedPostsCount < count && scrollAttempts < 20) {
      loadedPostsCount = await this.page.evaluate(() => {
        return document.querySelectorAll(".cCard").length;
      });
      logger.info(`현재 로드된 게시물 수: ${loadedPostsCount}/${count}`);
      if (loadedPostsCount >= count) break;
      if (loadedPostsCount === lastPostsCount) {
        scrollAttempts++;
        if (scrollAttempts >= 5 && loadedPostsCount > 0) {
          logger.warn(
            `${scrollAttempts}회 시도 후에도 더 많은 게시물이 로드되지 않아 진행합니다.`
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
      await new Promise((r) => setTimeout(r, 2000));
    }
    await this.page.evaluate(() => {
      console.log("===== 게시물 URL 추출 디버깅 정보 =====");
      const cards = document.querySelectorAll(".cCard");
      console.log(`총 ${cards.length}개 카드 발견`);
      cards.forEach((card, i) => {
        console.log(`카드 ${i + 1} 정보:`);
        const postId = card.getAttribute("data-post-id");
        const href = card.getAttribute("data-href");
        console.log(`- data-post-id: ${postId || "없음"}`);
        console.log(`- data-href: ${href || "없음"}`);
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
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      const currentUrl = await this.page.url();
      logger.info(`현재 URL: ${currentUrl}`);
      let postId = "unknown";
      let bandId = this.bandId || "";
      const postIdMatch = currentUrl.match(/\/post\/(\d+)/);
      if (postIdMatch && postIdMatch[1]) {
        postId = postIdMatch[1];
      } else {
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
      const content = await this.page.content();
      const $ = cheerio.load(content);
      let postTitle = "";
      if ($(".postWriterInfoWrap .text").length > 0) {
        postTitle = $(".postWriterInfoWrap .text").text().trim();
      }
      let postContent = "";
      if ($(".postText .txtBody").length > 0) {
        postContent = $(".postText .txtBody").text().trim();
      } else if ($(".txtBody").length > 0) {
        postContent = $(".txtBody").text().trim();
      }
      let postTime = "";
      if ($(".postListInfoWrap .time").length > 0) {
        postTime = $(".postListInfoWrap .time").text().trim();
      }
      let authorName = "";
      if ($(".postWriterInfoWrap .text").length > 0) {
        authorName = $(".postWriterInfoWrap .text").text().trim();
      }
      let readCount = 0;
      if ($("._postReaders strong").length > 0) {
        const readCountText = $("._postReaders strong").text().trim();
        const match = readCountText.match(/\d+/);
        if (match) {
          readCount = parseInt(match[0], 10);
        }
      }
      let commentCount = 0;
      if ($(".comment count").length > 0) {
        const readCountText = $(".comment count").text().trim();
        const match = readCountText.match(/\d+/);
        if (match) {
          commentCount = parseInt(match[0], 10);
        }
      }
      const imageUrls = [];
      $(".imageListInner img").each((i, el) => {
        const src = $(el).attr("src");
        if (src) {
          imageUrls.push(src);
        }
      });
      const comments = [];
      $('div[data-viewname="DCommentLayoutView"].cComment').each((i, el) => {
        const author =
          $(el)
            .find('button[data-uiselector="authorNameButton"] strong.name')
            .text()
            .trim() || "익명";
        const content = $(el)
          .find("div.commentBody p.txt._commentContent")
          .text()
          .trim();
        const time =
          $(el).find("div.func time.time").attr("title") ||
          $(el).find("div.func time.time").text().trim();
        if (content) {
          comments.push({ author, content, time });
        }
      });
      const postDetail = {
        postId,
        bandId,
        postTitle,
        postContent,
        postTime,
        authorName,
        readCount,
        commentCount,
        imageUrls,
        comments,
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
      let userId = await this.getOrCreateUserIdForBand();
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
      const userId = await this.getOrCreateUserIdForBand();
      logger.info(`사용할 user_id: ${userId} (타입: ${typeof userId})`);
      const productsToInsert = [];
      const postsToInsert = [];
      const ordersToInsert = [];
      const customersToInsert = [];

      for (const post of detailedPosts) {
        // 새 ID 생성: 기존 추출된 post.postId를 사용
        // 제품 ID: bandId_product_postId
        const productId = `${this.bandId}_product_${post.postId}`;
        // 게시글 ID: bandId_post_postId
        const uniquePostId = `${this.bandId}_post_${post.postId}`;

        if (!post.postId || post.postId === "undefined") {
          post.postId = `unknown_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 9)}`;
          logger.warn(
            `유효하지 않은 postId 감지, 대체 ID 사용: ${post.postId}`
          );
        }

        const { comments = [], ...postData } = post;
        const extractedPrice = extractPriceFromContent(post.postContent || "");
        if (post.commentCount > 0) {
          postsWithComments++;
          logger.info(
            `상품 ID: ${post.postId} - 주문 ${post.commentCount}개 저장 준비 중`
          );
        }
        totalCommentCount += post.commentCount;

        // 제품 데이터 준비
        const productData = {
          product_id: productId,
          user_id: userId,
          band_id: parseInt(this.bandId, 10) || 0,
          title: post.postTitle || "제목 없음",
          content: post.postContent || "",
          price: extractedPrice,
          original_price: extractedPrice,
          quantity: 1,
          category: "기타",
          tags: [],

          status: "판매중",
          band_post_id: parseInt(post.postId, 10) || 0,

          band_post_url: `https://band.us/band/${this.bandId}/post/${post.postId}`,

          comment_count: post.commentCount,
          order_summary: {
            total_orders: post.commentCount,
            pending_orders: post.commentCount,
            confirmed_orders: 0,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        productsToInsert.push(productData);

        // 게시글 데이터 준비
        const postDataToInsert = {
          post_id: uniquePostId,
          user_id: userId,
          band_id: parseInt(this.bandId, 10) || 0,
          unique_post_id: uniquePostId,
          band_post_url: `https://band.us/band/${this.bandId}/post/${post.postId}`,
          author_name: post.authorName || "",
          title: post.postTitle || "제목 없음",
          band_post_id: parseInt(post.postId, 10) || 0,
          author_id: "",
          author_profile: "",
          content: post.postContent || "",
          posted_at: post.postTime ? safeParseDate(post.postTime) : new Date(),
          comment_count: post.commentCount,
          view_count: post.readCount || 0,
          product_id: productId,
          crawled_at: new Date(),
          is_product: true,
          band_post_url: `https://band.us/band/${this.bandId}/post/${post.postId}`,
          // media_urls: post.imageUrls || [],
          status: "활성",
          updated_at: new Date(),
        };
        postsToInsert.push(postDataToInsert);

        // 댓글을 주문으로 변환하여 준비
        if (comments && comments.length > 0) {
          for (let index = 0; index < comments.length; index++) {
            // 주문 ID: bandId_postId_commentIndex
            const orderId = `${this.bandId}_${post.postId}_${index}`;
            // 고객 ID: bandId_customer_{authorName}
            const customerName = comments[index].author || "익명";
            const customerId = `${this.bandId}_customer_${customerName.replace(
              /\s+/g,
              "_"
            )}`;

            const orderTime = safeParseDate(comments[index].time);
            const bandCommentId = `${post.postId}_comment_${index}`;
            const quantity = extractQuantityFromComment(
              comments[index].content
            );
            const orderData = {
              order_id: orderId,
              user_id: userId,
              product_id: productId,
              post_id: post.postId,
              band_id: this.bandId,
              customer_name: customerName,
              customer_band_id: "",
              customer_profile: "",
              quantity: quantity,
              price: extractedPrice,
              total_amount: extractedPrice * quantity,
              comment: comments[index].content || "",
              status: "주문완료",
              ordered_at: orderTime,
              band_comment_id: bandCommentId,
              band_comment_url: `https://band.us/band/${this.bandId}/post/${post.postId}#comment`,
            };
            ordersToInsert.push(orderData);
            newOrdersCount++;

            const customerData = {
              customer_id: customerId,
              user_id: userId,
              name: customerName,
              band_user_id: customerName.replace(/\s+/g, "_"),
              band_id: this.bandId,
              total_orders: 1,
              first_order_at: orderTime,
              last_order_at: orderTime,
            };
            customersToInsert.push(customerData);
          }
        }
      }

      if (detailedPosts.length === 0) {
        logger.warn("Supabase에 저장할 상품이 없습니다.");
        this.updateTaskStatus("processing", "저장할 상품이 없습니다.", 94);
        return;
      }

      logger.info("개별 테이블에 직접 저장 시작...");

      // 1. 제품(products) 테이블 저장
      if (productsToInsert.length > 0) {
        try {
          logger.info(`${productsToInsert.length}개 제품 정보 저장 시도 중...`);
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
              logger.error(`제품 일부 저장 중 오류: ${productsError.message}`);
              throw new Error(`제품 저장 실패: ${productsError.message}`);
            }
            logger.info(
              `${i + batch.length}/${productsToInsert.length} 제품 저장 완료`
            );
          }
          logger.info(
            `모든 제품 정보 저장 완료 (${productsToInsert.length}개)`
          );
        } catch (productsError) {
          logger.error(`제품 정보 저장 오류: ${productsError.message}`);
          this.updateTaskStatus(
            "failed",
            `제품 정보 저장 실패: ${productsError.message}`,
            93
          );
          throw productsError;
        }
      }

      // 2. 게시글(posts) 테이블 저장
      if (postsToInsert.length > 0) {
        try {
          logger.info(`${postsToInsert.length}개 게시글 정보 저장 시도 중...`);
          const batchSize = 50;
          for (let i = 0; i < postsToInsert.length; i += batchSize) {
            const batch = postsToInsert.slice(i, i + batchSize);
            const { error: postsError } = await supabase
              .from("posts")
              .upsert(batch, {
                onConflict: "post_id",
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
          const batchSize = 50;
          for (let i = 0; i < ordersToInsert.length; i += batchSize) {
            const batch = ordersToInsert.slice(i, i + batchSize);
            const { error: ordersError } = await supabase
              .from("orders")
              .upsert(batch);
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
      // if (customersToInsert.length > 0) {
      //   try {
      //     logger.info(
      //       `${customersToInsert.length}개 고객 정보 저장 시도 중...`
      //     );
      //     const batchSize = 50;
      //     for (let i = 0; i < customersToInsert.length; i += batchSize) {
      //       const batch = customersToInsert.slice(i, i + batchSize);
      //       const { error: customersError } = await supabase
      //         .from("customers")
      //         .upsert(batch, {
      //           onConflict: "customer_id",
      //           returning: "minimal",
      //         });
      //       if (customersError) {
      //         logger.error(`고객 일부 저장 중 오류: ${customersError.message}`);
      //         throw new Error(`고객 저장 실패: ${customersError.message}`);
      //       }
      //       logger.info(
      //         `${i + batch.length}/${customersToInsert.length} 고객 저장 완료`
      //       );
      //     }
      //     logger.info(
      //       `모든 고객 정보 저장 완료 (${customersToInsert.length}개)`
      //     );
      //   } catch (customersError) {
      //     logger.error(`고객 정보 저장 오류: ${customersError.message}`);
      //     this.updateTaskStatus(
      //       "failed",
      //       `고객 정보 저장 실패: ${customersError.message}`,
      //       93
      //     );
      //     throw customersError;
      //   }
      // }

      logger.info(
        `총 ${detailedPosts.length}개의 상품 중 ${postsWithComments}개의 상품에 주문이 있음`
      );
      logger.info(
        `Supabase 저장 완료: ${productsToInsert.length}개 제품, ${postsToInsert.length}개 게시글, ${ordersToInsert.length}개 주문, ${customersToInsert.length}개 고객 정보`
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

  /**
   * 밴드 멤버 목록 크롤링
   * @param {string} naverId - 네이버 ID
   * @param {string} naverPassword - 네이버 비밀번호
   * @returns {Promise<Array>} - 멤버 정보 배열
   */
  async crawlMembersList(naverId, naverPassword) {
    try {
      logger.info(`밴드 ${this.bandId} 멤버 목록 크롤링 시작`);

      // 브라우저 초기화 및 로그인
      if (!this.browser) {
        await this.initialize(naverId, naverPassword);
      }

      // 멤버 페이지로 이동
      const memberPageUrl = `https://band.us/band/${this.bandId}/member`;
      logger.info(`멤버 페이지로 이동: ${memberPageUrl}`);
      await this.page.goto(memberPageUrl, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      // 페이지가 로드될 때까지 대기
      await this.page.waitForSelector(".cMemberList", { timeout: 10000 });

      // 모든 멤버가 로드될 때까지 스크롤
      logger.info("멤버 목록 스크롤링 시작");
      await this._scrollToLoadAllMembers();

      // 멤버 데이터 추출
      const members = await this.page.evaluate(() => {
        const memberItems = document.querySelectorAll("li.uFlexItem");
        const extractedMembers = [];

        memberItems.forEach((member, index) => {
          try {
            // 이름 추출
            const nameElement = member.querySelector(".body .text .ellipsis");
            const name = nameElement
              ? nameElement.textContent.trim()
              : `익명_${index}`;

            // 역할 추출 (리더, 공동리더 등)
            const roleElement = member.querySelector(".body .text em.leader");
            const role = roleElement ? roleElement.textContent.trim() : "";

            // 프로필 이미지 URL 추출
            const imgElement = member.querySelector(".uProfile img");
            const profileImageUrl = imgElement ? imgElement.src : "";

            // 닉네임 또는 메모 추출 (있는 경우)
            const subTextElement = member.querySelector(".body .subText");
            const nickname = subTextElement
              ? subTextElement.textContent.trim()
              : "";

            // 밴드 사용자 ID는 프로필 클릭 시 URL에서 추출할 수 있으나
            // 이 예시에서는 고유한 식별자로 이름 사용
            const bandUserId = `member_${name.replace(/\s+/g, "_")}`;

            extractedMembers.push({
              bandUserId,
              name,
              role,
              profileImageUrl,
              nickname,
              isActive: true,
              lastActivityDate: new Date().toISOString(),
            });
          } catch (error) {
            console.error(`멤버 ${index} 추출 중 오류:`, error.message);
          }
        });

        return extractedMembers;
      });

      logger.info(`총 ${members.length}명의 멤버를 추출했습니다.`);

      // 저장 로직
      await this._saveMembers(members);

      return members;
    } catch (error) {
      logger.error(`멤버 목록 크롤링 중 오류: ${error.message}`);
      throw error;
    }
  }

  /**
   * 모든 멤버가 로드될 때까지 스크롤
   * @private
   */
  async _scrollToLoadAllMembers() {
    try {
      let previousMemberCount = 0;
      let currentMemberCount = 0;
      let scrollAttempts = 0;
      const MAX_SCROLL_ATTEMPTS = 50;

      do {
        previousMemberCount = currentMemberCount;

        // 페이지 아래로 스크롤
        await this.page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });

        // 새 멤버가 로드될 때까지 대기
        await this.page.waitForTimeout(2000);

        // 현재 멤버 수 계산
        currentMemberCount = await this.page.evaluate(() => {
          return document.querySelectorAll("li.uFlexItem").length;
        });

        logger.info(`현재 로드된 멤버 수: ${currentMemberCount}`);
        scrollAttempts++;

        // 더 이상 새 멤버가 로드되지 않거나 최대 시도 횟수에 도달하면 종료
      } while (
        currentMemberCount > previousMemberCount &&
        scrollAttempts < MAX_SCROLL_ATTEMPTS
      );

      logger.info(
        `총 ${scrollAttempts}번 스크롤 후 ${currentMemberCount}명의 멤버 로드 완료`
      );
    } catch (error) {
      logger.error(`멤버 스크롤링 중 오류: ${error.message}`);
    }
  }

  /**
   * 수집된 멤버 정보 저장
   * @param {Array} members - 멤버 정보 배열
   * @private
   */
  async _saveMembers(members) {
    try {
      // 중복 제거 로직
      const uniqueMembers = [];
      const seenKeys = new Set();

      for (const member of members) {
        // 고유 키 생성 (이름 기반)
        const uniqueKey = member.bandUserId;

        // 중복되지 않은 경우에만 추가
        if (!seenKeys.has(uniqueKey)) {
          seenKeys.add(uniqueKey);
          uniqueMembers.push(member);
        }
      }

      logger.info(
        `중복 제거 후 ${uniqueMembers.length}명의 고유 멤버 저장 시도`
      );

      // Supabase에 고객 정보 저장 (유저 ID와 관계 설정)
      const userId = await this._getOrCreateUserIdForBand();

      const customersToInsert = uniqueMembers.map((member) => ({
        customer_id: `${this.bandId}_${member.bandUserId}`,
        user_id: userId,
        band_id: this.bandId,
        name: member.name,
        band_user_id: member.bandUserId,
        profile_image: member.profileImageUrl,
        tags: member.role ? [member.role] : [],
        notes: member.nickname || "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      // 작은 배치로 나누어 처리
      const batchSize = 50;
      let successCount = 0;

      for (let i = 0; i < customersToInsert.length; i += batchSize) {
        const batch = customersToInsert.slice(i, i + batchSize);

        const { data, error } = await supabase.from("customers").upsert(batch, {
          onConflict: "customer_id",
          ignoreDuplicates: false,
        });

        if (error) {
          logger.error(
            `배치 ${Math.floor(i / batchSize) + 1} 저장 중 오류: ${
              error.message
            }`
          );
        } else {
          successCount += batch.length;
          logger.info(
            `배치 ${Math.floor(i / batchSize) + 1} 저장 완료 (${
              batch.length
            }명)`
          );
        }
      }

      logger.info(`총 ${successCount}명의 멤버 정보 저장 완료`);
    } catch (error) {
      logger.error(`멤버 정보 저장 중 오류: ${error.message}`);
      throw error;
    }
  }
}

module.exports = BandPosts;
