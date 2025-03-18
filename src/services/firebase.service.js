// src/services/firebase.service.js - Firebase 서비스
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const serviceAccount = require("../../serviceAccount.json");

// Firebase Admin SDK 초기화
const admin = require("firebase-admin");
const logger = require("../config/logger");

let serviceAccount;
let db;

try {
  // 서비스 계정 키 로드 시도
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  console.log("Loading Firebase credentials from:", serviceAccountPath);

  if (!serviceAccountPath) {
    throw new Error(
      "환경변수 GOOGLE_APPLICATION_CREDENTIALS가 설정되지 않았습니다."
    );
  }

  try {
    serviceAccount = require(serviceAccountPath);
    console.log("서비스 계정 로드 성공:", serviceAccount.project_id);
  } catch (err) {
    console.error("서비스 계정 JSON 파일 로드 실패:", err.message);

    // 대체 방법으로 시도
    const fs = require("fs");
    const raw = fs.readFileSync(serviceAccountPath);
    serviceAccount = JSON.parse(raw);
    console.log(
      "파일 직접 읽기로 서비스 계정 로드 성공:",
      serviceAccount.project_id
    );
  }

  // 이미 초기화되었는지 확인
  try {
    admin.app();
    console.log("Firebase 이미 초기화됨");
  } catch (err) {
    // 초기화되지 않은 경우 초기화 진행
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("Firebase 새로 초기화됨");
  }

  db = admin.firestore();
  console.log("Firestore DB 초기화 성공");

  // 테스트 쿼리 실행
  db.collection("test")
    .doc("init")
    .set({
      initialized: true,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    })
    .then(() => console.log("Firestore 테스트 문서 쓰기 성공"))
    .catch((err) =>
      console.error("Firestore 테스트 문서 쓰기 실패:", err.message)
    );
} catch (error) {
  console.error("Firebase 초기화 오류:", error);
  logger.error(`Firebase 초기화 오류: ${error.message}`);

  // 오류 발생 시 대체 로직
  if (!db && admin.apps.length) {
    try {
      db = admin.firestore();
      console.log("기존 앱에서 Firestore DB 가져오기 성공");
    } catch (err) {
      console.error("기존 앱에서 Firestore DB 가져오기 실패:", err.message);
    }
  }
}

// Firebase 인증 서비스
const getFirebaseAuth = () => {
  return getAuth();
};

// Firebase Firestore 데이터베이스 서비스
const getFirebaseDb = () => {
  if (!db) {
    console.error("Firebase DB가 초기화되지 않았습니다.");
    logger.error("Firebase DB가 초기화되지 않았습니다.");
    throw new Error("Firebase DB가 초기화되지 않았습니다.");
  }
  return db;
};

// 사용자 참조 가져오기
function getUserRef(userId) {
  const db = getFirebaseDb();
  return db.collection("users").doc(userId);
}

// 상품 참조 가져오기
function getProductsRef(userId) {
  const db = getFirebaseDb();
  return db.collection("products").where("userId", "==", userId);
}

// 특정 상품 참조 가져오기
function getProductRef(productId) {
  const db = getFirebaseDb();
  return db.collection("products").doc(productId);
}

// 주문 참조 가져오기
function getOrdersRef(userId) {
  const db = getFirebaseDb();
  return db.collection("orders").where("userId", "==", userId);
}

// 특정 상품의 주문 참조 가져오기
function getProductOrdersRef(productId) {
  const db = getFirebaseDb();
  return db.collection("orders").where("productId", "==", productId);
}

module.exports = {
  getFirebaseAuth,
  getFirebaseDb,
  getUserRef,
  getProductsRef,
  getProductRef,
  getOrdersRef,
  getProductOrdersRef,
  admin,
};
