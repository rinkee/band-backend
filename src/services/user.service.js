const { supabase } = require("../config/supabase");
const logger = require("../config/logger");

// /**
//  * 사용자의 네이버 계정 정보를 가져옵니다
//  * @param {string} userId - 사용자 ID
//  * @returns {Promise<Object|null>} - 네이버 계정 정보
//  */
// async function getUserNaverAccount(userId) {
//   try {
//     const { data: userData, error } = await supabase
//       .from("users")
//       .select("user_id, naver_id, naver_password, band_number")
//       .eq("user_id", userId)
//       .single();

//     if (error) {
//       logger.error(`사용자 조회 오류 (${userId}):`, error);
//       return null;
//     }

//     if (!userData.naver_id || !userData.naver_password) {
//       logger.error(`네이버 계정 정보가 설정되지 않았습니다: ${userId}`);
//       return null;
//     }

//     return {
//       userId: userData.user_id,
//       naverId: userData.naver_id,
//       naverPassword: userData.naver_password,
//       bandId: userData.band_number,
//     };
//   } catch (error) {
//     logger.error(`사용자 정보 조회 중 오류: ${error.message}`);
//     return null;
//   }
// }

/**
 * 자동 크롤링이 활성화된 모든 사용자 목록을 가져옵니다
 * @returns {Promise<Array>} - 자동 크롤링이 활성화된 사용자 목록
 */
async function getAutoCrawlEnabledUsers() {
  try {
    const { data, error } = await supabase
      .from("users")
      .select(
        "user_id, band_number, naver_id, naver_password, job_id, crawl_interval"
      )
      .eq("auto_crawl", true) // auto_crawl이 true인 사용자만 선택
      .eq("is_active", true) // 활성 사용자만 선택
      .not("naver_id", "is", null) // 네이버 ID가 있는 사용자만
      .not("naver_password", "is", null); // 네이버 비밀번호가 있는 사용자만

    if (error) {
      logger.error("자동 크롤링 사용자 조회 오류:", error);
      return [];
    }

    logger.info(`자동 크롤링 활성화된 사용자 ${data.length}명 조회됨`);
    return data;
  } catch (error) {
    logger.error(`자동 크롤링 사용자 조회 중 오류: ${error.message}`);
    return [];
  }
}

/**
 * 사용자의 자동 크롤링 설정을 업데이트합니다
 * @param {string} userId - 사용자 ID
 * @param {boolean} autoCrawl - 자동 크롤링 활성화 여부
 * @param {number} crawlInterval - 크롤링 간격 (분)
 * @param {string|null} jobId - 작업 ID (null이면 제거)
 * @returns {Promise<boolean>} - 업데이트 성공 여부
 */
async function updateAutoCrawlSettings(
  userId,
  autoCrawl,
  crawlInterval = 10,
  jobId = null
) {
  try {
    const updateData = {
      auto_crawl: autoCrawl,
      crawl_interval: crawlInterval,
      updated_at: new Date().toISOString(),
    };

    // 자동 크롤링이 비활성화되면 job_id를 null로 설정
    if (!autoCrawl) {
      updateData.job_id = null;
    }
    // 자동 크롤링이 활성화되고 jobId가 제공되면 업데이트
    else if (jobId) {
      updateData.job_id = jobId;
    }

    const { error } = await supabase
      .from("users")
      .update(updateData)
      .eq("user_id", userId);

    if (error) {
      logger.error(`자동 크롤링 설정 업데이트 오류 (${userId}):`, error);
      return false;
    }

    logger.info(
      `사용자 ${userId}의 자동 크롤링 설정이 업데이트 되었습니다: ${
        autoCrawl ? "활성화" : "비활성화"
      }, 간격: ${crawlInterval}분${jobId ? `, 작업 ID: ${jobId}` : ""}`
    );
    return true;
  } catch (error) {
    logger.error(`자동 크롤링 설정 업데이트 중 오류: ${error.message}`);
    return false;
  }
}

/**
 * 사용자의 크롤링 작업 ID를 업데이트합니다
 * @param {string} userId - 사용자 ID
 * @param {string} jobId - 작업 ID
 * @returns {Promise<boolean>} - 업데이트 성공 여부
 */
async function updateUserJobId(userId, jobId) {
  try {
    const { error } = await supabase
      .from("users")
      .update({
        job_id: jobId,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (error) {
      logger.error(`크롤링 작업 ID 업데이트 오류 (${userId}):`, error);
      return false;
    }

    logger.info(
      `사용자 ${userId}의 크롤링 작업 ID가 ${jobId}로 업데이트 되었습니다.`
    );
    return true;
  } catch (error) {
    logger.error(`크롤링 작업 ID 업데이트 중 오류: ${error.message}`);
    return false;
  }
}

/**
 * 사용자의 크롤링 작업 ID를 조회합니다
 * @param {string} userId - 사용자 ID
 * @returns {Promise<string|null>} - 작업 ID 또는 null
 */
async function getUserJobId(userId) {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("job_id")
      .eq("user_id", userId)
      .single();

    if (error) {
      logger.error(`크롤링 작업 ID 조회 오류 (${userId}):`, error);
      return null;
    }

    return data.job_id;
  } catch (error) {
    logger.error(`크롤링 작업 ID 조회 중 오류: ${error.message}`);
    return null;
  }
}

/**
 * 사용자 정보를 조회합니다
 * @param {string} userId - 사용자 ID
 * @returns {Promise<Object|null>} - 사용자 정보 또는 null
 */
async function getUserById(userId) {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error) {
      logger.error(`사용자 조회 오류 (${userId}):`, error);
      return null;
    }

    return data;
  } catch (error) {
    logger.error(`사용자 정보 조회 중 오류: ${error.message}`);
    return null;
  }
}

module.exports = {
  // getUserNaverAccount,
  getAutoCrawlEnabledUsers,
  updateAutoCrawlSettings,
  updateUserJobId,
  getUserJobId,
  getUserById,
};
