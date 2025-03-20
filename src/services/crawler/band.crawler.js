// const BaseCrawler = require("./base.crawler");
// const logger = require("../../config/logger");
// const { createClient } = require("@supabase/supabase-js");
// const crypto = require("crypto");
// const cheerio = require("cheerio");

// const supabase = createClient(
//   process.env.SUPABASE_URL,
//   process.env.SUPABASE_ANON_KEY
// );

// // 한국어 날짜 형식 파싱 함수 추가
// function parseKoreanDate(dateString) {
//   // 형식 1: "3월 14일 오후 8:58"
//   let match = dateString.match(/(\d+)월 (\d+)일 (오전|오후) (\d+):(\d+)/);
//   if (match) {
//     const [_, month, day, ampm, hour, minute] = match;
//     const currentYear = new Date().getFullYear();
//     let adjustedHour = parseInt(hour);

//     if (ampm === "오후" && adjustedHour < 12) {
//       adjustedHour += 12;
//     } else if (ampm === "오전" && adjustedHour === 12) {
//       adjustedHour = 0;
//     }

//     return new Date(
//       currentYear,
//       parseInt(month) - 1,
//       parseInt(day),
//       adjustedHour,
//       parseInt(minute)
//     );
//   }

//   // 형식 2: "2025년 3월 14일 오후 3:55"
//   match = dateString.match(/(\d+)년 (\d+)월 (\d+)일 (오전|오후) (\d+):(\d+)/);
//   if (match) {
//     const [_, year, month, day, ampm, hour, minute] = match;
//     let adjustedHour = parseInt(hour);

//     if (ampm === "오후" && adjustedHour < 12) {
//       adjustedHour += 12;
//     } else if (ampm === "오전" && adjustedHour === 12) {
//       adjustedHour = 0;
//     }

//     return new Date(
//       parseInt(year),
//       parseInt(month) - 1,
//       parseInt(day),
//       adjustedHour,
//       parseInt(minute)
//     );
//   }

//   return null;
// }

// // 기존에 추가했던 safeParseDate 함수 수정
// function safeParseDate(dateString) {
//   if (!dateString) return new Date();

//   try {
//     // 한국어 날짜 형식 시도
//     const koreanDate = parseKoreanDate(dateString);
//     if (koreanDate) return koreanDate;

//     // "몇 시간 전", "어제" 등의 상대적 시간 처리
//     if (typeof dateString === "string") {
//       if (
//         dateString.includes("시간 전") ||
//         dateString.includes("분 전") ||
//         dateString.includes("초 전") ||
//         dateString === "방금 전"
//       ) {
//         return new Date();
//       }

//       if (dateString === "어제") {
//         const yesterday = new Date();
//         yesterday.setDate(yesterday.getDate() - 1);
//         return yesterday;
//       }
//     }

//     // 일반적인 날짜 변환 시도
//     const parsedDate = new Date(dateString);

//     // 유효한 날짜인지 확인
//     if (isNaN(parsedDate.getTime())) {
//       logger.warn(`유효하지 않은 날짜 형식: ${dateString}`);
//       return new Date();
//     }

//     return parsedDate;
//   } catch (e) {
//     logger.warn(`날짜 변환 오류 (${dateString}): ${e.message}`);
//     return new Date();
//   }
// }

// // 가격 추출 함수 추가
// function extractPriceFromContent(content) {
//   if (!content) return 0;

//   // 가격 패턴 (숫자+원) 찾기
//   const priceRegex = /(\d+,?\d*,?\d*)원/g;
//   const priceMatches = content.match(priceRegex);

//   if (!priceMatches || priceMatches.length === 0) {
//     return 0;
//   }

//   // 모든 가격을 숫자로 변환
//   const prices = priceMatches
//     .map((priceText) => {
//       // 쉼표 제거하고 '원' 제거
//       const numStr = priceText.replace(/,/g, "").replace("원", "");
//       return parseInt(numStr, 10);
//     })
//     .filter((price) => !isNaN(price) && price > 0);

//   // 가격이 없으면 0 반환
//   if (prices.length === 0) {
//     return 0;
//   }

//   // 가장 낮은 가격 반환
//   return Math.min(...prices);
// }

// // 문서 ID 단순화 함수 추가
// function generateSimpleId(prefix = "", length = 8) {
//   const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
//   let result = prefix ? `${prefix}_` : "";
//   for (let i = 0; i < length; i++) {
//     result += chars.charAt(Math.floor(Math.random() * chars.length));
//   }
//   return result;
// }

// // 주문 수량 추출 함수 추가
// function extractQuantityFromComment(content) {
//   if (!content) return 1;

//   // 숫자만 추출하는 정규식
//   const numbers = content.match(/\d+/g);
//   if (!numbers) return 1;

//   // 10 이하의 첫 번째 숫자를 찾음
//   const quantity = numbers.find((num) => parseInt(num) <= 10);
//   return quantity ? parseInt(quantity) : 1;
// }

// class BandCrawler extends BaseCrawler {
//   constructor(bandId, options = {}) {
//     super();
//     if (!bandId) {
//       throw new Error("밴드 ID는 필수 값입니다.");
//     }
//     this.bandId = bandId;
//     this.allPostUrls = [];
//     this.currentPostIndex = 0;
//     this.crawlStartTime = 0;

