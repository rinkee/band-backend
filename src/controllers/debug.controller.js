// src/controllers/debug.controller.js - 디버깅 컨트롤러
const { Post, Comment, sequelize } = require("../models");

/**
 * 모든 댓글 조회 컨트롤러
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getAllComments = async (req, res) => {
  try {
    // 모든 댓글 조회
    const allComments = await Comment.findAll({
      limit: 100, // 안전을 위해 최대 100개로 제한
    });

    // 모든 게시물 조회
    const allPosts = await Post.findAll({
      attributes: ["id", "postId"], // id와 postId만 가져옴
      limit: 100, // 안전을 위해 최대 100개로 제한
    });

    res.json({
      success: true,
      data: {
        commentCount: allComments.length,
        comments: allComments,
        postCount: allPosts.length,
        posts: allPosts.map((p) => ({ id: p.id, postId: p.postId })),
      },
    });
  } catch (error) {
    console.error("디버깅 API 오류:", error);
    res.status(500).json({
      success: false,
      message: "디버깅 중 오류가 발생했습니다: " + error.message,
    });
  }
};

/**
 * 테이블 스키마 정보 조회 컨트롤러
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getSchema = async (req, res) => {
  try {
    // Sequelize를 통해 테이블 정보 확인
    const postAttributes = Object.keys(Post.rawAttributes);
    const commentAttributes = Object.keys(Comment.rawAttributes);

    // 관계 정보 확인
    const postAssociations = Post.associations
      ? Object.keys(Post.associations).map((key) => ({
          name: key,
          type: Post.associations[key].associationType,
          target: Post.associations[key].target.name,
          foreignKey: Post.associations[key].foreignKey,
        }))
      : [];

    const commentAssociations = Comment.associations
      ? Object.keys(Comment.associations).map((key) => ({
          name: key,
          type: Comment.associations[key].associationType,
          target: Comment.associations[key].target.name,
          foreignKey: Comment.associations[key].foreignKey,
        }))
      : [];

    res.json({
      success: true,
      data: {
        Post: {
          attributes: postAttributes,
          associations: postAssociations,
        },
        Comment: {
          attributes: commentAttributes,
          associations: commentAssociations,
        },
      },
    });
  } catch (error) {
    console.error("스키마 확인 API 오류:", error);
    res.status(500).json({
      success: false,
      message: "스키마 확인 중 오류가 발생했습니다: " + error.message,
    });
  }
};

/**
 * 특정 게시물 ID로 댓글 찾기 디버깅 컨트롤러
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getPostCommentsDebug = async (req, res) => {
  try {
    const { postId } = req.params;

    // 먼저 게시물 조회
    const post = await Post.findByPk(postId);

    if (!post) {
      return res.status(404).json({
        success: false,
        message: `ID가 ${postId}인 게시물을 찾을 수 없습니다.`,
      });
    }

    // 게시물의 댓글 조회
    const comments = await Comment.findAll({
      where: { postId },
    });

    // 추가 데이터베이스 정보 조회
    const dbInfo = {
      // SQLite인 경우 정확한 데이터 타입을 확인
      postIdType: await sequelize.query(
        "SELECT typeof(postId) FROM comments LIMIT 1"
      ),
      // 댓글 테이블의 모든 postId 값 확인 (중복 없이)
      uniquePostIds: await sequelize.query(
        "SELECT DISTINCT postId FROM comments"
      ),
    };

    res.json({
      success: true,
      data: {
        post: post.toJSON(),
        comments: {
          count: comments.length,
          items: comments,
        },
        dbInfo,
      },
    });
  } catch (error) {
    console.error("게시물 댓글 디버깅 API 오류:", error);
    res.status(500).json({
      success: false,
      message: "게시물 댓글 디버깅 중 오류가 발생했습니다: " + error.message,
    });
  }
};

module.exports = {
  getAllComments,
  getSchema,
  getPostCommentsDebug,
};
