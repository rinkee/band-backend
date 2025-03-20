// // src/services/crawler.service.js - 크롤링 서비스
// const puppeteer = require("puppeteer");
// const fs = require("fs").promises;
// const path = require("path");

// // 크롤링 작업 상태 추적
// const crawlingTasks = new Map();

// // 쿠키 저장 경로 설정
// const COOKIES_PATH = path.join(__dirname, "../../cookies");

// // 로그 파일 경로 설정
// const LOG_PATH = path.join(__dirname, "../../logs");
// const LOG_FILE = path.join(LOG_PATH, "crawler.log");

// // 기다리는 시간 랜덤
// const min = 2000; // 최소 2초 (2000ms)
// const max = 4000; // 최대 4초 (4000ms)
// const randomDelay = Math.floor(Math.random() * (max - min + 1)) + min;

// /**
//  * 로그를 파일에 저장하는 함수
//  * @param {string} message - 로그 메시지
//  */
// async function writeLog(message) {
//   try {
//     const timestamp = new Date().toISOString();
//     const logMessage = `[${timestamp}] ${message}\n`;

//     // 로그 디렉토리가 없으면 생성
//     await fs.mkdir(LOG_PATH, { recursive: true });

//     // 로그 파일에 추가
//     await fs.appendFile(LOG_FILE, logMessage);

//     // 콘솔에도 출력
//     console.log(message);
//   } catch (error) {
//     console.error("로그 저장 실패:", error);
//   }
// }

// /**
//  * 쿠키 저장 함수
//  * @param {string} userId - 사용자 ID
//  * @param {Array} cookies - 저장할 쿠키 배열
//  */
// async function saveCookies(userId, cookies) {
//   try {
//     // 쿠키 디렉토리가 없으면 생성
//     await fs.mkdir(COOKIES_PATH, { recursive: true });

//     // 네이버 및 밴드 관련 쿠키만 필터링
//     const relevantCookies = cookies.filter(
//       (cookie) =>
//         cookie.domain.includes("naver.com") || cookie.domain.includes("band.us")
//     );

//     const cookieFile = path.join(COOKIES_PATH, `${userId}.json`);
//     await fs.writeFile(
//       cookieFile,
//       JSON.stringify(
//         {
//           cookies: relevantCookies,
//           timestamp: Date.now(),
//         },
//         null,
//         2
//       )
//     );

//     console.log(
//       `쿠키가 저장되었습니다: ${cookieFile} (${relevantCookies.length}개)`
//     );
//   } catch (error) {
//     console.error("쿠키 저장 실패:", error);
//   }
// }

// /**
//  * 저장된 쿠키 로드 함수
//  * @param {string} userId - 사용자 ID
//  * @returns {Array|null} - 저장된 쿠키 배열 또는 null
//  */
// async function loadCookies(userId) {
//   try {
//     const cookieFile = path.join(COOKIES_PATH, `${userId}.json`);
//     const cookieData = await fs.readFile(cookieFile, "utf8");
//     const data = JSON.parse(cookieData);

//     // 쿠키 유효기간 확인 (24시간)
//     const cookieAge = Date.now() - data.timestamp;
//     if (cookieAge > 24 * 60 * 60 * 1000) {
//       console.log("저장된 쿠키가 만료되었습니다 (24시간 초과)");
//       return null;
//     }

//     console.log(`${data.cookies.length}개의 쿠키를 로드했습니다.`);
//     return data.cookies;
//   } catch (error) {
//     console.log("저장된 쿠키를 찾을 수 없습니다.");
//     return null;
//   }
// }

// /**
//  * 쿠키로 로그인 상태 확인
//  * @param {Page} page - Puppeteer 페이지 인스턴스
//  * @returns {Promise<boolean>} - 로그인 상태 여부
//  */
// async function checkLoginStatus(page, bandId) {
//   try {
//     // 네이버 메인 페이지로 이동
//     await this.page.goto("https://www.naver.com", {
//       waitUntil: "networkidle2",
//     });
//     await new Promise((resolve) => setTimeout(resolve, 2000));

//     // 로그인 상태 확인 (프로필 영역 존재 여부)
//     const isLoggedIn = await this.page.evaluate(() => {
//       // 로그인 버튼이 있으면 로그인되지 않은 상태
//       const loginBtn = document.querySelector(
//         ".MyView-module__login_text___G0Dzv"
//       );
//       if (loginBtn) {
//         console.log("로그인 버튼 발견: 로그인 필요");
//         return false;
//       }

//       // 프로필 이미지나 내 정보 링크가 있으면 로그인된 상태
//       const profileArea = document.querySelector(
//         ".MyView-module__nickname___fcxwI"
//       );
//       if (profileArea) {
//         console.log("프로필 영역 발견: 로그인됨");
//         return true;
//       }

//       return false;
//     });

