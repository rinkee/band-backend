// src/routes/scheduler.routes.js - 스케줄러 관련 라우터
const express = require("express");
const router = express.Router();
const schedulerService = require("../services/scheduler.service");
const { authMiddleware } = require("../middlewares/auth.middleware");

// 인증 미들웨어 추가
router.use(authMiddleware);

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

module.exports = router;
