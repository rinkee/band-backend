// models/comment.js - 댓글 모델 업데이트
module.exports = (sequelize, DataTypes) => {
  const Comment = sequelize.define(
    "Comment",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      postId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "Posts",
          key: "id",
        },
        comment: "게시물 ID (Post 모델의 id 필드 참조)",
      },
      bandPostId: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "네이버 밴드 게시물 ID (원본)",
      },
      commentIndex: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: "댓글 순서 인덱스",
      },
      authorName: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: "작성자 이름",
      },
      authorNickname: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "작성자 닉네임",
      },
      profileImage: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "프로필 이미지 URL",
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: "댓글 내용",
      },
      timestamp: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "작성 시간 원본 텍스트",
      },
    },
    {
      tableName: "comments",
      timestamps: true,
      comment: "게시물 댓글 정보",
    }
  );

  // 관계 설정
  Comment.associate = (models) => {
    Comment.belongsTo(models.Post, {
      foreignKey: "postId",
      as: "post",
    });
  };

  return Comment;
};