//     if (isLoggedIn) {
//       console.log("네이버 로그인 상태 확인됨");

//       // 밴드 접근 권한 확인
//       await this.page.goto(`https://band.us/band/${bandId}`, {
//         waitUntil: "networkidle2",
//       });
//       await new Promise((resolve) => setTimeout(resolve, 2000));

//       // 밴드 접근 가능 여부 확인
//       const hasBandAccess = await page.evaluate(() => {
//         const bandName = document.querySelector(".bandName");
//         const result = bandName;
//         console.log("밴드 접근 상태:", result ? "접근 가능" : "접근 불가");
//         return result;
//       });

//       if (!hasBandAccess) {
//         console.log("밴드 접근 권한 없음, 재로그인 필요");
//         return false;
//       }

//       console.log("밴드 접근 권한 확인됨");
//       return true;
//     }

//     console.log("네이버 로그인 상태 확인 실패");
//     return false;
//   } catch (error) {
//     console.error("로그인 상태 확인 실패:", error);
//     return false;
//   }
// }
// /**
//  * 네이버 로그인 수행
//  * @param {Browser} browser - Puppeteer 브라우저 인스턴스
//  * @param {string} taskId - 작업 ID
//  * @param {string} naverId - 네이버 아이디
//  * @param {string} naverPassword - 네이버 비밀번호
//  * @returns {Promise<Page>} - 로그인된 페이지
//  */
// async function loginToNaver(browser, taskId, naverId, naverPassword) {
//   const page = await browser.newPage();
//   let isPageClosed = false;

//   try {
//     // 네이버 로그인 페이지로 이동
//     updateTaskStatus(taskId, "processing", "네이버 로그인 진행 중...", 10);
//     await page.goto("https://nid.naver.com/nidlogin.login", {
//       waitUntil: "networkidle2",
//     });

//     // 스크린샷 안전하게 찍기
//     await safeScreenshot(
//       page,
//       `login_page_${taskId}.png`,
//       taskId,
//       "로그인 페이지"
//     );

//     // 로그인 버튼 클릭
//     updateTaskStatus(taskId, "processing", "로그인 버튼 클릭 중...", 15);

//     // 직접 아이디/비밀번호 입력 (키보드 이벤트 시뮬레이션)
//     updateTaskStatus(taskId, "processing", "로그인 정보 입력 중...", 25);

//     // 로그인 페이지에서 ID/PW 입력
//     await page.waitForSelector("#id", { timeout: 30000 });
//     await page.evaluate((id) => {
//       document.querySelector("#id").value = id;
//       document
//         .querySelector("#id")
//         .dispatchEvent(new Event("input", { bubbles: true }));
//     }, naverId);

//     await new Promise((resolve) => setTimeout(resolve, randomDelay));
//     await page.waitForSelector("#pw");
//     await page.evaluate((pw) => {
//       document.querySelector("#pw").value = pw;
//       document
//         .querySelector("#pw")
//         .dispatchEvent(new Event("input", { bubbles: true }));
//     }, naverPassword);

//     // 입력 후 스크린샷 안전하게 찍기
//     await safeScreenshot(
//       page,
//       `login_input_${taskId}.png`,
//       taskId,
//       "로그인 입력 후"
//     );

//     // 로그인 버튼 클릭
//     updateTaskStatus(taskId, "processing", "로그인 양식 제출 중...", 30);
//     // 로그인 폼 제출
//     await page.keyboard.press("Enter");

//     // 로그인 버튼 클릭 후 지연
//     await new Promise((resolve) => setTimeout(resolve, randomDelay));

//     // 스크린샷 안전하게 찍기
//     await safeScreenshot(
//       page,
//       `login_submit_${taskId}.png`,
//       taskId,
//       "로그인 제출 후"
//     );

//     // 리캡챠 감지
//     const hasRecaptcha = await detectRecaptcha(page);

//     if (hasRecaptcha) {
//       // 리캡챠 발견, 수동 로그인 필요
//       updateTaskStatus(
//         taskId,
//         "processing",
//         "리캡챠 감지됨, 수동 로그인 필요",
//         35
//       );
//       console.log(
//         `[${taskId}] 리캡챠가 감지되었습니다. 브라우저에서 수동으로 로그인해주세요.`
//       );

//       // 브라우저가 이미 헤드리스 모드가 아닌 경우 사용자에게 로그인 지시
//       await safeScreenshot(
//         page,
//         `recaptcha_detected_${taskId}.png`,
//         taskId,
//         "리캡챠 감지"
//       );

//       // 로그인 완료될 때까지 대기
//       updateTaskStatus(
//         taskId,
//         "processing",
//         "사용자 수동 로그인 대기 중...",
//         40
//       );

//       // 네이버 로그인 성공 여부 확인 (30초마다 체크, 최대 5분 대기)
//       let isLoggedIn = false;
//       let checkCount = 0;
//       const maxChecks = 10; // 5분 (10회 * 30초)

