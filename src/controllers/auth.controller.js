// src/controllers/auth.controller.js - 인증 관련 컨트롤러
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const logger = require("../config/logger");
const { generateToken } = require("../utils/jwt");
const BaseCrawler = require("../services/crawler/base.crawler");

// Supabase 클라이언트 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * 네이버 로그인 상태를 저장할 맵 객체
 */
const naverLoginStatus = new Map();

const getUserData = async (req, res) => {
  try {
    // URL 파라미터에서 유저 ID 추출
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "유저 ID가 필요합니다.",
      });
    }

    // Supabase에서 특정 유저 정보 조회
    const { data, error } = await supabase
      .from("users")
      .select(
        `
        user_id,
        login_id,
          naver_id,
        store_name,
        store_address,
        owner_name,
        phone_number,
        band_url,
        band_id,
        is_active,
        created_at,
        last_login_at,
        last_crawl_at,
        product_count
      `
      )
      .eq("user_id", id)
      .single();

    // 오류 처리
    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          error: "해당 ID의 유저를 찾을 수 없습니다.",
        });
      }
      throw error;
    }

    // 민감한 정보 제거
    const { login_password, naver_password, ...safeUserData } = data;

    // 응답 반환
    return res.status(200).json(safeUserData);
  } catch (error) {
    logger.error(`유저 정보 조회 오류 (ID: ${req.params.id}):`, error);
    return res.status(500).json({
      success: false,
      error: "유저 정보를 불러오는 중 오류가 발생했습니다.",
    });
  }
};

/**
 * 네이버 로그인 상태 조회
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getNaverLoginStatus = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "사용자 ID가 필요합니다.",
      });
    }

    // 저장된 로그인 상태 조회
    const status = naverLoginStatus.get(userId) || {
      isProcessing: false,
      step: "idle",
      message: "로그인이 시작되지 않았습니다.",
      progress: 0,
      error: null,
      timestamp: new Date().toISOString(),
    };

    return res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error("네이버 로그인 상태 조회 오류:", error);
    return res.status(500).json({
      success: false,
      message: "네이버 로그인 상태 조회 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 네이버 로그인 상태 업데이트
 * @param {string} userId - 사용자 ID
 * @param {string} step - 현재 진행 단계
 * @param {string} message - 상태 메시지
 * @param {number} progress - 진행률 (0-100)
 * @param {string|null} error - 오류 메시지 (있는 경우)
 */
const updateNaverLoginStatus = (
  userId,
  step,
  message,
  progress,
  error = null
) => {
  const status = {
    isProcessing: progress < 100 && !error,
    step,
    message,
    progress,
    error,
    timestamp: new Date().toISOString(),
  };

  naverLoginStatus.set(userId, status);
  console.log(
    `네이버 로그인 상태 업데이트 [${userId}]: ${step} (${progress}%) - ${message}`
  );

  // 완료 또는 오류 상태인 경우 일정 시간 후 상태 정보 삭제
  if (progress >= 100 || error) {
    setTimeout(() => {
      naverLoginStatus.delete(userId);
    }, 5 * 60 * 1000); // 5분 후 상태 정보 삭제
  }
};

