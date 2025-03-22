import useSWR from "swr";
import { axiosFetcher } from "../utils/fetcher";

/**
 * 주문 통계를 가져오는 훅
 * @param {string} userId - 사용자 ID
 * @param {string} period - 기간 (week, month, year)
 * @param {Object} options - SWR 옵션
 * @returns {Object} SWR 응답 객체
 */
export function useOrderStats(userId, period = "month", options = {}) {
  const params = new URLSearchParams({ userId, period });
  return useSWR(
    userId ? `/orders/stats?${params}` : null,
    axiosFetcher,
    options
  );
}

export default useOrderStats;
