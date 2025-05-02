// src/services/bandService.js

const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const {
  safeParseDate,
  hasClosingKeywords,
  extractEnhancedOrderFromComment,
  calculateOptimalPrice,
} = require("./crawler/band.utils"); // 필요한 유틸리티 함수 import
const logger = require("../../src/config/logger");

// API URL 및 Supabase 클라이언트 초기화 등은 이전과 동일
const BAND_POSTS_API_URL = "https://openapi.band.us/v2/band/posts";
const COMMENTS_API_URL = "https://openapi.band.us/v2.1/band/post/comments";
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 제외할 고객 이름 목록 (환경설정 등에서 관리 권장)
const excludedCustomers = ["밴드지기", "가빈과일마켓 김실장"];

// --- getAllBandPosts 함수 (변경 없음) ---
async function getAllBandPosts(userId, requestedLimit = 500) {
  // ... 이전 코드와 동일 ...
  if (!userId) {
    logger.error("getAllBandPosts 호출 오류: userId가 제공되지 않았습니다.");
    throw new Error("User ID is required to fetch Band posts.");
  }

  // 1. Supabase에서 사용자 정보 (토큰, 키) 조회
  let bandAccessToken;
  let bandKey; // 특정 밴드 지정이 필요 없을 수 있음 (API 스펙 확인)
  try {
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("band_access_token, band_key") // band_key가 필요 없을 수도 있음
      .eq("user_id", userId)
      .single();

    if (userError) throw userError;
    if (!userData) throw new Error(`User not found for ID: ${userId}`);
    if (!userData.band_access_token) {
      // band_key는 API 스펙에 따라 필수 여부 확인
      throw new Error(`Band access token not found for user: ${userId}`);
    }

    bandAccessToken = userData.band_access_token;
    bandKey = userData.band_key; // API 호출 시 band_key가 필요한 경우 사용
    logger.info(`사용자 ${userId}의 Band 정보 조회 성공`);
  } catch (error) {
    logger.error(
      `Supabase에서 사용자 ${userId}의 Band 정보 조회 실패: ${error.message}`
    );
    throw new Error(
      `Failed to retrieve Band credentials for user ${userId}: ${error.message}`
    );
  }

  const BACKEND_MAX_LIMIT = 500;
  const limit = Math.min(requestedLimit, BACKEND_MAX_LIMIT);
  let allPosts = [];
  let nextParams = {};
  let hasMore = true;

  logger.info(`Fetching posts from Band API with limit: ${limit}`);

  while (hasMore && allPosts.length < limit) {
    try {
      const response = await axios.get(BAND_POSTS_API_URL, {
        params: {
          access_token: bandAccessToken,
          band_key: bandKey, // API가 특정 밴드 키를 요구하는 경우
          limit: 20, // API 페이지당 최대치 확인 필요
          ...nextParams,
        },
        timeout: 15000, // 타임아웃 설정
      });

      if (response.data.result_code === 1 && response.data.result_data) {
        const data = response.data.result_data;
        const items = data.items || [];

        logger.debug(`Fetched ${items.length} posts in this page.`);

        // API 응답 데이터 구조에 맞춰 필요한 정보 추출
        const processedPosts = items.map((post) => ({
          postKey: post.post_key, // 고유 식별자 <= postKey로 이름 변경
          bandKey: bandKey, // 소속 밴드 식별자
          author: {
            // 작성자 정보 (필요한 필드만 선택)
            name: post.author.name,
            user_key: post.author.user_key,
            profile_image_url: post.author.profile_image_url,
          },
          content: post.content, // 게시물 내용
          createdAt: new Date(post.created_at), // Date 객체로 변환 <= createdAt으로 이름 변경
          commentCount: post.comment_count, // <= commentCount로 이름 변경
          photo_count: post.photo_count || 0,
          photos: post.photos?.map((p) => p.url) || [], // 사진 URL 목록
          emotion_count: post.emotion_count,
          // 추가적으로 필요한 필드가 있다면 API 문서 확인 후 추가
        }));

        allPosts = allPosts.concat(processedPosts);

        if (allPosts.length >= limit) {
          logger.info(`Reached requested limit (${limit}). Stopping fetch.`);
          hasMore = false;
          allPosts = allPosts.slice(0, limit);
        } else if (data.paging && data.paging.next_params) {
          nextParams = data.paging.next_params;
          logger.debug("Next page parameters found:", nextParams);
          hasMore = true;
        } else {
          logger.info("No more pages.");
          hasMore = false;
        }
      } else {
        logger.error(
          "Band API Error:",
          response.data.result_data || "Unknown error"
        );
        throw new Error(`Band API Error: ${response.data.result_code}`);
      }
    } catch (error) {
      logger.error(
        "Error fetching Band posts:",
        error.response ? error.response.data : error.message
      );
      throw new Error("Failed to fetch posts from Band API");
    }

    if (hasMore && allPosts.length < limit) {
      await new Promise((resolve) => setTimeout(resolve, 500)); // API Rate Limit 고려
    }
  }

  logger.info(`Total ${allPosts.length} posts fetched and processed.`);
  return allPosts;
}

