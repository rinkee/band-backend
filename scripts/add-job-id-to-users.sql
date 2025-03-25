-- 사용자 테이블에 크롤링 작업 ID를 저장할 컬럼 추가
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS job_id VARCHAR(100) DEFAULT NULL;

-- 컬럼 설명 추가
COMMENT ON COLUMN public.users.job_id IS '자동 크롤링 작업 ID (스케줄러에서 관리하는 고유 ID)';

-- 인덱스 추가 (필요시)
CREATE INDEX IF NOT EXISTS idx_users_job_id ON public.users(job_id); 