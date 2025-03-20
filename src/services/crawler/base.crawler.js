const puppeteer = require("puppeteer");
const logger = require("../../config/logger");
const fs = require("fs").promises;
const path = require("path");

// 쿠키 저장 경로 설정
const COOKIES_PATH = path.join(__dirname, "../../../cookies");

class BaseCrawler {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isLoggedIn = false;
    this.taskId = `task_${Date.now()}`;
    this.status = {
      status: "initialized",
      message: "크롤러가 초기화되었습니다",
      progress: 0,
      updatedAt: new Date(),
    };
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
  }

  async initialize(naverId, naverPassword) {
    try {
      this.updateTaskStatus("processing", "initialize", 0);

      this.browser = await puppeteer.launch({
        headless: false,
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

  async cookieLogin(naverId) {
    try {
      this.updateTaskStatus("processing", "쿠키 로그인 시도", 10);

      // 저장된 쿠키 로드
      const savedCookies = await this.loadCookies(naverId);
      if (!savedCookies) {
        this.updateTaskStatus("processing", "저장된 쿠키가 없습니다", 15);
        return false;
      }

      // 쿠키 설정
      await this.page.setCookie(...savedCookies);
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
      return false;
    } catch (error) {
      this.updateTaskStatus(
        "processing",
        `쿠키 로그인 실패: ${error.message}`,
        20
      );
      return false;
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

      // 쿠키 유효기간 확인 (24시간)
      const cookieAge = Date.now() - data.timestamp;
      if (cookieAge > 24 * 60 * 60 * 1000) {
        this.updateTaskStatus(
          "processing",
          "저장된 쿠키가 만료되었습니다 (24시간 초과)",
          12
        );
        return null;
      }

      return data.cookies;
    } catch (error) {
      this.updateTaskStatus("processing", "저장된 쿠키를 찾을 수 없습니다", 12);
      return null;
    }
  }

  async naverLogin(naverId, naverPassword) {
    // 기다리는 시간 랜덤
    const min = 5000; // 최소 2초 (2000ms)
    const max = 8000; // 최대 4초 (4000ms)
    const randomDelay = Math.floor(Math.random() * (max - min + 1)) + min;

    try {
      if (this.isLoggedIn) {
        this.updateTaskStatus("completed", "이미 로그인되어 있습니다", 100);
        return true;
      }

      this.updateTaskStatus("processing", "밴드 로그인 시작", 40);

      // 밴드 홈으로
      await this.page.goto("https://www.band.us/home", {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      await new Promise((resolve) => setTimeout(resolve, randomDelay));

      await this.page.click("a.login");

      this.updateTaskStatus("processing", "네이버 로그인 버튼 확인 중", 35);
      await this.page.waitForSelector("a.-naver.externalLogin", {
        visible: true,
        timeout: 5000,
      });

      // 네이버 로그인 버튼 클릭
      this.updateTaskStatus("processing", "네이버 로그인 버튼 클릭", 40);
      await this.page.click("a.-naver.externalLogin");

      await new Promise((resolve) => setTimeout(resolve, randomDelay));
      this.updateTaskStatus("processing", "로그인 폼 입력 중...", 45);

      // 클립보드 방식으로 ID 입력
      await this.page.waitForSelector("#id", { visible: true });
      await this.page.evaluate((userId) => {
        document.querySelector("#id").value = userId;
        // 입력 이벤트 발생시켜 네이버 로그인 폼이 값 변경을 인식하게 함
        document
          .querySelector("#id")
          .dispatchEvent(new Event("input", { bubbles: true }));
      }, naverId);

      await new Promise((resolve) => setTimeout(resolve, randomDelay));
      this.updateTaskStatus("processing", "아이디 입력 완료", 50);

      // 클립보드 방식으로 PW 입력
      await this.page.waitForSelector("#pw", { visible: true });
      await this.page.evaluate((userPw) => {
        document.querySelector("#pw").value = userPw;
        // 입력 이벤트 발생시켜 네이버 로그인 폼이 값 변경을 인식하게 함
        document
          .querySelector("#pw")
          .dispatchEvent(new Event("input", { bubbles: true }));
      }, naverPassword);

      // 로그인 버튼 클릭 전 잠시 대기
      await new Promise((resolve) => setTimeout(resolve, randomDelay));
      this.updateTaskStatus("processing", "비밀번호 입력 완료", 55);

      // 로그인 버튼 클릭
      const loginButton = await this.page.$("button[type='submit']");
      if (loginButton) {
        await loginButton.click();
        this.updateTaskStatus("processing", "로그인 버튼 클릭됨", 60);
      } else {
        // 버튼을 찾지 못하면 Enter 키 사용
        await this.page.keyboard.press("Enter");
        this.updateTaskStatus("processing", "Enter 키로 로그인 폼 제출", 60);
      }

      await new Promise((resolve) => setTimeout(resolve, randomDelay));

      // 리캡챠 감지
      const hasRecaptcha = await this.detectRecaptcha();
      if (hasRecaptcha) {
        this.updateTaskStatus(
          "processing",
          "리캡챠 감지됨, 수동 로그인 대기 중",
          65
        );
        // 수동 로그인 대기 (최대 5분)
        let isLoggedIn = false;
        let checkCount = 0;
        const maxChecks = 10;

        while (!isLoggedIn && checkCount < maxChecks) {
          await new Promise((resolve) => setTimeout(resolve, 30000));
          const currentUrl = this.page.url();
          isLoggedIn = !currentUrl.includes("nidlogin.login");

          this.updateTaskStatus(
            "processing",
            `수동 로그인 대기 중... (${checkCount + 1}/${maxChecks})`,
            65 + checkCount * 2
          );

          if (isLoggedIn) {
            this.updateTaskStatus("processing", "수동 로그인 성공", 75);
            break;
          }
          checkCount++;
        }

        if (!isLoggedIn) {
          this.updateTaskStatus("failed", "수동 로그인 시간 초과", 75);
          throw new Error("수동 로그인 시간 초과");
        }
      }

      // 로그인 성공 확인 대기
      await new Promise((resolve) => setTimeout(resolve, randomDelay));

      // 로그인 성공 확인
      this.updateTaskStatus("processing", "로그인 상태 확인 중", 75);

      this.updateTaskStatus("processing", "네이버 로그인 성공", 80);

      this.page.waitForNetworkIdle();
      // 네이버 로그인 성공한 후 쿠키 저장
      const naverCookies = await this.browser.cookies();
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await this.saveCookies(naverId, naverCookies);
      this.isLoggedIn = true;

      this.updateTaskStatus("completed", "로그인 프로세스 완료", 100);
      return true;
    } catch (error) {
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
      if (this.browser && this.browser.isConnected()) {
        this.updateTaskStatus("processing", "브라우저 종료 중", 95);

        // 열려 있는 모든 페이지 먼저 닫기
        try {
          const pages = await this.browser.pages();
          for (const page of pages) {
            if (page && !page.isClosed()) {
              await page.close().catch(() => {});
            }
          }
        } catch (pageError) {
          console.log("페이지 닫기 오류 (무시됨):", pageError.message);
        }

        // 짧은 딜레이 추가
        await new Promise((resolve) => setTimeout(resolve, 500));

        // 브라우저 종료
        await this.browser.close().catch((err) => {
          console.log("브라우저 종료 오류 (무시됨):", err.message);
        });

        this.browser = null;
        this.page = null;
        this.updateTaskStatus("completed", "브라우저 종료 완료", 100);
      } else if (this.browser) {
        // 이미 연결이 끊어졌지만 객체는 존재하는 경우
        this.browser = null;
        this.page = null;
        this.updateTaskStatus("completed", "브라우저 이미 종료됨", 100);
      }
    } catch (error) {
      console.error("브라우저 종료 중 오류 발생:", error);
      // 오류가 발생해도 브라우저 참조 정리
      this.browser = null;
      this.page = null;
      this.updateTaskStatus(
        "completed",
        `브라우저 강제 종료: ${error.message}`,
        100
      );
    }
  }

  async waitForTimeout(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async checkLoginStatus() {
    try {
      // 현재 URL 확인
      const currentUrl = this.page.url();
      this.updateTaskStatus(
        "processing",
        `로그인 상태 확인 중 (현재 URL: ${currentUrl})`,
        22
      );

      // URL에 login이 포함되어 있으면 로그인되지 않은 상태
      if (currentUrl.includes("login") || currentUrl.includes("nid.naver")) {
        this.updateTaskStatus(
          "processing",
          "로그인되지 않은 상태 (로그인 페이지)",
          23
        );
        return false;
      } else {
        this.updateTaskStatus(
          "processing",
          "로그인 상태 확인 완료, 로그인 성공",
          25
        );
        return true;
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
}

module.exports = BaseCrawler;