//       while (!isLoggedIn && checkCount < maxChecks) {
//         await new Promise((resolve) => setTimeout(resolve, 30000)); // 30초 대기

//         // 로그인 상태 확인
//         try {
//           const currentUrl = page.url();
//           isLoggedIn = !currentUrl.includes("nidlogin.login");

//           if (isLoggedIn) {
//             updateTaskStatus(
//               taskId,
//               "processing",
//               "사용자 수동 로그인 성공",
//               45
//             );
//             console.log(`[${taskId}] 사용자 수동 로그인 성공 확인됨`);
//             break;
//           }
//         } catch (error) {
//           console.error(`[${taskId}] 로그인 상태 확인 오류:`, error.message);
//         }

//         checkCount++;
//         updateTaskStatus(
//           taskId,
//           "processing",
//           `사용자 수동 로그인 대기 중... (${checkCount}/${maxChecks})`,
//           40
//         );
//       }

//       if (!isLoggedIn) {
//         throw new Error("사용자 수동 로그인 시간 초과");
//       }
//     } else {
//       // 로그인 성공 여부 확인 대기
//       await new Promise((resolve) => setTimeout(resolve, 3000));

//       // 현재 페이지가 유효한지 확인
//       if (page.isClosed()) {
//         isPageClosed = true;
//         throw new Error("페이지가 미리 닫혔습니다.");
//       }

//       const currentUrl = page.url();

//       // 스크린샷 안전하게 찍기
//       await safeScreenshot(
//         page,
//         `login_result_${taskId}.png`,
//         taskId,
//         "로그인 결과"
//       );

//       // 로그인 결과 확인
//       const isLoginSuccess = !currentUrl.includes("nidlogin.login");

//       if (!isLoginSuccess) {
//         await safeScreenshot(
//           page,
//           `login_failed_${taskId}.png`,
//           taskId,
//           "로그인 실패"
//         );
//         throw new Error("로그인 실패");
//       }

//       updateTaskStatus(taskId, "processing", "로그인 성공, 쿠키 저장됨", 50);
//     }

//     // 쿠키 저장 및 반환
//     const cookies = await page.cookies();
//     await saveCookies(naverId, cookies);
//     console.log(
//       `[${taskId}] 네이버 로그인 쿠키:`,
//       cookies.map((c) => c.name).join(", ")
//     );

//     return page;
//   } catch (error) {
//     // 오류 발생 시 페이지가 아직 열려있는 경우에만 스크린샷 찍기
//     console.error(`[${taskId}] 로그인 오류:`, error.message);

//     if (!isPageClosed && page && !page.isClosed()) {
//       try {
//         await safeScreenshot(
//           page,
//           `login_error_${taskId}.png`,
//           taskId,
//           "로그인 오류"
//         );
//       } catch (screenshotError) {
//         console.error(
//           `[${taskId}] 오류 스크린샷 저장 실패:`,
//           screenshotError.message
//         );
//       }
//     }

//     throw new Error(`네이버 로그인 실패: ${error.message}`);
//   }
// }

// // 리캡챠 감지 함수
// async function detectRecaptcha(page) {
//   try {
//     // 리캡챠 iframe 또는 g-recaptcha 클래스 확인
//     const hasRecaptcha = await page.evaluate(() => {
//       return (
//         document.querySelector('iframe[src*="recaptcha"]') !== null ||
//         document.querySelector(".g-recaptcha") !== null ||
//         document.querySelector('iframe[src*="captcha"]') !== null ||
//         document.querySelector("#captcha") !== null ||
//         document.querySelector("#recaptcha") !== null
//       );
//     });

//     // 리캡챠 관련 텍스트 확인
//     const hasRecaptchaText = await page.evaluate(() => {
//       const pageText = document.body.innerText.toLowerCase();
//       return (
//         pageText.includes("captcha") ||
//         pageText.includes("로봇이 아닙니다") ||
//         pageText.includes("자동 가입 방지") ||
//         pageText.includes("보안 인증") ||
//         pageText.includes("보안문자")
//       );
//     });

//     return hasRecaptcha || hasRecaptchaText;
//   } catch (error) {
//     console.error("리캡챠 감지 오류:", error.message);
//     return false; // 오류 발생 시 리캡챠 없음으로 처리
//   }
// }

// // 안전하게 스크린샷을 찍는 유틸리티 함수
// async function safeScreenshot(page, filename, taskId, stage) {
//   try {
//     if (page && !page.isClosed()) {
//       await page.screenshot({ path: filename, fullPage: true });
//       console.log(`[${taskId}] ${stage} 스크린샷 저장됨: ${filename}`);
//     } else {
//       console.log(
//         `[${taskId}] ${stage} 스크린샷 저장 불가: 페이지가 닫혔습니다.`
//       );
//     }
//   } catch (error) {
//     console.error(`[${taskId}] ${stage} 스크린샷 저장 실패:`, error.message);
//   }
// }

