require("dotenv").config();
const BandPosts = require("../src/services/crawler/band.posts");

async function testGetPosts() {
  console.log("게시물 목록 가져오기 테스트 시작");

  const bandNumber = "82443310"; // 테스트할 밴드 ID
  const posts = new BandPosts(bandNumber);

  const naverId = process.env.NAVER_ID;
  const naverPassword = process.env.NAVER_PASSWORD;

  if (!naverId || !naverPassword) {
    throw new Error("네이버 로그인 정보가 환경변수에 설정되지 않았습니다.");
  }

  await posts.initialize(naverId, naverPassword);

  const postList = await posts.getPosts(bandNumber);

  console.log(`총 ${postList.length}개의 게시물을 가져왔습니다.`);
  console.log("게시물 목록:", postList);

  await posts.close();
}

testGetPosts().catch(console.error);
