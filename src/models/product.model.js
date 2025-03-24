// src/models/product.model.js - Product 모델 정의
const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

const Product = sequelize.define(
  "Product",
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
    // 상품명
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // 상품 설명
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // 원본 내용
    originalContent: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // 기본 가격 (가장 저렴한 옵션의 가격)
    basePrice: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    // 가격 옵션 배열 (JSON 형태로 저장)
    priceOptions: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
    },
    // 판매 단위 수량 (정수)
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    // 용량/개수 정보 텍스트 (예: 400g, 10개입)
    quantityText: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "quantity_text",
    },
    // 원래 가격
    originalPrice: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
    },
    // 이미지 URL 배열 (JSON 형태로 저장)
    images: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
    },
    // 상품 특징 정보 배열
    features: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
    },
    // 상품 상태 (판매중, 품절 등)
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "판매중",
    },
    // 밴드 게시물 ID
    bandPostId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // 밴드 ID
    bandId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // 밴드 게시물 URL
    bandPostUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // 카테고리
    category: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "기타",
    },
    // 태그 (JSON 배열)
    tags: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
    },
    // 픽업/수령 정보 원문
    pickupInfo: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // 픽업/수령 예정 날짜
    pickupDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // 픽업/수령 유형 (수령, 픽업, 도착 등)
    pickupType: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // 댓글 수
    commentCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    // 주문 요약 (JSON 객체)
    orderSummary: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {
        totalOrders: 0,
        pendingOrders: 0,
        confirmedOrders: 0,
      },
    },
    // 바코드
    barcode: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: "products",
    timestamps: true,
    paranoid: true,
    indexes: [
      {
        fields: ["userId"],
      },
      {
        fields: ["bandId", "bandPostId"],
        unique: true,
      },
      {
        fields: ["basePrice"],
      },
      {
        fields: ["pickupDate"],
      },
    ],
  }
);

module.exports = Product;
