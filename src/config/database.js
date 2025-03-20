// src/config/database.js - PostgreSQL 데이터베이스 연결 설정
const { Sequelize } = require("sequelize");
const logger = require("./logger");

// 환경변수에서 데이터베이스 연결 정보 가져오기
const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS, NODE_ENV } = process.env;

// Sequelize 인스턴스 생성
const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASS, {
  host: DB_HOST,
  port: DB_PORT || 5432,
  dialect: "postgres",
  logging: NODE_ENV === "development" ? console.log : false,
  define: {
    timestamps: true, // createdAt, updatedAt 자동 관리
    underscored: true, // 스네이크 케이스 사용 (예: created_at)
  },
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
});

// 데이터베이스 연결 테스트
async function testConnection() {
  try {
    await sequelize.authenticate();
    logger.info("데이터베이스 연결 성공");
    return true;
  } catch (error) {
    logger.error(`데이터베이스 연결 실패: ${error.message}`);
    return false;
  }
}

module.exports = {
  sequelize,
  testConnection,
};
