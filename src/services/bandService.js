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

// --- getAllBandPosts 함수 ---
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
          bandKey: post.band_key || bandKey, // 응답에 band_key가 있다면 사용, 없으면 요청 파라미터 사용
          author: {
            // 작성자 정보 (필요한 필드만 선택)
            name: post.author.name,
            user_key: post.author.user_key,
            profile_image_url: post.author.profile_image_url,
          },
          content: post.content, // 게시물 내용
          createdAt: new Date(post.created_at), // Date 객체로 변환 <= createdAt으로 이름 변경
          commentCount: post.comment_count, // <= commentCount로 이름 변경
          latestComments: post.latest_comments || [], // 최신 댓글 정보 추가
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

// --- getBandComments 함수 ---
async function getBandComments(userId, postKey, bandKey) {
  if (!userId || !postKey || !bandKey) {
    logger.error(
      "getBandComments 호출 오류: userId, postKey, 또는 bandKey가 제공되지 않았습니다."
    );
    throw new Error(
      "User ID, Post Key, and Band Key are required to fetch comments."
    );
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

  // 2. 특정 게시물의 댓글 가져오기
  let allComments = [];
  let nextParams = {};
  let hasMore = true;
  let latestCommentTimestamp = 0; // 해당 포스트의 가장 최신 댓글 타임스탬프

  logger.info(
    `Fetching comments for post ${postKey} in band ${bandKey} for user ${userId}`
  );

  while (hasMore) {
    try {
      const response = await axios.get(COMMENTS_API_URL, {
        params: {
          access_token: bandAccessToken,
          band_key: bandKey,
          post_key: postKey,
          limit: 50, // API 페이지당 최대치 확인 필요 (문서상 50)
          // since 파라미터 제거
          ...nextParams,
        },
        timeout: 15000, // 타임아웃 설정
      });

      if (response.data.result_code === 1 && response.data.result_data) {
        const data = response.data.result_data;
        const items = data.items || [];
        logger.debug(
          `Fetched ${items.length} comments in this page for post ${postKey}`
        );

        if (items.length > 0) {
          // 가져온 댓글 처리 (여기서는 예시로 필요한 정보만 추출)
          const processedComments = items.map((comment) => {
            const createdAt = parseInt(comment.created_at, 10);
            // 최신 댓글 타임스탬프 업데이트
            if (createdAt > latestCommentTimestamp) {
              latestCommentTimestamp = createdAt;
            }
            return {
              comment_key: comment.comment_key,
              post_key: postKey,
              band_key: bandKey,
              author: {
                name: comment.author.name,
                user_key: comment.author.user_key,
                profile_image_url: comment.author.profile_image_url,
              },
              content: comment.content,
              created_at: createdAt, // Unix timestamp (ms)
              // rawData: comment, // 필요시 원본 데이터 포함
            };
          });
          allComments = allComments.concat(processedComments);
        } else {
          logger.debug(`No comments found in this page for post ${postKey}`);
        }

        if (data.paging && data.paging.next_params) {
          nextParams = data.paging.next_params;
          logger.debug(
            `Next comment page parameters found for post ${postKey}:`,
            nextParams
          );
          hasMore = true;
        } else {
          logger.info(`No more comment pages for post ${postKey}`);
          hasMore = false;
        }
      } else {
        logger.error(
          `Band API Error fetching comments for post ${postKey}:`,
          response.data.result_data || "Unknown error"
        );
        throw new Error(
          `Band API Error fetching comments (code ${response.data.result_code}) for post ${postKey}`
        );
      }
    } catch (error) {
      logger.error(
        `Error fetching Band comments for post ${postKey}:`,
        error.response ? error.response.data : error.message
      );
      // 특정 포스트 댓글 조회 실패 시, 다른 포스트 처리를 위해 에러 전파 대신 빈 배열 반환 고려 가능
      // throw new Error(`Failed to fetch comments for post ${postKey}`);
      logger.warn(
        `댓글 조회 실패: postKey=${postKey}, bandKey=${bandKey}. 빈 댓글 목록 반환.`
      );
      hasMore = false; // 에러 발생 시 해당 포스트 댓글 조회 중단
      // 또는 return { comments: [], latestTimestamp: 0 }; 와 같이 에러 처리 후 반환
    }

    // API Rate Limit 고려 (옵션)
    // if (hasMore) {
    //   await new Promise(resolve => setTimeout(resolve, 200));
    // }
  }

  logger.info(
    `Total ${allComments.length} comments fetched for post ${postKey}`
  );

  // 모든 댓글 목록과 해당 포스트의 가장 최신 댓글 타임스탬프 반환
  return { comments: allComments, latestTimestamp: latestCommentTimestamp };
}

// --- _fetchProductMapForPost 함수 (변경 없음) ---
async function _fetchProductMapForPost(userId, postKey) {
  // ... 이전 코드와 동일 ...
  const productMap = new Map(); // 결과를 저장할 Map 객체 초기화
  try {
    logger.debug(`상품 정보 조회 시작: 사용자 ${userId}, 게시물 ${postKey}`);

    // products 테이블에서 필요한 컬럼 조회
    // **중요:** 실제 테이블 컬럼명 확인 필요 ('user_id', 'post_number', 'item_number', 'product_id', 'title', 'price', 'price_options')
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
 * @param {object} allCommentsByPost - getBandComments에서 반환된 댓글 데이터 객체 { postKey: [comments] }
 * @returns {Promise<{ orders: Array<Object>, customers: Array<Object>, summary: object }>} - 가공된 주문, 고객 데이터 및 처리 요약 정보
 */
async function processAndGenerateOrdersFromComments(userId, allCommentsByPost) {
  // ... 이전 코드와 동일 ...
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
      const ctime = new Date(comment.created_at); // Date 객체로 변환
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
      const uniqueCommentOrderId = `order_${commentKey}`;
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
        const extractedOrder = extractEnhancedOrderFromComment(text, logger);

        // --- 7-1. 명시적 주문 추출 성공 ---
        if (extractedOrder && extractedOrder.length > 0) {
          logger.debug(
            `게시물 ${postKey}, 댓글 ${commentKey}: ${extractedOrder.length}개 주문 항목 추출 성공.`
          );

          let firstValidItemProcessed = false;

          for (const orderItem of extractedOrder) {
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

          // --- 7-2. 패턴 추출 실패 시 주문 생성하지 않음 ---
        } else {
          logger.debug(
            `게시물 ${postKey}, 댓글 ${commentKey}: 패턴 추출 실패 - 주문 생성하지 않음.`
          );
        }
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

// src/services/bandService.js

// ... (다른 함수들 및 require 문은 그대로) ...

/**
 * 주어진 신규 댓글 목록과 상품 정보를 바탕으로 주문 및 고객 데이터를 생성합니다.
 * (DB 저장은 하지 않고 데이터만 생성하여 반환)
 * *** 수정: 댓글당 첫 번째 유효 주문 항목만 처리 ***
 *
 * @param {string} userId - 사용자 ID
 * @param {Array<object>} newComments - 처리할 새로운 댓글 객체 배열
 * @param {Map<string, object>} productMap - 해당 게시물의 상품 정보 Map
 * @returns {Promise<{orders: Array<object>, customers: Map<string, object>, summary: object}>} - 생성된 주문 배열, 고객 정보 Map, 처리 요약
 */
async function generateOrderDataFromComments(
  userId,
  newComments,
  productMap,
  postKey,
  isMultipleProductsPost = false
) {
  const ordersToSave = [];
  const customersToSaveMap = new Map();
  const processingSummary = {
    totalCommentsProcessed: newComments.length,
    generatedOrders: 0,
    generatedCustomers: 0,
    skippedExcluded: 0,
    skippedClosing: 0,
    skippedNoOrder: 0,
    skippedMissingInfo: 0,
    errors: [],
  };

  // <<< *** 수정 시작: 함수 실행 시 DB에서 제외 고객 목록 조회 *** >>>
  let excludedCustomers = []; // 함수 내 지역 변수로 선언
  try {
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("excluded_customers")
      .eq("user_id", userId)
      .single();
    // userError 처리 (PGRST116은 결과 없음 오류이므로 무시 가능)
    if (userError && userError.code !== "PGRST116") {
      logger.error(
        `[generateOrderDataFromComments] Failed to fetch excluded customers for user ${userId}: ${userError.message}`
      );
    } else if (
      userData?.excluded_customers &&
      Array.isArray(userData.excluded_customers)
    ) {
      excludedCustomers = userData.excluded_customers
        .filter((name) => typeof name === "string") // 문자열만 필터링
        .map((name) => name.trim()); // 앞뒤 공백 제거
    }
    logger.debug(
      "[generateOrderDataFromComments] Fetched excludedCustomers list:",
      excludedCustomers
    );
  } catch (e) {
    logger.error(
      `[generateOrderDataFromComments] Error fetching excluded customers: ${e.message}`
    );
    excludedCustomers = []; // 오류 발생 시 빈 배열 사용
  }
  // <<< *** 수정 끝 *** >>>

  // <<< 디버깅 로그 추가 >>>
  logger.debug(
    "[generateOrderDataFromComments] Initial excludedCustomers list:",
    excludedCustomers
  );
  // <<< 디버깅 로그 추가 끝 >>>

  const firstCommentKeyInfo =
    newComments.length > 0
      ? `band ${newComments[0].band_key} / post ${newComments[0].post_key}`
      : "N/A";
  logger.info(
    `[generateOrderDataFromComments] Starting processing for ${newComments.length} new comments on ${firstCommentKeyInfo}`
  );

  if (!(productMap instanceof Map)) {
    logger.warn(
      `[generateOrderDataFromComments] productMap is not a valid Map for ${firstCommentKeyInfo}. Product matching might be affected.`
    );
    productMap = new Map();
  }

  for (const [index, comment] of newComments.entries()) {
    let bandKey = null;
    let postKey = null;
    try {
      // 1. 기본 정보 추출 및 필터링
      bandKey = comment.band_key;
      postKey = comment.post_key;
      const authorName = comment.author?.name?.trim();
      const authorId = comment.author?.user_key;
      const commentContent = comment.content;
      const createdAt = safeParseDate(comment.created_at);
      const commentKey = comment.comment_key;

      if (
        !authorName ||
        !authorId ||
        !commentContent ||
        !createdAt ||
        !commentKey ||
        !postKey ||
        !bandKey
      ) {
        logger.warn(
          `  - Skipping comment due to missing basic info: commentKey=${commentKey}, postKey=${postKey}, bandKey=${bandKey}`
        );
        processingSummary.skippedMissingInfo++;
        continue;
      }
      if (excludedCustomers.includes(authorName)) {
        logger.debug(`  - Skipping excluded customer: ${authorName}`);
        processingSummary.skippedExcluded++;
        continue;
      }
      if (hasClosingKeywords(commentContent)) {
        logger.info(`  - Skipping closing keyword comment: ${authorName}`);
        processingSummary.skippedClosing++;
        continue;
      }

      // 2. 주문 정보 추출
      const extractedOrderItems = extractEnhancedOrderFromComment(
        commentContent,
        logger
      ); // 이 함수는 이제 배열을 반환한다고 가정

      // <<< *** 수정: 대표 주문 항목 결정 (기본값 생성 포함) - 이 블록만 남김 *** >>>
      let representativeItem = null;

      if (extractedOrderItems && extractedOrderItems.length > 0) {
        // 주문 항목 추출 성공 시 첫 번째 항목 사용
        representativeItem = extractedOrderItems[0];
        logger.debug(
          `  - Processing representative item (extracted) for comment ${commentKey}:`,
          representativeItem
        );
      } else {
        // 주문 항목 추출 실패 시 기본값 생성
        logger.info(
          `  - No specific order item extracted for comment ${commentKey}. Creating default ambiguous order.`
        );
        representativeItem = {
          itemNumber: 1,
          quantity: 1,
          isAmbiguous: true,
          option: null,
          price_option_description: "확인필요 (내용 분석 불가)",
        };
        processingSummary.skippedNoOrder++; // 카운트 유지 또는 조정
      }
      // <<< *** 수정 끝: 중복 코드 블록 제거됨 *** >>>

      // 3. 고객 정보 생성/업데이트 준비 (동일)
      const customerId = authorId;
      const customerData = {
        customer_id: customerId,
        user_id: userId,
        // name: authorName, // 'name' 대신 'customer_name' 사용 일관성
        customer_name: authorName,
        // phone_number, address 등은 extractEnhancedOrderFromComment에서 추출해야 함 (현재 로직에는 없음)
        last_order_at: createdAt.toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // 고객 정보 Map 업데이트 (동일)
      if (!customersToSaveMap.has(customerId)) {
        customersToSaveMap.set(customerId, customerData);
        processingSummary.generatedCustomers++; // 신규 고객일 때만 카운트
      } else {
        // 기존 고객 정보 업데이트 (last_order_date 등)
        const existingCustomer = customersToSaveMap.get(customerId);
        if (new Date(existingCustomer.last_order_at) < createdAt) {
          existingCustomer.last_order_at = createdAt.toISOString();
        }
        existingCustomer.updated_at = new Date().toISOString();
        // 필요시 다른 필드 업데이트 (예: 이름 변경 감지 등)
      }

      // 4. 주문 정보 생성 (representativeItem 사용)
      const uniqueCommentOrderId = `order_${bandKey}_${postKey}_${commentKey}`;
      const bandCommentId = commentKey;
      let subStatusList = [];
      // <<< *** 수정: representativeItem 사용 확인 *** >>>
      let isAmbiguous = representativeItem.isAmbiguous || false;
      let productId = null;
      let itemNumber = representativeItem.itemNumber || 1;
      let quantity = parseInt(representativeItem.quantity, 10) || 1;
      let basePriceForOrder = 0;
      let calculatedTotalAmount = 0;
      let priceOptionDescription =
        representativeItem.price_option_description || null;

      let matchedExactly = false; // 변수 선언 및 false로 초기화
      // <<< *** 수정 끝 *** >>>

      logger.debug(
        `  [Order Gen Start] CommentKey: ${commentKey}, Extracted Item:`,
        representativeItem
      ); // 추출된 항목 로그

      // 4.1. Product ID 및 ProductInfo 매칭 (폴백 로직 포함 - 이전과 동일)
      let productInfo = null; // 찾은 상품 정보 저장 변수
      if (itemNumber !== null && productMap.has(itemNumber)) {
        productInfo = productMap.get(itemNumber);
        if (productInfo && productInfo.product_id) {
          productId = productInfo.product_id;
          matchedExactly = !isAmbiguous; // representativeItem이 모호하지 않았다면 정확한 매칭
          logger.debug(
            `  [PID Match] Exact match success: productId = ${productId} for itemNumber ${itemNumber}`
          );
        } else {
          logger.warn(
            `  [PID Match] Product info found for itemNumber ${itemNumber}, but product_id is missing.`
          );
          productInfo = null; // 확실하지 않으므로 null 처리
        }
      }
      // productId 매칭 실패 또는 모호한 경우, itemNumber 1로 폴백 시도
      if (!productId && productMap.has(1)) {
        const defaultProductInfo = productMap.get(1);
        if (defaultProductInfo && defaultProductInfo.product_id) {
          productId = defaultProductInfo.product_id;
          productInfo = defaultProductInfo; // 폴백된 상품 정보 사용
          itemNumber = 1; // 아이템 번호 1로 확정
          logger.info(
            `  [PID Fallback] Success: Using default productId = ${productId} (itemNumber set to 1).`
          );
          if (!subStatusList.includes("상품 추정"))
            subStatusList.push("상품 추정");
        } else {
          logger.warn(
            `  [PID Fallback] Default product (itemNumber 1) found, but product_id is missing or invalid.`
          );
          productInfo = null; // 폴백 실패
        }
      }

      // 최종 productId 확인 및 productInfo 재확인
      if (!productId || !productInfo) {
        logger.error(
          `  [PID Match Failed] Could not determine productId or productInfo for comment ${commentKey}. Order will have null productId and 0 price/amount.`
        );
        if (!subStatusList.includes("상품 매칭 불가"))
          subStatusList.push("상품 매칭 불가");
        isAmbiguous = true;
        productInfo = null; // 확실히 null 처리
      }
      logger.debug(
        `  [PID Final] Final productId: ${productId}, Final itemNumber: ${itemNumber}`
      );

      // <<< *** 수정 시작: 기존 가격/총액 계산 방식 적용 *** >>>
      // 4.2. 가격 및 총액 계산
      if (productInfo) {
        // 유효한 productInfo가 있을 때만 계산 시도
        const productOptions = productInfo.price_options || [];
        const fallbackPrice =
          typeof productInfo.base_price === "number"
            ? productInfo.base_price
            : 0;
        basePriceForOrder = fallbackPrice; // orderData.price 에 저장할 값

        logger.debug(
          `  [price Calc] Using basePrice: ${basePriceForOrder}, quantity: ${quantity}, options:`,
          productOptions
        );

        try {
          // calculateOptimalPrice 함수를 사용하여 총액 계산
          calculatedTotalAmount = calculateOptimalPrice(
            quantity,
            productOptions,
            fallbackPrice
          );
          logger.debug(
            `  [price Calc] Calculated Optimal Total Amount: ${calculatedTotalAmount}`
          );

          // 가격 옵션 설명 결정 (옵션)
          if (!priceOptionDescription) {
            const matchingOption = productOptions.find(
              (opt) => opt.quantity === quantity
            );
            if (matchingOption) {
              priceOptionDescription =
                matchingOption.description || `${quantity} 단위 옵션`;
            } else {
              priceOptionDescription = productInfo.title
                ? `기본 (${productInfo.title})`
                : "기본 가격";
            }
          }
        } catch (calcError) {
          logger.error(
            `  [price Calc] Error during calculateOptimalPrice: ${calcError.message}`
          );
          calculatedTotalAmount = 0; // 계산 오류 시 0으로
          if (!subStatusList.includes("금액 계산 오류"))
            subStatusList.push("금액 계산 오류");
          isAmbiguous = true;
        }
      } else {
        // productInfo가 없을 때 (productId 매칭 실패)
        logger.warn(
          `  [price Calc] Skipping calculation because productInfo is null.`
        );
        basePriceForOrder = 0;
        calculatedTotalAmount = 0;
        if (!subStatusList.includes("가격 확인 불가"))
          subStatusList.push("가격 확인 불가");
      }
      // <<< *** 수정 끝 *** >>>

      logger.debug(
        `  [price/Amount Final] Final basePriceForOrder: ${basePriceForOrder}, Final calculatedTotalAmount: ${calculatedTotalAmount}`
      );

      // <<< *** 수정 시작: 최종 subStatus 결정 로직 수정 *** >>>
      // subStatusList에 이미 기록된 문제점들로 기본 subStatus 구성
      let subStatus =
        subStatusList.length > 0 ? subStatusList.join(", ") : null;

      // 조건 1: 여러 상품 게시물인데, 정확한 상품 번호 매칭이 안 된 경우 (폴백 포함)
      if (isMultipleProductsPost && productId && !matchedExactly) {
        const msg = "확인필요(상품 지정 모호)";
        subStatus = "확인필요";
        logger.debug(
          `  [SubStatus Update] Added '${msg}' because multiple products and ambiguous/fallback match.`
        );
      }
      // 조건 2: 숫자가 없는 댓글 처리 (이전 로직 유지 - 단, 위 조건과 중복될 수 있으므로 순서 고려)
      else if (
        isAmbiguous &&
        !subStatusList.includes("상품 추정") && // 상품 추정은 이미 모호함을 내포
        !subStatusList.includes("상품 매칭 불가") &&
        !subStatusList.includes("가격 확인 불가") &&
        !subStatusList.includes("금액 계산 불가") &&
        !/\d/.test(commentContent)
      ) {
        const msg = "확인필요(내용 분석 불가)";
        subStatus = "확인필요";
        logger.debug(
          `  [SubStatus Update] Added '${msg}' because comment is ambiguous AND contains no digits.`
        );
      }
      // <<< *** 수정 끝 *** >>>

      const orderData = {
        order_id: uniqueCommentOrderId, // 댓글당 고유 ID
        user_id: userId,
        post_key: postKey,
        band_key: bandKey,
        customer_id: customerId,
        comment: commentContent, // 원본 댓글 내용 저장
        ordered_at: createdAt.toISOString(),
        band_comment_id: bandCommentId,
        band_comment_url: null,
        customer_name: authorName,
        product_id: productId, // 매칭된 Product ID
        item_number: itemNumber, // 추출/결정된 Item Number
        quantity: quantity,
        price: basePriceForOrder, // price 저장 (변수 이름 수정)
        total_amount: calculatedTotalAmount, // 계산된 총액 저장
        price_option_description: priceOptionDescription, // 가격 옵션 설명
        status: "주문완료",
        sub_status: subStatus, // 처리 상태
        comment_key: commentKey,
        // order_date: createdAt.toISOString(), // ordered_at과 중복될 수 있으므로 제거 또는 용도 명확화
        updated_at: new Date().toISOString(),
      };

      ordersToSave.push(orderData);
      processingSummary.generatedOrders++;
      logger.debug(`  - Generated single order data for comment ${commentKey}`);
      // <<< *** 수정 끝 *** >>>
    } catch (error) {
      logger.error(
        `[generateOrderDataFromComments] Error processing comment ${comment?.comment_key} on post ${postKey}: ${error.message}`,
        error.stack
      );
      processingSummary.errors.push({
        commentKey: comment?.comment_key,
        postKey: postKey,
        error: error.message,
      });
    }
  } // End of comment loop

  logger.info(
    `[generateOrderDataFromComments] Finished. Summary: ${JSON.stringify(
      processingSummary
    )}`
  );

  return {
    orders: ordersToSave,
    customers: customersToSaveMap, // Map 반환
    summary: processingSummary,
  };
}

module.exports = {
  getAllBandPosts,
  getBandComments,
  _fetchProductMapForPost, // export 추가
  generateOrderDataFromComments, // 신규 함수 export 추가
  processAndGenerateOrdersFromComments, // 기존 함수 유지 (다른 곳에서 사용될 수 있음)
};
