

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pgsodium";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."create_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- 신규 주문 알림
  IF TG_TABLE_NAME = 'orders' AND TG_OP = 'INSERT' THEN
    INSERT INTO notifications (
      user_id, band_id, type, title, message, related_id, related_type
    )
    VALUES (
      NEW.user_id, NEW.band_id, 'new_order', 
      '새로운 주문',
      NEW.customer_name || '님이 ' || (SELECT title FROM products WHERE product_id = NEW.product_id) || ' ' || NEW.quantity || '개를 주문했습니다.',
      NEW.order_id, 'order'
    );
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_notification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_order_history"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO order_history (order_id, status, timestamp, note)
  VALUES (NEW.order_id, NEW.status, NOW(), '주문 생성');
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_order_history"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_unique_post_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.unique_post_id := NEW.band_id || '_' || NEW.band_post_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_unique_post_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_order_stats_by_date_range"("p_user_id" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) RETURNS TABLE("total_orders_count" bigint, "completed_orders_count" bigint, "pending_receipt_orders_count" bigint, "total_estimated_revenue" numeric, "total_confirmed_revenue" numeric)
    LANGUAGE "sql" STABLE
    AS $$
  SELECT
      -- 총 주문 건수 ('주문취소' 제외)
      count(CASE WHEN status <> '주문취소' THEN 1 END)::bigint AS total_orders_count,

      -- 수령완료 건수
      count(CASE WHEN status = '수령완료' THEN 1 END)::bigint AS completed_orders_count,

      -- '미수령' 상태 주문 건수 계산 추가
      -- ⚠️ 중요: 실제 DB의 orders 테이블 status 컬럼에서 '미수령' 상태를 나타내는 정확한 문자열 값으로 변경하세요!
      count(CASE WHEN status = '미수령' THEN 1 END)::bigint AS pending_receipt_orders_count,

      -- 예상 매출 ('주문취소' 제외, NULL은 0으로 처리)
      sum(CASE WHEN status <> '주문취소' THEN COALESCE(total_amount, 0) ELSE 0 END)::numeric AS total_estimated_revenue,

      -- 실 매출 ('수령완료', NULL은 0으로 처리)
      sum(CASE WHEN status = '수령완료' THEN COALESCE(total_amount, 0) ELSE 0 END)::numeric AS total_confirmed_revenue

  -- ⚠️ 중요: 실제 사용하는 테이블/컬럼 이름 확인 (public.orders, user_id, ordered_at, status, total_amount)
  FROM public.orders
  WHERE
    user_id = p_user_id
    AND ordered_at >= p_start_date
    AND ordered_at <= p_end_date;
$$;


ALTER FUNCTION "public"."get_order_stats_by_date_range"("p_user_id" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_order_stats_by_date_range"("p_user_id" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_status_filter" "text" DEFAULT NULL::"text", "p_sub_status_filter" "text" DEFAULT NULL::"text", "p_search_term" "text" DEFAULT NULL::"text") RETURNS TABLE("total_orders_count" bigint, "completed_orders_count" bigint, "pending_receipt_orders_count" bigint, "total_estimated_revenue" numeric, "total_confirmed_revenue" numeric)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- 임시 테이블이나 CTE를 사용하여 필터링된 주문을 먼저 선택 (선택적이지만 가독성/유지보수에 도움)
  RETURN QUERY
  WITH filtered_orders AS (
    SELECT *
    FROM orders_with_products o -- 최신 뷰 사용 (sub_status 포함)
    WHERE
        o.user_id = p_user_id
        AND o.ordered_at >= p_start_date
        AND o.ordered_at <= p_end_date
        -- <<< WHERE 절에 모든 필터 조건 통합 >>>
        AND (p_status_filter IS NULL OR p_status_filter = 'all' OR o.status = p_status_filter)
        AND (
              p_sub_status_filter IS NULL
              OR p_sub_status_filter = 'all'
              OR (p_sub_status_filter = 'none' AND o.sub_status IS NULL)
              OR (p_sub_status_filter <> 'none' AND o.sub_status = p_sub_status_filter)
            )
        AND (p_search_term IS NULL OR (
               o.customer_name ILIKE p_search_term
            OR o.product_title ILIKE p_search_term
            OR o.product_barcode ILIKE p_search_term
        ))
  )
  -- 필터링된 주문(filtered_orders)을 기반으로 최종 통계 집계
  SELECT
      COUNT(fo.order_id) AS total_orders_count,
      COUNT(fo.order_id) FILTER (WHERE fo.status = '수령완료') AS completed_orders_count,
      COUNT(fo.order_id) FILTER (WHERE fo.status = '주문완료' AND fo.sub_status = '미수령') AS pending_receipt_orders_count,
      COALESCE(SUM(fo.total_amount) FILTER (WHERE fo.status <> '주문취소'), 0) AS total_estimated_revenue,
      COALESCE(SUM(fo.total_amount) FILTER (WHERE fo.status IN ('수령완료', '결제완료')), 0) AS total_confirmed_revenue
  FROM filtered_orders fo; -- <<< FROM 절 변경

