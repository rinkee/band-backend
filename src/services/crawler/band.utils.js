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
 * 텍스트 내용에서 가격 정보를 추출하는 함수
 * @param {string} content - 텍스트 내용
 * @returns {number} - 추출된 가격(가장 낮은 가격)
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
 * 텍스트 내용에서 다양한 가격 옵션을 추출하는 함수
 * @param {string} content - 텍스트 내용
 * @returns {Object} - 다양한 가격 옵션 정보 {basePrice, priceOptions}
 */
function extractPriceOptions(content) {
  if (!content) return { basePrice: 0, priceOptions: [] };

  const result = {
    basePrice: 0,
    priceOptions: [],
  };

  // 일반 가격 패턴 (숫자+원)
  const simplePriceRegex = /(\d+,?\d*,?\d*)원/g;

  // 수량과 가격 패턴 (n팩 숫자원, n개 숫자원 등)
  const optionPriceRegexes = [
    // n팩 숫자원
    /(\d+)\s*팩\s*(?:[\→\=\:]{1,2})?\s*(\d+,?\d*,?\d*)원/g,
    // n개 숫자원
    /(\d+)\s*개\s*(?:[\→\=\:]{1,2})?\s*(\d+,?\d*,?\d*)원/g,
    // n세트 숫자원
    /(\d+)\s*세트\s*(?:[\→\=\:]{1,2})?\s*(\d+,?\d*,?\d*)원/g,
    // n박스 숫자원
    /(\d+)\s*박스\s*(?:[\→\=\:]{1,2})?\s*(\d+,?\d*,?\d*)원/g,
  ];

  // 줄별로 분석하여 옵션 패턴 찾기
  const lines = content.split("\n");

  for (const line of lines) {
    // 모든 옵션 패턴에 대해 검사
    for (const regex of optionPriceRegexes) {
      regex.lastIndex = 0; // 정규식 인덱스 리셋
      let match;

      while ((match = regex.exec(line)) !== null) {
        const quantity = parseInt(match[1], 10);
        const price = parseInt(match[2].replace(/,/g, ""), 10);

        if (!isNaN(quantity) && !isNaN(price) && quantity > 0 && price > 0) {
          // 옵션 설명 추출 시도
          let description = line.trim();
          if (description.length > 50) {
            description = description.substring(0, 47) + "...";
          }

          result.priceOptions.push({
            quantity,
            price,
            description,
          });
        }
      }
    }

    // 라인에 일반 가격 패턴이 있는지 확인
    const simplePrices = [];
    let simpleMatch;
    const simpleRegex = new RegExp(simplePriceRegex);

    while ((simpleMatch = simpleRegex.exec(line)) !== null) {
      const price = parseInt(simpleMatch[1].replace(/,/g, ""), 10);
      if (!isNaN(price) && price > 0) {
        simplePrices.push(price);
      }
    }

    // 일반 가격이 있으면서 수량 옵션이 없는 경우, 기본 옵션으로 추가
    if (
      simplePrices.length > 0 &&
      !optionPriceRegexes.some((regex) => regex.test(line))
    ) {
      const price = Math.min(...simplePrices);
      let description = line.trim();
      if (description.length > 50) {
        description = description.substring(0, 47) + "...";
      }

      result.priceOptions.push({
        quantity: 1,
        price,
        description,
      });
    }
  }

  // 옵션이 없는 경우 기본 가격 추출 시도
  if (result.priceOptions.length === 0) {
    const basePrice = extractPriceFromContent(content);
    result.basePrice = basePrice;

    if (basePrice > 0) {
      result.priceOptions.push({
        quantity: 1,
        price: basePrice,
        description: "기본가",
      });
    }
  } else {
    // 가장 저렴한 옵션을 basePrice로 설정
    const perUnitPrices = result.priceOptions.map((opt) => ({
      price: opt.price,
      perUnit: opt.price / opt.quantity,
    }));

    const cheapestOption = perUnitPrices.reduce(
      (min, curr) => (curr.perUnit < min.perUnit ? curr : min),
      perUnitPrices[0]
    );

    result.basePrice = cheapestOption.price;
  }

  return result;
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
 * 댓글에서 수량 정보를 추출하는 함수
 * @param {string} comment - 댓글 내용
 * @returns {number} - 추출된 수량 (기본값: 1)
 */
function extractQuantityFromComment(comment) {
  if (!comment) return 1;

  // 취소 키워드 확인
  if (
    comment.includes("취소") ||
    comment.includes("캔슬") ||
    comment.includes("환불") ||
    comment.includes("cancel")
  ) {
    return 0;
  }

  // 수량 패턴: 숫자+개, 숫자+팩, 숫자+세트, 숫자+봉지, 또는 단독 숫자
  const patterns = [
    /(\d+)\s*개/i,
    /(\d+)\s*팩/i,
    /(\d+)\s*세트/i,
    /(\d+)\s*봉지/i,
    /(\d+)\s*묶음/i,
    /(\d+)\s*박스/i,
    /(\d+)\s*통/i,
    /(\d+)\s*set/i,
    /(\d+)\s*pack/i,
    /(\d+)ea/i,
    /(\d+)pcs/i,
    /(\d+)개씩/i,
  ];

  for (const pattern of patterns) {
    const match = comment.match(pattern);
    if (match && match[1]) {
      const quantity = parseInt(match[1], 10);
      return isNaN(quantity) || quantity <= 0 ? 1 : quantity;
    }
  }

  // 단순 숫자 패턴 (댓글 시작 부분이나 스페이스 뒤에 숫자만 있는 경우)
  const simpleNumberPattern = /(^|\s)(\d{1,2})(\s|$)/;
  const simpleMatch = comment.match(simpleNumberPattern);
  if (simpleMatch && simpleMatch[2]) {
    const quantity = parseInt(simpleMatch[2], 10);
    // 1~99 범위의 숫자만 수량으로 간주
    if (!isNaN(quantity) && quantity > 0 && quantity < 100) {
      return quantity;
    }
  }

  // 텍스트 수량 (일, 이, 삼, ...)
  const koreanNumbers = {
    일: 1,
    하나: 1,
    한: 1,
    한개: 1,
    "1개": 1,
    "1팩": 1,
    이: 2,
    둘: 2,
    두: 2,
    두개: 2,
    "2개": 2,
    "2팩": 2,
    삼: 3,
    셋: 3,
    세: 3,
    세개: 3,
    "3개": 3,
    "3팩": 3,
    사: 4,
    넷: 4,
    네: 4,
    네개: 4,
    "4개": 4,
    "4팩": 4,
    오: 5,
    다섯: 5,
    "5개": 5,
    "5팩": 5,
    육: 6,
    여섯: 6,
    "6개": 6,
    "6팩": 6,
    칠: 7,
    일곱: 7,
    "7개": 7,
    "7팩": 7,
    팔: 8,
    여덟: 8,
    "8개": 8,
    "8팩": 8,
    구: 9,
    아홉: 9,
    "9개": 9,
    "9팩": 9,
    십: 10,
    열: 10,
    "10개": 10,
    "10팩": 10,
  };

  for (const [word, number] of Object.entries(koreanNumbers)) {
    if (comment.includes(word)) {
      return number;
    }
  }

  return 1; // 기본값
}

module.exports = {
  parseKoreanDate,
  safeParseDate,
  extractPriceFromContent,
  extractPriceOptions,
  generateSimpleId,
  extractQuantityFromComment,
};
