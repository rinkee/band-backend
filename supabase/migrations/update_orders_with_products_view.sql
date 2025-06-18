-- orders_with_products 뷰 업데이트 (기존 구조 보존하면서 새 컬럼 추가)

DROP VIEW IF EXISTS orders_with_products;

CREATE VIEW orders_with_products AS
SELECT 
    o.id,
    o.user_id,
    o.product_id,
    o.quantity,
    o.status,
    o.created_at,
    o.updated_at,
    o.selected_barcode_option,  -- 새로 추가된 필드
    p.title as product_title,
    p.description as product_description,
    p.price as product_price,
    p.barcode as product_barcode,
    p.image_url as product_image_url,
    p.barcode_options as product_barcode_options  -- 새로 추가된 필드
FROM orders o
LEFT JOIN products p ON o.product_id = p.id; 