END;
$$;


ALTER FUNCTION "public"."get_order_stats_by_date_range"("p_user_id" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_status_filter" "text", "p_sub_status_filter" "text", "p_search_term" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_crawled_data"("products_data" "jsonb", "posts_data" "jsonb", "orders_data" "jsonb", "customers_data" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- 트랜잭션 블록 시작
  BEGIN
    -- 상품 데이터 저장
    IF jsonb_array_length(products_data) > 0 THEN
      INSERT INTO products
      SELECT * FROM jsonb_to_recordset(products_data) AS x(
        user_id uuid,
        title text,
        description text,
        original_content text,
        price integer,
        original_price integer,
        status text,
        band_post_id bigint,
        band_id bigint,
        band_post_url text,
        category text,
        tags jsonb,
        comment_count integer,
        order_summary jsonb,
        created_at timestamp with time zone,
        updated_at timestamp with time zone
      )
      ON CONFLICT (band_id, band_post_id) 
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        original_content = EXCLUDED.original_content,
        price = EXCLUDED.price,
        original_price = EXCLUDED.original_price,
        status = EXCLUDED.status,
        band_post_url = EXCLUDED.band_post_url,
        category = EXCLUDED.category,
        tags = EXCLUDED.tags,
        comment_count = EXCLUDED.comment_count,
        order_summary = EXCLUDED.order_summary,
        updated_at = EXCLUDED.updated_at;
    END IF;

    -- 게시글 데이터 저장
    IF jsonb_array_length(posts_data) > 0 THEN
      INSERT INTO posts
      SELECT * FROM jsonb_to_recordset(posts_data) AS x(
        user_id uuid,
        band_id bigint,
        band_post_id bigint,
        author_name text,
        title text,
        content text,
        posted_at timestamp with time zone,
        comment_count integer,
        view_count integer,
        crawled_at timestamp with time zone,
        is_product boolean,
        band_post_url text,
        media_urls jsonb,
        status text,
        updated_at timestamp with time zone
      )
      ON CONFLICT (band_id, band_post_id) 
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        author_name = EXCLUDED.author_name,
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        posted_at = EXCLUDED.posted_at,
        comment_count = EXCLUDED.comment_count,
        view_count = EXCLUDED.view_count,
        crawled_at = EXCLUDED.crawled_at,
        is_product = EXCLUDED.is_product,
        band_post_url = EXCLUDED.band_post_url,
        media_urls = EXCLUDED.media_urls,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at;
    END IF;

    -- 주문 데이터 저장
    IF jsonb_array_length(orders_data) > 0 THEN
      INSERT INTO orders
      SELECT * FROM jsonb_to_recordset(orders_data) AS x(
        user_id uuid,
        product_id text,
        customer_name text,
        customer_band_id text,
        customer_profile text,
        quantity integer,
        price integer,
        total_amount integer,
        comment text,
        status text,
        ordered_at timestamp with time zone,
        band_comment_id text,
        band_id text,
        band_comment_url text,
        created_at timestamp with time zone,
        updated_at timestamp with time zone
      )
      ON CONFLICT (band_comment_id) 
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        product_id = EXCLUDED.product_id,
        customer_name = EXCLUDED.customer_name,
        customer_band_id = EXCLUDED.customer_band_id,
        customer_profile = EXCLUDED.customer_profile,
        quantity = EXCLUDED.quantity,
        price = EXCLUDED.price,
        total_amount = EXCLUDED.total_amount,
        comment = EXCLUDED.comment,
        status = EXCLUDED.status,
        ordered_at = EXCLUDED.ordered_at,
        band_id = EXCLUDED.band_id,
        band_comment_url = EXCLUDED.band_comment_url,
        updated_at = EXCLUDED.updated_at;
    END IF;

    -- 고객 데이터 저장
    IF jsonb_array_length(customers_data) > 0 THEN
      INSERT INTO customers
      SELECT * FROM jsonb_to_recordset(customers_data) AS x(
        user_id uuid,
        name text,
        band_user_id text,
        band_id text,
        total_orders integer,
        first_order_at timestamp with time zone,
        last_order_at timestamp with time zone,
        created_at timestamp with time zone,
        updated_at timestamp with time zone
      )
      ON CONFLICT (user_id, band_user_id) 
      DO UPDATE SET
        name = EXCLUDED.name,
        band_id = EXCLUDED.band_id,
        total_orders = customers.total_orders + 1,
        last_order_at = EXCLUDED.last_order_at,
        updated_at = EXCLUDED.updated_at;
    END IF;

    -- 모든 작업이 성공적으로 완료되면 커밋
    -- 실패 시 자동 롤백됩니다.
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'Error saving data: %', SQLERRM;
  END;
END;
$$;


ALTER FUNCTION "public"."save_crawled_data"("products_data" "jsonb", "posts_data" "jsonb", "orders_data" "jsonb", "customers_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_crawled_orders"("orders_data" "jsonb"[]) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO orders (
    order_id, 
    product_id, 
    band_post_id, 
    band_id, 
    user_id, 
    customer_name, 
    quantity, 
    price, 
    total_amount, 
    comment, 
    status, 
    ordered_at, 
    band_comment_id
  )
  SELECT 
    (order_data->>'order_id')::UUID,
    (order_data->>'product_id')::UUID,
    order_data->>'band_post_id',
    order_data->>'band_id',
    (order_data->>'user_id')::UUID,
    order_data->>'customer_name',
    (order_data->>'quantity')::INTEGER,
    (order_data->>'price')::DECIMAL,
    (order_data->>'total_amount')::DECIMAL,
    order_data->>'comment',
    order_data->>'status',
    (order_data->>'ordered_at')::TIMESTAMP,
    order_data->>'band_comment_id'
  FROM unnest(orders_data) AS order_data
  ON CONFLICT (band_comment_id) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."save_crawled_orders"("orders_data" "jsonb"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_customer_order_stats"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  cust_id UUID;
BEGIN
  -- 고객 ID 찾기 또는 생성
  SELECT customer_id INTO cust_id
  FROM customers
  WHERE user_id = NEW.user_id AND band_user_id = NEW.customer_band_id;
  
  IF cust_id IS NULL THEN
    INSERT INTO customers (
      user_id, band_id, name, band_user_id, profile_image, 
      first_order_at, last_order_at, total_orders, total_spent
    )
    VALUES (
      NEW.user_id, NEW.band_id, NEW.customer_name, NEW.customer_band_id, NEW.customer_profile,
      NEW.ordered_at, NEW.ordered_at, 1, NEW.total_amount
    )
    RETURNING customer_id INTO cust_id;
  ELSE
    UPDATE customers
    SET 
      last_order_at = GREATEST(last_order_at, NEW.ordered_at),
      total_orders = total_orders + 1,
      total_spent = total_spent + NEW.total_amount
    WHERE customer_id = cust_id;
  END IF;
  
  -- 최근 주문 추가
  INSERT INTO customer_recent_orders (
    customer_id, order_id, product_name, ordered_at, quantity, amount
  )
  SELECT 
    cust_id, NEW.order_id, p.title, NEW.ordered_at, NEW.quantity, NEW.total_amount
  FROM products p
  WHERE p.product_id = NEW.product_id;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_customer_order_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_order_history"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF OLD.status != NEW.status THEN
    INSERT INTO order_history (order_id, status, timestamp, note)
    VALUES (NEW.order_id, NEW.status, NOW(), '상태 변경: ' || OLD.status || ' → ' || NEW.status);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_order_history"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_product_order_stats"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- 제품의 총 주문 수량과 금액 업데이트
  UPDATE products
  SET 
    total_order_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM orders WHERE product_id = NEW.product_id AND status != 'cancelled'),
    total_order_amount = (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE product_id = NEW.product_id AND status != 'cancelled'),
    order_summary = jsonb_build_object(
      'totalOrders', (SELECT COUNT(*) FROM orders WHERE product_id = NEW.product_id),
      'pendingOrders', (SELECT COUNT(*) FROM orders WHERE product_id = NEW.product_id AND status IN ('new', 'processing')),
      'confirmedOrders', (SELECT COUNT(*) FROM orders WHERE product_id = NEW.product_id AND status = 'confirmed')
    ),
    updated_at = NOW()
  WHERE product_id = NEW.product_id;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_product_order_stats"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."barcodes" (
    "barcode_id" "text" NOT NULL,
    "user_id" "text",
    "band_id" "text",
    "barcode" "text",
    "product_id" "text",
    "product_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "last_used_at" timestamp with time zone,
    "scan_count" integer
);


ALTER TABLE "public"."barcodes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crawl_history" (
    "crawl_id" "text" NOT NULL,
    "user_id" "text",
    "timestamp" timestamp with time zone DEFAULT "now"(),
    "status" "text",
    "new_posts" integer,
    "new_comments" integer,
    "error_message" "text",
    "error_stack" "text",
    "processing_time" integer,
    "total_posts_processed" integer,
    "total_comments_processed" integer
);


ALTER TABLE "public"."crawl_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crawl_tasks" (
    "task_id" "text" NOT NULL,
    "user_id" "text",
    "band_number" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "message" "text",
    "progress" integer DEFAULT 0,
    "start_time" timestamp with time zone DEFAULT "now"(),
    "end_time" timestamp with time zone,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "params" "jsonb"
);


ALTER TABLE "public"."crawl_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_recent_orders" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "product_name" character varying(255),
    "ordered_at" timestamp with time zone,
    "quantity" integer,
    "amount" numeric(12,2)
);


ALTER TABLE "public"."customer_recent_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "customer_id" "text" NOT NULL,
    "user_id" "text",
    "band_number" "text",
    "name" "text",
    "band_user_id" "text",
    "profile_image" "text",
    "first_order_at" timestamp with time zone,
    "last_order_at" timestamp with time zone,
    "total_orders" integer,
    "total_spent" numeric,
    "tags" "text"[],
    "notes" "text",
    "recent_orders" "jsonb",
    "contact" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "notification_id" "text" NOT NULL,
    "user_id" "text",
    "band_id" "text",
    "type" "text",
    "title" "text",
    "message" "text",
    "related_id" "text",
    "related_type" "text",
    "is_read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "read_at" timestamp with time zone,
    "action_url" "text",
    "action_type" "text"
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_history" (
    "history_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "status" character varying(20) NOT NULL,
    "timestamp" timestamp with time zone DEFAULT "now"(),
    "note" "text"
);