//     // 기본 옵션 설정
//     this.options = {
//       numPostsToLoad: 5,
//       ...options,
//     };
//   }

//   async savePostsToSupabase(posts) {
//     try {
//       this.updateTaskStatus("processing", "상품 정보 Supabase 저장 중", 85);

//       // 현재 밴드에 연결된 userId 찾기 (임시로 생성하거나 기존 유저 조회)
//       let userId = await this._getOrCreateUserIdForBand();

//       // 상품 데이터 준비
//       const products = posts.map((post) => ({
//         user_id: userId,
//         title: post.postTitle || "제목 없음",
//         description: post.postContent || "",
//         price: 0,
//         original_price: 0,
//         status: "판매중",
//         band_post_id: post.postId,
//         band_post_url: `https://band.us/band/${this.bandId}/post/${post.postId}`,
//         category: "기타",
//         tags: [],
//         order_summary: {
//           total_orders: 0,
//           pending_orders: 0,
//           confirmed_orders: 0,
//         },
//         created_at: new Date().toISOString(),
//         updated_at: new Date().toISOString(),
//       }));

//       // Supabase에 상품 저장
//       const { data, error } = await supabase.from("products").upsert(products, {
//         onConflict: "band_post_id",
//         ignoreDuplicates: false,
//       });

//       if (error) {
//         throw error;
//       }

//       this.updateTaskStatus(
//         "processing",
//         `${posts.length}개의 상품이 Supabase에 저장되었습니다.`,
//         90
//       );
//     } catch (error) {
//       this.updateTaskStatus(
//         "failed",
//         `Supabase에 상품 저장 중 오류 발생: ${error.message}`,
//         85
//       );
//       throw error;
//     }
//   }

//   async close() {
//     try {
//       if (this.browser) {
//         this.updateTaskStatus(
//           "processing",
//           "브라우저가 열린 상태로 유지됩니다. 수동으로 닫아주세요.",
//           95
//         );
//       }
//     } catch (error) {
//       this.updateTaskStatus(
//         "failed",
//         `브라우저 상태 확인 중 오류: ${error.message}`,
//         95
//       );
//       throw error;
//     }
//   }

//   async _accessBandPage(naverId, naverPassword) {
//     // 브라우저 초기화 확인
//     if (!this.browser || !this.page) {
//       logger.info("브라우저 초기화 중...");
//       await this.initialize(naverId, naverPassword);
//     }

//     logger.info(`밴드 페이지로 이동: https://band.us/band/${this.bandId}`);

//     // 밴드 페이지로 이동
//     await this.page.goto(`https://band.us/band/${this.bandId}`, {
//       waitUntil: "networkidle2",
//       timeout: 60000,
//     });

//     // 추가 대기 시간 부여
//     await new Promise((resolve) => setTimeout(resolve, 5000));

//     // 접근 권한 확인 로직
//     const hasBandAccess = await this.page.evaluate(() => {
//       // 더 다양한 요소를 확인하여 접근 가능 여부 판단
//       const bandName = document.querySelector(".bandName");
//       const errorMessage = document.querySelector(
//         ".errorMessage, .accessDenied"
//       );
//       const contentArea = document.querySelector(".contentArea, .bandContent");

//       // 오류 메시지가 있거나 콘텐츠 영역이 없다면 접근 불가
//       if (errorMessage) return false;

//       // 밴드 이름이나 콘텐츠 영역이 있으면 접근 가능
//       return !!(bandName || contentArea);
//     });

//     // 오류 발생 시 스크린샷 저장
//     if (!hasBandAccess) {
//       await this.page.screenshot({
//         path: `band-access-error-${Date.now()}.png`,
//       });
//       // 오류 처리 코드...
//     }

//     logger.info(`밴드 페이지 접근 성공: ${this.bandId}`);
//     return true;
//   }

//   async crawlPostDetail(naverId, naverPassword, maxPosts = 5) {
//     try {
//       this.crawlStartTime = Date.now();
//       logger.info("Band 게시물 상세 정보 크롤링 시작");

//       // options.numPostsToLoad 갱신
//       if (maxPosts) {
//         this.options.numPostsToLoad = maxPosts;
//       }

//       // 밴드 페이지 접속
//       await this._accessBandPage(naverId, naverPassword);

//       // 게시물 로드를 위한 스크롤링
//       const totalLoadedPosts = await this._scrollToLoadPosts(
//         this.options.numPostsToLoad
//       );

//       if (totalLoadedPosts === 0) {
//         logger.warn("로드된 게시물이 없어 크롤링을 중단합니다.");
//         return { success: false, error: "로드된 게시물이 없습니다." };
//       }

//       logger.info(
//         `총 ${totalLoadedPosts}개의 게시물이 로드되었습니다. URL 수집 시작...`
//       );

//       // URL 수집 방식 개선 - 다양한 선택자 시도
//       let postUrls = await this.page.evaluate(() => {
//         // 모든 가능한 선택자를 시도
//         const cardLinks = Array.from(
//           document.querySelectorAll('.cCard a[href*="/post/"]')
//         )
//           .map((a) => a.href)
//           .filter((href) => href.includes("/post/"));

//         // 대체 선택자 (카드 내부의 모든 링크에서 post를 포함하는 것)
//         if (cardLinks.length === 0) {
//           const allLinks = Array.from(document.querySelectorAll(".cCard a"))
//             .map((a) => a.href)
//             .filter((href) => href.includes("/post/"));

