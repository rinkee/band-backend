// src/routes/crawl.routes.js - 크롤링 관련 라우트
const express = require("express");
const crawlController = require("../controllers/crawl.controller");

const router = express.Router();

// 게시물 크롤링 시작 - userId를 필수 파라미터로 추가
router.post("/posts/:bandId", crawlController.startPostsCrawling);

// 게시물 상세 정보(팝업 내용과 댓글) 크롤링 시작 - userId를 필수 파라미터로 추가
router.post("/post-details/:bandId", crawlController.startPostDetailCrawling);

// 댓글 크롤링 시작 - userId를 필수 파라미터로 추가
router.post("/comments/:bandId/:postId", crawlController.startCommentsCrawling);

// 크롤링 상태 조회 엔드포인트
router.get("/status/:taskId", crawlController.getTaskStatus);

module.exports = router;
