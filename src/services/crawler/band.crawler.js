const BaseCrawler = require("./base.crawler");
const logger = require("../../config/logger");
const { getFirebaseDb } = require("../firebase.service");
const crypto = require("crypto");
const cheerio = require("cheerio");

// 한국어 날짜 형식 파싱 함수 추가
function parseKoreanDate(dateString) {
  // 형식 1: "3월 14일 오후 8:58"
  let match = dateString.match(/(\d+)월 (\d+)일 (오전|오후) (\d+):(\d+)/);
  if (match) {
    const [_, month, day, ampm, hour, minute] = match;
    const currentYear = new Date().getFullYear();
    let adjustedHour = parseInt(hour);

    if (ampm === "오후" && adjustedHour < 12) {
      adjustedHour += 12;
    } else if (ampm === "오전" && adjustedHour === 12) {
      adjustedHour = 0;
    }

    return new Date(
      currentYear,
      parseInt(month) - 1,
      parseInt(day),
      adjustedHour,
      parseInt(minute)
    );
  }

  // 형식 2: "2025년 3월 14일 오후 3:55"
  match = dateString.match(/(\d+)년 (\d+)월 (\d+)일 (오전|오후) (\d+):(\d+)/);
  if (match) {
    const [_, year, month, day, ampm, hour, minute] = match;
    let adjustedHour = parseInt(hour);

    if (ampm === "오후" && adjustedHour < 12) {
      adjustedHour += 12;
    } else if (ampm === "오전" && adjustedHour === 12) {
      adjustedHour = 0;
    }

    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      adjustedHour,
      parseInt(minute)
    );
  }

  return null;
}

// 기존에 추가했던 safeParseDate 함수 수정
function safeParseDate(dateString) {
  if (!dateString) return new Date();

  try {
    // 한국어 날짜 형식 시도
    const koreanDate = parseKoreanDate(dateString);
    if (koreanDate) return koreanDate;

    // "몇 시간 전", "어제" 등의 상대적 시간 처리
    if (typeof dateString === "string") {
      if (
        dateString.includes("시간 전") ||
        dateString.includes("분 전") ||
        dateString.includes("초 전") ||
        dateString === "방금 전"
      ) {
        return new Date();
      }

      if (dateString === "어제") {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday;
      }
    }

    // 일반적인 날짜 변환 시도
    const parsedDate = new Date(dateString);

    // 유효한 날짜인지 확인
    if (isNaN(parsedDate.getTime())) {
      logger.warn(`유효하지 않은 날짜 형식: ${dateString}`);
      return new Date();
    }

    return parsedDate;
  } catch (e) {
    logger.warn(`날짜 변환 오류 (${dateString}): ${e.message}`);
    return new Date();
  }
}

// 가격 추출 함수 추가
function extractPriceFromContent(content) {
  if (!content) return 0;

  // 가격 패턴 (숫자+원) 찾기
  const priceRegex = /(\d+,?\d*,?\d*)원/g;
  const priceMatches = content.match(priceRegex);

  if (!priceMatches || priceMatches.length === 0) {
    return 0;
  }

  // 모든 가격을 숫자로 변환
  const prices = priceMatches
    .map((priceText) => {
      // 쉼표 제거하고 '원' 제거
      const numStr = priceText.replace(/,/g, "").replace("원", "");
      return parseInt(numStr, 10);
    })
    .filter((price) => !isNaN(price) && price > 0);

  // 가격이 없으면 0 반환
  if (prices.length === 0) {
    return 0;
  }

  // 가장 낮은 가격 반환
  return Math.min(...prices);
}

// 문서 ID 단순화 함수 추가
function generateSimpleId(prefix = "", length = 8) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = prefix ? `${prefix}_` : "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 주문 수량 추출 함수 추가
function extractQuantityFromComment(content) {
  if (!content) return 1;

  // 숫자만 추출하는 정규식
  const numbers = content.match(/\d+/g);
  if (!numbers) return 1;

  // 10 이하의 첫 번째 숫자를 찾음
  const quantity = numbers.find((num) => parseInt(num) <= 10);
  return quantity ? parseInt(quantity) : 1;
}

class BandCrawler extends BaseCrawler {
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

