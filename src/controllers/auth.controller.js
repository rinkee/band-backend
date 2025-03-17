// src/controllers/auth.controller.js - 인증 관련 컨트롤러
const {
  getFirebaseDb,
  getFirebaseAuth,
} = require("../services/firebase.service");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

/**
 * 비밀번호 암호화 함수
 * @param {string} password - 암호화할 비밀번호
 * @returns {Promise<string>} - 암호화된 비밀번호
 */
const encryptPassword = async (password) => {
  return await bcrypt.hash(password, 10);
};

/**
 * 비밀번호 검증 함수
 * @param {string} password - 검증할 비밀번호
 * @param {string} hashedPassword - 암호화된 비밀번호
 * @returns {Promise<boolean>} - 검증 결과
 */
const verifyPassword = async (password, hashedPassword) => {
  return await bcrypt.compare(password, hashedPassword);
};

/**
 * 네이버 로그인 상태를 저장할 맵 객체
 */
const naverLoginStatus = new Map();

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

    // Firebase Firestore 서비스 호출
    const db = getFirebaseDb();

    // 기존 사용자 확인
    const userSnapshot = await db
      .collection("users")
      .where("loginId", "==", loginId)
      .get();
    if (!userSnapshot.empty) {
      return res.status(400).json({
        success: false,
        message: "이미 사용 중인 아이디입니다.",
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

    // 사용자 정보 생성
    const userRef = db.collection("users").doc();
    const userId = userRef.id;

    // 새로운 사용자 데이터 구조에 맞게 저장
    await userRef.set({
      // 기본 정보
      loginId: loginId,
      loginPassword: loginPassword, // 평문 비밀번호 저장
      naverId: naverId || null,
      naverPassword: naverPassword, //

      // 서비스 상태
      isActive: true,

      // 가게/밴드 정보
      storeName: storeName,
      storeAddress: storeAddress || "",
      ownerName: ownerName || loginId,
      phoneNumber: phoneNumber || "",
      bandUrl: bandUrl,
      bandId: bandId,

      // 권한 및 설정
      role: "admin",
      settings: {
        notificationEnabled: true,
        autoConfirmOrders: false,
        theme: "default",
      },

      // 통계 및 메타데이터
      createdAt: new Date(),
      lastLoginAt: new Date(),
      lastCrawlAt: null,
      productCount: 0,
    });

    console.log(`사용자 ${loginId} 회원가입 완료, 사용자 ID: ${userId}`);

    return res.status(201).json({
      success: true,
      message: "회원가입이 완료되었습니다.",
      data: {
        userId,
        loginId,
        storeName,
        bandId,
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

    if (!loginId || !loginPassword) {
      return res.status(400).json({
        success: false,
        message: "아이디와 비밀번호를 입력해주세요.",
      });
    }

    const db = getFirebaseDb();

    // 사용자 조회 - loginID로만 조회
    const usersRef = db.collection("users");
    const snapshot = await usersRef.where("loginId", "==", loginId).get();

    if (snapshot.empty) {
      return res.status(401).json({
        success: false,
        message: "존재하지 않는 사용자입니다.",
      });
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();

    // 비밀번호 확인
    let isPasswordValid = false;

    // 기존 암호화된 패스워드가 있는 경우 처리
    if (userData.loginPassword.startsWith("$2")) {
      // 암호화된 패스워드인 경우 bcrypt로 검증
      isPasswordValid = await verifyPassword(
        loginPassword,
        userData.loginPassword
      );

      // 검증 성공 시 평문으로 업데이트
      if (isPasswordValid) {
        await userDoc.ref.update({
          loginPassword: loginPassword,
        });
        console.log(
          `사용자 ${loginId}의 비밀번호를 평문으로 마이그레이션했습니다.`
        );
      }
    } else {
      // 평문 비밀번호인 경우 직접 비교
      isPasswordValid = userData.loginPassword === loginPassword;
    }

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "비밀번호가 일치하지 않습니다.",
      });
    }

    // 계정 활성화 상태 확인
    if (userData.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "비활성화된 계정입니다. 관리자에게 문의하세요.",
      });
    }

    // 세션에 사용자 정보 저장 (민감한 정보 제외)
    const sessionData = {
      userId: userDoc.id,
      loginId: userData.loginId,
      bandId: userData.bandId,
      storeName: userData.storeName,
      role: userData.role,
    };

    req.session.userInfo = sessionData;

    // 마지막 로그인 시간 업데이트
    await userDoc.ref.update({
      lastLoginAt: new Date(),
    });

    // 응답 데이터 구성
    const responseData = {
      userId: userDoc.id,
      loginId: userData.loginId,
      naverId: userData.naverId,
      storeName: userData.storeName,
      storeAddress: userData.storeAddress,
      ownerName: userData.ownerName,
      phoneNumber: userData.phoneNumber,
      bandUrl: userData.bandUrl,
      bandId: userData.bandId,
      role: userData.role,
      settings: userData.settings,
      isActive: userData.isActive,
      createdAt: userData.createdAt.toDate(),
      lastLoginAt: new Date(),
      lastCrawlAt: userData.lastCrawlAt ? userData.lastCrawlAt.toDate() : null,
      productCount: userData.productCount || 0,
    };

    return res.json({
      success: true,
      message: "로그인이 완료되었습니다.",
      data: responseData,
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

    const db = getFirebaseDb();
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "사용자를 찾을 수 없습니다.",
      });
    }

    // 네이버 ID와 비밀번호 업데이트
    await userRef.update({
      naverId: naverId,
      naverPassword: naverPassword,
      updatedAt: new Date(),
    });

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
    const db = getFirebaseDb();
    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      // 세션은 있지만 사용자 정보가 없는 경우
      req.session.destroy();
      return res.status(401).json({
        success: false,
        message: "사용자 정보를 찾을 수 없습니다.",
        isAuthenticated: false,
      });
    }

    const userData = userDoc.data();

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
      loginId: userData.loginId,
      storeName: userData.storeName,
      storeAddress: userData.storeAddress,
      ownerName: userData.ownerName,
      phoneNumber: userData.phoneNumber,
      bandUrl: userData.bandUrl,
      bandId: userData.bandId,
      role: userData.role,
      settings: userData.settings,
      isActive: userData.isActive,
      createdAt: userData.createdAt.toDate(),
      lastLoginAt: userData.lastLoginAt.toDate(),
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

    const db = getFirebaseDb();
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "사용자를 찾을 수 없습니다.",
      });
    }

    // 업데이트할 데이터 구성
    const updateData = {
      updatedAt: new Date(),
    };

    // 선택적 필드들은 제공된 경우에만 업데이트
    if (storeName) updateData.storeName = storeName;
    if (storeAddress) updateData.storeAddress = storeAddress;
    if (ownerName) updateData.ownerName = ownerName;
    if (phoneNumber) updateData.phoneNumber = phoneNumber;

    // 밴드 URL이 변경된 경우, 밴드 ID 업데이트
    if (bandUrl) {
      updateData.bandUrl = bandUrl;

      // 밴드 ID 추출
      const bandIdMatch = bandUrl.match(
        /band\.us\/band\/(\d+)|band\.com\/band\/(\d+)/
      );
      const bandId = bandIdMatch ? bandIdMatch[1] || bandIdMatch[2] : null;

      if (bandId) {
        updateData.bandId = bandId;
      } else {
        return res.status(400).json({
          success: false,
          message: "유효한 밴드 URL이 아닙니다.",
        });
      }
    }

    // 사용자 정보 업데이트
    await userRef.update(updateData);

    // 업데이트된 사용자 정보 조회
    const updatedUserDoc = await userRef.get();
    const updatedUserData = updatedUserDoc.data();

    // 응답 데이터 구성
    const responseData = {
      userId,
      storeName: updatedUserData.storeName,
      storeAddress: updatedUserData.storeAddress,
      ownerName: updatedUserData.ownerName,
      phoneNumber: updatedUserData.phoneNumber,
      bandUrl: updatedUserData.bandUrl,
      bandId: updatedUserData.bandId,
      updatedAt: updatedUserData.updatedAt.toDate(),
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

    const db = getFirebaseDb();
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "사용자를 찾을 수 없습니다.",
      });
    }

    const userData = userDoc.data();

    // 현재 비밀번호 확인
    let isCurrentPasswordValid = false;

    // 암호화된 패스워드인 경우 bcrypt로 검증
    if (userData.loginPassword.startsWith("$2")) {
      isCurrentPasswordValid = await verifyPassword(
        currentPassword,
        userData.loginPassword
      );
    } else {
      // 평문 비밀번호인 경우 직접 비교
      isCurrentPasswordValid = userData.loginPassword === currentPassword;
    }

    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "현재 비밀번호가 일치하지 않습니다.",
      });
    }

    // 비밀번호 변경 (평문으로 저장)
    await userRef.update({
      loginPassword: newPassword,
      updatedAt: new Date(),
    });

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
        message: "사용자 ID와 밴드 ID가 필요합니다.",
      });
    }

    // 이미 로그인 진행 중인지 확인
    const currentStatus = naverLoginStatus.get(userId);
    if (currentStatus && currentStatus.isProcessing) {
      return res.status(409).json({
        success: false,
        message: "이미 네이버 로그인이 진행 중입니다.",
        data: currentStatus,
      });
    }

    // 로그인 시작 상태 업데이트
    updateNaverLoginStatus(userId, "init", "네이버 로그인을 시작합니다.", 0);

    // Firebase에서 사용자 정보 조회
    const db = getFirebaseDb();
    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      updateNaverLoginStatus(
        userId,
        "error",
        "사용자를 찾을 수 없습니다.",
        0,
        "사용자를 찾을 수 없습니다."
      );
      return res.status(404).json({
        success: false,
        message: "사용자를 찾을 수 없습니다.",
      });
    }

    updateNaverLoginStatus(
      userId,
      "user_found",
      "사용자 정보를 확인했습니다.",
      10
    );
    const userData = userDoc.data();

    // 데이터베이스에서 사용자의 네이버 계정 정보 확인
    if (!userData.naverId || !userData.naverPassword) {
      updateNaverLoginStatus(
        userId,
        "error",
        "네이버 계정 정보가 설정되지 않았습니다.",
        10,
        "네이버 계정 정보가 설정되지 않았습니다."
      );
      return res.status(400).json({
        success: false,
        message: "네이버 계정 정보가 설정되지 않았습니다.",
      });
    }

    updateNaverLoginStatus(
      userId,
      "account_verified",
      "네이버 계정 정보가 확인되었습니다.",
      20
    );

    // 현재 사용자의 밴드 ID와 요청된 밴드 ID 확인
    if (userData.bandId !== bandId) {
      updateNaverLoginStatus(
        userId,
        "error",
        "밴드 ID가 일치하지 않습니다.",
        20,
        "요청된 밴드 ID가 사용자의 밴드 ID와 일치하지 않습니다."
      );
      return res.status(400).json({
        success: false,
        message: "요청된 밴드 ID가 사용자의 밴드 ID와 일치하지 않습니다.",
      });
    }

    updateNaverLoginStatus(
      userId,
      "band_verified",
      "밴드 ID가 확인되었습니다.",
      30
    );

    // 네이버 계정 정보 로그 (ID는 표시하되 비밀번호는 마스킹)
    console.log(`네이버 로그인 시도: ${userData.naverId}, 밴드 ID: ${bandId}`);

    // 네이버 비밀번호는 항상 평문으로 저장되어 있다고 가정
    const naverPassword = userData.naverPassword;

    updateNaverLoginStatus(
      userId,
      "password_verified",
      "계정 정보 검증이 완료되었습니다.",
      40
    );

    // 로그인 진행 상태 먼저 반환
    res.json({
      success: true,
      message: "네이버 로그인이 진행 중입니다. 상태를 확인해주세요.",
      data: {
        userId: userId,
        bandId: bandId,
        isProcessing: true,
        statusUrl: `/api/auth/users/${userId}/naver-login-status`,
      },
    });

    // 크롤러 인스턴스 생성 및 로그인 처리
    const BaseCrawler = require("../services/crawler/base.crawler");
    const crawler = new BaseCrawler();

    try {
      // 브라우저 초기화 (이 과정에서 저장된 쿠키로 로그인 시도)
      updateNaverLoginStatus(
        userId,
        "browser_init",
        "브라우저를 초기화하고 있습니다.",
        50
      );
      const initializeResult = await crawler.initialize(
        userData.naverId,
        naverPassword
      );

      // initialize 결과가 true인 경우, 이미 로그인 성공했으므로
      // 추가적인 로그인 과정은 필요 없음
      if (initializeResult) {
        updateNaverLoginStatus(
          userId,
          "login_success",
          "이미 저장된 쿠키로 로그인되었습니다.",
          60
        );
      } else {
        // 초기화 과정에서 로그인되지 않은 경우에만 로그인 시도
        updateNaverLoginStatus(
          userId,
          "login_attempt",
          "네이버 로그인을 시도하고 있습니다.",
          60
        );
        const loginResult = await crawler.login(
          userData.naverId,
          naverPassword
        );

        if (!loginResult) {
          await crawler.close(); // 브라우저 종료
          updateNaverLoginStatus(
            userId,
            "error",
            "네이버 로그인에 실패했습니다.",
            60,
            "네이버 로그인에 실패했습니다. 계정 정보를 확인해주세요."
          );
          return; // 응답은 이미 반환되었으므로 여기서 종료
        }
      }

      // 쿠키 저장
      updateNaverLoginStatus(
        userId,
        "cookies_fetching",
        "로그인 쿠키를 가져오고 있습니다.",
        70
      );
      const cookies = await crawler.page.cookies();
      const bandCookies = cookies.filter(
        (c) => c.domain.includes("band.us") || c.domain.includes("band.com")
      );

      updateNaverLoginStatus(
        userId,
        "cookies_saved",
        "로그인 쿠키가 저장되었습니다.",
        80
      );
      console.log(
        `네이버 로그인 성공: ${userData.naverId}, 밴드 쿠키: ${bandCookies.length}개`
      );

      // 마지막 로그인 시간 업데이트
      updateNaverLoginStatus(
        userId,
        "updating_user",
        "사용자 정보를 업데이트하고 있습니다.",
        90
      );
      await userDoc.ref.update({
        lastLoginAt: new Date(),
        lastNaverLoginAt: new Date(),
      });

      // 브라우저 종료
      updateNaverLoginStatus(
        userId,
        "browser_closing",
        "브라우저를 종료하고 있습니다.",
        95
      );
      await crawler.close();

      // 완료 상태 업데이트
      updateNaverLoginStatus(
        userId,
        "completed",
        "네이버 로그인이 완료되었습니다.",
        100,
        null
      );
    } catch (crawlerError) {
      console.error("크롤러 오류:", crawlerError);

      // 브라우저 종료 시도
      try {
        if (crawler && crawler.browser) {
          await crawler.close();
        }
      } catch (closeError) {
        console.error("브라우저 종료 오류:", closeError);
      }

      updateNaverLoginStatus(
        userId,
        "error",
        "네이버 로그인 처리 중 오류가 발생했습니다.",
        0,
        crawlerError.message
      );
    }
  } catch (error) {
    console.error("네이버 로그인 오류:", error);
    updateNaverLoginStatus(
      userId,
      "error",
      "네이버 로그인 처리 중 오류가 발생했습니다.",
      0,
      error.message
    );
  }
};

/**
 * 네이버 계정 정보 설정
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const setNaverAccount = async (req, res) => {
  try {
    const { userId, naverId, naverPassword } = req.body;

    if (!userId || !naverId || !naverPassword) {
      return res.status(400).json({
        success: false,
        message: "사용자 ID, 네이버 ID, 네이버 비밀번호가 모두 필요합니다.",
      });
    }

    // Firebase에서 사용자 정보 조회
    const db = getFirebaseDb();
    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "사용자를 찾을 수 없습니다.",
      });
    }

    console.log(`네이버 계정 정보 설정: ${naverId} (${userId})`);

    // 네이버 비밀번호는 평문으로 저장합니다.
    // 이는 네이버 로그인 자동화 및 크롤링을 위해 필요합니다.
    await userDoc.ref.update({
      naverId: naverId,
      naverPassword: naverPassword,
      naverAccountUpdatedAt: new Date(),
    });

    return res.json({
      success: true,
      message: "네이버 계정 정보가 설정되었습니다.",
      data: {
        userId: userId,
        naverId: naverId,
      },
    });
  } catch (error) {
    console.error("네이버 계정 설정 오류:", error);
    return res.status(500).json({
      success: false,
      message: "네이버 계정 정보 설정 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

module.exports = {
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
};