//           if (allLinks.length > 0) {
//             return allLinks;
//           }
//         }

//         // 데이터 속성을 통한 선택
//         if (cardLinks.length === 0) {
//           return Array.from(document.querySelectorAll(".cCard[data-post-id]"))
//             .map((card) => {
//               const postId = card.getAttribute("data-post-id");
//               const bandId = window.location.pathname.split("/")[2];
//               if (postId && bandId) {
//                 return `https://band.us/band/${bandId}/post/${postId}`;
//               }
//               return null;
//             })
//             .filter((url) => url !== null);
//         }

//         return cardLinks;
//       });

//       // URL 디버깅 로그
//       logger.info(`수집된 게시물 URL 수: ${postUrls.length}`);
//       if (postUrls.length > 0) {
//         logger.info(`첫 번째 URL: ${postUrls[0]}`);
//       } else {
//         logger.warn(
//           "URL이 수집되지 않았습니다. 대체 방법으로 첫 번째 게시물 클릭 시도"
//         );

//         // URL이 수집되지 않은 경우 첫 번째 게시물 클릭
//         try {
//           // 첫 번째 카드 요소 클릭
//           await this.page.click(".cCard");
//           logger.info("첫 번째 게시물 클릭 성공");

//           // 팝업 로드 대기
//           await this.page.waitForSelector(".postPopup", {
//             visible: true,
//             timeout: 10000,
//           });

//           // 현재 URL 가져오기
//           const currentUrl = await this.page.url();
//           logger.info(`현재 URL: ${currentUrl}`);

//           if (currentUrl.includes("/post/")) {
//             postUrls = [currentUrl];
//             logger.info("URL이 성공적으로 추출되었습니다: " + currentUrl);
//           } else {
//             // 직접 팝업에서 게시물 ID 추출 시도
//             const postId = await this.page.evaluate(() => {
//               const metaTag = document.querySelector('meta[property="og:url"]');
//               if (metaTag) {
//                 const url = metaTag.content;
//                 const match = url.match(/\/post\/(\d+)/);
//                 return match ? match[1] : null;
//               }
//               return null;
//             });

//             if (postId) {
//               const bandId =
//                 this.bandId ||
//                 (await this.page.evaluate(() => {
//                   return window.location.pathname.split("/")[2];
//                 }));

//               const constructedUrl = `https://band.us/band/${bandId}/post/${postId}`;
//               postUrls = [constructedUrl];
//               logger.info("게시물 ID에서 URL 구성 성공: " + constructedUrl);
//             } else {
//               logger.error("URL 추출 실패. 크롤링을 중단합니다.");
//               return { success: false, error: "게시물 URL 추출 실패" };
//             }
//           }
//         } catch (e) {
//           logger.error(`첫 번째 게시물 클릭 실패: ${e.message}`);
//           return { success: false, error: "게시물 접근 실패: " + e.message };
//         }
//       }

//       // 중복 URL 제거 및 유효한 URL만 필터링
//       postUrls = [...new Set(postUrls)].filter(
//         (url) => url && typeof url === "string" && url.includes("/post/")
//       );

//       logger.info(
//         `중복 제거 후 크롤링할 고유 게시물 URL 수: ${postUrls.length}`
//       );

//       const results = [];

//       // 각 URL에 대해 크롤링 시도
//       for (
//         let i = 0;
//         i < Math.min(postUrls.length, this.options.numPostsToLoad);
//         i++
//       ) {
//         const postUrl = postUrls[i];
//         logger.info(
//           `게시물 URL 처리 중 (${i + 1}/${Math.min(
//             postUrls.length,
//             this.options.numPostsToLoad
//           )}): ${postUrl}`
//         );

//         try {
//           // 직접 URL로 이동
//           await this.page.goto(postUrl, {
//             waitUntil: "networkidle2",
//             timeout: 60000,
//           });

//           // URL 유효성 확인
//           const currentUrl = await this.page.url();
//           if (!currentUrl.includes("/post/")) {
//             logger.warn(
//               `유효하지 않은 게시물 URL로 이동됨: ${currentUrl}, 원래 URL: ${postUrl}`
//             );
//             continue;
//           }

//           // 게시물 상세 정보 추출
//           const postDetail = await this._extractPostDetailFromPopup();

//           if (postDetail) {
//             results.push(postDetail);
//             logger.info(`게시물 데이터 추출 성공: ${postDetail.postId}`);
//           } else {
//             logger.warn(`게시물 데이터 추출 실패: ${postUrl}`);
//           }
//         } catch (e) {
//           logger.error(
//             `게시물 URL 처리 중 오류 발생: ${e.message}, URL: ${postUrl}`
//           );
//         }
//       }

//       logger.info(`총 ${results.length}개 게시물 크롤링 완료`);
//       return { success: true, data: results };
//     } catch (e) {
//       logger.error(`게시물 상세 정보 크롤링 중 오류 발생: ${e.message}`);
//       return { success: false, error: e.message };
//     }
//   }

//   async saveDetailPostsToSupabase(detailedPosts) {
//     try {
//       this.updateTaskStatus(
//         "processing",
//         "상품 상세 정보 및 주문 정보 Supabase 저장 중",
//         93
//       );

//       let totalCommentCount = 0;
//       let postsWithComments = 0;
//       let newOrdersCount = 0;
//       let updatedOrdersCount = 0;

