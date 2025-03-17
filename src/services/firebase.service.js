// src/services/firebase.service.js - Firebase 서비스
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

// Firebase Admin 초기화
let admin;
const initializeFirebase = () => {
  if (!admin) {
    admin = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
    console.log("Firebase Admin 초기화 완료");
  }
  return admin;
};

// Firebase 인증 서비스
const getFirebaseAuth = () => {
  initializeFirebase();
  return getAuth();
};

// Firebase Firestore 데이터베이스 서비스
const getFirebaseDb = () => {
  initializeFirebase();
  return getFirestore();
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
  initializeFirebase,
  getFirebaseAuth,
  getFirebaseDb,
  getUserRef,
  getProductsRef,
  getProductRef,
  getOrdersRef,
  getProductOrdersRef,
};
