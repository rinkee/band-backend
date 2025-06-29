-- keyword_mappings 필드를 posts 테이블에 추가
ALTER TABLE posts ADD COLUMN IF NOT EXISTS keyword_mappings JSONB;

-- 인덱스 추가 (선택적, 성능 향상을 위해)
CREATE INDEX IF NOT EXISTS idx_posts_keyword_mappings 
ON posts USING GIN (keyword_mappings);

-- 코멘트 추가
COMMENT ON COLUMN posts.keyword_mappings IS '게시물 상품별 주문 키워드 매핑 정보 (AI가 생성한 키워드와 상품 인덱스의 매핑)'; 