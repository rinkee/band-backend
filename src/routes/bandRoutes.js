const express = require("express");
const bandController = require("../controllers/bandController");
// 필요하다면 인증 미들웨어 등을 추가할 수 있습니다.
// const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/band/posts - Band API에서 게시물 목록 가져오기
// 라우트에 접근 제어가 필요하면 authenticateToken 미들웨어를 사용하세요.
router.get("/posts", bandController.getBandPosts);

// 새로운 댓글 가져오기 라우트
router.get("/comments", bandController.getBandComments);

// 새로 추가된 라우트 (댓글 목록 받아서 주문 처리)
// POST 요청으로 가정, 요청 본문에 { userId, comments: [...] } 포함
router.post("/process-orders", bandController.processCommentsToOrders);

module.exports = router;
