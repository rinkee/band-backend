// src/services/crawler/band.auth.js (통합된 버전)
require("dotenv").config();
const puppeteer = require("puppeteer-extra");
const logger = require("../../config/logger");
const fs = require("fs").promises;
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const cp = require("copy-paste");
puppeteer.use(StealthPlugin());

// 쿠키 저장 경로 설정
const COOKIES_PATH = path.join(__dirname, "../../../cookies");

// supabase 클라이언트 초기화 추가
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * 인증 및 브라우저 제어 기능을 담당하는 클래스
 */
class BandAuth {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isLoggedIn = false;
    this.taskId = `task_${Date.now()}`;
    this.supabase = supabase; // 추가
    this.status = {
      status: "initialized",
      message: "크롤러가 초기화되었습니다",
      progress: 0,
      updatedAt: new Date(),
    };
    this.bandNumber = "";
  }

  /**
   * 상태 업데이트 콜백 함수 설정
   * @param {Function} callback - 상태 업데이트 시 호출될 콜백 함수
   */
  setOnStatusUpdate(callback) {
    this.onStatusUpdate = callback;
    logger.info("상태 업데이트 콜백이 설정되었습니다.");
  }

  /**
   * 내부 상태 업데이트 메소드
   * @param {string} status - 상태 ('processing', 'failed', 'completed' 등)
   * @param {string} message - 상태 메시지
   * @param {number} progress - 진행률 (0-100)
   */
  _updateStatus(status, message, progress) {
    // 디버깅: _updateStatus 호출 확인
    // logger.debug(`_updateStatus 호출됨: status=${status}, message=${message}, progress=${progress}, this.onStatusUpdate 존재여부=${!!this.onStatusUpdate}`);

    if (this.onStatusUpdate && typeof this.onStatusUpdate === "function") {
      // 콜백 함수가 있으면 호출
      try {
        this.onStatusUpdate(status, message, progress);
      } catch (callbackError) {
        logger.error(
          `상태 업데이트 콜백 함수 실행 중 오류: ${callbackError.message}`,
          callbackError
        );
      }
    } else {
      // 콜백 없으면 기본 로깅
      const progressText =
        progress !== undefined ? ` 진행률: ${progress}% |` : "";
      logger.info(
        `[상태 업데이트]${progressText} 상태: ${status} | 메시지: ${message}`
      );
    }
  }

  // 작업 상태 업데이트 메서드
  updateTaskStatus(status, message, progress, data = {}) {
    this.status = {
      ...this.status,
      status,
      message,
      progress,
      updatedAt: new Date(),
      ...data,
    };

    console.log(`[${this.taskId}] ${status}: ${message} (${progress}%)`);

    // 상태 업데이트 콜백이 있으면 호출
    if (typeof this.onStatusUpdate === "function") {
      this.onStatusUpdate(status, message, progress);
    }
  }

  // 브라우저 초기화 (원래 BaseCrawler의 메서드)
  async initialize(userId, naverId, naverPassword) {
    try {
      this.updateTaskStatus("processing", "initialize", 0);

      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
        ignoreHTTPSErrors: true,
        defaultViewport: null,
        // setRequestInterception: true,
      });

      this.page = await this.browser.newPage();
      await this.page.setViewport({ width: 1280, height: 720 });
      await this.page.setRequestInterception(true);
      await this.page.on("request", (req) => {
        if (req.resourceType() === "image") {
          // 만약 요청 타입이 '이미지'라면
          req.abort(); // 거부
        } else {
          // 이미지가 아니라면
          req.continue(); // 수락
        }
      });

      // 쿠키를 유지하기 위한 설정
      await this.page.setExtraHTTPHeaders({
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
      });

      this.updateTaskStatus("processing", "브라우저 초기화 완료", 5);

      if (naverId) {
        // 먼저 쿠키 로그인 시도
        const cookieLoginResult = await this.cookieLogin(userId, naverId);

        // 쿠키 로그인 성공 시 종료
        if (cookieLoginResult) {
          return true;
        }

        // 쿠키 로그인 실패하고 비밀번호가 있으면 UI 로그인 시도
        if (naverPassword) {
          this.updateTaskStatus("processing", "직접 로그인 시도", 30);
          return await this.naverLogin(userId, naverId, naverPassword);
        } else {
          this.updateTaskStatus(
            "failed",
            "로그인에 필요한 비밀번호가 제공되지 않았습니다",
            30
          );
          return false;
        }
      }

      // naverId가 없는 경우
      this.updateTaskStatus(
        "processing",
        "naverId가 제공되지 않아 로그인할 수 없습니다",
        25
      );
      return false;
    } catch (error) {
      this.updateTaskStatus(
        "failed",
        `브라우저 초기화 실패: ${error.message}`,
        0
      );
      return false; // 에러 발생 시에도 명시적으로 false 반환
    }
  }

  async saveCookies(userId, naverId, cookies) {
    // Supabase 업데이트를 위해 userId가 설정되어 있는지 확인
    if (!userId) {
      console.error("saveCookies 호출 전 userId가 설정되어야 합니다.");
      return false;
    }

    try {
      // 1. 입력 유효성 검사
      if (!naverId || !cookies || !Array.isArray(cookies)) {
        console.error("유효하지 않은 쿠키 또는 ID 정보:", {
          naverId,
          cookiesType: typeof cookies,
          isArray: Array.isArray(cookies),
        });
        // 실패 상태를 Supabase에 기록할 수도 있음 (선택 사항)
        // await supabase.from("users").update({ naver_login_status: "failed_invalid_input" }).eq("user_id", this.userId);
        return false;
      }

      // 2. 관련 쿠키 필터링 (밴드 및 인증 관련 도메인)
      const relevantCookies = cookies.filter(
        (cookie) =>
          cookie &&
          cookie.domain &&
          (cookie.domain.includes("band.us") ||
            cookie.domain.includes("auth.band.us"))
      );

      // 3. 저장할 쿠키 유무 확인
      if (relevantCookies.length === 0) {
        console.log("저장할 밴드 관련 쿠키가 없습니다.");
        // 쿠키가 없더라도 로그인 시도 자체는 기록하고 실패 처리
        const { error: updateError } = await supabase
          .from("users")
          .update({
            cookies_updated_at: new Date().toISOString(),
            naver_login_status: "failed_no_cookies", // 쿠키 없음 상태
            cookies: [], // 빈 배열 저장
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);

        if (updateError) {
          console.error(
            "Supabase 상태 업데이트 오류 (쿠키 없음):",
            updateError
          );
        }
        return false; // 저장할 쿠키가 없으므로 실패 반환
      }

      // 4. Supabase에 사용자 정보 및 필터링된 쿠키 업데이트
      console.log(
        `Supabase에 ${relevantCookies.length}개의 밴드 쿠키 저장을 시도합니다.`
      );
      const { error: supabaseError } = await supabase
        .from("users")
        .update({
          cookies_updated_at: new Date().toISOString(),
          naver_login_status: "success", // 성공 상태
          cookies: relevantCookies, // 필터링된 쿠키 저장
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      // 5. Supabase 업데이트 오류 처리
      if (supabaseError) {
        console.error("Supabase 쿠키 저장 오류:", supabaseError);
        // 필요하다면 여기서도 naver_login_status를 'failed_db_error' 등으로 업데이트 시도 가능
        return false; // Supabase 저장 실패 시 false 반환
      }

      console.log("Supabase에 쿠키 저장 성공.");
      return true; // 모든 과정 성공 시 true 반환
    } catch (error) {
      // 6. 예상치 못한 오류 처리
      console.error("쿠키 저장 중 예상치 못한 오류:", error);
      // 오류 발생 시 Supabase 상태 업데이트 (선택적)
      try {
        await supabase
          .from("users")
          .update({
            naver_login_status: "failed_exception", // 예외 발생 상태
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);
      } catch (dbError) {
        console.error("오류 상태 업데이트 중 DB 오류:", dbError);
      }
      return false; // 실패 반환
    }
  }

  /**
   * Supabase에서 특정 사용자의 저장된 쿠키를 로드합니다.
   * @param {string} userId - 쿠키를 로드할 사용자의 Supabase user_id
   * @returns {Promise<Array|null>} - 쿠키 배열 또는 찾을 수 없거나 오류 시 null
   */
  async loadCookies(userId) {
    if (!userId) {
      logger.error("loadCookies 호출 시 userId가 필요합니다.");
      this.updateTaskStatus("failed", "쿠키 로드 실패: 사용자 ID 누락", 10);
      return null;
    }

    this.updateTaskStatus(
      "processing",
      "Supabase에서 쿠키 로드 시도 중...",
      11
    );

    try {
      // Supabase 'users' 테이블에서 user_id가 일치하는 레코드의 'cookies' 컬럼 선택
      const { data, error } = await this.supabase
        .from("users")
        .select("cookies, cookies_updated_at") // 쿠키 데이터와 업데이트 시간 선택
        .eq("user_id", userId) // 전달된 userId로 필터링
        .single(); // 단일 레코드만 가져옴

      // 오류 처리
      if (error) {
        // 'PGRST116' 코드는 결과가 없음을 의미 (사용자 또는 쿠키가 없는 정상적인 경우)
        if (error.code === "PGRST116") {
          this.updateTaskStatus(
            "processing",
            "Supabase에 저장된 쿠키를 찾을 수 없습니다.",
            12
          );
          logger.info(`사용자 ${userId}에 대해 Supabase에서 저장된 쿠키 없음.`);
          return null;
        } else {
          // 그 외의 데이터베이스 오류
          this.updateTaskStatus(
            "failed",
            `Supabase 쿠키 로드 오류: ${error.message}`,
            12
          );
          logger.error(
            `Supabase 쿠키 로드 중 DB 오류 (사용자: ${userId}):`,
            error
          );
          return null;
        }
      }

      // 데이터 유효성 검사 (data가 있고, cookies 필드가 배열인지 확인)
      if (data && Array.isArray(data.cookies)) {
        // 쿠키가 비어있는 배열일 수도 있음 (로그인은 성공했으나 저장된 쿠키가 없는 경우)
        if (data.cookies.length === 0) {
          this.updateTaskStatus(
            "processing",
            "Supabase에서 빈 쿠키 배열 로드됨.",
            12
          );
          logger.info(
            `사용자 ${userId}에 대해 Supabase에서 빈 쿠키 배열 로드됨.`
          );
          // 빈 배열도 유효한 상태일 수 있으므로 그대로 반환
          return data.cookies;
        }

        // 쿠키 데이터가 존재하고 배열 형태임
        const loadedAt = data.cookies_updated_at
          ? new Date(data.cookies_updated_at).toLocaleString()
          : "N/A";
        this.updateTaskStatus(
          "processing",
          `Supabase에서 쿠키 ${data.cookies.length}개 로드 완료 (최종 저장: ${loadedAt})`,
          13
        );
        logger.info(
          `사용자 ${userId}에 대해 Supabase에서 ${data.cookies.length}개의 쿠키 로드 성공.`
        );
        return data.cookies; // 쿠키 배열 반환
      } else {
        // 데이터는 있지만 cookies 필드가 배열이 아니거나 없는 경우
        this.updateTaskStatus(
          "processing",
          "Supabase에서 유효하지 않은 쿠키 데이터 발견.",
          12
        );
        logger.warn(
          `사용자 ${userId}의 Supabase 레코드에 유효한 쿠키 배열이 없습니다. data:`,
          data
        );
        return null;
      }
    } catch (error) {
      // try 블록 전체를 감싸는 예상치 못한 오류 처리
      this.updateTaskStatus(
        "failed",
        `쿠키 로드 중 예상치 못한 오류: ${error.message}`,
        12
      );
      logger.error(
        `Supabase 쿠키 로드 중 예상치 못한 오류 (사용자: ${userId}):`,
        error
      );
      return null;
    }
  }

  /**
   * 네이버 로그인 시도 (리캡챠 감지 시 홈 이동 후 재시도 로직 포함)
   */
  async naverLogin(userId, naverId, naverPassword) {
    const randomDelay = () =>
      Math.floor(Math.random() * (2500 - 1000 + 1)) + 1000; // 1~2.5초 랜덤 딜레이 함수

    this.updateTaskStatus("processing", "네이버 로그인 시도 시작", 40);

    try {
      // --- 내부 헬퍼 함수: 실제 로그인 액션 수행 ---
      const _performLoginActions = async () => {
        this.updateTaskStatus("processing", "로그인 액션 수행 시작", 45);
        await new Promise((resolve) => setTimeout(resolve, randomDelay()));

        // 1. (필요시) 로그인 페이지 이동 확인 및 네이버 로그인 버튼 클릭
        // 현재 페이지가 이미 로그인 페이지가 아닐 수 있으므로, 먼저 로그인 페이지로 이동하거나 확인 필요
        // 여기서는 naverLogin 함수 초입에서 이미 로그인 페이지 근처라고 가정
        try {
          // 페이지 URL 확인
          const currentUrl = this.page.url();
          if (!currentUrl.includes("auth.band.us/login_page")) {
            this.updateTaskStatus(
              "processing",
              "로그인 페이지로 이동 시도",
              46
            );
            await this.page.goto("https://auth.band.us/login_page", {
              waitUntil: "networkidle2",
              timeout: 30000,
            });
            await new Promise((resolve) => setTimeout(resolve, randomDelay()));
          }

          this.updateTaskStatus(
            "processing",
            "네이버 로그인 버튼 클릭 시도",
            47
          );
          await this.page.evaluate(() => {
            // 여러 선택자를 시도하여 네이버 로그인 버튼 클릭
            const buttons = [
              "a.-naver.externalLogin",
              "a.uButtonRound.-h56.-icoType.-naver",
              'button[data-type="naver"]', // 추가적인 선택자 예시
              // ... 다른 가능한 선택자
            ];
            for (const selector of buttons) {
              const btn = document.querySelector(selector);
              if (btn) {
                btn.click();
                return true; // 클릭 성공 시 루프 종료
              }
            }
            return false; // 버튼 못 찾음
          });
          this.updateTaskStatus(
            "processing",
            "네이버 로그인 버튼 클릭 완료",
            48
          );
          // 네비게이션 대기 (네이버 로그인 페이지로 이동)
          await this.page
            .waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 })
            .catch((e) => {
              this.updateTaskStatus(
                "processing",
                `네이버 로그인 페이지 네비게이션 대기 중 경고(무시): ${e.message}`,
                49
              );
            });
          await new Promise((resolve) => setTimeout(resolve, randomDelay())); // 네이버 페이지 로딩 대기
        } catch (e) {
          this.updateTaskStatus(
            "processing",
            `네이버 로그인 버튼 클릭 또는 네비게이션 오류: ${e.message}`,
            49
          );
          // 오류 발생 시에도 다음 단계 시도
        }

        // 2. 네이버 로그인 페이지에서 아이디/비밀번호 입력
        this.updateTaskStatus(
          "processing",
          "네이버 아이디/비밀번호 입력 시도",
          50
        );
        await this.page
          .waitForSelector("#id", { timeout: 30000 })
          .catch((err) => {
            this.updateTaskStatus(
              "processing",
              `ID 필드 대기 중 경고(무시): ${err.message}`,
              51
            );
          });
        await new Promise((resolve) => setTimeout(resolve, randomDelay())); // 안정화 대기

        try {
          await this.page.evaluate(
            (id, pw) => {
              // 입력 필드 값 초기화 후 입력 시도
              const idInput = document.querySelector("#id");
              const pwInput = document.querySelector("#pw");
              if (idInput) idInput.value = "";
              if (pwInput) pwInput.value = "";
              // 짧은 딜레이 후 값 설정 및 이벤트 발생
              setTimeout(() => {
                if (idInput) {
                  idInput.value = id;
                  idInput.dispatchEvent(new Event("input", { bubbles: true }));
                  idInput.dispatchEvent(new Event("change", { bubbles: true }));
                }
                if (pwInput) {
                  pwInput.value = pw;
                  pwInput.dispatchEvent(new Event("input", { bubbles: true }));
                  pwInput.dispatchEvent(new Event("change", { bubbles: true }));
                }
              }, 100); // 약간의 딜레이
            },
            naverId,
            naverPassword
          );
          this.updateTaskStatus("processing", "ID/PW 입력 완료 (evaluate)", 58);
        } catch (inputError) {
          this.updateTaskStatus(
            "processing",
            `입력 오류(evaluate), type 시도: ${inputError.message}`,
            59
          );
          // evaluate 실패 시 type 시도
          try {
            await this.page.type("#id", naverId, {
              delay: 100 + Math.random() * 50,
            });
            await new Promise((resolve) =>
              setTimeout(resolve, randomDelay() / 2)
            );
            await this.page.type("#pw", naverPassword, {
              delay: 100 + Math.random() * 50,
            });
            this.updateTaskStatus("processing", "ID/PW 입력 완료 (type)", 58);
          } catch (typeError) {
            this.updateTaskStatus(
              "failed",
              `ID/PW 입력 완전 실패: ${typeError.message}`,
              59
            );
            throw new Error("아이디/비밀번호 입력 실패"); // 입력 실패 시 진행 불가
          }
        }
        await new Promise((resolve) => setTimeout(resolve, randomDelay())); // 입력 후 대기

        // 3. 엔터키 입력으로 로그인
        this.updateTaskStatus("processing", "Enter 키로 로그인 시도", 60);
        await this.page.keyboard.press("Enter").catch((e) => {
          this.updateTaskStatus(
            "processing",
            `Enter키 입력 오류(무시): ${e.message}`,
            61
          );
          // 엔터 실패 시 로그인 버튼 클릭 시도 (선택적)
          // await this.page.click('.btn_login, #log\.login').catch(() => {});
        });

        // 4. 네비게이션 완료 대기 (로그인 후 페이지 이동)
        this.updateTaskStatus("processing", "로그인 후 네비게이션 대기", 62);
        await this.page
          .waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 })
          .catch((e) => {
            // 타임아웃 증가
            this.updateTaskStatus(
              "processing",
              `로그인 후 네비게이션 대기 중 경고(무시): ${e.message}`,
              64
            );
          });
        await new Promise((resolve) => setTimeout(resolve, randomDelay() * 2)); // 로그인 후 로딩 대기 시간 추가
        this.updateTaskStatus("processing", "로그인 액션 수행 완료", 65);
      };
      // --- 내부 헬퍼 함수 끝 ---

      // --- 1차 로그인 시도 ---
      this.updateTaskStatus("processing", "1차 로그인 액션 시도", 44);
      await _performLoginActions();

      // 1차 로그인 확인
      this.updateTaskStatus("processing", "1차 로그인 상태 확인", 66);
      let isLoggedIn = await this.checkLoginStatus().catch(() => false);

      if (isLoggedIn) {
        this.updateTaskStatus("processing", "1차 로그인 성공", 75);
        // 성공 시 처리 (아래 공통 로직으로 이동)
      } else {
        // 1차 로그인 실패 시 리캡챠 확인
        this.updateTaskStatus(
          "processing",
          "1차 로그인 실패, 리캡챠 확인 중...",
          67
        );
        const hasRecaptcha = await this.detectRecaptcha();

        if (hasRecaptcha) {
          this.updateTaskStatus(
            "processing",
            "리캡챠 감지됨. 홈 이동 후 2차 로그인 시도",
            68
          );

          // --- 리캡챠 우회 시도: 홈 이동 후 재로그인 ---
          try {
            // 1. 밴드 홈으로 이동
            this.updateTaskStatus("processing", "밴드 홈으로 이동 중...", 69);
            await this.page.goto("https://band.us/home", {
              waitUntil: "networkidle2",
              timeout: 30000,
            });
            await new Promise((resolve) =>
              setTimeout(resolve, randomDelay() * 2)
            ); // 홈 로딩 대기

            // 2. 다시 로그인 페이지로 이동
            this.updateTaskStatus(
              "processing",
              "다시 로그인 페이지로 이동 중...",
              70
            );
            await this.page.goto("https://auth.band.us/login_page", {
              waitUntil: "networkidle2",
              timeout: 30000,
            });
            await new Promise((resolve) => setTimeout(resolve, randomDelay())); // 로그인 페이지 로딩 대기

            // 3. 2차 로그인 시도
            this.updateTaskStatus("processing", "2차 로그인 액션 시도", 71);
            await _performLoginActions(); // 로그인 액션 재수행

            // 4. 2차 로그인 확인
            this.updateTaskStatus("processing", "2차 로그인 상태 확인", 72);
            isLoggedIn = await this.checkLoginStatus().catch(() => false);

            if (isLoggedIn) {
              this.updateTaskStatus(
                "processing",
                "2차 로그인 성공 (리캡챠 우회 성공)",
                75
              );
              // 성공 시 처리 (아래 공통 로직으로 이동)
            } else {
              this.updateTaskStatus(
                "failed",
                "2차 로그인 시도 실패 (리캡챠 우회 실패)",
                73
              );
              // 여기서 추가적으로 리캡챠가 또 나왔는지 확인하거나, 그냥 실패 처리
              const stillHasRecaptcha = await this.detectRecaptcha();
              if (stillHasRecaptcha) {
                this.updateTaskStatus(
                  "failed",
                  "리캡챠가 계속 감지됩니다. 자동 로그인 불가.",
                  74
                );
              }
              return false; // 최종 실패
            }
          } catch (retryError) {
            this.updateTaskStatus(
              "failed",
              `리캡챠 우회 시도 중 오류: ${retryError.message}`,
              70
            );
            return false; // 재시도 중 오류 발생 시 실패
          }
          // --- 리캡챠 우회 시도 끝 ---
        } else {
          // 리캡챠도 없는데 로그인 실패한 경우 (예: 비밀번호 오류)
          this.updateTaskStatus(
            "failed",
            "로그인 실패 (리캡챠 없음 - 정보 확인 필요)",
            70
          );
          // 로그인 실패 원인 파악을 위한 추가 정보 로깅 (선택적)
          const pageContent = await this.page.content().catch(() => "");
          if (
            pageContent.includes("비밀번호") ||
            pageContent.includes("password")
          ) {
            this.updateTaskStatus(
              "failed",
              "로그인 실패 - 비밀번호 오류 가능성",
              71
            );
          } else if (
            pageContent.includes("아이디") ||
            pageContent.includes("ID")
          ) {
            this.updateTaskStatus(
              "failed",
              "로그인 실패 - 아이디 오류 가능성",
              71
            );
          }
          // 스크린샷 등 추가 디버깅 정보 저장 가능
          // await this.page.screenshot({ path: `login_fail_no_recaptcha_${Date.now()}.png` });
          return false; // 최종 실패
        }
      }

      // --- 로그인 성공 공통 처리 ---
      if (isLoggedIn) {
        this.isLoggedIn = true;
        this.updateTaskStatus(
          "processing",
          "로그인 성공 확인, 쿠키 저장 시도",
          80
        );
        // 현재 페이지의 모든 쿠키 가져오기
        // const finalCookies = await this.page.cookies(); // 특정 도메인만 가져오려면 URL 지정 가능: await this.page.cookies('https://band.us', 'https://auth.band.us')
        // 또는 브라우저 전체 쿠키
        const finalCookies = await this.browser.cookies();

        const saveResult = await this.saveCookies(
          userId,
          naverId,
          finalCookies
        ); // userId 전달 확인

        if (saveResult) {
          this.updateTaskStatus("completed", "로그인 및 쿠키 저장 완료", 100);
          return true;
        } else {
          this.updateTaskStatus(
            "failed",
            "로그인 성공했으나 쿠키 저장 실패",
            95
          );
          return false; // 쿠키 저장이 중요하면 실패 처리
        }
      } else {
        // 이 지점에 도달하면 안 되지만, 방어적으로 실패 처리
        this.updateTaskStatus(
          "failed",
          "로그인 최종 실패 (알 수 없는 상태)",
          80
        );
        return false;
      }
    } catch (error) {
      // naverLogin 함수 전체의 try-catch
      this.isLoggedIn = false;
      // 오류 메시지에 스택 트레이스 포함하여 더 자세한 정보 로깅
      logger.error(
        `네이버 로그인 프로세스 중 심각한 오류: ${error.message}\n${error.stack}`
      );
      this.updateTaskStatus(
        "failed",
        `로그인 프로세스 오류: ${error.message}`,
        60
      );
      // 오류 발생 시 스크린샷 저장 (디버깅 목적)
      try {
        if (this.page && !this.page.isClosed()) {
          await this.page.screenshot({
            path: `naverLogin_error_${Date.now()}.png`,
            fullPage: true,
          });
          this.updateTaskStatus(
            "processing",
            "오류 발생 시점 스크린샷 저장됨",
            61
          );
        }
      } catch (screenshotError) {
        logger.error(`오류 스크린샷 저장 실패: ${screenshotError.message}`);
      }
      // throw error; // 에러를 상위로 전파하려면 주석 해제
      return false; // 에러 발생 시 false 반환
    }
  }

  async detectRecaptcha() {
    try {
      this.updateTaskStatus("processing", "리캡챠 감지 확인 중", 62);

      // 페이지가 유효한지 확인
      if (!this.page || this.page.isClosed()) {
        console.log("리캡챠 감지: 페이지가 닫혔거나 유효하지 않음");
        return false;
      }

      // 페이지 내용에서 캡챠 관련 요소 확인
      const hasRecaptcha = await this.page
        .evaluate(() => {
          try {
            return (
              document.querySelector('iframe[src*="recaptcha"]') !== null ||
              document.querySelector(".g-recaptcha") !== null ||
              document.querySelector('iframe[src*="captcha"]') !== null ||
              document.querySelector("#captcha") !== null ||
              document.querySelector("#recaptcha") !== null
            );
          } catch (e) {
            return false;
          }
        })
        .catch(() => false);

      // 페이지 텍스트에서 캡챠 관련 문구 확인
      const hasRecaptchaText = await this.page
        .evaluate(() => {
          try {
            const pageText = document.body?.innerText?.toLowerCase() || "";
            return (
              pageText.includes("captcha") ||
              pageText.includes("로봇이 아닙니다") ||
              pageText.includes("자동 가입 방지") ||
              pageText.includes("보안 인증") ||
              pageText.includes("보안문자")
            );
          } catch (e) {
            return false;
          }
        })
        .catch(() => false);

      const result = hasRecaptcha || hasRecaptchaText;
      this.updateTaskStatus(
        "processing",
        `리캡챠 감지 ${result ? "됨" : "안됨"}`,
        63
      );

      return result;
    } catch (error) {
      console.error("리캡챠 감지 중 오류 발생:", error.message);
      this.updateTaskStatus(
        "processing",
        `리캡챠 감지 중 오류 (무시됨): ${error.message}`,
        63
      );
      return false;
    }
  }

  async close() {
    try {
      if (this.browser) {
        this.updateTaskStatus("processing", "브라우저 리소스 정리 중...", 95);

        await this.browser.close();
        logger.info("브라우저가 성공적으로 종료되었습니다");
        // 브라우저 및 페이지 참조 제거
        this.browser = null;
        this.page = null;

        this.updateTaskStatus("processing", "브라우저 리소스 정리 완료", 95);
      } else {
        logger.info("브라우저 인스턴스가 없어 정리가 필요하지 않습니다");
      }
    } catch (error) {
      logger.error(`브라우저 상태 확인 중 오류: ${error.message}`);

      // 오류가 발생해도 참조는 정리
      this.browser = null;
      this.page = null;
    }
  }

  async waitForTimeout(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async checkLoginStatus() {
    try {
      const targetBandUrl = `https://www.band.us/band/${this.bandNumber}`; // 일관된 URL 사용
      this.updateTaskStatus(
        "processing",
        `밴드 페이지(${this.bandNumber})로 이동하여 로그인 상태 확인 중`,
        20
      );
      logger.info(`Navigating to ${targetBandUrl} for login check...`); // 디버깅 로그 추가

      await this.page.goto(targetBandUrl, {
        waitUntil: "networkidle2", // 또는 'load', 'domcontentloaded' 시도
        timeout: 45000, // 타임아웃 약간 증가
      });

      logger.info(
        `Navigation to ${targetBandUrl} complete. Waiting for page stability...`
      ); // 디버깅 로그 추가

      // --- 여기가 중요 ---
      // 페이지 이동 후 안정화될 시간을 확보합니다.

      // 방법 1: 특정 요소가 나타날 때까지 기다리기 (더 안정적)
      const profileSelector = ".profileInner"; // 로그인 시 나타나는 요소
      try {
        logger.info(`Waiting for selector "${profileSelector}"...`);
        await this.page.waitForSelector(profileSelector, { timeout: 15000 }); // 최대 15초 대기
        logger.info(
          `Selector "${profileSelector}" found. Proceeding with evaluate.`
        );
      } catch (waitError) {
        // 요소를 찾지 못하면 로그인되지 않은 상태일 가능성이 높음
        logger.warn(
          `Selector "${profileSelector}" not found after navigation. Assuming not logged in. Error: ${waitError.message}`
        );
        this.updateTaskStatus(
          "processing",
          "프로필 요소 없음 (waitForSelector) - 로그인 필요",
          23
        );
        return false; // 요소를 못 찾으면 false 반환
      }

      // 방법 2: 고정 시간 대기 (덜 안정적일 수 있음)
      // logger.info('Waiting 3 seconds after navigation for stability...');
      // await new Promise(resolve => setTimeout(resolve, 3000)); // 3초 대기
      // logger.info('Wait complete. Proceeding with evaluate.');
      // --- 대기 로직 끝 ---

      logger.info("Executing page.evaluate to check login status..."); // 디버깅 로그 추가
      // 이제 페이지 상태 평가
      const isLoggedIn = await this.page.evaluate((selector) => {
        try {
          // evaluate 내부에서도 try-catch 추가
          const profileElement = document.querySelector(selector);
          return !!profileElement;
        } catch (evalError) {
          console.error("Error inside page.evaluate:", evalError);
          return false;
        }
      }, profileSelector); // 셀렉터를 인자로 전달

      if (isLoggedIn) {
        this.updateTaskStatus(
          "processing",
          "profileInner 요소 확인됨 - 로그인 성공",
          25
        );
        return true;
      } else {
        // evaluate는 성공했지만 요소를 찾지 못한 경우
        this.updateTaskStatus(
          "processing",
          "profileInner 요소 없음 (evaluate) - 로그인 필요",
          23
        );
        return false;
      }
    } catch (error) {
      // 여기서 Detached Frame 오류 등이 잡힐 수 있음
      logger.error(`Error during checkLoginStatus: ${error.message}`, error); // 실제 에러 로깅
      // 상태 업데이트 메시지에 실제 오류 반영
      this.updateTaskStatus(
        "processing", // 실패 상태 대신 processing 유지하고, 메시지에 오류 명시
        `로그인 상태 확인 중 오류: ${error.message}`,
        25
      );
      return false; // 오류 발생 시 false 반환
    }
  }

  // cookieLogin 메서드 내에서 loadCookies 호출 방식 변경 필요
  async cookieLogin(userId, naverId) {
    // userId 파라미터 추가 또는 클래스 멤버 사용
    try {
      this.updateTaskStatus("processing", "쿠키 로그인 시도", 10);

      // *** 변경된 부분: userId로 쿠키 로드 ***
      const savedCookies = await this.loadCookies(userId); // naverId 대신 userId 사용

      if (!savedCookies) {
        // loadCookies 내부에서 이미 상태 업데이트 및 로깅 처리됨
        // 여기서 추가 메시지 필요 시 추가
        this.updateTaskStatus(
          "processing",
          "사용 가능한 저장된 쿠키 없음, 직접 로그인 필요",
          15
        );
        return false;
      }

      // 쿠키 설정 (browser 객체가 준비되었다고 가정)
      // this.page.setCookie 대신 browser.setCookie 사용 고려 (더 넓은 범위 적용)
      if (!this.browser)
        throw new Error("쿠키 설정을 위한 브라우저가 초기화되지 않았습니다.");
      await Promise.all(
        savedCookies.map((cookie) =>
          this.page
            .setCookie(cookie)
            .catch((e) =>
              logger.warn(
                `쿠키 설정 오류 (무시됨): ${cookie.name} - ${e.message}`
              )
            )
        )
      );
      // await this.browser.setCookie(...savedCookies); // setCookie는 가변 인자를 받으므로 spread 연산자 사용

      this.updateTaskStatus("processing", "저장된 쿠키 적용 완료", 20);

      // 로그인 상태 확인
      const isLoggedIn = await this.checkLoginStatus(); // checkLoginStatus가 userId 없이 작동한다고 가정
      if (isLoggedIn) {
        this.updateTaskStatus("processing", "쿠키로 로그인 성공", 30);
        this.isLoggedIn = true;
        return true;
      }

      // 로그인 실패 시 (쿠키 만료 등)
      this.updateTaskStatus(
        "processing",
        "쿠키가 만료되었거나 유효하지 않아 로그인 실패",
        25
      );

      // *** Supabase 쿠키 삭제는 주의 필요 ***
      // 쿠키가 유효하지 않다고 해서 바로 DB에서 삭제하는 것은 위험할 수 있음.
      // 실패 카운트를 두거나 다른 정책을 고려하는 것이 좋음.
      // 여기서는 일단 DB 삭제 로직은 제외. 필요 시 추가.
      /*
       try {
           const { error: deleteError } = await this.supabase
               .from('users')
               .update({ cookies: [], cookies_updated_at: new Date().toISOString(), naver_login_status: 'cookie_expired' })
               .eq('user_id', userId);
           if (deleteError) throw deleteError;
           this.updateTaskStatus("processing", "DB에서 만료된 쿠키 정보 업데이트됨", 26);
       } catch (dbError) {
           this.updateTaskStatus("processing", `DB 쿠키 업데이트/삭제 실패: ${dbError.message}`, 26);
           logger.error(`Supabase 쿠키 업데이트 실패 (사용자: ${userId}):`, dbError);
       }
       */

      // 로그인 페이지로 이동 (선택적)
      // ... (기존 이동 로직) ...

      return false; // 쿠키 로그인 실패
    } catch (error) {
      this.updateTaskStatus(
        "failed",
        `쿠키 로그인 중 오류: ${error.message}`,
        20
      );
      logger.error(`쿠키 로그인 프로세스 오류 (사용자: ${userId}):`, error);
      // 에러 발생 시에도 DB 삭제는 신중하게 결정
      return false;
    }
  }

  /**
   * 밴드 페이지 접근 처리
   * @param {string} userId - 사용자 ID
   * @param {string} naverId - 네이버 ID
   * @param {string} naverPassword - 네이버 비밀번호
   * @returns {Promise<boolean>} - 접근 성공 여부
   */
  async accessBandPage(userId, naverId, naverPassword) {
    // 브라우저 초기화 확인
    if (!this.browser || !this.page) {
      logger.info("브라우저 초기화 중...");
      await this.initialize(userId, naverId, naverPassword);
    }

    logger.info(`밴드 페이지로 이동: https://band.us/band/${this.bandNumber}`);

    // 밴드 페이지로 이동
    await this.page.goto(`https://band.us/band/${this.bandNumber}`, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // 추가 대기 시간 부여
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // 접근 권한 확인 로직
    const hasBandAccess = await this.page.evaluate(() => {
      // 더 다양한 요소를 확인하여 접근 가능 여부 판단
      const bandName = document.querySelector(".bandName");
      const errorMessage = document.querySelector(
        ".errorMessage, .accessDenied"
      );
      const contentArea = document.querySelector(".contentArea, .bandContent");

      // 오류 메시지가 있거나 콘텐츠 영역이 없다면 접근 불가
      if (errorMessage) return false;

      // 밴드 이름이나 콘텐츠 영역이 있으면 접근 가능
      return !!(bandName || contentArea);
    });

    // 오류 발생 시 로그인 페이지인지 확인하고 로그인 시도
    if (!hasBandAccess) {
      logger.info(
        `밴드 ${this.bandNumber} 접근 실패, 로그인 페이지 확인 중...`
      );

      // 현재 페이지가 로그인 페이지인지 확인
      const isLoginPage = await this.page.evaluate(() => {
        const loginForm = document.querySelector(
          "form.login_form, .login-page, .loginArea, a.login"
        );
        const loginButton = document.querySelector(
          "a.-naver.externalLogin, button[type='submit']"
        );
        return !!(loginForm || loginButton);
      });

      if (isLoginPage) {
        logger.info("로그인 페이지 감지됨, 로그인 시도 중...");

        // 쿠키 로그인 시도
        const cookieLoginResult = await this.cookieLogin(userId, naverId);

        // 쿠키 로그인 실패 시 직접 로그인 시도
        if (!cookieLoginResult && naverId && naverPassword) {
          logger.info("쿠키 로그인 실패, 직접 로그인 시도 중...");
          const loginSuccess = await this.naverLogin(
            userId,
            naverId,
            naverPassword
          );

          if (loginSuccess) {
            logger.info("로그인 성공, 밴드 페이지 다시 접근 시도 중...");

            // 로그인 성공 후 다시 밴드 페이지로 이동
            await this.page.goto(`https://band.us/band/${this.bandNumber}`, {
              waitUntil: "networkidle2",
              timeout: 60000,
            });

            // 추가 대기 시간 부여
            await new Promise((resolve) => setTimeout(resolve, 5000));

            // 밴드 접근 권한 다시 확인
            const bandAccessAfterLogin = await this.page.evaluate(() => {
              const bandName = document.querySelector(".bandName");
              const errorMessage = document.querySelector(
                ".errorMessage, .accessDenied"
              );
              const contentArea = document.querySelector(
                ".contentArea, .bandContent"
              );

              if (errorMessage) return false;
              return !!(bandName || contentArea);
            });

            if (bandAccessAfterLogin) {
              logger.info(`로그인 후 밴드 ${this.bandNumber} 접근 성공`);
              return true;
            } else {
              logger.error(`로그인 후에도 밴드 ${this.bandNumber} 접근 실패`);

              // 디버깅을 위한 스크린샷 저장
              await this.page.screenshot({
                path: `band-access-error-after-login-${Date.now()}.png`,
              });
              return false;
            }
          } else {
            logger.error("로그인 실패");
            await this.page.screenshot({
              path: `login-failed-${Date.now()}.png`,
            });
            return false;
          }
        } else if (cookieLoginResult) {
          logger.info("쿠키 로그인 성공, 밴드 페이지 다시 접근 시도 중...");

          // 쿠키 로그인 성공 후 다시 밴드 페이지로 이동
          await this.page.goto(`https://band.us/band/${this.bandNumber}`, {
            waitUntil: "networkidle2",
            timeout: 60000,
          });

          // 추가 대기 시간 부여
          await new Promise((resolve) => setTimeout(resolve, 5000));

          // 밴드 접근 권한 다시 확인
          const bandAccessAfterCookieLogin = await this.page.evaluate(() => {
            const bandName = document.querySelector(".bandName");
            const errorMessage = document.querySelector(
              ".errorMessage, .accessDenied"
            );
            const contentArea = document.querySelector(
              ".contentArea, .bandContent"
            );

            if (errorMessage) return false;
            return !!(bandName || contentArea);
          });

          if (bandAccessAfterCookieLogin) {
            logger.info(`쿠키 로그인 후 밴드 ${this.bandNumber} 접근 성공`);
            return true;
          } else {
            logger.error(
              `쿠키 로그인 후에도 밴드 ${this.bandNumber} 접근 실패`
            );

            // 디버깅을 위한 스크린샷 저장
            await this.page.screenshot({
              path: `band-access-error-after-cookie-login-${Date.now()}.png`,
            });
            return false;
          }
        } else {
          logger.error("로그인 정보 부족으로 로그인 시도 불가");
          await this.page.screenshot({
            path: `login-info-missing-${Date.now()}.png`,
          });
          return false;
        }
      } else {
        logger.error(`밴드 ${this.bandNumber} 접근 실패 (로그인 페이지 아님)`);
        await this.page.screenshot({
          path: `band-access-error-${Date.now()}.png`,
        });
        return false;
      }
    }

    logger.info(`밴드 페이지 접근 성공: ${this.bandNumber}`);
    return true;
  }

  /**
   * 사용자 ID 가져오기 또는 생성
   * @returns {Promise<string>} - 사용자 ID
   */
  async getOrCreateUserIdForBand() {
    try {
      // 밴드 ID로 사용자 찾기
      const { data: users, error } = await this.supabase
        .from("users")
        .select("user_id")
        .eq("band_number", this.bandNumber)
        .single();

      if (error && error.code !== "PGRST116") {
        // PGRST116는 결과가 없을 때
        throw error;
      }

      if (users) {
        logger.info(`get User Id : ${users.user_id}`);
        return users.user_id;
      }

      // 사용자가 없으면 새로 생성
      const { data: newUser, error: createError } = await this.supabase
        .from("users")
        .insert([
          {
            band_number: this.bandNumber,
            login_id: `band_${this.bandNumber}`,
            login_password: crypto.randomBytes(16).toString("hex"),
            store_name: `밴드 ${this.bandNumber}`,
            is_active: true,
            role: "user",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ])
        .select("id")
        .single();

      if (createError) {
        throw createError;
      }

      return newUser.id;
    } catch (error) {
      logger.error("사용자 생성/조회 오류:", error);
      throw error;
    }
  }

  async initiateManualNaverLogin(naverId, naverPassword) {
    // userId가 클래스 멤버 변수라고 가정합니다. 아니라면 파라미터로 받거나 정의해야 합니다.
    const userId = this.userId;
    const naverLoginUrl = "https://auth.band.us/login_page"; // 네이버 로그인 URL
    const targetDomain = "band.us"; // 최종 목표 도메인

    try {
      console.log(`[Manual Login] Starting for user ${this.userId}...`);
      this.browser = await puppeteer.launch({
        headless: false,
        args: ["--window-size=800,600"],
      });
      this.page = await this.browser.newPage(); // 'page' 변수 사용

      // 쿠키를 유지하기 위한 설정
      await this.page.setExtraHTTPHeaders({
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
      });

      await this.page.goto("https://auth.band.us/login_page", {
        waitUntil: "networkidle2",
        timeout: 60000, // 시간 증가 고려
      });
      console.log(
        `[Manual Login] Navigated to login page for user ${userId}. Waiting for user action...`
      );

      await this.page.evaluate(() => {
        const naverBtn = document.querySelector(
          "a.-naver.externalLogin, a.uButtonRound.-h56.-icoType.-naver"
        );
        if (naverBtn) naverBtn.click();
        else console.error("Naver login button not found!"); // 버튼 못찾을 경우 로그 추가
      });

      await this.page
        .waitForSelector("#id", { timeout: 60000 })
        .catch((err) => {
          // 시간 증가 고려
          this.updateTaskStatus(
            "processing",
            `Naver ID 필드 대기 중 오류 (계속 진행): ${err.message}`,
            51
          );
          // ID 필드를 못찾으면 로그인 진행이 어려울 수 있으므로 에러 throw 고려
          // throw new Error("Naver ID 입력 필드를 찾을 수 없습니다.");
        });

      await this.page.evaluate(
        (id, pw) => {
          const idInput = document.querySelector("#id");
          const pwInput = document.querySelector("#pw");

          if (idInput) {
            idInput.value = id;
            idInput.dispatchEvent(new Event("input", { bubbles: true }));
            idInput.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            console.error("ID input field not found!");
          }

          if (pwInput) {
            pwInput.value = pw;
            pwInput.dispatchEvent(new Event("input", { bubbles: true }));
            pwInput.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            console.error("Password input field not found!");
          }
        },
        naverId,
        naverPassword
      );

      this.updateTaskStatus(
        "processing",
        "ID와 비밀번호 입력 완료 (직접 DOM 설정)",
        58
      );

      await new Promise((resolve) => setTimeout(resolve, 2000)); // 대기 시간 증가 고려

      // 엔터키 입력으로 로그인 (this.page 대신 page 사용)
      this.updateTaskStatus("processing", "Enter 키로 로그인 시도", 60);
      try {
        await this.page.keyboard.press("Enter"); // catch 제거하고 에러 발생 시 전체 try-catch에서 잡도록 함
      } catch (loginError) {
        this.updateTaskStatus(
          "processing",
          `로그인 시도(Enter) 오류: ${loginError.message}`,
          61
        );
        // 엔터키 실패 시 다른 로그인 버튼 클릭 시도 등을 추가할 수 있음
      }

      await new Promise((resolve) => setTimeout(resolve, 10000)); // 대기 시간 증가 고려

      const maxWaitTime = 300000; // 최대 대기 시간: 5분 (300,000ms)
      const checkInterval = 5000; // 확인 간격: 2초 (2,000ms)
      const startTime = Date.now();

      let loginConfirmed = false;

      while (Date.now() - startTime < maxWaitTime) {
        let currentUrl = "";
        try {
          // 페이지가 닫혔는지 먼저 확인
          if (this.page.isClosed()) {
            console.warn(
              "[Manual Login Debug] Page closed unexpectedly during wait loop."
            );
            throw new Error("로그인 대기 중 페이지가 닫혔습니다.");
          }
          currentUrl = this.page.url();
          console.log(
            `[Manual Login Debug] Checking URL (${Math.round(
              (Date.now() - startTime) / 1000
            )}s): ${currentUrl}`
          );

          // 1. 최종 목표 도달 확인 (band.us)
          if (currentUrl.includes(targetDomain)) {
            console.log(
              `[Manual Login Success] Detected target domain: ${targetDomain}`
            );
            loginConfirmed = true;
            break; // 성공, 루프 종료
          }

          // 2. 네이버 인증 페이지에 머무르는지 확인 (로그인/2FA 등)
          // (주의: 실제 네이버 인증 관련 URL 패턴 확인 필요)
          if (
            currentUrl.includes("nid.naver.com") ||
            currentUrl.includes("nidlogin.login") ||
            currentUrl.includes("login.naver.com") ||
            currentUrl.includes("deviceConfirm")
          ) {
            // 아직 네이버 인증 과정에 있음, 계속 대기
            // 상태 업데이트 (선택적)
            this._updateStatus(
              "waiting",
              `로그인 진행 중... (${Math.round(
                (Date.now() - startTime) / 1000
              )}초)`,
              67
            );
          } else {
            // 3. 예상치 못한 URL (네이버도 아니고 band.us도 아님)
            //    - 중간 리다이렉션 페이지일 수 있으므로 일단 계속 대기
            //    - 또는 특정 오류 페이지 감지 시 실패 처리 가능
            console.log(
              `[Manual Login Debug] Intermediate or unexpected URL: ${currentUrl}. Continuing wait.`
            );
            this._updateStatus(
              "waiting",
              `페이지 이동 감지... (${Math.round(
                (Date.now() - startTime) / 1000
              )}초)`,
              68
            );
          }
        } catch (urlError) {
          // URL 확인 중 오류 발생 시 (페이지 닫힘 등)
          console.error(
            `[Manual Login Debug] Error getting URL or page state: ${urlError.message}`
          );
          throw urlError; // 루프 중단 및 에러 처리
        }

        // 다음 확인까지 대기
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
      } // --- while 루프 종료 ---

      // --- 루프 종료 후 결과 처리 ---
      if (loginConfirmed) {
        this._updateStatus(
          "processing",
          "로그인 성공 확인 (band.us 접속), 쿠키 저장 중...",
          75
        );
        console.log(
          `[Manual Login] Login successful for user ${userId}. Extracting cookies from ${targetDomain}...`
        );

        // 쿠키 추출 (목표 도메인 기준)
        const cookies = await this.browser.cookies();
        await this.saveCookies(userId, naverId, cookies); // this.saveCookies는 그대로 사용
        console.log(`[Manual Login] Cookies saved for user ${userId}.`);
        this._updateStatus("completed", "수동 로그인 및 쿠키 저장 완료", 100);

        return true;
      } else {
        // 타임아웃 발생
        console.error(
          `[Manual Login Error] Login timed out after ${
            maxWaitTime / 1000
          } seconds. Final URL: ${await this.page.url()}`
        );
        this._updateStatus("failed", "로그인 시간 초과", 65);
        throw new Error(
          `네이버 로그인 시간 초과 (${
            maxWaitTime / 1000
          }초). 사용자가 로그인을 완료하지 않았거나 ${targetDomain}로 이동하지 않았습니다.`
        );
        return false;
      }

      // 잠시 대기하여 페이지가 안정화되도록 함

      // // 수동 로그인 확인 및 대기
      // this.updateTaskStatus("waiting", "사용자 로그인 확인 대기 중...", 65);
      // let isLoggedInManual = false;
      // let checkCount = 0;
      // const maxChecks = 30; // 10초 간격 * 30 = 5분

      // while (!isLoggedInManual && checkCount < maxChecks) {
      //   await new Promise((resolve) => setTimeout(resolve, 20000)); // 10초마다 확인

      //   try {
      //     // URL 변경 또는 특정 요소 존재 여부로 로그인 상태 확인 (this.page 대신 page 사용)
      //     // 예시: 밴드 메인 페이지의 특정 요소 확인
      //     isLoggedInManual = await this.page
      //       .evaluate(() => {
      //         // 로그인 후 나타나는 대표적인 요소로 변경 (예: 프로필 영역, 뉴스피드 등)
      //         return (
      //           !!document.querySelector("._gnbProfileButton") ||
      //           !!document.querySelector(".feedList")
      //         );
      //       })
      //       .catch(() => false); // 평가 중 에러 발생 시 false 반환

      //     const progress = 65 + Math.floor((checkCount / maxChecks) * 10); // 진행률 계산
      //     this.updateTaskStatus(
      //       "waiting",
      //       `수동 로그인 대기 중... (${
      //         checkCount + 1
      //       }/${maxChecks}) - 로그인 상태: ${
      //         isLoggedInManual ? "감지됨" : "미감지"
      //       }`,
      //       progress
      //     );

      //     if (isLoggedInManual) {
      //       this.updateTaskStatus("processing", "사용자 로그인 감지됨", 75);
      //       // 로그인 감지 후 안정화를 위해 잠시 더 대기
      //       await new Promise((resolve) => setTimeout(resolve, 5000));
      //       break; // 루프 탈출
      //     }
      //   } catch (e) {
      //     console.error("로그인 상태 확인 중 오류:", e.message);
      //     // 오류 발생 시 다음 체크 시도
      //   }
      //   checkCount++;
      // } // end while

      // // --- 여기부터 괄호 문제 수정 ---

      // // while 루프 후 최종 로그인 상태 확인
      // if (!isLoggedInManual) {
      //   // 시간 초과 또는 로그인 확인 실패
      //   const currentUrl = await this.page.url();
      //   console.warn(
      //     `[Manual Login] Login check timed out or failed for user ${userId}. Final URL: ${currentUrl}`
      //   );
      //   throw new Error(
      //     "사용자가 제한 시간 내에 로그인하지 않았거나, 로그인 상태를 감지할 수 없습니다."
      //   );
      // }

      // 로그인 성공 처리
      this.updateTaskStatus("processing", "로그인 성공 확인", 90);
      this.isLoggedIn = true; // 클래스 상태 업데이트 (필요시)

      // 쿠키 저장 (page 객체에서 쿠키 가져오기)

      this.updateTaskStatus("completed", "로그인 프로세스 완료", 100);
      return true; // 성공 시 true 반환

      // --- 불필요한/잘못된 else 및 return 제거 ---
      // 아래 블록은 제거됨:
      // } else {
      //   console.warn(...)
      //   throw new Error(...)
      // }
      // return { success: true };
    } catch (error) {
      // ... (에러 처리) ...
      // 타임아웃 에러 메시지 개선 가능
      if (error.message.includes("timeout")) {
        throw new Error(
          `네이버 로그인 시간 초과 (설정 시간: ${
            error.timeout / 1000
          }초). 2단계 인증 등을 확인해주세요.`
        );
      }
      throw error; // 다른 에러는 그대로 throw
    } finally {
      if (this.browser) {
        await this.browser.close();
        console.log(`[Manual Login] Browser closed for user ${userId}.`);
      }
    }
    // finally 이후에는 특별한 return문이 없어도 됨 (성공 시 try에서 true 반환, 실패 시 catch에서 에러 throw)
  }
}

module.exports = BandAuth;