  async savePostsToFirebase(posts) {
    try {
      this.updateTaskStatus("processing", "상품 정보 Firebase 저장 중", 85);
      const db = getFirebaseDb();
      const batch = db.batch();

      // 현재 밴드에 연결된 userId 찾기 (임시로 생성하거나 기존 유저 조회)
      let userId = await this._getOrCreateUserIdForBand();

      // 수정: stores 컬렉션 대신 products 컬렉션에 직접 저장
      const productsRef = db.collection("products");

      for (const post of posts) {
        // postId를 productId로 사용
        const productId =
          post.postId ||
          `product_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const docRef = productsRef.doc(productId);

        // 게시물 정보를 상품 정보로 변환
        batch.set(
          docRef,
          {
            userId: userId, // 소유자 참조 추가
            title: post.postTitle || "제목 없음", // postTitle → title
            description: post.postContent || "", // postContent → description
            price: 0, // 초기 가격은 0으로 설정
            originalPrice: 0, // 원가 정보 추가
            images: post.imageUrls || [], // imageUrls → images
            status: "판매중", // 상태 기본값
            bandPostId: post.postId, // 원본 게시물 ID 저장
            bandPostUrl: `https://band.us/band/${this.bandId}/post/${post.postId}`, // 밴드 URL 생성
            category: "기타", // 기본 카테고리
            tags: [], // 빈 태그 배열
            orderSummary: {
              // 주문 요약 정보 추가
              totalOrders: 0,
              pendingOrders: 0,
              confirmedOrders: 0,
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { merge: true }
        );
      }

      await batch.commit();
      this.updateTaskStatus(
        "processing",
        `${posts.length}개의 상품이 Firebase에 저장되었습니다.`,
        90
      );
    } catch (error) {
      this.updateTaskStatus(
        "failed",
        `Firebase에 상품 저장 중 오류 발생: ${error.message}`,
        85
      );
      throw error;
    }
  }

  async close() {
    try {
      if (this.browser) {
        this.updateTaskStatus(
          "processing",
          "브라우저가 열린 상태로 유지됩니다. 수동으로 닫아주세요.",
          95
        );
      }
    } catch (error) {
      this.updateTaskStatus(
        "failed",
        `브라우저 상태 확인 중 오류: ${error.message}`,
        95
      );
      throw error;
    }
  }

