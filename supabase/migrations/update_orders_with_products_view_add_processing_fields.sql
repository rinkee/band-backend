-- orders_with_products 뷰 재생성 (processing_method와 ai_extraction_result 필드 추가)
DROP VIEW IF EXISTS orders_with_products;

CREATE VIEW orders_with_products AS
SELECT 
    o.order_id,
    o.user_id,
    o.product_id,
    o.customer_name,
    o.quantity,
    o.price,
    o.total_amount,
    o.comment,
    o.status,
    o.sub_status,
    o.ordered_at,
    o.completed_at,
    o.canceled_at,
    o.post_key,
    o.comment_key,
    o.item_number,
    o.processing_method,
    o.ai_extraction_result,
    o.selected_barcode_option,
    p.title as product_title,
    p.price as product_price,
    p.barcode as product_barcode,
    p.price_options as product_price_options
FROM orders o
LEFT JOIN products p ON o.product_id = p.product_id; 