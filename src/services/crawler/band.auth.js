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
  async initialize(naverId, naverPassword) {
    try {
      this.updateTaskStatus("processing", "initialize", 0);

      this.browser = await puppeteer.launch({
        headless: "new", // headless 모드 비활성화로 변경
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
        ignoreHTTPSErrors: true,
        defaultViewport: null,

        executablePath:
          process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser",
      });

      this.page = await this.browser.newPage();
      await this.page.setViewport({ width: 1280, height: 720 });

      // 쿠키를 유지하기 위한 설정
      await this.page.setExtraHTTPHeaders({
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
      });

      this.updateTaskStatus("processing", "브라우저 초기화 완료", 5);

      if (naverId) {
        // 먼저 쿠키 로그인 시도
        const cookieLoginResult = await this.cookieLogin(naverId);

        // 쿠키 로그인 성공 시 종료
        if (cookieLoginResult) {
          return true;
        }

        // 쿠키 로그인 실패하고 비밀번호가 있으면 UI 로그인 시도
        if (naverPassword) {
          this.updateTaskStatus("processing", "직접 로그인 시도", 30);
          return await this.naverLogin(naverId, naverPassword);
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

  async saveCookies(naverId, cookies) {
    try {
      if (!naverId || !cookies || !Array.isArray(cookies)) {
        this.updateTaskStatus(
          "processing",
          "유효하지 않은 쿠키 또는 ID 정보",
          80
        );
        return false;
      }

      this.updateTaskStatus("processing", "쿠키 저장 시작", 80);

      // 밴드 홈으로 이동 시도 (실패해도 계속 진행)
      try {
        await this.page.goto("https://band.us/home", {
          waitUntil: "networkidle2",
          timeout: 30000,
        });
      } catch (navError) {
        console.log(
          "밴드 홈 이동 실패 (무시하고 계속 진행):",
          navError.message
        );
      }

      // 쿠키 디렉토리가 없으면 생성
      await fs.mkdir(COOKIES_PATH, { recursive: true });

      // 모든 밴드 관련 쿠키 필터링 (서브도메인 포함)
      const relevantCookies = cookies.filter(
        (cookie) =>
          cookie &&
          cookie.domain &&
          (cookie.domain.includes("band.us") ||
            cookie.domain.includes("auth.band.us"))
      );

      // 쿠키 수 로깅
      this.updateTaskStatus(
        "processing",
        `총 쿠키 수: ${cookies.length}, 필터링 후 쿠키 수: ${relevantCookies.length}`,
        82
      );

      if (relevantCookies.length === 0) {
        this.updateTaskStatus(
          "processing",
          "저장할 밴드 관련 쿠키가 없습니다.",
          85
        );
        return false;
      }

      // 각 도메인별 쿠키 수 로깅 (디버깅용)
      const bandCookies = cookies.filter(
        (c) => c.domain && c.domain.includes(".band.us")
      ).length;
      const wwwBandCookies = cookies.filter(
        (c) => c.domain && c.domain.includes("www.band.us")
      ).length;
      const authBandCookies = cookies.filter(
        (c) => c.domain && c.domain.includes("auth.band.us")
      ).length;

      this.updateTaskStatus(
        "processing",
        `도메인별 쿠키 수: .band.us: ${bandCookies}, www.band.us: ${wwwBandCookies}, auth.band.us: ${authBandCookies}`,
        84
      );

      // 중요 밴드 쿠키 확인
      const hasBandSession = relevantCookies.some(
        (cookie) => cookie.name === "band_session"
      );

      const hasRtCookie = relevantCookies.some(
        (cookie) => cookie.name === "rt"
      );

      const hasSecretKey = relevantCookies.some(
        (cookie) => cookie.name === "secretKey"
      );

      if (!hasBandSession) {
        this.updateTaskStatus(
          "processing",
          "중요 band_session 쿠키가 없습니다! 그래도 저장을 진행합니다.",
          85
        );
      }

      // 기존 쿠키 파일이 있는지 확인
      const cookieFile = path.join(COOKIES_PATH, `${naverId}.json`);

      // 항상 새로운 쿠키를 저장합니다 (이전 비교 로직 제거)
      this.updateTaskStatus("processing", "새로운 쿠키를 저장합니다.", 86);

      try {
        await fs.writeFile(
          cookieFile,
          JSON.stringify(
            {
              cookies: relevantCookies,
              timestamp: Date.now(),
            },
            null,
            2
          )
        );

        this.updateTaskStatus(
          "processing",
          `쿠키 저장됨: ${cookieFile} (${relevantCookies.length} 쿠키)`,
          88
        );
      } catch (writeError) {
        this.updateTaskStatus(
          "processing",
          `쿠키 파일 저장 실패: ${writeError.message}`,
          88
        );
        return false;
      }

      // 디버깅을 위한 중요 쿠키 정보 로깅
      this.updateTaskStatus(
        "processing",
        `중요 쿠키: BAND_SESSION=${hasBandSession}, RT=${hasRtCookie}, SECRET_KEY=${hasSecretKey}`,
        90
      );

      // 중요 쿠키 정보 로깅
      const bandSessionCookie = relevantCookies.find(
        (c) => c.name === "band_session"
      );
      if (bandSessionCookie) {
        const valueLength = bandSessionCookie.value.length;
        this.updateTaskStatus(
          "processing",
          `band_session 쿠키 길이: ${valueLength}, 도메인: ${bandSessionCookie.domain}`,
          92
        );
      }

      const rtCookie = relevantCookies.find((c) => c.name === "rt");
      if (rtCookie) {
        const valueLength = rtCookie.value.length;
        this.updateTaskStatus(
          "processing",
          `rt 쿠키 길이: ${valueLength}, 도메인: ${rtCookie.domain}`,
          94
        );
      }

      // 모든 저장된 쿠키 이름 로깅
      const cookieNames = relevantCookies.map((c) => c.name).join(", ");
      this.updateTaskStatus(
        "processing",
        `저장된 모든 쿠키 이름: ${cookieNames}`,
        96
      );

      return true;
    } catch (error) {
      this.updateTaskStatus(
        "processing",
        `쿠키 저장 중 오류: ${error.message}`,
        80
      );
      console.error("쿠키 저장 오류:", error);
      // 오류가 있어도 프로세스를 중단하지 않고 계속 진행
      return false;
    }
  }

  async loadCookies(naverId) {
    try {
      const cookieFile = path.join(COOKIES_PATH, `${naverId}.json`);
      const cookieData = await fs.readFile(cookieFile, "utf8");
      const data = JSON.parse(cookieData);

      // 쿠키 만료 시간 확인 제거 - 계속 유지되도록 수정
      // const cookieAge = Date.now() - data.timestamp;
      // if (cookieAge > 24 * 60 * 60 * 1000) {
      //   this.updateTaskStatus(
      //     "processing",
      //     "저장된 쿠키가 만료되었습니다 (24시간 초과)",
      //     12
      //   );
      //   return null;
      // }

      this.updateTaskStatus("processing", "저장된 쿠키를 불러왔습니다", 12);
      return data.cookies;
    } catch (error) {
      this.updateTaskStatus("processing", "저장된 쿠키를 찾을 수 없습니다", 12);
      return null;
    }
  }

  /**
   * 네이버 로그인 시도
   */
  async naverLogin(naverId, naverPassword) {
    const randomDelay = Math.floor(Math.random() * (3000 - 1000 + 1)) + 1000;
    this.updateTaskStatus("processing", "네이버 로그인 시작", 40);

    try {
      await this.page.goto("https://auth.band.us/login_page", {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      await new Promise((resolve) => setTimeout(resolve, randomDelay));

      // 네이버 로그인 버튼 클릭
      await this.page.evaluate(() => {
        const naverBtn = document.querySelector(
          "a.-naver.externalLogin, a.uButtonRound.-h56.-icoType.-naver"
        );
        if (naverBtn) naverBtn.click();
      });

      await this.page
        .waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 })
        .catch(() => {});

      // 3. 네이버 로그인 페이지에서 아이디/비밀번호 입력
      this.updateTaskStatus("processing", "네이버 아이디/비밀번호 입력", 50);

      // 페이지가 완전히 로드될 때까지 기다림
      await this.page
        .waitForSelector("#id", { timeout: 30000 })
        .catch((err) => {
          this.updateTaskStatus(
            "processing",
            `ID 필드 대기 중 오류 (계속 진행): ${err.message}`,
            51
          );
        });

      // 잠시 대기하여 페이지가 안정화되도록 함
      await new Promise((resolve) => setTimeout(resolve, 3000));

      try {
        // 직접 자바스크립트 삽입으로 입력 (가장 안정적인 방법)
        await this.page.evaluate(
          (id, pw) => {
            // ID 필드 입력
            if (document.querySelector("#id")) {
              document.querySelector("#id").value = id;
              document
                .querySelector("#id")
                .dispatchEvent(new Event("input", { bubbles: true }));
              document
                .querySelector("#id")
                .dispatchEvent(new Event("change", { bubbles: true }));
            }

            // 비밀번호 필드 입력
            if (document.querySelector("#pw")) {
              document.querySelector("#pw").value = pw;
              document
                .querySelector("#pw")
                .dispatchEvent(new Event("input", { bubbles: true }));
              document
                .querySelector("#pw")
                .dispatchEvent(new Event("change", { bubbles: true }));
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

        // 확인을 위한 대기
        await new Promise((resolve) => setTimeout(resolve, randomDelay));
      } catch (inputError) {
        this.updateTaskStatus(
          "processing",
          `입력 과정 오류 (계속 진행): ${inputError.message}`,
          59
        );

        // 실패 시 대체 방법으로 type 메서드 사용
        try {
          // ID 직접 입력
          await this.page.evaluate(() => {
            if (document.querySelector("#id")) {
              document.querySelector("#id").value = "";
            }
          });

          await this.page.type("#id", naverId, { delay: 150 });
          this.updateTaskStatus("processing", "ID 입력 완료 (type 메서드)", 55);

          await new Promise((resolve) => setTimeout(resolve, randomDelay));

          // 비밀번호 입력
          await this.page.evaluate(() => {
            if (document.querySelector("#pw")) {
              document.querySelector("#pw").value = "";
            }
          });

          await this.page.type("#pw", naverPassword, { delay: 150 });
          this.updateTaskStatus(
            "processing",
            "비밀번호 입력 완료 (type 메서드)",
            58
          );

          await new Promise((resolve) => setTimeout(resolve, randomDelay));
        } catch (e) {
          this.updateTaskStatus(
            "processing",
            `대체 입력 방식도 실패: ${e.message}`,
            59
          );
        }
      }

      // 엔터키 입력으로 로그인
      this.updateTaskStatus("processing", "Enter 키로 로그인", 60);
      try {
        await this.page.keyboard.press("Enter").catch((e) => {
          this.updateTaskStatus(
            "processing",
            `엔터키 입력 오류: ${e.message}`,
            61
          );
        });
      } catch (loginError) {
        this.updateTaskStatus(
          "processing",
          `로그인 시도 오류 (계속 진행): ${loginError.message}`,
          63
        );
      }

      // 네비게이션 완료 대기
      await this.page
        .waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 })
        .catch((e) => {
          this.updateTaskStatus(
            "processing",
            `네비게이션 대기 오류 (계속 진행): ${e.message}`,
            64
          );
        });

      await new Promise((resolve) => setTimeout(resolve, randomDelay * 2));

      // 밴드 홈페이지로 직접 이동
      this.updateTaskStatus("processing", "밴드 홈페이지로 이동", 70);
      await this.page
        .goto("https://www.band.us/home", {
          waitUntil: "networkidle2",
          timeout: 30000,
        })
        .catch((e) => {
          this.updateTaskStatus(
            "processing",
            `밴드 홈페이지 이동 오류 (계속 진행): ${e.message}`,
            71
          );
        });

      // 충분한 로딩 시간 대기
      await new Promise((resolve) => setTimeout(resolve, randomDelay));

      // 로그인 확인
      const isLoggedIn = await this.checkLoginStatus().catch(() => false);

      if (isLoggedIn) {
        this.updateTaskStatus("processing", "네이버 로그인 성공", 75);
        this.isLoggedIn = true;

        // 쿠키 저장
        const naverCookies = await this.browser.cookies();
        await this.saveCookies(naverId, naverCookies);

        this.updateTaskStatus("completed", "로그인 프로세스 완료", 100);
        return true;
      }

      // 로그인 실패 - 리캡챠 확인
      const hasRecaptcha = await this.detectRecaptcha();
      if (hasRecaptcha) {
        this.updateTaskStatus(
          "processing",
          "리캡챠 감지됨, headless 모드 비활성화 후 브라우저 재시작",
          65
        );

        try {
          // 기존 브라우저 닫기
          if (this.browser) {
            // 열려 있는 모든 페이지 먼저 닫기
            const pages = await this.browser.pages().catch(() => []);
            for (const page of pages) {
              if (page && !page.isClosed()) {
                await page.close().catch(() => {});
              }
            }

            // 짧은 딜레이 추가
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // 브라우저 종료
            await this.browser.close().catch((err) => {
              console.error("브라우저 종료 오류 (무시됨):", err.message);
            });
          }

          // 잠시 대기 후 새 브라우저 시작
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // headless: false로 새 브라우저 시작
          this.browser = await puppeteer.launch({
            headless: false,
            args: [
              "--no-sandbox",
              "--disable-setuid-sandbox",
              "--start-maximized",
            ],
            defaultViewport: null,
          });

          this.page = await this.browser.newPage();
          await this.page.setViewport({ width: 1920, height: 1080 });

          // 쿠키를 유지하기 위한 설정
          await this.page.setExtraHTTPHeaders({
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
          });

          // 네이버 로그인 페이지로 이동
          await this.page.goto("https://auth.band.us/login_page", {
            waitUntil: "networkidle2",
            timeout: 30000,
          });

          // 네이버 로그인 버튼 클릭
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // 네이버 로그인 버튼 클릭
          await this.page
            .evaluate(() => {
              const naverBtn = document.querySelector(
                "a.-naver.externalLogin, a.uButtonRound.-h56.-icoType.-naver"
              );
              if (naverBtn) naverBtn.click();
            })
            .catch((e) => {
              this.updateTaskStatus(
                "processing",
                `네이버 로그인 버튼 클릭 오류: ${e.message}`,
                67
              );
            });

          // 네이버 로그인 페이지로 이동 대기
          await this.page
            .waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 })
            .catch(() => {});

          // 로그인 입력 필드 기다리기
          await this.page
            .waitForSelector("#id", { timeout: 10000 })
            .catch(() => {});

          // 잠시 대기
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // 아이디와 비밀번호 입력 시도
          try {
            // ID 값을 먼저 지우고 새로 입력
            await this.page.evaluate(() => {
              if (document.querySelector("#id")) {
                document.querySelector("#id").value = "";
              }
            });

            await this.page.type("#id", naverId, { delay: 150 });
            this.updateTaskStatus(
              "processing",
              "리캡챠 모드에서 ID 입력 완료",
              68
            );

            await new Promise((resolve) => setTimeout(resolve, 2000));

            // 비밀번호도 동일하게 처리
            await this.page.evaluate(() => {
              if (document.querySelector("#pw")) {
                document.querySelector("#pw").value = "";
              }
            });

            await this.page.type("#pw", naverPassword, { delay: 150 });
            this.updateTaskStatus(
              "processing",
              "리캡챠 모드에서 비밀번호 입력 완료",
              69
            );

            await new Promise((resolve) => setTimeout(resolve, 2000));
          } catch (e) {
            this.updateTaskStatus(
              "processing",
              `리캡챠 모드에서 입력 오류: ${e.message}`,
              69
            );

            // 실패 시 직접 DOM 조작 시도
            try {
              await this.page.evaluate(
                (id, pw) => {
                  if (document.querySelector("#id")) {
                    document.querySelector("#id").value = id;
                    document
                      .querySelector("#id")
                      .dispatchEvent(new Event("input", { bubbles: true }));
                    document
                      .querySelector("#id")
                      .dispatchEvent(new Event("change", { bubbles: true }));
                  }

                  if (document.querySelector("#pw")) {
                    document.querySelector("#pw").value = pw;
                    document
                      .querySelector("#pw")
                      .dispatchEvent(new Event("input", { bubbles: true }));
                    document
                      .querySelector("#pw")
                      .dispatchEvent(new Event("change", { bubbles: true }));
                  }
                },
                naverId,
                naverPassword
              );

              this.updateTaskStatus(
                "processing",
                "리캡챠 모드에서 DOM 조작으로 입력 완료",
                69
              );
            } catch (err) {
              this.updateTaskStatus(
                "processing",
                `리캡챠 모드 입력 완전 실패: ${err.message}`,
                69
              );
            }
          }

          this.updateTaskStatus(
            "waiting",
            "리캡챠가 감지되었습니다. 사용자가 직접 로그인하도록 브라우저가 열렸습니다. 로그인을 완료해주세요.",
            65
          );

          // 수동 로그인 대기 (최대 5분)
          let isLoggedIn = false;
          let checkCount = 0;
          const maxChecks = 30; // 10초 간격으로 30번 체크 (약 5분)

          while (!isLoggedIn && checkCount < maxChecks) {
            await new Promise((resolve) => setTimeout(resolve, 10000)); // 10초마다 확인

            try {
              // URL로 판단하지 않고 실제 프로필 요소 확인으로 로그인 상태 판별
              isLoggedIn = await this.page
                .evaluate(() => {
                  // profileInner 요소가 존재하면 로그인된 상태
                  const profileElement =
                    document.querySelector(".profileInner");
                  return !!profileElement;
                })
                .catch(() => false);

              this.updateTaskStatus(
                "waiting",
                `수동 로그인 대기 중... (${
                  checkCount + 1
                }/${maxChecks}) - profileInner ${
                  isLoggedIn ? "확인됨" : "확인되지 않음"
                }`,
                65 + Math.floor((checkCount / maxChecks) * 10)
              );

              if (isLoggedIn) {
                this.updateTaskStatus("processing", "수동 로그인 성공", 75);

                // 사용자가 로그인 완료 후 페이지를 확인할 수 있도록 충분한 시간 제공
                this.updateTaskStatus(
                  "waiting",
                  "로그인이 완료되었습니다. 10초 후 자동으로 진행합니다. 페이지를 확인하세요.",
                  75
                );

                // 10초 대기
                await new Promise((resolve) => setTimeout(resolve, 10000));

                break;
              }
            } catch (e) {
              console.error("로그인 상태 확인 중 오류:", e.message);
            }

            checkCount++;
          }

          if (!isLoggedIn) {
            this.updateTaskStatus("failed", "수동 로그인 시간 초과", 75);
            throw new Error("수동 로그인 시간 초과");
          }
        } catch (error) {
          console.error("리캡챠 처리 중 오류:", error.message);
          this.updateTaskStatus(
            "failed",
            `리캡챠 처리 중 오류 발생: ${error.message}`,
            66
          );
          return false;
        }
      }
    } catch (error) {
      this.isLoggedIn = false;
      this.updateTaskStatus("failed", `로그인 실패: ${error.message}`, 60);
      throw error;
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
      // 밴드 페이지로 직접 이동하여 로그인 상태 확인
      this.updateTaskStatus(
        "processing",
        `밴드 페이지(${this.bandNumber})로 이동하여 로그인 상태 확인 중`,
        20
      );

      // 밴드 페이지로 이동
      await this.page
        .goto(`https://www.band.us/band/${this.bandNumber}`, {
          waitUntil: "networkidle2",
          timeout: 30000,
        })
        .catch((err) => {
          this.updateTaskStatus(
            "processing",
            `밴드 페이지 이동 중 오류 (계속 진행): ${err.message}`,
            21
          );
        });

      // 추가 로딩 시간 대기
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // profileInner 요소로 로그인 상태 확인
      const isLoggedIn = await this.page.evaluate(() => {
        // profileInner 요소가 존재하면 로그인된 상태
        const profileElement = document.querySelector(".profileInner");
        return !!profileElement;
      });

      if (isLoggedIn) {
        this.updateTaskStatus(
          "processing",
          "profileInner 요소 확인됨 - 로그인 성공",
          25
        );
        return true;
      } else {
        this.updateTaskStatus(
          "processing",
          "profileInner 요소 없음 - 로그인 필요",
          23
        );
        return false;
      }
    } catch (error) {
      this.updateTaskStatus(
        "processing",
        `로그인 상태 확인 중 오류: ${error.message}`,
        25
      );
      return false;
    }
  }

  // (쿠키 처리, 로그인, 리캡챠 감지 등 기존 BaseCrawler 메서드들)
  async cookieLogin(naverId) {
    try {
      this.updateTaskStatus("processing", "쿠키 로그인 시도", 10);

      // 저장된 쿠키 로드
      const savedCookies = await this.loadCookies(naverId);
      if (!savedCookies) {
        this.updateTaskStatus("processing", "저장된 쿠키가 없습니다", 15);
        // 쿠키가 없는 경우 로그인 페이지로 이동
        await this.page.goto("https://www.band.us/home", {
          waitUntil: "networkidle2",
          timeout: 30000,
        });
        this.updateTaskStatus("processing", "로그인 페이지로 이동 완료", 16);
        return false;
      }

      // 쿠키 설정
      await this.browser.setCookie(...savedCookies);
      this.updateTaskStatus("processing", "저장된 쿠키 로드됨", 20);

      // 로그인 상태 확인하는 메서드 호출
      const isLoggedIn = await this.checkLoginStatus();
      if (isLoggedIn) {
        this.updateTaskStatus("processing", "쿠키로 로그인 성공", 30);
        this.isLoggedIn = true;
        return true;
      }

      this.updateTaskStatus(
        "processing",
        "쿠키가 만료되었거나 유효하지 않습니다",
        25
      );

      // 쿠키 로그인 실패 시 쿠키 파일 삭제
      try {
        const cookieFile = path.join(COOKIES_PATH, `${naverId}.json`);
        await fs.unlink(cookieFile);
        this.updateTaskStatus("processing", "만료된 쿠키 파일 삭제됨", 26);
      } catch (deleteError) {
        this.updateTaskStatus(
          "processing",
          `쿠키 파일 삭제 실패: ${deleteError.message}`,
          26
        );
      }

      // 쿠키 로그인 실패 시 로그인 페이지로 이동
      await this.page.goto(
        "https://auth.band.us/login_page?next_url=https%3A%2F%2Fwww.band.us%2Fhome%3Freferrer%3Dhttps%253A%252F%252Fwww.band.us%252F",
        {
          waitUntil: "networkidle2",
          timeout: 30000,
        }
      );
      this.updateTaskStatus("processing", "로그인 페이지로 이동 완료", 27);

      return false;
    } catch (error) {
      this.updateTaskStatus(
        "processing",
        `쿠키 로그인 실패: ${error.message}`,
        20
      );

      // 에러 발생 시에도 쿠키 파일 삭제 시도
      try {
        const cookieFile = path.join(COOKIES_PATH, `${naverId}.json`);
        await fs.unlink(cookieFile);
        this.updateTaskStatus(
          "processing",
          "에러 발생으로 쿠키 파일 삭제됨",
          21
        );
      } catch (deleteError) {
        this.updateTaskStatus(
          "processing",
          `쿠키 파일 삭제 실패: ${deleteError.message}`,
          21
        );
      }

      // 에러 발생 시에도 로그인 페이지로 이동
      try {
        await this.page.goto("https://auth.band.us/login_page", {
          waitUntil: "networkidle2",
          timeout: 30000,
        });
        this.updateTaskStatus(
          "processing",
          "에러 발생 후 로그인 페이지로 이동 완료",
          22
        );
      } catch (navError) {
        this.updateTaskStatus(
          "processing",
          `로그인 페이지 이동 실패: ${navError.message}`,
          22
        );
      }

      return false;
    }
  }

  /**
   * 밴드 페이지 접근 처리
   * @param {string} naverId - 네이버 ID
   * @param {string} naverPassword - 네이버 비밀번호
   * @returns {Promise<boolean>} - 접근 성공 여부
   */
  async accessBandPage(naverId, naverPassword) {
    // 브라우저 초기화 확인
    if (!this.browser || !this.page) {
      logger.info("브라우저 초기화 중...");
      await this.initialize(naverId, naverPassword);
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
        const cookieLoginResult = await this.cookieLogin(naverId);

        // 쿠키 로그인 실패 시 직접 로그인 시도
        if (!cookieLoginResult && naverId && naverPassword) {
          logger.info("쿠키 로그인 실패, 직접 로그인 시도 중...");
          const loginSuccess = await this.naverLogin(naverId, naverPassword);

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
        await this.saveCookies(naverId, cookies); // this.saveCookies는 그대로 사용
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
