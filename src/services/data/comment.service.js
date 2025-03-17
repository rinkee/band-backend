const { Comment } = require("../../models");
const logger = require("../../config/logger");

class CommentService {
  static async saveComments(postId, comments) {
    try {
      const savedComments = await Promise.all(
        comments.map(async (comment) => {
          const [savedComment] = await Comment.upsert({
            postId,
            content: comment.content,
            author: comment.author,
            date: comment.date,
          });
          return savedComment;
        })
      );

      logger.info(`Saved ${savedComments.length} comments for post ${postId}`);
      return savedComments;
    } catch (error) {
      logger.error(`Failed to save comments for post ${postId}:`, error);
      throw error;
    }
  }

  static async getComments(postId) {
    try {
      const comments = await Comment.findAll({
        where: { postId },
        order: [["date", "ASC"]],
      });

      logger.info(`Retrieved ${comments.length} comments for post ${postId}`);
      return comments;
    } catch (error) {
      logger.error(`Failed to retrieve comments for post ${postId}:`, error);
      throw error;
    }
  }
}

module.exports = CommentService;
