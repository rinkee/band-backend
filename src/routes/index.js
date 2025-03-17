// src/routes/index.js - API 라우트 통합
const express = require("express");
const authRoutes = require("./auth.routes");
const crawlRoutes = require("./crawl.routes");
const postsRoutes = require("./posts.routes");
const debugRoutes = require("./debug.routes");

const router = express.Router();

// 인증 관련 라우트
router.use("/auth", authRoutes);

// 각 라우트 등록
router.use("/crawl", crawlRoutes);
router.use("/posts", postsRoutes);
router.use("/debug", debugRoutes);

module.exports = router;
