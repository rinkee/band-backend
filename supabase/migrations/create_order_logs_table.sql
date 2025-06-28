-- order_logs 테이블 생성 (주문 관련 로그 기록용)

CREATE TABLE IF NOT EXISTS "public"."order_logs" (
    "log_id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "post_key" TEXT,
    "band_key" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS "idx_order_logs_user_id" ON "public"."order_logs" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_order_logs_post_key" ON "public"."order_logs" USING btree ("post_key");
CREATE INDEX IF NOT EXISTS "idx_order_logs_action" ON "public"."order_logs" USING btree ("action");
CREATE INDEX IF NOT EXISTS "idx_order_logs_created_at" ON "public"."order_logs" USING btree ("created_at");

-- 권한 설정
GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."order_logs" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."order_logs" TO "service_role";

-- 주석 추가
COMMENT ON TABLE "public"."order_logs" IS '주문 관련 액션 로그 (취소, 수정, 상태 변경 등)';
COMMENT ON COLUMN "public"."order_logs"."action" IS '수행된 액션 (취소요청, 상태변경, 수정 등)';
COMMENT ON COLUMN "public"."order_logs"."details" IS '액션 세부 정보 (JSON 형태)'; 