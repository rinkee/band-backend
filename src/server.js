// src/server.js - 서버 시작 진입점
require("dotenv").config();
const app = require("./app");
const logger = require("./config/logger");

// 환경변수에서 포트 가져오기 또는 기본값 사용
const PORT = process.env.PORT || 8080;

// 서버 시작
const server = app.listen(PORT, () => {
  logger.info(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});

// 예상치 못한 오류 처리
process.on("uncaughtException", (error) => {
  logger.error(`예상치 못한 오류 발생: ${error.stack}`);
  // 서버를 바로 종료하지 않고 로그만 남김
});

// 처리되지 않은 Promise 거부 처리
process.on("unhandledRejection", (reason, promise) => {
  logger.error(`처리되지 않은 Promise 거부: ${reason}`);
  // 서버를 바로 종료하지 않고 로그만 남김
});

// 정상 종료 처리
process.on("SIGTERM", () => {
  logger.info("SIGTERM 신호 수신. 서버 종료 중...");
  server.close(() => {
    logger.info("서버가 정상적으로 종료되었습니다.");
    process.exit(0);
  });
});
