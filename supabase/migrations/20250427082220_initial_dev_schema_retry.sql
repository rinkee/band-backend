create table "public"."barcodes" (
    "barcode_id" text not null,
    "user_id" text,
    "band_id" text,
    "barcode" text,
    "product_id" text,
    "product_name" text,
    "created_at" timestamp with time zone default now(),
    "last_used_at" timestamp with time zone,
    "scan_count" integer
);


create table "public"."crawl_history" (
    "crawl_id" text not null,
    "user_id" text,
    "timestamp" timestamp with time zone default now(),
    "status" text,
    "new_posts" integer,
    "new_comments" integer,
    "error_message" text,
    "error_stack" text,
    "processing_time" integer,
    "total_posts_processed" integer,
    "total_comments_processed" integer
);


create table "public"."crawl_tasks" (
    "task_id" text not null,
    "user_id" text,
    "band_number" text,
    "status" text not null default 'pending'::text,
    "message" text,
    "progress" integer default 0,
    "start_time" timestamp with time zone default now(),
    "end_time" timestamp with time zone,
    "error_message" text,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now(),
    "params" jsonb
);


create table "public"."customer_recent_orders" (
    "id" uuid not null default uuid_generate_v4(),
    "customer_id" uuid not null,
    "order_id" uuid not null,
    "product_name" character varying(255),
    "ordered_at" timestamp with time zone,
    "quantity" integer,
    "amount" numeric(12,2)
);