// /**
//  * 게시물 및 댓글 크롤링
//  * @param {Page} page - Puppeteer 페이지 인스턴스
//  * @param {string} taskId - 작업 ID
//  * @param {string} bandId - 밴드 ID
//  * @returns {Promise<{posts: Array, comments: Array}>} - 수집된 게시물과 댓글
//  */
// async function crawlPostsAndComments(page, taskId, bandId) {
//   updateTaskStatus(taskId, "processing", "게시물 스크롤링 중...", 45);

//   try {
//     // 스크롤하며 게시물 로드
//     await autoScroll(page);

//     // 추가: Puppeteer 버전 호환성을 위해 표준 setTimeout 사용
//     await new Promise((resolve) => setTimeout(resolve, 3000));

//     updateTaskStatus(taskId, "processing", "게시물 데이터 추출 중...", 60);

//     // 게시물 데이터 추출
//     const posts = await page.evaluate(async (bandId) => {
//       const postItems = document.querySelectorAll(".cCard.gContentCardShadow");
//       console.log(`발견된 게시물 수: ${postItems.length}`);

//       const extractedPosts = [];

//       for (const [postIndex, post] of Array.from(postItems).entries()) {
//         try {
//           // 게시물 정보 추출
//           const postWriterInfoWrap = post.querySelector(".postWriterInfoWrap");
//           const aLink = postWriterInfoWrap
//             ? postWriterInfoWrap.querySelector("a")
//             : null;

//           // 링크 정보
//           const linkInfo = aLink
//             ? {
//                 href: aLink.getAttribute("href"),
//                 text: aLink.textContent.trim(),
//               }
//             : null;

//           // 게시물 ID 추출 및 검증
//           let postId = linkInfo?.href?.split("/post/")[1];
//           if (!postId) {
//             console.warn(`게시물 ID 추출 실패 (index: ${postIndex})`);
//             postId = `unknown_${Date.now()}_${postIndex}`;
//           }

//           // 필수 데이터 검증
//           const content =
//             post.querySelector(".postText")?.textContent.trim() || "";
//           const authorName =
//             post.querySelector(".postWriter .text")?.textContent.trim() ||
//             "Unknown";
//           const postTime =
//             post.querySelector(".time")?.textContent.trim() ||
//             new Date().toISOString();

//           // 게시물 데이터 구성
//           const postData = {
//             postId,
//             bandId,
//             content,
//             authorName,
//             postTime,
//             postUrl: linkInfo?.href || "",
//             commentCount: parseInt(
//               post.querySelector(".comment .count")?.textContent.trim() || "0",
//               10
//             ),
//             viewCount: parseInt(
//               post.querySelector(".read .count")?.textContent.trim() || "0",
//               10
//             ),
//             crawledAt: new Date().toISOString(),
//           };

//           // 데이터 유효성 검증
//           if (!postData.postId || !postData.bandId) {
//             console.warn(
//               `필수 데이터 누락: postId=${postData.postId}, bandId=${postData.bandId}`
//             );
//             continue;
//           }

//           extractedPosts.push(postData);
//           console.log(`게시물 데이터 추출 성공: ${postId}`);
//         } catch (error) {
//           console.error(`게시물 파싱 오류 (index: ${postIndex}):`, error);
//         }
//       }

//       return extractedPosts;
//     }, bandId);

//     updateTaskStatus(
//       taskId,
//       "processing",
//       `${posts.length}개 게시물 추출 완료, 댓글 수집 시작...`,
//       70
//     );

//     // 각 게시물 URL을 방문하여 댓글 수집
//     const allComments = [];
//     const totalPosts = posts.length;

//     for (let i = 0; i < posts.length; i++) {
//       const post = posts[i];
//       const progress = 70 + Math.floor((i / totalPosts) * 20); // 70%~90% 진행률

//       updateTaskStatus(
//         taskId,
//         "processing",
//         `게시물 ${i + 1}/${totalPosts}의 댓글 수집 중...`,
//         progress
//       );

//       try {
//         await writeLog(`[${taskId}] 게시물 URL 방문: ${post.postUrl}`);
//         await page.goto(post.postUrl, { waitUntil: "networkidle2" });

//         // 댓글 영역이 로드될 때까지 대기 (최대 5초)
//         try {
//           await page.waitForSelector(".sCommentList", { timeout: 5000 });
//         } catch (error) {
//           await writeLog(
//             `[${taskId}] 게시물 ${post.postId}에 댓글 영역이 없거나 로드되지 않음`
//           );
//           continue; // 다음 게시물로 진행
//         }

//         // 댓글 추출
//         const comments = await page.evaluate((postId) => {
//           const commentElements = document.querySelectorAll(".cComment");
//           console.log(`게시물 ${postId}의 댓글 수: ${commentElements.length}`);

