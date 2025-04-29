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
const { extractPriceFromContent, generateSimpleId, updateTaskStatusInDB } =
  utils;

// --- 실제 크롤링 로직을 수행하는 내부 함수 ---
// 이 함수는 req, res를 직접 받지 않고 필요한 데이터만 받습니다.
async function _performCrawling(params) {
  let crawler = null;
  const {
    userId,
    bandNumber,
    maxPosts,
    processProducts,
    taskId,
    daysLimit,
    maxScrollAttempts,
  } = params;

  try {
    // <<<--- 작업 시작 시 DB 레코드 생성 --- START --->>>
    const { data: insertData, error: insertError } = await supabase
      .from("crawl_tasks")
      .insert({
        task_id: taskId,
        user_id: userId,
        band_number: bandNumber,
        status: "initializing",
        message: "작업 초기화 중...",
        progress: 2,
        start_time: new Date().toISOString(),
        params: params, // 요청 파라미터 저장
      })
      .select();

    if (insertError) {
      logger.error(
        `!!! DB 작업 레코드 생성 실패 (Task ID: ${taskId}): ${insertError.message}`,
        insertError
      );
      // 이 경우 taskId가 DB에 없으므로 폴링은 계속 404를 반환할 것임
    } else {
      logger.info(
        `DB 작업 레코드 생성 성공 (Task ID: ${taskId}), Data: ${JSON.stringify(
          insertData
        )}`
      );
    }

    // <<<--- 작업 시작 시 DB 레코드 생성 --- END --->>>

    await updateTaskStatusInDB(taskId, "processing", "계정 정보 확인 중...", 5);

    // 1. 사용자 계정 정보 조회
    const userAccount = await getUserNaverAccount(userId); // 아래에 정의된 함수 사용
    if (!userAccount) {
      throw new Error(
        `네이버 계정 정보를 가져올 수 없습니다 (userId: ${userId}).`
      );
    }

    // 2. 작업 상태 업데이트 (시작)
    taskStatusMap.set(taskId, {
      status: "processing",
      message: "크롤링 엔진 초기화 및 로그인 시도...",
      progress: 5,
      updatedAt: new Date().toISOString(),
      params, // 전달받은 파라미터 저장
    });

    await updateTaskStatusInDB(
      taskId,
      "processing",
      "업데이트 엔진 초기화 및 로그인 시도...",
      10
    );

    // 3. 크롤러 인스턴스 생성
    crawler = new BandPosts(bandNumber, { numPostsToLoad: maxPosts || 30 });

    // <<<--- 여기가 중요! 크롤러에게 "상태 바뀌면 이 함수(updateTaskStatusInDB) 호출해줘" 라고 알려주는 부분 --->>>
    crawler.setOnStatusUpdate(updateTaskStatusInDB);
    // taskId를 crawler 인스턴스에 저장하여 콜백 함수 내에서 사용할 수 있도록 함 (선택적이지만 권장)
    crawler.taskId = taskId;

    // 4. 상태 업데이트 콜백 설정
    crawler.onStatusUpdate = (status, message, progress) => {
      taskStatusMap.set(taskId, {
        status,
        message,
        progress,
        updatedAt: new Date().toISOString(),
        params,
      });
    };

    await updateTaskStatusInDB(
      taskId,
      "processing",
      "밴드 페이지 접속 및 데이터 업데이트 시작...",
      20
    );

    // 5. 크롤링 실행 - maxScrollAttempts 파라미터 전달
    const result = await crawler.crawlAndSave(
      userId,
      userAccount.naverId,
      userAccount.naverPassword,
      maxScrollAttempts || 50, // <<<--- params에서 받은 maxScrollAttempts 사용 (기본값 50)
      processProducts ?? true,
      daysLimit,
      taskId
    );

    await updateTaskStatusInDB(
      taskId,
      "processing",
      "밴드 페이지 접속 및 데이터 업데이트 완료",
      50
    );

    // <<<--- 수정된 로직 --- START --->>>
    // 1. 명시적인 실패 확인: success가 false이거나 result 객체 자체가 없는 경우만 에러 처리
    if (!result || !result.success) {
      const errorMessage = result?.error || "알 수 없는 크롤링 오류 발생";
      await updateTaskStatusInDB(
        taskId,
        "failed",
        `업데이트 실패: ${errorMessage}`,
        crawler.lastProgress || 95,
        errorMessage
      ); // 실패 시 progress는 마지막 값 유지 시도
      logger.error(
        `백그라운드 크롤링 오류 (Task ID: ${taskId}): ${errorMessage}`
      );
      throw new Error(errorMessage);
    }

    // 2. 성공했지만 처리할 데이터가 없는 경우: 정상 완료 로그 남기고 종료 (에러 아님)
    if (result.success && result.data.length === 0) {
      logger.info(
        `크롤링 작업 완료 (Task ID: ${taskId}): 처리할 새로운 데이터 없음.`
      );
      await updateTaskStatusInDB(
        taskId,
        "completed",
        "업데이트 완료 (처리할 새 데이터 없음)",
        100
      );

      // throw new Error(...) 부분을 제거하거나 주석 처리
    } else {
      // 3. 성공했고 처리한 데이터가 있는 경우: 기존 로그 유지
      logger.info(
        `크롤링 작업 완료 (Task ID: ${taskId}): ${result.data.length}개 처리됨.`
      );
      await updateTaskStatusInDB(
        taskId,
        "completed",
        "업데이트 완료 (처리된 데이터 있음)",
        100
      );
    }

    // 6. 결과 처리 및 저장
    if (result?.success && result.data?.length > 0) {
      taskStatusMap.set(taskId, {
        status: "processing",
        message: `${result.data.length}개 저장 중...`,
        progress: 85,
        updatedAt: new Date().toISOString(),
        params,
      });
      // processProducts 기본값 true로 설정
      // await crawler.saveDetailPostsToSupabase(
      //   result.data,
      //   userId,
      //   processProducts ?? true
      // );
      taskStatusMap.set(taskId, {
        status: "completed",
        message: `${result.data.length}개 저장 완료`,
        progress: 100,
        completedAt: new Date().toISOString(),
        params,
      });
      await updateTaskStatusInDB(
        taskId,
        "completed",
        "업데이트 완료 (처리된 데이터 있음)",
        100
      );
      logger.info(
        `크롤링 작업 완료 (Task ID: ${taskId}): ${result.data.length}개 저장`
      );
    } else {
      // 크롤링은 성공했으나 데이터가 없는 경우도 성공으로 처리할지, 오류로 처리할지 결정 필요
      // 여기서는 오류로 간주
      throw new Error(result?.error || "크롤링된 데이터가 없습니다.");
      await updateTaskStatusInDB(
        taskId,
        "completed",
        "업데이트 완료 (처리된 데이터 있음)",
        100
      );
    }
  } catch (error) {
    // 7. 오류 처리
    logger.error(
      `백그라운드 크롤링 오류 (Task ID: ${taskId}): ${error.message}`,
      error.stack
    ); // 스택 트레이스 로깅 추가
    await updateTaskStatusInDB(
      taskId,
      "failed",
      `업데이트 실패: ${error.message}`,
      0,
      error.message
    );
    taskStatusMap.set(taskId, {
      status: "failed",
      message: `크롤링 실패: ${error.message}`,
      progress: 0,
      error: error.message,
      stack: error.stack, // 스택 정보도 저장 (디버깅용)
      endTime: new Date(),
      params,
    });
    // 오류를 다시 던져서 호출한 쪽(스케줄러 등)에서도 알 수 있게 함
    throw error;
  } finally {
    // 8. 리소스 정리 (오류 발생 여부와 관계없이 실행)
    if (crawler && crawler.close) {
      try {
        logger.info(`리소스 정리 시작 (Task ID: ${taskId})`);
        await crawler.close();
        logger.info(`리소스 정리 완료 (Task ID: ${taskId})`);
        const currentStatus = taskStatusMap.get(taskId);
        if (currentStatus && currentStatus.status !== "failed") {
          taskStatusMap.set(taskId, {
            ...currentStatus,
            message: currentStatus.message + " (리소스 정리됨)",
          });
        }
      } catch (closeError) {
        logger.error(
          `리소스 정리 오류 (Task ID: ${taskId}): ${closeError.message}`
        );
      }
    }
  }
}
// --- 내부 함수 끝 ---

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
      .select("user_id, naver_id, naver_password, band_number") // 필요한 컬럼만 명시적 선택 권장
      .eq("user_id", userId)
      .single();

    if (error) {
      // 사용자가 없는 경우(supabase single()에서 에러 발생)는 일반적일 수 있으므로 warn 레벨 고려
      if (error.code === "PGRST116") {
        // PostgREST 에러 코드 (정확한 코드 확인 필요)
        logger.warn(
          `사용자 조회 실패 (아마도 존재하지 않음) (${userId}): ${error.message}`
        );
      } else {
        logger.error(`사용자 조회 오류 (${userId}):`, error);
      }
      return null;
    }

    if (!userData.naver_id || !userData.naver_password) {
      logger.error(`네이버 계정 정보가 설정되지 않았습니다: ${userId}`);
      return null;
    }

    return {
      userId: userData.user_id,
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
 * DB에서 작업 상태를 조회하는 함수
 * @param {string} taskId - 작업 ID
 * @returns {Promise<Object>} - 작업 상태 객체
 */
const getTaskStatus = async (req, res) => {
  // async 추가
  try {
    const { taskId } = req.params;

    if (!taskId) {
      return res
        .status(400)
        .json({ success: false, message: "작업 ID가 필요합니다." });
    }

    // DB에서 작업 상태 조회
    const { data: task, error } = await supabase
      .from("crawl_tasks")
      .select("*")
      .eq("task_id", taskId)
      .single();

    if (error && error.code !== "PGRST116") {
      // 존재하지 않는 경우 외의 DB 오류
      logger.error(
        `DB 작업 상태 조회 오류 (Task ID: ${taskId}): ${error.message}`
      );
      throw error;
    }

    if (!task) {
      return res
        .status(404)
        .json({ success: false, message: "작업을 찾을 수 없습니다." });
    }

    // password 등 민감 정보 제거 후 반환 (params에 저장했다면)
    if (task.params) {
      delete task.params.naverPassword;
    }

    res.json({ success: true, task });
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

  async startPostDetailCrawling(req, res, next) {
    // Express 핸들러 표준 인자
    const taskId = `task_http_${Date.now()}`; // HTTP 요청임을 나타내는 ID
    let bandNumber, userId, maxPosts, processProducts, daysLimit;

    try {
      // 1. 요청에서 파라미터 추출 및 검증
      bandNumber = req.params?.bandNumber;
      // 인증 미들웨어를 사용한다면 req.user.userId 같은 방식이 더 안전할 수 있음
      userId = req.body?.userId || req.user?.userId;
      maxPosts = req.body?.maxPosts;
      processProducts = req.body?.processProducts;
      daysLimit = req.body?.daysLimit;

      if (!bandNumber || !userId) {
        // 요청 데이터 로그 추가 (디버깅 시 유용)
        logger.warn(
          `잘못된 크롤링 요청: bandNumber=${bandNumber}, userId=${userId}`
        );
        return res.status(400).json({
          success: false,
          message: "밴드 ID와 사용자 ID는 필수입니다.",
        });
      }

      // 2. Task 초기 상태 설정
      const initialParams = {
        userId,
        bandNumber,
        maxPosts,
        processProducts,
        taskId,
        daysLimit,
      };
      this.taskStatusMap.set(taskId, {
        status: "pending",
        message: "크롤링 작업 요청 접수됨 (HTTP)",
        progress: 0,
        startTime: new Date(),
        params: initialParams,
      });

      // --- 중요: 3. 클라이언트에게 즉시 응답 ---
      res.status(200).json({
        success: true,
        message: "크롤링 작업이 시작되었습니다. 백그라운드에서 실행됩니다.",
        taskId,
        data: { taskId, ...initialParams }, // 요청 정보 포함하여 반환
      });
      // --- 응답 끝 ---

      // --- 중요: 4. 백그라운드에서 실제 크롤링 로직 실행 ---
      // setImmediate나 process.nextTick으로 감싸면 이벤트 루프에 더 빨리 넘길 수 있음
      setImmediate(() => {
        _performCrawling({ ...initialParams, taskId })
          .then(() => {
            logger.info(
              `백그라운드 크롤링 작업 성공적으로 완료됨 (Task ID: ${taskId})`
            );
          })
          .catch((err) => {
            // 백그라운드에서 발생한 오류는 _performCrawling 내부에서 이미 로깅됨
            // 추가 로깅이나 처리가 필요하다면 여기에 작성
            logger.error(
              `(추가 로깅) 백그라운드 크롤링 실패 (Task ID: ${taskId}): ${err.message}`
            );
          });
      });
      // --- 백그라운드 실행 끝 ---
    } catch (error) {
      // 동기적 요청 처리 중 오류 (예: 파라미터 검증 실패 등은 위에서 처리됨)
      // 주로 예상치 못한 내부 서버 오류
      logger.error(
        `크롤링 HTTP 요청 처리 중 심각한 오류 (Task ID: ${taskId}): ${error.message}`,
        error.stack
      );
      // 응답을 아직 보내지 않았다면 (거의 발생하지 않겠지만 방어 코드)
      if (!res.headersSent) {
        this.taskStatusMap.set(taskId || `error_task_${Date.now()}`, {
          status: "failed",
          message: `요청 처리 중 심각한 오류: ${error.message}`,
          error: error.message,
          endTime: new Date(),
        });
        return res.status(500).json({
          success: false,
          message: "크롤링 요청 처리 중 서버 오류 발생",
          error: error.message,
          taskId,
        });
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
        userId,
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

  /**
   * 특정 게시물 ID를 받아 해당 게시물만 크롤링하고 상품 정보 추출/저장
   */
  async crawlSinglePostDetail(req, res, next) {
    const taskId = `task_single_${Date.now()}`;
    let bandNumber, postId, userId;

    try {
      // 1. 요청 파라미터 추출 및 검증
      bandNumber = req.params?.bandNumber;
      postId = req.params?.postId;
      userId = req.body?.userId || req.user?.userId;

      if (!bandNumber || !postId || !userId) {
        logger.warn(
          `잘못된 단일 게시물 크롤링 요청: bandNumber=${bandNumber}, postId=${postId}, userId=${userId}`
        );
        return res.status(400).json({
          success: false,
          message: "밴드 ID, 게시물 ID, 사용자 ID는 필수입니다.",
        });
      }

      // 2. Task 초기 상태 설정
      const initialParams = { userId, bandNumber, postId };
      this.taskStatusMap.set(taskId, {
        status: "pending",
        message: "단일 게시물 크롤링 작업 요청 접수됨",
        progress: 0,
        startTime: new Date(),
        params: initialParams,
      });

      // 3. 클라이언트에게 즉시 응답
      res.status(200).json({
        success: true,
        message:
          "단일 게시물 크롤링 및 처리 작업이 시작되었습니다. 백그라운드에서 실행됩니다.",
        taskId,
        data: { taskId, ...initialParams },
      });

      // 4. 백그라운드에서 실제 작업 실행
      setImmediate(async () => {
        let crawler = null;
        try {
          // 4-1. 사용자 계정 정보 조회
          const userAccount = await getUserNaverAccount(userId);
          if (!userAccount) {
            throw new Error(`네이버 계정 정보를 가져올 수 없습니다.`);
          }

          // 4-2. 작업 상태 업데이트 (시작)
          this.taskStatusMap.set(taskId, {
            status: "processing",
            message: "크롤링 엔진 초기화 및 로그인 시도...",
            progress: 5,
            updatedAt: new Date().toISOString(),
            params: initialParams,
          });

          // 4-3. 크롤러 인스턴스 생성
          crawler = new BandPosts(bandNumber); // 단일 게시물이므로 maxPosts 옵션 불필요

          // 4-4. 상태 업데이트 콜백 설정
          crawler.onStatusUpdate = (status, message, progress) => {
            // progress를 5% ~ 70% 사이로 조정 (크롤링 단계)
            const adjustedProgress = 5 + Math.floor(progress * 0.65);
            this.taskStatusMap.set(taskId, {
              status, // 크롤러 상태 반영
              message,
              progress: adjustedProgress,
              updatedAt: new Date().toISOString(),
              params: initialParams,
            });
          };

          // 4-5. 특정 게시물 크롤링 실행
          // !!! 중요: BandPosts 클래스에 crawlSinglePost 메서드가 구현되어 있어야 함 !!!
          // crawlSinglePost는 postId를 인자로 받아 해당 게시물 데이터만 반환해야 함
          // 반환 형식은 { success: boolean, data: postData | null, error: string | null } 형태를 가정
          const crawlResult = await crawler.crawlSinglePostDetail(
            userId, // 필요하다면 userId 전달
            userAccount.naverId,
            userAccount.naverPassword,
            postId
          );

          if (!crawlResult || !crawlResult.success || !crawlResult.data) {
            throw new Error(
              crawlResult?.error || "게시물 크롤링에 실패했습니다."
            );
          }

          // 4-6. 상품 정보 처리 및 저장
          this.taskStatusMap.set(taskId, {
            status: "processing",
            message: "게시물에서 상품 정보 추출 및 저장 중...",
            progress: 70,
            updatedAt: new Date().toISOString(),
            params: initialParams,
          });

          // processAndSaveProduct가 크롤링된 단일 게시물 데이터를 처리할 수 있어야 함
          // crawlSinglePost 결과의 data 형식이 processAndSaveProduct 입력과 맞는지 확인 필요
          // 예를 들어, processAndSaveProduct가 { bandNumber, postId, title, content, url, ... } 형태를 받는다고 가정
          const postDataForProcessing = {
            bandNumber: bandNumber,
            postId: postId, // crawlResult.data에 postId가 없다면 직접 넣어줌
            ...crawlResult.data, // 크롤링된 나머지 데이터 (title, content, url 등)
          };
          const productResult = await processAndSaveProduct(
            postDataForProcessing,
            userId
          );

          // 4-7. 최종 상태 업데이트 (완료)
          this.taskStatusMap.set(taskId, {
            status: "completed",
            message: `단일 게시물 처리 완료 (Post ID: ${postId})`,
            progress: 100,
            completedAt: new Date().toISOString(),
            params: initialParams,
            result: productResult, // 처리 결과 저장 (선택 사항)
          });
          logger.info(
            `단일 게시물 처리 완료 (Task ID: ${taskId}, Post ID: ${postId})`
          );
        } catch (error) {
          // 4-8. 오류 처리
          logger.error(
            `백그라운드 단일 게시물 처리 오류 (Task ID: ${taskId}): ${error.message}`,
            error.stack
          );
          this.taskStatusMap.set(taskId, {
            status: "failed",
            message: `처리 실패: ${error.message}`,
            progress: this.taskStatusMap.get(taskId)?.progress || 0, // 실패 시점의 progress 유지
            error: error.message,
            stack: error.stack,
            endTime: new Date(),
            params: initialParams,
          });
        } finally {
          // 4-9. 리소스 정리
          if (crawler && crawler.close) {
            try {
              logger.info(`리소스 정리 시작 (Task ID: ${taskId})`);
              await crawler.close();
              logger.info(`리소스 정리 완료 (Task ID: ${taskId})`);
              const currentStatus = this.taskStatusMap.get(taskId);
              if (currentStatus && currentStatus.status !== "failed") {
                this.taskStatusMap.set(taskId, {
                  ...currentStatus,
                  message: currentStatus.message + " (리소스 정리됨)",
                });
              }
            } catch (closeError) {
              logger.error(
                `리소스 정리 오류 (Task ID: ${taskId}): ${closeError.message}`
              );
            }
          }
        }
      }); // setImmediate 끝
    } catch (error) {
      // 동기적 요청 처리 중 오류
      logger.error(
        `단일 게시물 크롤링 HTTP 요청 처리 중 심각한 오류 (Task ID: ${taskId}): ${error.message}`,
        error.stack
      );
      if (!res.headersSent) {
        // taskId가 할당되기 전일 수 있으므로 방어 코드 추가
        const errorTaskId = taskId || `error_task_${Date.now()}`;
        this.taskStatusMap.set(errorTaskId, {
          status: "failed",
          message: `요청 처리 중 심각한 오류: ${error.message}`,
          error: error.message,
          endTime: new Date(),
        });
        return res.status(500).json({
          success: false,
          message: "단일 게시물 크롤링 요청 처리 중 서버 오류 발생",
          error: error.message,
          taskId: errorTaskId,
        });
      }
    }
  }
}

module.exports = {
  CrawlController,
  getTaskStatus,
  extractPriceFromContent,
  generateSimpleId,
  _performCrawling,
};
