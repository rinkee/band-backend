// src/services/scheduler.service.js - 정기적인 작업 스케줄링을 위한 서비스
const cron = require("node-cron");
const logger = require("../config/logger");
const { CrawlController } = require("../controllers/crawl.controller");
const userService = require("./user.service");

// 크롤링 컨트롤러 인스턴스 생성
const crawlController = new CrawlController();

// 활성화된 스케줄 작업 목록을 저장하는 맵
// key: jobId, value: { cron, description, status, lastRun, nextRun, task }
const scheduledJobs = new Map();

/**
 * 크론 표현식 유효성 검사 함수
 * @param {string} expression - 크론 표현식
 * @returns {boolean} - 유효한 표현식 여부
 */
const isValidCronExpression = (expression) => {
  return cron.validate(expression);
};

/**
 * 다음 실행 시간 계산 함수 (간단한 구현)
 * @param {string} expression - 크론 표현식
 * @returns {Date|null} - 다음 실행 시간
 */
const getNextExecutionTime = (expression) => {
  try {
    if (!isValidCronExpression(expression)) {
      return null;
    }

    // 간단한 구현: 현재 시간에서 10분 추가
    const now = new Date();

    // 형식이 "*/10 * * * *"인 경우 (10분마다)
    if (expression === "*/10 * * * *") {
      const minutes = Math.floor(now.getMinutes() / 10) * 10 + 10;
      const next = new Date(now);
      next.setMinutes(minutes);
      next.setSeconds(0);
      next.setMilliseconds(0);

      // 다음 시간으로 넘어가는 경우
      if (minutes >= 60) {
        next.setMinutes(0);
        next.setHours(next.getHours() + 1);
      }

      return next;
    }

    // 다른 패턴은 단순히 10분 후로 설정
    const next = new Date(now.getTime() + 10 * 60 * 1000);
    return next;
  } catch (error) {
    logger.error(`다음 실행 시간 계산 오류: ${error.message}`);
    return null;
  }
};

/**
 * 새로운 크론 작업 생성 함수
 * @param {string} jobId - 작업 ID
 * @param {string} cronExpression - 크론 표현식
 * @param {Function} jobFunction - 실행할 함수
 * @param {string} description - 작업 설명
 * @returns {boolean} - 작업 생성 성공 여부
 */
const createJob = (jobId, cronExpression, jobFunction, description = "") => {
  try {
    // 크론 표현식 유효성 검사
    if (!isValidCronExpression(cronExpression)) {
      logger.error(`유효하지 않은 크론 표현식: ${cronExpression}`);
      return false;
    }

    // 이미 존재하는 작업인지 확인
    if (scheduledJobs.has(jobId)) {
      logger.warn(`동일한 ID의 작업이 이미 존재합니다: ${jobId}`);
      return false;
    }

    // 크론 작업 생성
    const task = cron.schedule(cronExpression, async () => {
      try {
        logger.info(`작업 실행: ${jobId}`);

        // 작업 상태 업데이트
        const job = scheduledJobs.get(jobId);
        job.lastRun = new Date();
        job.nextRun = getNextExecutionTime(cronExpression);
        job.status = "running";
        scheduledJobs.set(jobId, job);

        // 작업 실행
        await jobFunction();

        // 작업 완료 상태 업데이트
        job.status = "idle";
        scheduledJobs.set(jobId, job);

        logger.info(`작업 완료: ${jobId}`);
      } catch (error) {
        // 오류 발생 시 상태 업데이트
        const job = scheduledJobs.get(jobId);
        job.status = "failed";
        job.error = error.message;
        scheduledJobs.set(jobId, job);

        logger.error(`작업 오류 (${jobId}): ${error.message}`);
      }
    });

    // 작업 정보 저장
    scheduledJobs.set(jobId, {
      cronExpression,
      description,
      status: "idle",
      lastRun: null,
      nextRun: getNextExecutionTime(cronExpression),
      task,
    });

    logger.info(`작업 등록: ${jobId} (${cronExpression})`);
    return true;
  } catch (error) {
    logger.error(`작업 생성 중 오류: ${error.message}`);
    return false;
  }
};

