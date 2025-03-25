const express = require("express");
const router = express.Router();
const { authenticateJwt } = require("../middlewares/auth.middleware");
const userController = require("../controllers/user.controller");

// JWT 인증 미들웨어 적용
router.use(authenticateJwt);

// 참고: 자동 크롤링 관련 라우트는 /api/scheduler 경로로 이동되었습니다
// GET /api/scheduler/users/:userId/auto-crawl - 자동 크롤링 설정 조회
// PUT /api/scheduler/users/:userId/auto-crawl - 자동 크롤링 설정 업데이트

module.exports = router;