//           return Array.from(commentElements).map((element, index) => {
//             // 작성자 정보
//             const nameElement = element.querySelector(".name");
//             const nicknameElement = element.querySelector(".nickname");
//             const imgElement = element.querySelector("img._image");
//             const timeElement = element.querySelector(".time");
//             const contentElement = element.querySelector(
//               "p.txt._commentContent"
//             );

//             // 값 추출 (요소가 없는 경우 대비)
//             const name = nameElement ? nameElement.textContent.trim() : "";
//             const nickname = nicknameElement
//               ? nicknameElement.textContent.trim()
//               : "";
//             const profileImage = imgElement ? imgElement.src : "";
//             const timestamp = timeElement
//               ? timeElement.getAttribute("title")
//               : "";
//             const content = contentElement
//               ? contentElement.textContent.trim()
//               : "";

//             return {
//               postId,
//               commentIndex: index + 1,
//               authorName: name,
//               authorNickname: nickname,
//               profileImage: profileImage,
//               content: content,
//               timestamp: timestamp,
//             };
//           });
//         }, post.postId);

//         await writeLog(
//           `[${taskId}] 게시물 ${post.postId}에서 ${comments.length}개 댓글 추출 완료`
//         );
//         allComments.push(...comments);
//       } catch (error) {
//         await writeLog(
//           `[${taskId}] 게시물 ${post.postId} 댓글 수집 오류: ${error.message}`
//         );
//       }
//     }

//     updateTaskStatus(
//       taskId,
//       "processing",
//       `${posts.length}개 게시물, ${allComments.length}개 댓글 추출 완료`,
//       90
//     );

//     return { posts, comments: allComments };
//   } catch (error) {
//     console.error(`[${taskId}] 크롤링 오류:`, error);
//     throw new Error("게시물 크롤링 실패: " + error.message);
//   }
// }

// /**
//  * 스크롤을 내려 더 많은 게시물 로드
//  * @param {Page} page - Puppeteer 페이지 인스턴스
//  */
// async function autoScroll(page) {
//   await page.evaluate(async () => {
//     await new Promise((resolve) => {
//       let totalHeight = 0;
//       const distance = 300;
//       const timer = setInterval(() => {
//         window.scrollBy(0, distance);
//         totalHeight += distance;

//         // 최대 10000px 스크롤 또는 페이지 끝에 도달하면 중지
//         if (
//           totalHeight >= 10000 ||
//           window.innerHeight + window.scrollY >= document.body.scrollHeight
//         ) {
//           clearInterval(timer);
//           resolve();
//         }
//       }, 200);
//     });
//   });

//   // Puppeteer 버전 호환성을 위해 표준 setTimeout 사용
//   await new Promise((resolve) => setTimeout(resolve, 2000));
// }

// /**
//  * 크롤링한 데이터를 데이터베이스에 저장
//  * @param {string} taskId - 작업 ID
//  * @param {Array} posts - 게시물 배열
//  * @param {Array} comments - 댓글 배열
//  */
// async function saveToDatabase(taskId, posts, comments) {
//   try {
//     await writeLog(
//       `[${taskId}] 저장할 게시물 수: ${posts.length}, 댓글 수: ${comments.length}`
//     );
//     await writeLog(
//       `[${taskId}] Post 모델 구조: ${JSON.stringify(
//         Object.keys(Post.rawAttributes)
//       )}`
//     );

//     // 1. 게시물 저장
//     const savedPosts = [];
//     const postIdMap = new Map(); // 네이버 postId -> DB id 매핑

//     for (const postData of posts) {
//       try {
//         await writeLog(`\n[${taskId}] ===== 게시물 저장 시도 =====`);
//         await writeLog(`postId: ${postData.postId}`);
//         await writeLog(`bandId: ${postData.bandId}`);
//         await writeLog(`전체 데이터: ${JSON.stringify(postData, null, 2)}`);

//         // 데이터 유효성 재검증
//         if (!postData.postId || !postData.bandId) {
//           await writeLog(
//             `[${taskId}] 필수 필드 누락: ${JSON.stringify(postData)}`
//           );
//           continue;
//         }

//         // upsert 작업 수행
//         const [post, created] = await Post.upsert(postData, {
//           where: {
//             bandId: postData.bandId,
//             postId: postData.postId,
//           },
//           returning: true,
//         });

//         // 네이버 postId와 DB id 매핑 저장
//         postIdMap.set(postData.postId, post.id);

//         if (created) {
//           await writeLog(
//             `[${taskId}] 새 게시물 생성 성공: postId=${postData.postId}, DB id=${post.id}`
//           );
//         } else {
//           await writeLog(
//             `[${taskId}] 기존 게시물 업데이트 성공: postId=${postData.postId}, DB id=${post.id}`
//           );
//         }

