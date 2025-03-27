const express = require("express");
const router = express.Router();
const aiService = require("../services/ai.service");
const logger = require("../config/logger");

// AI 테스트 엔드포인트
router.post("/test", async (req, res) => {
  try {
    const { content, date } = req.body;

    if (!content) {
      return res.status(400).json({ error: "게시물 내용이 필요합니다." });
    }

    logger.info("AI 테스트 시작");
    logger.info(`테스트 게시물 내용: ${content.substring(0, 100)}...`);

    const result = await aiService.extractProductInfo(content, date);

    logger.info("AI 테스트 결과:", result);

    res.json({
      success: true,
      result,
    });
  } catch (error) {
    logger.error("AI 테스트 중 오류 발생:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
