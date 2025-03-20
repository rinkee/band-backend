// src/models/index.js - 모델 관계 설정
const User = require("./user.model");
const Post = require("./post.model");
const Product = require("./product.model");
const Order = require("./order.model");
const { sequelize } = require("../config/database");

// 관계 설정
// User - Post: 1:N
User.hasMany(Post, { foreignKey: "userId", as: "posts" });
Post.belongsTo(User, { foreignKey: "userId" });

// User - Product: 1:N
User.hasMany(Product, { foreignKey: "userId", as: "products" });
Product.belongsTo(User, { foreignKey: "userId" });

// User - Order: 1:N
User.hasMany(Order, { foreignKey: "userId", as: "orders" });
Order.belongsTo(User, { foreignKey: "userId" });

// Product - Order: 1:N
Product.hasMany(Order, { foreignKey: "productId", as: "orders" });
Order.belongsTo(Product, { foreignKey: "productId" });

module.exports = {
  sequelize,
  User,
  Post,
  Product,
  Order,
};