ALTER TABLE "public"."order_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "order_id" "text" NOT NULL,
    "user_id" "text",
    "product_id" "text",
    "post_number" "text",
    "band_number" "text",
    "customer_name" "text",
    "customer_band_id" "text",
    "customer_profile" "text",
    "quantity" integer,
    "price" numeric,
    "total_amount" numeric,
    "comment" "text",
    "status" "text",
    "ordered_at" timestamp with time zone,
    "confirmed_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "band_comment_id" "text",
    "band_comment_url" "text",
    "admin_note" "text",
    "updated_at" timestamp with time zone,
    "history" "jsonb",
    "canceled_at" timestamp with time zone,
    "price_option_used" "text" DEFAULT '기본가'::"text",
    "content" "text",
    "customer_id" "text",
    "price_option_description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "price_per_unit" "text",
    "item_number" numeric,
    "commented_at" timestamp with time zone,
    "product_name" "text",
    "paid_at" timestamp with time zone,
    "sub_status" character varying(50) DEFAULT NULL::character varying
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "product_id" "text" NOT NULL,
    "user_id" "text",
    "band_number" "text",
    "title" "text",
    "content" "text",
    "base_price" numeric,
    "quantity" integer,
    "category" "text",
    "tags" "text"[],
    "status" "text",
    "expire_date" timestamp with time zone,
    "barcode" "text",
    "product_code" "text",
    "post_id" "text",
    "band_post_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "total_order_quantity" integer,
    "total_order_amount" numeric,
    "order_summary" "jsonb",
    "comment_count" numeric,
    "price_options" "jsonb" DEFAULT '[]'::"jsonb",
    "features" "jsonb" DEFAULT '[]'::"jsonb",
    "deliveryinfo" character varying(255),
    "deliverydate" timestamp with time zone,
    "deliverytype" character varying(50),
    "pickup_info" character varying(255),
    "pickup_date" timestamp with time zone,
    "pickup_type" character varying(50),
    "quantity_text" "text",
    "original_product_id" "text",
    "is_multiple_product" boolean DEFAULT false,
    "product_index" integer DEFAULT 0,
    "item_number" numeric,
    "post_number" "text",
    "stock_quantity" bigint,
    "memo" "text",
    "is_closed" boolean DEFAULT false NOT NULL,
    "last_comment_at" timestamp with time zone
);


