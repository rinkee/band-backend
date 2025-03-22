import useSWR from "swr";
import { axiosFetcher, api } from "../utils/fetcher";
import { useCallback } from "react";

/**
 * 사용자 인증 관련 훅
 * @param {string} userId - 사용자 ID
 * @returns {Object} { user, loading, error, logout, updateProfile }
 */
export function useAuth(userId) {
  const {
    data: user,
    error,
    isLoading,
    mutate,
  } = useSWR(userId ? `/auth/${userId}` : null, axiosFetcher);

  /**
   * 로그인 함수
   * @param {string} loginId - 로그인 ID
   * @param {string} password - 비밀번호
   * @returns {Promise<Object>} 로그인 결과
   */
  const login = useCallback(async (loginId, password) => {
    try {
      const response = await api.post("/auth/login", { loginId, password });
      return response.data;
    } catch (error) {
      throw error;
    }
  }, []);

  /**
   * 로그아웃 함수
   * @returns {Promise<void>}
   */
  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
      mutate(null, false);
    } catch (error) {
      console.error("로그아웃 실패:", error);
    }
  }, [mutate]);

  /**
   * 사용자 프로필 업데이트 함수
   * @param {Object} profileData - 업데이트할 프로필 데이터
   * @returns {Promise<Object>} 업데이트 결과
   */
  const updateProfile = useCallback(
    async (profileData) => {
      try {
        const response = await api.put(`/auth/${userId}`, profileData);
        // 데이터 갱신
        mutate(response.data, false);
        return response.data;
      } catch (error) {
        throw error;
      }
    },
    [userId, mutate]
  );

  return {
    user,
    loading: isLoading,
    error,
    login,
    logout,
    updateProfile,
  };
}

export default useAuth;
