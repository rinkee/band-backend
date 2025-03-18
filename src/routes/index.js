// src/routes/index.js - API 라우트 통합
const express = require("express");
const authRoutes = require("./auth.routes");
const crawlRoutes = require("./crawl.routes");

const router = express.Router();

// 인증 관련 라우트
router.use("/auth", authRoutes);

// 각 라우트 등록
router.use("/crawl", crawlRoutes);

// Firebase 연결 테스트 라우트 추가
router.get("/test-firebase", async (req, res) => {
  try {
    const db = require("../services/firebase.service").getFirebaseDb();
    const testDoc = db.collection("test").doc("connection-test");
    await testDoc.set({
      timestamp: new Date(),
      message: "Firebase 연결 테스트",
      success: true,
    });

    const result = await testDoc.get();

    res.json({
      success: true,
      message: "Firebase 연결 및 데이터 저장이 정상적으로 작동합니다.",
      data: result.data(),
    });
  } catch (error) {
    console.error("Firebase 테스트 오류:", error);
    res.status(500).json({
      success: false,
      message: `Firebase 연결 오류: ${error.message}`,
      error: error.stack,
    });
  }
});

module.exports = router;
