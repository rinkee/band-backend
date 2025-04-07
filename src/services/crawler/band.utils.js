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
    if (ampm === "오후" && adjustedHour < 12) adjustedHour += 12;
    else if (ampm === "오전" && adjustedHour === 12) adjustedHour = 0;
    try {
      return new Date(
        currentYear,
        parseInt(month) - 1,
        parseInt(day),
        adjustedHour,
        parseInt(minute)
      );
    } catch {
      return null;
    }
  }

  // 형식 2: "2025년 3월 14일 오후 3:55"
  match = dateString.match(/(\d+)년 (\d+)월 (\d+)일 (오전|오후) (\d+):(\d+)/);
  if (match) {
    const [_, year, month, day, ampm, hour, minute] = match;
    let adjustedHour = parseInt(hour);
    if (ampm === "오후" && adjustedHour < 12) adjustedHour += 12;
    else if (ampm === "오전" && adjustedHour === 12) adjustedHour = 0;
    try {
      return new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        adjustedHour,
        parseInt(minute)
      );
    } catch {
      return null;
    }
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
    const koreanDate = parseKoreanDate(dateString);
    if (koreanDate && !isNaN(koreanDate.getTime())) return koreanDate;

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
    const parsedDate = new Date(dateString);
    if (isNaN(parsedDate.getTime())) {
      logger.warn(`유효하지 않은 날짜 형식 시도: ${dateString}`);
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
 * 게시물 본문에서 번호 지정 상품 목록을 추출합니다.
 * 예: "1번. 씨앗젓갈 1통(300g)👉9,500원", "2. 비빔낙지 9,500"
 * @param {string} content - 게시물 본문 텍스트
 * @returns {Array<Object>} - 추출된 상품 목록 [{ itemNumber: number, title: string, price: number, description: string }]
 */
function extractNumberedProducts(content) {
  const products = [];
  if (!content) return products;

  // 정규식 설명:
  // ^(\d+) : 라인 시작 부분의 숫자 (상품 번호, 그룹 1)
  // [번.\s:👉]+ : 번호와 상품명 구분자 (번, 점, 공백, 콜론, 화살표 등, 1개 이상)
  // (.+?) : 상품명 (최소 매칭, 그룹 2)
  // (?:👉|->|[:\s]|$) : 상품명과 가격 구분 기호 또는 라인 끝 (캡처 안 함)
  // [\s\S]*? : 가격 앞까지의 모든 문자 (개행 포함, 최소 매칭)
  // (\d{1,3}(?:,\d{3})*)\s*(?:원|$) : 가격 (쉼표 포함 숫자), '원' 또는 라인 끝으로 종료 (그룹 3)
  const regex =
    /^(\d+)[번.\s:👉]+(.+?)(?:👉|->|[:\s]|$)[\s\S]*?(\d{1,3}(?:,\d{3})*)\s*(?:원|$)/gm;

  let match;
  while ((match = regex.exec(content)) !== null) {
    try {
      const itemNumber = parseInt(match[1], 10);
      // 상품명에서 불필요한 부분 제거 시도 (예: 수량/단위 정보)
      let title = match[2].trim();
      // 가격 정보나 화살표 등 명확한 구분자 이후 내용은 제거
      title = title.split(/👉|->|[:\s]\d{1,3}(?:,\d{3})*원/)[0].trim();
      // 흔한 용량/단위 정보 제거 (정규식 개선 필요)
      title = title
        .replace(/\s*1통\(\d+g\)/, "")
        .replace(/\s*\(\d+g\)/, "")
        .trim();

      const priceString = match[3].replace(/,/g, ""); // 쉼표 제거
      const price = parseInt(priceString, 10);

      // 간단한 설명 (해당 라인 전체 또는 일부)
      const description = match[0].trim(); // 매칭된 전체 라인을 설명으로 사용

      if (!isNaN(itemNumber) && title && !isNaN(price) && price > 0) {
        logger.debug(`상품 추출 성공: #${itemNumber} - ${title} (${price}원)`);
        products.push({
          itemNumber,
          title,
          price,
          description,
        });
      } else {
        logger.warn(
          `상품 추출 부분 실패: Line='${match[0]}', Num=${itemNumber}, Title='${title}', Price=${price}`
        );
      }
    } catch (e) {
      logger.error(
        `상품 추출 중 오류 발생: ${e.message} on line '${match[0]}'`
      );
    }
  }

  if (products.length === 0) {
    logger.info("번호 지정 형식의 상품을 찾지 못했습니다.");
  }

  return products;
}

/**
 * 댓글에서 수량 정보를 추출하는 함수 (단순 숫자 또는 한글 숫자 위주, fallback용)
 * @param {string} comment - 댓글 내용
 * @returns {number} - 추출된 수량 (기본값: 1)
 */
function extractQuantityFromComment(comment) {
  if (!comment) return 1;

  // 취소/마감 키워드 먼저 확인
  if (hasClosingKeywords(comment) || comment.includes("취소")) {
    return 0; // 취소/마감 시 수량 0
  }

  // 명시적 단위 포함 패턴 우선 (extractNumberedOrderFromComment 와 겹칠 수 있음)
  const patterns = [
    /(\d+)\s*(?:개|팩|세트|봉지|묶음|박스|통|set|pack|ea|pcs)/i,
  ];
  for (const pattern of patterns) {
    const match = comment.match(pattern);
    if (match && match[1]) {
      const quantity = parseInt(match[1], 10);
      return isNaN(quantity) || quantity <= 0 ? 1 : quantity;
    }
  }

  // 단순 숫자 패턴 (1~99)
  const simpleNumberPattern = /(?:^|\s)(\d{1,2})(?:$|\s|개|팩|세트)/; // 단독 숫자 또는 뒤에 단위
  const simpleMatch = comment.match(simpleNumberPattern);
  if (simpleMatch && simpleMatch[1]) {
    const quantity = parseInt(simpleMatch[1], 10);
    if (!isNaN(quantity) && quantity > 0 && quantity < 100) {
      return quantity;
    }
  }

  // 한글 숫자
  const koreanNumbers = {
    일: 1,
    하나: 1,
    한: 1,
    이: 2,
    둘: 2,
    두: 2,
    삼: 3,
    셋: 3,
    세: 3,
    사: 4,
    넷: 4,
    네: 4,
    오: 5,
    다섯: 5,
    육: 6,
    여섯: 6,
    칠: 7,
    일곱: 7,
    팔: 8,
    여덟: 8,
    구: 9,
    아홉: 9,
    십: 10,
    열: 10,
  };
  for (const [word, number] of Object.entries(koreanNumbers)) {
    // '한 개', '두 세트' 등 공백 포함 케이스 고려
    if (
      comment.includes(word + "개") ||
      comment.includes(word + "팩") ||
      comment.includes(word + "세트") ||
      comment.includes(word)
    ) {
      // '만', '뿐' 등 제외 로직 추가 가능
      if (!comment.includes(word + "만") && !comment.includes(word + "뿐")) {
        return number;
      }
    }
  }

  return 1; // 모든 패턴 실패 시 기본값 1
}

/**
 * 댓글에 마감 또는 종료 키워드가 있는지 확인하는 함수 (기존 유지)
 * @param {string} comment - 댓글 내용
 * @returns {boolean} - 마감 또는 종료 키워드가 있는지 여부
 */
function hasClosingKeywords(comment) {
  if (!comment) return false;
  const closingKeywords = [
    "마감",
    "종료",
    "완판",
    "품절",
    "완료",
    "주문마감",
    "주문종료",
    "판매마감",
    "판매종료",
    "sold out",
    "soldout",
  ];
  const lowerComment = comment.toLowerCase();
  return closingKeywords.some((keyword) => lowerComment.includes(keyword));
}

/**
 * 상품 번호를 포함하는 고유 상품 ID를 생성합니다.
 * @param {string} userId - 사용자 ID
 * @param {string} bandNumber - 밴드 ID
 * @param {string} originalPostId - 원본 게시물 ID (문자열)
 * @param {number} itemNumber - 상품 번호
 * @returns {string} - 생성된 고유 상품 ID (예: prod_...)
 */
function generateProductUniqueIdForItem(
  userId,
  bandNumber,
  originalPostId,
  itemNumber
) {
  const stableData = `prod_${bandNumber}_${originalPostId}_item${itemNumber}`;
  return stableData; // 접두사 및 길이 조절
}

function generateCustomerUniqueId(userId, bandNumber, postId, number) {
  // 가격처럼 변동 가능성이 있는 값은 제외하고, 변하지 않는 핵심 속성만 사용합니다.
  const stableData = `order_${bandNumber}_${postId}_number${number}`;
  return stableData;
}

function generatePostUniqueId(userId, bandNumber, postId) {
  // 가격처럼 변동 가능성이 있는 값은 제외하고, 변하지 않는 핵심 속성만 사용합니다.
  const stableData = `${userId}-${bandNumber}-${postId}`;
  return stableData;
}

function generateOrderUniqueId(bandNumber, postId, index) {
  const stableData = `${bandNumber}-${postId}-${index}`;
  return stableData;
}

/**
 * 게시물 내용에 가격 관련 표시가 있는지 간단히 확인합니다.
 * @param {string} content - 게시물 본문 텍스트
 * @returns {boolean} - 가격 표시 존재 여부
 */
function contentHasPriceIndicator(content) {
  if (!content) return false;
  // 숫자 + 원/만원/천원 또는 통화 기호 또는 '가격' 단어 확인 (더 많은 키워드 추가 가능)
  const priceRegex = /[0-9]+(?:[,0-9])*\s*(?:원|만원|천원)|[\$€¥₩]|price|가격/i;
  return priceRegex.test(content);
}

/**
 * 댓글 내용에서 주문 정보를 [개선된 방식]으로 추출합니다.
 * 명시적 상품 번호가 우선되며, 다양한 단위를 유연하게 처리하고 모호성을 표시합니다.
 * @param {string} commentText - 댓글 내용
 * @param {object} logger - 로깅 객체 (console 대체 가능)
 * @returns {Array<{itemNumber: number|null, quantity: number, isAmbiguous: boolean}>} - 추출된 주문 목록
 */
function extractEnhancedOrderFromComment(commentText, logger = console) {
  const orders = [];
  if (!commentText) return orders;

  const originalText = commentText; // 로깅용 원본 저장

  // 0-1. 취소/마감 키워드 확인 (주문으로 처리 안 함)
  // hasClosingKeywords 함수가 별도로 정의되어 있다고 가정합니다.
  // if (hasClosingKeywords(commentText) || ...)
  if (
    commentText.toLowerCase().includes("마감") || // 예시 키워드
    commentText.toLowerCase().includes("취소") ||
    commentText.toLowerCase().includes("cancel")
  ) {
    logger.info(`[주문 추출 제외] 마감/취소 키워드 포함: ${originalText}`);
    return orders;
  }

  // 0-2. 전처리: '한' + 단위 처리 및 공백 정규화
  // "한 박스" -> "1 박스", "한개" -> "1개" 등 (공백 유지하며 변환 시도)
  let processedText = commentText.replace(/한\s*([가-힣]{1,3})/g, "1 $1");
  // 이후 여러 공백을 하나로 줄임 (정규식 처리 용이)
  processedText = processedText.replace(/\s+/g, " ").trim();

  // 정규식 패턴들 (단위 부분 유연화)
  // 패턴 1: (상품번호)(번/./공백)? (수량) [유연한 단위]? [어미]? -> itemNumber, quantity 추출
  // 단위: 한글 1~3자 또는 지정된 영문/단위, 전체 단위는 선택적(?)
  const numberedOrderRegex =
    /(\d+)\s*[번.\s]*?(\d+)\s*([가-힣]{1,3}|box|set|pack|ea|pcs|kg|g|키로|그램)?\s*(?:요|~)?/gi;

  // 패턴 2: (상품번호)\s*만\s*(수량) -> itemNumber, quantity 추출 (기존과 동일)
  const itemOnlyRegex = /(\d+)\s*만\s*(\d+)/gi;

  // 패턴 3: (한글/숫자수량) [필수 단위] [어미]? (상품번호 없는 경우) -> quantity 추출, itemNumber는 null
  // 단위: 한글 1~3자 또는 지정된 영문/단위, 최소 1개 단위 필수(+)
  const quantityUnitRegex =
    /(하나|한|둘|두|셋|세|넷|네|다섯|여섯|일곱|여덟|아홉|열|\d+)\s*(?:[가-힣]{1,3}|개|팩|세트|셋|봉|봉지|묶음|박스|통|box|set|pack|ea|pcs|kg|g|키로|그램)+\s*(?:요|~)?/gi;
  // 참고: 여기서 단위를 선택적(?)으로 바꾸면 "하나"만 있는 댓글도 매칭되지만 모호성이 커짐. 필수(+) 유지 권장.

  // 패턴 4: 압축된 텍스트 처리 (N번M개) (기존과 동일, 공백제거 후 실행)
  const condensedRegex = /(\d+)[번.]*(\d+)/g;

  const koreanNumMap = {
    하나: 1,
    한: 1,
    둘: 2,
    두: 2,
    셋: 3,
    세: 3,
    넷: 4,
    네: 4,
    다섯: 5,
    여섯: 6,
    일곱: 7,
    여덟: 8,
    아홉: 9,
    열: 10,
  };

  let match;
  let foundExplicitOrder = false; // 명시적 번호 주문 찾았는지 여부 플래그

  // --- 1. 명시적 번호 주문 찾기 (패턴 1, 2) ---
  while ((match = numberedOrderRegex.exec(processedText)) !== null) {
    try {
      const itemNumber = parseInt(match[1], 10);
      const quantity = parseInt(match[2], 10);
      const unit = match[3]; // 추출된 단위 (로깅/디버깅용)

      if (
        !isNaN(itemNumber) &&
        itemNumber > 0 &&
        !isNaN(quantity) &&
        quantity > 0
      ) {
        // 명시적 주문 중복 방지 (같은 상품번호의 명시적 주문이 없는 경우 추가)
        if (
          !orders.some((o) => o.itemNumber === itemNumber && !o.isAmbiguous)
        ) {
          orders.push({ itemNumber, quantity, isAmbiguous: false });
          logger.debug(
            `[패턴 1] 주문: #${itemNumber} - ${quantity}${
              unit ? ` (${unit})` : ""
            } | 원문: ${match[0]}`
          );
        } else {
          logger.debug(
            `[패턴 1] 중복 주문 건너뜀: #${itemNumber} | 원문: ${match[0]}`
          );
        }
        foundExplicitOrder = true;
      }
    } catch (e) {
      logger.error(`[패턴 1] 처리 오류: ${match[0]}`, e);
    }
  }

  while ((match = itemOnlyRegex.exec(processedText)) !== null) {
    try {
      const itemNumber = parseInt(match[1], 10);
      const quantity = parseInt(match[2], 10);
      if (
        !isNaN(itemNumber) &&
        itemNumber > 0 &&
        !isNaN(quantity) &&
        quantity > 0
      ) {
        if (
          !orders.some((o) => o.itemNumber === itemNumber && !o.isAmbiguous)
        ) {
          orders.push({ itemNumber, quantity, isAmbiguous: false });
          logger.debug(
            `[패턴 2] 주문 ('만'): #${itemNumber} - ${quantity} | 원문: ${match[0]}`
          );
        } else {
          logger.debug(
            `[패턴 2] 중복 주문 건너뜀: #${itemNumber} | 원문: ${match[0]}`
          );
        }
        foundExplicitOrder = true;
      }
    } catch (e) {
      logger.error(`[패턴 2] 처리 오류: ${match[0]}`, e);
    }
  }

  // --- 2. 명시적 번호 주문 없으면, 번호 없는 수량/단위 주문 찾기 (패턴 3) ---
  if (!foundExplicitOrder) {
    while ((match = quantityUnitRegex.exec(processedText)) !== null) {
      try {
        let quantityStr = match[1];
        let quantity =
          koreanNumMap[quantityStr.toLowerCase()] || parseInt(quantityStr, 10);
        const unit = match[2]; // 패턴3의 단위부분은 비캡처그룹이라 match[2]는 없을 것임. 디버깅용으로 남겨둠.

        if (!isNaN(quantity) && quantity > 0) {
          // isAmbiguous: true 로 표시, itemNumber는 null
          // 번호 없는 주문은 여러 개 있을 수 있으므로, 첫 번째 매칭만 사용하지 않고 모두 추가할 수 있음 (기존 코드와 다름 - 필요시 break 유지)
          orders.push({ itemNumber: null, quantity, isAmbiguous: true });
          logger.debug(
            `[패턴 3] 주문 (번호X, 모호): 수량 ${quantity} | 매칭: ${match[0]}`
          );
          // 만약 번호 없는 주문은 하나만 인정하려면 여기에 break; 추가
        }
      } catch (e) {
        logger.error(`[패턴 3] 처리 오류: ${match[0]}`, e);
      }
    }
  }

  // --- 3. 압축된 텍스트 처리 ("1번2개") - 최후의 수단 (명시적 번호 주문 못 찾았을 때) ---
  // 또는 orders.length === 0 조건 대신, !foundExplicitOrder && orders.length === 0 와 같이 명시적 주문 없을 때만 시도
  if (!foundExplicitOrder && orders.length === 0) {
    const condensedText = processedText.replace(/\s+/g, ""); // 공백 제거
    while ((match = condensedRegex.exec(condensedText)) !== null) {
      try {
        const itemNumber = parseInt(match[1], 10);
        const quantity = parseInt(match[2], 10);
        if (
          !isNaN(itemNumber) &&
          itemNumber > 0 &&
          !isNaN(quantity) &&
          quantity > 0
        ) {
          // 여기서는 중복 체크가 덜 중요할 수 있지만, 일관성을 위해 유지
          if (
            !orders.some((o) => o.itemNumber === itemNumber && !o.isAmbiguous)
          ) {
            orders.push({ itemNumber, quantity, isAmbiguous: false }); // 압축 형태도 명시적으로 간주
            logger.debug(
              `[패턴 4] 주문 (압축): #${itemNumber} - ${quantity} | 원문: ${match[0]}`
            );
            foundExplicitOrder = true; // 압축이라도 번호 찾으면 명시적 처리
          } else {
            logger.debug(
              `[패턴 4] 중복 주문 건너뜀: #${itemNumber} | 원문: ${match[0]}`
            );
          }
        }
      } catch (e) {
        logger.error(`[패턴 4] 처리 오류: ${match[0]}`, e);
      }
    }
  }

  // 최종 로깅
  if (orders.length > 0) {
    logger.info(
      `[주문 추출 완료] 원문: "${originalText}" -> 결과: ${JSON.stringify(
        orders
      )}`
    );
  } else if (/\d/.test(processedText)) {
    // 숫자는 있는데 아무 패턴도 못 찾음
    logger.info(`[주문 추출 실패] 패턴 매칭 실패 (숫자 포함): ${originalText}`);
  } else {
    // 숫자도 없음
    logger.info(`[주문 정보 없음] 주문 패턴 미발견: ${originalText}`);
  }

  return orders;
}

// --- 테스트 케이스 ---
// const testComments = [
//   "1번 2개요",
//   "2번 1모 주세요", // 새로운 단위
//   "3번 5봉지요", // 새로운 단위 + 요
//   "1번 10 상자", // 새로운 단위 + 공백
//   "2번 1세트, 1번 3개", // 다중 주문
//   "1개요", // 번호 없는 주문 (isAmbiguous: true)
//   "2봉지", // 번호 없는 주문
//   "셋 박스요", // 한글 수량 + 새로운 단위
//   "1", // 숫자만 (패턴 3에서 단위가 필수라 매칭 안됨 - 의도대로)
//   "2요", // 숫자+요 (패턴 3에서 단위가 필수라 매칭 안됨 - 의도대로)
//   "1번 2", // 명시적 번호 + 수량만 (단위 없음 - 패턴 1 매칭)
//   "1번 2, 5모, 2번 1세트, 4상자, 10개", // 복합 + 번호없는 주문 포함
//   "이건 그냥 댓글입니다",
//   "5번만 주세요", // 실패 예상 (수량 없음)
//   "5번만 2개", // 패턴 2 매칭
//   "10번 한세트요", // 전처리 '한' -> '1' 테스트
//   "2번 한봉지 요", // 전처리 '한' + 공백 테스트
//   "3번 두개", // 한글 수량 (패턴 3 매칭 - 번호 없어야 함) -> 현재 로직 상 3번이 있어서 패턴 1,2 우선 매칭 실패 후 패턴 3 실행 안됨.
//   "두개만 주세요", // 패턴 3 매칭
//   "1번 100개!", // 특수문자 -> 패턴 1에서 뒤 '!' 무시하고 매칭 시도
//   "10 모", // 패턴 3 매칭 (번호 없음)
//   "취소할게요", // 취소 키워드
//   "마감입니다", // 마감 키워드
//   "1번1개 2번2개", // 압축 텍스트 처리 (패턴 4)
//   "1번 두개, 2번 3개요", // '두개'가 패턴 1,2에 안 맞고, 1번이 있어서 패턴 3 실행 안 됨. (한계점)
// ];

// testComments.forEach((comment) => {
//   console.log(`\n--- 테스트 댓글: "${comment}" ---`);
//   extractEnhancedOrderFromComment(comment, console); // console 객체를 logger로 사용
// });

module.exports = {
  parseKoreanDate,
  safeParseDate,
  // extractPriceFromContent, // 대체됨
  // extractPriceOptions, // 대체됨
  extractNumberedProducts, // 신규 추가

  generateSimpleId, // 기존 유지 (필요시 사용)
  extractQuantityFromComment, // 기존 유지 (Fallback 또는 단순 수량용)
  hasClosingKeywords, // 기존 유지
  generatePostUniqueId, // 기존 유지 (접두사/길이 조절됨)
  generateCustomerUniqueId,
  generateProductUniqueIdForItem, // 신규 추가
  generateOrderUniqueId, // 수정됨
  contentHasPriceIndicator,
  extractEnhancedOrderFromComment,
};
