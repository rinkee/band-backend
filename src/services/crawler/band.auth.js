// src/services/crawler/band.auth.js (통합된 버전)
const puppeteer = require("puppeteer");
const logger = require("../../config/logger");
const fs = require("fs").promises;
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

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
    this.bandId = "";
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
        headless: true, // 기본적으로 headless 모드 활성화
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
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

  async naverLogin(naverId, naverPassword) {
    // 기다리는 시간 랜덤
    const min = 2000; // 최소 2초
    const max = 4000; // 최대 4초
    const randomDelay = Math.floor(Math.random() * (max - min + 1)) + min;

    try {
      this.updateTaskStatus("processing", "네이버 로그인 시작", 40);

      // 현재 URL 확인
      const currentUrl = this.page.url();

      // 1. 현재 페이지가 auth.band.us 인 경우 (밴드 로그인 페이지)
      if (currentUrl.includes("auth.band.us")) {
        this.updateTaskStatus(
          "processing",
          "밴드 로그인 페이지에서 네이버 로그인 버튼 클릭",
          45
        );

        // 네이버 로그인 버튼 클릭
        const naverBtnClicked = await this.page.evaluate(() => {
          const naverBtn = document.querySelector(
            "a.-naver.externalLogin, a.uButtonRound.-h56.-icoType.-naver"
          );
          if (naverBtn) {
            naverBtn.click();
            return true;
          }
          return false;
        });

        if (!naverBtnClicked) {
          this.updateTaskStatus(
            "processing",
            "네이버 로그인 버튼을 찾을 수 없어 직접 네이버 로그인 페이지로 이동",
            46
          );
          await this.page.goto("https://nid.naver.com/nidlogin.login", {
            waitUntil: "networkidle2",
            timeout: 30000,
          });
        } else {
          // 네이버 로그인 페이지로 이동 대기
          await this.page
            .waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 })
            .catch(() => {});
        }

        await new Promise((resolve) => setTimeout(resolve, randomDelay));
      }
      // 2. 현재 페이지가 밴드 홈 또는 다른 밴드 페이지인 경우
      else if (currentUrl.includes("band.us")) {
        this.updateTaskStatus(
          "processing",
          "밴드 페이지에서 로그인 버튼 클릭",
          45
        );

        // 로그인 버튼 클릭
        const loginBtnClicked = await this.page.evaluate(() => {
          const loginBtn = document.querySelector(
            "a.login, button._loginBtn, a.btnTextStyle._btnLogin"
          );
          if (loginBtn) {
            loginBtn.click();
            return true;
          }
          return false;
        });

        if (!loginBtnClicked) {
          this.updateTaskStatus(
            "processing",
            "로그인 버튼을 찾을 수 없어 직접 로그인 페이지로 이동",
            46
          );
          await this.page.goto("https://auth.band.us/login_page", {
            waitUntil: "networkidle2",
            timeout: 30000,
          });

          // 로그인 페이지에서 네이버 로그인 버튼 클릭
          await new Promise((resolve) => setTimeout(resolve, randomDelay));
          await this.page.evaluate(() => {
            const naverBtn = document.querySelector(
              "a.-naver.externalLogin, a.uButtonRound.-h56.-icoType.-naver"
            );
            if (naverBtn) naverBtn.click();
          });
        }

        // 네이버 로그인 페이지로 이동 대기
        await this.page
          .waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 })
          .catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, randomDelay));
      }

      // 3. 네이버 로그인 페이지에서 아이디/비밀번호 입력
      this.updateTaskStatus("processing", "네이버 아이디/비밀번호 입력", 50);

      // ID 필드 대기 및 입력
      await this.page
        .waitForSelector("#id", { visible: true, timeout: 30000 })
        .catch(() => {});

      // 아이디 입력
      await this.page.evaluate((id) => {
        const idField = document.querySelector("#id");
        if (idField) {
          idField.value = id;
          idField.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }, naverId);

      await new Promise((resolve) => setTimeout(resolve, randomDelay));

      // 비밀번호 입력
      await this.page.evaluate((pw) => {
        const pwField = document.querySelector("#pw");
        if (pwField) {
          pwField.value = pw;
          pwField.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }, naverPassword);

      await new Promise((resolve) => setTimeout(resolve, randomDelay));

      // 로그인 버튼 클릭
      this.updateTaskStatus("processing", "로그인 버튼 클릭", 60);
      const loginClicked = await this.page.evaluate(() => {
        const loginBtn = document.querySelector(
          'button.btn_login, button[type="submit"]'
        );
        if (loginBtn) {
          loginBtn.click();
          return true;
        }
        return false;
      });

      if (!loginClicked) {
        // 버튼 클릭 실패 시 엔터키 시도
        this.updateTaskStatus("processing", "Enter 키로 로그인", 60);
        await this.page.keyboard.press("Enter");
      }

      // 리다이렉트 대기
      await this.page
        .waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 })
        .catch(() => {});

      // 리캡챠 감지
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

          const naverBtnClicked = await this.page
            .evaluate(() => {
              const naverBtn = document.querySelector(
                "a.-naver.externalLogin, a.uButtonRound.-h56.-icoType.-naver"
              );
              if (naverBtn) {
                naverBtn.click();
                return true;
              }
              return false;
            })
            .catch(() => false);

          // 네이버 로그인 페이지로 이동 대기
          await this.page
            .waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 })
            .catch(() => {});

          // 아이디 입력
          await this.page
            .evaluate((id) => {
              const idField = document.querySelector("#id");
              if (idField) {
                idField.value = id;
                idField.dispatchEvent(new Event("input", { bubbles: true }));
              }
            }, naverId)
            .catch(() => {
              console.error("아이디 입력 실패");
            });

          // 비밀번호 입력
          await this.page
            .evaluate((pw) => {
              const pwField = document.querySelector("#pw");
              if (pwField) {
                pwField.value = pw;
                pwField.dispatchEvent(new Event("input", { bubbles: true }));
              }
            }, naverPassword)
            .catch(() => {
              console.error("비밀번호 입력 실패");
            });

          this.updateTaskStatus(
            "waiting",
            "리캡챠가 감지되었습니다. 사용자가 직접 로그인하도록 브라우저가 열렸습니다. 로그인을 완료해주세요.",
            65
          );
        } catch (error) {
          console.error("리캡챠 처리 중 오류:", error.message);
          this.updateTaskStatus(
            "processing",
            `리캡챠 처리 중 오류 발생: ${error.message}. 계속 진행합니다.`,
            66
          );

          // 어떤 문제가 발생하더라도 새 브라우저 생성 시도
          try {
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

            await this.page.goto("https://nid.naver.com/nidlogin.login", {
              waitUntil: "networkidle2",
              timeout: 30000,
            });
          } catch (browserError) {
            console.error("새 브라우저 생성 실패:", browserError.message);
            this.updateTaskStatus(
              "failed",
              `새 브라우저 생성 실패: ${browserError.message}`,
              66
            );
            throw browserError;
          }
        }

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
                const profileElement = document.querySelector(".profileInner");
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
      }

      // 로그인 후 충분한 대기 시간
      await new Promise((resolve) => setTimeout(resolve, randomDelay * 2));

      // 로그인 상태 확인
      const loginConfirmed = await this.checkLoginStatus();
      if (loginConfirmed) {
        this.updateTaskStatus("processing", "네이버 로그인 성공", 80);
        this.isLoggedIn = true;

        // 쿠키 저장
        const naverCookies = await this.browser.cookies();
        await this.saveCookies(naverId, naverCookies);

        this.updateTaskStatus("completed", "로그인 프로세스 완료", 100);
        return true;
      } else {
        // 로그인 실패 - 밴드 홈으로 이동해서 한번 더 확인
        this.updateTaskStatus(
          "processing",
          "로그인 확인 실패, 추가 확인 중...",
          75
        );

        await this.page.goto("https://band.us/home", {
          waitUntil: "networkidle2",
          timeout: 30000,
        });

        const finalCheck = await this.checkLoginStatus();
        if (finalCheck) {
          this.updateTaskStatus(
            "processing",
            "네이버 로그인 성공 (추가 확인)",
            80
          );
          this.isLoggedIn = true;

          // 쿠키 저장
          const naverCookies = await this.browser.cookies();
          await this.saveCookies(naverId, naverCookies);

          this.updateTaskStatus("completed", "로그인 프로세스 완료", 100);
          return true;
        } else {
          this.updateTaskStatus("failed", "로그인 실패", 75);
          this.isLoggedIn = false;

          // 디버깅 스크린샷
          await this.page.screenshot({
            path: `login-failed-${Date.now()}.png`,
          });

          throw new Error("로그인 실패: 확인 과정에서 로그인되지 않음");
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
        `밴드 페이지(${this.bandId})로 이동하여 로그인 상태 확인 중`,
        20
      );

      // 밴드 페이지로 이동
      await this.page
        .goto(`https://www.band.us/band/${this.bandId}`, {
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
        await this.page.goto(
          "https://auth.band.us/login_page?next_url=https%3A%2F%2Fwww.band.us%2Fhome%3Freferrer%3Dhttps%253A%252F%252Fwww.band.us%252F",
          {
            waitUntil: "networkidle2",
            timeout: 30000,
          }
        );
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

    logger.info(`밴드 페이지로 이동: https://band.us/band/${this.bandId}`);

    // 밴드 페이지로 이동
    await this.page.goto(`https://band.us/band/${this.bandId}`, {
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
      logger.info(`밴드 ${this.bandId} 접근 실패, 로그인 페이지 확인 중...`);

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
            await this.page.goto(`https://band.us/band/${this.bandId}`, {
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
              logger.info(`로그인 후 밴드 ${this.bandId} 접근 성공`);
              return true;
            } else {
              logger.error(`로그인 후에도 밴드 ${this.bandId} 접근 실패`);

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
          await this.page.goto(`https://band.us/band/${this.bandId}`, {
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
            logger.info(`쿠키 로그인 후 밴드 ${this.bandId} 접근 성공`);
            return true;
          } else {
            logger.error(`쿠키 로그인 후에도 밴드 ${this.bandId} 접근 실패`);

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
        logger.error(`밴드 ${this.bandId} 접근 실패 (로그인 페이지 아님)`);
        await this.page.screenshot({
          path: `band-access-error-${Date.now()}.png`,
        });
        return false;
      }
    }

    logger.info(`밴드 페이지 접근 성공: ${this.bandId}`);
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
        .eq("band_id", this.bandId)
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
            band_id: this.bandId,
            login_id: `band_${this.bandId}`,
            login_password: crypto.randomBytes(16).toString("hex"),
            store_name: `밴드 ${this.bandId}`,
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
}

module.exports = BandAuth;
