const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

/**
 * 네이버 로그인 후 쿠키 저장
 */
async function loginAndSaveCookies() {
  console.log("네이버 로그인 및 쿠키 저장 시작");

  let browser;
  try {
    // 브라우저 실행 (headless: false로 브라우저 표시)
    browser = await puppeteer.launch({
      headless: false,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--window-size=1280,720",
      ],
      defaultViewport: { width: 1280, height: 720 },
    });

    const page = await browser.newPage();

    // 밴드 홈페이지로 이동
    await page.goto("https://band.us/home", { waitUntil: "networkidle2" });
    console.log("밴드 홈페이지 로드 완료");

    // 네이버 로그인 버튼 찾기 및 클릭
    const naverLoginBtn = await page.$(".login_naver");
    if (!naverLoginBtn) {
      console.log("이미 로그인되어 있는 것 같습니다. 쿠키를 확인합니다.");

      // 밴드 페이지로 이동해서 로그인 상태 확인
      await page.goto("https://band.us", { waitUntil: "networkidle2" });

      const isLoggedIn = await page.evaluate(() => {
        // 로그인 상태에서만 보이는 요소 확인
        return (
          !!document.querySelector(".profileInner") ||
          !!document.querySelector(".uName") ||
          !!document.querySelector(".userArea")
        );
      });

      if (!isLoggedIn) {
        console.log("로그인 버튼을 찾을 수 없지만, 로그인되어 있지 않습니다.");
        console.log("브라우저에서 직접 로그인해주세요. 120초 기다립니다...");

        // 사용자가 수동으로 로그인할 수 있도록 120초 대기
        await new Promise((resolve) => setTimeout(resolve, 120000));

        // 다시 로그인 상태 확인
        const isLoggedInAfterWait = await page.evaluate(() => {
          return (
            !!document.querySelector(".profileInner") ||
            !!document.querySelector(".uName") ||
            !!document.querySelector(".userArea")
          );
        });

        if (!isLoggedInAfterWait) {
          throw new Error(
            "로그인에 실패했습니다. 수동으로 로그인을 완료해주세요."
          );
        }
      }
    } else {
      // 네이버 로그인 페이지로 이동
      await naverLoginBtn.click();
      await page.waitForNavigation({ waitUntil: "networkidle2" });
      console.log("네이버 로그인 페이지로 이동 완료");

      // 로그인 입력폼 기다리기
      await page.waitForSelector("#id", { timeout: 5000 });

      // 사용자에게 직접 로그인하도록 안내
      console.log("브라우저에서 직접 로그인해주세요. 120초 기다립니다...");

      // 사용자가 수동으로 로그인할 수 있도록 120초 대기
      await new Promise((resolve) => setTimeout(resolve, 120000));
    }

    // 로그인이 완료되었는지 확인 (밴드 홈으로 이동해서)
    await page.goto("https://band.us/home", { waitUntil: "networkidle2" });

    const isLoggedIn = await page.evaluate(() => {
      return (
        !!document.querySelector(".profileInner") ||
        !!document.querySelector(".uName") ||
        !!document.querySelector(".userArea")
      );
    });

    if (!isLoggedIn) {
      throw new Error(
        "로그인 상태를 확인할 수 없습니다. 로그인이 완료되었는지 확인해주세요."
      );
    }

    console.log("로그인 확인 완료. 쿠키를 저장합니다.");

    // 쿠키 추출
    const cookies = await page.cookies();

    // 쿠키 저장 디렉토리 생성
    const cookiesDir = path.join(__dirname, "../cookies");
    if (!fs.existsSync(cookiesDir)) {
      fs.mkdirSync(cookiesDir, { recursive: true });
    }

    // 쿠키 파일 저장
    fs.writeFileSync(
      path.join(cookiesDir, "band_cookies.json"),
      JSON.stringify(cookies, null, 2)
    );

    console.log(
      `쿠키가 성공적으로 저장되었습니다: ${path.join(
        cookiesDir,
        "band_cookies.json"
      )}`
    );

    // 밴드 ID 접근 테스트
    const testBandId = "82443310";
    await page.goto(`https://band.us/band/${testBandId}`, {
      waitUntil: "networkidle2",
    });

    const bandName = await page.evaluate(() => {
      const titleElement =
        document.querySelector(".bandName") ||
        document.querySelector("h1.name") ||
        document.querySelector("h1.title");
      return titleElement ? titleElement.textContent.trim() : null;
    });

    if (bandName) {
      console.log(`밴드 접근 테스트 성공. 밴드명: ${bandName}`);
    } else {
      console.log("밴드 접근 테스트: 밴드명을 찾을 수 없습니다.");
    }

    // 브라우저 종료
    await browser.close();
    console.log("로그인 및 쿠키 저장 완료");
  } catch (error) {
    console.error("오류 발생:", error.message);
    if (browser) await browser.close();
    process.exit(1);
  }
}

// 스크립트 실행
loginAndSaveCookies().catch(console.error);
