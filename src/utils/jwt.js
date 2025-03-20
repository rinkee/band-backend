const jwt = require("jsonwebtoken");
const logger = require("../config/logger");

/**
 * JWT 토큰 생성
 * @param {Object} payload - 토큰에 포함될 데이터
 * @param {string} [expiresIn='24h'] - 토큰 만료 시간
 * @returns {string} 생성된 JWT 토큰
 */
const generateToken = (payload, expiresIn = "24h") => {
  try {
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn,
    });
    return token;
  } catch (error) {
    logger.error("JWT 토큰 생성 실패:", error);
    throw new Error("토큰 생성에 실패했습니다.");
  }
};

/**
 * JWT 토큰 검증
 * @param {string} token - 검증할 JWT 토큰
 * @returns {Object} 디코딩된 토큰 데이터
 */
const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded;
  } catch (error) {
    logger.error("JWT 토큰 검증 실패:", error);
    throw new Error("유효하지 않은 토큰입니다.");
  }
};

module.exports = {
  generateToken,
  verifyToken,
};