//       // user_id 가져오기
//       const userId = await this._getOrCreateUserIdForBand();

//       // 전체 데이터 준비
//       const productsToInsert = [];
//       const postsToInsert = [];
//       const ordersToInsert = [];
//       const customersToInsert = [];

//       // 데이터 변환 (for문 사용)
//       for (const post of detailedPosts) {
//         if (!post.postId || post.postId === "undefined") {
//           post.postId = `unknown_${Date.now()}_${Math.random()
//             .toString(36)
//             .substring(2, 9)}`;
//           logger.warn(
//             `유효하지 않은 postId 감지, 대체 ID 사용: ${post.postId}`
//           );
//         }

//         const { comments, ...postData } = post;
//         const commentCount = comments?.length || 0;

//         // 가격 추출 - 게시물 내용에서 가격 추출
//         const extractedPrice = extractPriceFromContent(post.postContent || "");

//         if (commentCount > 0) {
//           postsWithComments++;
//           logger.info(
//             `상품 ID: ${post.postId} - 주문 ${commentCount}개 저장 준비 중`
//           );
//         }
//         totalCommentCount += commentCount;

//         // 상품 정보 준비
//         const productData = {
//           user_id: userId,
//           title: post.postTitle || "제목 없음",
//           description: post.postContent || "",
//           original_content: post.postContent || "",
//           price: extractedPrice,
//           original_price: extractedPrice,
//           status: "판매중",
//           band_post_id: parseInt(post.postId, 10) || 0,
//           band_id: parseInt(this.bandId, 10) || 0,
//           band_post_url: `https://band.us/band/${this.bandId}/post/${post.postId}`,
//           category: "기타",
//           tags: [],
//           comment_count: commentCount,
//           order_summary: {
//             total_orders: commentCount,
//             pending_orders: commentCount,
//             confirmed_orders: 0,
//           },
//           created_at: new Date().toISOString(),
//           updated_at: new Date().toISOString(),
//         };

//         // 상품 데이터 추가
//         productsToInsert.push(productData);

//         // 게시글 정보 준비
//         const postDataToInsert = {
//           user_id: userId,
//           band_id: parseInt(this.bandId, 10) || 0,
//           band_post_id: parseInt(post.postId, 10) || 0,
//           author_name: post.authorName || "",
//           title: post.postTitle || "제목 없음",
//           content: post.postContent || "",
//           posted_at: post.postTime ? safeParseDate(post.postTime) : new Date(),
//           comment_count: commentCount,
//           view_count: post.readCount || 0,
//           crawled_at: new Date(),
//           is_product: true,
//           band_post_url: `https://band.us/band/${this.bandId}/post/${post.postId}`,
//           media_urls: post.imageUrls || [],
//           status: "활성",
//           updated_at: new Date(),
//         };

//         // 게시글 데이터 추가
//         postsToInsert.push(postDataToInsert);

//         // 댓글을 주문으로 변환하여 준비
//         if (comments && comments.length > 0) {
//           for (let index = 0; index < comments.length; index++) {
//             const comment = comments[index];

//             // 시간 처리를 위한 안전한 날짜 변환
//             const orderTime = safeParseDate(comment.time);

//             // 댓글 식별자
//             const bandCommentId = `${post.postId}_comment_${index}`;

//             // 시간 정보를 기반으로 orderId 생성
//             const orderId = `${this.bandId}_${
//               post.postId
//             }_${orderTime.getTime()}`;
//             const customerName = comment.author || "익명";

//             // 수량 추출
//             const quantity = extractQuantityFromComment(comment.content);

//             // 주문 정보 준비
//             const orderData = {
//               user_id: userId,
//               product_id: post.postId,
//               customer_name: customerName,
//               customer_band_id: "",
//               customer_profile: "",
//               quantity: quantity,
//               price: extractedPrice,
//               total_amount: extractedPrice * quantity,
//               comment: comment.content || "",
//               status: "주문완료",
//               ordered_at: orderTime,
//               band_comment_id: bandCommentId,
//               band_id: this.bandId,
//               band_comment_url: `https://band.us/band/${this.bandId}/post/${post.postId}#comment`,
//               created_at: new Date().toISOString(),
//               updated_at: new Date().toISOString(),
//             };

//             // 주문 데이터 추가
//             ordersToInsert.push(orderData);
//             newOrdersCount++;

//             // 고객 정보 준비
//             const customerData = {
//               user_id: userId,
//               name: customerName,
//               band_user_id: "",
//               band_id: this.bandId,
//               total_orders: 1,
//               first_order_at: orderTime,
//               last_order_at: orderTime,
//               created_at: new Date().toISOString(),
//               updated_at: new Date().toISOString(),
//             };

//             // 고객 데이터 추가
//             customersToInsert.push(customerData);
//           }
//         }
//       }

//       if (detailedPosts.length === 0) {
//         logger.warn("Supabase에 저장할 상품이 없습니다.");
//         this.updateTaskStatus("processing", "저장할 상품이 없습니다.", 94);
//         return;
//       }

//       // 트랜잭션 시작
//       const { error: functionError } = await supabase.rpc("save_crawled_data", {
//         products_data: productsToInsert,
//         posts_data: postsToInsert,
//         orders_data: ordersToInsert,
//         customers_data: customersToInsert,
//       });

