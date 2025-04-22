// supabase/functions/save-crawled-data/index.ts
// Deno 및 postgres 라이브러리 import
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

// --- 환경 변수 확인 및 PostgreSQL 연결 풀 설정 ---
const databaseUrl = Deno.env.get("SUPABASE_DB_URL");
if (!databaseUrl) {
  console.error("SUPABASE_DB_URL 환경 변수가 설정되지 않았습니다.");
  throw new Error("Database URL not configured.");
}
// 연결 풀 생성 (최대 연결 수 등 조절 가능)
const pool = new Pool(databaseUrl, 10, true);
console.log("Database pool initialized.");

// CORS 헤더 직접 정의
const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // 실제 서비스에서는 특정 도메인으로 제한하는 것이 좋습니다.
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS", // 이 함수는 POST와 OPTIONS만 처리
};

// --- 요청 처리 함수 ---
serve(async (req: Request) => {
  // CORS 프리플라이트 요청 처리
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("Received request:", req.method, req.url);
    // 요청 본문에서 데이터 추출 (JSON 형식 가정)
    const payload = await req.json();
    const {
      userId,
      customers = [],
      posts = [],
      products = [],
      orders = [],
    } = payload;

    // 간단한 데이터 유효성 검사
    if (
      !Array.isArray(customers) ||
      !Array.isArray(posts) ||
      !Array.isArray(products) ||
      !Array.isArray(orders)
    ) {
      throw new Error(
        "Invalid payload structure: Expected arrays for customers, posts, products, orders."
      );
    }
    console.log(
      `데이터 수신: Customers(${customers.length}), Posts(${posts.length}), Products(${products.length}), Orders(${orders.length})`
    );

    // 데이터베이스 연결 가져오기
    const connection = await pool.connect();
    console.log("Database connection acquired.");

    try {
      // =============================================
      // === 트랜잭션 시작 ===
      // =============================================
      await connection.queryObject("BEGIN");
      console.log("트랜잭션 시작.");

      // 1. 고객 정보 Upsert (INSERT ... ON CONFLICT ...)
      if (customers.length > 0) {
        // ⚠️ 중요: 아래 SQL은 예시이며, 실제 테이블/컬럼명으로 수정해야 합니다.
        // ⚠️ 중요: total_orders, total_spent 업데이트 로직은 단순 덮어쓰기가 아닌,
        //         별도의 RPC 함수 호출 또는 원자적 업데이트 구문 사용이 권장됩니다.
        //         (예: UPDATE customers SET total_orders = total_orders + 1 ...)
        for (const customer of customers) {
          await connection.queryObject(
            `INSERT INTO customers (customer_id, user_id, band_number, name, total_orders, total_spent, first_order_at, last_order_at, notes, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              ON CONFLICT (customer_id) DO UPDATE SET
                name = EXCLUDED.name,
                -- total_orders, total_spent는 여전히 주의 필요 (RPC 또는 원자적 업데이트 권장)
                last_order_at = GREATEST(customers.last_order_at, EXCLUDED.last_order_at),
                updated_at = EXCLUDED.updated_at
             `,
            [
              // 전달되는 값 배열 순서 확인 (총 12개)
              customer.customer_id,
              customer.user_id,
              customer.band_number,
              customer.name,
              customer.total_orders || 1,
              customer.total_spent || 0,
              customer.first_order_at,
              customer.last_order_at,
              customer.notes,
              customer.created_at,
              customer.updated_at,
            ]
          );
        }
        console.log(`${customers.length} 고객 정보 처리됨.`);
      }

      // 2. 게시물 정보 Upsert
      if (posts.length > 0) {
        // ⚠️ 중요: 실제 posts 테이블/컬럼명으로 수정, JSON/JSONB 타입 컬럼 처리 주의
        for (const post of posts) {
          await connection.queryObject(
            `INSERT INTO posts (post_id, user_id, band_number, post_number, band_post_url, author_name, title, content, posted_at, comment_count, view_count, image_urls, is_product, status, crawled_at, updated_at, item_list)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17::jsonb)
                ON CONFLICT (post_id) DO UPDATE SET
                  band_number = EXCLUDED.band_number, post_number = EXCLUDED.post_number, band_post_url = EXCLUDED.band_post_url, author_name = EXCLUDED.author_name,
                  title = EXCLUDED.title, content = EXCLUDED.content, posted_at = EXCLUDED.posted_at,
                  comment_count = EXCLUDED.comment_count,
                  view_count = EXCLUDED.view_count, image_urls = EXCLUDED.image_urls, is_product = EXCLUDED.is_product, status = EXCLUDED.status,
                  crawled_at = EXCLUDED.crawled_at, updated_at = EXCLUDED.updated_at, item_list = EXCLUDED.item_list
               `,
            [
              post.post_id,
              post.user_id,
              post.band_number,
              post.post_number,
              post.band_post_url,
              post.author_name,
              post.title,
              post.content,
              post.posted_at,
              post.comment_count,
              post.view_count,
              JSON.stringify(post.image_urls || []),
              post.is_product,
              post.status,
              post.crawled_at,
              post.updated_at,
              JSON.stringify(post.item_list || []), // item_list JSON 문자열화
            ]
          );
        }
        console.log(`${posts.length} 게시물 정보 처리됨.`);
      }

      // 3. 상품 정보 Upsert
      if (products.length > 0) {
        for (const product of products) {
          // *** stock_quantity 컬럼 추가 ***
          await connection.queryObject(
            // 컬럼 목록에 stock_quantity 추가 (총 21개 컬럼)
            `INSERT INTO products (
                product_id, user_id, post_id, item_number, title, content, base_price, 
                price_options, quantity, quantity_text, category, tags, features, status,
                pickup_info, pickup_date, pickup_type, order_summary, created_at, updated_at,
                stock_quantity,band_post_url ,band_number, post_number ,barcode
             )
             -- 플레이스홀더도 21개로 증가
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17, $18::jsonb, $19, $20, $21 ,$22, $23, $24, $25)
             ON CONFLICT (product_id) DO UPDATE SET
               post_id = EXCLUDED.post_id, item_number = EXCLUDED.item_number, title = EXCLUDED.title,
               content = EXCLUDED.content, base_price = EXCLUDED.base_price, price_options = EXCLUDED.price_options,
               quantity = EXCLUDED.quantity, quantity_text = EXCLUDED.quantity_text, category = EXCLUDED.category, tags = EXCLUDED.tags,
               features = EXCLUDED.features, status = EXCLUDED.status, pickup_info = EXCLUDED.pickup_info, pickup_date = EXCLUDED.pickup_date,
               pickup_type = EXCLUDED.pickup_type, order_summary = EXCLUDED.order_summary, updated_at = EXCLUDED.updated_at,
               stock_quantity = EXCLUDED.stock_quantity, band_post_url = EXCLUDED.band_post_url, band_number = EXCLUDED.band_number, post_number = EXCLUDED.post_number,
               barcode = EXCLUDED.barcode
            `,
            [
              // 값 배열도 21개로 증가 (마지막에 stock_quantity 추가)
              product.product_id, // $1
              product.user_id, // $2
              product.post_id, // $3
              product.item_number, // $4
              product.title, // $5
              product.content, // $6
              product.base_price, // $7
              JSON.stringify(product.price_options || []), // $8
              product.quantity, // $9
              product.quantity_text, // $10
              product.category, // $11
              product.tags || [], // $12
              JSON.stringify(product.features || []), // $13
              product.status, // $14
              product.pickup_info, // $15
              product.pickup_date, // $16
              product.pickup_type, // $17
              JSON.stringify(product.order_summary || {}), // $18
              product.created_at, // $19
              product.updated_at, // $20
              product.stock_quantity, // $21 <<< stock_quantity 값 추가 (null일 수도 있음)
              product.band_post_url,
              product.band_number,
              product.post_number,
              product.barcode,
            ]
          );
        }
        console.log(
          `${products.length} 상품 정보 처리됨 (stock_quantity 포함).`
        );
      }

      // 4. 주문 정보 Upsert
      if (orders.length > 0) {
        console.log(`[Order Loop] ${orders.length}개의 주문 처리 시작...`);
        for (const order of orders) {
          try {
            // 필수 값 검증 로직 추가 권장 (예: order.product_id, order.quantity 등)
            if (!order.order_id || !order.user_id /*...*/) {
              console.error(
                `[Order Loop] 필수 값 누락으로 주문 처리 건너뜀: order_id=${order.order_id}`
              );
              continue; // 다음 주문으로
            }

            console.log(
              `[Order Loop] 주문 처리 시도: order_id=${order.order_id}, product_id=${order.product_id}, customer_id=${order.customer_id}, quantity=${order.quantity}, customer_id=${order.customer_id}, customer_name=${order.customer_name}`
            );

            // --- VVV SQL 쿼리 및 값 배열 수정 VVV ---
            // 18개 컬럼, 18개 플레이스홀더, 올바른 순서, 올바른 ON CONFLICT 구문
            await connection.queryObject(
              `INSERT INTO orders (
                  order_id,                  -- $1
                  user_id,                   -- $2
                  product_id,                -- $3
                  post_number,               -- $4
                  customer_id,               -- $5
                  quantity,                  -- $6
                  price,                     -- $7  (옵션1: 단가)
                  total_amount,              -- $8  (옵션1: 첫 항목 총액)
                  price_option_description,  -- $9
                  comment,                   -- $10
                  status,                    -- $11
                  ordered_at,                -- $12
                  band_comment_id,           -- $13
                  band_comment_url,          -- $14
                  created_at,                -- $15
                  updated_at,                -- $16
                  item_number,               -- $17 (추가됨)
                  band_number,                -- $18 (band_number 추가 가정, 없다면 제거하고 $17까지)
                  customer_name,              -- $19 (추가됨)
                  sub_status                 -- $20 <<<--- 추가됨
                  -- extracted_items_details, is_ambiguous 등 추가 컬럼 필요 시 여기에 추가하고 값 배열에도 반영
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) -- 20개
                ON CONFLICT (order_id) DO UPDATE SET
                  user_id = EXCLUDED.user_id,
                  product_id = EXCLUDED.product_id,
                  post_number = EXCLUDED.post_number,
                  customer_id = EXCLUDED.customer_id,
                  quantity = EXCLUDED.quantity,
                  price = EXCLUDED.price,                     -- 업데이트 대상
                  total_amount = EXCLUDED.total_amount,       -- 업데이트 대상
                  price_option_description = EXCLUDED.price_option_description,
                  comment = EXCLUDED.comment,
                  status = EXCLUDED.status,
                  ordered_at = EXCLUDED.ordered_at,
                  band_comment_id = EXCLUDED.band_comment_id,
                  band_comment_url = EXCLUDED.band_comment_url,
                  updated_at = EXCLUDED.updated_at,           -- 업데이트 시간 갱신 필수
                  item_number = EXCLUDED.item_number,         -- 수정됨: .item 제거
                  band_number = EXCLUDED.band_number,          -- 추가됨 (마지막 콤마 없음)
                  customer_name = EXCLUDED.customer_name,     -- 추가됨
                  sub_status = EXCLUDED.sub_status           -- 추가됨
                  -- is_ambiguous = EXCLUDED.is_ambiguous 등 업데이트할 컬럼 추가
               `, // <-- 쿼리 문자열 끝
              [
                // 값 배열 (18개, 위 INSERT 컬럼 순서와 정확히 일치해야 함)
                order.order_id, // $1
                order.user_id, // $2
                order.product_id, // $3
                order.post_number, // $4
                order.customer_id, // $5
                order.quantity, // $6
                order.price, // $7 (옵션1: 단가)
                order.total_amount, // $8 (옵션1: 첫 항목 총액)
                order.price_option_description, // $9
                order.comment, // $10
                order.status, // $11
                order.ordered_at, // $12
                order.band_comment_id, // $13
                order.band_comment_url, // $14
                order.created_at, // $15
                order.updated_at, // $16
                order.item_number, // $17 (추가됨)
                order.band_number, // $18 (추가됨, 없다면 제거)
                order.customer_name, // $19 (추가됨)
                order.sub_status, // $20 (추가됨)
                // order.extracted_items_details, order.is_ambiguous 등 추가 컬럼 값
              ]
            );
            // --- ^^^ SQL 쿼리 및 값 배열 수정 완료 ^^^ ---

            console.log(`[Order Loop] 주문 성공: order_id=${order.order_id}`);
          } catch (orderError) {
            console.error(
              `[Order Loop] 주문 처리 중 오류 발생 (order_id: ${order.order_id}):`,
              orderError.message
              // 더 자세한 디버깅 위해 order 객체 로깅 추가 가능
              // JSON.stringify(order)
            );
            // 트랜잭션 롤백 필요 시 오류 다시 throw
            // throw orderError;
          }
        }
        console.log(`[Order Loop] ${orders.length}개 주문 처리 완료 시도.`);
      } else {
        console.log("[Order Loop] 처리할 주문 데이터 없음.");
      }

      console.log("===> orders upsert 완료, user update 진입 전");
      console.log(
        `[User Update] 사용자 ${userId}의 last_crawl_at 업데이트 시도...`
      );

      // --- VVV 사용자 last_crawl_at 업데이트 로직 추가 VVV ---
      console.log(
        `[User Update] 사용자 ${userId}의 last_crawl_at 업데이트 시도...`
      );
      const now = new Date().toISOString();
      try {
        // users 테이블의 기본 키 컬럼명이 'user_id'라고 가정
        const updateResult = await connection.queryObject(
          `UPDATE users
           SET
             last_crawl_at = $1,
             updated_at = $2  -- 일반 updated_at도 함께 갱신
           WHERE
             user_id = $3;`,
          [
            now, // $1: 현재 시각
            now, // $2: 현재 시각
            userId, // $3: 업데이트할 사용자 ID
          ]
        );
        // rowCount를 확인하여 실제로 업데이트가 발생했는지 확인 가능 (선택 사항)
        if (updateResult.rowCount && updateResult.rowCount > 0) {
          console.log(
            `[User Update] 사용자 ${userId}의 last_crawl_at 업데이트 성공.`
          );
        } else {
          console.warn(
            `[User Update] 사용자 ${userId}를 찾을 수 없거나 업데이트되지 않았습니다.`
          );
          // 사용자를 찾지 못하는 경우, 심각한 문제일 수 있으므로 오류 처리 필요 가능성 있음
        }
      } catch (userUpdateError) {
        console.error(
          `[User Update] 사용자 ${userId} 업데이트 중 오류: ${userUpdateError.message}`
        );
        // 이 오류 발생 시 트랜잭션 롤백을 위해 에러를 다시 throw 하는 것이 좋음
        throw userUpdateError;
      }
      // --- ^^^ 사용자 last_crawl_at 업데이트 로직 완료 ^^^ ---

      // =============================================
      // === 트랜잭션 커밋 ===
      // =============================================
      await connection.queryObject("COMMIT");
      console.log("트랜잭션 커밋 성공.");

      // 성공 응답 반환
      return new Response(
        JSON.stringify({ message: "데이터가 성공적으로 저장되었습니다." }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    } catch (dbError) {
      // =============================================
      // === 오류 발생 시 롤백 ===
      // =============================================
      console.error("데이터베이스 오류 발생, 트랜잭션 롤백:", dbError);
      try {
        await connection.queryObject("ROLLBACK");
        console.log("트랜잭션 롤백 완료.");
      } catch (rollbackError) {
        console.error("롤백 중 오류 발생:", rollbackError);
      }
      // 오류 응답 반환
      return new Response(
        JSON.stringify({
          error: "데이터베이스 처리 중 오류 발생",
          details: dbError.message,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500, // 서버 내부 오류
        }
      );
    } finally {
      // 데이터베이스 연결 반환
      try {
        connection.release();
        console.log("데이터베이스 연결 반환됨.");
      } catch (releaseError) {
        console.error("연결 반환 중 오류 발생:", releaseError);
      }
    }
  } catch (requestError) {
    console.error("요청 처리 오류:", requestError);
    // 요청 처리 중 오류 (예: JSON 파싱 실패)
    return new Response(
      JSON.stringify({
        error: "잘못된 요청 형식",
        details: requestError.message,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400, // 잘못된 요청
      }
    );
  }
});
// IGNORE_WHEN_COPYING_START
// content_copy
// download
// Use code with caution.
// TypeScript
// IGNORE_WHEN_COPYING_END

// index.ts 코드 수정 시 핵심 확인 사항:

// 테이블 및 컬럼 이름: 코드 내의 customers, posts, products, orders 테이블 이름과 그 안의 모든 컬럼 이름(customer_id, post_id, product_id, order_id, item_number, item_list, image_urls, price_options, order_summary 등)을 실제 Supabase 데이터베이스 스키마와 정확히 일치시켜야 합니다.

// 데이터 타입 처리:

// JSON 또는 JSONB 타입 컬럼(image_urls, item_list, price_options, order_summary, tags, features)에 데이터를 넣을 때는 JSON.stringify()를 사용하여 문자열로 변환해야 할 수 있습니다. SQL 쿼리 내에서 ::jsonb 캐스팅을 사용하여 타입 변환을 명시하는 것이 좋습니다.

// 날짜/타임스탬프 컬럼(posted_at, created_at, updated_at, ordered_at, pickup_date, first_order_at, last_order_at)은 ISO 8601 형식의 문자열로 전달해야 합니다.

// 숫자 타입 컬럼(band_number, post_number, item_number, comment_count, view_count, quantity, base_price, price_per_unit, total_amount)은 숫자 형태로 전달되어야 합니다.

// ON CONFLICT 로직 (Upsert):

// ON CONFLICT (primary_key_column) 부분은 각 테이블의 기본 키 컬럼 이름으로 지정해야 합니다.

// DO UPDATE SET ... 부분은 기존 데이터가 있을 때 어떤 컬럼들을 업데이트할지 결정합니다. EXCLUDED.column_name은 새로 삽입하려던 데이터의 값을 의미합니다.

// 고객 집계 (⚠️ 중요): customers 테이블의 total_orders, total_spent처럼 누적되어야 하는 값은 예시처럼 단순히 EXCLUDED 값으로 덮어쓰면 안 됩니다. 이 부분은 별도의 Supabase Database Function (RPC)을 만들어 호출하거나, 원자적 UPDATE 구문을 사용하는 등 동시성을 고려한 방식으로 반드시 수정해야 합니다. (예: UPDATE customers SET total_orders = total_orders + 1 WHERE customer_id = $1)

// 오류 처리: 현재는 기본적인 오류 로깅과 롤백만 구현되어 있습니다. 어떤 유형의 오류가 발생했는지 더 자세히 로깅하거나, 특정 오류에 따라 다른 처리를 하도록 로직을 추가할 수 있습니다.

// 이 index.ts 파일을 신중하게 검토하고 본인의 환경에 맞게 수정한 후, 다음 단계인 환경 변수 설정 및 배포를 진행하시면 됩니다.
