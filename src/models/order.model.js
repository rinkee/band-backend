// src/models/order.model.js - Order 모델 정의
const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

const Order = sequelize.define(
  "Order",
  {
    // 고유 ID
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // 사용자 ID (외래키)
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
    },
    // 상품 ID (외래키)
    productId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "products",
        key: "id",
      },
    },
    // 상품 원본 ID (밴드의 게시물 ID)
    originalProductId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // 고객 이름
    customerName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // 고객 밴드 ID
    customerBandId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // 고객 프로필 이미지
    customerProfile: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // 주문 수량
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    // 개당 가격
    price: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    // 총 금액
    totalAmount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    // 주문 댓글 내용
    comment: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // 주문 상태 (주문완료, 주문취소, 수령완료)
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "주문완료",
    },
    // 주문 날짜
    orderedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // 밴드 댓글 ID
    bandCommentId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // 밴드 ID
    bandId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // 밴드 댓글 URL
    bandCommentUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // 바코드
    barcode: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: "orders",
    timestamps: true,
    paranoid: true,
    indexes: [
      {
        fields: ["userId"],
      },
      {
        fields: ["productId"],
      },
      {
        fields: ["bandId", "bandCommentId"],
        unique: true,
      },
    ],
  }
);

module.exports = Order;
