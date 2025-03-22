// src/app.js - Express 애플리케이션 설정
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const compression = require("compression");
const { testConnection } = require("./config/supabase");
const logger = require("./config/logger");

const app = express();

// 미들웨어 설정
app.use(helmet()); // 보안 헤더 설정
app.use(compression()); // 응답 압축
app.use(cors()); // CORS 설정
app.use(express.json()); // JSON 파싱
app.use(express.urlencoded({ extended: true })); // URL 인코딩된 데이터 파싱
app.use(morgan("dev")); // 로깅

// CORS 설정
app.use(
  cors({
    origin: "http://localhost:3000", // 프론트엔드 주소
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// 라우터 설정
const apiRouter = require("./routes");
app.use("/api", apiRouter);

// 에러 핸들링 미들웨어
app.use((err, req, res, next) => {
  logger.error("서버 오류:", err);
  res.status(500).json({
    success: false,
    message: "서버 오류가 발생했습니다.",
    error: err.message,
  });
});

// Supabase 연결 테스트 함수
const startApp = async () => {
  try {
    // Supabase 연결 테스트
    await testConnection();
    logger.info("Supabase 연결 성공");
  } catch (error) {
    logger.error("서버 시작 실패:", error);
    process.exit(1);
  }
};

// 초기 연결 테스트 실행
startApp();

module.exports = app;