//       if (functionError) {
//         logger.error(`트랜잭션 오류: ${functionError.message}`);
//         this.updateTaskStatus(
//           "failed",
//           `데이터 저장 중 오류 발생: ${functionError.message}`,
//           93
//         );
//         throw functionError;
//       }

//       logger.info(
//         `총 ${detailedPosts.length}개의 상품 중 ${postsWithComments}개의 상품에 주문이 있음`
//       );
//       logger.info(
//         `Supabase 저장 완료: ${productsToInsert.length}개 상품, ${postsToInsert.length}개 게시글, ${ordersToInsert.length}개 주문, ${customersToInsert.length}개 고객 정보`
//       );

//       this.updateTaskStatus(
//         "processing",
//         `${detailedPosts.length}개 상품, ${newOrdersCount}개 주문이 저장되었습니다.`,
//         95
//       );
//     } catch (error) {
//       this.updateTaskStatus(
//         "failed",
//         `Supabase에 상품 상세 정보 저장 중 오류 발생: ${error.message}`,
//         93
//       );
//       logger.error(`Supabase 저장 오류: ${error.message}`);
//       throw error;
//     }
//   }

//   async _scrollToLoadPosts(count) {
//     logger.info(`${count}개의 게시물을 로드하기 위해 스크롤링 시작`);

//     let loadedPostsCount = 0;
//     let lastPostsCount = 0;
//     let scrollAttempts = 0;

//     // 직접 HTML 구조 검사 및 게시물 카드 디버깅
//     await this.page.evaluate(() => {
//       const firstCard = document.querySelector(".cCard");
//       console.log(
//         "첫 번째 카드 HTML:",
//         firstCard ? firstCard.outerHTML.substring(0, 500) : "없음"
//       );

//       // 모든 a 태그 링크 출력
//       if (firstCard) {
//         const links = firstCard.querySelectorAll("a");
//         console.log(`첫 번째 카드 내 링크 수: ${links.length}`);
//         links.forEach((link, i) => {
//           console.log(`링크 ${i + 1}: ${link.href}, 클래스: ${link.className}`);
//         });
//       }
//     });

//     while (loadedPostsCount < count && scrollAttempts < 20) {
//       // 현재 로드된 게시물 수 확인
//       loadedPostsCount = await this.page.evaluate(() => {
//         return document.querySelectorAll(".cCard").length;
//       });

//       logger.info(`현재 로드된 게시물 수: ${loadedPostsCount}/${count}`);

//       // 목표에 도달했으면 종료
//       if (loadedPostsCount >= count) {
//         break;
//       }

//       // 이전 로드 수와 같다면 스크롤 시도 횟수 증가
//       if (loadedPostsCount === lastPostsCount) {
//         scrollAttempts++;

//         // 여러 번 시도해도 로드되지 않으면 현재 게시물만 처리하고 진행
//         if (scrollAttempts >= 5 && loadedPostsCount > 0) {
//           logger.warn(
//             `${scrollAttempts}회 시도 후에도 더 많은 게시물이 로드되지 않아 진행합니다.`
//           );
//           break;
//         }
//       } else {
//         // 새로운 게시물이 로드되었으면 시도 횟수 초기화
//         scrollAttempts = 0;
//         lastPostsCount = loadedPostsCount;
//       }

//       // 페이지 맨 아래로 스크롤
//       await this.page.evaluate(() => {
//         window.scrollTo(0, document.body.scrollHeight);
//       });

//       // 새 게시물 로드 대기
//       await new Promise((r) => setTimeout(r, 2000));
//     }

//     // 브라우저 개발자 도구에서의 디버깅을 위한 코드 추가
//     // (이 코드는 실제 실행에는 영향을 주지 않지만 어떤 링크가 있는지 확인하는데 도움)
//     await this.page.evaluate(() => {
//       console.log("===== 게시물 URL 추출 디버깅 정보 =====");
//       // 모든 카드 요소 순회
//       const cards = document.querySelectorAll(".cCard");
//       console.log(`총 ${cards.length}개 카드 발견`);

//       cards.forEach((card, i) => {
//         console.log(`카드 ${i + 1} 정보:`);

//         // 데이터 속성 확인
//         const postId = card.getAttribute("data-post-id");
//         const href = card.getAttribute("data-href");
//         console.log(`- data-post-id: ${postId || "없음"}`);
//         console.log(`- data-href: ${href || "없음"}`);

//         // 카드 내 모든 링크 확인
//         const links = card.querySelectorAll("a");
//         console.log(`- 링크 수: ${links.length}`);
//         links.forEach((link, j) => {
//           console.log(
//             `  링크 ${j + 1}: ${link.href}, 텍스트: ${link.innerText.substring(
//               0,
//               20
//             )}`
//           );
//         });

//         // 클릭 이벤트 핸들러 확인
//         console.log(`- 클릭 가능: ${card.onclick ? "예" : "아니오"}`);
//       });
//     });

//     logger.info(`스크롤링 완료: ${loadedPostsCount}개 게시물 로드됨`);
//     return loadedPostsCount;
//   }

//   async _extractPostDetailFromPopup() {
//     try {
//       logger.info("게시물 상세 정보 추출 시작");

