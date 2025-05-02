// src/services/crawler/band.utils.js
const crypto = require("crypto");
const logger = require("../../config/logger");
const { createClient } = require("@supabase/supabase-js");

// Supabase 클라이언트 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * 주문 수량과 가격 옵션을 기반으로 가장 저렴한 총 금액을 계산합니다.
 * @param {number} orderQuantity - 주문하려는 총 수량
 * @param {Array<Object>} priceOptions - 상품의 가격 옵션 배열 [{ quantity: number, price: number, description?: string }, ...]
 * @param {number} fallbackUnitPrice - 가격 옵션이 없거나 잘못된 경우 사용할 개당 가격 (예: product.base_price)
 * @returns {number} - 계산된 최적의 총 금액 (정수로 반올림)
 */
function calculateOptimalPrice(
  orderQuantity,
  priceOptions,
  fallbackUnitPrice = 0
) {
  // 입력값 유효성 검사
  if (typeof orderQuantity !== "number" || orderQuantity <= 0) {
    return 0;
  }
  if (!Array.isArray(priceOptions) || priceOptions.length === 0) {
    // 가격 옵션이 없으면 fallback 단가 * 수량 반환
    return Math.round(fallbackUnitPrice * orderQuantity);
  }

  // 유효한 가격 옵션만 필터링 (quantity와 price가 유효한 숫자)
  const validOptions = priceOptions.filter(
    (opt) =>
      typeof opt.quantity === "number" &&
      opt.quantity > 0 &&
      typeof opt.price === "number" &&
      opt.price >= 0
  );

  if (validOptions.length === 0) {
    // 유효한 옵션이 없으면 fallback 사용
    return Math.round(fallbackUnitPrice * orderQuantity);
  }

  // 수량 기준으로 내림차순 정렬 (큰 묶음부터 처리하기 위함)
  validOptions.sort((a, b) => b.quantity - a.quantity);

  let remainingQuantity = orderQuantity;
  let totalCost = 0;

  // 가장 큰 묶음부터 적용
  for (const option of validOptions) {
    if (remainingQuantity >= option.quantity) {
      // 현재 옵션의 묶음을 몇 개 사용할 수 있는지 계산
      const numberOfBundles = Math.floor(remainingQuantity / option.quantity);
      totalCost += numberOfBundles * option.price;
      remainingQuantity -= numberOfBundles * option.quantity;
      // console.log(`Using option: ${numberOfBundles} bundles of ${option.quantity} @ ${option.price}. Remaining: ${remainingQuantity}`);
    }
  }

  // 모든 묶음 옵션을 적용하고도 남은 수량이 있다면
  if (remainingQuantity > 0) {
    // 가장 작은 단위(일반적으로 quantity: 1)의 가격을 찾아 적용
    // 이미 quantity 기준 오름차순 정렬했으므로 마지막 요소가 가장 작은 단위일 가능성이 높음
    // 또는 quantity: 1인 옵션을 직접 찾음
    let singleUnitPrice = fallbackUnitPrice; // 기본값은 fallback

    const singleUnitOption = validOptions.find((opt) => opt.quantity === 1);
    if (singleUnitOption) {
      singleUnitPrice = singleUnitOption.price;
    } else {
      // quantity: 1 옵션이 없으면, 유효 옵션 중 가장 작은 quantity 옵션의 단가를 계산하여 사용
      const smallestOption = validOptions[validOptions.length - 1]; // 내림차순 정렬했으므로 마지막 요소
      if (smallestOption) {
        singleUnitPrice = smallestOption.price / smallestOption.quantity;
      }
    }

    // console.log(`Using single unit price ${singleUnitPrice} for remaining ${remainingQuantity} items.`);
    totalCost += remainingQuantity * singleUnitPrice;
  }

  return Math.round(totalCost); // 최종 금액 반올림
}

/**
 * DB의 작업 상태를 업데이트하는 함수
 * @param {string} taskId
 * @param {string} status
 * @param {string} message
 * @param {number} progress
 * @param {string | null} [errorMessage=null] - 오류 메시지 (실패 시)
 */
async function updateTaskStatusInDB(
  taskId,
  status,
  message,
  progress,
  errorMessage = null
) {
  if (!taskId) return; // taskId 없으면 아무것도 안 함

  const updateData = {
    status,
    message,
    progress,
    updated_at: new Date().toISOString(), // 명시적으로 업데이트 시간 설정
  };

  if (status === "failed") {
    updateData.error_message = errorMessage || "알 수 없는 오류";
    updateData.end_time = updateData.updated_at;
  } else if (status === "completed") {
    updateData.end_time = updateData.updated_at;
  }

  try {
    const { error } = await supabase
      .from("crawl_tasks") // 실제 테이블 이름 사용
      .update(updateData)
      .eq("task_id", taskId);

    if (error) {
      logger.error(
        `DB 작업 상태 업데이트 오류 (Task ID: ${taskId}): ${error.message}`
      );
    } else {
      logger.debug(
        `DB 작업 상태 업데이트 완료 (Task ID: ${taskId}): ${status} - ${message} (${progress}%)`
      );
    }
  } catch (dbError) {
    logger.error(
      `DB 작업 상태 업데이트 중 예외 발생 (Task ID: ${taskId}): ${dbError.message}`
    );
  }
}

