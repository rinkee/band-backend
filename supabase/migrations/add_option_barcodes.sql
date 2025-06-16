-- 옵션 바코드 컬럼 추가 (products 테이블)
-- 이벤트, 할인, 번들 상품 등을 위한 추가 바코드 필드들

ALTER TABLE products 
ADD COLUMN IF NOT EXISTS option_barcode_1 VARCHAR(50),
ADD COLUMN IF NOT EXISTS option_barcode_2 VARCHAR(50),
ADD COLUMN IF NOT EXISTS option_barcode_3 VARCHAR(50);

-- 옵션 바코드 검색 성능 향상을 위한 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_products_option_barcode_1 ON products(option_barcode_1) WHERE option_barcode_1 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_option_barcode_2 ON products(option_barcode_2) WHERE option_barcode_2 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_option_barcode_3 ON products(option_barcode_3) WHERE option_barcode_3 IS NOT NULL;

-- 컬럼 설명 추가
COMMENT ON COLUMN products.option_barcode_1 IS '옵션 바코드 1 - 할인/이벤트 상품용';
COMMENT ON COLUMN products.option_barcode_2 IS '옵션 바코드 2 - 할인/이벤트 상품용';
COMMENT ON COLUMN products.option_barcode_3 IS '옵션 바코드 3 - 할인/이벤트 상품용'; 