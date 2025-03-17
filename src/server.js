// src/server.js - 서버 시작 진입점
require("dotenv").config();
const app = require("./app");
// Sequelize 모델 가져오기
const { sequelize } = require("./models");

// 환경변수에서 포트 가져오기 또는 기본값 사용
const PORT = process.env.PORT || 8000;

// 서버 시작 전 데이터베이스 연결 확인
(async () => {
  try {
    // 데이터베이스 연결 테스트
    await sequelize.authenticate();
    console.log("데이터베이스 연결 성공");

    // 테이블 존재 여부만 확인하고 없는 경우에만 생성
    await sequelize.sync({
      force: false, // 테이블 강제 재생성 비활성화
      alter: false, // 테이블 구조 변경 비활성화
    });

    console.log("데이터베이스 준비 완료");

    // 서버 시작
    app.listen(PORT, () => {
      console.log(`밴드 매니저 백엔드 서버가 포트 ${PORT}에서 실행 중입니다`);
    });
  } catch (error) {
    console.error("데이터베이스 연결 오류:", error);
    process.exit(1);
  }
})();
