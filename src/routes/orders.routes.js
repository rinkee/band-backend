// src/routes/orders.routes.js - 주문 관련 라우터
const express = require("express");
const router = express.Router();
const ordersController = require("../controllers/orders.controller");
const { authMiddleware } = require("../middlewares/auth.middleware");

// 주문 목록 조회
router.get("/", authMiddleware, ordersController.getAllOrders);

// 주문 통계 조회
router.get("/stats", authMiddleware, ordersController.getOrderStats);

// 특정 주문 조회
router.get("/:id", authMiddleware, ordersController.getOrderById);

// 주문 상태 업데이트
router.put("/:id/status", authMiddleware, ordersController.updateOrderStatus);

// 주문 취소
router.post("/:id/cancel", authMiddleware, ordersController.cancelOrder);

// 주문 상세 정보 업데이트
router.put("/:id", authMiddleware, ordersController.updateOrderDetails);

module.exports = router;
