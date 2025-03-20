// src/models/post.model.js - Post 모델 정의
const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

const Post = sequelize.define(
  "Post",
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
    // 게시물 제목
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // 게시물 내용
    content: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // 이미지 URL 배열 (JSON 형태로 저장)
    images: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
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
    // 댓글 수
    commentCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    // 게시물 작성자
    author: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // 게시 날짜
    postedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "posts",
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
    ],
  }
);

module.exports = Post;
