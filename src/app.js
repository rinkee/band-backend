// src/app.js - Express 애플리케이션 설정
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const routes = require("./routes");
const { initializeFirebase } = require("./services/firebase.service");

const app = express();

// 인증 상태 확인 미들웨어
const checkAuth = (req, res, next) => {
  if (!req.session.userInfo) {
    req.isAuthenticated = false;
  } else {
    req.isAuthenticated = true;
  }
  next();
};

// Firebase 초기화
initializeFirebase();

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "some-secure-random-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000, // 24시간
    },
  })
);

// API 라우트 설정
app.use("/api", routes);

// 404 에러 처리
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `요청하신 경로(${req.originalUrl})를 찾을 수 없습니다.`,
  });
});

// 글로벌 에러 핸들러
app.use((err, req, res, next) => {
  console.error("에러:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "서버 오류가 발생했습니다.",
  });
});

// 데이터베이스 연결
// (async () => {
//   try {
//     await sequelize.sync({ alter: process.env.NODE_ENV === "development" });
//     console.log("데이터베이스 연결 및 동기화 완료");
//   } catch (error) {
//     console.error("초기화 실패:", error);
//   }
// })();

module.exports = app;