/**
 * 작업 중지 함수
 * @param {string} jobId - 작업 ID
 * @returns {boolean} - 작업 중지 성공 여부
 */
const stopJob = (jobId) => {
  try {
    if (!scheduledJobs.has(jobId)) {
      logger.warn(`중지할 작업을 찾을 수 없습니다: ${jobId}`);
      return false;
    }

    const job = scheduledJobs.get(jobId);
    job.task.stop();
    job.status = "stopped";
    scheduledJobs.set(jobId, job);

    logger.info(`작업 중지 완료: ${jobId}`);
    return true;
  } catch (error) {
    logger.error(`작업 중지 중 오류: ${error.message}`);
    return false;
  }
};

/**
 * 작업 재시작 함수
 * @param {string} jobId - 작업 ID
 * @returns {boolean} - 작업 재시작 성공 여부
 */
const restartJob = (jobId) => {
  try {
    if (!scheduledJobs.has(jobId)) {
      logger.warn(`재시작할 작업을 찾을 수 없습니다: ${jobId}`);
      return false;
    }

    const job = scheduledJobs.get(jobId);
    job.task.start();
    job.status = "idle";
    job.nextRun = getNextExecutionTime(job.cronExpression);
    scheduledJobs.set(jobId, job);

    logger.info(`작업 재시작 완료: ${jobId}`);
    return true;
  } catch (error) {
    logger.error(`작업 재시작 중 오류: ${error.message}`);
    return false;
  }
};

/**
 * 작업 삭제 함수
 * @param {string} jobId - 작업 ID
 * @returns {boolean} - 작업 삭제 성공 여부
 */
const deleteJob = (jobId) => {
  try {
    if (!scheduledJobs.has(jobId)) {
      logger.warn(`삭제할 작업을 찾을 수 없습니다: ${jobId}`);
      return false;
    }

    const job = scheduledJobs.get(jobId);
    job.task.stop();
    scheduledJobs.delete(jobId);

    logger.info(`작업 삭제 완료: ${jobId}`);
    return true;
  } catch (error) {
    logger.error(`작업 삭제 중 오류: ${error.message}`);
    return false;
  }
};

/**
 * 모든 작업 목록 조회 함수
 * @returns {Array} - 작업 목록
 */
const getAllJobs = () => {
  try {
    const jobs = [];

    scheduledJobs.forEach((job, jobId) => {
      jobs.push({
        jobId,
        description: job.description,
        cronExpression: job.cronExpression,
        status: job.status,
        lastRun: job.lastRun,
        nextRun: job.nextRun,
        error: job.error,
      });
    });

    return jobs;
  } catch (error) {
    logger.error(`작업 목록 조회 중 오류: ${error.message}`);
    return [];
  }
};

/**
 * 특정 작업 조회 함수
 * @param {string} jobId - 작업 ID
 * @returns {Object|null} - 작업 정보
 */
const getJob = (jobId) => {
  try {
    if (!scheduledJobs.has(jobId)) {
      logger.warn(`조회할 작업을 찾을 수 없습니다: ${jobId}`);
      return null;
    }

    const job = scheduledJobs.get(jobId);

    return {
      jobId,
      description: job.description,
      cronExpression: job.cronExpression,
      status: job.status,
      lastRun: job.lastRun,
      nextRun: job.nextRun,
      error: job.error,
    };
  } catch (error) {
    logger.error(`작업 조회 중 오류: ${error.message}`);
    return null;
  }
};

/**
 * 밴드 게시물 자동 크롤링 작업 등록 함수
 * @param {string} userId - 사용자 ID
 * @param {string} bandId - 밴드 ID
 * @param {string} cronExpression - 크론 표현식
 * @returns {string|null} - 등록된 작업 ID 또는 null
 */