create table "public"."customers" (
    "customer_id" text not null,
    "user_id" text,
    "band_number" text,
    "name" text,
    "band_user_id" text,
    "profile_image" text,
    "first_order_at" timestamp with time zone,
    "last_order_at" timestamp with time zone,
    "total_orders" integer,
    "total_spent" numeric,
    "tags" text[],
    "notes" text,
    "recent_orders" jsonb,
    "contact" text,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


create table "public"."notifications" (
    "notification_id" text not null,
    "user_id" text,
    "band_id" text,
    "type" text,
    "title" text,
    "message" text,
    "related_id" text,
    "related_type" text,
    "is_read" boolean default false,
    "created_at" timestamp with time zone default now(),
    "read_at" timestamp with time zone,
    "action_url" text,
    "action_type" text
);


create table "public"."order_history" (
    "history_id" uuid not null default uuid_generate_v4(),
    "order_id" uuid not null,
    "status" character varying(20) not null,
    "timestamp" timestamp with time zone default now(),
    "note" text
);


create table "public"."orders" (
    "order_id" text not null,
    "user_id" text,
    "product_id" text,
    "post_number" text,
    "band_number" text,
    "customer_name" text,
    "customer_band_id" text,
    "customer_profile" text,
    "quantity" integer,
    "price" numeric,
    "total_amount" numeric,
    "comment" text,
    "status" text,
    "ordered_at" timestamp with time zone,
    "confirmed_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "band_comment_id" text,
    "band_comment_url" text,
    "admin_note" text,
    "updated_at" timestamp with time zone,
    "history" jsonb,
    "canceled_at" timestamp with time zone,
    "price_option_used" text default '기본가'::text,
    "content" text,
    "customer_id" text,
    "price_option_description" text,
    "created_at" timestamp with time zone default now(),
    "price_per_unit" text,
    "item_number" numeric,
    "commented_at" timestamp with time zone,
    "product_name" text,
    "paid_at" timestamp with time zone,
    "sub_status" character varying(50) default NULL::character varying
);


create table "public"."posts" (
    "post_id" text not null,
    "user_id" text,
    "band_number" text,
    "unique_post_id" text,
    "band_post_url" text,
    "author_name" text,
    "title" text,
    "author_id" text,
    "author_profile" text,
    "content" text,
    "posted_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "crawled_at" timestamp with time zone,
    "comment_count" integer,
    "view_count" integer,
    "like_count" integer,
    "product_id" text,
    "is_product" boolean,
    "tags" jsonb[],
    "status" text,
    "post_number" text,
    "products_data" jsonb default '{"product_ids": [], "original_product_ids": [], "has_multiple_products": false}'::jsonb,
    "image_urls" jsonb,
    "item_list" jsonb
);


create table "public"."products" (
    "product_id" text not null,
    "user_id" text,
    "band_number" text,
    "title" text,
    "content" text,
    "base_price" numeric,
    "quantity" integer,
    "category" text,
    "tags" text[],
    "status" text,
    "expire_date" timestamp with time zone,
    "barcode" text,
    "product_code" text,
    "post_id" text,
    "band_post_url" text,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now(),
    "total_order_quantity" integer,
    "total_order_amount" numeric,
    "order_summary" jsonb,
    "comment_count" numeric,
    "price_options" jsonb default '[]'::jsonb,
    "features" jsonb default '[]'::jsonb,
    "deliveryinfo" character varying(255),
    "deliverydate" timestamp with time zone,
    "deliverytype" character varying(50),
    "pickup_info" character varying(255),
    "pickup_date" timestamp with time zone,
    "pickup_type" character varying(50),
    "quantity_text" text,
    "original_product_id" text,
    "is_multiple_product" boolean default false,
    "product_index" integer default 0,
    "item_number" numeric,
    "post_number" text,
    "stock_quantity" bigint,
    "memo" text,
    "is_closed" boolean not null default false,
    "last_comment_at" timestamp with time zone
);


create table "public"."stats" (
    "stat_id" text not null,
    "user_id" text,
    "date" text,
    "daily_sales" numeric,
    "daily_orders" integer,
    "new_customers" integer,
    "product_stats" jsonb,
    "hourly_stats" jsonb
);


create table "public"."users" (
    "user_id" text not null,
    "login_id" text not null,
    "login_password" text,
    "naver_id" text,
    "naver_password" text,
    "is_active" boolean default true,
    "store_name" text,
    "store_address" text,
    "owner_name" text,
    "phone_number" text,
    "band_url" text,
    "band_number" text,
    "role" text,
    "settings" jsonb,
    "created_at" timestamp with time zone default now(),
    "last_login_at" timestamp with time zone,
    "last_crawl_at" timestamp with time zone,
    "product_count" integer,
    "subscription" jsonb,
    "auto_crawl" boolean default false,
    "crawl_interval" integer default 10,
    "updated_at" timestamp with time zone,
    "job_id" character varying(100) default NULL::character varying,
    "excluded_customers" jsonb,
    "cookies" jsonb,
    "cookies_updated_at" timestamp with time zone,
    "naver_login_status" text,
    "last_crawled_post_id" integer not null default 0,
    "auto_barcode_generation" boolean not null default false
);


CREATE UNIQUE INDEX barcodes_pkey ON public.barcodes USING btree (barcode_id);

CREATE UNIQUE INDEX crawl_history_pkey ON public.crawl_history USING btree (crawl_id);

CREATE UNIQUE INDEX crawl_tasks_pkey ON public.crawl_tasks USING btree (task_id);

CREATE UNIQUE INDEX customer_recent_orders_pkey ON public.customer_recent_orders USING btree (id);

CREATE UNIQUE INDEX customers_pkey ON public.customers USING btree (customer_id);

CREATE UNIQUE INDEX customers_user_band_user_unique ON public.customers USING btree (user_id, band_user_id);

CREATE INDEX idx_customer_recent_orders_customer_id ON public.customer_recent_orders USING btree (customer_id);

CREATE INDEX idx_order_history_order_id ON public.order_history USING btree (order_id);

CREATE INDEX idx_orders_sub_status ON public.orders USING btree (sub_status);

CREATE INDEX idx_orders_user_id_ordered_at ON public.orders USING btree (user_id, ordered_at);

CREATE INDEX idx_products_baseprice ON public.products USING btree (base_price);

CREATE INDEX idx_products_deliverydate ON public.products USING btree (deliverydate);

CREATE INDEX idx_products_original_product_id ON public.products USING btree (original_product_id);

CREATE INDEX idx_users_auto_crawl ON public.users USING btree (auto_crawl);

CREATE INDEX idx_users_job_id ON public.users USING btree (job_id);

CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (notification_id);

CREATE UNIQUE INDEX order_history_pkey ON public.order_history USING btree (history_id);

CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (order_id);

CREATE UNIQUE INDEX posts_pkey ON public.posts USING btree (post_id);

CREATE UNIQUE INDEX products_pkey ON public.products USING btree (product_id);

CREATE UNIQUE INDEX products_product_id_key ON public.products USING btree (product_id);

CREATE UNIQUE INDEX stats_pkey ON public.stats USING btree (stat_id);

CREATE UNIQUE INDEX unique_band_post ON public.posts USING btree (band_number, unique_post_id);

CREATE UNIQUE INDEX users_pkey ON public.users USING btree (user_id);

alter table "public"."barcodes" add constraint "barcodes_pkey" PRIMARY KEY using index "barcodes_pkey";

alter table "public"."crawl_history" add constraint "crawl_history_pkey" PRIMARY KEY using index "crawl_history_pkey";

alter table "public"."crawl_tasks" add constraint "crawl_tasks_pkey" PRIMARY KEY using index "crawl_tasks_pkey";

alter table "public"."customer_recent_orders" add constraint "customer_recent_orders_pkey" PRIMARY KEY using index "customer_recent_orders_pkey";

alter table "public"."customers" add constraint "customers_pkey" PRIMARY KEY using index "customers_pkey";

alter table "public"."notifications" add constraint "notifications_pkey" PRIMARY KEY using index "notifications_pkey";

alter table "public"."order_history" add constraint "order_history_pkey" PRIMARY KEY using index "order_history_pkey";

alter table "public"."orders" add constraint "orders_pkey" PRIMARY KEY using index "orders_pkey";

alter table "public"."posts" add constraint "posts_pkey" PRIMARY KEY using index "posts_pkey";

alter table "public"."products" add constraint "products_pkey" PRIMARY KEY using index "products_pkey";

alter table "public"."stats" add constraint "stats_pkey" PRIMARY KEY using index "stats_pkey";

alter table "public"."users" add constraint "users_pkey" PRIMARY KEY using index "users_pkey";

alter table "public"."barcodes" add constraint "barcodes_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(product_id) not valid;

alter table "public"."barcodes" validate constraint "barcodes_product_id_fkey";

alter table "public"."barcodes" add constraint "barcodes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(user_id) not valid;

alter table "public"."barcodes" validate constraint "barcodes_user_id_fkey";

alter table "public"."crawl_history" add constraint "crawl_history_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(user_id) not valid;

alter table "public"."crawl_history" validate constraint "crawl_history_user_id_fkey";

alter table "public"."crawl_tasks" add constraint "crawl_tasks_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(user_id) not valid;

alter table "public"."crawl_tasks" validate constraint "crawl_tasks_user_id_fkey";

alter table "public"."customers" add constraint "customers_user_band_user_unique" UNIQUE using index "customers_user_band_user_unique";

alter table "public"."customers" add constraint "customers_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(user_id) not valid;

alter table "public"."customers" validate constraint "customers_user_id_fkey";

alter table "public"."notifications" add constraint "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(user_id) not valid;

alter table "public"."notifications" validate constraint "notifications_user_id_fkey";

alter table "public"."orders" add constraint "orders_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(product_id) not valid;

alter table "public"."orders" validate constraint "orders_product_id_fkey";

alter table "public"."orders" add constraint "orders_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(user_id) not valid;

alter table "public"."orders" validate constraint "orders_user_id_fkey";

alter table "public"."posts" add constraint "posts_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(product_id) not valid;

alter table "public"."posts" validate constraint "posts_product_id_fkey";

alter table "public"."posts" add constraint "posts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(user_id) not valid;

alter table "public"."posts" validate constraint "posts_user_id_fkey";

alter table "public"."posts" add constraint "unique_band_post" UNIQUE using index "unique_band_post";

alter table "public"."products" add constraint "products_product_id_key" UNIQUE using index "products_product_id_key";

alter table "public"."products" add constraint "products_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(user_id) not valid;

alter table "public"."products" validate constraint "products_user_id_fkey";

alter table "public"."stats" add constraint "stats_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(user_id) not valid;

alter table "public"."stats" validate constraint "stats_user_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_notification()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_order_history()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO order_history (order_id, status, timestamp, note)
  VALUES (NEW.order_id, NEW.status, NOW(), '주문 생성');
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_unique_post_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.unique_post_id := NEW.band_id || '_' || NEW.band_post_id;
  RETURN NEW;
END;
$function$
;

-- 함수 삭제 구문 추가 (인자 타입을 정확히 맞춰야 함)
DROP FUNCTION IF EXISTS public.get_order_stats_by_date_range(text, timestamp with time zone, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.get_order_stats_by_date_range(p_user_id text, p_start_date timestamp with time zone, p_end_date timestamp with time zone)
 RETURNS TABLE(total_orders_count bigint, completed_orders_count bigint, pending_receipt_orders_count bigint, total_estimated_revenue numeric, total_confirmed_revenue numeric)
 LANGUAGE sql
 STABLE
AS $function$
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
$function$
;



CREATE OR REPLACE FUNCTION public.get_order_stats_by_date_range(p_user_id text, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_status_filter text DEFAULT NULL::text, p_sub_status_filter text DEFAULT NULL::text, p_search_term text DEFAULT NULL::text)
 RETURNS TABLE(total_orders_count bigint, completed_orders_count bigint, pending_receipt_orders_count bigint, total_estimated_revenue numeric, total_confirmed_revenue numeric)
 LANGUAGE plpgsql
AS $function$
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
$function$
;

create or replace view "public"."orders_with_products" as  SELECT o.order_id,
    o.user_id,
    o.product_id,
    o.post_number,
    o.band_number,
    o.customer_name,
    o.customer_band_id,
    o.customer_profile,
    o.quantity,
    o.price,
    o.total_amount,
    o.comment,
    o.status,
    o.ordered_at,
    o.confirmed_at,
    o.completed_at,
    o.band_comment_id,
    o.band_comment_url,
    o.admin_note,
    o.updated_at,
    o.history,
    o.canceled_at,
    o.price_option_used,
    o.content,
    o.customer_id,
    o.price_option_description,
    o.created_at,
    o.price_per_unit,
    o.item_number,
    o.commented_at,
    o.product_name,
    o.paid_at,
    o.sub_status,
    p.title AS product_title,
    p.barcode AS product_barcode,
    p.pickup_date AS product_pickup_date
   FROM (orders o
     LEFT JOIN products p ON ((o.product_id = p.product_id)));


CREATE OR REPLACE FUNCTION public.save_crawled_data(products_data jsonb, posts_data jsonb, orders_data jsonb, customers_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.save_crawled_orders(orders_data jsonb[])
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.update_customer_order_stats()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.update_order_history()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.status != NEW.status THEN
    INSERT INTO order_history (order_id, status, timestamp, note)
    VALUES (NEW.order_id, NEW.status, NOW(), '상태 변경: ' || OLD.status || ' → ' || NEW.status);
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_product_order_stats()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$
;

grant delete on table "public"."barcodes" to "anon";

grant insert on table "public"."barcodes" to "anon";

grant references on table "public"."barcodes" to "anon";

grant select on table "public"."barcodes" to "anon";

grant trigger on table "public"."barcodes" to "anon";

grant truncate on table "public"."barcodes" to "anon";

grant update on table "public"."barcodes" to "anon";

grant delete on table "public"."barcodes" to "authenticated";

grant insert on table "public"."barcodes" to "authenticated";

grant references on table "public"."barcodes" to "authenticated";

grant select on table "public"."barcodes" to "authenticated";

grant trigger on table "public"."barcodes" to "authenticated";

grant truncate on table "public"."barcodes" to "authenticated";

grant update on table "public"."barcodes" to "authenticated";

grant delete on table "public"."barcodes" to "service_role";

grant insert on table "public"."barcodes" to "service_role";

grant references on table "public"."barcodes" to "service_role";

grant select on table "public"."barcodes" to "service_role";

grant trigger on table "public"."barcodes" to "service_role";

grant truncate on table "public"."barcodes" to "service_role";

grant update on table "public"."barcodes" to "service_role";

grant delete on table "public"."crawl_history" to "anon";

grant insert on table "public"."crawl_history" to "anon";

grant references on table "public"."crawl_history" to "anon";

grant select on table "public"."crawl_history" to "anon";

grant trigger on table "public"."crawl_history" to "anon";

grant truncate on table "public"."crawl_history" to "anon";

grant update on table "public"."crawl_history" to "anon";

grant delete on table "public"."crawl_history" to "authenticated";

grant insert on table "public"."crawl_history" to "authenticated";

grant references on table "public"."crawl_history" to "authenticated";

grant select on table "public"."crawl_history" to "authenticated";

grant trigger on table "public"."crawl_history" to "authenticated";

grant truncate on table "public"."crawl_history" to "authenticated";

grant update on table "public"."crawl_history" to "authenticated";

grant delete on table "public"."crawl_history" to "service_role";

grant insert on table "public"."crawl_history" to "service_role";

grant references on table "public"."crawl_history" to "service_role";

grant select on table "public"."crawl_history" to "service_role";

grant trigger on table "public"."crawl_history" to "service_role";

grant truncate on table "public"."crawl_history" to "service_role";

grant update on table "public"."crawl_history" to "service_role";

grant delete on table "public"."crawl_tasks" to "anon";

grant insert on table "public"."crawl_tasks" to "anon";

grant references on table "public"."crawl_tasks" to "anon";

grant select on table "public"."crawl_tasks" to "anon";

grant trigger on table "public"."crawl_tasks" to "anon";

grant truncate on table "public"."crawl_tasks" to "anon";

grant update on table "public"."crawl_tasks" to "anon";

grant delete on table "public"."crawl_tasks" to "authenticated";

grant insert on table "public"."crawl_tasks" to "authenticated";

grant references on table "public"."crawl_tasks" to "authenticated";

grant select on table "public"."crawl_tasks" to "authenticated";

grant trigger on table "public"."crawl_tasks" to "authenticated";

grant truncate on table "public"."crawl_tasks" to "authenticated";

grant update on table "public"."crawl_tasks" to "authenticated";

grant delete on table "public"."crawl_tasks" to "service_role";

grant insert on table "public"."crawl_tasks" to "service_role";

grant references on table "public"."crawl_tasks" to "service_role";

grant select on table "public"."crawl_tasks" to "service_role";

grant trigger on table "public"."crawl_tasks" to "service_role";

grant truncate on table "public"."crawl_tasks" to "service_role";

grant update on table "public"."crawl_tasks" to "service_role";

grant delete on table "public"."customer_recent_orders" to "anon";

grant insert on table "public"."customer_recent_orders" to "anon";

grant references on table "public"."customer_recent_orders" to "anon";

grant select on table "public"."customer_recent_orders" to "anon";

grant trigger on table "public"."customer_recent_orders" to "anon";

grant truncate on table "public"."customer_recent_orders" to "anon";

grant update on table "public"."customer_recent_orders" to "anon";

grant delete on table "public"."customer_recent_orders" to "authenticated";

grant insert on table "public"."customer_recent_orders" to "authenticated";

grant references on table "public"."customer_recent_orders" to "authenticated";

grant select on table "public"."customer_recent_orders" to "authenticated";

grant trigger on table "public"."customer_recent_orders" to "authenticated";

grant truncate on table "public"."customer_recent_orders" to "authenticated";

grant update on table "public"."customer_recent_orders" to "authenticated";

grant delete on table "public"."customer_recent_orders" to "service_role";

grant insert on table "public"."customer_recent_orders" to "service_role";

grant references on table "public"."customer_recent_orders" to "service_role";

grant select on table "public"."customer_recent_orders" to "service_role";

grant trigger on table "public"."customer_recent_orders" to "service_role";

grant truncate on table "public"."customer_recent_orders" to "service_role";

grant update on table "public"."customer_recent_orders" to "service_role";

grant delete on table "public"."customers" to "anon";

grant insert on table "public"."customers" to "anon";

grant references on table "public"."customers" to "anon";

grant select on table "public"."customers" to "anon";

grant trigger on table "public"."customers" to "anon";

grant truncate on table "public"."customers" to "anon";

grant update on table "public"."customers" to "anon";

grant delete on table "public"."customers" to "authenticated";

grant insert on table "public"."customers" to "authenticated";

grant references on table "public"."customers" to "authenticated";

grant select on table "public"."customers" to "authenticated";

grant trigger on table "public"."customers" to "authenticated";

grant truncate on table "public"."customers" to "authenticated";

grant update on table "public"."customers" to "authenticated";

grant delete on table "public"."customers" to "service_role";

grant insert on table "public"."customers" to "service_role";

grant references on table "public"."customers" to "service_role";

grant select on table "public"."customers" to "service_role";

grant trigger on table "public"."customers" to "service_role";

grant truncate on table "public"."customers" to "service_role";

grant update on table "public"."customers" to "service_role";

grant delete on table "public"."notifications" to "anon";

grant insert on table "public"."notifications" to "anon";

grant references on table "public"."notifications" to "anon";

grant select on table "public"."notifications" to "anon";

grant trigger on table "public"."notifications" to "anon";

grant truncate on table "public"."notifications" to "anon";

grant update on table "public"."notifications" to "anon";

grant delete on table "public"."notifications" to "authenticated";

grant insert on table "public"."notifications" to "authenticated";

grant references on table "public"."notifications" to "authenticated";

grant select on table "public"."notifications" to "authenticated";

grant trigger on table "public"."notifications" to "authenticated";

grant truncate on table "public"."notifications" to "authenticated";

grant update on table "public"."notifications" to "authenticated";

grant delete on table "public"."notifications" to "service_role";

grant insert on table "public"."notifications" to "service_role";

grant references on table "public"."notifications" to "service_role";

grant select on table "public"."notifications" to "service_role";

grant trigger on table "public"."notifications" to "service_role";

grant truncate on table "public"."notifications" to "service_role";

grant update on table "public"."notifications" to "service_role";

grant delete on table "public"."order_history" to "anon";

grant insert on table "public"."order_history" to "anon";

grant references on table "public"."order_history" to "anon";

grant select on table "public"."order_history" to "anon";

grant trigger on table "public"."order_history" to "anon";

grant truncate on table "public"."order_history" to "anon";

grant update on table "public"."order_history" to "anon";

grant delete on table "public"."order_history" to "authenticated";

grant insert on table "public"."order_history" to "authenticated";

grant references on table "public"."order_history" to "authenticated";

grant select on table "public"."order_history" to "authenticated";

grant trigger on table "public"."order_history" to "authenticated";

grant truncate on table "public"."order_history" to "authenticated";

grant update on table "public"."order_history" to "authenticated";

grant delete on table "public"."order_history" to "service_role";

grant insert on table "public"."order_history" to "service_role";

grant references on table "public"."order_history" to "service_role";

grant select on table "public"."order_history" to "service_role";

grant trigger on table "public"."order_history" to "service_role";

grant truncate on table "public"."order_history" to "service_role";

grant update on table "public"."order_history" to "service_role";

grant delete on table "public"."orders" to "anon";

grant insert on table "public"."orders" to "anon";

grant references on table "public"."orders" to "anon";

grant select on table "public"."orders" to "anon";

grant trigger on table "public"."orders" to "anon";

grant truncate on table "public"."orders" to "anon";

grant update on table "public"."orders" to "anon";

grant delete on table "public"."orders" to "authenticated";

grant insert on table "public"."orders" to "authenticated";

grant references on table "public"."orders" to "authenticated";

grant select on table "public"."orders" to "authenticated";

grant trigger on table "public"."orders" to "authenticated";

grant truncate on table "public"."orders" to "authenticated";

grant update on table "public"."orders" to "authenticated";

grant delete on table "public"."orders" to "service_role";

grant insert on table "public"."orders" to "service_role";

grant references on table "public"."orders" to "service_role";

grant select on table "public"."orders" to "service_role";

grant trigger on table "public"."orders" to "service_role";

grant truncate on table "public"."orders" to "service_role";

grant update on table "public"."orders" to "service_role";

grant delete on table "public"."posts" to "anon";

grant insert on table "public"."posts" to "anon";

grant references on table "public"."posts" to "anon";

grant select on table "public"."posts" to "anon";

grant trigger on table "public"."posts" to "anon";

grant truncate on table "public"."posts" to "anon";

grant update on table "public"."posts" to "anon";

grant delete on table "public"."posts" to "authenticated";

grant insert on table "public"."posts" to "authenticated";

grant references on table "public"."posts" to "authenticated";

grant select on table "public"."posts" to "authenticated";

grant trigger on table "public"."posts" to "authenticated";

grant truncate on table "public"."posts" to "authenticated";

grant update on table "public"."posts" to "authenticated";

grant delete on table "public"."posts" to "service_role";

grant insert on table "public"."posts" to "service_role";

grant references on table "public"."posts" to "service_role";

grant select on table "public"."posts" to "service_role";

grant trigger on table "public"."posts" to "service_role";

grant truncate on table "public"."posts" to "service_role";

grant update on table "public"."posts" to "service_role";

grant delete on table "public"."products" to "anon";

grant insert on table "public"."products" to "anon";

grant references on table "public"."products" to "anon";

grant select on table "public"."products" to "anon";

grant trigger on table "public"."products" to "anon";

grant truncate on table "public"."products" to "anon";

grant update on table "public"."products" to "anon";

grant delete on table "public"."products" to "authenticated";

grant insert on table "public"."products" to "authenticated";

grant references on table "public"."products" to "authenticated";

grant select on table "public"."products" to "authenticated";

grant trigger on table "public"."products" to "authenticated";

grant truncate on table "public"."products" to "authenticated";

grant update on table "public"."products" to "authenticated";

grant delete on table "public"."products" to "service_role";

grant insert on table "public"."products" to "service_role";

grant references on table "public"."products" to "service_role";

grant select on table "public"."products" to "service_role";

grant trigger on table "public"."products" to "service_role";

grant truncate on table "public"."products" to "service_role";

grant update on table "public"."products" to "service_role";

grant delete on table "public"."stats" to "anon";

grant insert on table "public"."stats" to "anon";

grant references on table "public"."stats" to "anon";

grant select on table "public"."stats" to "anon";

grant trigger on table "public"."stats" to "anon";

grant truncate on table "public"."stats" to "anon";

grant update on table "public"."stats" to "anon";

grant delete on table "public"."stats" to "authenticated";

grant insert on table "public"."stats" to "authenticated";

grant references on table "public"."stats" to "authenticated";

grant select on table "public"."stats" to "authenticated";

grant trigger on table "public"."stats" to "authenticated";

grant truncate on table "public"."stats" to "authenticated";

grant update on table "public"."stats" to "authenticated";

grant delete on table "public"."stats" to "service_role";

grant insert on table "public"."stats" to "service_role";

grant references on table "public"."stats" to "service_role";

grant select on table "public"."stats" to "service_role";

grant trigger on table "public"."stats" to "service_role";

grant truncate on table "public"."stats" to "service_role";

grant update on table "public"."stats" to "service_role";

grant delete on table "public"."users" to "anon";

grant insert on table "public"."users" to "anon";

grant references on table "public"."users" to "anon";

grant select on table "public"."users" to "anon";

grant trigger on table "public"."users" to "anon";

grant truncate on table "public"."users" to "anon";

grant update on table "public"."users" to "anon";

grant delete on table "public"."users" to "authenticated";

grant insert on table "public"."users" to "authenticated";

grant references on table "public"."users" to "authenticated";

grant select on table "public"."users" to "authenticated";

grant trigger on table "public"."users" to "authenticated";

grant truncate on table "public"."users" to "authenticated";

grant update on table "public"."users" to "authenticated";

grant delete on table "public"."users" to "service_role";

grant insert on table "public"."users" to "service_role";

grant references on table "public"."users" to "service_role";

grant select on table "public"."users" to "service_role";

grant trigger on table "public"."users" to "service_role";

grant truncate on table "public"."users" to "service_role";

grant update on table "public"."users" to "service_role";


drop index if exists "storage"."idx_name_bucket_level_unique";

-- 수정 후:
CREATE UNIQUE INDEX IF NOT EXISTS idx_name_bucket_unique ON storage.objects USING btree (name COLLATE "C", bucket_id);