ALTER TABLE "public"."products" OWNER TO "postgres";


COMMENT ON COLUMN "public"."products"."base_price" IS '기본 가격 (가장 저렴한 옵션의 가격)';



COMMENT ON COLUMN "public"."products"."quantity" IS '상품 수량/용량 정보 (예: 400g, 10개입)';



COMMENT ON COLUMN "public"."products"."price_options" IS '가격 옵션 배열 [{ quantity, price, description }]';



COMMENT ON COLUMN "public"."products"."features" IS '상품 특징 정보 배열';



COMMENT ON COLUMN "public"."products"."deliveryinfo" IS '배송/수령 정보 원문';



COMMENT ON COLUMN "public"."products"."deliverydate" IS '배송/수령 예정 날짜';



COMMENT ON COLUMN "public"."products"."deliverytype" IS '배송/수령 유형 (배송, 수령, 픽업 등)';



COMMENT ON COLUMN "public"."products"."pickup_info" IS '픽업/수령 정보 원문';



COMMENT ON COLUMN "public"."products"."pickup_date" IS '픽업/수령 예정 날짜';



COMMENT ON COLUMN "public"."products"."pickup_type" IS '픽업/수령 유형 (수령, 픽업, 도착 등)';



COMMENT ON COLUMN "public"."products"."quantity_text" IS '용량/개수 정보 텍스트 (예: 400g, 10개입)';



