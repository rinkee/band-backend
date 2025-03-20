// src/controllers/crawl.controller.js - 크롤링 컨트롤러
const crawlerService = require("../services/crawler.service");
const BandCrawler = require("../services/crawler/band.crawler");
const BaseCrawler = require("../services/crawler/base.crawler");
const { supabase } = require("../config/supabase");
const logger = require("../config/logger");
const fs = require("fs").promises;
const path = require("path");

// 쿠키 저장 경로 설정
const COOKIES_PATH = path.join(__dirname, "../../../cookies");

// 문서 ID 단순화 함수 추가
function generateSimpleId(prefix = "", length = 8) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = prefix ? `${prefix}_` : "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 가격 추출 함수
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

/**
 * 쿠키 유효성을 확인하는 함수
 * @param {string} naverId - 네이버 ID
 * @returns {Promise<boolean>} 쿠키가 유효한지 여부
 */
const checkCookieValidity = async (naverId) => {
  try {
    // 쿠키 파일이 존재하는지 확인
    const cookieFilePath = path.join(COOKIES_PATH, `${naverId}.json`);

    try {
      await fs.access(cookieFilePath);
    } catch (err) {
      logger.info(`${naverId}의 쿠키 파일이 존재하지 않습니다.`);
      return false;
    }

    // 쿠키 파일 데이터 읽기
    const cookieData = JSON.parse(await fs.readFile(cookieFilePath, "utf8"));

    // 쿠키 생성 후 24시간이 지났는지 확인 (하루가 지난 쿠키는 만료된 것으로 간주)
    const cookieTimestamp = cookieData.timestamp || 0;
    const currentTime = Date.now();
    const timeDiff = currentTime - cookieTimestamp;
    const hoursPassed = timeDiff / (1000 * 60 * 60);

    if (hoursPassed > 24) {
      logger.info(
        `${naverId}의 쿠키가 만료되었습니다. (${hoursPassed.toFixed(
          2
        )}시간 경과)`
      );
      return false;
    }

    // 중요 쿠키가 있는지 확인
    const hasBandSession = cookieData.cookies.some(
      (cookie) => cookie.name === "band_session"
    );
    if (!hasBandSession) {
      logger.info(`${naverId}의 쿠키에 band_session이 없습니다.`);
      return false;
    }

    logger.info(
      `${naverId}의 쿠키가 유효합니다. (${hoursPassed.toFixed(2)}시간 경과)`
    );
    return true;
  } catch (error) {
    logger.error(`쿠키 유효성 확인 중 오류: ${error.message}`);
    return false;
  }
};

/**
 * 사용자 ID로 네이버 계정 정보 조회
 * @param {string} userId - 사용자 ID
 * @returns {Promise<Object|null>} 네이버 계정 정보
 */
const getUserNaverAccount = async (userId) => {
  try {
    const { data: userData, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) {
      logger.error(`사용자 조회 오류 (${userId}):`, error);
      return null;
    }

    if (!userData.naver_id || !userData.naver_password) {
      logger.error(`네이버 계정 정보가 설정되지 않았습니다: ${userId}`);
      return null;
    }

    return {
      userId,
      naverId: userData.naver_id,
      naverPassword: userData.naver_password,
      bandId: userData.band_id,
    };
  } catch (error) {
    logger.error(`사용자 정보 조회 중 오류: ${error.message}`);
    return null;
  }
};

