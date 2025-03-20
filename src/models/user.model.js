// src/models/user.model.js - User 모델 정의
const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

const User = sequelize.define(
  "User",
  {
    // 고유 ID (Firebase ID 대체)
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // 로그인 ID
    loginId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    // 로그인 비밀번호 (해시된 값)
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // 네이버 계정 ID
    naverId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // 네이버 계정 비밀번호 (암호화된 값)
    naverPassword: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // 밴드 URL
    bandUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // 밴드 ID
    bandId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // 상점 이름
    storeName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // 마지막 로그인 날짜
    lastLoginAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // 마지막 크롤링 날짜
    lastCrawlAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "users",
    timestamps: true,
    paranoid: true, // soft delete 지원
  }
);

module.exports = User;
