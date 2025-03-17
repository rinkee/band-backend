// controllers/comments.controller.js
const { Post, Comment } = require("../models");
const { crawlPostComments } = require("../services/crawler.service");

/**
 * 게시물 댓글 조회 컨트롤러
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getPostComments = async (req, res) => {
  try {
    const { postId } = req.params;

    console.log(`댓글 조회 요청: postId=${postId}`);

    // 댓글 조회
    const comments = await Comment.findAll({
      where: { postId },
      order: [["commentIndex", "ASC"]],
    });

    res.json({
      success: true,
      data: {
        comments,
        count: comments.length,
        requestedPostId: postId,
      },
    });
  } catch (error) {
    console.error("댓글 조회 오류:", error);
    res.status(500).json({
      success: false,
      message: "댓글 조회 중 오류가 발생했습니다: " + error.message,
    });
  }
};

/**
 * 게시물 댓글 크롤링 컨트롤러
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const crawlComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const { naverId, naverPassword, bandId } = req.body;

    // 필수 파라미터 검증
    if (!naverId || !naverPassword || !bandId) {
      return res.status(400).json({
        success: false,
        message:
          "필수 파라미터가 누락되었습니다. (naverId, naverPassword, bandId)",
      });
    }

    // 게시물 존재 여부 확인
    const post = await Post.findOne({
      where: { id: postId },
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: `ID가 ${postId}인 게시물이 존재하지 않습니다.`,
      });
    }

    console.log(`댓글 크롤링 요청: postId=${postId}, bandId=${bandId}`);

    // 댓글 크롤링 실행
    const result = await crawlPostComments(
      naverId,
      naverPassword,
      bandId,
      post.originalPostId || post.postId // 원본 게시물 ID 사용
    );

    // 응답에 taskId 포함 (상태 확인 가능)
    res.json({
      ...result,
      taskId: result.taskId,
    });
  } catch (error) {
    console.error("댓글 크롤링 오류:", error);
    res.status(500).json({
      success: false,
      message: "댓글 크롤링 중 오류가 발생했습니다: " + error.message,
    });
  }
};

module.exports = {
  getPostComments,
  crawlComments,
};