//         savedPosts.push(post);
//       } catch (error) {
//         await writeLog(
//           `[${taskId}] 게시물 처리 중 오류 발생: ${error.message}`
//         );
//         await writeLog(`[${taskId}] 스택 트레이스: ${error.stack}`);
//         if (error.errors) {
//           await writeLog(
//             `[${taskId}] 검증 오류: ${JSON.stringify(error.errors, null, 2)}`
//           );
//         }
//       }
//     }

//     await writeLog(`[${taskId}] 게시물 저장 완료: ${savedPosts.length}개`);

//     // 2. 댓글 저장
//     if (comments.length > 0) {
//       await writeLog(`[${taskId}] 댓글 저장 시작: ${comments.length}개`);
//       const savedComments = [];

//       for (const commentData of comments) {
//         try {
//           // 네이버 postId를 DB id로 변환
//           const dbPostId = postIdMap.get(commentData.postId);

//           if (!dbPostId) {
//             await writeLog(
//               `[${taskId}] 댓글 저장 실패: 게시물 ID ${commentData.postId}에 대한 DB ID를 찾을 수 없음`
//             );
//             continue;
//           }

//           // 기존 댓글 삭제 (게시물별로 한 번만 수행)
//           if (!postIdMap.has(`deleted_${commentData.postId}`)) {
//             await Comment.destroy({
//               where: { postId: dbPostId },
//             });
//             postIdMap.set(`deleted_${commentData.postId}`, true);
//             await writeLog(
//               `[${taskId}] 게시물 ID ${dbPostId}의 기존 댓글 삭제 완료`
//             );
//           }

//           // 댓글 저장
//           const savedComment = await Comment.create({
//             postId: dbPostId,
//             bandPostId: commentData.postId,
//             commentIndex: commentData.commentIndex,
//             authorName: commentData.authorName,
//             authorNickname: commentData.authorNickname,
//             profileImage: commentData.profileImage,
//             content: commentData.content,
//             timestamp: commentData.timestamp,
//           });

//           savedComments.push(savedComment);
//         } catch (error) {
//           await writeLog(
//             `[${taskId}] 댓글 처리 중 오류 발생: ${error.message}`
//           );
//           if (error.errors) {
//             await writeLog(
//               `[${taskId}] 댓글 검증 오류: ${JSON.stringify(
//                 error.errors,
//                 null,
//                 2
//               )}`
//             );
//           }
//         }
//       }

//       await writeLog(`[${taskId}] 댓글 저장 완료: ${savedComments.length}개`);
//       return { posts: savedPosts, comments: savedComments };
//     }

//     return { posts: savedPosts, comments: [] };
//   } catch (error) {
//     await writeLog(
//       `[${taskId}] 데이터베이스 저장 중 치명적 오류: ${error.message}`
//     );
//     await writeLog(`[${taskId}] 스택 트레이스: ${error.stack}`);
//     if (error.errors) {
//       await writeLog(
//         `[${taskId}] 검증 오류: ${JSON.stringify(error.errors, null, 2)}`
//       );
//     }
//     throw error;
//   }
// }

// /**
//  * 작업 상태 업데이트 유틸리티 함수
//  * @param {string} taskId - 작업 ID
//  * @param {string} status - 상태 (processing, completed, failed)
//  * @param {string} message - 상태 메시지
//  * @param {number} progress - 진행률 (0-100)
//  * @param {Object} data - 추가 데이터
//  */
// function updateTaskStatus(taskId, status, message, progress, data = {}) {
//   if (!crawlingTasks.has(taskId)) return;

//   const task = crawlingTasks.get(taskId);

//   crawlingTasks.set(taskId, {
//     ...task,
//     status,
//     message,
//     progress,
//     updatedAt: new Date(),
//     ...data,
//   });

//   console.log(`[${taskId}] ${status}: ${message} (${progress}%)`);
// }

// /**
//  * 작업 상태 조회
//  * @param {string} taskId - 작업 ID
//  * @returns {Object|null} - 작업 상태 또는 없을 경우 null
//  */
// const getTaskStatus = (taskId) => {
//   return crawlingTasks.get(taskId) || null;
// };

// /**
//  * 게시물 댓글 크롤링 함수
//  * @param {string} naverId - 네이버 아이디
//  * @param {string} naverPassword - 네이버 비밀번호
//  * @param {string} bandId - 밴드 ID
//  * @param {string} postId - 게시물 ID
//  * @returns {Promise<Object>} - 크롤링 결과
//  */
// const crawlPostComments = async (naverId, naverPassword, bandId, postId) => {
//   const taskId = `comment_task_${Date.now()}`;

//   crawlingTasks.set(taskId, {
//     status: "processing",
//     message: "댓글 크롤링 작업 시작...",
//     progress: 0,
//     bandId,
//     postId,
//     createdAt: new Date(),
//   });