CREATE OR REPLACE VIEW "public"."orders_with_products" AS
 SELECT "o"."order_id",
    "o"."user_id",
    "o"."product_id",
    "o"."post_number",
    "o"."band_number",
    "o"."customer_name",
    "o"."customer_band_id",
    "o"."customer_profile",
    "o"."quantity",
    "o"."price",
    "o"."total_amount",
    "o"."comment",
    "o"."status",
    "o"."ordered_at",
    "o"."confirmed_at",
    "o"."completed_at",
    "o"."band_comment_id",
    "o"."band_comment_url",
    "o"."admin_note",
    "o"."updated_at",
    "o"."history",
    "o"."canceled_at",
    "o"."price_option_used",
    "o"."content",
    "o"."customer_id",
    "o"."price_option_description",
    "o"."created_at",
    "o"."price_per_unit",
    "o"."item_number",
    "o"."commented_at",
    "o"."product_name",
    "o"."paid_at",
    "o"."sub_status",
    "p"."title" AS "product_title",
    "p"."barcode" AS "product_barcode",
    "p"."pickup_date" AS "product_pickup_date"
   FROM ("public"."orders" "o"
     LEFT JOIN "public"."products" "p" ON (("o"."product_id" = "p"."product_id")));


ALTER TABLE "public"."orders_with_products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."posts" (
    "post_id" "text" NOT NULL,
    "user_id" "text",
    "band_number" "text",
    "unique_post_id" "text",
    "band_post_url" "text",
    "author_name" "text",
    "title" "text",
    "author_id" "text",
    "author_profile" "text",
    "content" "text",
    "posted_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "crawled_at" timestamp with time zone,
    "comment_count" integer,
    "view_count" integer,
    "like_count" integer,
    "product_id" "text",
    "is_product" boolean,
    "tags" "jsonb"[],
    "status" "text",
    "post_number" "text",
    "products_data" "jsonb" DEFAULT '{"product_ids": [], "original_product_ids": [], "has_multiple_products": false}'::"jsonb",
    "image_urls" "jsonb",
    "item_list" "jsonb"
);


