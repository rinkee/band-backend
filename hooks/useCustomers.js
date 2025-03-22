import useSWR, { useSWRConfig } from "swr";
import { axiosFetcher, api } from "../utils/fetcher";

/**
 * 고객 목록을 가져오는 훅
 * @param {string} userId - 사용자 ID
 * @param {number} page - 페이지 번호
 * @param {Object} filters - 필터링 조건
 * @param {Object} options - SWR 옵션
 * @returns {Object} SWR 응답 객체
 */
export function useCustomers(userId, page = 1, filters = {}, options = {}) {
  const params = new URLSearchParams({ userId, page, ...filters });
  return useSWR(userId ? `/customers?${params}` : null, axiosFetcher, options);
}

/**
 * 특정 고객 정보를 가져오는 훅
 * @param {string} customerId - 고객 ID
 * @param {Object} options - SWR 옵션
 * @returns {Object} SWR 응답 객체
 */
export function useCustomer(customerId, options = {}) {
  return useSWR(
    customerId ? `/customers/${customerId}` : null,
    axiosFetcher,
    options
  );
}

/**
 * 고객 데이터 변경 함수들을 제공하는 훅
 * @returns {Object} 고객 데이터 변경 함수들
 */
export function useCustomerMutations() {
  const { mutate } = useSWRConfig();

  /**
   * 고객 정보 업데이트 함수
   * @param {string} customerId - 고객 ID
   * @param {Object} customerData - 변경할 고객 정보
   * @param {string} userId - 사용자 ID
   * @returns {Promise} API 응답
   */
  const updateCustomer = async (customerId, customerData, userId) => {
    const response = await api.put(`/customers/${customerId}`, customerData);

    // 캐시 갱신
    mutate(`/customers/${customerId}`);
    if (userId) {
      mutate(`/customers?userId=${userId}`);
    }

    return response.data;
  };

  /**
   * 고객 추가 함수
   * @param {Object} customerData - 추가할 고객 정보
   * @param {string} userId - 사용자 ID
   * @returns {Promise} API 응답
   */
  const addCustomer = async (customerData, userId) => {
    const response = await api.post("/customers", customerData);

    // 캐시 갱신
    if (userId) {
      mutate(`/customers?userId=${userId}`);
    }

    return response.data;
  };

  /**
   * 고객 삭제 함수
   * @param {string} customerId - 고객 ID
   * @param {string} userId - 사용자 ID
   * @returns {Promise} API 응답
   */
  const deleteCustomer = async (customerId, userId) => {
    const response = await api.delete(`/customers/${customerId}`);

    // 캐시 갱신
    if (userId) {
      mutate(`/customers?userId=${userId}`);
    }

    return response.data;
  };

  return { updateCustomer, addCustomer, deleteCustomer };
}

export default useCustomers;
