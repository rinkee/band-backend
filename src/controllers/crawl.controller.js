// src/controllers/crawl.controller.js - 수정된 버전
const { BandPosts, BandComments, utils } = require("../services/crawler/band");

const { supabase } = require("../config/supabase");
const logger = require("../config/logger");
const fs = require("fs").promises;
const path = require("path");
// 상품 처리 서비스 추가
const {
  processBulkProducts,
  processAndSaveProduct,
} = require("../services/products.service");

// 쿠키 저장 경로 설정
const COOKIES_PATH = path.join(__dirname, "../../../cookies");

// 가격 추출 함수와 ID 생성 함수는 utils에서 가져옴
const { extractPriceFromContent, generateSimpleId } = utils;

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

    // 쿠키 생성 후 24시간이 지났는지 확인
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
      .eq("user_id", userId)
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
      bandNumber: userData.band_number,
    };
  } catch (error) {
    logger.error(`사용자 정보 조회 중 오류: ${error.message}`);
    return null;
  }
};

/**
 * 크롤링 상태 기록을 위한 맵
 */
const taskStatusMap = new Map();

/**
 * 작업 상태 조회
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
    const task = taskStatusMap.get(taskId);

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
  constructor() {
    // 인스턴스 초기화 시 taskStatusMap 속성 설정
    this.taskStatusMap = taskStatusMap;
  }

  /**
   * 게시물 상세 정보 크롤링 시작
   */
  async startPostDetailCrawling(req, res) {
    let crawler = null;
    const taskId = `task_${Date.now()}`;

    try {
      // URL 경로 매개변수에서 bandNumber 가져오기
      const { bandNumber } = req.params;
      const { userId, maxPosts, processProducts } = req.body;

      // bandNumber 검증
      if (!bandNumber) {
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

      // 태스크 상태 초기화
      this.taskStatusMap.set(taskId, {
        status: "pending",
        message: "크롤링 작업 준비 중...",
        progress: 0,
        startTime: new Date(),
      });

      // 응답을 먼저 보내고 백그라운드에서 크롤링 진행
      res.json({
        success: true,
        message: "게시물 상세 정보 크롤링이 시작되었습니다.",
        taskId, // 태스크 ID 반환
        data: {
          taskId,
          userId,
          bandNumber,
          maxPosts: maxPosts || 30,
          processProducts: processProducts || false,
        },
      });

      // BandPosts 인스턴스 생성 (모듈화된 코드 사용)
      crawler = new BandPosts(bandNumber, {
        numPostsToLoad: maxPosts || 30,
      });

      // 크롤링 작업 시작
      logger.info(`네이버 계정으로 밴드 크롤링 시작: ${userAccount.naverId}`);

      // 상태 업데이트 함수 추가
      crawler.onStatusUpdate = (status, message, progress) => {
        this.taskStatusMap.set(taskId, {
          status,
          message,
          progress,
          updatedAt: new Date().toISOString(),
        });
      };

      // 게시물 상세 정보 크롤링
      const result = await crawler.crawlPostDetail(
        userAccount.naverId,
        userAccount.naverPassword,
        maxPosts || 30
      );

      // 결과 처리 및 Supabase에 저장
      if (result && result.success && result.data && result.data.length > 0) {
        this.taskStatusMap.set(taskId, {
          status: "processing",
          message: `${result.data.length}개의 게시물 상세 정보를 저장합니다.`,
          progress: 85,
          updatedAt: new Date().toISOString(),
        });

        // processProducts 파라미터를 전달하여 저장 시 AI 처리를 함께 수행
        await crawler.saveDetailPostsToSupabase(result.data, userId, true);

        // AI 처리 완료 후 상태 업데이트
        this.taskStatusMap.set(taskId, {
          status: "completed",
          message: `${
            result.data.length
          }개의 게시물 상세 정보가 저장되었습니다${
            processProducts === true ? " (상품 정보 AI 추출 포함)" : ""
          }.`,
          progress: 100,
          completedAt: new Date().toISOString(),
        });
      } else {
        this.taskStatusMap.set(taskId, {
          status: "failed",
          message: `게시물 상세 정보 크롤링 실패: ${
            result ? result.error : "알 수 없는 오류"
          }`,
          progress: 0,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error("게시물 상세 정보 크롤링 오류:", error);

      // 에러 상태 업데이트
      this.taskStatusMap.set(taskId || `error_task_${Date.now()}`, {
        status: "failed",
        message: `크롤링 실패: ${error.message}`,
        progress: 0,
        error: error.message,
        endTime: new Date(),
      });
    } finally {
      // 브라우저 리소스 정리
      try {
        if (crawler && crawler.close) {
          logger.info("크롤링 완료 후 브라우저 리소스 정리 시작");
          await crawler.close();

          // 브라우저가 종료되었는지 확인
          if (!crawler.browser) {
            logger.info("브라우저 리소스 정리 완료");

            // 작업 상태 업데이트
            const currentStatus = this.taskStatusMap.get(taskId);
            if (currentStatus) {
              this.taskStatusMap.set(taskId, {
                ...currentStatus,
                message: currentStatus.message + " (브라우저 종료됨)",
              });
            }
          } else {
            logger.warn(
              "브라우저가 여전히 종료되지 않았습니다. 강제 종료 시도..."
            );

            // 강제 종료 시도
            try {
              if (
                crawler.browser &&
                typeof crawler.browser.close === "function"
              ) {
                await crawler.browser.close().catch(() => {});
                crawler.browser = null;
                crawler.page = null;
                logger.info("브라우저 강제 종료 성공");
              }
            } catch (forceCloseError) {
              logger.error(
                `브라우저 강제 종료 중 오류: ${forceCloseError.message}`
              );
              crawler.browser = null;
              crawler.page = null;
            }
          }
        }
      } catch (closeError) {
        logger.error(`브라우저 종료 오류: ${closeError.message}`);

        // 오류가 발생해도 참조는 정리
        if (crawler) {
          crawler.browser = null;
          crawler.page = null;
        }
      }
    }
  }

  /**
   * 특정 게시물의 댓글만 크롤링하여 저장
   */
  async getCommentsOnly(req, res) {
    let crawler = null;
    const taskId = `task_comments_${Date.now()}`;

    try {
      const { bandNumber, postId } = req.params;
      const { userId } = req.body;

      // 필수 매개변수 검증
      if (!bandNumber || !postId) {
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

      // 태스크 상태 초기화
      this.taskStatusMap.set(taskId, {
        status: "pending",
        message: "댓글 크롤링 작업 준비 중...",
        progress: 0,
        startTime: new Date().toISOString(),
      });

      // 응답을 먼저 보내고 백그라운드에서 크롤링 진행
      res.json({
        success: true,
        message: "댓글 크롤링이 시작되었습니다. 진행 상황은 로그를 확인하세요.",
        data: {
          taskId,
          userId,
          bandNumber,
          postId,
          startTime: new Date().toISOString(),
        },
      });

      // BandComments 인스턴스 생성 (모듈화된 코드 사용)
      crawler = new BandComments(bandNumber);

      // 상태 업데이트 함수 추가
      crawler.onStatusUpdate = (status, message, progress) => {
        this.taskStatusMap.set(taskId, {
          status,
          message,
          progress,
          updatedAt: new Date().toISOString(),
        });
      };

      // 댓글 크롤링 작업 시작
      this.taskStatusMap.set(taskId, {
        status: "processing",
        message: "댓글 크롤링 시작",
        progress: 10,
        updatedAt: new Date().toISOString(),
      });

      // 특정 게시물의 댓글만 크롤링
      const result = await crawler.crawlPostComments(
        userAccount.naverId,
        userAccount.naverPassword,
        postId
      );

      if (result && result.success && result.data) {
        this.taskStatusMap.set(taskId, {
          status: "processing",
          message: `${
            result.data.comments?.length || 0
          }개의 댓글을 저장합니다.`,
          progress: 80,
          updatedAt: new Date().toISOString(),
        });

        // 댓글을 Supabase에 저장
        const saveResult = await crawler.saveCommentsToSupabase(result.data);

        if (saveResult.success) {
          this.taskStatusMap.set(taskId, {
            status: "completed",
            message: saveResult.message,
            progress: 100,
            count: saveResult.count,
            completedAt: new Date().toISOString(),
          });
        } else {
          this.taskStatusMap.set(taskId, {
            status: "failed",
            message: `댓글 저장 실패: ${saveResult.error}`,
            progress: 85,
            updatedAt: new Date().toISOString(),
          });
        }
      } else {
        this.taskStatusMap.set(taskId, {
          status: "failed",
          message: `댓글 크롤링 실패: ${
            result ? result.error : "알 수 없는 오류"
          }`,
          progress: 0,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error("댓글 크롤링 오류:", error);

      // 에러 상태 업데이트
      this.taskStatusMap.set(taskId, {
        status: "failed",
        message: `크롤링 오류: ${error.message}`,
        progress: 0,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      // 브라우저 리소스 정리
      try {
        if (crawler && crawler.close) {
          logger.info("크롤링 완료 후 브라우저 리소스 정리 시작");
          await crawler.close();

          // 브라우저가 종료되었는지 확인
          if (!crawler.browser) {
            logger.info("브라우저 리소스 정리 완료");

            // 작업 상태 업데이트
            const currentStatus = this.taskStatusMap.get(taskId);
            if (currentStatus) {
              this.taskStatusMap.set(taskId, {
                ...currentStatus,
                message: currentStatus.message + " (브라우저 종료됨)",
              });
            }
          } else {
            logger.warn(
              "브라우저가 여전히 종료되지 않았습니다. 강제 종료 시도..."
            );

            // 강제 종료 시도
            try {
              if (
                crawler.browser &&
                typeof crawler.browser.close === "function"
              ) {
                await crawler.browser.close().catch(() => {});
                crawler.browser = null;
                crawler.page = null;
                logger.info("브라우저 강제 종료 성공");
              }
            } catch (forceCloseError) {
              logger.error(
                `브라우저 강제 종료 중 오류: ${forceCloseError.message}`
              );
              crawler.browser = null;
              crawler.page = null;
            }
          }
        }
      } catch (closeError) {
        logger.error(`브라우저 종료 오류: ${closeError.message}`);

        // 오류가 발생해도 참조는 정리
        if (crawler) {
          crawler.browser = null;
          crawler.page = null;
        }
      }
    }
  }

  /**
   * 게시물 목록 정보만 크롤링하여 저장
   */
  async getPostsInfoOnly(req, res) {
    let crawler = null;
    const taskId = `task_post_list_${Date.now()}`;

    try {
      const { bandNumber } = req.params;
      const { userId, maxPosts } = req.body;

      // 필수 매개변수 검증
      if (!bandNumber) {
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

      // 태스크 상태 초기화
      this.taskStatusMap.set(taskId, {
        status: "pending",
        message: "게시물 목록 크롤링 작업 준비 중...",
        progress: 0,
        startTime: new Date().toISOString(),
      });

      // 응답을 먼저 보내고 백그라운드에서 크롤링 진행
      res.status(200).json({
        success: true,
        message: "게시물 목록 크롤링이 시작되었습니다.",
        data: {
          taskId,
          userId,
          bandNumber,
          maxPosts: maxPosts || 50,
        },
      });

      // BandPosts 인스턴스 생성 (모듈화된 코드 사용)
      crawler = new BandPosts(bandNumber, {
        numPostsToLoad: maxPosts || 20,
      });

      // 상태 업데이트 함수 추가
      crawler.onStatusUpdate = (status, message, progress) => {
        this.taskStatusMap.set(taskId, {
          status,
          message,
          progress,
          updatedAt: new Date().toISOString(),
        });
      };

      // 크롤링 작업 시작
      this.taskStatusMap.set(taskId, {
        status: "processing",
        message: "게시물 목록 크롤링 시작",
        progress: 10,
        updatedAt: new Date().toISOString(),
      });

      // 실제 크롤링 실행
      const result = await crawler.crawlPostDetail(
        userAccount.naverId,
        userAccount.naverPassword,
        maxPosts || 20
      );

      // 결과 처리
      if (result && result.success && result.data) {
        this.taskStatusMap.set(taskId, {
          status: "completed",
          message: `게시물 목록 크롤링 완료: ${result.data.length}개 게시물`,
          progress: 100,
          completedAt: new Date().toISOString(),
        });
        logger.info(`게시물 목록 크롤링 완료: ${result.data.length}개 게시물`);
      } else {
        this.taskStatusMap.set(taskId, {
          status: "failed",
          message: `게시물 목록 크롤링 실패: ${
            result ? result.error : "알 수 없는 오류"
          }`,
          progress: 0,
          updatedAt: new Date().toISOString(),
        });
        logger.error(
          `게시물 목록 크롤링 실패: ${
            result ? result.error : "알 수 없는 오류"
          }`
        );
      }
    } catch (error) {
      logger.error("게시물 목록 크롤링 오류:", error);

      // 에러 상태 업데이트
      this.taskStatusMap.set(taskId, {
        status: "failed",
        message: `크롤링 오류: ${error.message}`,
        progress: 0,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      // 브라우저 리소스 정리
      try {
        if (crawler && crawler.close) {
          logger.info("크롤링 완료 후 브라우저 리소스 정리 시작");
          await crawler.close();

          // 브라우저가 종료되었는지 확인
          if (!crawler.browser) {
            logger.info("브라우저 리소스 정리 완료");

            // 작업 상태 업데이트
            const currentStatus = this.taskStatusMap.get(taskId);
            if (currentStatus) {
              this.taskStatusMap.set(taskId, {
                ...currentStatus,
                message: currentStatus.message + " (브라우저 종료됨)",
              });
            }
          } else {
            logger.warn(
              "브라우저가 여전히 종료되지 않았습니다. 강제 종료 시도..."
            );

            // 강제 종료 시도
            try {
              if (
                crawler.browser &&
                typeof crawler.browser.close === "function"
              ) {
                await crawler.browser.close().catch(() => {});
                crawler.browser = null;
                crawler.page = null;
                logger.info("브라우저 강제 종료 성공");
              }
            } catch (forceCloseError) {
              logger.error(
                `브라우저 강제 종료 중 오류: ${forceCloseError.message}`
              );
              crawler.browser = null;
              crawler.page = null;
            }
          }
        }
      } catch (closeError) {
        logger.error(`브라우저 종료 오류: ${closeError.message}`);

        // 오류가 발생해도 참조는 정리
        if (crawler) {
          crawler.browser = null;
          crawler.page = null;
        }
      }
    }
  }

  /**
   * 크롤링한 게시물에서 상품 정보 추출 (별도 엔드포인트)
   */
  async extractProductInfo(req, res) {
    const taskId = `task_extract_${Date.now()}`;

    try {
      const { bandNumber } = req.params;
      const { userId, postIds } = req.body;

      // 매개변수 검증
      if (!bandNumber) {
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

      if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "처리할 게시물 ID 목록이 필요합니다.",
        });
      }

      // 태스크 상태 초기화
      this.taskStatusMap.set(taskId, {
        status: "pending",
        message: "상품 정보 추출 준비 중...",
        progress: 0,
        startTime: new Date().toISOString(),
      });

      // 응답 먼저 보내기
      res.json({
        success: true,
        message: "상품 정보 추출이 시작되었습니다.",
        taskId,
        data: {
          taskId,
          userId,
          bandNumber,
          postCount: postIds.length,
        },
      });

      // Supabase에서 게시물 데이터 조회
      this.taskStatusMap.set(taskId, {
        status: "processing",
        message: "Supabase에서 게시물 데이터를 조회합니다.",
        progress: 10,
        updatedAt: new Date().toISOString(),
      });

      // 올바른 테이블 이름('posts')과 열 이름을 사용
      const { data: postsData, error } = await supabase
        .from("posts")
        .select("*")
        .eq("band_number", bandNumber)
        .in("post_number", postIds);

      if (error) {
        throw new Error(`게시물 데이터 조회 오류: ${error.message}`);
      }

      if (!postsData || postsData.length === 0) {
        this.taskStatusMap.set(taskId, {
          status: "failed",
          message: "처리할 게시물이 없습니다.",
          progress: 0,
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      this.taskStatusMap.set(taskId, {
        status: "processing",
        message: `${postsData.length}개의 게시물에서 상품 정보를 추출합니다.`,
        progress: 30,
        updatedAt: new Date().toISOString(),
      });

      // 처리 가능한 형식으로 데이터 변환 (열 이름 매핑 수정)
      const processableData = postsData.map((post) => ({
        bandNumber: bandNumber,
        postId: post.post_number.toString(),
        title: post.title,
        content: post.content,
        url: post.band_post_url,
      }));

      // 상품 정보 추출 및 저장
      const productResults = await processBulkProducts(processableData, userId);

      this.taskStatusMap.set(taskId, {
        status: "completed",
        message: `상품 정보 처리 완료: 성공 ${productResults.success}개, 실패 ${productResults.failed}개`,
        progress: 100,
        productResults,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("상품 정보 추출 오류:", error);

      this.taskStatusMap.set(taskId, {
        status: "failed",
        message: `상품 정보 추출 실패: ${error.message}`,
        progress: 0,
        error: error.message,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * 특정 게시물의 콘텐츠를 테스트용으로 처리
   */
  async testProductExtraction(req, res) {
    try {
      const { content, title, postId, bandNumber, userId } = req.body;

      if (!content) {
        return res.status(400).json({
          success: false,
          message: "게시물 콘텐츠가 필요합니다.",
        });
      }

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "사용자 ID가 필요합니다.",
        });
      }

      const testPostData = {
        bandNumber: bandNumber || "test_band",
        postId: postId || `test_${Date.now()}`,
        title: title || "테스트 게시물",
        content,
        url: null,
      };

      // 상품 정보 추출 및 저장
      const productData = await processAndSaveProduct(testPostData, userId);

      return res.status(200).json({
        success: true,
        message: "상품 정보 추출 및 저장 성공",
        data: productData,
      });
    } catch (error) {
      logger.error("테스트 추출 오류:", error);
      return res.status(500).json({
        success: false,
        message: "상품 정보 추출 중 오류가 발생했습니다.",
        error: error.message,
      });
    }
  }
}

module.exports = {
  CrawlController,
  getTaskStatus,
  extractPriceFromContent,
  generateSimpleId,
};