/**
 * productId로부터 고유한 13자리 EAN-13 바코드 번호를 생성합니다.
 * 사용자의 auto_barcode_generation 설정이 false이면 null을 반환합니다.
 * @param {string} productId - 상품 ID
 * @param {string} userId - 사용자 ID (설정 확인용)
 * @returns {Promise<string|null>} - 13자리 바코드 숫자 또는 null
 */
async function generateBarcodeFromProductId(productId, userId) {
  // <<<--- async 및 userId 인수 추가
  // <<<--- 로그 추가: 함수 시작 및 입력값 확인 --->>>
  logger.debug(
    `[Barcode Func] generateBarcodeFromProductId called with productId: ${productId}, userId: ${userId}`
  );

  // 1. 입력값 유효성 검사
  if (!productId || typeof productId !== "string") {
    logger.error(
      `[Barcode Func] Invalid productId received: ${productId}. Returning null.`
    );
    return null;
  }
  if (!userId) {
    logger.error(
      `[Barcode Func] Missing userId. Cannot check setting. Returning null.`
    );
    return null;
  }

  // <<<--- 사용자 설정 확인 로직 추가 --- START --->>>
  let autoGenerate = false; // 기본값 false
  try {
    const { data: userData, error: userError } = await supabase
      .from("users") // 실제 사용자 테이블 이름 사용 ('users' 또는 'profiles' 등)
      .select("auto_barcode_generation")
      .eq("user_id", userId) // 사용자 테이블의 ID 필드 이름 사용
      .single(); // 단일 사용자 조회

    if (userError) {
      // 사용자를 찾지 못한 경우도 에러로 처리될 수 있음 (예: RLS)
      logger.error(
        `[Barcode Func] Error fetching user settings for userId ${userId}: ${userError.message}. Assuming disabled.`
      );
      return null; // 설정 조회 실패 시 null 반환
    }

    if (userData) {
      // userData가 있고, auto_barcode_generation 필드가 true이면 활성화
      autoGenerate = userData.auto_barcode_generation === true;
      logger.debug(
        `[Barcode Func] User ${userId} setting 'auto_barcode_generation': ${autoGenerate}`
      );
    } else {
      // 사용자를 찾았지만 데이터가 없는 경우 (이론상 single()에서는 잘 발생 안 함)
      logger.warn(
        `[Barcode Func] User data not found for userId ${userId}, although query succeeded. Assuming disabled.`
      );
      return null;
    }
  } catch (fetchError) {
    logger.error(
      `[Barcode Func] Exception fetching user settings for userId ${userId}: ${fetchError.message}. Assuming disabled.`
    );
    return null; // 예외 발생 시 null 반환
  }

  // 설정이 false이면 여기서 함수 종료
  if (!autoGenerate) {
    logger.info(
      `[Barcode Func] Barcode generation skipped for userId ${userId} as 'auto_barcode_generation' is disabled.`
    );
    return null;
  }
  // <<<--- 사용자 설정 확인 로직 추가 --- END --->>>

  // --- 기존 바코드 생성 로직 (설정이 true일 때만 실행됨) ---
  logger.debug(
    `[Barcode Func] Proceeding with barcode generation for productId: ${productId} (User setting enabled)`
  );
  try {
    // 1) SHA-256 해시 생성
    const hash = crypto.createHash("sha256").update(productId).digest();

    // 2) 해시의 앞 6바이트(48비트)를 읽어 12자리 숫자로 압축
    const num = hash.readUIntBE(0, 6);
    const code12 = (num % 1e12).toString().padStart(12, "0");

    // 3) EAN-13 체크 디지트 계산 (mod 10 가중합 방식)
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const digit = parseInt(code12[i], 10);
      sum += i % 2 === 0 ? digit : digit * 3;
    }
    const checkDigit = (10 - (sum % 10)) % 10;

    const finalBarcode = code12 + checkDigit.toString();

    // <<<--- 로그 추가: 최종 반환값 확인 --->>>
    logger.debug(
      `[Barcode Func] Generated barcode for ${productId}: ${finalBarcode}`
    );

    return finalBarcode;
  } catch (error) {
    // <<<--- 로그 추가: 함수 내부 오류 발생 시 --->>>
    logger.error(
      `[Barcode Func] Error during barcode generation for ${productId}: ${error.message}`,
      error.stack
    );
    return null; // 생성 중 오류 발생 시 null 반환
  }
}

