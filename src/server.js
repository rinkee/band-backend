// src/server.js - 서버 시작 진입점
require("dotenv").config();
const { app, startServer } = require("./app");
const { createClient } = require("@supabase/supabase-js");
const logger = require("./config/logger");

// 환경변수에서 포트 가져오기 또는 기본값 사용
const PORT = process.env.PORT || 8000;

// Supabase 클라이언트 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 서버 시작 전 데이터베이스 연결 확인
(async () => {
  try {
    // Supabase 연결 테스트
    const { data, error } = await supabase
      .from("users")
      .select("count")
      .limit(1);

    if (error) {
      throw new Error(`Supabase 연결 실패: ${error.message}`);
    }

    // 연결 성공
    logger.info("Supabase 데이터베이스 연결 성공");

    // 서버 시작
    startServer().catch((error) => {
      logger.error("서버 시작 실패:", error);
      process.exit(1);
    });
  } catch (error) {
    logger.error(`데이터베이스 연결 오류: ${error.message}`);
    process.exit(1);
  }
})();
