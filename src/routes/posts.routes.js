// src/routes/posts.routes.js - 게시물 관련 라우트 (수정 버전)
const express = require("express");
const router = express.Router();
const postsController = require("../controllers/posts.controller");
const commentsController = require("../controllers/comments.controller");
// 각 라우트에 명확한 접두사 사용

// 게시물별 댓글 조회 - 충돌 방지를 위해 다른 경로 사용
router.get("/:postId/comments", postsController.getPostComments);

// 게시물 댓글 크롤링 (새로운 API)
router.post("/:postId/crawl-comments", commentsController.crawlComments);
// 밴드별 게시물 조회
router.get("/:bandId", postsController.getBandPosts);

// 댓글 크롤링 상태 확인 API
router.get("/:postId/comment-crawl-status/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;
    const { getTaskStatus } = require("../services/crawler.service");

    const status = getTaskStatus(taskId);

    if (!status) {
      return res.status(404).json({
        success: false,
        message: `작업 ID ${taskId}를 찾을 수 없습니다.`,
      });
    }

    res.json({
      success: true,
      data: {
        task: status,
      },
    });
  } catch (error) {
    console.error("댓글 크롤링 상태 확인 오류:", error);
    res.status(500).json({
      success: false,
      message: "상태 확인 중 오류가 발생했습니다: " + error.message,
    });
  }
});

module.exports = router;