const scheduleBandCrawling = (userId, bandId, cronExpression) => {
  try {
    const jobId = `band-crawl-${userId}-${bandId}`;

    // 이미 같은 ID로 작업이 있는지 확인
    if (scheduledJobs.has(jobId)) {
      logger.warn(`이미 동일한 작업이 스케줄되어 있습니다: ${jobId}`);
      return jobId; // 이미 존재하는 작업 ID 반환
    }

    // 크롤링 작업 함수 정의
    const crawlFunction = async () => {
      try {
        // 이미 실행 중인지 확인
        const job = scheduledJobs.get(jobId);
        if (job && job.status === "running") {
          logger.warn(`작업이 이미 실행 중입니다: ${jobId}`);
          return; // 이미 실행 중이면 중복 실행 방지
        }

        // 임시 요청/응답 객체 생성
        const req = {
          params: { bandId },
          body: { userId },
          user: { userId },
        };

        const res = {
          status: (code) => ({
            json: (data) => {
              if (code >= 400) {
                logger.error(`크롤링 작업 실패: ${JSON.stringify(data)}`);
              } else {
                logger.info(
                  `크롤링 작업 완료: ${data.message || JSON.stringify(data)}`
                );
              }
            },
          }),
        };

        // 게시물 목록 크롤링
        await crawlController.startPostDetailCrawling(req, res);
      } catch (error) {
        logger.error(`자동 크롤링 작업 오류: ${error.message}`);
        throw error;
      }
    };

    // 크론 작업 등록
    const created = createJob(
      jobId,
      cronExpression,
      crawlFunction,
      `${bandId} 밴드 게시물 자동 크롤링`
    );

    return created ? jobId : null;
  } catch (error) {
    logger.error(`밴드 크롤링 작업 등록 중 오류: ${error.message}`);
    return null;
  }
};

/**
 * 자동 크롤링이 활성화된 사용자의 크롤링 작업을 등록
 * @param {Object} user - 사용자 정보
 * @returns {string|null} - 등록된 작업 ID
 */
const registerUserCrawlingTask = async (user) => {
  try {
    const { user_id, band_number, crawl_interval } = user;

    // 시스템 자동 크롤링 작업의 경우 다른 ID 형식 사용
    const jobId = `band-crawl-system-${band_number}`;

    // 사용자 설정 크롤링 간격을 사용하거나 기본값 10분 사용
    const interval = crawl_interval || 10;

    // 크론 표현식 생성 (사용자 설정 간격 사용)
    const cronExpression =
      interval === 10
        ? "*/10 * * * *"
        : interval === 5
        ? "*/5 * * * *"
        : interval === 15
        ? "*/15 * * * *"
        : interval === 30
        ? "*/30 * * * *"
        : interval === 60
        ? "0 * * * *"
        : `*/${interval} * * * *`;

    const description = `${band_number} 밴드 게시물 자동 크롤링 (${interval}분 간격)`;

    // 기존 작업이 있다면 삭제
    if (scheduledJobs.has(jobId)) {
      const job = scheduledJobs.get(jobId);
      job.task.stop();
      scheduledJobs.delete(jobId);
      logger.info(`기존 작업 삭제: ${jobId} (${interval}분 간격으로 업데이트)`);
    }

    // 크롤링 함수 정의
    const crawlFunction = async () => {
      try {
        // 임시 요청/응답 객체 생성
        const req = {
          params: { bandId: band_number },
          body: { userId: user_id },
          user: { userId: user_id },
        };

        const res = {
          status: (code) => ({
            json: (data) => {
              if (code >= 400) {
                logger.error(`자동 크롤링 작업 실패: ${JSON.stringify(data)}`);
              } else {
                logger.info(
                  `자동 크롤링 작업 실행됨 (${interval}분 간격): ${
                    data.message || JSON.stringify(data)
                  }`
                );
              }
            },
          }),
        };

        // 게시물 목록 크롤링
        await crawlController.startPostDetailCrawling(req, res);
      } catch (error) {
        logger.error(`자동 크롤링 실행 오류: ${error.message}`);
        throw error;
      }
    };

    // 작업 등록
    const created = createJob(
      jobId,
      cronExpression,
      crawlFunction,
      description
    );

    if (created) {
      logger.info(
        `사용자 '${user_id}'의 자동 크롤링 작업 등록 완료 (밴드: ${band_number}, 간격: ${interval}분)`
      );

      // DB에 작업 ID 저장
      try {
        await userService.updateUserJobId(user_id, jobId);
        logger.info(
          `사용자 '${user_id}'의 작업 ID(${jobId})가 DB에 저장되었습니다.`
        );
      } catch (dbError) {
        logger.error(`작업 ID 저장 오류: ${dbError.message}`);
        // 작업 ID 저장 실패해도 작업은 계속 유지
      }

      return jobId;
    }
    return null;
  } catch (error) {
    logger.error(`사용자 크롤링 작업 등록 오류: ${error.message}`);
    return null;
  }
};

