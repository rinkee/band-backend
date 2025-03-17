// src/config/database.js - 데이터베이스 설정
module.exports = {
  development: {
    dialect: "sqlite",
    storage: "./database.sqlite",
    logging: false,
    define: {
      timestamps: true,
      underscored: false,
    },
  },
  test: {
    dialect: "sqlite",
    storage: "./database-test.sqlite",
    logging: false,
  },
  production: {
    dialect: "mysql", // 프로덕션에서는 MySQL 사용 (나중에 변경 가능)
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    logging: false,
    define: {
      timestamps: true,
    },
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  },
};
