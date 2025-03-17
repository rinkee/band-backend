// src/controllers/posts.controller.js - 게시물 컨트롤러
const { Post, Comment } = require("../models");

/**
 * 밴드별 게시물 조회 컨트롤러
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getBandPosts = async (req, res) => {
  try {
    const { bandId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // 게시물 조회
    const { count, rows: posts } = await Post.findAndCountAll({
      where: { bandId },
      limit: parseInt(limit),
      offset,
      order: [["createdAt", "DESC"]],
    });

    res.json({
      success: true,
      data: {
        posts,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("게시물 조회 오류:", error);
    res.status(500).json({
      success: false,
      message: "게시물 조회 중 오류가 발생했습니다: " + error.message,
    });
  }
};

/**
 * 게시물 댓글 조회 컨트롤러
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getPostComments = async (req, res) => {
  try {
    const { postId } = req.params;

    console.log(`댓글 조회 요청: postId=${postId}`);

    // 댓글 수 확인
    const commentCount = await Comment.count({
      where: { postId },
    });

    console.log(`댓글 수: ${commentCount}`);

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

module.exports = {
  getBandPosts,
  getPostComments,
};
