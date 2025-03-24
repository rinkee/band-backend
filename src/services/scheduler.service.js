// src/services/scheduler.service.js - 정기적인 작업 스케줄링을 위한 서비스
const cron = require("node-cron");
const logger = require("../config/logger");
const { CrawlController } = require("../controllers/crawl.controller");

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
 * 다음 실행 시간 계산 함수
 * @param {string} expression - 크론 표현식
 * @returns {Date|null} - 다음 실행 시간
 */
const getNextExecutionTime = (expression) => {
  try {
    if (!isValidCronExpression(expression)) {
      return null;
    }

    // node-cron에서는 직접적으로 다음 실행 시간을 제공하지 않기 때문에
    // cron-parser 패키지를 사용하여 계산할 수 있습니다.
    const cronParser = require("cron-parser");
    const interval = cronParser.parseExpression(expression);
    return interval.next().toDate();
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

    // 크롤링 작업 함수 정의
    const crawlFunction = async () => {
      try {
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
        await crawlController.getPostsInfoOnly(req, res);
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
};