/**
 * 한국어 날짜 형식 파싱 함수
 * @param {string} dateString - 파싱할 날짜 문자열
 * @returns {Date|null} - 파싱된 Date 객체 또는 null
 */
function parseKoreanDate(dateString) {
  // 타입 검사 추가: dateString이 문자열이 아니면 null 반환
  if (typeof dateString !== 'string') {
    logger.warn(`parseKoreanDate: 문자열이 아닌 입력값 (${typeof dateString}) ${dateString}`);
    return null;
  }

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
 * 게시물 본문 내용에 가격 표시가 있는지 확인하는 함수 (수정된 정규식 적용)
 * @param {string} content - 게시물 본문 내용
 * @returns {boolean} - 가격 표시가 있으면 true, 없으면 false
 */
function contentHasPriceIndicator(content) {
  // 함수 내부 디버깅 로그는 필요에 따라 유지하거나 제거/주석 처리하세요.
  if (!content) return false;

  // 1. 키워드 확인
  const keywordRegex = /수령|픽업|도착|예약|주문|특가|정상가|할인가|가격|원|₩/;
  const hasKeyword = keywordRegex.test(content);
  // logger.debug(`[Price Indicator Step 1] hasKeyword: ${hasKeyword} for content starting with: ${content.substring(0, 30)}`);

  if (!hasKeyword) {
    return false;
  }

  // 2. 세 자리 이상의 숫자 확인 (쉼표 포함 가능) - (?!\d) 제거됨!
  // const numberRegex = /(?:[1-9]\d{2,}|[1-9]\d{0,2}(?:,\d{3})+)/g; // <--- 여기 수정됨
  const numberRegex = /\b\d{1,3}(?:,\d{3})+\b/g; // 더 관대하게 수정
  const numbersFound = content.match(numberRegex);
  // logger.debug(`[Price Indicator Step 2] numbersFound: ${JSON.stringify(numbersFound)} for content starting with: ${content.substring(0, 30)}`);

  if (!numbersFound) {
    return false;
  }

  // 3. 찾은 숫자 중 100 이상인 숫자가 있는지 확인
  let foundPriceLikeNumber = false;
  for (const numStr of numbersFound) {
    const num = parseInt(numStr.replace(/,/g, ""), 10);
    const isPriceLike = !isNaN(num) && num >= 100;
    // logger.debug(`[Price Indicator Step 3] Checking number '${numStr}' -> parsed: ${num}, isPriceLike: ${isPriceLike}`);
    if (isPriceLike) {
      foundPriceLikeNumber = true;
      break;
    }
  }
  const hasPriceLikeNumber = foundPriceLikeNumber;

  // logger.debug(`[Price Indicator Step 4] Final result: hasKeyword=${hasKeyword}, hasPriceLikeNumber=${hasPriceLikeNumber}`);
  return hasKeyword && hasPriceLikeNumber;
}

/**
 * 댓글 내용에서 주문 정보를 추출합니다.
 * - "번"이라는 단어가 있으면 "1번 3개요", "1번 상품 3개요" 같은 형식에서 앞의 숫자는 itemNumber, 뒤의 숫자는 quantity로 처리합니다.
 * - "번"이 없으면 보이는 숫자를 모두 수량(quantity) 정보로 처리합니다. (기본 itemNumber는 1)
 * @param {string} commentText - 댓글 내용
 * @param {object} logger - 로깅 객체 (console 대체 가능)
 * @returns {Array<{itemNumber: number|null, quantity: number, isAmbiguous: boolean}>} - 추출된 주문 목록
 */
function extractEnhancedOrderFromComment(commentText, logger = console) {
  const orders = [];
  if (!commentText) return orders;

  const originalText = commentText; // 로깅용 원본

  // 취소/마감 키워드 체크 (주문으로 처리하지 않음)
  if (
    commentText.toLowerCase().includes("마감") ||
    commentText.toLowerCase().includes("취소") ||
    commentText.toLowerCase().includes("cancel")
  ) {
    logger.info(`[주문 추출 제외] 마감/취소 키워드 포함: ${originalText}`);
    return orders;
  }

  // 전처리: 공백 정규화
  let processedText = commentText.replace(/\s+/g, " ").trim();

  // --- VVV 정규식 수정 VVV ---
  // "번"이 포함된 경우: "1번 3개요", "1번 샴푸 3개" 형태에서 itemNumber와 quantity 추출
  // (\d+) : 상품 번호 (숫자 1개 이상)
  // \s*번 : 공백(0개 이상) + "번"
  // (?:[^\d\n]*?) : 숫자나 줄바꿈 문자가 아닌 문자(설명 등) 0개 이상, 가장 짧게 매칭 (non-capturing group)
  // (\d+) : 수량 (숫자 1개 이상)
  const explicitOrderRegex = /(\d+)\s*번(?:[^\d\n]*?)(\d+)/g;
  let hasExplicitOrderMatch = false; // 명시적 주문 매칭 여부 플래그

  let match;
  while ((match = explicitOrderRegex.exec(processedText)) !== null) {
    const itemNumber = parseInt(match[1], 10);
    const quantity = parseInt(match[2], 10); // 그룹 2가 수량
    if (
      !isNaN(itemNumber) &&
      itemNumber > 0 &&
      !isNaN(quantity) &&
      quantity > 0
    ) {
      orders.push({
        itemNumber: itemNumber,
        quantity: quantity,
        isAmbiguous: false,
      });
      logger.debug(
        `[명시적 주문] itemNumber: ${itemNumber}, quantity: ${quantity} | 원문 부분: ${match[0]}`
      );
      hasExplicitOrderMatch = true; // 매칭 성공 플래그 설정
    }
  }
  // --- ^^^ 정규식 수정 완료 ^^^ ---

  // "번"이 포함되지 않았거나, "번"은 있었지만 위 정규식에 매칭되지 않은 경우
  // 그리고 아직 추출된 주문이 없는 경우에만 단순 숫자 추출 시도
  if (!processedText.includes("번") || !hasExplicitOrderMatch) {
    // "번"이 없는 경우 또는 "번"은 있었지만 매칭 실패 시: 댓글 내의 숫자를 수량으로 추출 (isAmbiguous: true)
    const numberRegex = /(\d+)/g;
    let numberMatch;
    while ((numberMatch = numberRegex.exec(processedText)) !== null) {
      // 이미 명시적 주문에서 처리된 숫자인지 확인 (간단하게는 어려움, 일단 모든 숫자 추출)
      const quantity = parseInt(numberMatch[1], 10);
      if (!isNaN(quantity) && quantity > 0) {
        // 이미 추출된 명시적 주문이 있다면 이 단순 숫자 주문은 추가하지 않음
        if (!hasExplicitOrderMatch) {
          orders.push({
            itemNumber: 1, // 기본 상품 번호 1
            quantity: quantity,
            isAmbiguous: true, // 상품 번호가 없으므로 모호함
          });
          logger.debug(
            `[단순 숫자 주문] quantity: ${quantity} | 원문: ${numberMatch[0]}`
          );
        }
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
  } else {
    logger.info(`[주문 정보 없음] 주문 패턴 미발견: ${originalText}`);
  }

  return orders;
}

// --- 테스트 케이스 추가 ---
const testComments = [
  "1번 2개요",
  "2번 1모 주세요",
  "3번 5봉지요",
  "1번 10 상자",
  "2번 1세트, 1번 3개", // 다중 주문 (기존 로직으로도 처리 가능해야 함)
  "1개요",
  "2봉지",
  "셋 박스요",
  "1",
  "2요",
  "1번 2",
  "1번 2, 5모, 2번 1세트, 4상자, 10개", // 수정된 로직으로 "1번 2", "2번 1" 매칭 기대
  "이건 그냥 댓글입니다",
  "5번만 주세요",
  "5번만 2개", // 수정된 로직으로 "5번", "2" 매칭 기대
  "10번 한세트요", // 수정된 로직으로 "10번", "1" (한->1 전처리 가정 시) 또는 그냥 "10번"만 인식하고 수량 매칭 실패할 수 있음 -> "한" 처리 로직 필요 시 별도 구현
  "2번 한봉지 요",
  "3번 두개", // "두"는 숫자가 아니므로 현재 로직으로는 여전히 실패
  "두개만 주세요", // 숫자 없으므로 실패
  "1번 100개!",
  "10 모",
  "취소할게요",
  "마감입니다",
  "1번1개 2번2개", // 수정된 로직으로 "1번", "1", "2번", "2" 매칭 기대
  "1번 두개, 2번 3개요", // "두개"는 여전히 문제, "2번 3개요"는 매칭 기대
  "2번 3개요",
  "3번 샴푸 2개요", // <<<--- 이 케이스가 이제 처리되어야 함
  "4번 상품은 10개 부탁드립니다", // <<<--- 처리 기대
  "1번 200ml짜리 3개", // <<<--- 처리 기대
];

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
  generateBarcodeFromProductId,
  updateTaskStatusInDB,
  calculateOptimalPrice,
};
