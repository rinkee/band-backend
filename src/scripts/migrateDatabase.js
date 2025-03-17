const { getFirebaseDb } = require("../services/firebase.service");
const logger = require("../config/logger");

async function migrateDatabase() {
  const db = getFirebaseDb();
  logger.info("데이터베이스 마이그레이션 시작...");

  try {
    // 1. stores 컬렉션 조회
    const storesSnapshot = await db.collection("stores").get();
    logger.info(`${storesSnapshot.size}개의 store 문서 발견`);

    // 각 store 문서마다 처리
    for (const storeDoc of storesSnapshot.docs) {
      const bandId = storeDoc.id;
      logger.info(`밴드 ${bandId} 처리 중...`);

      // 1.1 users 컬렉션에 사용자 문서 생성
      const userRef = db.collection("users").doc();
      const userId = userRef.id;

      await userRef.set({
        bandId: bandId,
        storeName: `밴드 ${bandId}`,
        role: "store",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastCrawlAt: new Date(),
        settings: {
          notificationEnabled: true,
          autoConfirmOrders: false,
          theme: "default",
        },
      });

      logger.info(`사용자 생성 완료: ${userId}`);

      // 1.2 posts 서브컬렉션 조회
      const postsSnapshot = await storeDoc.ref.collection("posts").get();
      logger.info(`${postsSnapshot.size}개의 게시물 발견`);

      // 각 게시물마다 처리
      for (const postDoc of postsSnapshot.docs) {
        const postData = postDoc.data();
        const productId = postData.postId || postDoc.id;

        // 1.2.1 products 컬렉션에 상품 문서 생성
        await db
          .collection("products")
          .doc(productId)
          .set({
            userId: userId,
            title: postData.postTitle || "제목 없음",
            description: postData.postContent || "",
            price: 0,
            originalPrice: 0,
            images: postData.imageUrls || [],
            status: "판매중",
            bandPostId: postData.postId || postDoc.id,
            bandPostUrl: `https://band.us/band/${bandId}/post/${
              postData.postId || postDoc.id
            }`,
            category: "기타",
            tags: [],
            orderSummary: {
              totalOrders: postData.commentCount || 0,
              pendingOrders: postData.commentCount || 0,
              confirmedOrders: 0,
            },
            createdAt: postData.createdAt
              ? new Date(postData.createdAt)
              : new Date(),
            updatedAt: postData.updatedAt
              ? new Date(postData.updatedAt)
              : new Date(),
          });

        // 1.2.2 comments 서브컬렉션 조회
        const commentsSnapshot = await postDoc.ref.collection("comments").get();
        logger.info(
          `게시물 ${productId}에 ${commentsSnapshot.size}개의 댓글 발견`
        );

        // 각 댓글마다 처리
        for (const commentDoc of commentsSnapshot.docs) {
          const commentData = commentDoc.data();
          const orderId = `${productId}_order_${commentDoc.id}`;
          const customerName = commentData.author || "익명";

          // 1.2.2.1 orders 컬렉션에 주문 문서 생성
          await db
            .collection("orders")
            .doc(orderId)
            .set({
              userId: userId,
              productId: productId,
              customerName: customerName,
              customerBandId: "",
              customerProfile: "",
              quantity: 1,
              price: 0,
              totalAmount: 0,
              comment: commentData.content || "",
              status: "신규",
              paymentStatus: "미결제",
              deliveryStatus: "준비중",
              orderedAt: commentData.time
                ? new Date(commentData.time)
                : new Date(),
              bandCommentId: commentData.commentId || commentDoc.id,
              bandCommentUrl: `https://band.us/band/${bandId}/post/${productId}#comment`,
              createdAt: commentData.createdAt
                ? new Date(commentData.createdAt)
                : new Date(),
              updatedAt: commentData.updatedAt
                ? new Date(commentData.updatedAt)
                : new Date(),
            });

          // 1.2.2.2 customers 컬렉션에 고객 문서 생성 또는 업데이트
          const customerId = `${userId}_${customerName.replace(/\s+/g, "_")}`;
          const customerRef = db.collection("customers").doc(customerId);
          const customerDoc = await customerRef.get();

          if (customerDoc.exists) {
            // 기존 고객 정보 업데이트
            const customerData = customerDoc.data();
            const orderedAt = commentData.time
              ? new Date(commentData.time)
              : new Date();

            await customerRef.update({
              totalOrders: (customerData.totalOrders || 0) + 1,
              lastOrderAt:
                orderedAt > customerData.lastOrderAt
                  ? orderedAt
                  : customerData.lastOrderAt,
              updatedAt: new Date(),
            });
          } else {
            // 새 고객 정보 생성
            await customerRef.set({
              userId: userId,
              name: customerName,
              bandUserId: "",
              profileImage: "",
              totalOrders: 1,
              firstOrderAt: commentData.time
                ? new Date(commentData.time)
                : new Date(),
              lastOrderAt: commentData.time
                ? new Date(commentData.time)
                : new Date(),
              tags: [],
              notes: "",
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
        }
      }

      // 1.3 크롤링 히스토리 기록
      await db.collection("crawlHistory").add({
        userId: userId,
        timestamp: new Date(),
        status: "success",
        newPosts: postsSnapshot.size,
        newComments: postsSnapshot.docs.reduce(
          (total, doc) => total + (doc.data().commentCount || 0),
          0
        ),
        processingTime: 0,
        totalPostsProcessed: postsSnapshot.size,
        totalCommentsProcessed: postsSnapshot.docs.reduce(
          (total, doc) => total + (doc.data().commentCount || 0),
          0
        ),
      });

      logger.info(`밴드 ${bandId} 마이그레이션 완료`);
    }

    logger.info("데이터베이스 마이그레이션 완료!");
  } catch (error) {
    logger.error(`마이그레이션 중 오류 발생: ${error.message}`);
    logger.error(error.stack);
  }
}

// 마이그레이션 실행
migrateDatabase()
  .then(() => {
    logger.info("마이그레이션 스크립트 완료");
    process.exit(0);
  })
  .catch((error) => {
    logger.error(`마이그레이션 스크립트 오류: ${error.message}`);
    process.exit(1);
  });
