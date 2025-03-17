// src/models/Post.js - 게시물 모델 정의
module.exports = (sequelize, DataTypes) => {
  const Post = sequelize.define(
    "Post",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      postId: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: "네이버 밴드 게시물 ID",
      },
      bandId: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: "네이버 밴드 ID",
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "게시물 내용",
      },
      authorName: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "작성자 이름",
      },
      postTime: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "게시물에 표시된 작성 시간 텍스트",
      },
      postUrl: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "게시물 URL",
      },
      commentCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: "댓글 수",
      },
      viewCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: "조회수",
      },
      crawledAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        comment: "크롤링 시간",
      },
    },
    {
      tableName: "posts",
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["postId"],
          name: "posts_band_post_unique",
        },
      ],
    }
  );

  return Post;
};
