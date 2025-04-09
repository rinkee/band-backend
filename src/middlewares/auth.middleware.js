// src/middlewares/auth.middleware.js - 인증 관련 미들웨어
const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const authMiddleware = (req, res, next) => {
  // console.log("\n--- [authMiddleware 시작] ---"); // 구분선 추가
  // console.log("인증 미들웨어 통과 (개발 모드)"); // 개발 끝나면 제거
  // next(); // 개발 끝나면 제거

  // 실제 JWT 인증 로직 활성화
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      // console.log("[authMiddleware] 실패: 헤더 없음 또는 형식 오류");
      return res.status(401).json({
        success: false,
        message: "유효한 인증 토큰이 필요합니다 (헤더 없음 또는 형식 오류).",
        isAuthenticated: false,
      });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      // console.log("[authMiddleware] 실패: 토큰 없음");
      return res.status(401).json({
        success: false,
        message: "토큰이 제공되지 않았습니다.",
        isAuthenticated: false,
      });
    }

    // JWT_SECRET 환경 변수 확인!
    const secretKey = process.env.JWT_SECRET;
    if (!secretKey) {
      // console.error("치명적 오류: JWT_SECRET 환경 변수가 설정되지 않았습니다.");
      return res
        .status(500)
        .json({ success: false, message: "서버 설정 오류." });
    }

    jwt.verify(token, secretKey, (err, decoded) => {
      if (err) {
        // console.error("[authMiddleware] 실패: JWT 검증 오류 -", err.message);
        let message = "인증 토큰이 유효하지 않습니다.";
        if (err.name === "TokenExpiredError") {
          message = "토큰이 만료되었습니다.";
        } else if (err.name === "JsonWebTokenError") {
          message = "토큰 형식이 잘못되었습니다.";
        }
        return res.status(401).json({
          success: false,
          message: message,
          isAuthenticated: false,
          error_details: err.message, // 디버깅을 위해 상세 에러 추가 (선택적)
        });
      }

      // console.log("[authMiddleware] 성공: JWT 검증 완료. req.user 설정:");
      // console.log(JSON.stringify(decoded, null, 2)); // 디코딩된 페이로드 전체 출력
      req.user = decoded; // <<< req.user에 디코딩된 페이로드 저장
      // console.log("--- [authMiddleware 종료] ---");
      next(); // 다음 미들웨어/핸들러로 이동
    });
  } catch (error) {
    // console.error("JWT 인증 처리 중 예외 발생:", error);
    return res.status(500).json({
      success: false,
      message: "인증 처리 중 서버 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

// requireAuth: 이제 req.user 존재 여부만 확인하면 됨
const requireAuth = (req, res, next) => {
  // console.log("\n--- [requireAuth 시작] ---");
  if (!req.user) {
    // console.log("[requireAuth] 실패: req.user 없음");
    // <<< req.session.userInfo 대신 req.user 확인
    return res.status(401).json({
      success: false,
      message: "로그인이 필요합니다 (req.user 없음).", // 메시지 명확화
      isAuthenticated: false,
    });
  }
  // console.log("[requireAuth] 통과: req.user 존재 확인");
  // console.log("--- [requireAuth 종료] ---");
  next();
};

// requireSelfOrAdmin: req.user 사용
const requireSelfOrAdmin = async (req, res, next) => {
  // console.log("\n--- [requireSelfOrAdmin 시작] ---");
  try {
    if (!req.user) {
      // <<< req.user 확인
      // console.log("[requireSelfOrAdmin] 실패: req.user 없음 (이전 미들웨어 문제?)");
      return res.status(401).json({
        success: false,
        message: "로그인이 필요합니다 (req.user 없음).",
        isAuthenticated: false,
      });
    }

    // <<< 중요 로그 추가 >>>
    const { role, userId: tokenUserId } = req.user;
    const targetUserId = req.params.userId;
    // console.log("[requireSelfOrAdmin] 검사 데이터:");
    // console.log("  - req.user (from token):", JSON.stringify(req.user, null, 2));
    // console.log("  - tokenUserId:", tokenUserId, `(Type: ${typeof tokenUserId})`);
    // console.log("  - role:", role, `(Type: ${typeof role})`);
    // console.log("  - targetUserId (from URL):", targetUserId, `(Type: ${typeof targetUserId})`);

    // 비교 조건 확인
    const isSelf = tokenUserId === targetUserId;
    const isAdmin = role === "admin";
    // console.log(`[requireSelfOrAdmin] 조건 확인: isSelf=${isSelf}, isAdmin=${isAdmin}`);

    if (isSelf || isAdmin) {
      // console.log("[requireSelfOrAdmin] 통과: 권한 확인됨 (자기 자신 또는 관리자)");
      // console.log("--- [requireSelfOrAdmin 종료] ---");
      return next();
    }

    // console.log("[requireSelfOrAdmin] 실패: 권한 없음 (Forbidden)");
    // console.log("--- [requireSelfOrAdmin 종료] ---");
    return res.status(403).json({
      success: false,
      message: "권한이 없습니다.",
    });
  } catch (error) {
    // console.error("[requireSelfOrAdmin] 오류:", error);
    return res.status(500).json({
      success: false,
      message: "인증 처리 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

// requireActiveUser: req.user 사용 및 Supabase 조회 로직 유지
const requireActiveUser = async (req, res, next) => {
  // console.log("\n--- [requireActiveUser 시작] ---");
  try {
    if (!req.user) {
      // <<< req.user 확인
      // console.log("[requireActiveUser] 실패: req.user 없음");
      return res.status(401).json({
        success: false,
        message: "로그인이 필요합니다 (req.user 없음).",
        isAuthenticated: false,
      });
    }

    // JWT 페이로드에서 사용자 식별자(userId 또는 loginId) 가져오기
    // 여기서는 Supabase PK인 'id'를 JWT에 'userId'로 넣었다고 가정
    const { userId } = req.user;
    // console.log(`[requireActiveUser] 사용자 상태 확인 시도: userId=${userId}`);
    // Supabase에서 사용자 상태 확인 (기존 로직 유지 가능)
    const { data: userData, error } = await supabase
      .from("users")
      .select("is_active") // is_active만 선택해도 됨
      .eq("user_id", userId) // JWT의 userId로 조회
      .single();

    // console.log("[requireActiveUser] Supabase 조회 결과:", { userData, error });
    if (error) {
      // console.error("[requireActiveUser] 실패: Supabase 사용자 조회 오류 -", error.message);
      return res.status(500).json({
        success: false,
        message: "인증 처리 중 오류가 발생했습니다.",
        error: error.message,
      });
    }

    if (!userData) {
      // 혹시 모를 경우 대비
      // console.error(`[requireActiveUser] 실패: Supabase에서 사용자 찾을 수 없음 - userId: ${userId}`);
      return res
        .status(404)
        .json({ success: false, message: "사용자 정보를 찾을 수 없습니다." });
    }
    if (userData.is_active !== true) {
      // console.log("[requireActiveUser] 실패: 사용자 비활성화");
      return res.status(403).json({
        success: false,
        message: "사용자 계정이 비활성화되었습니다.",
        isAuthenticated: false,
      });
    }

    const isActive = userData.is_active === true;
    // console.log(`[requireActiveUser] 사용자 활성 상태: ${isActive}`);

    if (!isActive) {
      // console.log("[requireActiveUser] 실패: 비활성화된 계정");
      // console.log("--- [requireActiveUser 종료] ---");
      return res.status(403).json({
        success: false,
        message: "비활성화된 계정입니다. 관리자에게 문의하세요.",
      });
    }

    // console.log("[requireActiveUser] 통과: 활성 사용자 확인됨");
    // console.log("--- [requireActiveUser 종료] ---");
    next();
  } catch (error) {
    // console.error("[requireActiveUser] 오류:", error);
    return res.status(500).json({
      success: false,
      message: "인증 처리 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

module.exports = {
  authMiddleware,
  authenticateJwt: authMiddleware, // 이전 이름과의 호환성을 위해 유지
  requireAuth,
  requireSelfOrAdmin,
  requireActiveUser,
};
