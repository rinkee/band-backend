// src/utils/firebase-to-postgres.js - Firebase에서 PostgreSQL로 데이터 마이그레이션
require("dotenv").config();
const { v4: uuidv4 } = require("uuid");
const admin = require("firebase-admin");
const { sequelize } = require("../config/database");
const { User, Post, Product, Order } = require("../models");
const logger = require("../config/logger");

// Firebase 초기화 (firebase.service.js에서 가져오기)
const { getFirebaseDb } = require("../services/firebase.service");

async function migrateUsers() {
  try {
    console.log("사용자 마이그레이션 시작...");
    const db = getFirebaseDb();
    const usersSnapshot = await db.collection("users").get();

    // Firebase 사용자 ID와 PostgreSQL 사용자 ID 매핑
    const userIdMap = new Map();

    for (const doc of usersSnapshot.docs) {
      const userData = doc.data();
      const firebaseUserId = doc.id;

      // UUID 생성
      const postgresUserId = uuidv4();
      userIdMap.set(firebaseUserId, postgresUserId);

      // PostgreSQL에 저장
      await User.create({
        id: postgresUserId,
        loginId: userData.loginId || `user_${postgresUserId.substring(0, 8)}`,
        password: userData.password || "migrated_password",
        naverId: userData.naverId,
        naverPassword: userData.naverPassword,
        bandUrl: userData.bandUrl,
        bandNumber: userData.bandNumber,
        storeName: userData.storeName,
        lastLoginAt: userData.lastLoginAt
          ? new Date(userData.lastLoginAt.toDate())
          : null,
        lastCrawlAt: userData.lastCrawlAt
          ? new Date(userData.lastCrawlAt.toDate())
          : null,
        createdAt: userData.createdAt
          ? new Date(userData.createdAt.toDate())
          : new Date(),
        updatedAt: userData.updatedAt
          ? new Date(userData.updatedAt.toDate())
          : new Date(),
      });
    }

    console.log(`${usersSnapshot.size}명의 사용자 마이그레이션 완료`);
    return userIdMap;
  } catch (error) {
    console.error("사용자 마이그레이션 오류:", error);
    throw error;
  }
}

async function migratePosts(userIdMap) {
  try {
    console.log("게시물 마이그레이션 시작...");
    const db = getFirebaseDb();
    const postsSnapshot = await db.collection("posts").get();

    // Firebase 게시물 ID와 PostgreSQL 게시물 ID 매핑
    const postIdMap = new Map();

    for (const doc of postsSnapshot.docs) {
      const postData = doc.data();
      const firebasePostId = doc.id;

      // Firebase 사용자 ID를 PostgreSQL 사용자 ID로 변환
      const firebaseUserId = postData.userId;
      const postgresUserId = userIdMap.get(firebaseUserId);

      if (!postgresUserId) {
        console.warn(
          `사용자 ID ${firebaseUserId}를 찾을 수 없어 게시물 ${firebasePostId}를 건너뜁니다.`
        );
        continue;
      }

      // UUID 생성
      const postgresPostId = uuidv4();
      postIdMap.set(firebasePostId, postgresPostId);

      // PostgreSQL에 저장
      await Post.create({
        id: postgresPostId,
        userId: postgresUserId,
        title: postData.title || "제목 없음",
        content: postData.content || "",
        images: postData.images || [],
        bandPostId: postData.bandPostId,
        bandNumber: postData.bandNumber,
        bandPostUrl: postData.bandPostUrl,
        commentCount: postData.commentCount || 0,
        author: postData.author,
        postedAt: postData.postedAt
          ? new Date(postData.postedAt.toDate())
          : null,
        createdAt: postData.createdAt
          ? new Date(postData.createdAt.toDate())
          : new Date(),
        updatedAt: postData.updatedAt
          ? new Date(postData.updatedAt.toDate())
          : new Date(),
      });
    }

    console.log(`${postsSnapshot.size}개의 게시물 마이그레이션 완료`);
    return postIdMap;
  } catch (error) {
    console.error("게시물 마이그레이션 오류:", error);
    throw error;
  }
}