ALTER TABLE "public"."posts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stats" (
    "stat_id" "text" NOT NULL,
    "user_id" "text",
    "date" "text",
    "daily_sales" numeric,
    "daily_orders" integer,
    "new_customers" integer,
    "product_stats" "jsonb",
    "hourly_stats" "jsonb"
);


ALTER TABLE "public"."stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "user_id" "text" NOT NULL,
    "login_id" "text" NOT NULL,
    "login_password" "text",
    "naver_id" "text",
    "naver_password" "text",
    "is_active" boolean DEFAULT true,
    "store_name" "text",
    "store_address" "text",
    "owner_name" "text",
    "phone_number" "text",
    "band_url" "text",
    "band_number" "text",
    "role" "text",
    "settings" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "last_login_at" timestamp with time zone,
    "last_crawl_at" timestamp with time zone,
    "product_count" integer,
    "subscription" "jsonb",
    "auto_crawl" boolean DEFAULT false,
    "crawl_interval" integer DEFAULT 10,
    "updated_at" timestamp with time zone,
    "job_id" character varying(100) DEFAULT NULL::character varying,
    "excluded_customers" "jsonb",
    "cookies" "jsonb",
    "cookies_updated_at" timestamp with time zone,
    "naver_login_status" "text",
    "last_crawled_post_id" integer DEFAULT 0 NOT NULL,
    "auto_barcode_generation" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON COLUMN "public"."users"."auto_crawl" IS '자동 크롤링 활성화 여부';



COMMENT ON COLUMN "public"."users"."crawl_interval" IS '자동 크롤링 간격 (분)';



COMMENT ON COLUMN "public"."users"."job_id" IS '자동 크롤링 작업 ID (스케줄러에서 관리하는 고유 ID)';



ALTER TABLE ONLY "public"."barcodes"
    ADD CONSTRAINT "barcodes_pkey" PRIMARY KEY ("barcode_id");



ALTER TABLE ONLY "public"."crawl_history"
    ADD CONSTRAINT "crawl_history_pkey" PRIMARY KEY ("crawl_id");



ALTER TABLE ONLY "public"."crawl_tasks"
    ADD CONSTRAINT "crawl_tasks_pkey" PRIMARY KEY ("task_id");



ALTER TABLE ONLY "public"."customer_recent_orders"
    ADD CONSTRAINT "customer_recent_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("customer_id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_user_band_user_unique" UNIQUE ("user_id", "band_user_id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("notification_id");



