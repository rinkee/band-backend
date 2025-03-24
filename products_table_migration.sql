-- 새로운 가격 옵션 및 픽업 정보 추가를 위한 SQL 수정문

-- 기존 price 필드를 basePrice로 이름 변경
ALTER TABLE products RENAME COLUMN price TO basePrice;

-- priceOptions 필드 추가 (JSONB 타입)
ALTER TABLE products ADD COLUMN priceOptions JSONB DEFAULT '[]';

-- 기존 데이터에 대해 priceOptions 기본값 설정 (기존 가격을 기본 옵션으로 변환)
UPDATE products 
SET priceOptions = json_build_array(
  json_build_object(
    'quantity', 1, 
    'price', basePrice, 
    'description', '기본가'
  )
)
WHERE priceOptions IS NULL OR priceOptions = '[]';

-- 수량 필드 추가 (정수형)
ALTER TABLE products ADD COLUMN quantity INTEGER DEFAULT 1;

-- 용량/수량 텍스트 정보 필드 추가 (문자열)
ALTER TABLE products ADD COLUMN quantity_text VARCHAR(255);

-- 상품 특징 필드 추가 (JSONB 배열)
ALTER TABLE products ADD COLUMN features JSONB DEFAULT '[]';

-- 픽업 정보 필드 추가
ALTER TABLE products ADD COLUMN pickupInfo VARCHAR(255);

-- 픽업 날짜 필드 추가 (ISO 문자열 저장)
ALTER TABLE products ADD COLUMN pickupDate TIMESTAMP WITH TIME ZONE;

-- 픽업 유형 필드 추가 (예: 수령, 픽업, 도착 등)
ALTER TABLE products ADD COLUMN pickupType VARCHAR(50);

-- 인덱스 추가 (선택사항)
CREATE INDEX idx_products_pickupDate ON products(pickupDate);
CREATE INDEX idx_products_basePrice ON products(basePrice);

-- 주석
COMMENT ON COLUMN products.basePrice IS '기본 가격 (가장 저렴한 옵션의 가격)';
COMMENT ON COLUMN products.priceOptions IS '가격 옵션 배열 [{ quantity, price, description }]';
COMMENT ON COLUMN products.quantity IS '판매 단위 수량 (정수)';
COMMENT ON COLUMN products.quantity_text IS '용량/개수 정보 텍스트 (예: 400g, 10개입)';
COMMENT ON COLUMN products.features IS '상품 특징 정보 배열';
COMMENT ON COLUMN products.pickupInfo IS '픽업/수령 정보 원문';
COMMENT ON COLUMN products.pickupDate IS '픽업/수령 예정 날짜';
COMMENT ON COLUMN products.pickupType IS '픽업/수령 유형 (수령, 픽업, 도착 등)'; 