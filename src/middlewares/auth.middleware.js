// src/middlewares/auth.middleware.js - 인증 관련 미들웨어
const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * JWT 인증 미들웨어
 * 개발 편의를 위해 항상 통과시키도록 임시 설정
 */
const authenticateJwt = (req, res, next) => {
  // 개발 중에는 인증 검증을 건너뛰고 항상 통과
  console.log("인증 미들웨어 통과 (개발 모드)");
  next();

  // 실제 JWT 인증 로직 (추후 활성화)
  /*
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: "유효한 인증 토큰이 필요합니다.",
        isAuthenticated: false,
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        success: false, 
        message: "토큰이 제공되지 않았습니다.",
        isAuthenticated: false,
      });
    }

    const secretKey = process.env.JWT_SECRET || 'band-manager-secret-key';
    jwt.verify(token, secretKey, (err, decoded) => {
      if (err) {
        return res.status(401).json({
          success: false,
          message: "인증 토큰이 유효하지 않습니다: " + err.message,
          isAuthenticated: false,
        });
      }

      req.user = decoded;
      next();
    });
  } catch (error) {
    console.error("JWT 인증 오류:", error);
    return res.status(500).json({
      success: false,
      message: "인증 처리 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
  */
};

/**
 * 로그인 상태 확인 미들웨어
 * 로그인하지 않은 사용자는 401 에러로 응답
 */
const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.userInfo) {
    return res.status(401).json({
      success: false,
      message: "로그인이 필요합니다.",
      isAuthenticated: false,
    });
  }
  next();
};

/**
 * 관리자 권한 확인 미들웨어
 * 관리자가 아닌 사용자는 403 에러로 응답
 */
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.session || !req.session.userInfo) {
      return res.status(401).json({
        success: false,
        message: "로그인이 필요합니다.",
        isAuthenticated: false,
      });
    }

    const { userId } = req.session.userInfo;
    const { data: userData, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        message: "사용자 정보를 찾을 수 없습니다.",
      });
    }

    if (userData.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "관리자 권한이 필요합니다.",
      });
    }

    next();
  } catch (error) {
    console.error("권한 확인 오류:", error);
    return res.status(500).json({
      success: false,
      message: "권한 확인 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 요청된 userId가 현재 로그인한 사용자와 동일한지 또는 관리자인지 확인하는 미들웨어
 */
const requireSelfOrAdmin = async (req, res, next) => {
  try {
    if (!req.session || !req.session.userInfo) {
      return res.status(401).json({
        success: false,
        message: "로그인이 필요합니다.",
        isAuthenticated: false,
      });
    }

    const { userId, role } = req.session.userInfo;

    // URL 파라미터에서 대상 userId 확인
    const targetUserId = req.params.userId;

    // 자기 자신이거나 관리자인 경우 허용
    if (userId === targetUserId || role === "admin") {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: "권한이 없습니다.",
    });
  } catch (error) {
    console.error("권한 확인 오류:", error);
    return res.status(500).json({
      success: false,
      message: "권한 확인 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 사용자가 활성 상태인지 확인하는 미들웨어
 */
const requireActiveUser = async (req, res, next) => {
  try {
    if (!req.session || !req.session.userInfo) {
      return res.status(401).json({
        success: false,
        message: "로그인이 필요합니다.",
        isAuthenticated: false,
      });
    }

    const { userId } = req.session.userInfo;
    const { data: userData, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        message: "사용자 정보를 찾을 수 없습니다.",
      });
    }

    if (userData.is_active !== true) {
      return res.status(403).json({
        success: false,
        message: "비활성화된 계정입니다. 관리자에게 문의하세요.",
      });
    }

    next();
  } catch (error) {
    console.error("사용자 상태 확인 오류:", error);
    return res.status(500).json({
      success: false,
      message: "사용자 상태 확인 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

module.exports = {
  authenticateJwt,
  requireAuth,
  requireAdmin,
  requireSelfOrAdmin,
  requireActiveUser,
};