// --- getBandComments 함수 (변경 없음) ---
async function getBandComments(userId, bandNumber) {
  // ... 이전 코드와 동일 ...
  if (!userId) {
    logger.error("getBandComments 호출 오류: userId가 제공되지 않았습니다.");
    throw new Error("User ID is required.");
  }

  // 1. Supabase에서 사용자 정보 (토큰) 조회
  let bandAccessToken;
  try {
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("band_access_token") // 토큰만 필요
      .eq("user_id", userId)
      .single();

    if (userError) throw userError;
    if (!userData || !userData.band_access_token) {
      throw new Error(
        `Band access token not found for user: ${userId}. Cannot fetch comments.`
      );
    }
    bandAccessToken = userData.band_access_token;
    logger.info(`사용자 ${userId}의 Band Access Token 조회 성공`);
  } catch (error) {
    logger.error(
      `Supabase에서 사용자 ${userId}의 Band Access Token 조회 실패: ${error.message}`
    );
    throw error; // 에러 재발생 시켜 호출 측에서 처리하도록 함
  }

  // 2. Supabase에서 해당 사용자의 모든 게시물 키(post_key)와 밴드 키(band_key) 조회
  //    (어떤 밴드의 게시물인지 알아야 API 호출 시 band_key를 넣을 수 있음)
  let postsToFetchCommentsFor = []; // { postKey: '...', bandKey: '...' } 형태의 객체 배열
  try {
    // posts 테이블에서 user_id가 일치하고 post_key, band_key가 있는 레코드 조회
    // **중요:** 실제 테이블과 컬럼명 확인 필요 ('post_key', 'band_key')
    const { data: postsData, error: postsError } = await supabase
      .from("posts") // 실제 게시물 테이블 이름 확인
      .select("post_key, band_key") // post_key 와 band_key 둘 다 필요
      .eq("user_id", userId)
      .not("post_key", "is", null)
      .not("band_key", "is", null); // band_key도 null이 아니어야 함

    if (postsError) throw postsError;

    postsToFetchCommentsFor = postsData
      .map((post) => ({ postKey: post.post_key, bandKey: post.band_key }))
      .filter((item) => item.postKey && item.bandKey); // 둘 다 유효한 값만 필터링

    if (postsToFetchCommentsFor.length === 0) {
      logger.info(
        `사용자 ${userId}에 대해 댓글을 조회할 게시물 (post_key, band_key 포함)이 DB에 없습니다.`
      );
      return {}; // 빈 객체 반환
    }
    logger.info(
      `사용자 ${userId}의 댓글 조회 대상 게시물 ${postsToFetchCommentsFor.length}개 확인 완료.`
    );
  } catch (error) {
    logger.error(
      `Supabase에서 사용자 ${userId}의 게시물 키/밴드 키 조회 실패: ${error.message}`
    );
    throw new Error(
      `Failed to retrieve post/band keys for user ${userId}: ${error.message}`
    );
  }

  // 3. 각 post_key/band_key 조합에 대해 댓글 API 호출
  const allCommentsByPost = {}; // 결과를 저장할 객체 { postKey: [comments] }

  // API 호출 부하를 줄이기 위해 순차 처리 또는 Promise.allSettled 등 사용 고려 (여기서는 순차 처리)
  for (const { postKey, bandKey } of postsToFetchCommentsFor) {
    let postComments = [];
    let nextParams = {};
    let hasMore = true;
    let attempt = 0;
    const maxAttempts = 3; // 재시도 횟수

    logger.debug(`게시물 ${postKey} (밴드 ${bandKey})의 댓글 가져오기 시작...`);

    while (hasMore && attempt < maxAttempts) {
      try {
        const response = await axios.get(COMMENTS_API_URL, {
          params: {
            access_token: bandAccessToken,
            band_key: bandKey, // 해당 게시물의 밴드 키 사용
            post_key: postKey, // 해당 게시물의 포스트 키 사용
            limit: 50, // API 페이지당 최대치 확인 (예: 50)
            ...nextParams,
          },
          timeout: 10000, // 10초 타임아웃 설정
        });

        if (response.data.result_code === 1) {
          const items = response.data.result_data.items || []; // 댓글 목록 (없으면 빈 배열)

          // API 응답 데이터 구조에 맞춰 필요한 필드만 추출 및 가공
          const extractedComments = items.map((item) => ({
            comment_key: item.comment_key, // Band 댓글 고유 ID (★★★★★ 중요)
            post_key: postKey, // 현재 처리 중인 postKey 추가 (컨텍스트용)
            band_key: bandKey, // 현재 사용 중인 bandKey 추가 (컨텍스트 및 ID 생성용)
            author: {
              // 작성자 정보
              name: item.author.name,
              user_key: item.author.user_key, // Band 사용자 고유 ID (★★★★★ 중요)
              profile_image_url: item.author.profile_image_url,
            },
            content: item.content, // 댓글 내용 (후처리 필요: <band:refer> 제거 등)
            created_at: item.created_at, // UNIX timestamp (milliseconds) -> 후처리에서 new Date() 사용
            // sticker: item.sticker, // 스티커 정보 (필요시)
            // photo: item.photo, // 사진 정보 (필요시)
          }));
          postComments = postComments.concat(extractedComments);

          // 페이징 처리
          if (
            response.data.result_data.paging &&
            response.data.result_data.paging.next_params
          ) {
            nextParams = response.data.result_data.paging.next_params;
            hasMore = true;
            logger.debug(
              `  - 게시물 ${postKey}: 다음 페이지 댓글 로딩... ${JSON.stringify(
                nextParams
              )}`
            );
            await new Promise((resolve) => setTimeout(resolve, 300)); // Rate limit 방지
          } else {
            hasMore = false; // 다음 페이지 없음
          }
          attempt = 0; // 성공 시 재시도 카운터 리셋
        } else {
          // API 응답 코드가 1이 아닌 경우 (에러)
          logger.error(
            `  - 게시물 ${postKey} 댓글 API 오류: 코드 ${
              response.data.result_code
            }, 메시지: ${response.data.result_data || "Unknown error"}`
          );
          // 특정 에러 코드(e.g., 1010: 게시물 없음)는 무시하고 다음으로 진행 가능
          hasMore = false; // 에러 발생 시 해당 게시물 댓글 가져오기 중단
          // allCommentsByPost[postKey] = { error: `API Error ${response.data.result_code}` }; // 에러 정보 기록도 가능
          break; // 현재 postKey 루프 탈출
        }
      } catch (error) {
        // 네트워크 오류 등 axios 요청 자체의 실패
        attempt++;
        logger.error(
          `  - 게시물 ${postKey} 댓글 요청 오류 (시도 ${attempt}/${maxAttempts}): ${
            error.response ? JSON.stringify(error.response.data) : error.message
          }`
        );
        if (attempt >= maxAttempts) {
          logger.error(`  - 게시물 ${postKey} 댓글 가져오기 최종 실패.`);
          // allCommentsByPost[postKey] = { error: `Fetch failed after ${maxAttempts} attempts` }; // 에러 정보 기록
          hasMore = false; // 실패 시 더 이상 시도 안 함
        } else {
          // 재시도 전 대기 시간 (점점 늘림)
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    } // end while (페이징 처리 루프)

    // 성공적으로 가져온 댓글 (0개 포함) 저장
    if (allCommentsByPost[postKey] === undefined) {
      // 에러가 기록되지 않은 경우에만 저장
      allCommentsByPost[postKey] = postComments;
      if (postComments.length > 0) {
        logger.info(
          `게시물 ${postKey}: 총 ${postComments.length}개 댓글 가져오기 완료.`
        );
      } else {
        logger.info(`게시물 ${postKey}: 가져온 댓글이 없습니다.`);
      }
    }

    // 다음 게시물 처리 전 짧은 대기 (API 서버 부하 감소)
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } // end for (각 게시물 처리 루프)

  logger.info(
    `모든 대상 게시물(${postsToFetchCommentsFor.length}개)에 대한 댓글 가져오기 시도 완료.`
  );
  return allCommentsByPost; // { postKey: [comments], ... } 객체 반환
}

/**
 * Supabase 'products' 테이블에서 특정 사용자의 특정 게시물에 해당하는 상품 정보를 조회합니다.
 * @param {string} userId - 서비스 사용자 ID
 * @param {string} postKey - 조회할 게시물의 Band post_key
 * @returns {Promise<Map<number, object>>} - Key: item_number, Value: productData 객체 (product_id, title, base_price, price_options 포함)
 */
async function _fetchProductMapForPost(userId, postKey) {
  // ... 이전 코드와 동일 ...
  const productMap = new Map(); // 결과를 저장할 Map 객체 초기화
  try {
    logger.debug(`상품 정보 조회 시작: 사용자 ${userId}, 게시물 ${postKey}`);

    // products 테이블에서 필요한 컬럼 조회
    // **중요:** 실제 테이블 컬럼명 확인 필요 ('user_id', 'post_number', 'item_number', 'product_id', 'title', 'base_price', 'price_options')
    const { data: products, error } = await supabase
      .from("products")
      .select("product_id, item_number, title, base_price, price_options")
      .eq("user_id", userId)
      .eq("post_number", postKey) // 'post_number' 컬럼에 postKey를 매칭
      .order("item_number", { ascending: true }); // 아이템 번호 순서대로 정렬 (필요시)

    if (error) {
      // Supabase 조회 오류 처리
      logger.error(
        `게시물 ${postKey} 상품 조회 중 Supabase 오류: ${error.message}`
      );
      throw error; // 에러를 다시 던져 호출 측에서 처리하도록 함
    }

    // 조회된 상품 데이터 처리
    if (products && products.length > 0) {
      products.forEach((p) => {
        // item_number가 유효한 숫자일 경우에만 Map에 추가
        if (p.item_number !== null && typeof p.item_number === "number") {
          productMap.set(p.item_number, p); // key: item_number, value: product 객체
        } else {
          logger.warn(
            `게시물 ${postKey}: 상품 ID ${p.product_id}의 item_number(${p.item_number})가 유효하지 않아 건너<0xEB><0x9A><0x8D>니다.`
          );
        }
      });
      logger.info(
        `게시물 ${postKey}: 유효한 상품 ${productMap.size}개 정보를 조회했습니다.`
      );
    } else {
      // 해당 게시물에 연결된 상품 정보가 없는 경우
      logger.info(
        `게시물 ${postKey}: DB에서 연결된 상품 정보를 찾을 수 없습니다.`
      );
    }
  } catch (error) {
    // 기타 예외 처리
    logger.error(
      `게시물 ${postKey} 상품 정보 조회/처리 중 예외 발생: ${error.message}`,
      error
    );
    // 에러를 다시 던져 상위 로직에서 인지하도록 함
    throw error;
  }
  return productMap; // 조회 결과를 담은 Map 반환 (상품 없으면 빈 Map)
}

/**
 * API로 가져온 댓글 데이터를 분석하여 주문 및 고객 정보를 생성합니다. (DB 저장 X)
 * @param {string} userId - 서비스 사용자 ID (데이터 매핑용)
 * @param {string} bandNumber - 컨텍스트용 밴드 번호 (로그 등) -> 이 파라미터 대신 comments 데이터 내 band_key 사용
 * @param {object} allCommentsByPost - getBandComments에서 반환된 댓글 데이터 객체 { postKey: [comments] }
 * @returns {Promise<{ orders: Array<Object>, customers: Array<Object>, summary: object }>} - 가공된 주문, 고객 데이터 및 처리 요약 정보
 */
async function processAndGenerateOrdersFromComments(userId, allCommentsByPost) {
  // bandNumber 파라미터 제거
  // ---> 함수 이름 변경: processAndSave... -> processAndGenerate...
  logger.info(`주문 데이터 생성 시작: 사용자 ID ${userId}`);

  // 1. 입력 데이터 확인 (allCommentsByPost)
  if (
    !allCommentsByPost ||
    typeof allCommentsByPost !== "object" ||
    Object.keys(allCommentsByPost).length === 0
  ) {
    logger.info(`사용자 ${userId}: 처리할 댓글 데이터가 없습니다.`);
    return {
      orders: [],
      customers: [],
      summary: {
        message: "처리할 댓글 데이터 없음.",
        processedPosts: 0,
        totalComments: 0,
        generatedOrders: 0,
        generatedCustomers: 0,
      },
    };
  }

  const postKeys = Object.keys(allCommentsByPost); // 처리할 게시물 키 목록
  logger.info(
    `사용자 ${userId}: ${postKeys.length}개 게시물의 댓글 처리 시작.`
  );

  // --- 데이터 처리를 위한 준비 ---
  const customersToGenerateMap = new Map(); // 고객 정보 임시 저장 (Map<customerId, customerData>)
  const ordersToGenerate = []; // 주문 정보 임시 저장 (Array<orderData>)
  let totalCommentsProcessed = 0; // 총 처리한 댓글 수 카운터
  let postsProcessedCount = 0; // 처리한 게시물 수 카운터

  // 2. 게시물 단위로 댓글 처리 루프 실행
  for (const postKey of postKeys) {
    const comments = allCommentsByPost[postKey]; // 해당 게시물의 댓글 배열

    if (!Array.isArray(comments) || comments.length === 0) {
      logger.debug(
        `게시물 ${postKey}: 처리할 댓글이 없거나 유효하지 않아 건너<0xEB><0x9A><0x8D>니다.`
      );
      continue;
    }

    totalCommentsProcessed += comments.length;
    postsProcessedCount++;
    logger.info(`게시물 ${postKey} 처리 시작 (${comments.length}개 댓글)...`);

    // --- 현재 게시물(postKey)에 대한 상품 정보 가져오기 ---
    let productMap;
    let currentBandKey = null;
    try {
      if (comments[0] && comments[0].band_key) {
        currentBandKey = comments[0].band_key; // 댓글에서 band_key 가져오기
        productMap = await _fetchProductMapForPost(userId, postKey);
      } else {
        logger.warn(
          `게시물 ${postKey}: 댓글에서 band_key를 찾을 수 없어 상품 정보를 조회할 수 없습니다. 건너<0xEB><0x9A><0x8D>니다.`
        );
        continue;
      }
    } catch (error) {
      logger.error(
        `게시물 ${postKey} 상품 정보 조회 중 오류 발생. 건너<0xEB><0x9A><0x8D>니다. 오류: ${error.message}`
      );
      continue;
    }

    const isProductPost = productMap && productMap.size > 0;
    let isClosedByNewComment = false;

    if (!isProductPost) {
      logger.info(
        `게시물 ${postKey}: 연결된 상품 정보 없음. 상품 게시물 아님.`
      );
    }

    // --- 댓글 단위 처리 루프 ---
    for (let i = 0; i < comments.length; i++) {
      const comment = comments[i];
      const originalCommentIndex = i;

      // --- 1. 댓글 기본 유효성 검사 ---
      if (
        !comment ||
        !comment.comment_key ||
        !comment.author ||
        !comment.author.user_key ||
        !comment.author.name ||
        !comment.band_key ||
        comment.content === undefined ||
        comment.content === null
      ) {
        logger.warn(
          `게시물 ${postKey}, 인덱스 ${i}: 필수 댓글 정보 누락. 건너<0xEB><0x9A><0x8D>니다.`
        );
        continue;
      }

      // --- 2. 데이터 추출 및 정제 ---
      const author = comment.author;
      const authorName = author.name.trim();
      const rawContent = comment.content;
      const cleanedContent = rawContent
        .replace(/<band:refer[^>]*>.*?<\/band:refer>/g, "")
        .trim();
      const text = cleanedContent;
      const ctime = safeParseDate(comment.created_at) || new Date();
      const bandKey = comment.band_key;
      const userKey = author.user_key;
      const commentKey = comment.comment_key;

      // --- 3. 제외 고객 필터링 ---
      if (excludedCustomers.includes(authorName)) {
        logger.debug(
          `게시물 ${postKey}, 댓글 ${commentKey}: 제외 고객(${authorName}) 건너<0xEB><0x9A><0x8D>니다.`
        );
        continue;
      }

      // --- 5. 주문(Order) 데이터 초기화 ---
      const uniqueCommentOrderId = `order_${bandKey}_${postKey}_${commentKey}`;
      let orderData = {
        order_id: uniqueCommentOrderId,
        user_id: userId,
        post_number: postKey,
        band_number: bandKey,
        customer_id: userKey,
        customer_name: authorName,

        comment: text,
        ordered_at: ctime.toISOString(),
        band_comment_id: commentKey,
        // --- 주문 상세 정보 ---
        product_id: null,
        item_number: null,
        quantity: null,
        price: 0,
        total_amount: 0,
        price_option_description: null,
        status: "주문완료", // 기본 상태
        sub_status: null,

        // 생성/수정 시간 제거
        // created_at: new Date().toISOString(),
        // updated_at: new Date().toISOString(),
      };

      // --- 6. 마감 키워드 확인 ---
      if (!isClosedByNewComment && hasClosingKeywords(text)) {
        logger.info(
          `게시물 ${postKey}, 댓글 ${commentKey}: 작성자(${authorName}) 마감 키워드 사용.`
        );
        isClosedByNewComment = true;
      }

      // --- 7. 주문 정보 추출 로직 실행 ---
      let processedAsOrder = false;
      let calculatedTotalAmount = 0;

      if (isProductPost && productMap.size > 0 && !isClosedByNewComment) {
        const extractedItems = extractEnhancedOrderFromComment(text, logger);

        // --- 7-1. 명시적 주문 추출 성공 ---
        if (extractedItems.length > 0) {
          logger.debug(
            `게시물 ${postKey}, 댓글 ${commentKey}: ${extractedItems.length}개 주문 항목 추출 성공.`
          );

          let firstValidItemProcessed = false;

          for (const orderItem of extractedItems) {
            let itemNumberToUse = orderItem.itemNumber;
            let targetProductId = null;
            let isAmbiguousNow = orderItem.isAmbiguous;
            let productInfo = null;

            // 상품 ID 및 모호성 해결 로직 (이전과 동일)
            if (isAmbiguousNow) {
              if (productMap.size === 1) {
                [itemNumberToUse, productInfo] = Array.from(
                  productMap.entries()
                )[0];
                if (productInfo) targetProductId = productInfo.product_id;
                isAmbiguousNow = false;
              } else if (productMap.has(1)) {
                productInfo = productMap.get(1);
                if (productInfo) targetProductId = productInfo.product_id;
                itemNumberToUse = 1;
              } else if (productMap.size > 0) {
                [itemNumberToUse, productInfo] = Array.from(
                  productMap.entries()
                )[0];
                if (productInfo) targetProductId = productInfo.product_id;
              }
            } else if (itemNumberToUse !== null) {
              if (productMap.has(itemNumberToUse)) {
                productInfo = productMap.get(itemNumberToUse);
                if (productInfo) targetProductId = productInfo.product_id;
              } else {
                isAmbiguousNow = true;
                if (productMap.size === 1) {
                  [itemNumberToUse, productInfo] = Array.from(
                    productMap.entries()
                  )[0];
                  if (productInfo) targetProductId = productInfo.product_id;
                } else if (productMap.has(1)) {
                  productInfo = productMap.get(1);
                  itemNumberToUse = 1;
                  if (productInfo) targetProductId = productInfo.product_id;
                } else if (productMap.size > 0) {
                  [itemNumberToUse, productInfo] = Array.from(
                    productMap.entries()
                  )[0];
                  if (productInfo) targetProductId = productInfo.product_id;
                }
              }
            }

            if (!targetProductId || !productInfo) {
              logger.warn(
                ` - 댓글 ${commentKey}: 유효 상품 매칭 불가 (요청: ${orderItem.itemNumber}). 건너<0xEB><0x9A><0x8D>니다.`
              );
              continue;
            }

            // 수량 결정 (이전과 동일)
            const quantity =
              typeof orderItem.quantity === "number" && orderItem.quantity > 0
                ? orderItem.quantity
                : 1;
            if (
              quantity === 1 &&
              !(
                typeof orderItem.quantity === "number" && orderItem.quantity > 0
              )
            ) {
              isAmbiguousNow = true;
            }

            // 가격 계산 (이전과 동일)
            const productOptions = productInfo.price_options || [];
            const fallbackPrice =
              typeof productInfo.base_price === "number"
                ? productInfo.base_price
                : 0;
            calculatedTotalAmount = calculateOptimalPrice(
              quantity,
              productOptions,
              fallbackPrice
            );

            // 주문 데이터 업데이트 (첫 번째 유효 항목)
            if (!firstValidItemProcessed) {
              orderData.product_id = targetProductId;
              orderData.item_number = itemNumberToUse;
              orderData.quantity = quantity;
              orderData.price = fallbackPrice;
              orderData.total_amount = calculatedTotalAmount;
              orderData.price_option_description = productInfo.title
                ? `${itemNumberToUse}번 (${productInfo.title})`
                : `${itemNumberToUse}번 상품`;

              orderData.sub_status = isAmbiguousNow ? "확인필요" : null;

              firstValidItemProcessed = true;
              processedAsOrder = true;
              logger.info(
                `  - 주문 생성됨 (추출): 상품 ${targetProductId} (항목 ${itemNumberToUse}), 수량 ${quantity}, 금액 ${calculatedTotalAmount}, 모호 ${isAmbiguousNow}`
              );
            }
            break; // 첫 번째 유효 항목 처리 후 종료
          }

          // --- 7-2. Fallback 1: 추출 실패 + 숫자 포함 ---
        } else if (/\d/.test(text)) {
          logger.warn(
            `게시물 ${postKey}, 댓글 ${commentKey}: 추출 실패, 숫자 포함 Fallback 1 적용.`
          );
          let targetProductId = null;
          let itemNumberToUse = 1;
          let productInfo = null;

          // Fallback 상품 결정 (이전과 동일)
          if (productMap.has(1)) {
            productInfo = productMap.get(1);
          } else if (productMap.size > 0) {
            [itemNumberToUse, productInfo] = Array.from(
              productMap.entries()
            )[0];
          }

          if (productInfo) {
            targetProductId = productInfo.product_id;
            const quantity = 1;
            const productOptions = productInfo.price_options || [];
            const fallbackPrice =
              typeof productInfo.base_price === "number"
                ? productInfo.base_price
                : 0;
            calculatedTotalAmount = calculateOptimalPrice(
              quantity,
              productOptions,
              fallbackPrice
            );

            // 주문 데이터 업데이트 (Fallback 1)
            orderData.product_id = targetProductId;
            orderData.item_number = itemNumberToUse;
            orderData.quantity = quantity;
            orderData.price = fallbackPrice;
            orderData.total_amount = calculatedTotalAmount;
            orderData.price_option_description = productInfo.title
              ? `${itemNumberToUse}번 (${productInfo.title}) - 추정`
              : `상품 정보 불명 - 추정`;
            orderData.sub_status = "확인필요";

            processedAsOrder = true;
            logger.info(
              `  - 주문 생성됨 (Fallback 1): 상품 ${targetProductId} (항목 ${itemNumberToUse}), 금액 ${calculatedTotalAmount}`
            );
          } else {
            logger.warn(` - Fallback 1 실패: 매칭할 상품 정보 없음.`);
          }
        } // end Fallback 1
      } // end if (isProductPost...)

      // --- 8. 최종 생성 결정 ---
      if (processedAsOrder) {
        ordersToGenerate.push(orderData); // 가공된 주문 데이터를 배열에 추가
        logger.debug(
          `  - 댓글 ${commentKey}: 주문 데이터 생성 목록에 추가됨 (ID: ${orderData.order_id})`
        );
      } else {
        // 주문으로 처리되지 않은 경우 로그 (이전과 동일)
        if (!isClosedByNewComment && isProductPost && /\d/.test(text)) {
          logger.debug(
            `  - 댓글 ${commentKey}: 숫자 포함하나 주문 처리 안됨. 내용: "${text}"`
          );
        } else if (!isProductPost && /\d/.test(text)) {
          logger.debug(
            `  - 댓글 ${commentKey}: 상품 게시물 아님 (숫자 포함). 내용: "${text}"`
          );
        } else if (isClosedByNewComment) {
          logger.debug(
            `  - 댓글 ${commentKey}: 마감 이후 댓글. 내용: "${text}"`
          );
        } else {
          logger.debug(
            `  - 댓글 ${commentKey}: 주문 처리 대상 아님. 내용: "${text}"`
          );
        }
      }
    } // end for (comments loop)
  } // end for (posts loop)

  // --- 3. DB 저장 로직 제거 ---
  // (Supabase Upsert 호출 부분 삭제)
  // let savedOrdersCount = 0;
  // let savedCustomersCount = 0;
  // if (customerUpsertData.length > 0) { ... }
  // if (ordersToUpsert.length > 0) { ... }

  // --- 4. 처리 결과 및 가공된 데이터 반환 ---
  const generatedCustomers = Array.from(customersToGenerateMap.values()); // Map을 배열로 변환
  const generatedOrders = ordersToGenerate;

  const summaryMessage = `처리 완료: 게시물 ${postsProcessedCount}개, 총 댓글 ${totalCommentsProcessed}개. 생성된 고객 정보 ${generatedCustomers.length}건, 생성된 주문 정보 ${generatedOrders.length}건.`;
  logger.info(summaryMessage);

  return {
    orders: generatedOrders, // 가공된 주문 데이터 배열
    customers: generatedCustomers, // 가공된 고객 데이터 배열
    summary: {
      // 요약 정보
      message: summaryMessage,
      processedPosts: postsProcessedCount,
      totalComments: totalCommentsProcessed,
      generatedOrders: generatedOrders.length, // 이름 변경: saved -> generated
      generatedCustomers: generatedCustomers.length, // 이름 변경: saved -> generated
    },
  };
}

module.exports = {
  getAllBandPosts,
  getBandComments,
  // processAndSaveOrdersFromComments, // 이전 함수 이름 대신 새 함수 이름 사용
  processAndGenerateOrdersFromComments, // <<<--- 이름 변경 및 DB 저장 로직 제거된 함수
};
