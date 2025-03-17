const { Post } = require("../../models");
const logger = require("../../config/logger");

class PostService {
  static async savePosts(posts) {
    try {
      const savedPosts = await Promise.all(
        posts.map(async (post) => {
          const [savedPost] = await Post.upsert({
            postId: post.postId,
            bandId: post.bandId,
            content: post.content,
            author: post.author,
            date: post.date,
          });
          return savedPost;
        })
      );

      logger.info(`Saved ${savedPosts.length} posts to database`);
      return savedPosts;
    } catch (error) {
      logger.error("Failed to save posts:", error);
      throw error;
    }
  }

  static async getPosts(filters = {}) {
    try {
      const posts = await Post.findAll({
        where: filters,
        order: [["date", "DESC"]],
      });

      logger.info(`Retrieved ${posts.length} posts from database`);
      return posts;
    } catch (error) {
      logger.error("Failed to retrieve posts:", error);
      throw error;
    }
  }

  static async getPostById(postId) {
    try {
      const post = await Post.findOne({
        where: { postId },
      });

      if (!post) {
        logger.warn(`Post with ID ${postId} not found`);
        return null;
      }

      return post;
    } catch (error) {
      logger.error(`Failed to retrieve post ${postId}:`, error);
      throw error;
    }
  }
}

module.exports = PostService;