/**
 * 모든 자동 크롤링 작업 초기화 및 시작
 * @returns {Promise<boolean>} - 초기화 성공 여부
 */
const initializeAutoCrawling = async () => {
  try {
    logger.info("자동 크롤링 초기화 중...");

    // 기존 자동 크롤링 작업 제거 (band-crawl-system-* 형식의 jobId를 가진 작업)
    for (const [jobId, job] of scheduledJobs.entries()) {
      if (jobId.startsWith("band-crawl-system-")) {
        job.task.stop();
        scheduledJobs.delete(jobId);
        logger.info(`기존 자동 크롤링 작업 삭제: ${jobId}`);
      }
    }

    // 자동 크롤링이 활성화된 모든 사용자 조회
    const users = await userService.getAutoCrawlEnabledUsers();
    logger.info(`자동 크롤링 활성화된 사용자 ${users.length}명 확인됨`);

    // 각 사용자에 대해 크롤링 작업 등록
    for (const user of users) {
      const interval = user.crawl_interval || 10;
      logger.info(`사용자 '${user.user_id}'의 크롤링 간격: ${interval}분`);
      await registerUserCrawlingTask(user);
    }

    // 매시간마다 자동 크롤링 작업 갱신 작업 등록
    const refreshJobId = "auto-crawl-refresh";

    // 기존 갱신 작업이 있다면 제거
    if (scheduledJobs.has(refreshJobId)) {
      scheduledJobs.get(refreshJobId).task.stop();
      scheduledJobs.delete(refreshJobId);
    }

    // 새 갱신 작업 등록
    createJob(
      refreshJobId,
      "0 * * * *",
      refreshAutoCrawlingTasks,
      "자동 크롤링 작업 갱신"
    );

    logger.info("자동 크롤링 초기화 완료");
    return true;
  } catch (error) {
    logger.error(`자동 크롤링 초기화 오류: ${error.message}`);
    return false;
  }
};

/**
 * 자동 크롤링 작업 갱신
 * @returns {Promise<boolean>} - 갱신 성공 여부
 */
