// src/server.js - 서버 시작 진입점
require("dotenv").config();
const app = require("./app");
const logger = require("./config/logger");

// 환경변수에서 포트 가져오기 또는 기본값 사용
const PORT = process.env.PORT || 5000;

// 서버 시작
app.listen(PORT, () => {
  logger.info(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
