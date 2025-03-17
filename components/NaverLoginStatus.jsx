import { useState, useEffect, useRef } from "react";

/**
 * 네이버 로그인 상태를 표시하는 컴포넌트
 * @param {Object} props
 * @param {string} props.userId - 사용자 ID
 * @param {function} props.onComplete - 로그인 완료 시 콜백 함수
 * @param {function} props.onError - 오류 발생 시 콜백 함수
 */
export default function NaverLoginStatus({ userId, onComplete, onError }) {
  const [status, setStatus] = useState({
    isProcessing: true,
    step: "init",
    message: "상태 정보를 불러오는 중...",
    progress: 0,
    error: null,
    timestamp: new Date().toISOString(),
  });

  const [connectionError, setConnectionError] = useState(false);
  const [connectionErrorCount, setConnectionErrorCount] = useState(0);
  const [polling, setPolling] = useState(true);
  const pollingIntervalRef = useRef(null);
  const retryTimeoutRef = useRef(null);

  // 백엔드 API에서 상태 조회
  const fetchStatus = async () => {
    if (!userId || !polling) return;

    try {
      const timestamp = Date.now(); // 캐시 방지를 위한 타임스탬프
      const response = await fetch(
        `/api/naver-status/${userId}?t=${timestamp}`,
        {
          headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`상태 조회 실패: ${response.status}`);
      }

      const data = await response.json();

      if (data.success === false) {
        // 백엔드에서 오류 응답을 받은 경우
        console.error("네이버 로그인 상태 조회 오류:", data.error);
        setStatus((prev) => ({
          ...prev,
          error: data.error || "상태 정보를 불러오는 중 오류가 발생했습니다",
        }));
        return;
      }

      if (connectionError) {
        setConnectionError(false);
        setConnectionErrorCount(0);
      }

      // 상태 업데이트
      setStatus(data.data);

      // 로그인 완료 또는 실패 시 폴링 중지
      if (data.data.progress >= 100 || data.data.error) {
        setPolling(false);

        if (data.data.progress >= 100 && !data.data.error) {
          onComplete && onComplete(data.data);
        } else if (data.data.error) {
          onError && onError(data.data.error);
        }
      }
    } catch (error) {
      console.error("네이버 로그인 상태 조회 네트워크 오류:", error);

      // 연결 오류 상태 설정
      setConnectionError(true);
      setConnectionErrorCount((prev) => prev + 1);

      // 오류 상태 업데이트
      setStatus((prev) => ({
        ...prev,
        message: "백엔드 서버 연결 오류. 재시도 중...",
        error:
          "일시적인 서버 연결 오류가 발생했습니다. 잠시 후 다시 시도합니다.",
      }));

      // 오류가 5번 이상 발생하면 폴링 중지
      if (connectionErrorCount >= 5) {
        setPolling(false);
        onError &&
          onError(
            "서버 연결 오류가 지속적으로 발생합니다. 네트워크 연결을 확인하거나 잠시 후 다시 시도해주세요."
          );
      }
    }
  };

  // 로그인 상태 폴링
  useEffect(() => {
    if (!userId) return;

    // 초기 상태 조회
    fetchStatus();

    // 폴링 설정
    pollingIntervalRef.current = setInterval(() => {
      if (polling) {
        fetchStatus();
      }
    }, 2000); // 2초마다 폴링

    // 클린업
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [userId, polling, connectionErrorCount]);

  // 연결 오류 발생 시 재시도 간격을 점진적으로 늘림
  useEffect(() => {
    if (connectionError && connectionErrorCount < 5) {
      const retryDelay = Math.min(
        1000 * Math.pow(2, connectionErrorCount),
        16000
      ); // 지수 백오프, 최대 16초

      retryTimeoutRef.current = setTimeout(() => {
        if (polling) {
          fetchStatus();
        }
      }, retryDelay);

      return () => {
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
        }
      };
    }
  }, [connectionError, connectionErrorCount, polling]);

  // 진행 상태에 따른 배경색 설정
  const getProgressColor = () => {
    if (status.error) return "bg-red-500";
    if (status.progress < 30) return "bg-blue-500";
    if (status.progress < 70) return "bg-yellow-500";
    return "bg-green-500";
  };

  return (
    <div className="p-4 border rounded-lg bg-white shadow-sm">
      <h3 className="text-lg font-semibold mb-2">네이버 로그인 상태</h3>

      {/* 상태 메시지 */}
      <p className="mb-2">{status.message}</p>

      {/* 진행 상태바 */}
      <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
        <div
          className={`h-2.5 rounded-full ${getProgressColor()}`}
          style={{ width: `${status.progress}%` }}
        ></div>
      </div>

      {/* 진행률 */}
      <p className="text-sm text-gray-600 mb-2">
        진행률: {status.progress}%{status.step && ` (${status.step})`}
      </p>

      {/* 연결 오류 메시지 */}
      {connectionError && (
        <div className="mt-2 p-2 bg-yellow-100 text-yellow-800 rounded">
          서버 연결 오류가 발생했습니다. {connectionErrorCount}회 재시도 중...
        </div>
      )}

      {/* 오류 메시지 */}
      {status.error && (
        <div className="mt-2 p-2 bg-red-100 text-red-800 rounded">
          {status.error}
        </div>
      )}

      {/* 타임스탬프 */}
      <p className="text-xs text-gray-500 mt-2">
        마지막 업데이트: {new Date(status.timestamp).toLocaleString()}
      </p>
    </div>
  );
}