//       try {
//         await Promise.race([
//           this.page.waitForSelector(".postWrap", {
//             visible: true,
//             timeout: 15000,
//           }),
//           this.page.waitForSelector(".postMain", {
//             visible: true,
//             timeout: 15000,
//           }),
//           this.page.waitForSelector(".postText", {
//             visible: true,
//             timeout: 15000,
//           }),
//           this.page.waitForSelector(".dPostCommentMainView", {
//             visible: true,
//             timeout: 15000,
//           }),
//           ,
//         ]);
//       } catch (waitError) {
//         logger.warn(
//           `기본 셀렉터 대기 실패: ${waitError.message}, 대체 방법 시도`
//         );
//         // 더 긴 시간 동안 페이지 로드 완료 대기
//         await this.page.waitForTimeout(5000);
//       }

//       // 현재 URL 확인
//       const currentUrl = await this.page.url();
//       logger.info(`현재 URL: ${currentUrl}`);

//       // URL에서 postId와 bandId 추출
//       let postId = "unknown";
//       let bandId = this.bandId || "";

//       const postIdMatch = currentUrl.match(/\/post\/(\d+)/);
//       if (postIdMatch && postIdMatch[1]) {
//         postId = postIdMatch[1];
//       } else {
//         // URL에서 추출 실패 시 페이지 내에서 추출 시도
//         postId = await this.page.evaluate(() => {
//           const metaTag = document.querySelector('meta[property="og:url"]');
//           if (metaTag) {
//             const url = metaTag.content;
//             const match = url.match(/\/post\/(\d+)/);
//             return match
//               ? match[1]
//               : `unknown_${Date.now()}_${Math.random()
//                   .toString(36)
//                   .substring(2, 8)}`;
//           }
//           return `unknown_${Date.now()}_${Math.random()
//             .toString(36)
//             .substring(2, 8)}`;
//         });
//       }

//       const bandIdMatch = currentUrl.match(/\/band\/([^\/]+)/);
//       if (bandIdMatch && bandIdMatch[1]) {
//         bandId = bandIdMatch[1];
//       }

//       logger.info(`추출된 게시물 ID: ${postId}, 밴드 ID: ${bandId}`);

//       // Cheerio를 사용하여 HTML 파싱
//       const content = await this.page.content();
//       const $ = cheerio.load(content);

//       // 게시물 제목 추출
//       let postTitle = "";
//       if ($(".postWriterInfoWrap .text").length > 0) {
//         postTitle = $(".postWriterInfoWrap .text").text().trim();
//       }

//       // 게시물 내용 추출
//       let postContent = "";
//       if ($(".postText .txtBody").length > 0) {
//         postContent = $(".postText .txtBody").text().trim();
//       } else if ($(".txtBody").length > 0) {
//         postContent = $(".txtBody").text().trim();
//       }

//       // 게시물 시간 추출
//       let postTime = "";
//       if ($(".postListInfoWrap .time").length > 0) {
//         postTime = $(".postListInfoWrap .time").text().trim();
//       }

//       // 작성자 이름 추출
//       let authorName = "";
//       if ($(".postWriterInfoWrap .text").length > 0) {
//         authorName = $(".postWriterInfoWrap .text").text().trim();
//       }

//       // 조회수 추출 (현재 페이지에서는 읽은 사람 수로 대체)
//       let readCount = 0;
//       if ($("._postReaders strong").length > 0) {
//         const readCountText = $("._postReaders strong").text().trim();
//         const match = readCountText.match(/\d+/);
//         if (match) {
//           readCount = parseInt(match[0], 10);
//         }
//       }

//       // 이미지 URL 추출
//       const imageUrls = [];
//       $(".imageListInner img").each((i, el) => {
//         const src = $(el).attr("src");
//         if (src) {
//           imageUrls.push(src);
//         }
//       });

//       // 댓글 수 추출
//       let commentCount = 0;
//       let displayedCommentCount = 0;

//       // 댓글 수 추출 방법 1: 댓글 카운터에서 추출
//       if ($(".comment .count").length > 0) {
//         const commentCountText = $(".comment .count").text().trim();
//         commentCount = parseInt(commentCountText, 10);
//       } else if ($(".count.-commentCount").length > 0) {
//         const commentCountText = $(".count.-commentCount").text().trim();
//         commentCount = parseInt(commentCountText, 10);
//       }

//       // 댓글 수 추출 방법 2: 실제 댓글 요소 카운트
//       const commentElements = $(".commentItem, .cmt");
//       displayedCommentCount = commentElements.length;

//       logger.info(
//         `댓글 수: ${commentCount}, 실제 표시된 댓글 수: ${displayedCommentCount}`
//       );

//       // 모든 댓글 로드
//       let comments = [];
//       if (commentCount > 0) {
//         try {
//           await this._loadAllComments();

//           // 페이지 컨텐츠 다시 가져오기
//           const updatedContent = await this.page.content();
//           const $updated = cheerio.load(updatedContent);

//           // 웹 페이지의 실제 HTML 구조 확인을 위한 디버깅 코드
//           const commentSectionHtml = await this.page.evaluate(() => {
//             const section = document.querySelector(".dPostCommentMainView");
//             if (section) {
//               // 첫 번째 댓글 요소 텍스트 내용 확인
//               const firstComment = section.querySelector(".cComment");
//               const commentText = firstComment
//                 ? firstComment.textContent
//                 : "없음";
//               console.log("첫 번째 댓글 텍스트:", commentText);

