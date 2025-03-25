// src/routes/scheduler.routes.js - 스케줄러 관련 라우터
const express = require("express");
const router = express.Router();
const schedulerService = require("../services/scheduler.service");
const { authenticateJwt } = require("../middlewares/auth.middleware");
const userController = require("../controllers/user.controller");
const userService = require("../services/user.service");

// JWT 인증 미들웨어 추가 (options 경로는 인증 제외)
router.use((req, res, next) => {
  if (req.path === "/options" || req.method === "GET") {
    return next();
  }
  return authenticateJwt(req, res, next);
});

/**
 * 모든 작업 목록 조회
 */
router.get("/", (req, res) => {
  try {
    const jobs = schedulerService.getAllJobs();
    return res.status(200).json({
      success: true,
      message: "스케줄 작업 목록을 조회했습니다.",
      data: jobs,
    });
  } catch (error) {
    console.error("스케줄 목록 조회 오류:", error);
    return res.status(500).json({
      success: false,
      message: "스케줄 목록 조회 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
});

/**
 * 크론 표현식 옵션 조회
 */
router.get("/options", (req, res) => {
  try {
    const options = [
      { value: "* * * * *", label: "매분마다" },
      { value: "*/5 * * * *", label: "5분마다" },
      { value: "*/10 * * * *", label: "10분마다" },
      { value: "*/30 * * * *", label: "30분마다" },
      { value: "0 * * * *", label: "매시간 정각마다" },
      { value: "0 */2 * * *", label: "2시간마다" },
      { value: "0 9 * * *", label: "매일 오전 9시" },
      {
        value: "0 9-18 * * 1-5",
        label: "평일 오전 9시부터 오후 6시까지 매시간",
      },
      { value: "0 0 * * 0", label: "매주 일요일 자정" },
      { value: "0 0 1 * *", label: "매월 1일 자정" },
    ];

    return res.status(200).json({
      success: true,
      data: options,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "옵션 조회 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
});

/**
 * 크롤링 작업 스케줄 등록
 */
router.post("/crawl", async (req, res) => {
  try {
    const { userId, bandId, cronExpression } = req.body;

    if (!userId || !bandId || !cronExpression) {
      return res.status(400).json({
        success: false,
        message: "사용자 ID, 밴드 ID, 크론 표현식이 필요합니다.",
      });
    }

    // 크론 표현식 유효성 검사
    if (!schedulerService.isValidCronExpression(cronExpression)) {
      return res.status(400).json({
        success: false,
        message: "유효하지 않은 크론 표현식입니다.",
      });
    }

    // 스케줄 등록
    const jobId = schedulerService.scheduleBandCrawling(
      userId,
      bandId,
      cronExpression
    );

    if (!jobId) {
      return res.status(500).json({
        success: false,
        message: "스케줄 등록 중 오류가 발생했습니다.",
      });
    }

    return res.status(201).json({
      success: true,
      message: "크롤링 스케줄이 등록되었습니다.",
      data: {
        jobId,
        userId,
        bandId,
        cronExpression,
      },
    });
  } catch (error) {
    console.error("스케줄 등록 오류:", error);
    return res.status(500).json({
      success: false,
      message: "스케줄 등록 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
});

/**
 * 스케줄 작업 목록 조회
 */
router.get("/jobs", (req, res) => {
  try {
    const jobs = schedulerService.getAllJobs();

    return res.status(200).json({
      success: true,
      data: jobs,
    });
  } catch (error) {
    console.error("작업 목록 조회 오류:", error);
    return res.status(500).json({
      success: false,
      message: "작업 목록 조회 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
});

/**
 * 특정 스케줄 작업 조회
 */
router.get("/jobs/:jobId", (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        success: false,
        message: "작업 ID가 필요합니다.",
      });
    }

    const job = schedulerService.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "해당 ID의 작업을 찾을 수 없습니다.",
      });
    }

    return res.status(200).json({
      success: true,
      data: job,
    });
  } catch (error) {
    console.error("작업 조회 오류:", error);
    return res.status(500).json({
      success: false,
      message: "작업 조회 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
});

/**
 * 스케줄 작업 삭제
 */
router.delete("/jobs/:jobId", (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        success: false,
        message: "작업 ID가 필요합니다.",
      });
    }

    const deleted = schedulerService.deleteJob(jobId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "해당 ID의 작업을 찾을 수 없습니다.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "작업이 삭제되었습니다.",
    });
  } catch (error) {
    console.error("작업 삭제 오류:", error);
    return res.status(500).json({
      success: false,
      message: "작업 삭제 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
});

/**
 * 스케줄 작업 중지
 */
router.put("/jobs/:jobId/stop", (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        success: false,
        message: "작업 ID가 필요합니다.",
      });
    }

    const stopped = schedulerService.stopJob(jobId);

    if (!stopped) {
      return res.status(404).json({
        success: false,
        message: "해당 ID의 작업을 찾을 수 없습니다.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "작업이 중지되었습니다.",
    });
  } catch (error) {
    console.error("작업 중지 오류:", error);
    return res.status(500).json({
      success: false,
      message: "작업 중지 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
});

/**
 * 스케줄 작업 재시작
 */
router.put("/jobs/:jobId/restart", (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        success: false,
        message: "작업 ID가 필요합니다.",
      });
    }

    const restarted = schedulerService.restartJob(jobId);

    if (!restarted) {
      return res.status(404).json({
        success: false,
        message: "해당 ID의 작업을 찾을 수 없습니다.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "작업이 재시작되었습니다.",
    });
  } catch (error) {
    console.error("작업 재시작 오류:", error);
    return res.status(500).json({
      success: false,
      message: "작업 재시작 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
});

/**
 * 사용자의 자동 크롤링 설정 조회
 * 이전 경로: /api/users/:userId/auto-crawl
 * 새 경로: /api/scheduler/users/:userId/auto-crawl
 */
router.get(
  "/users/:userId/auto-crawl",
  authenticateJwt,
  userController.getAutoCrawlSettings
);

/**
 * 사용자의 자동 크롤링 설정 업데이트
 * 이전 경로: /api/users/:userId/auto-crawl
 * 새 경로: /api/scheduler/users/:userId/auto-crawl
 */
router.put(
  "/users/:userId/auto-crawl",
  authenticateJwt,
  userController.updateAutoCrawlSettings
);

/**
 * 모든 크롤링 작업 중지
 */
router.post("/stop-all", authenticateJwt, (req, res) => {
  try {
    const stopped = schedulerService.stopAllCrawlingTasks();

    return res.status(200).json({
      success: true,
      message: "모든 크롤링 작업이 중지되었습니다.",
    });
  } catch (error) {
    console.error("모든 작업 중지 오류:", error);
    return res.status(500).json({
      success: false,
      message: "작업 중지 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
});

/**
 * 자동 크롤링 재초기화
 */
router.post("/refresh", authenticateJwt, async (req, res) => {
  try {
    const result = await schedulerService.refreshAutoCrawlingTasks();

    return res.status(200).json({
      success: true,
      message: "자동 크롤링 작업이 갱신되었습니다.",
    });
  } catch (error) {
    console.error("자동 크롤링 갱신 오류:", error);
    return res.status(500).json({
      success: false,
      message: "자동 크롤링 갱신 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
});

/**
 * 사용자의 자동 크롤링 작업 삭제
 * 작업 ID를 알지 못해도 사용자 ID로 해당 사용자의 작업을 삭제할 수 있음
 */
router.delete("/users/:userId/job", authenticateJwt, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "사용자 ID가 필요합니다.",
      });
    }

    // 사용자의 작업 ID 조회
    const jobId = await userService.getUserJobId(userId);

    if (!jobId) {
      return res.status(404).json({
        success: false,
        message: "해당 사용자의 등록된 작업을 찾을 수 없습니다.",
      });
    }

    // 작업 삭제
    const deleted = schedulerService.deleteJob(jobId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "해당 ID의 작업을 찾을 수 없습니다.",
      });
    }

    // DB에서 작업 ID 제거
    await userService.updateUserJobId(userId, null);

    // 자동 크롤링 설정도 비활성화
    await userService.updateAutoCrawlSettings(userId, false);

    return res.status(200).json({
      success: true,
      message: "작업이 삭제되었습니다.",
      data: {
        userId,
        jobId,
      },
    });
  } catch (error) {
    console.error("사용자 작업 삭제 오류:", error);
    return res.status(500).json({
      success: false,
      message: "작업 삭제 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
});

module.exports = router;
