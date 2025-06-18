-- 바코드 옵션 필드 추가 (안전한 첫 번째 단계)
-- 기존 테이블에 필드만 추가하고 뷰는 건드리지 않음

-- products 테이블에 barcode_options 필드 추가
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS barcode_options JSONB DEFAULT '[{"id": "default", "name": "기본상품", "barcode": "", "price": 0}]'::jsonb;

-- orders 테이블에 selected_barcode_option 필드 추가  
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS selected_barcode_option JSONB;

-- 기존 상품들에 기본 바코드 옵션 설정 (기존 barcode와 base_price 사용)
UPDATE products 
SET barcode_options = jsonb_build_array(
  jsonb_build_object(
    'id', 'default',
    'name', '기본상품', 
    'barcode', COALESCE(barcode, ''),
    'price', COALESCE(base_price, 0)
  )
)
WHERE barcode_options IS NULL 
   OR jsonb_array_length(barcode_options) = 0; 