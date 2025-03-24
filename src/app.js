// src/app.js - Express 애플리케이션 설정
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const compression = require("compression");
const { testConnection } = require("./config/supabase");
const logger = require("./config/logger");
require("dotenv").config();

// 스케줄러 서비스 불러오기
const schedulerService = require("./services/scheduler.service");

const app = express();

// 미들웨어 설정
app.use(helmet()); // 보안 헤더 설정
app.use(compression()); // 응답 압축
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
); // CORS 설정
app.use(express.json()); // JSON 파싱
app.use(express.urlencoded({ extended: true })); // URL 인코딩된 데이터 파싱

// morgan 로깅 설정 수정 - 개발 환경에서만 사용하고 간략한 형식으로 변경
if (process.env.NODE_ENV === "development") {
  app.use(
    morgan("dev", {
      skip: (req, res) => res.statusCode < 400, // 성공 응답은 로깅하지 않음
    })
  );
} else {
  // 프로덕션 환경에서는 HTTP 오류만 로깅
  app.use(
    morgan("combined", {
      skip: (req, res) => res.statusCode < 400,
      stream: { write: (message) => logger.error(message.trim()) },
    })
  );
}

// 라우터 설정
const apiRouter = require("./routes");
app.use("/api", apiRouter);

// 기본 라우트
app.get("/", (req, res) => {
  res.json({
    message: "밴드 매니저 API 서버에 오신 것을 환영합니다!",
    version: "1.0.0",
    status: "active",
  });
});

// 에러 핸들링 미들웨어
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({
    success: false,
    message: "서버 내부 오류가 발생했습니다.",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// 404 처리
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "요청한 리소스를 찾을 수 없습니다.",
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

// 서버 초기화 시 수행할 작업
const initializeServer = async () => {
  logger.info("서버 초기화 중...");

  // 여기에 서버 초기화 작업 추가

  // 예시: 테스트용 자동 크롤링 작업 (실제 환경에서는 주석 처리 또는 삭제)
  if (process.env.NODE_ENV === "development") {
    // 매 시간마다 실행되는 테스트 크롤링 작업 (개발 환경에서만)
    schedulerService
      .scheduleBandCrawling
      // 'test-user-id',
      // 'test-band-id',
      // '0 * * * *'
      ();
    logger.info(
      "개발 환경에서 자동 크롤링 작업을 설정하려면 app.js의 주석을 해제하세요."
    );
  }

  logger.info("서버 초기화 완료!");
};

// 서버 초기화 실행
initializeServer().catch((err) => {
  logger.error("서버 초기화 중 오류 발생:", err);
});

module.exports = app;
