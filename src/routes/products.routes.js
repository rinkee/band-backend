// src/routes/products.routes.js - 상품 관련 라우터
const express = require("express");
const router = express.Router();
const productsController = require("../controllers/products.controller");
const { authMiddleware } = require("../middlewares/auth.middleware");

// 상품 목록 조회
router.get("/", productsController.getAllProducts);

// 특정 상품 조회
router.get("/:id", productsController.getProductById);

// 상품 등록
router.post("/", authMiddleware, productsController.createProduct);

// 상품 정보 업데이트
router.put("/:id", authMiddleware, productsController.updateProduct);

// 상품 부분 업데이트
router.patch("/:id", authMiddleware, productsController.patchProduct);

// 상품 삭제
router.delete("/:id", authMiddleware, productsController.deleteProduct);

module.exports = router;
