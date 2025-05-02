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

// --- AI 서비스 로드 ---
let extractProductInfoAI = null;
// generateProductUniqueIdForItem, generateBarcodeFromProductId 는 이제 사용 안 함
try {
  const aiService = require("../services/aiWithApi.service");
  extractProductInfoAI = aiService.extractProductInfo;

  if (extractProductInfoAI) logger.info("AI 서비스 로드됨.");
  else logger.warn("AI 서비스 함수(extractProductInfo)를 찾을 수 없습니다.");
} catch (error) {
  logger.error(`AI 서비스 로드 중 오류: ${error.message}`);
  extractProductInfoAI = null;
}
// ---------------------------------------------------------

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
      is_product: aiAnalysisResult.isProductPost, // AI 분석 결과 반영

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
    logger.debug(
      `Post ${post.postKey} upserted/updated in Supabase (ID: ${supabasePostId}).`
    );
  } catch (dbError) {
    logger.error(
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
          logger.warn(
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
          content: product.content,
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
        logger.debug(
          `Product ${productId} (Post ${post.postKey}) upserted/updated in Supabase.`
        );
      } catch (dbError) {
        logger.error(
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
 * Band API에서 게시물을 가져와 AI 분석 후 DB에 저장하고 클라이언트에게 반환
 */
async function getBandPosts(req, res) {
  const userId = req.query.userId;
  const bandNumber = req.query.bandNumber;
  try {
    // Supabase 클라이언트 확인 (함수 시작 시점)
    if (!supabase) {
      logger.error("Supabase client is not available.");
      return res.status(500).json({
        success: false,
        message: "Internal Server Error: Database client not configured.",
      });
    }

    // 사용자 ID 확인 (함수 시작 시점)
    if (!userId) {
      logger.error("getBandPosts 호출 실패: 사용자 ID를 찾을 수 없습니다.");
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized: User ID not found." });
    }

    // Limit 파라미터 처리
    let requestedLimit = Infinity;
    if (req.query.limit) {
      const parsedLimit = parseInt(req.query.limit, 10);
      if (!isNaN(parsedLimit) && parsedLimit > 0) {
        requestedLimit = parsedLimit;
      }
    }

    // AI 실행 여부 확인 (서비스 로드 여부 기준)
    const runAI = extractProductInfoAI !== null;
    if (!runAI) {
      logger.warn("AI 서비스가 로드되지 않아 AI 분석 없이 진행합니다.");
    }

    console.log(
      `Received request for /api/band/posts with limit: ${
        requestedLimit === Infinity ? "all" : requestedLimit
      }, runAI: ${runAI}`
    );

    // 1. Band 서비스에서 게시물 가져오기
    const posts = await bandService.getAllBandPosts(userId, requestedLimit);
    let postsWithAnalysis = []; // 최종 반환 및 DB 저장용 배열

    logger.info(`데이터 처리 시작: ${posts.length}개 게시물`);
    for (const post of posts) {
      let aiAnalysisResult = {
        processed: false,
        products: [],
        isProductPost: false,
        error: null,
      };

      const mightBeProduct = contentHasPriceIndicator(post.content);
      if (runAI && mightBeProduct) {
        // 2. AI 처리
        try {
          const postNumStr = post.postKey;
          // const bandNumberStr = "UNKNOWN_BAND"; // saveAiResultsToSupabase 호출 시 전달
          // const imageUrls = ... // AI 함수 시그니처에 따라 필요시 추가

          const aiResult = await extractProductInfoAI(
            post.content,
            new Date(post.createdAt),
            postNumStr
          );

          if (aiResult && (aiResult.products?.length > 0 || aiResult.title)) {
            const productsFromAI = (
              aiResult.multipleProducts
                ? aiResult.products
                : [{ ...aiResult, itemNumber: 1 }]
            ).map((item, index) => ({
              itemNumber:
                typeof item.itemNumber === "number" && item.itemNumber > 0
                  ? item.itemNumber
                  : index + 1,
              productId: item.productId,
              title: item.title || "제목 없음",
              content: item.content || "",
              basePrice: item.basePrice ?? 0,
              content: posts.content,
              originalPrice: item.originalPrice,
              priceOptions: item.priceOptions || [],
              quantity: item.quantity ?? 1,
              quantityText: item.quantityText || null,
              category: item.category || "기타",
              tags: item.tags || [],
              features: item.features || [],
              status: item.status || "판매중",
              pickupInfo: item.pickupInfo || null,
              pickupDate: item.pickupDate || null,
              pickupType: item.pickupType || null,
              stockQuantity: item.stockQuantity,
            }));
            aiAnalysisResult = {
              processed: true,
              products: productsFromAI,
              isProductPost: true,
              error: null,
            };
            logger.debug(
              `Post ${postNumStr}: AI 분석 완료 - 상품 ${productsFromAI.length}개`
            );
          } else {
            aiAnalysisResult = {
              processed: true,
              products: [],
              isProductPost: false,
              error: null,
            };
            logger.debug(`Post ${post.postKey}: AI 분석 완료 - 상품 없음`);
          }
        } catch (e) {
          logger.error(
            `Post ${post.postKey || "N/A"} AI 분석 중 오류: ${e.message}`,
            e.stack // 스택 트레이스 로깅 추가
          );
          aiAnalysisResult = {
            processed: false,
            products: [],
            isProductPost: false,
            error: e.message,
          };
        }
      }

      // --- 3. 결과 Supabase에 저장 (AI 실행 여부와 관계 없이 게시물 정보는 저장 시도 가능) ---
      // **주의**: 현재 로직은 runAI=true일 때만 AI 결과를 포함하여 저장함.
      // AI를 실행하지 않았어도 기본 post 정보는 저장하고 싶다면 saveAiResultsToSupabase 호출 위치/조건 조정 필요.
      if (runAI) {
        // runAI 일때만 저장 로직 수행 (요구사항)
        const savedPostId = await saveAiResultsToSupabase(
          userId,
          post,
          aiAnalysisResult, // AI 결과 전달
          bandNumber
        );

        if (savedPostId === null) {
          // 게시물 저장 자체가 실패한 경우 (오류는 saveAiResultsToSupabase 내부에서 로깅됨)
          if (!aiAnalysisResult.error) aiAnalysisResult.error = "";
          aiAnalysisResult.error +=
            " Failed to save main post data to Supabase;";
        }
      }
      // ----------------------------------------------------------------------

      // 최종 결과 배열에 AI 분석 결과 포함하여 추가 (AI 안 돌렸으면 기본값 포함)
      postsWithAnalysis.push({ ...post, aiAnalysis: aiAnalysisResult });
    } // end of for loop

    logger.info("데이터 처리 완료.");

    res.json({
      success: true,
      totalPosts: postsWithAnalysis.length,
      processedWithAI: runAI,
      message: "Band posts retrieved and processed.", // 메시지 수정
      data: postsWithAnalysis, // AI 분석 결과 포함된 데이터 반환
    });
  } catch (error) {
    console.error("Error in getBandPosts controller:", error.message);
    logger.error(`getBandPosts Controller 오류: ${error.message}`, error.stack);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to process request.",
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
    logger.warn("getBandComments 호출 실패: 필수 파라미터 누락 (userId)");
    return res.status(400).json({
      success: false,
      message: "Missing required query parameter: userId",
    });
  }

  // Supabase 클라이언트 확인
  if (!supabase) {
    logger.error("Supabase client is not available.");
    return res.status(500).json({
      success: false,
      message: "Internal Server Error: Database client not configured.",
    });
  }

  logger.info(`Starting comment fetching and processing for user ${userId}...`);

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
      logger.info(
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
    if (ordersToSave && ordersToSave.length > 0) {
      logger.info(
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
        logger.error(
          `Error saving orders for user ${userId}: ${orderError.message}`
        );
        orderErrors.push(orderError.message);
      } else {
        // Supabase v2 upsert는 기본적으로 성공 시 data에 null 반환, count 필요시 select 사용
        // savedOrders가 null이 아닐 경우 길이를 사용, 아니면 입력 배열 길이로 카운트
        savedOrdersCount = savedOrders
          ? savedOrders.length
          : ordersToSave.length;
        logger.info(
          `Successfully saved/updated ${savedOrdersCount} orders for user ${userId}.`
        );
      }
    } else {
      logger.info(`No orders generated to save for user ${userId}.`);
    }

    // --- 생성된 고객(Customers) 정보 저장 ---
    // service에서 Map으로 반환했으므로 배열로 변환 필요
    const customersToSave = customersToGenerateMap
      ? Array.from(customersToGenerateMap.values())
      : [];

    if (customersToSave && customersToSave.length > 0) {
      logger.info(
        `Attempting to save ${customersToSave.length} generated/updated customers for user ${userId}.`
      );
      const { data: savedCustomers, error: customerError } = await supabase
        .from("customers") // 실제 고객 테이블 이름 확인
        .upsert(customersToSave, {
          onConflict: "customer_id", // PK 컬럼 지정
          ignoreDuplicates: false, // 중복 시 업데이트
        })
        .select("customer_id"); // 저장된 레코드 수 확인 (선택 사항)

      if (customerError) {
        logger.error(
          `Error saving customers for user ${userId}: ${customerError.message}`
        );
        customerErrors.push(customerError.message);
      } else {
        savedCustomersCount = savedCustomers
          ? savedCustomers.length
          : customersToSave.length;
        logger.info(
          `Successfully saved/updated ${savedCustomersCount} customers for user ${userId}.`
        );
      }
    } else {
      logger.info(
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
    logger.error(
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
    logger.warn(
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
    logger.warn(
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
    logger.info(
      `processCommentsToOrders 호출: userId=${userId}, comments=${comments.length}개`
    );
    // 서비스 함수 호출
    const results = await bandService.processAndSaveOrdersFromComments(
      userId,
      comments
    );

    logger.info(`processCommentsToOrders 처리 완료: userId=${userId}`, results);
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
    logger.error(
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
