// src/routes/index.js - API 라우트 통합
const express = require("express");
const authRoutes = require("./auth.routes");
const crawlRoutes = require("./crawl.routes");
const productsRoutes = require("./products.routes");
const ordersRoutes = require("./orders.routes");
const customersRoutes = require("./customers.routes");
const postsRoutes = require("./posts.routes");
const schedulerRoutes = require("./scheduler.routes");

const router = express.Router();

// 인증 관련 라우트
router.use("/auth", authRoutes);

// 크롤링 관련 라우트
router.use("/crawl", crawlRoutes);

// 상품 관련 라우트
router.use("/products", productsRoutes);

// 주문 관련 라우트
router.use("/orders", ordersRoutes);

// 고객 관련 라우트
router.use("/customers", customersRoutes);

// 게시글 관련 라우트
router.use("/posts", postsRoutes);

// 스케줄러 관련 라우트
router.use("/scheduler", schedulerRoutes);

module.exports = router;
