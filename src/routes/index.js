// src/routes/index.js - API 라우트 통합
const express = require("express");
const authRoutes = require("./auth.routes");
const crawlRoutes = require("./crawl.routes");
const productsRoutes = require("./products.routes");
const ordersRoutes = require("./orders.routes");
const customersRoutes = require("./customers.routes");
const postsRoutes = require("./posts.routes");
const schedulerRoutes = require("./scheduler.routes");
const userRoutes = require("./user.routes");

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

// 사용자 관련 라우트
router.use("/users", userRoutes);

// API 테스트를 위한 기본 경로
router.get("/", (req, res) => {
  res.json({
    message: "밴드 매니저 API가 정상적으로 작동 중입니다.",
    endpoints: [
      "/api/auth - 인증 관련 API",
      "/api/posts - 게시물 관련 API",
      "/api/crawl - 크롤링 관련 API",
      "/api/products - 상품 관련 API",
      "/api/customers - 고객 관련 API",
      "/api/orders - 주문 관련 API",
      "/api/scheduler - 스케줄러 및 자동 크롤링 관련 API",
      "/api/users - 사용자 관련 API",
    ],
  });
});

module.exports = router;