/**
 * 회원가입 처리
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const register = async (req, res) => {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ success: false, message: "허용되지 않는 메소드" });
  }

  try {
    const {
      loginId,
      loginPassword,
      naverId,
      naverPassword,
      bandUrl,
      storeName,
      storeAddress,
      ownerName,
      phoneNumber,
    } = req.body;

    // 데이터 검증
    if (!loginId || !loginPassword || !bandUrl || !storeName) {
      return res.status(400).json({
        success: false,
        message: "필수 정보가 누락되었습니다.",
      });
    }

    // 밴드 URL 유효성 검증
    if (!bandUrl.includes("band.us") && !bandUrl.includes("band.com")) {
      return res.status(400).json({
        success: false,
        message: "유효한 밴드 URL이 아닙니다.",
      });
    }

    // 밴드 ID 추출 (URL에서)
    const bandIdMatch = bandUrl.match(
      /band\.us\/band\/(\d+)|band\.com\/band\/(\d+)/
    );
    const bandId = bandIdMatch ? bandIdMatch[1] || bandIdMatch[2] : null;

    if (!bandId) {
      return res.status(400).json({
        success: false,
        message: "밴드 URL에서 ID를 추출할 수 없습니다.",
      });
    }

    // 기존 사용자 확인
    const { data: existingUser, error: checkError } = await supabase
      .from("users")
      .select("user_id")
      .eq("login_id", loginId)
      .single();

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "이미 사용 중인 아이디입니다.",
      });
    }
    const userId = crypto.randomUUID();
    // 사용자 정보 저장
    const { data: userData, error: userError } = await supabase
      .from("users")
      .insert([
        {
          user_id: userId,
          login_id: loginId,
          login_password: loginPassword,
          naver_id: naverId || null,
          naver_password: naverPassword || null,
          is_active: true,
          store_name: storeName,
          store_address: storeAddress || null,
          owner_name: ownerName || loginId,
          phone_number: phoneNumber || null,
          band_url: bandUrl,
          band_id: bandId,
          settings: {
            notificationEnabled: true,
            autoConfirmOrders: false,
            theme: "light",
          },
          subscription: {
            plan: "free",
            status: "active",
            expireDate: null,
            paymentMethod: null,
          },
        },
      ])
      .select()
      .single();

    if (userError) {
      return res.status(400).json({
        success: false,
        message: "사용자 정보 저장 실패",
        error: userError.message,
      });
    }

    console.log(
      `사용자 ${loginId} 회원가입 완료, 사용자 ID: ${userData.user_id}`
    );

    return res.status(201).json({
      success: true,
      message: "회원가입이 완료되었습니다.",
      data: {
        userId: userData.user_id,
        loginId: userData.login_id,
        storeName: userData.store_name,
        bandId: userData.band_id,
      },
    });
  } catch (error) {
    console.error("회원가입 오류:", error);
    return res.status(500).json({
      success: false,
      message: "회원가입 처리 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 로그인 처리
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const login = async (req, res) => {
  try {
    const { loginId, loginPassword } = req.body;
    console.log("로그인 시도:", { loginId, loginPassword });

    // 사용자 정보 조회
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("login_id", loginId)
      .single();

    console.log("사용자 조회 결과:", { userData, userError });

    if (userError || !userData) {
      return res.status(401).json({
        success: false,
        message: "아이디 또는 비밀번호가 올바르지 않습니다.",
      });
    }

    // 비밀번호 검증
    console.log("비밀번호 비교:", {
      inputPassword: loginPassword,
      storedPassword: userData.login_password,
      isMatch: userData.login_password === loginPassword,
    });

    if (userData.login_password !== loginPassword) {
      return res.status(401).json({
        success: false,
        message: "아이디 또는 비밀번호가 올바르지 않습니다.",
      });
    }

    // JWT 토큰 생성
    const token = generateToken({
      userId: userData.userId,
      loginId: userData.login_id,
      role: userData.role,
    });

    // 응답 데이터에 전체 사용자 정보 포함
    return res.json({
      success: true,
      message: "로그인 성공",
      token,
      user: {
        userId: userData.user_id,
        loginId: userData.login_id,
        storeName: userData.store_name,
        storeAddress: userData.store_address,
        ownerName: userData.owner_name,
        phoneNumber: userData.phone_number,
        bandUrl: userData.band_url,
        bandId: userData.band_id,
        naverId: userData.naver_id,
        isActive: userData.is_active,
        settings: userData.settings,
        subscription: userData.subscription,
        createdAt: userData.created_at,
        updatedAt: userData.updated_at,
      },
    });
  } catch (error) {
    console.error("로그인 오류:", error);
    return res.status(500).json({
      success: false,
      message: "로그인 처리 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 네이버 ID/비밀번호 업데이트
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const updateNaverCredentials = async (req, res) => {
  try {
    const { userId } = req.params;
    const { naverId, naverPassword } = req.body;

    if (!userId || !naverId || !naverPassword) {
      return res.status(400).json({
        success: false,
        message: "필수 정보가 누락되었습니다.",
      });
    }

    // 현재 로그인한 사용자와 요청한 사용자가 동일한지 확인
    if (req.session.userInfo?.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: "권한이 없습니다.",
      });
    }

    const { data: userData, error: userError } = await supabase
      .from("users")
      .update({
        naver_id: naverId,
        naver_password: naverPassword,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .select()
      .single();

    if (userError) {
      return res.status(500).json({
        success: false,
        message: "네이버 계정 정보 업데이트 실패",
        error: userError.message,
      });
    }

    return res.json({
      success: true,
      message: "네이버 계정 정보가 업데이트되었습니다.",
    });
  } catch (error) {
    console.error("네이버 계정 업데이트 오류:", error);
    return res.status(500).json({
      success: false,
      message: "네이버 계정 정보 업데이트 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 현재 로그인 상태 확인
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const checkAuth = async (req, res) => {
  try {
    // 세션에서 사용자 정보 확인
    if (!req.session.userInfo) {
      return res.status(401).json({
        success: false,
        message: "로그인이 필요합니다.",
        isAuthenticated: false,
      });
    }

    const { userId } = req.session.userInfo;

    // 사용자 정보 가져오기
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (userError) {
      // 세션은 있지만 사용자 정보가 없는 경우
      req.session.destroy();
      return res.status(401).json({
        success: false,
        message: "사용자 정보를 찾을 수 없습니다.",
        isAuthenticated: false,
      });
    }

    // 비활성화된 계정 확인
    if (userData.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "비활성화된 계정입니다.",
        isAuthenticated: false,
      });
    }

    // 응답 데이터 구성 (민감한 정보 제외)
    const responseData = {
      userId,
      loginId: userData.login_id,
      storeName: userData.store_name,
      storeAddress: userData.store_address,
      ownerName: userData.owner_name,
      phoneNumber: userData.phone_number,
      bandUrl: userData.band_url,
      bandId: userData.band_id,
      role: userData.role,
      settings: userData.settings,
      isActive: userData.isActive,
      createdAt: userData.createdAt.toDate(),
      lastLoginAt: userData.last_login_at.toDate(),
      lastCrawlAt: userData.lastCrawlAt ? userData.lastCrawlAt.toDate() : null,
      productCount: userData.productCount || 0,
    };

    return res.json({
      success: true,
      message: "인증 상태가 유효합니다.",
      isAuthenticated: true,
      data: responseData,
    });
  } catch (error) {
    console.error("인증 확인 오류:", error);
    return res.status(500).json({
      success: false,
      message: "인증 상태 확인 중 오류가 발생했습니다.",
      error: error.message,
      isAuthenticated: false,
    });
  }
};

/**
 * 로그아웃 처리
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const logout = (req, res) => {
  try {
    // 세션 삭제
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "로그아웃 처리 중 오류가 발생했습니다.",
          error: err.message,
        });
      }

      return res.json({
        success: true,
        message: "로그아웃되었습니다.",
      });
    });
  } catch (error) {
    console.error("로그아웃 오류:", error);
    return res.status(500).json({
      success: false,
      message: "로그아웃 처리 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 사용자 프로필 업데이트
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const updateProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const { storeName, storeAddress, ownerName, phoneNumber, bandUrl } =
      req.body;

    // 권한 확인
    if (req.session.userInfo?.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: "권한이 없습니다.",
      });
    }

    const { data: userData, error: userError } = await supabase
      .from("users")
      .update({
        store_name: storeName,
        store_address: storeAddress,
        owner_name: ownerName,
        phone_number: phoneNumber,
        band_url: bandUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .select()
      .single();

    if (userError) {
      return res.status(500).json({
        success: false,
        message: "사용자 정보 업데이트 실패",
        error: userError.message,
      });
    }

    // 업데이트된 사용자 정보 조회
    const { data: updatedUserData, error: updatedUserError } = await supabase
      .from("users")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (updatedUserError) {
      return res.status(500).json({
        success: false,
        message: "업데이트된 사용자 정보 조회 실패",
        error: updatedUserError.message,
      });
    }

    // 응답 데이터 구성
    const responseData = {
      userId,
      storeName: updatedUserData.store_name,
      storeAddress: updatedUserData.store_address,
      ownerName: updatedUserData.owner_name,
      phoneNumber: updatedUserData.phone_number,
      bandUrl: updatedUserData.band_url,
      bandId: updatedUserData.band_id,
      updatedAt: updatedUserData.updated_at.toDate(),
    };

    return res.json({
      success: true,
      message: "프로필이 업데이트되었습니다.",
      data: responseData,
    });
  } catch (error) {
    console.error("프로필 업데이트 오류:", error);
    return res.status(500).json({
      success: false,
      message: "프로필 업데이트 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 로그인 비밀번호 변경
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const updateLoginPassword = async (req, res) => {
  try {
    const { userId } = req.params;
    const { currentPassword, newPassword } = req.body;

    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "필수 정보가 누락되었습니다.",
      });
    }

    // 현재 로그인한 사용자와 요청한 사용자가 동일한지 확인
    if (req.session.userInfo?.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: "권한이 없습니다.",
      });
    }

    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (userError) {
      return res.status(500).json({
        success: false,
        message: "사용자 정보 조회 실패",
      });
    }

    // 현재 비밀번호 확인
    if (userData.login_password !== currentPassword) {
      return res.status(401).json({
        success: false,
        message: "현재 비밀번호가 일치하지 않습니다.",
      });
    }

    // 비밀번호 변경
    const { data: updatedUserData, error: updateError } = await supabase
      .from("users")
      .update({
        login_password: newPassword,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: "비밀번호 변경 실패",
        error: updateError.message,
      });
    }

    return res.json({
      success: true,
      message: "비밀번호가 변경되었습니다.",
    });
  } catch (error) {
    console.error("비밀번호 변경 오류:", error);
    return res.status(500).json({
      success: false,
      message: "비밀번호 변경 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 네이버 로그인 처리
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const naverLogin = async (req, res) => {
  try {
    const { userId, bandId } = req.body;

    if (!userId || !bandId) {
      return res.status(400).json({
        success: false,
        message: "사용자 ID와 밴드 ID는 필수 값입니다.",
      });
    }

    // Supabase에서 사용자 정보 조회
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (userError) {
      return res.status(404).json({
        success: false,
        message: "사용자를 찾을 수 없습니다.",
      });
    }

    // 네이버 계정 정보 확인
    if (!userData.naver_id || !userData.naver_password) {
      return res.status(400).json({
        success: false,
        message: "네이버 계정 정보가 설정되지 않았습니다.",
      });
    }

    // 로그인 상태 업데이트
    naverLoginStatus.set(userId, {
      status: "processing",
      message: "로그인 시도 중...",
      timestamp: Date.now(),
    });

    // 백그라운드에서 로그인 처리
    const crawler = new BaseCrawler();

    try {
      // initialize 메서드 호출 (init이 아님)
      const initResult = await crawler.initialize(
        userData.naver_id,
        userData.naver_password
      );

      if (!initResult) {
        throw new Error("크롤러 초기화 실패");
      }

      // login 메서드는 boolean 값을 반환
      const loginSuccess = await crawler.naverLogin(
        userData.naver_id,
        userData.naver_password
      );

      if (loginSuccess) {
        // 쿠키 저장
        const cookies = await crawler.browser.cookies();
        await crawler.saveCookies(userData.naver_id, cookies);

        // Supabase에서 사용자 정보 업데이트
        await supabase
          .from("users")
          .update({
            last_naver_login: new Date().toISOString(),
            naver_login_status: "success",
          })
          .eq("user_id", userId);

        naverLoginStatus.set(userId, {
          status: "success",
          message: "로그인 성공",
          timestamp: Date.now(),
        });

        res.json({
          success: true,
          message: "네이버 로그인 성공",
          user: {
            id: userData.user_id,
            email: userData.login_id,
            name: userData.owner_name,
          },
          cookieCount: cookies ? cookies.length : 0,
        });
      } else {
        throw new Error("네이버 로그인 실패");
      }
    } catch (error) {
      naverLoginStatus.set(userId, {
        status: "error",
        message: error.message,
        timestamp: Date.now(),
      });
      throw error;
    } finally {
      await crawler.close();
    }
  } catch (error) {
    console.error("네이버 로그인 실패:", error);
    res.status(500).json({
      success: false,
      message: error.message || "네이버 로그인 처리 중 오류가 발생했습니다.",
    });
  }
};

/**
 * 네이버 계정 설정
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const setNaverAccount = async (req, res) => {
  try {
    const { userId, naverId, naverPassword } = req.body;

    if (!userId || !naverId || !naverPassword) {
      return res.status(400).json({
        success: false,
        message: "모든 필드가 필요합니다.",
      });
    }

    // Supabase에서 사용자 정보 업데이트
    const { data: userData, error: userError } = await supabase
      .from("users")
      .update({
        naver_id: naverId,
        naver_password: naverPassword,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .select()
      .single();

    if (userError) {
      return res.status(500).json({
        success: false,
        message: "네이버 계정 정보 저장 실패",
        error: userError.message,
      });
    }

    res.json({
      success: true,
      message: "네이버 계정 정보가 저장되었습니다.",
    });
  } catch (error) {
    logger.error("네이버 계정 설정 실패:", error);
    res.status(500).json({
      success: false,
      message: "네이버 계정 정보 저장 중 오류가 발생했습니다.",
    });
  }
};

/**
 * 네이버 로그인 상태 확인
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const checkNaverLoginStatus = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "사용자 ID가 필요합니다.",
      });
    }

    const status = naverLoginStatus.get(userId);

    if (!status) {
      return res.json({
        success: true,
        status: "not_started",
        message: "로그인 시도가 없습니다.",
      });
    }

    res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    logger.error("네이버 로그인 상태 확인 실패:", error);
    res.status(500).json({
      success: false,
      message: "네이버 로그인 상태 확인 중 오류가 발생했습니다.",
    });
  }
};

module.exports = {
  getUserData,
  register,
  login,
  updateNaverCredentials,
  checkAuth,
  logout,
  updateProfile,
  updateLoginPassword,
  naverLogin,
  setNaverAccount,
  getNaverLoginStatus,
  checkNaverLoginStatus,
};
