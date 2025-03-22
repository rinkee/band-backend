import useSWR, { useSWRConfig } from "swr";
import { axiosFetcher, api } from "../utils/fetcher";

/**
 * 사용자 정보를 가져오는 훅
 * @param {string} id - 사용자 ID
 * @param {Object} options - SWR 옵션
 * @returns {Object} 사용자 정보, 로딩 상태, 오류 상태
 */
export default function useUser(id, options = {}) {
  const { data, error, isLoading } = useSWR(
    id ? `/api/auth/${id}` : null,
    axiosFetcher,
    options
  );

  return {
    user: data,
    isLoading,
    isError: error,
  };
}

/**
 * 사용자 프로필 수정 함수를 제공하는 훅
 * @returns {Object} 사용자 데이터 변경 함수들
 */
export function useUserMutations() {
  const { mutate } = useSWRConfig();

  /**
   * 사용자 프로필 업데이트 함수
   * @param {string} userId - 사용자 ID
   * @param {Object} userData - 변경할 사용자 데이터
   * @returns {Promise} API 응답
   */
  const updateProfile = async (userId, userData) => {
    const response = await api.put(`/api/auth/${userId}/profile`, userData);

    // 캐시 갱신
    mutate(`/api/auth/${userId}`);

    return response.data;
  };

  /**
   * 비밀번호 변경 함수
   * @param {string} userId - 사용자 ID
   * @param {string} currentPassword - 현재 비밀번호
   * @param {string} newPassword - 새 비밀번호
   * @returns {Promise} API 응답
   */
  const changePassword = async (userId, currentPassword, newPassword) => {
    const response = await api.put(`/api/auth/${userId}/password`, {
      currentPassword,
      newPassword,
    });

    return response.data;
  };

  /**
   * 네이버 계정 설정 함수
   * @param {string} userId - 사용자 ID
   * @param {string} naverId - 네이버 아이디
   * @param {string} naverPassword - 네이버 비밀번호
   * @returns {Promise} API 응답
   */
  const setNaverAccount = async (userId, naverId, naverPassword) => {
    const response = await api.put(`/api/auth/${userId}/naver`, {
      naverId,
      naverPassword,
    });

    // 캐시 갱신
    mutate(`/api/auth/${userId}`);

    return response.data;
  };

  return { updateProfile, changePassword, setNaverAccount };
}
