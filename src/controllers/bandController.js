// src/controllers/bandController.js - 밴드 관련 컨트롤러
const bandService = require("../services/bandService");

const { createClient } = require("@supabase/supabase-js");
const logger = require("../config/logger");
const { contentHasPriceIndicator } = require("../services/crawler/band.utils");

// Supabase 클라이언트 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * AI 분석 결과(게시물 및 상품 정보)를 Supabase에 저장하는 함수
 * @param {object} supabase - Supabase 클라이언트 인스턴스
 * @param {string} userId - 사용자 ID
 * @param {object} post - Band API에서 가져온 원본 게시물 객체
 * @param {object} aiAnalysisResult - AI 분석 결과 객체 (isProductPost, products 포함)
 * @param {string} bandNumberStr - 밴드 번호 문자열
 * @returns {Promise<number|null>} - 저장된 게시물의 Supabase ID 또는 실패 시 null
 */
async function saveAiResultsToSupabase(
  userId,
  post,
  aiAnalysisResult,
  bandNumber
) {
  let supabasePostId = null;

  // <<< 변경 시작: is_product 계산 명확화 >>>
  // aiAnalysisResult.products 배열이 존재하고, 그 안에 실제 상품 객체가 있는지 확인
  const isProductPost = !!(
    aiAnalysisResult &&
    Array.isArray(aiAnalysisResult.products) &&
    aiAnalysisResult.products.length > 0 &&
    // getDefaultProduct가 반환하는 기본 객체가 아닌 실제 상품인지 추가 확인 (선택적이지만 권장)
    // 예: getDefaultProduct가 반환하는 객체에는 productId가 없을 수 있음
    aiAnalysisResult.products[0] &&
    aiAnalysisResult.products[0].productId
  );
  console.log(
    `Post ${post.postKey}: isProductPost 계산 결과: ${isProductPost}`
  );
  // <<< 변경 끝 >>>

  // 1. posts 테이블에 게시물 정보 Upsert
  const postId = userId + "_post_" + post.postKey;
  const dateObject = new Date(post.createdAt);
  try {
    const postDataToUpsert = {
      post_id: postId, // unique identifier
      user_id: userId,
      band_number: bandNumber, // <<--- [수정 필요] 실제 밴드 번호
      content: post.content || "",
      author_name: post.author?.name,
      comment_count: post.commentCount,
      status: "활성",
      posted_at: dateObject.toISOString(),
      is_product: isProductPost, // AI 분석 결과 반영

      updated_at: new Date().toISOString(),
      post_key: post.postKey,
      band_key: post.bandKey,
    };

    const { data: upsertedPostData, error: postUpsertError } = await supabase
      .from("posts")
      .upsert(postDataToUpsert, {
        onConflict: "post_id",
        ignoreDuplicates: false,
      })
      .select("post_id")
      .single();

    if (postUpsertError) throw postUpsertError;
    if (!upsertedPostData || !upsertedPostData.post_id)
      throw new Error("Failed to get post ID after upsert.");

    supabasePostId = upsertedPostData.post_id;
    console.log(
      `Post ${post.postKey} upserted/updated in Supabase (ID: ${supabasePostId}).`
    );
  } catch (dbError) {
    console.error(
      `Post ${post.postKey} Supabase 저장 오류: ${dbError.message}`,
      dbError.stack
    );
    // 게시물 저장 실패 시 null 반환 또는 에러 throw (호출 측에서 처리)
    return null;
  }

  // 2. products 테이블에 상품 정보 Upsert (게시물 저장 성공 및 상품이 있을 경우)
  if (supabasePostId && aiAnalysisResult.products.length > 0) {
    for (const product of aiAnalysisResult.products) {
      try {
        const productId = product.productId;
        if (!productId) {
          console.log(
            `Post ${post.postKey}, Item ${product.itemNumber}: AI 결과에 productId가 없어 상품 저장을 건너<0xEB><0x9B><0x84>니다.`
          );
          continue; // 다음 상품으로
        }

        const productDataToUpsert = {
          product_id: productId,
          post_id: supabasePostId,
          user_id: userId,
          band_number: bandNumber,
          post_number: post.postKey,
          item_number: product.itemNumber,
          title: product.title,
          content: post.content,
          base_price: product.basePrice,
          original_price: product.originalPrice,
          price_options: product.priceOptions,
          quantity: product.quantity,
          quantity_text: product.quantityText,
          category: product.category,
          tags: product.tags,
          features: product.features,
          status: product.status,
          pickup_info: product.pickupInfo,
          pickup_date: product.pickupDate
            ? new Date(product.pickupDate).toISOString()
            : null,
          pickup_type: product.pickupType,
          stock_quantity: product.stockQuantity,
          barcode: "", // 바코드 빈 값
          updated_at: new Date().toISOString(),
          posted_at: dateObject.toISOString(),
        };

        const { error: productUpsertError } = await supabase
          .from("products")
          .upsert(productDataToUpsert, {
            onConflict: "product_id",
            ignoreDuplicates: false,
          });

        if (productUpsertError) throw productUpsertError;
        console.log(
          `Product ${productId} (Post ${post.postKey}) upserted/updated in Supabase.`
        );
      } catch (dbError) {
        console.error(
          `Product (Post ${post.postKey}, Item ${product.itemNumber}) Supabase 저장 오류: ${dbError.message}`,
          dbError.stack
        );
        // 개별 상품 저장 실패는 로깅만 하고 계속 진행 (오류 전파 안 함)
        // 필요시 aiAnalysisResult 객체에 에러 정보 추가 가능
        if (!aiAnalysisResult.error) aiAnalysisResult.error = "";
        aiAnalysisResult.error += ` Supabase product save error (Item ${product.itemNumber}): ${dbError.message};`;
      }
    }
  }

  return supabasePostId; // 성공 시 게시물 ID 반환
}

