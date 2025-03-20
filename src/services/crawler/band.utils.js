// src/services/crawler/band.utils.js
const crypto = require("crypto");
const logger = require("../../config/logger");

/**
 * 한국어 날짜 형식 파싱 함수
 * @param {string} dateString - 파싱할 날짜 문자열
 * @returns {Date|null} - 파싱된 Date 객체 또는 null
 */
function parseKoreanDate(dateString) {
  // 형식 1: "3월 14일 오후 8:58"
  let match = dateString.match(/(\d+)월 (\d+)일 (오전|오후) (\d+):(\d+)/);
  if (match) {
    const [_, month, day, ampm, hour, minute] = match;
    const currentYear = new Date().getFullYear();
    let adjustedHour = parseInt(hour);

    if (ampm === "오후" && adjustedHour < 12) {
      adjustedHour += 12;
    } else if (ampm === "오전" && adjustedHour === 12) {
      adjustedHour = 0;
    }

    return new Date(
      currentYear,
      parseInt(month) - 1,
      parseInt(day),
      adjustedHour,
      parseInt(minute)
    );
  }

  // 형식 2: "2025년 3월 14일 오후 3:55"
  match = dateString.match(/(\d+)년 (\d+)월 (\d+)일 (오전|오후) (\d+):(\d+)/);
  if (match) {
    const [_, year, month, day, ampm, hour, minute] = match;
    let adjustedHour = parseInt(hour);

    if (ampm === "오후" && adjustedHour < 12) {
      adjustedHour += 12;
    } else if (ampm === "오전" && adjustedHour === 12) {
      adjustedHour = 0;
    }

    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      adjustedHour,
      parseInt(minute)
    );
  }

  return null;
}

/**
 * 안전한 날짜 파싱 함수
 * @param {string} dateString - 파싱할 날짜 문자열
 * @returns {Date} - 파싱된 Date 객체, 실패하면 현재 날짜
 */
function safeParseDate(dateString) {
  if (!dateString) return new Date();

  try {
    // 한국어 날짜 형식 시도
    const koreanDate = parseKoreanDate(dateString);
    if (koreanDate) return koreanDate;

    // "몇 시간 전", "어제" 등의 상대적 시간 처리
    if (typeof dateString === "string") {
      if (
        dateString.includes("시간 전") ||
        dateString.includes("분 전") ||
        dateString.includes("초 전") ||
        dateString === "방금 전"
      ) {
        return new Date();
      }

      if (dateString === "어제") {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday;
      }
    }

    // 일반적인 날짜 변환 시도
    const parsedDate = new Date(dateString);

    // 유효한 날짜인지 확인
    if (isNaN(parsedDate.getTime())) {
      logger.warn(`유효하지 않은 날짜 형식: ${dateString}`);
      return new Date();
    }

    return parsedDate;
  } catch (e) {
    logger.warn(`날짜 변환 오류 (${dateString}): ${e.message}`);
    return new Date();
  }
}

/**
 * 가격 추출 함수
 * @param {string} content - 게시물 내용
 * @returns {number} - 추출된 가격
 */
function extractPriceFromContent(content) {
  if (!content) return 0;

  // 가격 패턴 (숫자+원) 찾기
  const priceRegex = /(\d+,?\d*,?\d*)원/g;
  const priceMatches = content.match(priceRegex);

  if (!priceMatches || priceMatches.length === 0) {
    return 0;
  }

  // 모든 가격을 숫자로 변환
  const prices = priceMatches
    .map((priceText) => {
      // 쉼표 제거하고 '원' 제거
      const numStr = priceText.replace(/,/g, "").replace("원", "");
      return parseInt(numStr, 10);
    })
    .filter((price) => !isNaN(price) && price > 0);

  // 가격이 없으면 0 반환
  if (prices.length === 0) {
    return 0;
  }

  // 가장 낮은 가격 반환
  return Math.min(...prices);
}

/**
 * 단순 ID 생성 함수
 * @param {string} prefix - ID 접두사
 * @param {number} length - ID 길이
 * @returns {string} - 생성된 ID
 */
function generateSimpleId(prefix = "", length = 8) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = prefix ? `${prefix}_` : "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 주문 수량 추출 함수
 * @param {string} content - 댓글 내용
 * @returns {number} - 추출된 수량
 */
function extractQuantityFromComment(content) {
  if (!content) return 1;

  // 숫자만 추출하는 정규식
  const numbers = content.match(/\d+/g);
  if (!numbers) return 1;

  // 10 이하의 첫 번째 숫자를 찾음
  const quantity = numbers.find((num) => parseInt(num) <= 10);
  return quantity ? parseInt(quantity) : 1;
}

module.exports = {
  parseKoreanDate,
  safeParseDate,
  extractPriceFromContent,
  generateSimpleId,
  extractQuantityFromComment,
};
