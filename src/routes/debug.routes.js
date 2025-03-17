// src/routes/debug.routes.js - 디버깅 라우트
const express = require("express");
const debugController = require("../controllers/debug.controller");

const router = express.Router();

// 모든 댓글 조회
router.get("/comments", debugController.getAllComments);

// 테이블 스키마 정보 조회
router.get("/schema", debugController.getSchema);

// 특정 게시물 ID로 댓글 찾기
router.get("/posts/:postId/comments", debugController.getPostCommentsDebug);

module.exports = router;
