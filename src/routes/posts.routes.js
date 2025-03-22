// src/routes/posts.routes.js - 게시글 관련 라우트 정의
const express = require("express");
const router = express.Router();
const postsController = require("../controllers/posts.controller");

// 라우트 정의

// 게시글 목록 조회
router.get("/", postsController.getAllPosts);

// 특정 게시글 조회
router.get("/:id", postsController.getPostById);

// 게시글 상태 업데이트
router.put("/:id/status", postsController.updatePostStatus);

// 게시글 삭제
router.delete("/:id", postsController.deletePost);

module.exports = router;
