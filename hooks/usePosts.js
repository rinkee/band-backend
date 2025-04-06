import useSWR, { useSWRConfig } from "swr";
import { axiosFetcher, api } from "../utils/fetcher";

/**
 * 게시글 목록을 가져오는 훅
 * @param {string} bandNumber - 사용자 ID
 * @param {number} page - 페이지 번호
 * @param {Object} filters - 필터링 조건
 * @param {Object} options - SWR 옵션
 * @returns {Object} SWR 응답 객체
 */
export function usePosts(bandNumber, page = 1, filters = {}, options = {}) {
  const params = new URLSearchParams({ bandNumber, page, ...filters });
  return useSWR(bandNumber ? `/posts?${params}` : null, axiosFetcher, options);
}

/**
 * 특정 게시글 정보를 가져오는 훅
 * @param {string} postId - 게시글 ID
 * @param {Object} options - SWR 옵션
 * @returns {Object} SWR 응답 객체
 */
export function usePost(postId, options = {}) {
  return useSWR(postId ? `/posts/${postId}` : null, axiosFetcher, options);
}

/**
 * 게시글 데이터 변경 함수들을 제공하는 훅
 * @returns {Object} 게시글 데이터 변경 함수들
 */
export function usePostMutations() {
  const { mutate } = useSWRConfig();

  /**
   * 게시글 상태 업데이트 함수
   * @param {string} postId - 게시글 ID
   * @param {string} status - 변경할 상태
   * @param {string} userId - 사용자 ID
   * @returns {Promise} API 응답
   */
  const updatePostStatus = async (postId, status, userId) => {
    const response = await api.put(`/posts/${postId}/status`, {
      status,
    });

    // 캐시 갱신
    mutate(`/posts/${postId}`);
    if (userId) {
      mutate(`/posts?userId=${userId}`);
    }

    return response.data;
  };

  /**
   * 게시글 삭제 함수
   * @param {string} postId - 게시글 ID
   * @param {string} userId - 사용자 ID
   * @returns {Promise} API 응답
   */
  const deletePost = async (postId, userId) => {
    const response = await api.delete(`/posts/${postId}`);

    // 캐시 갱신
    if (userId) {
      mutate(`/posts?userId=${userId}`);
    }

    return response.data;
  };

  /**
   * 게시글 크롤링 시작 함수
   * @param {string} bandNumber - 밴드 ID
   * @param {string} userId - 사용자 ID
   * @param {number} maxPosts - 최대 크롤링할 게시글 수
   * @returns {Promise} API 응답
   */
  const startPostCrawling = async (bandNumber, userId, maxPosts = 30) => {
    const response = await api.post(`/crawl/${bandNumber}/posts`, {
      userId,
      maxPosts,
    });

    return response.data;
  };

  return { updatePostStatus, deletePost, startPostCrawling };
}

export default usePosts;