//               // HTML 구조 로깅
//               return {
//                 html: section.innerHTML.substring(0, 500),
//                 commentCount: section.querySelectorAll(".cComment").length,
//               };
//             }
//             return { html: "댓글 섹션 없음", commentCount: 0 };
//           });

//           logger.info(
//             `댓글 섹션 HTML 구조: ${JSON.stringify(commentSectionHtml)}`
//           );

//           // 브라우저에서 직접 댓글 수집 (더 정확함)
//           comments = await this.page.evaluate(() => {
//             const commentElements = document.querySelectorAll(".cComment");
//             const extractedComments = [];

//             console.log(
//               `브라우저에서 발견된 댓글 수: ${commentElements.length}`
//             );

//             commentElements.forEach((comment, idx) => {
//               try {
//                 // 작성자 찾기 - 여러 가능한 선택자 시도 (개선된 선택자)
//                 let author = "";
//                 const authorElement =
//                   comment.querySelector(".writeInfo .name") || // 제공된 HTML 구조에 맞게 수정
//                   comment.querySelector(".writeInfo strong.name") || // 또는 strong 태그로 직접 선택
//                   comment.querySelector(".userName") ||
//                   comment.querySelector(".uName") ||
//                   comment.querySelector(".dAuthorInfo strong");

//                 if (authorElement) {
//                   author = authorElement.textContent.trim();
//                 }

//                 // 내용 찾기
//                 let content = "";
//                 const contentElement =
//                   comment.querySelector(".txt._commentContent") || // 제공된 HTML 구조에 맞게 수정
//                   comment.querySelector(".commentText") ||
//                   comment.querySelector(".txt") ||
//                   comment.querySelector("p.txt");

//                 if (contentElement) {
//                   content = contentElement.textContent.trim();
//                 }

//                 // 시간 찾기 - 제공된 HTML 구조에 맞게 수정
//                 let time = "";
//                 const timeElement =
//                   comment.querySelector(".func .time") || // 제공된 HTML 구조에 맞게 수정
//                   comment.querySelector(".date") ||
//                   comment.querySelector(".time");

//                 if (timeElement) {
//                   // title 속성에서 정확한 날짜 가져오기 (예: "2025년 3월 14일 오후 3:55")
//                   time =
//                     timeElement.getAttribute("title") ||
//                     timeElement.textContent.trim();
//                 }

//                 // 유효한 내용이 있을 때만 추가
//                 if (content) {
//                   extractedComments.push({
//                     author: author || "작성자 미상",
//                     content,
//                     time: time || new Date().toISOString(),
//                   });
//                 }
//               } catch (err) {
//                 console.error(`${idx}번째 댓글 추출 중 오류:`, err.message);
//               }
//             });

//             return extractedComments;
//           });

//           // 추출된 댓글 수 로깅
//           logger.info(
//             `총 댓글 수: ${commentCount}, 추출된 댓글 수: ${comments.length}`
//           );

//           if (comments.length < commentCount) {
//             logger.warn(
//               `표시된 댓글 수(${commentCount})와 추출된 댓글 수(${comments.length})가 일치하지 않습니다.`
//             );
//           }
//         } catch (e) {
//           logger.error(`댓글 로드 및 추출 중 오류 발생: ${e.message}`);
//         }
//       }

//       // 결과 객체 생성
//       const postDetail = {
//         postId,
//         bandId,
//         postTitle,
//         postContent,
//         postTime,
//         authorName,
//         readCount,
//         commentCount: Math.max(
//           commentCount,
//           displayedCommentCount,
//           comments.length
//         ),
//         imageUrls,
//         comments,
//         crawledAt: new Date().toISOString(),
//       };

//       logger.info(
//         `게시물 정보 추출 완료: ID=${postId}, 제목=${postTitle}, 작성자=${authorName}, 댓글 수=${postDetail.commentCount}`
//       );
//       return postDetail;
//     } catch (e) {
//       logger.error(`게시물 상세 정보 추출 중 오류 발생: ${e.message}`);
//       return null;
//     }
//   }

//   async _loadAllComments() {
//     try {
//       this.updateTaskStatus("processing", "모든 댓글 로드 중", 60);

//       // 댓글이 있는지 확인
//       const hasComments = await this.page.evaluate(() => {
//         const commentElement =
//           document.querySelector(".commentBox") ||
//           document.querySelector(".cmt_area") ||
//           document.querySelector("[class*='comment']");
//         return !!commentElement;
//       });

//       if (!hasComments) {
//         this.updateTaskStatus(
//           "processing",
//           "댓글이 없거나 댓글 영역을 찾을 수 없습니다",
//           65
//         );
//         return false;
//       }

//       // 댓글 더보기 버튼 클릭 (다양한 선택자 시도)
//       const commentSelectors = [
//         ".viewMoreComments",
//         ".cmtMore",
//         ".more_comment",
//         ".btn_cmt_more",
//         "a[class*='more']",
//         "button[class*='more']",
//         "a[class*='comment']",
//         "button[class*='comment']",
//         "[class*='comment'][class*='more']",
//       ];

//       let totalComments = 0;
//       let prevCommentCount = -1;
//       let attemptCount = 0;
//       const MAX_ATTEMPTS = 30; // 최대 시도 횟수
//       const MAX_NO_CHANGE_ATTEMPTS = 5; // 변화 없는 최대 시도 횟수
//       let noChangeCount = 0;