const refreshAutoCrawlingTasks = async () => {
  try {
    logger.info("자동 크롤링 작업 갱신 중...");

    // 자동 크롤링이 활성화된 모든 사용자 조회
    const users = await userService.getAutoCrawlEnabledUsers();

    // 현재 등록된 시스템 자동 크롤링 작업 ID 목록
    const registeredTaskIds = [];
    for (const [jobId] of scheduledJobs.entries()) {
      if (jobId.startsWith("band-crawl-system-")) {
        registeredTaskIds.push(jobId);
      }
    }

    // 기존 작업 ID Set 생성
    const existingTaskIds = new Set(registeredTaskIds);

    // 새 사용자와 기존 사용자 구분하여 작업 등록/유지
    for (const user of users) {
      const taskId = `band-crawl-system-${user.band_number}`;
      const interval = user.crawl_interval || 10;

      // 이미 등록된 작업이면 로직 확인 후 필요시 업데이트
      if (existingTaskIds.has(taskId)) {
        existingTaskIds.delete(taskId);

        // 기존 작업의 설정 확인
        const existingJob = scheduledJobs.get(taskId);
        const jobDesc = existingJob.description || "";
        let currentInterval = 10;

        // 작업 설명에서 간격 추출 (예: "밴드 게시물 자동 크롤링 (30분 간격)")
        const intervalMatch = jobDesc.match(/\((\d+)분 간격\)/);
        if (intervalMatch && intervalMatch[1]) {
          currentInterval = parseInt(intervalMatch[1]);
        }

        // 기존 작업의 크롤링 간격과 DB에 저장된 간격이 다르면 작업 갱신
        if (currentInterval !== interval) {
          logger.info(
            `사용자 '${user.user_id}'의 크롤링 간격 변경 감지: ${currentInterval}분 -> ${interval}분`
          );

          // 기존 작업 삭제 후 새로 등록
          existingJob.task.stop();
          scheduledJobs.delete(taskId);

          // 새 작업 등록
          await registerUserCrawlingTask(user);
        }

        // DB에 이미 job_id가 있는지 확인하고 업데이트
        if (!user.job_id || user.job_id !== taskId) {
          await userService.updateUserJobId(user.user_id, taskId);
          logger.info(
            `기존 사용자 '${user.user_id}'의 작업 ID가 업데이트되었습니다: ${taskId}`
          );
        }
      } else {
        // 새로 등록할 작업
        await registerUserCrawlingTask(user);
      }
    }

    // 남은 작업은 삭제 대상 (더 이상 자동 크롤링을 사용하지 않는 사용자)
    for (const taskId of existingTaskIds) {
      if (scheduledJobs.has(taskId)) {
        const job = scheduledJobs.get(taskId);
        job.task.stop();
        scheduledJobs.delete(taskId);
        logger.info(`더 이상 필요하지 않은 크롤링 작업 삭제: ${taskId}`);
      }
    }

    // 시스템 자동 크롤링 작업 수 계산
    let systemJobCount = 0;
    for (const [jobId] of scheduledJobs.entries()) {
      if (jobId.startsWith("band-crawl-system-")) {
        systemJobCount++;
      }
    }

    logger.info(
      `자동 크롤링 작업 갱신 완료: 현재 ${systemJobCount}개 시스템 작업 등록됨`
    );
    return true;
  } catch (error) {
    logger.error(`자동 크롤링 작업 갱신 오류: ${error.message}`);
    return false;
  }
};

/**
 * 모든 크롤링 작업 중지
 * @returns {boolean} - 중지 성공 여부
 */
const stopAllCrawlingTasks = () => {
  try {
    let stoppedCount = 0;

    // 모든 크롤링 관련 작업 중지
    for (const [jobId, job] of scheduledJobs.entries()) {
      if (jobId.includes("crawl")) {
        job.task.stop();
        job.status = "stopped";
        scheduledJobs.set(jobId, job);
        stoppedCount++;
        logger.info(`크롤링 작업 중지: ${jobId}`);
      }
    }

    logger.info(`${stoppedCount}개의 크롤링 작업이 중지되었습니다.`);
    return true;
  } catch (error) {
    logger.error(`크롤링 작업 중지 오류: ${error.message}`);
    return false;
  }
};

// cron 표현식 예시
// * * * * * - 매분마다
// 0 * * * * - 매시간 0분마다
// 0 0 * * * - 매일 0시 0분마다
// 0 0 * * 0 - 매주 일요일 0시 0분마다
// 0 0 1 * * - 매월 1일 0시 0분마다

module.exports = {
  createJob,
  stopJob,
  restartJob,
  deleteJob,
  getAllJobs,
  getJob,
  scheduleBandCrawling,
  isValidCronExpression,
  initializeAutoCrawling,
  refreshAutoCrawlingTasks,
  registerUserCrawlingTask,
  stopAllCrawlingTasks,
};
