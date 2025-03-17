// src/models/index.js - 모델 정의 및 관계 설정
const { Sequelize } = require("sequelize");
const config = require("../config/database");

const env = process.env.NODE_ENV || "development";
const dbConfig = config[env];

let sequelize;
if (dbConfig.url) {
  sequelize = new Sequelize(dbConfig.url, dbConfig);
} else {
  sequelize = new Sequelize(
    dbConfig.database,
    dbConfig.username,
    dbConfig.password,
    dbConfig
  );
}

const Post = require("./Post")(sequelize, Sequelize.DataTypes);
const Comment = require("./Comment")(sequelize, Sequelize.DataTypes);

// 모델 간 관계 설정
Post.hasMany(Comment, { foreignKey: "postId", as: "comments" });
Comment.belongsTo(Post, { foreignKey: "postId", as: "post" });

const db = {
  sequelize,
  Sequelize,
  Post,
  Comment,
};

module.exports = db;
