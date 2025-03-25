-- 사용자 테이블에 자동 크롤링 관련 필드 추가
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS auto_crawl BOOLEAN DEFAULT false;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS crawl_interval INTEGER DEFAULT 10;

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_users_auto_crawl ON public.users(auto_crawl);

-- 자동 크롤링 설정 값에 대한 권한 설정
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 인증된 사용자만 자신의 자동 크롤링 설정을 변경할 수 있도록 정책 추가
CREATE POLICY IF NOT EXISTS "사용자는 자신의 자동 크롤링 설정을 업데이트할 수 있음"
  ON public.users
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 자동 크롤링 설정 값에 대한 조회 권한
CREATE POLICY IF NOT EXISTS "사용자는 자신의 자동 크롤링 설정을 조회할 수 있음"
  ON public.users
  FOR SELECT
  USING (auth.uid() = user_id);

-- 주석
COMMENT ON COLUMN public.users.auto_crawl IS '자동 크롤링 활성화 여부';
COMMENT ON COLUMN public.users.crawl_interval IS '자동 크롤링 간격 (분)';