//   updateTaskStatus(
//     taskId,
//     "processing",
//     `댓글 크롤링 시작: bandId=${bandId}, postId=${postId}`,
//     0
//   );

//   // 데이터베이스에서 게시물 확인
//   const dbPost = await Post.findOne({
//     where: {
//       postId: postId,
//       bandId: bandId,
//     },
//   });

//   if (!dbPost) {
//     updateTaskStatus(
//       taskId,
//       "failed",
//       `댓글 크롤링 실패: ID가 ${postId}인 게시물이 데이터베이스에 존재하지 않습니다.`,
//       0
//     );
//     return {
//       success: false,
//       message: `댓글 크롤링 실패: ID가 ${postId}인 게시물이 데이터베이스에 존재하지 않습니다.`,
//       taskId,
//     };
//   }

//   // 실제 데이터베이스 ID 저장
//   const dbPostId = dbPost.id;
//   await writeLog(
//     `[${taskId}] 게시물 찾음: postId=${postId}, 데이터베이스 ID=${dbPostId}`
//   );

//   const browser = await puppeteer.launch({
//     headless: false,
//     args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
//     defaultViewport: null,
//   });

//   let page = null;
//   let isPageClosed = false;

//   try {
//     updateTaskStatus(taskId, "processing", "브라우저 시작됨", 5);
//     page = await browser.newPage();
//     let isLoggedIn = false;

//     // 저장된 쿠키 로드 시도
//     const savedCookies = await loadCookies(naverId);
//     if (savedCookies) {
//       await page.setCookie(...savedCookies);
//       console.log("저장된 쿠키를 로드했습니다.");

//       // 쿠키로 로그인 상태 확인
//       isLoggedIn = await checkLoginStatus(page, bandId);
//       if (isLoggedIn) {
//         console.log("저장된 쿠키로 로그인 성공");
//         updateTaskStatus(taskId, "processing", "저장된 쿠키로 로그인됨", 30);
//       } else {
//         console.log("저장된 쿠키가 만료되었습니다. 다시 로그인합니다.");
//       }
//     }

//     // 로그인되지 않은 경우에만 로그인 진행
//     if (!isLoggedIn) {
//       await loginToNaver(browser, taskId, naverId, naverPassword);
//     }

//     // 밴드 게시물로 이동
//     updateTaskStatus(taskId, "processing", "밴드 게시물 페이지로 이동 중", 50);
//     const postUrl = `https://band.us/band/${bandId}/post/${postId}`;
//     await page.goto(postUrl, { waitUntil: "networkidle2" });

//     // 댓글 영역이 로드될 때까지 대기
//     updateTaskStatus(taskId, "processing", "댓글 영역 로딩 대기 중", 60);
//     try {
//       await page.waitForSelector(".sCommentList", { timeout: 10000 });
//     } catch (error) {
//       updateTaskStatus(
//         taskId,
//         "processing",
//         "댓글 영역을 찾을 수 없음 - 페이지 구조 확인 중",
//         65
//       );
//       // 페이지 콘텐츠 로깅
//       const pageContent = await page.content();
//       console.log(
//         `[${taskId}] 페이지 콘텐츠 확인: ${pageContent.substring(0, 300)}...`
//       );

//       throw new Error(
//         "댓글 영역을 찾을 수 없습니다. 페이지 구조가 변경되었거나 접근 권한이 없을 수 있습니다."
//       );
//     }

//     // 댓글 추출
//     updateTaskStatus(taskId, "processing", "댓글 데이터 추출 중", 70);
//     const comments = await page.evaluate(() => {
//       const commentElements = document.querySelectorAll(".cComment");
//       console.log("발견된 댓글 요소:", commentElements.length);

//       return Array.from(commentElements).map((element, index) => {
//         // 작성자 정보
//         const nameElement = element.querySelector(".name");
//         const nicknameElement = element.querySelector(".nickname");
//         const imgElement = element.querySelector("img._image");
//         const timeElement = element.querySelector(".time");
//         const contentElement = element.querySelector("p.txt._commentContent");

//         // 값 추출 (요소가 없는 경우 대비)
//         const name = nameElement ? nameElement.textContent.trim() : "";
//         const nickname = nicknameElement
//           ? nicknameElement.textContent.trim()
//           : "";
//         const profileImage = imgElement ? imgElement.src : "";
//         const timestamp = timeElement ? timeElement.getAttribute("title") : "";
//         const content = contentElement ? contentElement.textContent.trim() : "";

//         return {
//           commentIndex: index + 1,
//           authorName: name,
//           authorNickname: nickname,
//           profileImage: profileImage,
//           content: content,
//           timestamp: timestamp,
//           createdAt: new Date(),
//         };
//       });
//     });

//     updateTaskStatus(
//       taskId,
//       "processing",
//       `댓글 ${comments.length}개 추출 완료`,
//       80,
//       {
//         extractedComments: comments.length,
//       }
//     );