/**
 * 크롤링 시작 컨트롤러
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const startCrawling = async (req, res) => {
  try {
    const { naverId, naverPassword, bandId } = req.body;

    if (!naverId || !naverPassword || !bandId) {
      return res.status(400).json({
        success: false,
        message: "네이버 ID, 비밀번호, 밴드 ID가 필요합니다.",
      });
    }

    // 크롤링 서비스 호출
    const taskId = await crawlerService.startCrawling(
      naverId,
      naverPassword,
      bandId
    );

    // 응답
    res.json({
      success: true,
      taskId,
      message: "크롤링 작업이 시작되었습니다.",
    });
  } catch (error) {
    console.error("API 오류:", error);
    res.status(500).json({
      success: false,
      message: "처리 중 오류가 발생했습니다: " + error.message,
    });
  }
};

/**
 * 크롤링 상태 조회 컨트롤러
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getTaskStatus = (req, res) => {
  try {
    const { taskId } = req.params;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        message: "작업 ID가 필요합니다.",
      });
    }

    // 작업 상태 확인
    const task = crawlerService.getTaskStatus(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        message: "작업을 찾을 수 없습니다.",
      });
    }

    res.json({
      success: true,
      task,
    });
  } catch (error) {
    console.error("상태 확인 오류:", error);
    res.status(500).json({
      success: false,
      message: "상태 확인 중 오류가 발생했습니다: " + error.message,
    });
  }
};

class CrawlController {
  async startPostDetailCrawling(req, res) {
    let crawler = null;

    try {
      // URL 경로 매개변수에서 bandId 가져오기
      const { bandId } = req.params;
      const { userId, maxPosts } = req.body;

      // bandId 검증
      if (!bandId) {
        return res.status(400).json({
          success: false,
          message: "밴드 ID는 필수 값입니다.",
        });
      }

      // 사용자 ID 검증
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "사용자 ID는 필수 값입니다.",
        });
      }

      // 사용자의 네이버 계정 정보 조회
      const userAccount = await getUserNaverAccount(userId);
      if (!userAccount) {
        return res.status(400).json({
          success: false,
          message: "네이버 계정 정보를 가져올 수 없습니다.",
        });
      }

      // 응답을 먼저 보내고 백그라운드에서 크롤링 진행
      res.json({
        success: true,
        message:
          "게시물 상세 정보 크롤링이 시작되었습니다. 진행 상황은 로그를 확인하세요.",
        data: {
          userId,
          bandId,
          naverId: userAccount.naverId,
          maxPosts: maxPosts || 30,
          startTime: new Date().toISOString(),
        },
      });

      // BandCrawler 인스턴스 생성
      crawler = new BandCrawler(bandId, {
        numPostsToLoad: maxPosts || 30,
      });

      // 한 번에 제대로 initialize 및 로그인 수행
      logger.info(`네이버 계정으로 밴드 크롤링 시작: ${userAccount.naverId}`);
      const initialized = await crawler.initialize(
        userAccount.naverId,
        userAccount.naverPassword
      );

      if (!initialized) {
        logger.error(
          `브라우저 초기화 또는 로그인 실패: ${userAccount.naverId}`
        );
        return;
      }

      // crawlPostDetail 호출 - 초기화와 로그인이 이미 완료됨
      logger.info(`게시물 상세 정보 크롤링 시작 (최대 ${maxPosts || 30}개)`);
      const result = await crawler.crawlPostDetail(maxPosts || 30);

      // 결과 처리 및 Supabase에 저장
      if (result && result.data && result.data.length > 0) {
        logger.info(
          `${result.data.length}개의 게시물 상세 정보를 크롤링했습니다.`
        );

        await crawler.saveDetailPostsToSupabase(result.data);
      } else {
        logger.error(
          `게시물 상세 정보 크롤링 실패: ${
            result ? result.error : "알 수 없는 오류"
          }`
        );
      }
    } catch (error) {
      logger.error("게시물 상세 정보 크롤링 오류:", error);
    } finally {
      // 브라우저 리소스 정리
      try {
        if (crawler && crawler.close) {
          await crawler.close();
          logger.info("브라우저 리소스 정리 완료");
        }
      } catch (closeError) {
        logger.error("브라우저 종료 오류:", closeError);
      }
    }
  }

  /**
   * 특정 게시물의 댓글만 크롤링하여 저장
   * @param {Object} req - 요청 객체
   * @param {Object} res - 응답 객체
   */
  async getCommentsOnly(req, res) {
    let crawler = null;

    try {
      const { bandId, postId } = req.params;
      const { userId } = req.body;

      // 필수 매개변수 검증
      if (!bandId || !postId) {
        return res.status(400).json({
          success: false,
          message: "밴드 ID와 게시물 ID는 필수 값입니다.",
        });
      }

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "사용자 ID는 필수 값입니다.",
        });
      }

      // 사용자의 네이버 계정 정보 조회
      const userAccount = await getUserNaverAccount(userId);
      if (!userAccount) {
        return res.status(400).json({
          success: false,
          message: "네이버 계정 정보를 가져올 수 없습니다.",
        });
      }

      // 응답을 먼저 보내고 백그라운드에서 크롤링 진행
      res.json({
        success: true,
        message: "댓글 크롤링이 시작되었습니다. 진행 상황은 로그를 확인하세요.",
        data: {
          userId,
          bandId,
          postId,
          naverId: userAccount.naverId,
          startTime: new Date().toISOString(),
        },
      });

      // BandCrawler 인스턴스 생성
      crawler = new BandCrawler(bandId);

      // 한 번에 제대로 initialize 및 로그인 수행
      logger.info(`네이버 계정으로 댓글 크롤링 시작: ${userAccount.naverId}`);
      const initialized = await crawler.initialize(
        userAccount.naverId,
        userAccount.naverPassword
      );

      if (!initialized) {
        logger.error(
          `브라우저 초기화 또는 로그인 실패: ${userAccount.naverId}`
        );
        return;
      }

      // 직접 게시물 URL로 이동
      const postUrl = `https://band.us/band/${bandId}/post/${postId}`;
      logger.info(`게시물 URL로 이동: ${postUrl}`);

      await crawler.page.goto(postUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      // 모든 댓글 로드
      await crawler._loadAllComments();

      // 게시물 상세 정보 및 댓글 추출
      logger.info(`댓글 추출 시작`);
      const postDetail = await crawler._extractPostDetailFromPopup();

      if (!postDetail) {
        logger.error(`게시물 정보 추출 실패: ${postUrl}`);
        return;
      }

      const comments = postDetail.comments || [];
      logger.info(`${comments.length}개의 댓글을 추출했습니다.`);

      // 추출한 가격 정보
      const extractedPrice = postDetail.postContent
        ? extractPriceFromContent(postDetail.postContent)
        : 0;

      // Supabase에 저장
      if (comments.length > 0) {
        // 기존 주문 데이터 확인
        const { data: existingOrders, error: queryError } = await supabase
          .from("orders")
          .select("order_id, band_comment_id")
          .eq("band_id", bandId)
          .eq("band_post_id", postId);

        if (queryError) {
          logger.error(`주문 데이터 조회 오류: ${queryError.message}`);
          return;
        }

        // 빠른 검색을 위해 Map 객체에 저장
        const existingOrdersMap = new Map();
        if (existingOrders && existingOrders.length > 0) {
          existingOrders.forEach((order) => {
            if (order.band_comment_id) {
              existingOrdersMap.set(order.band_comment_id, order.order_id);
            }
          });
        }

        logger.info(`기존 주문 ${existingOrdersMap.size}개 로드 완료`);

        let newOrdersCount = 0;
        let updatedOrdersCount = 0;

        // 제품 ID
        const productId = `${bandId}_product_${postId}`;

        // 주문 데이터 준비
        const ordersToUpsert = [];

        // 댓글 저장 로직
        for (let index = 0; index < comments.length; index++) {
          const comment = comments[index];

          // 댓글 식별자
          const bandCommentId = `${postId}_comment_${index}`;

          // 중복 확인
          const existingOrderId = existingOrdersMap.get(bandCommentId);

          // 수량 추출 (BandCrawler에 이 함수가 있다고 가정)
          const quantity = 1; // 기본값 설정, 실제 함수가 있다면 사용

          // 시간 변환
          let parsedTime;
          try {
            parsedTime = new Date(comment.time);
            if (isNaN(parsedTime.getTime())) {
              parsedTime = new Date();
            }
          } catch (e) {
            parsedTime = new Date();
          }

          // 주문 ID
          const orderId =
            existingOrderId || `${bandId}_${postId}_${parsedTime.getTime()}`;

          // 주문 데이터
          const orderData = {
            order_id: orderId,
            product_id: productId,
            band_post_id: postId,
            band_id: bandId,
            user_id: userId,
            customer_name: comment.author || "익명",
            quantity: quantity,
            price: extractedPrice || 0,
            total_amount: (extractedPrice || 0) * quantity,
            comment: comment.content || "",
            status: "ordered",
            ordered_at: parsedTime.toISOString(),
            band_comment_id: bandCommentId,
            band_comment_url: `https://band.us/band/${bandId}/post/${postId}#comment`,
            updated_at: new Date().toISOString(),
          };

          // 신규 주문인 경우에만 created_at 추가
          if (!existingOrderId) {
            orderData.created_at = new Date().toISOString();
            newOrdersCount++;
          } else {
            updatedOrdersCount++;
          }

          ordersToUpsert.push(orderData);
        }

        // 배치 업서트 (500개씩 나누어 처리)
        const batchSize = 450;
        for (let i = 0; i < ordersToUpsert.length; i += batchSize) {
          const batch = ordersToUpsert.slice(i, i + batchSize);
          const { error: upsertError } = await supabase
            .from("orders")
            .upsert(batch, { onConflict: "order_id" });

          if (upsertError) {
            logger.error(`주문 데이터 저장 오류: ${upsertError.message}`);
          }
        }

        logger.info(
          `${newOrdersCount}개의 새 주문, ${updatedOrdersCount}개의 업데이트된 주문을 저장했습니다.`
        );

        // 상품 문서의 댓글 수 업데이트
        const { error: updateError } = await supabase
          .from("products")
          .update({
            comment_count: comments.length,
            updated_at: new Date().toISOString(),
          })
          .eq("band_id", bandId)
          .eq("band_post_id", postId);

        if (updateError) {
          logger.error(`상품 댓글 수 업데이트 오류: ${updateError.message}`);
        }
      }
    } catch (error) {
      logger.error("댓글 크롤링 오류:", error);
    } finally {
      // 브라우저 리소스 정리
      try {
        if (crawler && crawler.close) {
          await crawler.close();
          logger.info("브라우저 리소스 정리 완료");
        }
      } catch (closeError) {
        logger.error("브라우저 종료 오류:", closeError);
      }
    }
  }

  /**
   * 게시물 목록 정보만 크롤링하여 저장 (게시물 ID, 내용, 글쓴이, 시간, 댓글 수)
   * @param {Object} req - 요청 객체
   * @param {Object} res - 응답 객체
   */
  async getPostsInfoOnly(req, res) {
    let crawler = null;

    try {
      const { bandId } = req.params;
      const { userId, maxPosts } = req.body;

      // 필수 매개변수 검증
      if (!bandId) {
        return res.status(400).json({
          success: false,
          message: "밴드 ID는 필수 값입니다.",
        });
      }

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "사용자 ID는 필수 값입니다.",
        });
      }

      // 사용자의 네이버 계정 정보 조회
      const userAccount = await getUserNaverAccount(userId);
      if (!userAccount) {
        return res.status(400).json({
          success: false,
          message: "네이버 계정 정보를 가져올 수 없습니다.",
        });
      }

      // 응답을 먼저 보내고 백그라운드에서 크롤링 진행
      res.json({
        success: true,
        message:
          "게시물 정보 크롤링이 시작되었습니다. 진행 상황은 로그를 확인하세요.",
        data: {
          userId,
          bandId,
          naverId: userAccount.naverId,
          maxPosts: maxPosts || 50,
          startTime: new Date().toISOString(),
        },
      });

      // BandCrawler 인스턴스 생성
      crawler = new BandCrawler(bandId, {
        numPostsToLoad: maxPosts || 50,
      });

      // 한 번에 제대로 initialize 및 로그인 수행
      logger.info(`네이버 계정으로 게시물 크롤링 시작: ${userAccount.naverId}`);
      const initialized = await crawler.initialize(
        userAccount.naverId,
        userAccount.naverPassword
      );

      if (!initialized) {
        logger.error(
          `브라우저 초기화 또는 로그인 실패: ${userAccount.naverId}`
        );
        return;
      }

      // 밴드 페이지로 이동
      await crawler.page.goto(`https://band.us/band/${bandId}`, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      // 게시물 목록을 로드하기 위해 스크롤
      await crawler._scrollToLoadPosts(maxPosts || 50);

      // 게시물 정보 추출
      const postsInfo = await crawler.page.evaluate(() => {
        const posts = [];
        const cards = document.querySelectorAll(".cCard");

        cards.forEach((card) => {
          // 게시물 ID 추출
          let postId = "";
          const postLink =
            card.querySelector("a.linkBtn") ||
            card.querySelector("a.detailLink");
          if (postLink) {
            const href = postLink.getAttribute("href");
            const match = href && href.match(/\/post\/(\d+)/);
            if (match && match[1]) {
              postId = match[1];
            }
          }

          if (!postId) return; // 유효한 ID가 없으면 건너뜀

          // 게시물 내용 추출
          let content = "";
          const contentElem =
            card.querySelector(".txtBody") || card.querySelector(".cText");
          if (contentElem) {
            content = contentElem.textContent.trim();
          }

          // 작성자 추출
          let author = "";
          const authorElem =
            card.querySelector(".uName") || card.querySelector(".name");
          if (authorElem) {
            author = authorElem.textContent.trim();
          }

          // 시간 추출
          let time = "";
          const timeElem = card.querySelector(".time");
          if (timeElem) {
            time = timeElem.textContent.trim();
          }

          // 댓글 수 추출
          let commentCount = 0;
          const commentCountElem = card.querySelector(".comment .count");
          if (commentCountElem) {
            const countText = commentCountElem.textContent.trim();
            const countMatch = countText.match(/\d+/);
            if (countMatch) {
              commentCount = parseInt(countMatch[0], 10);
            }
          }

          // 이미지 URL 추출
          const imageUrls = [];
          const imgElements = card.querySelectorAll("img.img");
          imgElements.forEach((img) => {
            if (img.src) {
              imageUrls.push(img.src);
            }
          });

          posts.push({
            postId,
            content,
            author,
            time,
            commentCount,
            imageUrls,
          });
        });

        return posts;
      });

      logger.info(`${postsInfo.length}개의 게시물 정보를 추출했습니다.`);

      // Supabase에 저장
      if (postsInfo.length > 0) {
        // 게시물 및 상품 데이터 준비
        const postsToUpsert = [];
        const productsToUpsert = [];

        // 각 게시물 정보 저장
        postsInfo.forEach((post) => {
          // 가격 추출
          const extractedPrice = extractPriceFromContent(post.content || "");

          // 시간 파싱 - 안전하게 처리
          let parsedTime;
          try {
            parsedTime = new Date(post.time);
            if (isNaN(parsedTime.getTime())) {
              parsedTime = new Date();
            }
          } catch (e) {
            parsedTime = new Date();
          }

          // 게시물 정보 준비
          postsToUpsert.push({
            id: `${bandId}_post_${post.postId}`,
            user_id: userId,
            title: post.author ? `${post.author}의 게시물` : "제목 없음",
            content: post.content || "",
            band_post_id: post.postId,
            band_id: bandId,
            band_post_url: `https://band.us/band/${bandId}/post/${post.postId}`,
            comment_count: post.commentCount || 0,
            author: post.author || "",
            posted_at: parsedTime.toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

          // 상품 정보 준비
          productsToUpsert.push({
            id: `${bandId}_product_${post.postId}`,
            user_id: userId,
            band_id: bandId,
            title: "아직없음",
            description: post.content || "",
            price: extractedPrice,
            original_price: extractedPrice,
            quantity: 1,
            category: "기타",
            tags: [],
            status: "주문확인",
            expired_date: null,
            barcode: generateSimpleId("barcode", 12),
            product_code: "아직없음",
            band_post_id: post.postId,
            band_post_url: `https://band.us/band/${bandId}/post/${post.postId}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        });

        // 배치 업서트 (500개씩 나누어 처리)
        const batchSize = 450;

        // 게시물 정보 저장
        for (let i = 0; i < postsToUpsert.length; i += batchSize) {
          const batch = postsToUpsert.slice(i, i + batchSize);
          const { error: postsError } = await supabase
            .from("posts")
            .upsert(batch, { onConflict: "post_id" });

          if (postsError) {
            logger.error(`게시물 정보 저장 오류: ${postsError.message}`);
          }
        }

        // 상품 정보 저장
        for (let i = 0; i < productsToUpsert.length; i += batchSize) {
          const batch = productsToUpsert.slice(i, i + batchSize);
          const { error: productsError } = await supabase
            .from("products")
            .upsert(batch, { onConflict: "product_id" });

          if (productsError) {
            logger.error(`상품 정보 저장 오류: ${productsError.message}`);
          }
        }

        logger.info(
          `${postsInfo.length}개의 게시물 정보를 Posts 및 Products 테이블에 저장했습니다.`
        );
      }
    } catch (error) {
      logger.error("게시물 정보 크롤링 오류:", error);
    } finally {
      // 브라우저 리소스 정리
      try {
        if (crawler && crawler.close) {
          await crawler.close();
          logger.info("브라우저 리소스 정리 완료");
        }
      } catch (closeError) {
        logger.error("브라우저 종료 오류:", closeError);
      }
    }
  }
}

// 내보내기
module.exports = {
  CrawlController,
  startCrawling,
  getTaskStatus,
  extractPriceFromContent,
  generateSimpleId,
};
