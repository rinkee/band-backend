// test/login.js - 네이버 로그인 테스트
require("dotenv").config();
const BandAuth = require("../src/services/crawler/band.auth");

async function testLogin() {
  console.log("네이버 로그인 테스트 시작");

  const naverId = process.env.NAVER_ID;
  const naverPw = process.env.NAVER_PASSWORD;

  if (!naverId || !naverPw) {
    console.error(
      "환경 변수에 NAVER_ID 또는 NAVER_PASSWORD가 설정되지 않았습니다."
    );
    process.exit(1);
  }

  console.log(`로그인 테스트: ${naverId}`);

  const auth = new BandAuth();
  auth.onStatusUpdate = (status, message, progress) => {
    console.log(`[${status}] ${progress}% - ${message}`);
  };

  try {
    const loginResult = await auth.initialize(naverId, naverPw);
    console.log("로그인 결과:", loginResult);

    if (loginResult) {
      console.log("로그인 성공! 쿠키가 저장되었습니다.");
    } else {
      console.log("로그인 실패.");
    }
  } catch (error) {
    console.error("로그인 테스트 중 오류 발생:", error);
  } finally {
    // 브라우저가 열린 상태로 유지 (사용자 확인용)
    console.log("브라우저를 열어둡니다. 종료하려면 Ctrl+C를 누르세요.");
    // 무한 대기
    await new Promise((resolve) => {
      // 5분 후에 자동 종료
      setTimeout(() => {
        console.log("5분이 지나서 자동 종료합니다.");
        process.exit(0);
      }, 5 * 60 * 1000);
    });
  }
}

testLogin().catch(console.error);