//       // 댓글이 더 이상 로드되지 않을 때까지 더보기 버튼 클릭
//       while (attemptCount < MAX_ATTEMPTS) {
//         try {
//           // 현재 댓글 수 확인
//           const currentCommentCount = await this.page.evaluate(() => {
//             const comments = document.querySelectorAll(
//               '.comment, .cmt_item, [class*="comment-item"]'
//             );
//             return comments.length;
//           });

//           this.updateTaskStatus(
//             "processing",
//             `현재 로드된 댓글 수: ${currentCommentCount}`,
//             65
//           );

//           // 댓글 수가 변하지 않으면 카운터 증가
//           if (currentCommentCount === prevCommentCount) {
//             noChangeCount++;
//             // 여러 번 시도해도 댓글 수가 변하지 않으면 더 이상 댓글이 없다고 판단
//             if (noChangeCount >= MAX_NO_CHANGE_ATTEMPTS) {
//               this.updateTaskStatus(
//                 "processing",
//                 "더 이상 댓글을 로드할 수 없습니다",
//                 75
//               );
//               break;
//             }
//           } else {
//             // 댓글 수가 변했다면 카운터 초기화
//             noChangeCount = 0;
//             prevCommentCount = currentCommentCount;
//           }

//           // 더보기 버튼 찾기 및 클릭 시도
//           let buttonClicked = false;

//           for (const selector of commentSelectors) {
//             try {
//               const isVisible = await this.page.evaluate((sel) => {
//                 const btn = document.querySelector(sel);
//                 if (!btn) return false;

//                 const rect = btn.getBoundingClientRect();
//                 return (
//                   rect.width > 0 &&
//                   rect.height > 0 &&
//                   window.getComputedStyle(btn).display !== "none" &&
//                   window.getComputedStyle(btn).visibility !== "hidden"
//                 );
//               }, selector);

//               if (isVisible) {
//                 // 버튼이 보이면 클릭
//                 await this.page.click(selector).catch(() => {});
//                 buttonClicked = true;

//                 // 클릭 후 데이터 로드 대기
//                 await this.page.waitForTimeout(1000);

//                 // 스크롤을 조금 내려 댓글 영역이 보이도록 함
//                 await this.page.evaluate(() => {
//                   const commentArea =
//                     document.querySelector(".commentBox") ||
//                     document.querySelector(".cmt_area") ||
//                     document.querySelector("[class*='comment']");
//                   if (commentArea) {
//                     commentArea.scrollIntoView({
//                       behavior: "smooth",
//                       block: "center",
//                     });
//                   }
//                 });

//                 // 네트워크 요청 완료 대기
//                 await this.page.waitForTimeout(500);
//                 break;
//               }
//             } catch (btnError) {
//               // 이 선택자에 대한 오류는 무시하고 다음 선택자 시도
//               continue;
//             }
//           }

//           // 더 이상 더보기 버튼이 없으면 완료
//           if (!buttonClicked) {
//             this.updateTaskStatus(
//               "processing",
//               "더 이상 더보기 버튼이 없습니다",
//               75
//             );
//             break;
//           }

//           attemptCount++;
//         } catch (loopError) {
//           this.updateTaskStatus(
//             "processing",
//             `댓글 로드 중 오류 발생: ${loopError.message}`,
//             70
//           );
//           attemptCount++;
//           // 오류가 발생해도 계속 시도
//           await this.page.waitForTimeout(1000);
//         }
//       }

//       // 최종 댓글 수 확인
//       totalComments = await this.page.evaluate(() => {
//         const comments = document.querySelectorAll(
//           '.comment, .cmt_item, [class*="comment-item"]'
//         );
//         return comments.length;
//       });

//       this.updateTaskStatus(
//         "processing",
//         `총 ${totalComments}개의 댓글을 로드했습니다`,
//         80
//       );
//       return true;
//     } catch (error) {
//       this.updateTaskStatus(
//         "processing",
//         `댓글 로드 중 오류 발생: ${error.message}`,
//         60
//       );
//       logger.error(`댓글 로드 오류: ${error.message}`);
//       // 오류가 발생해도 프로세스 계속 진행
//       return false;
//     }
//   }

//   async _getOrCreateUserIdForBand() {
//     try {
//       // 밴드 ID로 사용자 찾기
//       const { data: users, error } = await supabase
//         .from("users")
//         .select("id")
//         .eq("band_id", this.bandId)
//         .single();

//       if (error && error.code !== "PGRST116") {
//         // PGRST116는 결과가 없을 때
//         throw error;
//       }

//       if (users) {
//         return users.id;
//       }

//       // 사용자가 없으면 새로 생성
//       const { data: newUser, error: createError } = await supabase
//         .from("users")
//         .insert([
//           {
//             band_id: this.bandId,
//             login_id: `band_${this.bandId}`,
//             login_password: crypto.randomBytes(16).toString("hex"),
//             store_name: `밴드 ${this.bandId}`,
//             is_active: true,
//             role: "user",
//             created_at: new Date().toISOString(),
//             updated_at: new Date().toISOString(),
//           },
//         ])
//         .select("id")
//         .single();

//       if (createError) {
//         throw createError;
//       }

//       return newUser.id;
//     } catch (error) {
//       logger.error("사용자 생성/조회 오류:", error);
//       throw error;
//     }
//   }
// }

// module.exports = BandCrawler;
