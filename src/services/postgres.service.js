// // src/services/postgres.service.js - PostgreSQL 데이터베이스 서비스
// const { User, Post, Product, Order } = require("../models");
// const logger = require("../config/logger");

// // 사용자 정보 가져오기
// async function getUserById(userId) {
//   try {
//     return await User.findByPk(userId);
//   } catch (error) {
//     logger.error(`사용자 조회 오류: ${error.message}`);
//     throw error;
//   }
// }

// // 사용자 정보 가져오기 (로그인 ID로)
// async function getUserByLoginId(loginId) {
//   try {
//     return await User.findOne({ where: { loginId } });
//   } catch (error) {
//     logger.error(`로그인 ID로 사용자 조회 오류: ${error.message}`);
//     throw error;
//   }
// }

// // 사용자 생성하기
// async function createUser(userData) {
//   try {
//     return await User.create(userData);
//   } catch (error) {
//     logger.error(`사용자 생성 오류: ${error.message}`);
//     throw error;
//   }
// }

// // 사용자 정보 업데이트하기
// async function updateUser(userId, userData) {
//   try {
//     const user = await User.findByPk(userId);
//     if (!user) return null;

//     return await user.update(userData);
//   } catch (error) {
//     logger.error(`사용자 정보 업데이트 오류: ${error.message}`);
//     throw error;
//   }
// }

// // 게시물 저장하기 (밴드 게시물 ID와 밴드 ID로 중복 확인)
// async function savePost(postData) {
//   try {
//     const { bandNumber, bandPostId } = postData;

//     // 중복 확인
//     const existingPost = await Post.findOne({
//       where: { bandNumber, bandPostId },
//     });

//     if (existingPost) {
//       // 기존 게시물 업데이트
//       return await existingPost.update(postData);
//     } else {
//       // 새 게시물 생성
//       return await Post.create(postData);
//     }
//   } catch (error) {
//     logger.error(`게시물 저장 오류: ${error.message}`);
//     throw error;
//   }
// }

// // 상품 저장하기 (밴드 게시물 ID와 밴드 ID로 중복 확인)
// async function saveProduct(productData) {
//   try {
//     const { bandNumber, bandPostId } = productData;

//     // 중복 확인
//     const existingProduct = await Product.findOne({
//       where: { bandNumber, bandPostId },
//     });

//     if (existingProduct) {
//       // 기존 상품 업데이트
//       return await existingProduct.update(productData);
//     } else {
//       // 새 상품 생성
//       return await Product.create(productData);
//     }
//   } catch (error) {
//     logger.error(`상품 저장 오류: ${error.message}`);
//     throw error;
//   }
// }

// // 주문 저장하기 (밴드 댓글 ID와 밴드 ID로 중복 확인)
// async function saveOrder(orderData) {
//   try {
//     const { bandNumber, bandCommentId } = orderData;

//     // 중복 확인
//     const existingOrder = await Order.findOne({
//       where: { bandNumber, bandCommentId },
//     });

//     if (existingOrder) {
//       // 기존 주문 업데이트
//       return await existingOrder.update(orderData);
//     } else {
//       // 새 주문 생성
//       return await Order.create(orderData);
//     }
//   } catch (error) {
//     logger.error(`주문 저장 오류: ${error.message}`);
//     throw error;
//   }
// }

// // 사용자의 상품 목록 가져오기
// async function getUserProducts(userId, options = {}) {
//   try {
//     const { limit = 20, offset = 0 } = options;

//     return await Product.findAndCountAll({
//       where: { userId },
//       limit,
//       offset,
//       order: [["createdAt", "DESC"]],
//     });
//   } catch (error) {
//     logger.error(`사용자 상품 목록 조회 오류: ${error.message}`);
//     throw error;
//   }
// }

// // 사용자의 주문 목록 가져오기
// async function getUserOrders(userId, options = {}) {
//   try {
//     const { limit = 20, offset = 0, productId } = options;

//     const where = { userId };
//     if (productId) where.productId = productId;

//     return await Order.findAndCountAll({
//       where,
//       limit,
//       offset,
//       order: [["orderedAt", "DESC"]],
//       include: [
//         {
//           model: Product,
//           as: "product",
//         },
//       ],
//     });
//   } catch (error) {
//     logger.error(`사용자 주문 목록 조회 오류: ${error.message}`);
//     throw error;
//   }
// }

// // 상품 상세 조회 (주문 포함)
// async function getProductWithOrders(productId) {
//   try {
//     return await Product.findByPk(productId, {
//       include: [
//         {
//           model: Order,
//           as: "orders",
//         },
//       ],
//     });
//   } catch (error) {
//     logger.error(`상품 상세 조회 오류: ${error.message}`);
//     throw error;
//   }
// }

// module.exports = {
//   getUserById,
//   getUserByLoginId,
//   createUser,
//   updateUser,
//   savePost,
//   saveProduct,
//   saveOrder,
//   getUserProducts,
//   getUserOrders,
//   getProductWithOrders,
// };