ALTER TABLE ONLY "public"."order_history"
    ADD CONSTRAINT "order_history_pkey" PRIMARY KEY ("history_id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("order_id");



ALTER TABLE ONLY "public"."posts"
    ADD CONSTRAINT "posts_pkey" PRIMARY KEY ("post_id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("product_id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_product_id_key" UNIQUE ("product_id");



ALTER TABLE ONLY "public"."stats"
    ADD CONSTRAINT "stats_pkey" PRIMARY KEY ("stat_id");



ALTER TABLE ONLY "public"."posts"
    ADD CONSTRAINT "unique_band_post" UNIQUE ("band_number", "unique_post_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("user_id");



CREATE INDEX "idx_customer_recent_orders_customer_id" ON "public"."customer_recent_orders" USING "btree" ("customer_id");



CREATE INDEX "idx_order_history_order_id" ON "public"."order_history" USING "btree" ("order_id");



CREATE INDEX "idx_orders_sub_status" ON "public"."orders" USING "btree" ("sub_status");



CREATE INDEX "idx_orders_user_id_ordered_at" ON "public"."orders" USING "btree" ("user_id", "ordered_at");



CREATE INDEX "idx_products_baseprice" ON "public"."products" USING "btree" ("base_price");



CREATE INDEX "idx_products_deliverydate" ON "public"."products" USING "btree" ("deliverydate");



CREATE INDEX "idx_products_original_product_id" ON "public"."products" USING "btree" ("original_product_id");



CREATE INDEX "idx_users_auto_crawl" ON "public"."users" USING "btree" ("auto_crawl");



CREATE INDEX "idx_users_job_id" ON "public"."users" USING "btree" ("job_id");



ALTER TABLE ONLY "public"."barcodes"
    ADD CONSTRAINT "barcodes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("product_id");



ALTER TABLE ONLY "public"."barcodes"
    ADD CONSTRAINT "barcodes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."crawl_history"
    ADD CONSTRAINT "crawl_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."crawl_tasks"
    ADD CONSTRAINT "crawl_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("product_id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."posts"
    ADD CONSTRAINT "posts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("product_id");



ALTER TABLE ONLY "public"."posts"
    ADD CONSTRAINT "posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."stats"
    ADD CONSTRAINT "stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id");





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";









































































































































































































GRANT ALL ON FUNCTION "public"."create_notification"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_notification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_notification"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_order_history"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_order_history"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_order_history"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_unique_post_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_unique_post_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_unique_post_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_order_stats_by_date_range"("p_user_id" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_order_stats_by_date_range"("p_user_id" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_order_stats_by_date_range"("p_user_id" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_order_stats_by_date_range"("p_user_id" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_status_filter" "text", "p_sub_status_filter" "text", "p_search_term" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_order_stats_by_date_range"("p_user_id" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_status_filter" "text", "p_sub_status_filter" "text", "p_search_term" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_order_stats_by_date_range"("p_user_id" "text", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_status_filter" "text", "p_sub_status_filter" "text", "p_search_term" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."save_crawled_data"("products_data" "jsonb", "posts_data" "jsonb", "orders_data" "jsonb", "customers_data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."save_crawled_data"("products_data" "jsonb", "posts_data" "jsonb", "orders_data" "jsonb", "customers_data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_crawled_data"("products_data" "jsonb", "posts_data" "jsonb", "orders_data" "jsonb", "customers_data" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."save_crawled_orders"("orders_data" "jsonb"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."save_crawled_orders"("orders_data" "jsonb"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_crawled_orders"("orders_data" "jsonb"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_customer_order_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_customer_order_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer_order_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_order_history"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_order_history"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_order_history"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_product_order_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_product_order_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_product_order_stats"() TO "service_role";
























GRANT ALL ON TABLE "public"."barcodes" TO "anon";
GRANT ALL ON TABLE "public"."barcodes" TO "authenticated";
GRANT ALL ON TABLE "public"."barcodes" TO "service_role";



GRANT ALL ON TABLE "public"."crawl_history" TO "anon";
GRANT ALL ON TABLE "public"."crawl_history" TO "authenticated";
GRANT ALL ON TABLE "public"."crawl_history" TO "service_role";



GRANT ALL ON TABLE "public"."crawl_tasks" TO "anon";
GRANT ALL ON TABLE "public"."crawl_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."crawl_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."customer_recent_orders" TO "anon";
GRANT ALL ON TABLE "public"."customer_recent_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_recent_orders" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."order_history" TO "anon";
GRANT ALL ON TABLE "public"."order_history" TO "authenticated";
GRANT ALL ON TABLE "public"."order_history" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."orders_with_products" TO "anon";
GRANT ALL ON TABLE "public"."orders_with_products" TO "authenticated";
GRANT ALL ON TABLE "public"."orders_with_products" TO "service_role";



GRANT ALL ON TABLE "public"."posts" TO "anon";
GRANT ALL ON TABLE "public"."posts" TO "authenticated";
GRANT ALL ON TABLE "public"."posts" TO "service_role";



GRANT ALL ON TABLE "public"."stats" TO "anon";
GRANT ALL ON TABLE "public"."stats" TO "authenticated";
GRANT ALL ON TABLE "public"."stats" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";






























RESET ALL;