/**
 * Band API에서 게시물을 가져와 AI 분석 후 DB에 저장하고 클라이언트에게 반환 (수정된 로직)
 */
async function getBandPosts(req, res) {
  const userId = req.query.userId;
  // 사용자 설정에서 post_fetch_limit 조회
  let userLimit = 200; // 기본값
  try {
    const { data: userSettings, error: userError } = await supabase
      .from("users")
      .select("post_fetch_limit")
      .eq("user_id", userId)
      .single();

    if (!userError && userSettings?.post_fetch_limit) {
      userLimit = parseInt(userSettings.post_fetch_limit, 10);
      console.log(`사용자 ${userId}의 게시물 제한 설정: ${userLimit}`);
    } else {
      console.log(
        `사용자 ${userId}의 게시물 제한 설정이 없어 기본값 ${userLimit} 사용`
      );
    }
  } catch (error) {
    console.warn(
      `사용자 설정 조회 실패: ${error.message}, 기본값 ${userLimit} 사용`
    );
  }

  // 프론트엔드 요청 limit 사용 (사용자 설정값을 기본값으로)
  let requestedLimit = userLimit; // 사용자 설정값을 기본값으로
  if (req.query.limit) {
    const parsedLimit = parseInt(req.query.limit, 10);
    if (!isNaN(parsedLimit) && parsedLimit > 0) {
      requestedLimit = parsedLimit; // 유효한 경우 요청값 사용
    }
  }

  // 실제 처리할 게시물 수 제한 (사용자 설정값과 1000 중 작은 값)
  const processingLimit = Math.min(requestedLimit, Math.max(userLimit, 1000));

  const processWithAI = req.query.processAI
    ? req.query.processAI === "true"
    : true;
  console.log(
    `getBandPosts 호출됨: userId=${userId}, 요청 limit=${requestedLimit}, 실제 처리 limit=${processingLimit}, processAI=${processWithAI}` // 로그에 processingLimit 추가
  );
  try {
    // --- 초기 설정 및 유효성 검사 (이전과 동일) ---
    if (!supabase) {
      /* ... 에러 처리 ... */
    }
    if (!userId) {
      /* ... 에러 처리 ... */
    }
    console.log(
      `getBandPosts 호출됨: userId=${userId}, limit=${
        requestedLimit === Infinity ? "all" : requestedLimit
      }, processAI=${processWithAI}`
    );

    // --- 1. Band API 게시물 가져오기 (a) ---
    console.log(`[단계 1] Band API에서 게시물 가져오기 시작...`);
    const postsFromApi = await bandService.getAllBandPosts(
      userId,
      processingLimit
    );
    console.log(
      `[단계 1] Band API에서 게시물 ${postsFromApi.length}개 가져옴.`
    );

    let postsWithAnalysis = []; // 최종 반환 및 DB 저장용 배열
    let postsToUpdateCommentInfo = []; // 댓글 정보 업데이트 대상 게시물 목록 (기존 게시물용)

    // --- 2. DB에서 기존 게시물 정보 조회 (b) ---
    console.log(`[단계 2] DB에서 기존 게시물 정보 조회 시작...`);
    const dbPostsMap = new Map();
    if (postsFromApi.length > 0) {
      // API에서 가져온 게시물이 있을 때만 DB 조회
      try {
        const { data: dbPosts, error: dbError } = await supabase
          .from("posts")
          .select("post_key, comment_count, last_checked_comment_at,is_product")
          .eq("user_id", userId)
          .in(
            "post_key",
            postsFromApi.map((p) => p.postKey)
          );

        if (dbError) throw dbError;

        dbPosts.forEach((dbPost) => {
          dbPostsMap.set(dbPost.post_key, {
            comment_count: dbPost.comment_count,
            last_checked_comment_at: dbPost.last_checked_comment_at
              ? new Date(dbPost.last_checked_comment_at).getTime()
              : 0,
            // <<< 변경 시작: is_product 정보 저장 >>>
            is_product: dbPost.is_product,
            // <<< 변경 끝 >>>
          });
        });
        console.log(
          `[단계 2] DB에서 ${dbPostsMap.size}개의 기존 게시물 정보 조회 완료.`
        );
      } catch (error) {
        console.error(`[단계 2] DB 게시물 정보 조회 중 오류: ${error.message}`);
        // DB 조회 실패 시에도 진행은 하되, 모든 게시물을 신규로 처리하게 될 수 있음
      }
    } else {
      console.log(
        `[단계 2] API에서 가져온 게시물이 없어 DB 조회를 건너<0xEB><0x9B><0x84>니다.`
      );
    }

    // --- 3. AI 서비스 로드 (필요시) ---
    let extractProductInfoAI = null;
    if (processWithAI) {
      console.log(`[단계 3] AI 서비스 로드 시도...`);
      try {
        extractProductInfoAI =
          require("../services/aiWithApi.service").extractProductInfo; // 경로 수정 필요
        if (extractProductInfoAI) console.log("[단계 3] AI 서비스 로드 성공.");
        else console.warn("[단계 3] AI 서비스 함수를 찾을 수 없습니다.");
      } catch (error) {
        console.error(`[단계 3] AI 서비스 로드 중 오류: ${error.message}`);
      }
    }

    // --- 4. API 게시물 순회 및 처리 ---
    console.log(`[단계 4] ${postsFromApi.length}개 게시물 순회 처리 시작...`);
    for (const apiPost of postsFromApi) {
      const postKey = apiPost.postKey;
      const dbPostData = dbPostsMap.get(postKey);
      const isNewPost = !dbPostData; // DB에 없으면 신규 게시물

      let aiAnalysisResult = null; // AI 결과 저장 변수 초기화
      let savedPostId = null; // 최종 저장된 post_id
      // <<< *** 추가: 이 게시물의 댓글/주문 처리 여부 플래그 *** >>>
      let processCommentsAndOrders = false;
      console.log(
        `  -> 게시물 ${postKey} 처리 시작 (${isNewPost ? "신규" : "기존"})`
      );

      if (isNewPost) {
        // ========== 상황 1: 신규 게시물 처리 ==========
        console.log(`[상황 1] 게시물 ${postKey}: 새로운 게시물 처리 시작.`);
        // <<< *** 수정 시작: contentHasPriceIndicator 결과에 따라 분기 *** >>>
        const mightBeProduct = contentHasPriceIndicator(apiPost.content);

        // 1.1. AI 분석 (상품 정보 추출)
        if (mightBeProduct) {
          console.log(`  - 게시물 ${postKey}: 가격 표시 감지.`);
          processCommentsAndOrders = true; // 댓글/주문 처리 대상으로 설정

          if (processWithAI && extractProductInfoAI) {
            console.log(`  - 게시물 ${postKey}: AI 분석 시작...`);
            try {
              aiAnalysisResult = await extractProductInfoAI(
                apiPost.content,
                apiPost.createdAt,
                postKey
              );
              console.log(
                `  - 게시물 ${postKey}: AI 분석 완료: ${JSON.stringify(
                  aiAnalysisResult
                )}`
              );
            } catch (aiError) {
              console.error(
                `  - 게시물 ${postKey}: AI 분석 중 오류: ${aiError.message}`
              );
              processCommentsAndOrders = false; // 댓글/주문 처리 안 함
              // AI 분석 실패 시 기본값 사용 (ai.service.js 에서 처리됨)
              aiAnalysisResult =
                require("../services/aiWithApi.service").getDefaultProduct(
                  "AI 분석 오류"
                ); // 기본값 직접 호출
            }
          } else {
            console.log(
              `  - 게시물 ${postKey}: 가격 정보 없어 AI 분석 건너뛰기.`
            );
            processCommentsAndOrders = false; // 댓글/주문 처리 안 함
            aiAnalysisResult =
              require("../services/aiWithApi.service").getDefaultProduct(
                "상품 아님(가격표시 없음)"
              );
          }
        } else {
          console.log(
            `  - 게시물 ${postKey}: AI 처리 비활성화 또는 로드 실패.`
          );
          aiAnalysisResult =
            require("../services/aiWithApi.service").getDefaultProduct(
              "AI 처리 안함"
            );
        }

        // <<< *** 수정: DB 저장 순서 변경 (상품 먼저 저장) *** >>>
        // 1.2. 게시물 및 상품 정보 먼저 저장
        console.log(`  - 게시물 ${postKey}: 게시물 및 상품 정보 저장 시도...`);
        const productMapForOrderProcessing = new Map(); // 변수 이름 변경하여 혼동 방지
        const productsFromAI =
          aiAnalysisResult && aiAnalysisResult.products
            ? aiAnalysisResult.products
            : [];
        console.log(
          `[New Post ${postKey}] Generated Product Map for Order Processing:`,
          productMapForOrderProcessing
        ); // 내용 확인
        const productsForOrder =
          aiAnalysisResult && aiAnalysisResult.products
            ? aiAnalysisResult.products
            : [];
        if (productsForOrder.length > 0) {
          productsForOrder.forEach((p) => {
            const productInfo = {
              /* product_id, base_price 등 포함 */
            };
            const itemNumKey =
              typeof p.itemNumber === "number" ? p.itemNumber : 1;
            if (productInfo.product_id)
              productMapForOrderProcessing.set(itemNumKey, productInfo);
          });
        }

        savedPostId = await saveAiResultsToSupabase(
          userId,
          apiPost,
          aiAnalysisResult, // AI 분석 결과 전달
          apiPost.bandKey
        );
        if (!savedPostId) {
          console.error(
            `  - 게시물 ${postKey}: 정보 저장 실패. 댓글 처리 건너<0xEB><0x9B><0x84>.`
          );
          postsWithAnalysis.push({
            ...apiPost,
            aiAnalysisResult,
            dbPostId: null,
          }); // 결과 배열에는 추가
          continue; // 다음 게시물로
        }
        console.log(
          `  - 게시물 ${postKey}: 정보 저장 완료 (ID: ${savedPostId})`
        );
        // <<< *** 수정 끝 *** >>>

        // 1.3. 댓글 가져오기 (신규 게시물은 모든 댓글이 새로운 댓글)
        let newCommentsForOrder = [];
        if (processCommentsAndOrders && apiPost.commentCount > 0) {
          console.log(
            `  - 게시물 ${postKey}: 댓글 ${apiPost.commentCount}개 가져오기 시도...`
          );
          try {
            // 댓글 가져오기 API 호출 전에 지연 추가 (쿼터 방지)
            await new Promise((resolve) => setTimeout(resolve, 1000)); // 1초 지연

            const { comments: fullComments } =
              await bandService.getBandComments(
                userId,
                postKey,
                apiPost.bandKey
              );
            newCommentsForOrder = fullComments; // 신규 게시물은 모든 댓글을 주문 처리 대상으로 함
            console.log(
              `  - 게시물 ${postKey}: 댓글 ${newCommentsForOrder.length}개 가져옴.`
            );
          } catch (commentError) {
            console.error(
              `  - 게시물 ${postKey}: 댓글 가져오기 중 오류: ${commentError.message}`
            );
            // 댓글 가져오기 실패해도 게시물/상품 저장은 진행
          }
        } else {
          console.log(`  - 게시물 ${postKey}: 댓글이 없습니다.`);
        }

        // 1.4. 주문/고객 데이터 생성 및 저장 (상품 저장 이후 수행)
        if (processCommentsAndOrders && newCommentsForOrder.length > 0) {
          console.log(
            `  - 게시물 ${postKey}: 가져온 댓글 ${newCommentsForOrder.length}개 주문 처리 시작...`
          );
          try {
            const productMapForOrderProcessing = new Map();
            const productsFromAI =
              aiAnalysisResult && aiAnalysisResult.products
                ? aiAnalysisResult.products
                : [];
            // --- 여기가 productMap을 채우는 실제 코드입니다 ---
            if (productsFromAI.length > 0) {
              productsFromAI.forEach((p) => {
                // AI 결과에서 필요한 정보 추출하여 productInfo 객체 생성
                const productInfo = {
                  product_id: p.productId || p.product_id, // AI 결과 필드명 확인! productId 인지 product_id 인지
                  base_price: p.basePrice, // base_price 필드명 확인! basePrice 인지 base_price 인지
                  price_options: p.priceOptions || [], // priceOptions 없으면 빈 배열
                  title: p.title, // title 필드명 확인!
                  // 기타 generateOrderDataFromComments에서 필요한 필드 추가
                };
                // itemNumber가 없거나 유효하지 않으면 1로 간주
                const itemNumKey =
                  typeof p.itemNumber === "number" && p.itemNumber > 0
                    ? p.itemNumber
                    : 1;

                // product_id 가 있어야 유효한 상품 정보로 간주하고 Map에 추가
                if (productInfo.product_id) {
                  productMapForOrderProcessing.set(itemNumKey, productInfo);
                } else {
                  console.log(
                    `[New Post ${postKey}] AI 결과에서 productId 누락: itemNumber=${itemNumKey}, title=${p.title}`
                  );
                }
              });
            }
            // --- productMap 채우기 끝 ---
            console.log(
              `[New Post ${postKey}] Generated Product Map for Order Processing:`,
              productMapForOrderProcessing
            );
            // <<< 중요: generateOrderDataFromComments에 전달할 productMap 확인 >>>
            // AI 결과로 만든 productMapForSave 또는 DB에서 다시 조회한 Map 사용 가능
            // 여기서는 AI 결과 기반 productMapForSave 사용 예시
            const orderData = await bandService.generateOrderDataFromComments(
              userId,
              newCommentsForOrder,
              productMapForOrderProcessing,
              postKey, // postKey 전달 (옵션)
              aiAnalysisResult?.multipleProducts || false // AI 결과의 multipleProducts 값 전달
            );

            console.log(
              `  - 게시물 ${postKey}: 주문 ${orderData.orders.length}개, 고객 ${orderData.customers.size}명 데이터 생성.`
            );

            // 생성된 주문 저장
            if (orderData.orders.length > 0) {
              const { error: orderSaveError } = await supabase
                .from("orders")
                .upsert(orderData.orders, { onConflict: "order_id" }); // 이제 Foreign Key 제약 조건 만족
              if (orderSaveError)
                console.error(
                  `    - 주문 저장 오류: ${orderSaveError.message}`
                );
              else
                console.log(
                  `    - 주문 ${orderData.orders.length}개 저장 완료.`
                );
            }
            // 생성된 고객 저장
            const customersArray = Array.from(orderData.customers.values());
            if (customersArray.length > 0) {
              const { error: customerSaveError } = await supabase
                .from("customers")
                .upsert(customersArray, { onConflict: "customer_id" }); // 'customer_id'는 실제 PK/Unique 키여야 함
              if (customerSaveError)
                console.error(
                  `    - 고객 저장 오류: ${customerSaveError.message}`
                );
              else
                console.log(`    - 고객 ${customersArray.length}명 저장 완료.`);
            }
          } catch (processingError) {
            console.error(
              `  - 게시물 ${postKey}: 댓글 주문 처리 중 오류: ${processingError.message}`
            );
          }
        }
      } else {
        // ========== 상황 2: 기존 게시물 처리 ==========
        console.log(`[상황 2] 게시물 ${postKey}: 기존 게시물 처리 시작.`);
        savedPostId = `${userId}_post_${postKey}`; // 기존 게시물 ID 구성

        // <<< 변경 시작: is_product가 false이면 건너뛰기 >>>
        if (dbPostData.is_product === false) {
          console.log(
            `    - DB에 '상품 아님(is_product: false)'으로 표시되어 상세 처리를 건너뜁니다.`
          );
          // postsWithAnalysis 배열에는 추가 (API에서 가져왔으므로)
          postsWithAnalysis.push({
            ...apiPost,
            aiAnalysisResult: null,
            dbPostId: savedPostId,
          });
          console.log(`  -> 게시물 ${postKey} 처리 완료 (상품 아님 스킵).`);
          continue; // 다음 게시물로 넘어감
        }
        // <<< 변경 끝 >>>

        // 2.1. 댓글 업데이트 필요 여부 판단 (기존 로직 사용)
        let latestCommentTsFromPreview = 0;
        if (apiPost.latestComments && apiPost.latestComments.length > 0) {
          latestCommentTsFromPreview = Math.max(
            ...apiPost.latestComments.map((c) => c.createdAt)
          );
        }
        const commentCountChanged =
          apiPost.commentCount !== dbPostData.comment_count;
        const newPreviewCommentExists =
          latestCommentTsFromPreview > dbPostData.last_checked_comment_at;

        const needsCommentUpdate =
          commentCountChanged || newPreviewCommentExists;

        if (needsCommentUpdate && apiPost.commentCount > 0) {
          console.log(
            `  - 게시물 ${postKey}: 댓글 업데이트 필요 (사유: ${
              commentCountChanged ? "댓글 수 변경" : ""
            }${commentCountChanged && newPreviewCommentExists ? ", " : ""}${
              newPreviewCommentExists ? "최신 미리보기 댓글" : ""
            }). 댓글 수: ${apiPost.commentCount}`
          );

          let latestTimestampFromFullComments = null;
          let newCommentsFound = [];

          try {
            // 댓글 가져오기 API 호출 전에 지연 추가 (쿼터 방지)
            await new Promise((resolve) => setTimeout(resolve, 1000)); // 1초 지연

            // 2.1.1. 전체 댓글 가져오기
            const { comments: fullComments, latestTimestamp } =
              await bandService.getBandComments(
                userId,
                postKey,
                apiPost.bandKey
              );
            latestTimestampFromFullComments = latestTimestamp;
            console.log(
              `  - 게시물 ${postKey}: 전체 댓글 ${fullComments.length}개 가져옴.`
            );

            // 2.1.2. 새로운 댓글 필터링 로직 수정
            const lastCheckedTs = dbPostData.last_checked_comment_at || 0;
            console.log(
              `  - 게시물 ${postKey}: last_checked_comment_at (${new Date(
                lastCheckedTs
              ).toISOString()}) 이후 댓글만 확인하여 신규 주문 처리합니다.`
            );

            const newComments = fullComments.filter((comment) => {
              // <<< 유효성 검사 추가 >>>
              if (
                typeof comment.created_at !== "number" ||
                isNaN(comment.created_at)
              ) {
                console.warn(
                  `    - 댓글 ID ${comment.comment_id}: Invalid or missing created_at value (${comment.created_at}). Skipping.`
                );
                return false; // 유효하지 않으면 필터링
              }
              // <<< // 유효성 검사 추가 끝 >>>

              const commentTimestampMs = comment.created_at; // created_at을 그대로 사용
              const commentDate = new Date(commentTimestampMs);
              const isNew = commentDate > lastCheckedTs;
              console.log(
                `    - 댓글 ID ${comment.comment_id}: raw_created_at=${
                  comment.created_at
                } (ms assumed), date=${commentDate.toISOString()}, lastChecked=${new Date(
                  lastCheckedTs
                ).toISOString()}, isNew=${isNew}`
              );
              return isNew;
            });

            if (newComments.length > 0) {
              console.log(
                `  - 게시물 ${postKey}: 새로운 댓글 ${newComments.length}개 발견. 주문 처리 시작...`
              );
              // <<< 변경 시작: DB에서 상품 정보 조회 로직 추가 >>>

              // <<< 변경 시작: API 호출 지연 추가 >>>
              await new Promise((resolve) => setTimeout(resolve, 1000)); // 1초 지연
              // <<< 변경 끝 >>>

              try {
                console.log(
                  `      - 주문 처리를 위해 게시물 ${postKey}의 상품 정보를 DB에서 조회합니다...`
                );
                const productMap = await bandService._fetchProductMapForPost(
                  userId,
                  postKey
                ); // DB 조회
                console.log(
                  `[Existing Post ${postKey}] Fetched Product Map from DB:`,
                  productMap
                ); // 내용 확인

                if (productMap.size > 0) {
                  const orderData =
                    await bandService.generateOrderDataFromComments(
                      userId,
                      newComments,
                      productMap,
                      postKey, // postKey 전달 (옵션)
                      // <<< isMultipleProductsPost 값 전달 추가 >>>
                      dbPostData.ai_analysis_result?.is_multiple_products ??
                        productMap.size > 1
                    );
                  // <<< 디버깅 로그 추가 >>>
                  console.log(
                    `[DEBUG ${postKey}] generateOrderDataFromComments returned order count: ${
                      orderData?.orders?.length || 0
                    }, authors to update count: ${
                      orderData?.authorsToUpdate?.length || 0
                    }`
                  );
                  // ... (주문/고객 정보 저장 로직 - Foreign Key 문제 없음) ...
                  console.log(
                    `      - 신규 댓글 주문 ${orderData.orders.length}개, 고객 ${orderData.customers.size}명 생성/저장 시도 완료.`
                  );

                  // Supabase upsert logic to save the generated orders and customers to the database
                  if (
                    orderData &&
                    orderData.orders &&
                    orderData.orders.length > 0
                  ) {
                    console.log(
                      `      - Saving ${orderData.orders.length} orders to DB...`
                    );
                    const { error: orderError } = await supabase
                      .from("orders")
                      .upsert(orderData.orders, { onConflict: "order_id" }); // 'order_id'는 실제 PK/Unique 키여야 함
                    if (orderError) {
                      console.error(
                        `      - Error saving orders for post ${postKey}:`,
                        orderError
                      );
                    } else {
                      console.log(`      - Orders saved successfully.`);
                    }
                  }

                  if (
                    orderData &&
                    orderData.customers &&
                    orderData.customers.size > 0
                  ) {
                    const customersArray = Array.from(
                      orderData.customers.values()
                    );
                    console.log(
                      `      - Saving ${customersArray.length} customers to DB...`
                    );
                    const { error: customerError } = await supabase
                      .from("customers")
                      .upsert(customersArray, { onConflict: "customer_id" }); // 'customer_id'는 실제 PK/Unique 키여야 함
                    if (customerError) {
                      console.error(
                        `      - Error saving customers for post ${postKey}:`,
                        customerError
                      );
                    } else {
                      console.log(`      - Customers saved successfully.`);
                    }
                  }
                } else {
                  console.log(
                    `      - DB에서 상품 정보를 찾을 수 없어 신규 댓글 주문 처리를 건너<0xEB><0x9B><0x84>니다.`
                  );
                }
              } catch (processingError) {
                console.error(
                  `    - 신규 댓글 주문 처리 중 오류: ${processingError.message}`
                );
              }
              // <<< *** 수정 끝 *** >>>
            } else {
              console.log(
                `  - 게시물 ${postKey}: 댓글 수는 변경되었으나 DB 확인 후의 새로운 댓글은 없음.`
              );
            }
          } catch (commentError) {
            console.error(
              `  - 게시물 ${postKey}: 댓글 가져오기/처리 중 오류: ${commentError.message}`
            );
          }

          // 2.1.4. 댓글 정보 업데이트 목록에 추가 (실제 댓글 확인 완료 후)
          const newLastCheckedTimestamp = latestTimestampFromFullComments // 전체 댓글 확인 시 가장 최신 댓글 시간
            ? new Date(latestTimestampFromFullComments).toISOString()
            : new Date().toISOString(); // 실패 시 현재 시간

          postsToUpdateCommentInfo.push({
            post_id: savedPostId, // PK
            comment_count: apiPost.commentCount, // API 최신 댓글 수
            last_checked_comment_at: newLastCheckedTimestamp,
          });
          console.log(
            `  - 게시물 ${postKey}: 댓글 정보 업데이트 예정 (count: ${apiPost.commentCount}, checked_at: ${newLastCheckedTimestamp})`
          );
        } else {
          console.log(`  - 게시물 ${postKey}: 댓글 업데이트 필요 없음.`);
          // 댓글 업데이트가 필요 없어도 AI 결과 등 다른 정보는 필요할 수 있으므로 결과 배열에 추가
          // AI 결과는 신규일 때만 가져왔으므로, 기존 게시물은 aiAnalysisResult가 null임
        }

        // --- 중요: 기존 게시물의 AI 재분석 로직 ---
        // 요구사항에는 없었지만, 만약 기존 게시물의 내용이 변경되어 상품 정보 업데이트가 필요하다면
        // 여기서 AI 재분석 로직을 추가해야 합니다. (예: apiPost.content와 DB의 content 비교)
        // 현재 로직에서는 기존 게시물은 AI 분석을 다시 하지 않습니다.
      } // End of if (isNewPost) ... else

      // 4.1. 최종 결과 배열에 추가 (모든 게시물 공통)
      // 기존 게시물은 aiAnalysisResult가 null일 수 있음
      postsWithAnalysis.push({
        ...apiPost,
        aiAnalysisResult,
        dbPostId: savedPostId,
      });
    } // End of posts loop
    console.log(`[단계 4] ${postsFromApi.length}개 게시물 순회 처리 완료.`);

    // --- 5. 댓글 정보 필드 일괄 업데이트 (기존 게시물 대상) --- (Upsert 복원, checked_at만 업데이트 시도)
    if (postsToUpdateCommentInfo.length > 0) {
      console.log(
        `[단계 5] ${postsToUpdateCommentInfo.length}개 기존 게시물의 last_checked_comment_at 일괄 업데이트 시작 (upsert)...`
      );

      // Upsert할 데이터에서 comment_count 제외
      const postsToUpdateCheckedAt = postsToUpdateCommentInfo.map((post) => ({
        post_id: post.post_id,
        last_checked_comment_at: post.last_checked_comment_at,
      }));

      console.log(
        "[DEBUG] Data for posts checked_at update:",
        JSON.stringify(postsToUpdateCheckedAt, null, 2)
      );

      try {
        const { error: updateError } = await supabase
          .from("posts")
          .upsert(postsToUpdateCheckedAt, {
            // comment_count 제외된 데이터 사용
            onConflict: "post_id",
          });

        // <<< 반환된 에러 객체 로깅 추가 >>>
        console.log("[DEBUG] Supabase upsert returned error:", updateError);

        if (updateError) throw updateError;
        console.log("[단계 5] last_checked_comment_at 필드 업데이트 완료.");
      } catch (error) {
        console.error(
          `[단계 5] last_checked_comment_at 필드 업데이트 중 오류: ${error.message}`
        );
      }
    } else {
      console.log("[단계 5] 업데이트할 댓글 정보 없음.");
    }

    // --- 6. 최종 결과 반환 ---
    console.log(
      `[단계 6] 최종 처리 완료: ${postsWithAnalysis.length}개 게시물 데이터 반환`
    );
    res.json({ success: true, data: postsWithAnalysis });
  } catch (error) {
    console.error(
      `getBandPosts 처리 중 예외 발생: ${error.message}`,
      error.stack
    );
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
}

/**
 * 특정 사용자의 밴드 댓글을 가져와 처리하고, 주문 및 고객 정보를 DB에 저장/업데이트합니다.
 */
async function getBandComments(req, res) {
  const userId = req.query.userId;
  // bandNumber는 이제 service 레벨에서 내부적으로 처리될 수 있으므로, 필수 파라미터에서 제외될 수 있습니다.
  // 필요하다면 쿼리 파라미터로 계속 받을 수 있습니다. const bandNumber = req.query.bandNumber;

  if (!userId) {
    console.log("getBandComments 호출 실패: 필수 파라미터 누락 (userId)");
    return res.status(400).json({
      success: false,
      message: "Missing required query parameter: userId",
    });
  }

  // Supabase 클라이언트 확인
  if (!supabase) {
    console.log("Supabase client is not available.");
    return res.status(500).json({
      success: false,
      message: "Internal Server Error: Database client not configured.",
    });
  }

  console.log(`Starting comment fetching and processing for user ${userId}...`);

  try {
    // 1. 서비스 호출하여 모든 게시물의 댓글 가져오기 (Band API 호출)
    // bandNumber 인자가 필요 없으면 bandService.getBandComments 에서 제거해야 함
    const allCommentsByPost = await bandService.getBandComments(userId); // bandNumber 제거 또는 필요시 전달

    // 댓글 데이터가 없는 경우 처리
    if (
      !allCommentsByPost ||
      typeof allCommentsByPost !== "object" ||
      Object.keys(allCommentsByPost).length === 0
    ) {
      console.log(
        `No comments found or fetched for user ${userId}. No data to process.`
      );
      return res.status(200).json({
        success: true,
        message: "No comments found or fetched to process.",
        summary: {
          processedPosts: 0,
          totalComments: 0,
          generatedOrders: 0,
          generatedCustomers: 0,
          savedOrders: 0,
          savedCustomers: 0,
          orderErrors: [],
          customerErrors: [],
        },
      });
    }

    // 2. 가져온 댓글 데이터를 서비스에 전달하여 주문 및 고객 데이터 생성 (DB 저장 X)
    const {
      orders: ordersToSave, // 생성된 주문 데이터 배열
      customers: customersToGenerateMap, // 생성/업데이트된 고객 데이터 Map
      summary: processingSummary, // 처리 요약 정보
    } = await bandService.processAndGenerateOrdersFromComments(
      userId,
      allCommentsByPost // API로부터 받은 댓글 데이터 전달
    );

    // 3. 생성된 데이터를 Supabase DB에 저장/업데이트
    let savedOrdersCount = 0;
    let savedCustomersCount = 0;
    const orderErrors = [];
    const customerErrors = [];

    // --- 생성된 주문(Orders) 저장 ---
    if (Array.isArray(ordersToSave) && ordersToSave.length > 0) {
      console.log(
        `Attempting to save ${ordersToSave.length} generated orders for user ${userId}.`
      );
      const { data: savedOrders, error: orderError } = await supabase
        .from("orders") // 실제 주문 테이블 이름 확인
        .upsert(ordersToSave, {
          onConflict: "order_id", // PK 컬럼 지정
          ignoreDuplicates: false, // 기본값 false, 중복 시 업데이트
        })
        .select("order_id"); // 저장된 레코드 수 확인을 위해 select 사용 (선택 사항)

      if (orderError) {
        console.error(
          `Error saving orders for user ${userId}: ${orderError.message}`
        );
        orderErrors.push(orderError.message);
      } else {
        // Supabase v2 upsert는 기본적으로 성공 시 data에 null 반환, count 필요시 select 사용
        // savedOrders가 null이 아닐 경우 길이를 사용, 아니면 입력 배열 길이로 카운트
        savedOrdersCount = savedOrders
          ? savedOrders.length
          : ordersToSave.length;
        console.log(
          `Successfully saved/updated ${savedOrdersCount} orders for user ${userId}.`
        );
      }
    } else {
      console.log(`No orders generated to save for user ${userId}.`);
    }

    // --- 생성된 고객(Customers) 정보 저장 ---
    // service에서 Map으로 반환했으므로 배열로 변환 필요
    const newCustomersToSave = Array.isArray(customersToGenerateMap)
      ? customersToGenerateMap // 만약 서비스에서 배열로 반환한다면 그대로 사용
      : customersToGenerateMap instanceof Map
      ? Array.from(customersToGenerateMap.values()) // Map이면 배열로 변환
      : []; // 그 외 경우는 빈 배열

    if (Array.isArray(newCustomersToSave) && newCustomersToSave.length > 0) {
      console.log(
        `Attempting to save ${newCustomersToSave.length} generated/updated customers for user ${userId}.`
      );
      const { data: savedCustomers, error: customerError } = await supabase
        .from("customers") // 실제 고객 테이블 이름 확인
        .upsert(newCustomersToSave, {
          onConflict: "customer_id", // PK 컬럼 지정
          ignoreDuplicates: false, // 중복 시 업데이트
        })
        .select("customer_id"); // 저장된 레코드 수 확인 (선택 사항)

      if (customerError) {
        console.error(
          `Error saving customers for user ${userId}: ${customerError.message}`
        );
        customerErrors.push(customerError.message);
      } else {
        savedCustomersCount = savedCustomers
          ? savedCustomers.length
          : newCustomersToSave.length;
        console.log(
          `Successfully saved/updated ${savedCustomersCount} customers for user ${userId}.`
        );
      }
    } else {
      console.log(
        `No customers generated or updated to save for user ${userId}.`
      );
    }

    // 4. 최종 결과 응답
    const hasErrors = orderErrors.length > 0 || customerErrors.length > 0;
    const finalMessage = hasErrors
      ? "Comment processing completed with errors."
      : "Successfully processed and saved comment data.";

    return res.status(hasErrors ? 500 : 200).json({
      success: !hasErrors,
      message: finalMessage,
      summary: {
        ...processingSummary, // 서비스에서 받은 처리 요약 정보 포함
        savedOrders: savedOrdersCount,
        savedCustomers: savedCustomersCount,
        orderErrors: orderErrors,
        customerErrors: customerErrors,
      },
    });
  } catch (error) {
    // 서비스 호출 또는 DB 저장 중 발생한 예외 처리
    console.error(
      `Unhandled error in getBandComments controller for user ${userId}: ${error.message}`,
      error // 스택 트레이스 로깅
    );
    return res.status(500).json({
      success: false,
      message: "Internal Server Error during comment processing.",
      error: error.message, // 개발/디버깅용 에러 메시지 포함
    });
  }
}

/**
 * 제공된 댓글 목록을 분석하여 주문 정보를 생성하고 저장합니다.
 * @param {object} req - Express 요청 객체 (body: { userId: string, comments: array })
 * @param {object} res - Express 응답 객체
 */
async function processCommentsToOrders(req, res) {
  const { userId, comments } = req.body;

  // 입력 값 검증
  if (!userId || !Array.isArray(comments) || comments.length === 0) {
    console.log(
      "processCommentsToOrders 호출 실패: 필수 파라미터 누락 또는 형식 오류",
      { userId, commentsLength: comments?.length }
    );
    return res.status(400).json({
      success: false,
      message:
        "Missing required parameters (userId, comments array) or invalid format.",
    });
  }

  // 각 댓글 객체 기본 검증 (예: 필요한 키 존재 여부)
  const requiredKeys = [
    "comment_key",
    "author",
    "content",
    "post_key",
    "band_key",
    "created_at",
  ];
  const invalidComment = comments.find(
    (c) =>
      !c ||
      typeof c !== "object" ||
      !c.author ||
      typeof c.author !== "object" ||
      requiredKeys.some((key) => !(key in c))
  );

  if (invalidComment) {
    console.log(
      "processCommentsToOrders 호출 실패: comments 배열 내 객체 형식 오류",
      { invalidComment }
    );
    return res.status(400).json({
      success: false,
      message: `Invalid comment object format in 'comments' array. Missing required keys like ${requiredKeys.join(
        ", "
      )} or author object.`,
      invalidComment: invalidComment, // 디버깅 위한 정보 추가 (선택 사항)
    });
  }

  try {
    console.log(
      `processCommentsToOrders 호출: userId=${userId}, comments=${comments.length}개`
    );
    // 서비스 함수 호출
    const results = await bandService.processAndSaveOrdersFromComments(
      userId,
      comments
    );

    console.log(`processCommentsToOrders 처리 완료: userId=${userId}`, results);
    res.status(200).json({
      success: true,
      message: "Comments processed for orders successfully.",
      data: results, // 처리 결과 반환 (saved, skipped, errors)
    });
  } catch (error) {
    console.error(
      "Error in processCommentsToOrders controller:",
      error.message
    );
    console.error(
      `processCommentsToOrders Controller 오류 (userId: ${userId}): ${error.message}`,
      error.stack
    );
    res.status(500).json({
      success: false,
      message: error.message || "Failed to process comments for orders.",
    });
  }
}

module.exports = {
  saveAiResultsToSupabase, // 기존 함수들
  getBandPosts,
  getBandComments, // 수정된 함수 포함
  processCommentsToOrders, // 새로 추가된 컨트롤러 export
};
