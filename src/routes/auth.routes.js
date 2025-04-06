// src/routes/auth.routes.js - 인증 관련 라우트
const express = require("express");
const authController = require("../controllers/auth.controller");
const {
  requireAuth,
  requireSelfOrAdmin,
  requireActiveUser,
} = require("../middlewares/auth.middleware");

const router = express.Router();

// 회원가입 라우트
router.post("/register", authController.register);

// 로그인 라우트
router.post("/login", authController.login);

//user get
router.get("/:id", authController.getUserData);

// 네이버 로그인 라우트
router.post("/naver/login", authController.naverLogin);

// 네이버 계정 설정 라우트
router.post("/naver/account", authController.setNaverAccount);

// 네이버 로그인 상태 조회 라우트
router.get(
  "/users/:userId/naver-login-status",
  authController.getNaverLoginStatus
);

// 로그아웃 라우트
router.post("/logout", requireAuth, authController.logout);

// 현재 인증 상태 확인 라우트
router.get("/check", authController.checkAuth);

// 네이버 계정 정보 업데이트 라우트
router.put(
  "/users/:userId/naver-credentials",
  requireAuth,
  requireSelfOrAdmin,
  requireActiveUser,
  authController.updateNaverCredentials
);

// 사용자 프로필 업데이트 라우트
router.put(
  "/users/:userId/profile",
  requireAuth,
  requireSelfOrAdmin,
  requireActiveUser,
  authController.updateProfile
);

// 로그인 비밀번호 변경 라우트
router.put(
  "/users/:userId/password",
  requireAuth,
  requireSelfOrAdmin,
  requireActiveUser,
  authController.updateLoginPassword
);

// POST /auth/:userId/manual-naver-login 엔드포인트 추가
router.post(
  "/:userId/manual-naver-login",
  authController.handleManualNaverLogin
);

module.exports = router;
