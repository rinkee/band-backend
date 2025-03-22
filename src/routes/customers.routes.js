// src/routes/customers.routes.js - 고객 관련 라우터
const express = require("express");
const router = express.Router();
const customersController = require("../controllers/customers.controller");
const { authMiddleware } = require("../middlewares/auth.middleware");

// 고객 목록 조회
router.get("/", customersController.getAllCustomers);

// 특정 고객 조회
router.get("/:id", customersController.getCustomerById);

// 고객 등록
router.post("/", authMiddleware, customersController.createCustomer);

// 고객 정보 업데이트
router.put("/:id", authMiddleware, customersController.updateCustomer);

// 고객 삭제
router.delete("/:id", authMiddleware, customersController.deleteCustomer);

module.exports = router;
