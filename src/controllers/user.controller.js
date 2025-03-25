const { supabase } = require("../config/supabase");
const logger = require("../config/logger");
const userService = require("../services/user.service");
const schedulerService = require("../services/scheduler.service");

/**
 * 자동 크롤링 설정 업데이트
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const updateAutoCrawlSettings = async (req, res) => {
  try {
    const { userId } = req.params;
    const { autoCrawl, crawlInterval } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "사용자 ID가 필요합니다.",
      });
    }

    if (typeof autoCrawl !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "autoCrawl은 불리언 값이어야 합니다.",
      });
    }

    // 크롤링 간격의 기본값은 10분, 옵션 값 검증
    const interval = crawlInterval ? parseInt(crawlInterval) : 10;
    if (isNaN(interval) || interval < 1 || interval > 1440) {
      return res.status(400).json({
        success: false,
        message: "크롤링 간격은 1-1440분 사이의 값이어야 합니다.",
      });
    }

    // 기존 작업 ID 조회 (비활성화 시 작업 삭제용)
    const existingJobId = await userService.getUserJobId(userId);

    // 작업 비활성화 시 기존 작업 삭제
    if (!autoCrawl && existingJobId) {
      schedulerService.deleteJob(existingJobId);
      logger.info(
        `사용자 ${userId}의 기존 작업(${existingJobId})이 삭제되었습니다.`
      );
    }

    // 설정 업데이트 (작업 ID는 갱신 과정에서 업데이트됨)
    const result = await userService.updateAutoCrawlSettings(
      userId,
      autoCrawl,
      interval
    );

    if (!result) {
      return res.status(500).json({
        success: false,
        message: "자동 크롤링 설정 업데이트 실패",
      });
    }

    // 성공하면 자동 크롤링 작업 갱신
    let newJobId = null;
    if (autoCrawl) {
      // 전체 사용자 정보를 가져와서 해당 사용자의 전체 정보로 작업 등록
      const user = await userService.getUserById(userId);
      if (user) {
        // 사용자 정보로 직접 작업 등록 (interval이 반영된 상태)
        newJobId = await schedulerService.registerUserCrawlingTask(user);
      } else {
        // 작업 갱신을 요청
        await schedulerService.refreshAutoCrawlingTasks();
        // 업데이트된 작업 ID 조회
        newJobId = await userService.getUserJobId(userId);
      }
    }

    return res.status(200).json({
      success: true,
      message: `자동 크롤링이 ${autoCrawl ? "활성화" : "비활성화"}되었습니다.`,
      data: {
        userId,
        autoCrawl,
        crawlInterval: interval,
        jobId: newJobId,
      },
    });
  } catch (error) {
    logger.error(`자동 크롤링 설정 업데이트 오류: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "자동 크롤링 설정 업데이트 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 사용자의 자동 크롤링 설정 조회
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getAutoCrawlSettings = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "사용자 ID가 필요합니다.",
      });
    }

    // 사용자 정보 조회
    const { data, error } = await supabase
      .from("users")
      .select("auto_crawl, crawl_interval")
      .eq("user_id", userId)
      .single();

    if (error) {
      logger.error(`사용자 자동 크롤링 설정 조회 오류: ${error.message}`);
      return res.status(500).json({
        success: false,
        message: "자동 크롤링 설정 조회 실패",
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "사용자를 찾을 수 없습니다.",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        userId,
        autoCrawl: data.auto_crawl || false,
        crawlInterval: data.crawl_interval || 10,
      },
    });
  } catch (error) {
    logger.error(`자동 크롤링 설정 조회 오류: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "자동 크롤링 설정 조회 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

module.exports = {
  updateAutoCrawlSettings,
  getAutoCrawlSettings,
};