  async _accessBandPage(naverId, naverPassword) {
    // 브라우저 초기화 확인
    if (!this.browser || !this.page) {
      logger.info("브라우저 초기화 중...");
      await this.initialize(naverId, naverPassword);
    }

    logger.info(`밴드 페이지로 이동: https://band.us/band/${this.bandId}`);

    // 밴드 페이지로 이동
    await this.page.goto(`https://band.us/band/${this.bandId}`, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // 추가 대기 시간 부여
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // 접근 권한 확인 로직
    const hasBandAccess = await this.page.evaluate(() => {
      // 더 다양한 요소를 확인하여 접근 가능 여부 판단
      const bandName = document.querySelector(".bandName");
      const errorMessage = document.querySelector(
        ".errorMessage, .accessDenied"
      );
      const contentArea = document.querySelector(".contentArea, .bandContent");

      // 오류 메시지가 있거나 콘텐츠 영역이 없다면 접근 불가
      if (errorMessage) return false;

      // 밴드 이름이나 콘텐츠 영역이 있으면 접근 가능
      return !!(bandName || contentArea);
    });

    // 오류 발생 시 스크린샷 저장
    if (!hasBandAccess) {
      await this.page.screenshot({
        path: `band-access-error-${Date.now()}.png`,
      });
      // 오류 처리 코드...
    }

    logger.info(`밴드 페이지 접근 성공: ${this.bandId}`);
    return true;
  }

  async crawlPostDetail(naverId, naverPassword, maxPosts = 5) {
    try {
      this.crawlStartTime = Date.now();
      logger.info("Band 게시물 상세 정보 크롤링 시작");

      // options.numPostsToLoad 갱신
      if (maxPosts) {
        this.options.numPostsToLoad = maxPosts;
      }

      // 밴드 페이지 접속
      await this._accessBandPage(naverId, naverPassword);

      // 게시물 로드를 위한 스크롤링
      const totalLoadedPosts = await this._scrollToLoadPosts(
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

      // URL 디버깅 로그
      logger.info(`수집된 게시물 URL 수: ${postUrls.length}`);
      if (postUrls.length > 0) {
        logger.info(`첫 번째 URL: ${postUrls[0]}`);
      } else {
        logger.warn(
          "URL이 수집되지 않았습니다. 대체 방법으로 첫 번째 게시물 클릭 시도"
        );

        // URL이 수집되지 않은 경우 첫 번째 게시물 클릭
        try {
          // 첫 번째 카드 요소 클릭
          await this.page.click(".cCard");
          logger.info("첫 번째 게시물 클릭 성공");

          // 팝업 로드 대기
          await this.page.waitForSelector(".postPopup", {
            visible: true,
            timeout: 10000,
          });

          // 현재 URL 가져오기
          const currentUrl = await this.page.url();
          logger.info(`현재 URL: ${currentUrl}`);

          if (currentUrl.includes("/post/")) {
            postUrls = [currentUrl];
            logger.info("URL이 성공적으로 추출되었습니다: " + currentUrl);
          } else {
            // 직접 팝업에서 게시물 ID 추출 시도
            const postId = await this.page.evaluate(() => {
              const metaTag = document.querySelector('meta[property="og:url"]');
              if (metaTag) {
                const url = metaTag.content;
                const match = url.match(/\/post\/(\d+)/);
                return match ? match[1] : null;
              }
              return null;
            });

            if (postId) {
              const bandId =
                this.bandId ||
                (await this.page.evaluate(() => {
                  return window.location.pathname.split("/")[2];
                }));

              const constructedUrl = `https://band.us/band/${bandId}/post/${postId}`;
              postUrls = [constructedUrl];
              logger.info("게시물 ID에서 URL 구성 성공: " + constructedUrl);
            } else {
              logger.error("URL 추출 실패. 크롤링을 중단합니다.");
              return { success: false, error: "게시물 URL 추출 실패" };
            }
          }
        } catch (e) {
          logger.error(`첫 번째 게시물 클릭 실패: ${e.message}`);
          return { success: false, error: "게시물 접근 실패: " + e.message };
        }
      }

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

        try {
          // 직접 URL로 이동
          await this.page.goto(postUrl, {
            waitUntil: "networkidle2",
            timeout: 30000,
          });

          // URL 유효성 확인
          const currentUrl = await this.page.url();
          if (!currentUrl.includes("/post/")) {
            logger.warn(
              `유효하지 않은 게시물 URL로 이동됨: ${currentUrl}, 원래 URL: ${postUrl}`
            );
            continue;
          }

          // 게시물 상세 정보 추출
          const postDetail = await this._extractPostDetailFromPopup();

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
        }
      }

      logger.info(`총 ${results.length}개 게시물 크롤링 완료`);
      return { success: true, data: results };
    } catch (e) {
      logger.error(`게시물 상세 정보 크롤링 중 오류 발생: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  async saveDetailPostsToFirebase(detailedPosts) {
    try {
      this.updateTaskStatus(
        "processing",
        "상품 상세 정보 및 주문 정보 Firebase 저장 중",
        93
      );
      const db = getFirebaseDb();
      let batch = db.batch();

      // 현재 밴드에 연결된 userId 찾기
      let userId = await this._getOrCreateUserIdForBand();

      // 수정: 직접 products 컬렉션과 orders 컬렉션에 저장
      const productsRef = db.collection("products");
      const ordersRef = db.collection("orders");
      const postsRef = db.collection("posts");
      const customersRef = db.collection("customers");

      // 추가: 중복 저장 방지를 위해 기존 주문 데이터 확인
      // 현재 밴드 ID와 연관된 모든 주문을 한 번만 조회
      const existingOrdersQuery = await ordersRef
        .where("bandId", "==", this.bandId)
        .get();

      // 빠른 검색을 위해 Map 객체에 저장
      const existingOrdersMap = new Map();
      existingOrdersQuery.forEach((doc) => {
        // bandId_postId_timestamp 형식의 ID를 키로 사용
        const orderData = doc.data();
        if (orderData.bandCommentId) {
          existingOrdersMap.set(orderData.bandCommentId, doc.id);
        }
      });

      logger.info(`기존 주문 ${existingOrdersMap.size}개 로드 완료`);

      let totalCommentCount = 0;
      let postsWithComments = 0;
      let newOrdersCount = 0;
      let updatedOrdersCount = 0;

      for (const post of detailedPosts) {
        if (!post.postId || post.postId === "undefined") {
          post.postId = `unknown_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 9)}`;
          logger.warn(
            `유효하지 않은 postId 감지, 대체 ID 사용: ${post.postId}`
          );
        }

        const { comments, ...postData } = post;
        const commentCount = comments?.length || 0;

        // 문서 ID 형식 변경 - 밴드ID_product_포스트번호
        const productId = `${this.bandId}_product_${post.postId}`;

        // 가격 추출 - 게시물 내용에서 가격 추출
        const extractedPrice = extractPriceFromContent(post.postContent || "");

        if (commentCount > 0) {
          postsWithComments++;
          logger.info(
            `상품 ID: ${productId} - 주문 ${commentCount}개 저장 시도 중`
          );
        }
        totalCommentCount += commentCount;

        // 상품 정보 저장 - 가격 정보 및 전체 내용 포함
        const productDocRef = productsRef.doc(productId);
        batch.set(
          productDocRef,
          {
            userId: userId,
            title: post.postTitle || "제목 없음",
            description: post.postContent || "",
            originalContent: post.postContent || "",
            price: extractedPrice,
            originalPrice: extractedPrice,
            images: post.imageUrls || [],
            status: "판매중",
            bandPostId: post.postId,
            bandId: this.bandId,
            bandPostUrl: `https://band.us/band/${this.bandId}/post/${post.postId}`,
            category: "기타",
            tags: [],
            commentCount: commentCount,
            orderSummary: {
              totalOrders: commentCount,
              pendingOrders: commentCount,
              confirmedOrders: 0,
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { merge: true }
        );

        // 게시글 정보 저장 - Posts 컬렉션에 저장
        const postDocRef = postsRef.doc(`${this.bandId}_post_${post.postId}`);
        batch.set(
          postDocRef,
          {
            userId: userId,
            title: post.postTitle || "제목 없음",
            content: post.postContent || "",
            images: post.imageUrls || [],
            bandPostId: post.postId,
            bandId: this.bandId,
            bandPostUrl: `https://band.us/band/${this.bandId}/post/${post.postId}`,
            commentCount: commentCount,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { merge: true }
        );

        // 댓글을 주문으로 변환하여 저장
        if (comments && comments.length > 0) {
          // 배치 크기 제한에 도달하면 커밋 후 새 배치 생성
          let currentBatchSize = 2; // 이미 product와 post 2개를 추가했으므로 2부터 시작

          for (let index = 0; index < comments.length; index++) {
            const comment = comments[index];

            // 시간 처리를 위한 안전한 날짜 변환
            const orderTime = safeParseDate(comment.time);

            // 댓글 식별자
            const bandCommentId = `${post.postId}_comment_${index}`;

            // 중복 확인: 이미 저장된 주문인지 확인
            const existingOrderId = existingOrdersMap.get(bandCommentId);

            // 시간 정보를 기반으로 orderId 생성
            const orderId =
              existingOrderId ||
              `${this.bandId}_${post.postId}_${orderTime.getTime()}`;
            const customerName = comment.author || "익명";

            // 수량 추출
            const quantity = extractQuantityFromComment(comment.content);

            // 주문 정보 저장
            const orderDocRef = ordersRef.doc(orderId);

            const orderData = {
              userId: userId,
              productId: productId,
              originalProductId: post.postId,
              customerName: customerName,
              customerBandId: "",
              customerProfile: "",
              quantity: quantity,
              price: extractedPrice,
              totalAmount: extractedPrice * quantity,
              comment: comment.content || "",
              status: "주문완료", // 상태 변경
              orderedAt: orderTime,
              bandCommentId: bandCommentId,
              bandId: this.bandId,
              bandCommentUrl: `https://band.us/band/${this.bandId}/post/${post.postId}#comment`,
              updatedAt: new Date(),
            };

            // 신규 주문인 경우에만 createdAt 추가
            if (!existingOrderId) {
              orderData.createdAt = new Date();
              newOrdersCount++;
            } else {
              updatedOrdersCount++;
            }

            batch.set(orderDocRef, orderData, { merge: true });
            currentBatchSize++;

            // 고객 정보 추가 또는 업데이트 (단순화된 ID 사용)
            const customerId = generateSimpleId(`${this.bandId}_customer`, 10);
            const customerDocRef = customersRef.doc(customerId);

            batch.set(
              customerDocRef,
              {
                userId: userId,
                name: customerName,
                bandUserId: "",
                bandId: this.bandId,
                totalOrders: 1,
                firstOrderAt: orderTime,
                lastOrderAt: orderTime,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
              { merge: true }
            );
            currentBatchSize++;

            // Firestore 배치 크기 제한(500)에 도달하면 커밋하고 새 배치 생성
            if (currentBatchSize >= 450) {
              await batch.commit();
              logger.info(`배치 처리 완료 (${currentBatchSize}개 작업)`);
              batch = db.batch();
              currentBatchSize = 0;
            }
          }
        }
      }

      if (detailedPosts.length === 0) {
        logger.warn("Firebase에 저장할 상품이 없습니다.");
        this.updateTaskStatus("processing", "저장할 상품이 없습니다.", 94);
        return;
      }

      // 남은 작업이 있으면 커밋
      if (batch._mutations && batch._mutations.length > 0) {
        await batch.commit();
      }

      logger.info(
        `총 ${detailedPosts.length}개의 상품 중 ${postsWithComments}개의 상품에 주문이 있음`
      );
      logger.info(
        `총 ${totalCommentCount}개의 댓글 중 ${newOrdersCount}개의 새 주문, ${updatedOrdersCount}개의 업데이트된 주문 처리됨`
      );

      // 고객 정보 업데이트 (별도 트랜잭션)
      if (totalCommentCount > 0) {
        await this._updateCustomersTotalOrders(userId);
      }

      this.updateTaskStatus(
        "processing",
        `${detailedPosts.length}개의 상품 정보와 ${newOrdersCount}개의 새 주문이 Firebase에 저장되었습니다.`,
        94
      );

      logger.info(
        `Firebase 저장 완료: ${detailedPosts.length}개 상품, ${newOrdersCount}개 새 주문, ${updatedOrdersCount}개 업데이트된 주문`
      );

      // 크롤링 히스토리 저장
      await this._saveCrawlHistory(userId, {
        newPosts: detailedPosts.length,
        newComments: newOrdersCount,
      });
    } catch (error) {
      this.updateTaskStatus(
        "failed",
        `Firebase에 상품 상세 정보 저장 중 오류 발생: ${error.message}`,
        93
      );
      logger.error(`Firebase 저장 오류: ${error.message}`);
      throw error;
    }
  }

  async _scrollToLoadPosts(count) {
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
    // (이 코드는 실제 실행에는 영향을 주지 않지만 어떤 링크가 있는지 확인하는데 도움)
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

  async _extractPostDetailFromPopup() {
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
          ,
        ]);
      } catch (waitError) {
        logger.warn(
          `기본 셀렉터 대기 실패: ${waitError.message}, 대체 방법 시도`
        );
        // 더 긴 시간 동안 페이지 로드 완료 대기
        await this.page.waitForTimeout(5000);
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

      // 이미지 URL 추출
      const imageUrls = [];
      $(".imageListInner img").each((i, el) => {
        const src = $(el).attr("src");
        if (src) {
          imageUrls.push(src);
        }
      });

      // 댓글 수 추출
      let commentCount = 0;
      let displayedCommentCount = 0;

      // 댓글 수 추출 방법 1: 댓글 카운터에서 추출
      if ($(".comment .count").length > 0) {
        const commentCountText = $(".comment .count").text().trim();
        commentCount = parseInt(commentCountText, 10);
      } else if ($(".count.-commentCount").length > 0) {
        const commentCountText = $(".count.-commentCount").text().trim();
        commentCount = parseInt(commentCountText, 10);
      }

      // 댓글 수 추출 방법 2: 실제 댓글 요소 카운트
      const commentElements = $(".commentItem, .cmt");
      displayedCommentCount = commentElements.length;

      logger.info(
        `댓글 수: ${commentCount}, 실제 표시된 댓글 수: ${displayedCommentCount}`
      );

      // 모든 댓글 로드
      let comments = [];
      if (commentCount > 0) {
        try {
          await this._loadAllComments();

          // 페이지 컨텐츠 다시 가져오기
          const updatedContent = await this.page.content();
          const $updated = cheerio.load(updatedContent);

          // 웹 페이지의 실제 HTML 구조 확인을 위한 디버깅 코드
          const commentSectionHtml = await this.page.evaluate(() => {
            const section = document.querySelector(".dPostCommentMainView");
            if (section) {
              // 첫 번째 댓글 요소 텍스트 내용 확인
              const firstComment = section.querySelector(".cComment");
              const commentText = firstComment
                ? firstComment.textContent
                : "없음";
              console.log("첫 번째 댓글 텍스트:", commentText);

              // HTML 구조 로깅
              return {
                html: section.innerHTML.substring(0, 500),
                commentCount: section.querySelectorAll(".cComment").length,
              };
            }
            return { html: "댓글 섹션 없음", commentCount: 0 };
          });

          logger.info(
            `댓글 섹션 HTML 구조: ${JSON.stringify(commentSectionHtml)}`
          );

          // 브라우저에서 직접 댓글 수집 (더 정확함)
          comments = await this.page.evaluate(() => {
            const commentElements = document.querySelectorAll(".cComment");
            const extractedComments = [];

            console.log(
              `브라우저에서 발견된 댓글 수: ${commentElements.length}`
            );

            commentElements.forEach((comment, idx) => {
              try {
                // 작성자 찾기 - 여러 가능한 선택자 시도 (개선된 선택자)
                let author = "";
                const authorElement =
                  comment.querySelector(".writeInfo .name") || // 제공된 HTML 구조에 맞게 수정
                  comment.querySelector(".writeInfo strong.name") || // 또는 strong 태그로 직접 선택
                  comment.querySelector(".userName") ||
                  comment.querySelector(".uName") ||
                  comment.querySelector(".dAuthorInfo strong");

                if (authorElement) {
                  author = authorElement.textContent.trim();
                }

                // 내용 찾기
                let content = "";
                const contentElement =
                  comment.querySelector(".txt._commentContent") || // 제공된 HTML 구조에 맞게 수정
                  comment.querySelector(".commentText") ||
                  comment.querySelector(".txt") ||
                  comment.querySelector("p.txt");

                if (contentElement) {
                  content = contentElement.textContent.trim();
                }

                // 시간 찾기 - 제공된 HTML 구조에 맞게 수정
                let time = "";
                const timeElement =
                  comment.querySelector(".func .time") || // 제공된 HTML 구조에 맞게 수정
                  comment.querySelector(".date") ||
                  comment.querySelector(".time");

                if (timeElement) {
                  // title 속성에서 정확한 날짜 가져오기 (예: "2025년 3월 14일 오후 3:55")
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

          // 추출된 댓글 수 로깅
          logger.info(
            `총 댓글 수: ${commentCount}, 추출된 댓글 수: ${comments.length}`
          );

          if (comments.length < commentCount) {
            logger.warn(
              `표시된 댓글 수(${commentCount})와 추출된 댓글 수(${comments.length})가 일치하지 않습니다.`
            );
          }
        } catch (e) {
          logger.error(`댓글 로드 및 추출 중 오류 발생: ${e.message}`);
        }
      }

      // 결과 객체 생성
      const postDetail = {
        postId,
        bandId,
        postTitle,
        postContent,
        postTime,
        authorName,
        readCount,
        commentCount: Math.max(
          commentCount,
          displayedCommentCount,
          comments.length
        ),
        imageUrls,
        comments,
        crawledAt: new Date().toISOString(),
      };

      logger.info(
        `게시물 정보 추출 완료: ID=${postId}, 제목=${postTitle}, 작성자=${authorName}, 댓글 수=${postDetail.commentCount}`
      );
      return postDetail;
    } catch (e) {
      logger.error(`게시물 상세 정보 추출 중 오류 발생: ${e.message}`);
      return null;
    }
  }

  async _loadAllComments() {
    try {
      logger.info("모든 댓글 로드 시작");

      // 페이지가 완전히 로드될 때까지 조금 더 대기
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // 댓글 섹션 로드 대기 (여러 가능한 선택자 시도)
      try {
        await Promise.race([
          this.page.waitForSelector(".dPostCommentMainView", {
            visible: true,
            timeout: 10000,
          }),
          this.page.waitForSelector(".cComment", {
            visible: true,
            timeout: 10000,
          }),
          this.page.waitForSelector(".cCommentList", {
            visible: true,
            timeout: 10000,
          }),
        ]);
      } catch (err) {
        logger.warn(`댓글 섹션 선택자 대기 실패: ${err.message}`);
      }

      // 현재 표시된 댓글 수 확인 (정확한 선택자 사용)
      const initialCommentCount = await this.page.evaluate(() => {
        // 가능한 모든 댓글 선택자 시도
        const commentsByClass = document.querySelectorAll(
          ".cComment .itemWrap"
        );
        if (commentsByClass.length > 0) return commentsByClass.length;

        const commentsByAlt = document.querySelectorAll(".commentItem, .cmt");
        if (commentsByAlt.length > 0) return commentsByAlt.length;

        return document.querySelectorAll("[data-uiselector='authorNameButton']")
          .length;
      });

      logger.info(`초기 표시된 댓글 수: ${initialCommentCount}`);

      // 댓글 수가 20개 미만이면 이전 댓글 버튼이 없을 가능성이 높음
      if (initialCommentCount < 20) {
        logger.info("댓글 수가 20개 미만이므로 이전 댓글 로드를 건너뜁니다.");
        return;
      }

      // 이전 댓글 버튼 확인 및 표시
      await this.page.evaluate(() => {
        // 숨겨진 더보기 댓글 박스가 있다면 표시
        const moreComment = document.querySelector(
          ".moreComment.-commentHidden"
        );
        if (moreComment) {
          moreComment.classList.remove("-commentHidden");
          console.log("숨겨진 이전 댓글 버튼을 표시로 변경했습니다");
        }
      });

      // 잠시 대기하여 DOM 업데이트 허용
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // 이전 댓글 버튼 찾기 및 클릭
      let clickCount = 0;
      let lastCommentCount = initialCommentCount;
      let noChangeCount = 0;

      while (clickCount < 10) {
        // 최대 10번 시도로 제한
        // 이전 댓글 버튼 확인
        const buttonInfo = await this.page.evaluate(() => {
          // 모든 가능한 이전 댓글 버튼 선택자 시도
          const selectors = [
            '[data-uiselector="previousCommentButton"]',
            ".prevComment",
            ".moreComment button:first-child",
            'button:contains("이전 댓글")',
          ];

          for (const selector of selectors) {
            let buttons;
            try {
              if (selector.includes(":contains")) {
                // JQuery 스타일 선택자 처리
                const text = selector.match(/:contains\("([^"]+)"\)/)[1];
                buttons = Array.from(
                  document.querySelectorAll("button")
                ).filter((button) => button.textContent.includes(text));
              } else {
                buttons = document.querySelectorAll(selector);
              }

              for (const button of buttons) {
                // 버튼이 보이는지 확인
                const style = window.getComputedStyle(button);
                const isHidden =
                  style.display === "none" || style.visibility === "hidden";
                const rect = button.getBoundingClientRect();
                const isVisible =
                  !isHidden && rect.width > 0 && rect.height > 0;

                if (isVisible) {
                  return {
                    found: true,
                    selector,
                    text: button.textContent.trim(),
                    visible: isVisible,
                  };
                }
              }
            } catch (e) {
              console.error(`선택자 ${selector} 확인 중 오류:`, e);
            }
          }

          return { found: false };
        });

        logger.info(`이전 댓글 버튼 상태: ${JSON.stringify(buttonInfo)}`);

        if (!buttonInfo.found) {
          logger.info(
            "이전 댓글 버튼을 찾을 수 없습니다. 모든 댓글이 로드되었거나 버튼이 없습니다."
          );
          break;
        }

        // 이전 댓글 버튼 클릭
        try {
          const clicked = await this.page.evaluate(() => {
            // 모든 가능한 이전 댓글 버튼 선택자 시도
            const selectors = [
              '[data-uiselector="previousCommentButton"]',
              ".prevComment",
              ".moreComment button:first-child",
            ];

            for (const selector of selectors) {
              const buttons = document.querySelectorAll(selector);
              for (const button of buttons) {
                const style = window.getComputedStyle(button);
                const isHidden =
                  style.display === "none" || style.visibility === "hidden";

                if (!isHidden && button.offsetParent !== null) {
                  try {
                    button.click();
                    return true;
                  } catch (e) {
                    console.error("버튼 클릭 실패:", e);
                  }
                }
              }
            }

            // 텍스트가 "이전 댓글"인 버튼 찾기
            const allButtons = document.querySelectorAll("button");
            for (const button of allButtons) {
              if (
                button.textContent.includes("이전 댓글") &&
                button.offsetParent !== null
              ) {
                try {
                  button.click();
                  return true;
                } catch (e) {
                  console.error("텍스트로 찾은 버튼 클릭 실패:", e);
                }
              }
            }

            return false;
          });

          if (clicked) {
            clickCount++;
            logger.info(`이전 댓글 버튼 클릭 (${clickCount}번째)`);

            // 새 댓글이 로드될 때까지 충분히 대기
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // 현재 댓글 수 확인
            const currentCommentCount = await this.page.evaluate(() => {
              const commentsByClass = document.querySelectorAll(
                ".cComment .itemWrap"
              );
              if (commentsByClass.length > 0) return commentsByClass.length;

              const commentsByAlt =
                document.querySelectorAll(".commentItem, .cmt");
              if (commentsByAlt.length > 0) return commentsByAlt.length;

              return document.querySelectorAll(
                "[data-uiselector='authorNameButton']"
              ).length;
            });

            logger.info(
              `현재 댓글 수: ${currentCommentCount} (이전: ${lastCommentCount})`
            );

            // 댓글 수가 변하지 않으면 카운트 증가
            if (currentCommentCount === lastCommentCount) {
              noChangeCount++;

              // 2번 연속으로 변화가 없으면 종료
              if (noChangeCount >= 2) {
                logger.warn(
                  `${noChangeCount}번 연속으로 댓글 수 변화가 없어 종료합니다.`
                );
                break;
              }
            } else {
              // 댓글 수가 변했으면 카운트 초기화
              noChangeCount = 0;
              lastCommentCount = currentCommentCount;
            }
          } else {
            logger.warn("이전 댓글 버튼을 찾았지만 클릭할 수 없습니다.");
            noChangeCount++;

            if (noChangeCount >= 2) {
              break;
            }

            // 페이지가 업데이트될 때까지 대기
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        } catch (e) {
          logger.error(`이전 댓글 버튼 클릭 중 오류 발생: ${e.message}`);
          noChangeCount++;

          if (noChangeCount >= 2) {
            break;
          }

          // 잠시 대기 후 재시도
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      // 최종 댓글 수 확인
      const finalCommentCount = await this.page.evaluate(() => {
        const commentsByClass = document.querySelectorAll(
          ".cComment .itemWrap"
        );
        if (commentsByClass.length > 0) return commentsByClass.length;

        const commentsByAlt = document.querySelectorAll(".commentItem, .cmt");
        if (commentsByAlt.length > 0) return commentsByAlt.length;

        return document.querySelectorAll("[data-uiselector='authorNameButton']")
          .length;
      });

      logger.info(
        `댓글 로드 완료: 총 ${finalCommentCount}개 댓글 로드됨 (초기: ${initialCommentCount}, 클릭: ${clickCount}회)`
      );
    } catch (e) {
      logger.error(`모든 댓글 로드 중 오류 발생: ${e.message}`);
    }
  }

  async _getOrCreateUserIdForBand() {
    const db = getFirebaseDb();

    // 이 밴드 ID와 연결된 사용자 찾기
    const usersSnapshot = await db
      .collection("users")
      .where("bandId", "==", this.bandId)
      .limit(1)
      .get();

    if (!usersSnapshot.empty) {
      // 이미 존재하는 사용자를 찾았을 경우
      return usersSnapshot.docs[0].id;
    }

    // 존재하지 않는 경우 새 사용자 생성
    const newUserRef = db.collection("users").doc();
    await newUserRef.set({
      bandId: this.bandId,
      storeName: `밴드 ${this.bandId}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastCrawlAt: new Date(),
      role: "store",
      settings: {
        notificationEnabled: true,
        autoConfirmOrders: false,
        theme: "default",
      },
    });

    return newUserRef.id;
  }

  async _updateCustomersTotalOrders(userId) {
    try {
      const db = getFirebaseDb();

      // 최적화: 고객별로 개별 쿼리를 실행하는 대신, 한 번에 모든 주문을 가져옴
      // 모든 주문을 메모리에서 처리하여 읽기 수를 대폭 줄임
      const ordersSnapshot = await db
        .collection("orders")
        .where("userId", "==", userId)
        .get();

      // 고객별 주문 수를 집계하는 객체 생성
      const customerOrderCounts = {};
      const customerFirstOrders = {};
      const customerLastOrders = {};

      // 메모리에서 주문 데이터 처리
      ordersSnapshot.forEach((doc) => {
        const orderData = doc.data();
        const customerName = orderData.customerName;

        if (!customerName) return;

        // 주문 수 집계
        if (!customerOrderCounts[customerName]) {
          customerOrderCounts[customerName] = 0;
          customerFirstOrders[customerName] = new Date(8640000000000000); // 최대 날짜로 초기화
          customerLastOrders[customerName] = new Date(0); // 최소 날짜로 초기화
        }

        customerOrderCounts[customerName]++;

        // 첫 주문 및 마지막 주문 날짜 업데이트
        const orderDate =
          orderData.orderedAt instanceof Date
            ? orderData.orderedAt
            : new Date(orderData.orderedAt);

        if (orderDate < customerFirstOrders[customerName]) {
          customerFirstOrders[customerName] = orderDate;
        }

        if (orderDate > customerLastOrders[customerName]) {
          customerLastOrders[customerName] = orderDate;
        }
      });

      // 고객 데이터 업데이트를 위한 배치 생성
      const batch = db.batch();
      const customersSnapshot = await db
        .collection("customers")
        .where("userId", "==", userId)
        .get();

      // 각 고객 문서 업데이트
      customersSnapshot.forEach((doc) => {
        const customerData = doc.data();
        const customerName = customerData.name;

        if (customerOrderCounts[customerName]) {
          batch.update(doc.ref, {
            totalOrders: customerOrderCounts[customerName],
            firstOrderAt: customerFirstOrders[customerName],
            lastOrderAt: customerLastOrders[customerName],
            updatedAt: new Date(),
          });
        }
      });

      // 배치 커밋
      await batch.commit();
      logger.info(`${customersSnapshot.size}명의 고객 주문 정보 업데이트 완료`);
    } catch (error) {
      logger.error(`고객 주문 정보 업데이트 중 오류 발생: ${error.message}`);
    }
  }

  async _saveCrawlHistory(userId, stats) {
    const db = getFirebaseDb();

    await db.collection("crawlHistory").add({
      userId: userId,
      timestamp: new Date(),
      status: "success",
      newPosts: stats.newPosts,
      newComments: stats.newComments,
      processingTime: Date.now() - this.crawlStartTime,
      totalPostsProcessed: stats.newPosts,
      totalCommentsProcessed: stats.newComments,
    });

    // 마지막 크롤링 시간 업데이트
    await db.collection("users").doc(userId).update({
      lastCrawlAt: new Date(),
    });
  }
}

module.exports = BandCrawler;