//     // 데이터베이스에서 기존 댓글 삭제 (새로 크롤링하기 때문)
//     updateTaskStatus(taskId, "processing", "기존 댓글 삭제 중", 85);
//     await Comment.destroy({
//       where: { postId: dbPostId },
//     });

//     // 댓글 데이터베이스 저장
//     updateTaskStatus(taskId, "processing", "댓글 데이터베이스 저장 중", 90);
//     const savedComments = [];

//     for (const comment of comments) {
//       const savedComment = await Comment.create({
//         postId: dbPostId,
//         bandPostId: postId,
//         commentIndex: comment.commentIndex,
//         authorName: comment.authorName,
//         authorNickname: comment.authorNickname,
//         profileImage: comment.profileImage,
//         content: comment.content,
//         timestamp: comment.timestamp,
//       });

//       savedComments.push(savedComment);
//     }

//     updateTaskStatus(taskId, "processing", "브라우저 종료 중", 95);
//     await browser.close();

//     updateTaskStatus(
//       taskId,
//       "completed",
//       `댓글 ${savedComments.length}개를 크롤링하여 저장 완료`,
//       100,
//       {
//         savedComments: savedComments.length,
//         completedAt: new Date(),
//       }
//     );

//     return {
//       success: true,
//       message: `댓글 ${savedComments.length}개를 크롤링하여 저장했습니다.`,
//       data: {
//         comments: savedComments,
//         taskId,
//       },
//     };
//   } catch (error) {
//     console.error(`[${taskId}] 댓글 크롤링 오류:`, error.message);

//     // 페이지가 열려있는 경우에만 스크린샷 찍기
//     if (!isPageClosed && page && !page.isClosed()) {
//       try {
//         await safeScreenshot(
//           page,
//           `comment_crawl_error_${taskId}.png`,
//           taskId,
//           "댓글 크롤링 오류"
//         );
//       } catch (screenshotError) {
//         console.error(
//           `[${taskId}] 오류 스크린샷 저장 실패:`,
//           screenshotError.message
//         );
//       }
//     }

//     updateTaskStatus(taskId, "failed", `댓글 크롤링 실패: ${error.message}`, 0);

//     // 브라우저 종료
//     if (browser) {
//       try {
//         await browser.close();
//       } catch (closeError) {
//         console.error(`[${taskId}] 브라우저 종료 오류:`, closeError.message);
//       }
//     }

//     return {
//       success: false,
//       message: `댓글 크롤링 실패: ${error.message}`,
//       taskId,
//     };
//   }
// };

// /**
//  * 밴드 크롤링 시작 함수
//  * @param {string} naverId - 네이버 아이디
//  * @param {string} naverPassword - 네이버 비밀번호
//  * @param {string} bandId - 밴드 ID
//  * @returns {Promise<string>} - 태스크 ID
//  */
// const startCrawling = async (naverId, naverPassword, bandId) => {
//   // 고유 태스크 ID 생성
//   const taskId = `task_${Date.now()}`;

//   // 작업 상태 초기화
//   crawlingTasks.set(taskId, {
//     status: "pending",
//     message: "크롤링 작업 준비 중...",
//     progress: 0,
//     bandId,
//     createdAt: new Date(),
//   });

//   // 비동기로 크롤링 작업 시작
//   setTimeout(async () => {
//     try {
//       // 브라우저 실행
//       const browser = await puppeteer.launch({
//         headless: "new",
//         args: [
//           "--no-sandbox",
//           "--disable-setuid-sandbox",
//           "--disable-dev-shm-usage",
//           "--disable-accelerated-2d-canvas",
//           "--disable-gpu",
//           "--window-size=1280,800",
//         ],
//       });

//       const page = await browser.newPage();
//       await page.setViewport({ width: 1280, height: 800 });

//       updateTaskStatus(taskId, "processing", "네이버 로그인 중...", 10);

//       // 네이버 로그인
//       await loginToNaver(browser, taskId, naverId, naverPassword);

//       updateTaskStatus(taskId, "processing", "게시물 크롤링 중...", 30);

//       // 밴드로 이동해서 게시물과 댓글 크롤링
//       await crawlPostsAndComments(page, taskId, bandId);

//       // 작업 완료 상태 업데이트
//       updateTaskStatus(taskId, "completed", "크롤링 작업 완료", 100);

//       // 브라우저 종료
//       await browser.close();
//     } catch (error) {
//       console.error("크롤링 작업 실패:", error);
//       updateTaskStatus(
//         taskId,
//         "failed",
//         `크롤링 중 오류 발생: ${error.message}`,
//         0
//       );
//     }
//   }, 0);

//   return taskId;
// };

// module.exports = {
//   startCrawling,
//   getTaskStatus,
//   crawlPostComments,
// };
