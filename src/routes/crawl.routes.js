// src/routes/crawl.routes.js - 크롤링 관련 라우트
const express = require("express");
const {
  CrawlController,
  getTaskStatus,
} = require("../controllers/crawl.controller");
const { authenticateJwt } = require("../middlewares/auth.middleware");

const router = express.Router();
const crawlController = new CrawlController();

// 바인딩을 통해 this 컨텍스트 유지
const boundStartPostDetailCrawling =
  crawlController.startPostDetailCrawling.bind(crawlController);

const boundStartSinglePostDetailCrawling =
  crawlController.crawlSinglePostDetail.bind(crawlController);

// 태스크 상태 확인은 모듈에서 가져온 함수 사용
// const boundGetTaskStatus = crawlController.getTaskStatus.bind(crawlController);

// 바인딩을 통해 this 컨텍스트 유지
const boundGetCommentsOnly =
  crawlController.getCommentsOnly.bind(crawlController);
const boundGetPostsInfoOnly =
  crawlController.getPostsInfoOnly.bind(crawlController);

// 상품 정보 추출 기능의 바인딩
const boundExtractProductInfo =
  crawlController.extractProductInfo.bind(crawlController);
const boundTestProductExtraction =
  crawlController.testProductExtraction.bind(crawlController);

// JWT 인증 미들웨어 추가
router.use(authenticateJwt);

// 게시물 상세 정보 크롤링 시작
router.post("/:bandNumber/details", boundStartPostDetailCrawling);

// 태스크 상태 확인
router.get("/task/:taskId", getTaskStatus);

// 특정 게시물의 댓글만 크롤링
router.post("/:bandNumber/post/:postId/comments", boundGetCommentsOnly);

// 게시물 목록 정보 크롤링
router.post("/:bandNumber/posts", boundGetPostsInfoOnly);

// 게시물에서 상품 정보 추출 (기존 밴드 게시물)
router.post("/:bandNumber/extract-products", boundExtractProductInfo);

// 테스트용 상품 정보 추출 (직접 콘텐츠 입력)
router.post("/test-extract", boundTestProductExtraction);

// 단일 게시물 크롤링 라우트 추가 (예시)
// POST /api/crawl/bands/:bandNumber/posts/:postId
router.post(
  "/bands/:bandNumber/posts/:postId",
  boundStartSinglePostDetailCrawling
);

module.exports = router;
