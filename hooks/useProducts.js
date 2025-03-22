import useSWR, { useSWRConfig } from "swr";
import { axiosFetcher, api } from "../utils/fetcher";

/**
 * 상품 목록을 가져오는 훅
 * @param {string} userId - 사용자 ID
 * @param {number} page - 페이지 번호
 * @param {Object} filters - 필터링 조건
 * @param {Object} options - SWR 옵션
 * @returns {Object} SWR 응답 객체
 */
export function useProducts(userId, page = 1, filters = {}, options = {}) {
  const params = new URLSearchParams({ userId, page, ...filters });
  return useSWR(userId ? `/products?${params}` : null, axiosFetcher, options);
}

/**
 * 특정 상품 정보를 가져오는 훅
 * @param {string} productId - 상품 ID
 * @param {Object} options - SWR 옵션
 * @returns {Object} SWR 응답 객체
 */
export function useProduct(productId, options = {}) {
  return useSWR(
    productId ? `/products/${productId}` : null,
    axiosFetcher,
    options
  );
}

/**
 * 상품 데이터 변경 함수들을 제공하는 훅
 * @returns {Object} 상품 데이터 변경 함수들
 */
export function useProductMutations() {
  const { mutate } = useSWRConfig();

  /**
   * 상품 정보 업데이트 함수
   * @param {string} productId - 상품 ID
   * @param {Object} productData - 변경할 상품 정보
   * @param {string} userId - 사용자 ID
   * @returns {Promise} API 응답
   */
  const updateProduct = async (productId, productData, userId) => {
    const response = await api.put(`/products/${productId}`, productData);

    // 캐시 갱신
    mutate(`/products/${productId}`);
    if (userId) {
      mutate(`/products?userId=${userId}`);
    }

    return response.data;
  };

  /**
   * 상품 추가 함수
   * @param {Object} productData - 추가할 상품 정보
   * @param {string} userId - 사용자 ID
   * @returns {Promise} API 응답
   */
  const addProduct = async (productData, userId) => {
    const response = await api.post("/products", productData);

    // 캐시 갱신
    if (userId) {
      mutate(`/products?userId=${userId}`);
    }

    return response.data;
  };

  /**
   * 상품 삭제 함수
   * @param {string} productId - 상품 ID
   * @param {string} userId - 사용자 ID
   * @returns {Promise} API 응답
   */
  const deleteProduct = async (productId, userId) => {
    const response = await api.delete(`/products/${productId}`);

    // 캐시 갱신
    if (userId) {
      mutate(`/products?userId=${userId}`);
    }

    return response.data;
  };

  return { updateProduct, addProduct, deleteProduct };
}

export default useProducts;
