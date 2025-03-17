import { useState, useEffect } from "react";
import NaverLoginStatus from "./NaverLoginStatus";

/**
 * 네이버 로그인 페이지 컴포넌트
 * 로그인 상태를 시작하고 관리하는 예제 페이지
 */
export default function NaverLoginPage() {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // API URL 환경변수
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  // 페이지 로드 시 인증 상태 확인
  useEffect(() => {
    const checkAuth = async () => {
      try {
        setIsLoading(true);
        const response = await fetch(`${apiUrl}/api/auth/check`, {
          credentials: "include", // 세션 쿠키 포함
        });

        const data = await response.json();

        if (data.success && data.isAuthenticated) {
          setUser(data.data);
        } else {
          setUser(null);
        }
      } catch (err) {
        console.error("인증 확인 오류:", err);
        setError("인증 상태를 확인하는 중 오류가 발생했습니다.");
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, [apiUrl]);

  // 로그인 완료 처리
  const handleLoginComplete = (status) => {
    console.log("네이버 로그인 완료:", status);
    // 로그인 후 사용자 정보 갱신이 필요할 수 있음
    // 여기서는 단순히 성공 메시지만 표시
    alert("네이버 로그인이 완료되었습니다.");
  };

  // 로그인 오류 처리
  const handleLoginError = (errorMessage) => {
    console.error("네이버 로그인 오류:", errorMessage);
    setError(`네이버 로그인 중 오류가 발생했습니다: ${errorMessage}`);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin h-10 w-10 border-4 border-blue-500 rounded-full border-t-transparent"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
          <h1 className="text-2xl font-bold mb-6 text-center">
            로그인이 필요합니다
          </h1>
          <p className="mb-4 text-center text-gray-600">
            네이버 로그인 기능을 사용하려면 먼저 로그인해주세요.
          </p>
          <a
            href="/login"
            className="block w-full py-2 px-4 bg-blue-600 text-white rounded text-center hover:bg-blue-700"
          >
            로그인 페이지로 이동
          </a>

          {error && (
            <div className="mt-4 p-3 bg-red-100 text-red-700 rounded">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white shadow-md rounded-lg overflow-hidden">
          {/* 사용자 정보 섹션 */}
          <div className="p-6 border-b">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">
              네이버 로그인
            </h1>
            <div className="bg-blue-50 p-4 rounded-md mb-6">
              <h2 className="text-lg font-semibold text-blue-800 mb-2">
                사용자 정보
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">사용자 ID</p>
                  <p className="font-medium">{user.userId}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">로그인 ID</p>
                  <p className="font-medium">{user.loginId}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">가게 이름</p>
                  <p className="font-medium">{user.storeName}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">밴드 ID</p>
                  <p className="font-medium">{user.bandId}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">네이버 ID</p>
                  <p className="font-medium">
                    {user.naverId || "설정되지 않음"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">마지막 네이버 로그인</p>
                  <p className="font-medium">
                    {user.lastNaverLoginAt
                      ? new Date(user.lastNaverLoginAt).toLocaleString()
                      : "없음"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 네이버 로그인 상태 컴포넌트 */}
          <div className="p-6">
            <NaverLoginStatus
              userId={user.userId}
              apiUrl={apiUrl}
              onComplete={handleLoginComplete}
              onError={handleLoginError}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
