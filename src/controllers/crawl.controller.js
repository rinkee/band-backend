// src/controllers/crawl.controller.js - 크롤링 컨트롤러
const crawlerService = require("../services/crawler.service");
const BandCrawler = require("../services/crawler/band.crawler");
const BaseCrawler = require("../services/crawler/base.crawler");
const PostService = require("../services/data/post.service");
const CommentService = require("../services/data/comment.service");
const logger = require("../config/logger");
const { getFirebaseDb } = require("../config/firebase");
const fs = require("fs").promises;
const path = require("path");

// 쿠키 저장 경로 설정
const COOKIES_PATH = path.join(__dirname, "../../../cookies");

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
    const db = getFirebaseDb();
    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      logger.error(`사용자를 찾을 수 없습니다: ${userId}`);
      return null;
    }

    const userData = userDoc.data();

    if (!userData.naverId || !userData.naverPassword) {
      logger.error(`네이버 계정 정보가 설정되지 않았습니다: ${userId}`);
      return null;
    }

    return {
      userId,
      naverId: userData.naverId,
      naverPassword: userData.naverPassword,
      bandId: userData.bandId,
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
  async startPostsCrawling(req, res) {
    // 크롤러 인스턴스 생성
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

      // userId 검증
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

      // 밴드 ID와 계정의 밴드 ID가 일치하는지 확인
      if (userAccount.bandId && userAccount.bandId !== bandId) {
        return res.status(400).json({
          success: false,
          message: "요청된 밴드 ID가 사용자의 밴드 ID와 일치하지 않습니다.",
        });
      }

      // 응답을 먼저 보내고 백그라운드에서 크롤링 진행
      res.json({
        success: true,
        message:
          "게시물 크롤링이 시작되었습니다. 진행 상황은 로그를 확인하세요.",
        data: {
          userId,
          bandId,
          naverId: userAccount.naverId,
          startTime: new Date().toISOString(),
        },
      });

      // BandCrawler 인스턴스 생성
      crawler = new BandCrawler(bandId, {
        numPostsToLoad: maxPosts || 30,
      });

      // 쿠키 유효성 확인
      const cookiesValid = await checkCookieValidity(userAccount.naverId);

      // 브라우저 초기화 및 필요시 로그인
      if (cookiesValid) {
        logger.info(`유효한 쿠키로 크롤링 시작: ${userAccount.naverId}`);
        // 유효한 쿠키로 초기화만 수행
        await crawler.initialize(userAccount.naverId);
      } else {
        logger.info(
          `쿠키 만료 또는 없음, 로그인 후 크롤링 시작: ${userAccount.naverId}`
        );
        // 쿠키가 유효하지 않으면 로그인 후 초기화
        await crawler.initialize(userAccount.naverId);
        await crawler.login(userAccount.naverId, userAccount.naverPassword);
      }

      // 게시물 크롤링 진행
      const result = await crawler.crawlPosts(
        userAccount.naverId,
        userAccount.naverPassword
      );

      if (result.success) {
        logger.info(
          `${result.data.length}개의 게시물을 성공적으로 크롤링했습니다.`
        );
      } else {
        logger.error(`게시물 크롤링 실패: ${result.error}`);
      }
    } catch (error) {
      logger.error("게시물 크롤링 오류:", error);
    } finally {
      // 브라우저 리소스 정리
      try {
        if (crawler && crawler.close) {
          await crawler.close();
        }
      } catch (closeError) {
        logger.error("브라우저 종료 오류:", closeError);
      }
    }
  }

  async startCommentsCrawling(req, res) {
    let crawler = null;

    try {
      const { bandId, postId } = req.params;
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "사용자 ID가 필요합니다.",
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

      // 새로운 크롤링 방식(페이지 이동)으로 인해 인스턴스 생성
      crawler = new BandCrawler(bandId);

      // 쿠키 유효성 확인
      const cookiesValid = await checkCookieValidity(userAccount.naverId);

      // 브라우저 초기화 및 필요시 로그인
      if (cookiesValid) {
        logger.info(`유효한 쿠키로 댓글 크롤링 시작: ${userAccount.naverId}`);
        await crawler.initialize(userAccount.naverId);
      } else {
        logger.info(
          `쿠키 만료 또는 없음, 로그인 후 댓글 크롤링 시작: ${userAccount.naverId}`
        );
        await crawler.initialize(userAccount.naverId);
        await crawler.login(userAccount.naverId, userAccount.naverPassword);
      }

      // 직접 게시물 URL로 이동하여 댓글 추출
      const postUrl = `https://band.us/band/${bandId}/post/${postId}`;
      logger.info(`게시물 URL로 이동: ${postUrl}`);

      await crawler.page.goto(postUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      // 댓글 추출
      logger.info(`게시물 상세 정보 추출 시작`);
      const postDetail = await crawler._extractPostDetailFromPopup();
      const comments = postDetail ? postDetail.comments : [];

      logger.info(`${comments.length}개의 댓글을 추출했습니다.`);

      // 댓글 저장
      const savedComments = await CommentService.saveComments(postId, comments);
      logger.info(`${savedComments.length}개의 댓글을 저장했습니다.`);
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

      // 쿠키 유효성 확인
      const cookiesValid = await checkCookieValidity(userAccount.naverId);

      // 브라우저 초기화 및 필요시 로그인
      if (cookiesValid) {
        logger.info(
          `유효한 쿠키로 상세 게시물 크롤링 시작: ${userAccount.naverId}`
        );
        await crawler.initialize(userAccount.naverId);
      } else {
        logger.info(
          `쿠키 만료 또는 없음, 로그인 후 상세 게시물 크롤링 시작: ${userAccount.naverId}`
        );
        await crawler.initialize(userAccount.naverId);
        await crawler.login(userAccount.naverId, userAccount.naverPassword);
      }

      // crawlPostDetail 호출 - 로그인 단계는 이미 처리했으므로 생략
      logger.info(`게시물 상세 정보 크롤링 시작 (최대 ${maxPosts || 30}개)`);
      const result = await crawler.crawlPostDetail(
        userAccount.naverId,
        userAccount.naverPassword,
        maxPosts || 30
      );

      // 결과 처리 및 Firebase에 저장
      if (result.success) {
        logger.info(
          `${result.data.length}개의 게시물 상세 정보를 크롤링했습니다.`
        );
        await crawler.saveDetailPostsToFirebase(result.data);
        logger.info(`크롤링한 게시물 데이터를 Firebase에 저장했습니다.`);
      } else {
        logger.error(`게시물 상세 정보 크롤링 실패: ${result.error}`);
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
}

module.exports = new CrawlController();
