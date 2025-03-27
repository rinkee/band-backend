// src/services/crawler/band.posts.js
const BandAuth = require("./band.auth");
const {
  safeParseDate,
  extractPriceFromContent,
  extractPriceOptions,
  generateSimpleId,
  extractQuantityFromComment,
  hasClosingKeywords,
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
   * @returns {Promise<Object|null>} - 게시물 상세 정보
   */
  async extractPostDetailFromPage() {
    try {
      // 우선 삭제되었거나 접근할 수 없는 게시물인지 검사
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
        logger.warn(
          `삭제되었거나 접근이 차단된 게시물: ${await this.page.url()}`
        );
        return null;
      }

      // 이후 정상 게시물이라면 DOM 로딩 대기
      await this.page.waitForSelector(
        ".postWrap, .postMain, .postText, .txtBody",
        {
          visible: true,
          timeout: 5000,
        }
      );

      const currentUrl = await this.page.url();
      const content = await this.page.content();
      const $ = cheerio.load(content);

      // 게시물 ID 및 밴드 ID 파싱
      const postIdMatch = currentUrl.match(/\/post\/(\d+)/);
      const bandIdMatch = currentUrl.match(/\/band\/([^\/]+)/);
      const postId = postIdMatch?.[1] || `unknown_${Date.now()}`;
      const bandId = bandIdMatch?.[1] || this.bandId;

      // 작성자, 제목, 내용, 시간 추출
      const authorName = $(".postWriterInfoWrap .text").text().trim() || "";
      const postTitle = authorName;
      const postContent =
        $(".postText .txtBody").text().trim() ||
        $(".txtBody").text().trim() ||
        "";
      const postTime = $(".postListInfoWrap .time").text().trim() || "";

      const readCountText = $("._postReaders strong").text().trim();
      const readCount = parseInt(readCountText.match(/\d+/)?.[0] || "0", 10);

      const imageUrls = [];
      $(".imageListInner img").each((i, el) => {
        const src = $(el).attr("src");
        if (src) imageUrls.push(src);
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
        if (content) comments.push({ author, content, time });
      });

      const postDetail = {
        postId,
        bandId,
        postTitle,
        postContent,
        postTime,
        authorName,
        readCount,
        commentCount: comments.length,
        imageUrls,
        comments,
        crawledAt: new Date().toISOString(),
      };

      logger.info(
        `게시물 정보 추출 완료: ID=${postId}, 제목="${postTitle}", 작성자=${authorName}`
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
      const bandMainUrl = `https://band.us/band/${this.bandId}`;
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

        const postUrl = `https://band.us/band/${this.bandId}/post/${currentPostId}`;

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
   * 게시물 상세 정보 Supabase 저장
   * @param {Array} detailedPosts - 저장할 게시물 목록
   * @param {boolean} processProducts - 게시물에서 상품 정보를 추출할지 여부
   */
  async saveDetailPostsToSupabase(detailedPosts, processProducts = false) {
    try {
      this.updateTaskStatus("processing", "상품 및 주문 정보 DB 저장 중", 93);
      const supabase = require("../../config/supabase").supabase;
      let totalCommentCount = 0;
      let postsWithComments = 0;
      let newOrdersCount = 0;
      const userId = await this.getOrCreateUserIdForBand();

      // 저장할 데이터 배열 초기화
      const productsToInsert = [];
      const postsToInsert = [];
      const ordersToInsert = [];
      const customersToInsert = [];

      // AI 서비스 가져오기 (processProducts가 true인 경우에만)
      let extractProductInfo;
      if (processProducts) {
        try {
          // extractProductInfo 함수 가져오기
          extractProductInfo =
            require("../../services/ai.service").extractProductInfo;
        } catch (error) {
          logger.error(`AI 서비스 로드 중 오류: ${error.message}`);
          extractProductInfo = null;
        }
      }

      // 모든 게시물 처리 (중복체크 없이 항상 모든 게시물을 처리)
      logger.info(`${detailedPosts.length}개 게시물 처리 시작`);

      for (const post of detailedPosts) {
        // postDataToInsert 변수 초기화
        let postDataToInsert = null;

        // 새 ID 생성: UUID 사용
        const productId = generateUUID();
        const uniquePostId = generateUUID();

        if (!post.postId || post.postId === "undefined") {
          post.postId = generateUUID();
          logger.warn(`유효하지 않은 postId 감지: ${post.postId}`);
        }

        const { comments = [], ...postData } = post;
        const extractedPrice = extractPriceFromContent(post.postContent || "");
        const extractedPriceOptions = extractPriceOptions(
          post.postContent || ""
        );

        // 가격 정보가 없으면 상품으로 처리하지 않음
        if (
          !extractedPrice &&
          (!extractedPriceOptions || !extractedPriceOptions.basePrice)
        ) {
          logger.info(
            `게시물 ID ${post.postId} - 가격 정보가 없어 상품으로 처리하지 않음`
          );

          // 게시글만 저장
          postDataToInsert = {
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
            posted_at: post.postTime
              ? safeParseDate(post.postTime)
              : new Date(),
            comment_count: post.commentCount,
            view_count: post.readCount || 0,
            product_id: null, // 상품이 아닌 경우 null
            products_data: {
              product_ids: [],
              has_multiple_products: false,
            },
            crawled_at: new Date(),
            is_product: false,
            status: "활성",
            updated_at: new Date(),
          };
          postsToInsert.push(postDataToInsert);
          continue;
        }

        if (post.commentCount > 0) {
          postsWithComments++;
        }
        totalCommentCount += post.commentCount;

        // 제품 데이터 준비
        const productData = {
          product_id: productId,
          user_id: userId,
          band_id: parseInt(this.bandId, 10) || 0,
          title: post.postTitle || "제목 없음",
          content: post.postContent || "",
          base_price: extractedPriceOptions.basePrice || extractedPrice,
          price_options: JSON.stringify(
            extractedPriceOptions.priceOptions &&
              extractedPriceOptions.priceOptions.length > 0
              ? extractedPriceOptions.priceOptions
              : [
                  {
                    quantity: 1,
                    price: extractedPrice,
                    description: "기본가",
                  },
                ]
          ),
          quantity: 1, // 기본값을 1로 설정 (정수형)
          quantity_text: null, // 텍스트 용량 정보
          original_price: extractedPriceOptions.basePrice || extractedPrice,
          category: "기타",
          tags: [],
          features: [],
          status: "판매중",
          band_post_id: parseInt(post.postId, 10) || 0,
          band_post_url: `https://band.us/band/${this.bandId}/post/${post.postId}`,
          comment_count: post.commentCount,
          pickup_info: null,
          pickup_date: null,
          pickup_type: null,
          order_summary: {
            total_orders: post.commentCount,
            pending_orders: post.commentCount,
            confirmed_orders: 0,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // ChatGPT API를 사용하여 상품 정보 추출 (processProducts가 true이고 extractProductInfo가 로드된 경우)
        if (
          processProducts &&
          extractProductInfo &&
          post.postContent &&
          post.postContent.trim() !== ""
        ) {
          try {
            const productInfoResult = await extractProductInfo(
              post.postContent,
              post.postTime
            );

            // 디버깅을 위한 전후 비교 로그
            logger.info(
              `게시물 ID ${post.postId} - AI 처리 전: 제목="${
                post.postTitle
              }", 내용=${post.postContent.substring(0, 30)}...`
            );

            // 여러 상품이 감지된 경우
            if (
              productInfoResult.multipleProducts &&
              Array.isArray(productInfoResult.products) &&
              productInfoResult.products.length > 0
            ) {
              logger.info(
                `게시물 ID ${post.postId} - 여러 상품 감지: ${productInfoResult.products.length}개`
              );

              // 각 상품별로 상품 ID 생성 및 처리
              const productIds = [];

              for (let i = 0; i < productInfoResult.products.length; i++) {
                const productInfo = productInfoResult.products[i];
                // 각 상품별 고유 ID 생성
                const individualProductId = generateUUID();
                productIds.push(individualProductId);

                logger.info(
                  `게시물 ID ${post.postId} - 상품 ${i + 1} 결과: 제목="${
                    productInfo.title
                  }", 가격=${productInfo.basePrice}`
                );

                // 개별 상품 데이터 준비
                const individualProductData = {
                  product_id: individualProductId,
                  user_id: userId,
                  band_id: parseInt(this.bandId, 10) || 0,
                  title: productInfo.title || `상품 ${i + 1}`,
                  content: post.postContent || "",
                  base_price: productInfo.basePrice || 0,
                  price_options: JSON.stringify(
                    productInfo.priceOptions &&
                      productInfo.priceOptions.length > 0
                      ? productInfo.priceOptions
                      : [
                          {
                            quantity: 1,
                            price: productInfo.basePrice || 0,
                            description: "기본가",
                          },
                        ]
                  ),
                  quantity:
                    typeof productInfo.quantity === "number"
                      ? productInfo.quantity
                      : 1,
                  quantity_text: productInfo.quantityText || null,
                  original_price: productInfo.basePrice || 0,
                  category: productInfo.category || "기타",
                  tags: productInfo.tags || [],
                  features: productInfo.features || [],
                  status: productInfo.status || "판매중",
                  band_post_id: parseInt(post.postId, 10) || 0,
                  band_post_url: `https://band.us/band/${this.bandId}/post/${post.postId}`,
                  comment_count: post.commentCount,
                  pickup_info: productInfo.pickupInfo || null,
                  pickup_date: productInfo.pickupDate || null,
                  pickup_type: productInfo.pickupType || null,
                  order_summary: {
                    total_orders: post.commentCount,
                    pending_orders: post.commentCount,
                    confirmed_orders: 0,
                  },
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                };

                // 해당 상품 저장
                productsToInsert.push(individualProductData);

                logger.info(
                  `게시물 ID ${post.postId} - 상품 ${
                    i + 1
                  } 추가: 상품ID=${individualProductId}, 상품명=${
                    individualProductData.title
                  }, 기본가격=${individualProductData.base_price}`
                );
              }

              // 게시글 데이터에 모든 상품 ID 저장
              postDataToInsert = {
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
                posted_at: post.postTime
                  ? safeParseDate(post.postTime)
                  : new Date(),
                comment_count: post.commentCount,
                view_count: post.readCount || 0,
                product_id: productIds[0], // 기본값으로 첫 번째 상품 ID 사용
                products_data: {
                  // JSONB 필드로 저장하여 확장성 유지
                  product_ids: productIds,
                  has_multiple_products: true,
                },
                crawled_at: new Date(),
                is_product: true,
                status: "활성",
                updated_at: new Date(),
              };

              postsToInsert.push(postDataToInsert);

              // 개별 상품 처리 완료 후 다음 게시물로 넘어감
              logger.info(
                `게시물 ID ${post.postId} - 여러 상품 처리 완료: ${productIds.length}개 상품 추가됨`
              );
              continue;
            }

            // 단일 상품인 경우 (기존 로직)
            const productInfo = productInfoResult;
            logger.info(
              `게시물 ID ${post.postId} - AI 결과: 제목="${productInfo.title}", 가격=${productInfo.basePrice}`
            );

            // 추출된 정보로 제품 데이터 업데이트
            // 고친 코드
            if (typeof productInfo.title === "string") {
              productData.title = productInfo.title;
            }
            if (typeof productInfo.basePrice === "number") {
              productData.base_price = productInfo.basePrice;
            }

            // 디버깅 정보 추가
            logger.info(`API에서 반환된 상품명: '${productInfo.title}'`);
            logger.info(`설정된 제품 상품명: '${productData.title}'`);

            // price_options를 JSON 문자열로 저장
            if (
              productInfo.priceOptions &&
              productInfo.priceOptions.length > 0
            ) {
              productData.price_options = JSON.stringify(
                productInfo.priceOptions
              );
            } else {
              productData.price_options = JSON.stringify([
                {
                  quantity: 1,
                  price: productData.base_price,
                  description: "기본가",
                },
              ]);
            }

            // 수량 정보는 두 가지 필드로 나누어 저장
            // 1. quantity: 판매 단위 수량 (숫자 타입)
            // 2. quantity_text: 용량 정보 (문자열 타입, 예: "300g", "1팩")
            productData.quantity =
              typeof productInfo.quantity === "number"
                ? productInfo.quantity
                : 1;
            productData.quantity_text = productInfo.quantityText || null;

            productData.original_price =
              productInfo.basePrice || productData.original_price;
            productData.category = productInfo.category || productData.category;
            productData.tags = productInfo.tags || productData.tags;
            productData.features = productInfo.features || productData.features;
            productData.status = productInfo.status || productData.status;
            productData.pickup_info =
              productInfo.pickupInfo || productData.pickup_info;
            productData.pickup_date =
              productInfo.pickupDate || productData.pickup_date;
            productData.pickup_type =
              productInfo.pickupType || productData.pickup_type;

            logger.info(
              `게시물 ID ${post.postId} - AI 분석 완료: 상품명=${
                productData.title
              }, 기본가격=${productData.base_price}, 픽업=${
                productData.pickup_type || "없음"
              }`
            );
          } catch (aiError) {
            logger.error(
              `게시물 ID ${post.postId} - AI 분석 중 오류: ${aiError.message}`
            );
            // 오류가 발생해도 계속 진행
          }
        }

        // 항상 모든 게시물 정보 저장 (중복검사 없음)
        productsToInsert.push(productData);

        // 게시글 데이터 준비 (이미 여러 상품인 경우 위에서 처리했으므로 단일 상품인 경우만 처리)
        if (!postDataToInsert) {
          postDataToInsert = {
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
            posted_at: post.postTime
              ? safeParseDate(post.postTime)
              : new Date(),
            comment_count: post.commentCount,
            view_count: post.readCount || 0,
            product_id: productId,
            products_data: {
              // JSONB 필드로 저장하여 확장성 유지
              product_ids: [productId],
              has_multiple_products: false,
            },
            crawled_at: new Date(),
            is_product: true,
            status: "활성",
            updated_at: new Date(),
          };
          postsToInsert.push(postDataToInsert);
        }

        // 항상 모든 댓글(주문) 정보 저장 (중복검사 없음)
        if (comments && comments.length > 0) {
          // 댓글에 마감/종료 키워드가 있는지 확인
          let isClosedProduct = false;

          for (let index = 0; index < comments.length; index++) {
            // 마감 키워드 확인
            if (hasClosingKeywords(comments[index].content)) {
              isClosedProduct = true;
              logger.info(
                `게시물 ID ${post.postId}에서 마감 키워드가 발견되었습니다: "${comments[index].content}"`
              );

              // 상품 정보와 게시글 정보의 상태 업데이트
              productData.status = "마감";
              postDataToInsert.status = "마감";

              // 이미 상태를 업데이트했으므로 더 확인할 필요 없음
              break;
            }

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

            // 주문 데이터 생성
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
              price: productData.base_price, // 기본 가격으로 초기화
              total_amount: 0, // 수량에 맞게 계산할 예정
              comment: comments[index].content || "",
              status: "주문완료",
              ordered_at: orderTime,
              band_comment_id: bandCommentId,
              band_comment_url: `https://band.us/band/${this.bandId}/post/${post.postId}#comment`,
              price_option_used: "기본가",
            };

            // 가격 옵션 처리: 수량에 따라 적절한 가격 옵션 적용
            try {
              // price_options가 JSON 문자열인 경우 파싱
              const priceOptions =
                typeof productData.price_options === "string"
                  ? JSON.parse(productData.price_options)
                  : productData.price_options;

              // 최적의 가격 옵션 찾기
              let bestOption = null;
              let bestPrice = Infinity;
              let totalPrice = 0;

              if (Array.isArray(priceOptions)) {
                // 수량이 1이면 단품 가격 사용
                if (quantity === 1) {
                  const singleOption = priceOptions.find(
                    (opt) => opt.quantity === 1
                  );
                  if (singleOption) {
                    orderData.price = singleOption.price;
                    orderData.total_amount = singleOption.price;
                    orderData.price_option_used =
                      singleOption.description || "단품";
                  } else {
                    orderData.total_amount = orderData.price * quantity;
                  }
                }
                // 수량이 2 이상이면 세트 옵션 고려
                else if (quantity >= 2) {
                  // 2개 세트 옵션이 있는지 확인
                  const setOption = priceOptions.find(
                    (opt) => opt.quantity === 2
                  );

                  if (setOption && quantity % 2 === 0) {
                    // 짝수 수량인 경우 세트 가격 적용
                    const setCount = quantity / 2;
                    orderData.price = setOption.price / 2; // 단위 가격 (1개당)
                    orderData.total_amount = setOption.price * setCount;
                    orderData.price_option_used = `${
                      setOption.description || "세트"
                    } x ${setCount}`;
                  } else {
                    // 홀수 수량이거나 세트 옵션이 없는 경우
                    const singleOption = priceOptions.find(
                      (opt) => opt.quantity === 1
                    );
                    if (singleOption) {
                      orderData.price = singleOption.price;
                      orderData.total_amount = singleOption.price * quantity;
                      orderData.price_option_used = `${
                        singleOption.description || "단품"
                      } x ${quantity}`;
                    } else {
                      orderData.total_amount = orderData.price * quantity;
                    }
                  }
                } else {
                  // 수량이 0 또는 음수인 경우 (비정상)
                  orderData.total_amount =
                    orderData.price * (quantity > 0 ? quantity : 1);
                }
              } else {
                // 가격 옵션이 배열이 아닌 경우 기본 계산
                orderData.total_amount = orderData.price * quantity;
              }
            } catch (error) {
              logger.error(`가격 옵션 계산 중 오류: ${error.message}`);
              // 오류 발생 시 기본 계산
              orderData.total_amount = orderData.price * quantity;
            }

            ordersToInsert.push(orderData);
            newOrdersCount++;

            // 고객 정보 저장
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
        logger.warn("저장할 상품이 없습니다");
        this.updateTaskStatus("processing", "저장할 상품이 없습니다", 94);
        return;
      }

      logger.info("데이터 저장 시작");

      // 1. 제품(products) 테이블 저장 - 항상 upsert
      if (productsToInsert.length > 0) {
        try {
          const batchSize = 50;
          for (let i = 0; i < productsToInsert.length; i += batchSize) {
            const batch = productsToInsert.slice(i, i + batchSize);

            // price_options를 JSON 문자열로 변환
            const processedBatch = batch.map((product) => {
              // price_options 필드가 JSON 문자열이 아닌 경우에만 변환
              if (
                product.price_options &&
                typeof product.price_options !== "string"
              ) {
                return {
                  ...product,
                  price_options: JSON.stringify(product.price_options),
                };
              }
              return product;
            });

            const { error: productsError } = await supabase
              .from("products")
              .upsert(processedBatch, {
                onConflict: "product_id",
                returning: "minimal",
              });
            if (productsError) {
              logger.error(`제품 저장 오류: ${productsError.message}`);
              throw new Error(`제품 저장 실패: ${productsError.message}`);
            }
          }
          logger.info(`제품 ${productsToInsert.length}개 저장 완료`);
        } catch (productsError) {
          logger.error(`제품 저장 오류: ${productsError.message}`);
          this.updateTaskStatus(
            "failed",
            `제품 저장 실패: ${productsError.message}`,
            93
          );
          throw productsError;
        }
      }

      // 2. 게시글(posts) 테이블 저장 - 항상 upsert
      if (postsToInsert.length > 0) {
        try {
          const batchSize = 50;
          for (let i = 0; i < postsToInsert.length; i += batchSize) {
            const batch = postsToInsert.slice(i, i + batchSize);
            const { error: postsError } = await supabase
              .from("posts")
              .upsert(batch, {
                onConflict: "post_id", // 기존 게시글은 업데이트
                returning: "minimal",
              });
            if (postsError) {
              logger.error(`게시글 저장 오류: ${postsError.message}`);
              throw new Error(`게시글 저장 실패: ${postsError.message}`);
            }
          }
          logger.info(`게시글 ${postsToInsert.length}개 저장 완료`);
        } catch (postsError) {
          logger.error(`게시글 저장 오류: ${postsError.message}`);
          this.updateTaskStatus(
            "failed",
            `게시글 저장 실패: ${postsError.message}`,
            93
          );
          throw postsError;
        }
      }

      // 3. 주문(orders) 테이블 저장 - 항상 upsert
      if (ordersToInsert.length > 0) {
        try {
          // 참고: price_option_used 컬럼이 없다면 아래 SQL 명령으로 추가해야 함:
          // ALTER TABLE orders ADD COLUMN price_option_used TEXT DEFAULT '기본가';

          const batchSize = 50;
          for (let i = 0; i < ordersToInsert.length; i += batchSize) {
            const batch = ordersToInsert.slice(i, i + batchSize);
            const { error: ordersError } = await supabase
              .from("orders")
              .upsert(batch, {
                onConflict: "order_id", // 주문 ID 기준으로 중복 처리
                returning: "minimal",
              });
            if (ordersError) {
              logger.error(`주문 저장 오류: ${ordersError.message}`);
              throw new Error(`주문 저장 실패: ${ordersError.message}`);
            }
          }
          logger.info(`주문 ${ordersToInsert.length}개 저장 완료`);
        } catch (ordersError) {
          logger.error(`주문 저장 오류: ${ordersError.message}`);
          this.updateTaskStatus(
            "failed",
            `주문 저장 실패: ${ordersError.message}`,
            93
          );
          throw ordersError;
        }
      }

      // 4. 고객(customers) 테이블 저장 - 항상 upsert
      if (customersToInsert.length > 0) {
        try {
          // 중복된 고객 ID 제거
          const uniqueCustomers = [];
          const seenCustomerIds = new Set();

          for (const customer of customersToInsert) {
            if (!seenCustomerIds.has(customer.customer_id)) {
              seenCustomerIds.add(customer.customer_id);
              uniqueCustomers.push(customer);
            }
          }

          logger.info(
            `중복 제거 후 고객 수: ${uniqueCustomers.length}/${customersToInsert.length}`
          );

          const batchSize = 50;
          for (let i = 0; i < uniqueCustomers.length; i += batchSize) {
            const batch = uniqueCustomers.slice(i, i + batchSize);
            const { error: customersError } = await supabase
              .from("customers")
              .upsert(batch, {
                onConflict: "customer_id", // 고객 ID 기준으로 중복 처리
                returning: "minimal",
              });
            if (customersError) {
              logger.error(`고객 저장 오류: ${customersError.message}`);
              throw new Error(`고객 저장 실패: ${customersError.message}`);
            }
          }
          logger.info(`고객 ${uniqueCustomers.length}개 저장 완료`);
        } catch (customersError) {
          logger.error(`고객 저장 오류: ${customersError.message}`);
          this.updateTaskStatus(
            "failed",
            `고객 저장 실패: ${customersError.message}`,
            93
          );
          throw customersError;
        }
      }

      this.updateTaskStatus(
        "processing",
        `${detailedPosts.length}개의 상품 및 주문 정보가 DB에 저장되었습니다.`,
        95
      );
    } catch (error) {
      this.updateTaskStatus(
        "failed",
        `상품 및 주문 정보 DB 저장 중 오류 발생: ${error.message}`,
        93
      );
      throw error;
    }
  }
}

module.exports = BandPosts;