async function migrateProducts(userIdMap) {
  try {
    console.log("상품 마이그레이션 시작...");
    const db = getFirebaseDb();
    const productsSnapshot = await db.collection("products").get();

    // Firebase 상품 ID와 PostgreSQL 상품 ID 매핑
    const productIdMap = new Map();

    for (const doc of productsSnapshot.docs) {
      const productData = doc.data();
      const firebaseProductId = doc.id;

      // Firebase 사용자 ID를 PostgreSQL 사용자 ID로 변환
      const firebaseUserId = productData.userId;
      const postgresUserId = userIdMap.get(firebaseUserId);

      if (!postgresUserId) {
        console.warn(
          `사용자 ID ${firebaseUserId}를 찾을 수 없어 상품 ${firebaseProductId}를 건너뜁니다.`
        );
        continue;
      }

      // UUID 생성
      const postgresProductId = uuidv4();
      productIdMap.set(firebaseProductId, postgresProductId);

      // PostgreSQL에 저장
      await Product.create({
        id: postgresProductId,
        userId: postgresUserId,
        title: productData.title || "제목 없음",
        description: productData.description || "",
        originalContent: productData.originalContent || "",
        price: productData.price || 0,
        originalPrice: productData.originalPrice || 0,
        images: productData.images || [],
        status: productData.status || "판매중",
        bandPostId: productData.bandPostId,
        bandNumber: productData.bandNumber,
        bandPostUrl: productData.bandPostUrl,
        category: productData.category || "기타",
        tags: productData.tags || [],
        commentCount: productData.commentCount || 0,
        orderSummary: productData.orderSummary || {
          totalOrders: 0,
          pendingOrders: 0,
          confirmedOrders: 0,
        },
        barcode: productData.barcode,
        createdAt: productData.createdAt
          ? new Date(productData.createdAt.toDate())
          : new Date(),
        updatedAt: productData.updatedAt
          ? new Date(productData.updatedAt.toDate())
          : new Date(),
      });
    }

    console.log(`${productsSnapshot.size}개의 상품 마이그레이션 완료`);
    return productIdMap;
  } catch (error) {
    console.error("상품 마이그레이션 오류:", error);
    throw error;
  }
}

async function migrateOrders(userIdMap, productIdMap) {
  try {
    console.log("주문 마이그레이션 시작...");
    const db = getFirebaseDb();
    const ordersSnapshot = await db.collection("orders").get();

    let successCount = 0;
    let skipCount = 0;

    for (const doc of ordersSnapshot.docs) {
      const orderData = doc.data();
      const firebaseOrderId = doc.id;

      // Firebase 사용자 ID를 PostgreSQL 사용자 ID로 변환
      const firebaseUserId = orderData.userId;
      const postgresUserId = userIdMap.get(firebaseUserId);

      // Firebase 상품 ID를 PostgreSQL 상품 ID로 변환
      const firebaseProductId = orderData.productId;
      const postgresProductId = productIdMap.get(firebaseProductId);

      if (!postgresUserId || !postgresProductId) {
        console.warn(
          `사용자 ID ${firebaseUserId} 또는 상품 ID ${firebaseProductId}를 찾을 수 없어 주문 ${firebaseOrderId}를 건너뜁니다.`
        );
        skipCount++;
        continue;
      }

      // UUID 생성
      const postgresOrderId = uuidv4();

      // PostgreSQL에 저장
      await Order.create({
        id: postgresOrderId,
        userId: postgresUserId,
        productId: postgresProductId,
        originalProductId: orderData.originalProductId,
        customerName: orderData.customerName || "익명",
        customerbandNumber: orderData.customerbandNumber,
        customerProfile: orderData.customerProfile,
        quantity: orderData.quantity || 1,
        price: orderData.price || 0,
        totalAmount: orderData.totalAmount || orderData.price || 0,
        comment: orderData.comment || "",
        status: orderData.status || "주문완료",
        orderedAt: orderData.orderedAt
          ? new Date(orderData.orderedAt.toDate())
          : null,
        bandCommentId: orderData.bandCommentId,
        bandNumber: orderData.bandNumber,
        bandCommentUrl: orderData.bandCommentUrl,
        barcode: orderData.barcode,
        createdAt: orderData.createdAt
          ? new Date(orderData.createdAt.toDate())
          : new Date(),
        updatedAt: orderData.updatedAt
          ? new Date(orderData.updatedAt.toDate())
          : new Date(),
      });

      successCount++;
    }

    console.log(
      `${successCount}개의 주문 마이그레이션 완료, ${skipCount}개 건너뜀`
    );
  } catch (error) {
    console.error("주문 마이그레이션 오류:", error);
    throw error;
  }
}

// 데이터 마이그레이션 실행
async function migrate() {
  try {
    // 테이블 생성
    await sequelize.sync({ force: true });
    console.log("테이블 생성 완료");

    // 사용자 마이그레이션
    const userIdMap = await migrateUsers();

    // 게시물 마이그레이션
    const postIdMap = await migratePosts(userIdMap);

    // 상품 마이그레이션
    const productIdMap = await migrateProducts(userIdMap);

    // 주문 마이그레이션
    await migrateOrders(userIdMap, productIdMap);

    console.log("모든 마이그레이션 작업이 완료되었습니다.");
  } catch (error) {
    console.error("마이그레이션 실패:", error);
  } finally {
    // 연결 종료
    await sequelize.close();
    process.exit(0);
  }
}

// 스크립트 실행
migrate();
