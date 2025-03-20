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
app.use(morgan("combined")); // 로깅

// 라우터 설정
const authRouter = require("./routes/auth.routes");
const crawlRouter = require("./routes/crawl.routes");

app.use("/api/auth", authRouter);
app.use("/api/crawl", crawlRouter);

// 에러 핸들링 미들웨어
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({
    success: false,
    message: "서버 내부 오류가 발생했습니다.",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// Supabase 연결 테스트
const startServer = async () => {
  try {
    await testConnection();
    logger.info("Supabase 데이터베이스 연결 성공");

    const port = process.env.PORT || 8000;
    app.listen(port, () => {
      logger.info(`서버가 포트 ${port}에서 실행 중입니다.`);
    });
  } catch (error) {
    logger.error("서버 시작 실패:", error);
    process.exit(1);
  }
};

module.exports = { app, startServer };
