const BaseCrawler = require("./base.crawler");
const logger = require("../../config/logger");
const { getFirebaseDb } = require("../firebase.service");

class BandCrawler extends BaseCrawler {
  constructor(bandId) {
    super();
    if (!bandId) {
      throw new Error("밴드 ID는 필수 값입니다.");
    }
    this.bandId = bandId;
  }

  async savePostsToFirebase(posts) {
    try {
      this.updateTaskStatus("processing", "게시물 Firebase 저장 중", 85);
      const db = getFirebaseDb();
      const batch = db.batch();
      const postsRef = db.collection("posts");

      for (const post of posts) {
        const docRef = postsRef.doc(post.postId);
        batch.set(
          docRef,
          {
            ...post,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { merge: true }
        );
      }

      await batch.commit();
      this.updateTaskStatus(
        "processing",
        `${posts.length}개의 게시물이 Firebase에 저장되었습니다.`,
        90
      );
    } catch (error) {
      this.updateTaskStatus(
        "failed",
        `Firebase에 게시물 저장 중 오류 발생: ${error.message}`,
        85
      );
      throw error;
    }
  }

  async crawlPosts(naverId, naverPassword, maxPosts = 30) {
    try {
      // this.bandId 확인 - 생성자에서 설정된 값 사용
      if (!this.bandId) {
        this.updateTaskStatus("failed", "밴드 ID가 설정되지 않았습니다", 0);
        throw new Error("밴드 ID가 설정되지 않았습니다");
      }

      this.updateTaskStatus(
        "processing",
        `밴드 ID: ${this.bandId} 크롤링 시작`,
        0
      );

      // 브라우저 초기화 및 로그인 상태 확인
      if (!this.browser) {
        this.updateTaskStatus(
          "processing",
          "브라우저 초기화 및 로그인 상태 확인 중...",
          5
        );
        const initResult = await this.initialize(naverId);

        // 초기화 실패하면 로그인 시도
        if (!initResult) {
          this.updateTaskStatus(
            "processing",
            "저장된 쿠키로 로그인 실패 !!!!!",
            25
          );
          this.updateTaskStatus("processing", "네이버 로그인 시도 중...", 30);
          // 밴드 ID를 전달하지 않음 (네이버 로그인만 처리)
          const loginResult = await this.login(naverId, naverPassword);

          // 로그인도 실패하면 크롤링 중단
          if (!loginResult) {
            this.updateTaskStatus(
              "failed",
              "로그인 실패: 크롤링을 중단합니다",
              30
            );
            throw new Error("로그인 실패: 크롤링을 진행할 수 없습니다");
          }

          this.updateTaskStatus(
            "processing",
            "네이버 로그인 성공: 크롤링을 계속 진행합니다",
            35
          );
        } else {
          this.updateTaskStatus(
            "processing",
            "저장된 쿠키로 로그인 성공: 크롤링을 계속 진행합니다",
            35
          );
        }
      }

      // 밴드 페이지로 이동
      this.updateTaskStatus(
        "processing",
        `밴드 페이지로 이동: https://band.us/band/${this.bandId}`,
        40
      );
      await this.page.goto(`https://band.us/band/${this.bandId}`, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      // 밴드 접근 가능 여부 확인
      const hasBandAccess = await this.page.evaluate(() => {
        const bandName = document.querySelector(".bandName");
        return !!bandName;
      });

      if (!hasBandAccess) {
        this.updateTaskStatus(
          "failed",
          "밴드 접근 권한이 없습니다. 밴드 접근 실패.",
          40
        );
        throw new Error("밴드 접근 권한이 없습니다.");
      }

      this.updateTaskStatus(
        "processing",
        "밴드 접근 성공: 게시물 크롤링을 시작합니다",
        45
      );

      // 로그인 상태 확인 (게시물 카드가 표시되는지 확인)
      try {
        await this.page.waitForSelector(".cCard.gContentCardShadow", {
          timeout: 10000,
        });
        this.updateTaskStatus(
          "processing",
          "밴드 페이지 성공적으로 로드됨 (게시물 카드 확인)",
          47
        );
      } catch (error) {
        this.updateTaskStatus(
          "processing",
          "밴드 페이지 로드 실패: 게시물 카드를 찾을 수 없음",
          47
        );

        // 현재 페이지 URL 확인
        const currentUrl = await this.page.url();
        this.updateTaskStatus(
          "processing",
          `현재 페이지 URL: ${currentUrl}`,
          48
        );

        // 로그인 페이지로 리다이렉트된 경우 다시 로그인 시도
        if (currentUrl.includes("login")) {
          this.updateTaskStatus(
            "processing",
            "로그인 페이지로 리다이렉트됨 - 로그인 재시도",
            49
          );
          const loginResult = await this.login(naverId, naverPassword);
          if (!loginResult) {
            this.updateTaskStatus(
              "failed",
              "로그인 재시도 실패: 크롤링을 진행할 수 없습니다",
              49
            );
            throw new Error("로그인 재시도 실패: 크롤링을 진행할 수 없습니다");
          }

          // 로그인 후 다시 밴드 페이지로 이동
          await this.page.goto(`https://band.us/band/${this.bandId}`, {
            waitUntil: "networkidle2",
            timeout: 30000,
          });

          // 다시 게시물 카드 확인
          await this.page.waitForSelector(".cCard.gContentCardShadow", {
            timeout: 10000,
          });
        } else {
          this.updateTaskStatus(
            "failed",
            "밴드 페이지 접근 실패: 게시물을 찾을 수 없습니다",
            49
          );
          throw new Error("밴드 페이지 접근 실패: 게시물을 찾을 수 없습니다");
        }
      }

      // 스크롤하며 게시물 로드 - 이제 발견된 게시물 ID 목록을 반환
      this.updateTaskStatus("processing", "게시물 스크롤링 시작", 50);
      const discoveredPostIds = await this.autoScroll(this.page, maxPosts);
      this.updateTaskStatus(
        "processing",
        `총 ${discoveredPostIds.length}개의 고유 게시물 ID 발견됨`,
        70
      );

      // 게시물 데이터 추출
      this.updateTaskStatus("processing", "게시물 데이터 추출 중", 75);
      const posts = await this.page.evaluate((bandId) => {
        const postItems = document.querySelectorAll(
          ".cCard.gContentCardShadow"
        );
        console.log(`화면에 표시된 게시물 요소 수: ${postItems.length}`);

        // 실제 콘텐츠가 있는 게시물만 필터링
        const validPosts = Array.from(postItems).filter((post) => {
          // 스타일로 숨겨진 게시물인지 확인 (display: none)
          const style = window.getComputedStyle(post);
          if (style.display === "none") return false;

          // 내용이 비어있는지 확인
          const hasContent =
            post.querySelector(".postText, .contentText") !== null;
          const hasAuthor = post.querySelector(".postWriter") !== null;
          const hasLink = post.querySelector('a[href*="/post/"]') !== null;

          return hasContent && hasAuthor && hasLink;
        });

        console.log(
          `유효한 게시물 수: ${validPosts.length}/${postItems.length}`
        );

        return validPosts
          .map((post, postIndex) => {
            try {
              // 디버깅을 위한 HTML 출력
              console.log(`게시물 ${postIndex}의 HTML:`, post.outerHTML);

              // 선택자 디버깅
              const selectors = {
                postWriterInfoWrap: ".postWriterInfoWrap",
                authorName: ".postWriter .userName",
                content: ".postText, .contentText",
                time: ".time, .createTime",
                commentCount: ".commentCount, .comment .count",
                viewCount: ".readCount, .read .count",
              };

              // 각 선택자의 존재 여부 확인
              Object.entries(selectors).forEach(([key, selector]) => {
                const element = post.querySelector(selector);
                console.log(`게시물 ${postIndex}의 ${key} 선택자 존재 여부:`, {
                  selector,
                  exists: !!element,
                  text: element?.textContent?.trim(),
                });
              });

              // 게시물 정보 추출
              const postWriterInfoWrap = post.querySelector(
                ".postWriterInfoWrap"
              );
              if (!postWriterInfoWrap) {
                console.warn(
                  `게시물 ${postIndex}의 작성자 정보 영역을 찾을 수 없습니다.`
                );
              }

              const aLink =
                postWriterInfoWrap?.querySelector("a[href*='/post/']");
              if (!aLink) {
                console.warn(`게시물 ${postIndex}의 링크를 찾을 수 없습니다.`);
              }

              // 링크에서 postId 추출 (수정된 부분)
              const href = aLink?.getAttribute("href") || "";
              const postId = href.split("/post/")[1];

              if (!postId) {
                console.warn(
                  `게시물 ID 추출 실패 (index: ${postIndex}, href: ${href})`
                );
              }

              // 작성자 이름 추출 (수정된 부분)
              const authorNameElement = post.querySelector(
                ".postWriter .userName"
              );
              const authorName = authorNameElement?.textContent?.trim();
              if (!authorName) {
                console.warn(
                  `작성자 이름을 찾을 수 없습니다. (index: ${postIndex})`
                );
              }

              // 내용 추출 (수정된 부분)
              const contentElement = post.querySelector(
                ".postText, .contentText"
              );
              const content = contentElement?.textContent?.trim();
              if (!content) {
                console.warn(
                  `게시물 내용을 찾을 수 없습니다. (index: ${postIndex})`
                );
              }

              // 날짜 추출 (수정된 부분)
              const timeElement = post.querySelector(".time, .createTime");
              const postTime =
                timeElement?.textContent?.trim() || new Date().toISOString();

              // 댓글 수와 조회수 추출 (수정된 부분)
              const commentCountText =
                post
                  .querySelector(".commentCount, .comment .count")
                  ?.textContent?.trim() || "0";
              const viewCountText =
                post
                  .querySelector(".readCount, .read .count")
                  ?.textContent?.trim() || "0";

              const postData = {
                postId: postId || `unknown_${Date.now()}_${postIndex}`,
                bandId,
                content: content || "",
                authorName: authorName || "Unknown",
                postTime,
                postUrl: href || "",
                commentCount: parseInt(commentCountText, 10),
                viewCount: parseInt(viewCountText, 10),
                crawledAt: new Date().toISOString(),
              };

              // 디버깅을 위한 데이터 출력
              console.log(
                `게시물 ${postIndex} 데이터:`,
                JSON.stringify(postData, null, 2)
              );

              return postData;
            } catch (error) {
              console.error(`게시물 파싱 오류 (index: ${postIndex}):`, error);
              return null;
            }
          })
          .filter((post) => post !== null);
      }, this.bandId);

      this.updateTaskStatus(
        "processing",
        `화면에서 추출된 게시물 수: ${posts.length}`,
        80
      );

      // 추출된 게시물이 발견된 ID 수보다 적으면 경고
      if (posts.length < discoveredPostIds.length) {
        this.updateTaskStatus(
          "processing",
          `주의: 발견된 게시물 ID (${discoveredPostIds.length}개)보다 추출된 게시물 (${posts.length}개)이 적습니다. 일부 게시물이 누락되었을 수 있습니다.`,
          81
        );
      }

      // 크롤링 결과 로깅
      this.updateTaskStatus(
        "processing",
        `총 ${posts.length}개의 게시물이 크롤링되었습니다.`,
        82
      );
      posts.forEach((post, index) => {
        if (index < 5 || index === posts.length - 1) {
          // 처음 5개와 마지막 게시물만 상세 로깅
          this.updateTaskStatus(
            "processing",
            `게시물 ${index + 1}/${posts.length}: ID=${post.postId}, 작성자=${
              post.authorName
            }, 내용길이=${post.content.length}`,
            82
          );
        }
      });

      // 브라우저를 닫지 않고 유지
      this.updateTaskStatus(
        "processing",
        "크롤링이 완료되었습니다. 브라우저는 열린 상태로 유지됩니다.",
        83
      );
      this.updateTaskStatus(
        "processing",
        "HTML 구조를 확인하려면 브라우저 개발자 도구를 사용하세요.",
        84
      );

      // Firebase에 저장
      await this.savePostsToFirebase(posts);

      this.updateTaskStatus(
        "completed",
        `밴드 ${this.bandId} 게시물 ${posts.length}개 크롤링 완료`,
        100
      );
      return posts;
    } catch (error) {
      this.updateTaskStatus(
        "failed",
        `밴드 ${this.bandId} 게시물 크롤링 실패: ${error.message}`,
        50
      );
      throw error;
    }
  }

  async crawlComments(naverId, naverPassword, postId) {
    try {
      this.updateTaskStatus(
        "processing",
        `게시물 ${postId} 댓글 크롤링 시작`,
        0
      );

      // 로그인 확인 및 처리
      if (!this.browser) {
        this.updateTaskStatus(
          "processing",
          "브라우저 초기화 및 로그인 상태 확인 중...",
          5
        );
        const initResult = await this.initialize(naverId);

        // 초기화 실패하면 로그인 시도
        if (!initResult) {
          this.updateTaskStatus("processing", "저장된 쿠키로 로그인 실패", 20);
          this.updateTaskStatus("processing", "네이버 로그인 시도 중...", 25);

          // 네이버 로그인 시도 (밴드 ID 없이)
          const loginResult = await this.login(naverId, naverPassword);

          // 로그인도 실패하면 크롤링 중단
          if (!loginResult) {
            this.updateTaskStatus(
              "failed",
              "로그인 실패: 댓글 크롤링을 중단합니다",
              30
            );
            throw new Error("로그인 실패: 댓글 크롤링을 진행할 수 없습니다");
          }

          this.updateTaskStatus(
            "processing",
            "네이버 로그인 성공: 댓글 크롤링을 계속 진행합니다",
            35
          );
        } else {
          this.updateTaskStatus(
            "processing",
            "저장된 쿠키로 로그인 성공: 댓글 크롤링을 계속 진행합니다",
            35
          );
        }
      }

      // 게시물 페이지로 이동
      const postUrl = `https://band.us/band/${this.bandId}/post/${postId}`;
      this.updateTaskStatus(
        "processing",
        `게시물 페이지로 이동: ${postUrl}`,
        50
      );
      await this.page.goto(postUrl, { waitUntil: "networkidle2" });

      // 게시물 페이지 접근 가능 여부 확인
      const hasPostAccess = await this.page.evaluate(() => {
        return !document.querySelector(".error_wrap"); // 에러 페이지가 없으면 접근 가능
      });

      if (!hasPostAccess) {
        this.updateTaskStatus(
          "failed",
          "게시물 접근 권한이 없습니다. 게시물 접근 실패.",
          60
        );
        throw new Error("게시물 접근 권한이 없습니다.");
      }

      this.updateTaskStatus(
        "processing",
        "게시물 접근 성공: 댓글 크롤링을 시작합니다",
        65
      );
      await this.page.waitForSelector(".cComment");

      this.updateTaskStatus("processing", "댓글 데이터 추출 중", 70);
      const comments = await this.page.evaluate(async () => {
        const commentElements = document.querySelectorAll(".cComment");
        return Array.from(commentElements).map((comment) => {
          const content =
            comment.querySelector(".contentArea")?.textContent?.trim() || "";
          const author =
            comment.querySelector(".author")?.textContent?.trim() || "";
          const date =
            comment.querySelector(".date")?.textContent?.trim() || "";

          return {
            content,
            author,
            date,
            postId: window.location.pathname.split("/").pop(),
          };
        });
      });

      this.updateTaskStatus(
        "completed",
        `게시물 ${postId}에서 ${comments.length}개 댓글 크롤링 완료`,
        100
      );
      return comments;
    } catch (error) {
      this.updateTaskStatus(
        "failed",
        `게시물 ${postId} 댓글 크롤링 실패: ${error.message}`,
        70
      );
      throw error;
    }
  }

  async autoScroll(page, maxPosts = 30) {
    this.updateTaskStatus(
      "processing",
      `시작: 게시물 스크롤링 (최대 ${maxPosts}개 게시물 제한)`,
      50
    );

    // 처리된 게시물 ID를 추적하기 위한 Set
    const processedPostIds = new Set();
    let newPostsFound = true;
    let totalScrolls = 0;
    const MAX_SCROLLS = 100; // 최대 스크롤 횟수 제한 (충분히 크게 설정)

    while (newPostsFound && totalScrolls < MAX_SCROLLS) {
      // 최대 게시물 수 제한 확인
      if (processedPostIds.size >= maxPosts) {
        this.updateTaskStatus(
          "processing",
          `최대 게시물 수 ${maxPosts}개에 도달하여 스크롤 중단`,
          65
        );
        break;
      }

      totalScrolls++;
      // 스크롤 진행률 계산 (50-65% 사이에서 진행)
      const scrollProgress =
        50 + Math.min(15, (15 * totalScrolls) / MAX_SCROLLS);

      this.updateTaskStatus(
        "processing",
        `스크롤 시도 ${totalScrolls}/${MAX_SCROLLS} (현재 ${processedPostIds.size}/${maxPosts}개 발견)`,
        scrollProgress
      );

      // 이전에 발견된 게시물 ID 수 저장
      const prevPostIdsCount = processedPostIds.size;

      // 화면 아래로 스크롤
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight * 0.8); // 화면 높이의 80%만큼 스크롤
      });

      // 새 콘텐츠 로드 대기
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 현재 보이는 모든 게시물 ID 수집
      const currentPostIds = await page.evaluate(() => {
        const posts = document.querySelectorAll(".cCard.gContentCardShadow");
        const postIds = [];

        posts.forEach((post) => {
          // 링크에서 postId 추출
          const aLink = post.querySelector('a[href*="/post/"]');
          if (aLink) {
            const href = aLink.getAttribute("href");
            const postId = href.split("/post/")[1];
            if (postId) {
              postIds.push(postId);
            }
          }
        });

        return postIds;
      });

      // 새로운 게시물 ID를 Set에 추가
      currentPostIds.forEach((id) => {
        // 최대 게시물 수 제한에 도달하면 더 이상 추가하지 않음
        if (processedPostIds.size < maxPosts) {
          processedPostIds.add(id);
        }
      });

      // 최대 게시물 수에 도달했는지 다시 확인
      if (processedPostIds.size >= maxPosts) {
        this.updateTaskStatus(
          "processing",
          `최대 게시물 수 ${maxPosts}개에 도달하여 스크롤 중단`,
          65
        );
        break;
      }

      // 새 게시물이 발견되었는지 확인
      const newPostsCount = processedPostIds.size - prevPostIdsCount;
      this.updateTaskStatus(
        "processing",
        `현재까지 발견된 게시물 수: ${processedPostIds.size}/${maxPosts} (새로 발견: +${newPostsCount})`,
        scrollProgress + 1
      );

      // 새 게시물이 없으면 한 번 더 스크롤 시도 후 종료
      if (newPostsCount === 0) {
        // 안전을 위해 한 번 더 스크롤
        await page.evaluate(() => {
          window.scrollBy(0, window.innerHeight);
        });
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // 다시 확인
        const finalPostIds = await page.evaluate(() => {
          const posts = document.querySelectorAll(
            '.cCard.gContentCardShadow a[href*="/post/"]'
          );
          return Array.from(posts)
            .map((a) => a.getAttribute("href").split("/post/")[1])
            .filter(Boolean);
        });

        // 새 게시물 중 maxPosts 제한을 고려하여 추가
        let finalNewCount = 0;
        for (const id of finalPostIds) {
          if (!processedPostIds.has(id) && processedPostIds.size < maxPosts) {
            processedPostIds.add(id);
            finalNewCount++;
          }
        }

        if (finalNewCount === 0) {
          newPostsFound = false;
          this.updateTaskStatus(
            "processing",
            "더 이상 새 게시물이 발견되지 않아 스크롤 종료",
            68
          );
        } else {
          // 새 게시물이 있으면 계속 진행
          this.updateTaskStatus(
            "processing",
            `마지막 확인에서 추가 게시물 ${finalNewCount}개 발견, 총 ${processedPostIds.size}/${maxPosts}개`,
            scrollProgress + 2
          );
        }
      }
    }

    // 최대 게시물 수에 도달했는지 최종 확인
    if (processedPostIds.size >= maxPosts) {
      this.updateTaskStatus(
        "processing",
        `최대 ${maxPosts}개 게시물 제한에 도달했습니다.`,
        68
      );
    }

    // 처리된 모든 게시물 ID 목록 로깅
    this.updateTaskStatus(
      "processing",
      `총 발견된 게시물 수: ${processedPostIds.size}/${maxPosts}`,
      68
    );

    // 스크롤이 끝난 후 모든 게시물을 한눈에 볼 수 있도록 상단으로 이동
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });

    // 이제 모든 게시물이 보이도록 천천히 스크롤
    await page.evaluate(async () => {
      const scrollHeight = document.documentElement.scrollHeight;
      const viewportHeight = window.innerHeight;
      const scrollSteps = 20; // 더 세밀하게 나눠서 스크롤

      for (let i = 0; i <= scrollSteps; i++) {
        const scrollPosition = (scrollHeight / scrollSteps) * i;
        window.scrollTo(0, scrollPosition);
        // 각 단계에서 데이터 로딩을 위한 짧은 대기시간
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    });

    this.updateTaskStatus("processing", "완료: 게시물 스크롤링", 69);

    // 최종 데이터 로딩을 위한 추가 대기시간
    await new Promise((resolve) => setTimeout(resolve, 4000));

    return Array.from(processedPostIds); // 발견된 고유 게시물 ID 목록 반환
  }

  // close 메서드 수정
  async close() {
    try {
      if (this.browser) {
        // 브라우저를 닫지 않고 경고 메시지만 출력
        this.updateTaskStatus(
          "processing",
          "브라우저가 열린 상태로 유지됩니다. 수동으로 닫아주세요.",
          95
        );
      }
    } catch (error) {
      this.updateTaskStatus(
        "failed",
        `브라우저 상태 확인 중 오류: ${error.message}`,
        95
      );
      그러나;
    }
  }

  async crawlPostDetail(naverId, naverPassword, maxPosts = 5) {
    try {
      // this.bandId 확인 - 생성자에서 설정된 값 사용
      if (!this.bandId) {
        this.updateTaskStatus("failed", "밴드 ID가 설정되지 않았습니다", 0);
        throw new Error("밴드 ID가 설정되지 않았습니다");
      }

      this.updateTaskStatus(
        "processing",
        `밴드 ID: ${this.bandId} 게시물 상세 크롤링 시작`,
        0
      );

      // 브라우저 초기화 및 로그인 상태 확인
      if (!this.browser) {
        this.updateTaskStatus(
          "processing",
          "브라우저 초기화 및 로그인 상태 확인 중...",
          5
        );
        const initResult = await this.initialize(naverId);

        // 초기화 실패하면 로그인 시도
        if (!initResult) {
          this.updateTaskStatus(
            "processing",
            "저장된 쿠키로 로그인 실패 !!!!!",
            25
          );
          this.updateTaskStatus("processing", "네이버 로그인 시도 중...", 30);
          // 네이버 로그인만 처리
          const loginResult = await this.login(naverId, naverPassword);

          // 로그인도 실패하면 크롤링 중단
          if (!loginResult) {
            this.updateTaskStatus(
              "failed",
              "로그인 실패: 크롤링을 중단합니다",
              30
            );
            throw new Error("로그인 실패: 크롤링을 진행할 수 없습니다");
          }

          this.updateTaskStatus(
            "processing",
            "네이버 로그인 성공: 크롤링을 계속 진행합니다",
            35
          );
        } else {
          this.updateTaskStatus(
            "processing",
            "저장된 쿠키로 로그인 성공: 크롤링을 계속 진행합니다",
            35
          );
        }
      }

      // 밴드 페이지로 이동
      this.updateTaskStatus(
        "processing",
        `밴드 페이지로 이동: https://band.us/band/${this.bandId}`,
        40
      );
      await this.page.goto(`https://band.us/band/${this.bandId}`, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      // 밴드 접근 가능 여부 확인
      const hasBandAccess = await this.page.evaluate(() => {
        const bandName = document.querySelector(".bandName");
        return !!bandName;
      });

      if (!hasBandAccess) {
        this.updateTaskStatus(
          "failed",
          "밴드 접근 권한이 없습니다. 밴드 접근 실패.",
          40
        );
        throw new Error("밴드 접근 권한이 없습니다.");
      }

      this.updateTaskStatus(
        "processing",
        "밴드 접근 성공: 게시물 상세 정보 크롤링을 시작합니다",
        45
      );

      // 로그인 상태 확인 (게시물 카드가 표시되는지 확인)
      try {
        await this.page.waitForSelector(".cCard.gContentCardShadow", {
          timeout: 10000,
        });
        this.updateTaskStatus(
          "processing",
          "밴드 페이지 성공적으로 로드됨 (게시물 카드 확인)",
          47
        );
      } catch (error) {
        this.updateTaskStatus(
          "processing",
          "밴드 페이지 로드 실패: 게시물 카드를 찾을 수 없음",
          47
        );

        // 현재 페이지 URL 확인
        const currentUrl = await this.page.url();
        this.updateTaskStatus(
          "processing",
          `현재 페이지 URL: ${currentUrl}`,
          48
        );

        // 로그인 페이지로 리다이렉트된 경우 다시 로그인 시도
        if (currentUrl.includes("login")) {
          this.updateTaskStatus(
            "processing",
            "로그인 페이지로 리다이렉트됨 - 로그인 재시도",
            49
          );
          const loginResult = await this.login(naverId, naverPassword);
          if (!loginResult) {
            this.updateTaskStatus(
              "failed",
              "로그인 재시도 실패: 크롤링을 진행할 수 없습니다",
              49
            );
            throw new Error("로그인 재시도 실패: 크롤링을 진행할 수 없습니다");
          }

          // 로그인 후 다시 밴드 페이지로 이동
          await this.page.goto(`https://band.us/band/${this.bandId}`, {
            waitUntil: "networkidle2",
            timeout: 30000,
          });

          // 다시 게시물 카드 확인
          await this.page.waitForSelector(".cCard.gContentCardShadow", {
            timeout: 10000,
          });
        } else {
          this.updateTaskStatus(
            "failed",
            "밴드 페이지 접근 실패: 게시물을 찾을 수 없습니다",
            49
          );
          throw new Error("밴드 페이지 접근 실패: 게시물을 찾을 수 없습니다");
        }
      }

      // 게시물 상세 정보 및 댓글 크롤링 준비
      this.updateTaskStatus("processing", "첫 번째 게시물 팝업 열기", 50);

      // 첫 번째 게시물의 dPostTextView 요소 찾아 클릭
      const firstPostTextView = await this.page.$(".dPostTextView");
      if (!firstPostTextView) {
        this.updateTaskStatus(
          "failed",
          "첫 번째 게시물의 텍스트 뷰를 찾을 수 없습니다.",
          50
        );
        throw new Error("첫 번째 게시물의 텍스트 뷰를 찾을 수 없습니다.");
      }

      // 첫 번째 게시물 클릭
      await firstPostTextView.click();

      // 팝업이 열릴 때까지 대기
      await this.page.waitForSelector(".txtBody", { timeout: 10000 });
      this.updateTaskStatus(
        "processing",
        "게시물 팝업이 열렸습니다. 크롤링 시작",
        55
      );

      // 크롤링할 게시물 목록
      const detailedPosts = [];
      let currentPostCount = 0;

      // 최대 maxPosts 수만큼 게시물 크롤링
      while (currentPostCount < maxPosts) {
        const progress = 55 + (35 * currentPostCount) / maxPosts;
        this.updateTaskStatus(
          "processing",
          `게시물 ${currentPostCount + 1}/${maxPosts} 크롤링 중`,
          progress
        );

        try {
          // 현재 게시물의 상세 정보 추출
          const postDetail = await this._extractPostDetailFromPopup();

          if (postDetail) {
            detailedPosts.push(postDetail);
            currentPostCount++;

            // 목표 게시물 수에 도달했는지 확인
            if (currentPostCount >= maxPosts) {
              this.updateTaskStatus(
                "processing",
                `목표 게시물 수(${maxPosts}개)에 도달했습니다.`,
                90
              );
              break;
            }

            // 다음 게시물로 이동 - 수정된 헬퍼 메서드 사용
            const nextButtonClicked = await this._findAndClickNextButton();

            if (!nextButtonClicked) {
              this.updateTaskStatus(
                "processing",
                `다음 게시물 버튼을 찾을 수 없거나 클릭할 수 없습니다. 총 ${currentPostCount}개의 게시물을 크롤링했습니다.`,
                90
              );
              break;
            }

            // 게시물 내용이 로드되었는지 확인
            const isLoaded = await this.page.evaluate(() => {
              const txtBody = document.querySelector(".txtBody");
              return !!txtBody && txtBody.textContent.trim().length > 0;
            });

            if (!isLoaded) {
              this.updateTaskStatus(
                "processing",
                `다음 게시물 로드에 실패했습니다. 총 ${currentPostCount}개의 게시물을 크롤링했습니다.`,
                90
              );
              break;
            }
          } else {
            this.updateTaskStatus(
              "processing",
              `현재 게시물 추출에 실패했습니다. 다음 게시물로 이동합니다.`,
              progress
            );

            // 다음 게시물로 이동 - 수정된 헬퍼 메서드 사용
            const nextButtonClicked = await this._findAndClickNextButton();

            if (!nextButtonClicked) {
              this.updateTaskStatus(
                "processing",
                `다음 게시물 버튼을 찾을 수 없거나 클릭할 수 없습니다. 총 ${currentPostCount}개의 게시물을 크롤링했습니다.`,
                90
              );
              break;
            }
          }
        } catch (error) {
          this.updateTaskStatus(
            "processing",
            `게시물 ${currentPostCount + 1} 크롤링 중 오류: ${error.message}`,
            progress
          );

          // 다음 게시물로 이동 시도 - 수정된 헬퍼 메서드 사용
          const nextButtonClicked = await this._findAndClickNextButton();

          if (!nextButtonClicked) {
            this.updateTaskStatus(
              "processing",
              `다음 게시물 버튼을 찾을 수 없거나 클릭할 수 없습니다. 총 ${currentPostCount}개의 게시물을 크롤링했습니다.`,
              90
            );
            break;
          }
        }
      }

      // 팝업 닫기 (ESC 키 누르기)
      await this.page.keyboard.press("Escape");

      // 크롤링된 게시물 저장
      if (detailedPosts.length > 0) {
        this.updateTaskStatus(
          "processing",
          `${detailedPosts.length}개의 게시물을 Firebase에 저장 중...`,
          92
        );

        // Firebase에 저장
        await this.saveDetailPostsToFirebase(detailedPosts);

        this.updateTaskStatus(
          "processing",
          `${detailedPosts.length}개의 게시물이 Firebase에 저장되었습니다.`,
          95
        );
      }

      // 결과 정리 및 반환
      this.updateTaskStatus(
        "completed",
        `밴드 ${this.bandId} 게시물 ${detailedPosts.length}개 상세 크롤링 완료`,
        100
      );
      return detailedPosts;
    } catch (error) {
      this.updateTaskStatus(
        "failed",
        `밴드 ${this.bandId} 게시물 상세 크롤링 실패: ${error.message}`,
        50
      );
      throw error;
    }
  }

  async saveDetailPostsToFirebase(detailedPosts) {
    try {
      this.updateTaskStatus(
        "processing",
        "게시물 상세 정보 Firebase 저장 중",
        93
      );
      const db = getFirebaseDb();
      const batch = db.batch();
      const postsRef = db.collection("post_details");
      const commentsRef = db.collection("comments");

      // 디버깅을 위한 변수들
      let totalCommentCount = 0;
      let postsWithComments = 0;

      // 게시물 상세 정보 및 댓글 저장
      for (const post of detailedPosts) {
        // postId 유효성 검사 - undefined나 null인 경우 대체 ID 생성
        if (!post.postId || post.postId === "undefined") {
          post.postId = `unknown_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 9)}`;
          logger.warn(
            `유효하지 않은 postId 감지, 대체 ID 사용: ${post.postId}`
          );
        }

        const { comments, ...postData } = post;

        // 로깅: 각 게시물의 댓글 수
        const commentCount = comments?.length || 0;
        if (commentCount > 0) {
          postsWithComments++;
          logger.info(
            `게시물 ID: ${post.postId} - 댓글 ${commentCount}개 저장 시도 중`
          );
        }
        totalCommentCount += commentCount;

        // 게시물 상세 정보 저장
        const postDocRef = postsRef.doc(post.postId);
        batch.set(
          postDocRef,
          {
            ...postData,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { merge: true }
        );

        // 각 게시물의 댓글 저장
        if (comments && comments.length > 0) {
          comments.forEach((comment, index) => {
            const commentId = `${post.postId}_comment_${index}`;
            const commentDocRef = commentsRef.doc(commentId);

            // 개별 댓글 저장 로깅
            logger.debug(`댓글 ID: ${commentId} 저장 시도 중...`);

            batch.set(
              commentDocRef,
              {
                ...comment,
                postId: post.postId,
                bandId: this.bandId,
                commentId,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
              { merge: true }
            );
          });
        }
      }

      // 게시물이 없는 경우 처리
      if (detailedPosts.length === 0) {
        logger.warn("Firebase에 저장할 게시물이 없습니다.");
        this.updateTaskStatus("processing", "저장할 게시물이 없습니다.", 94);
        return;
      }

      // 배치 저장 전 요약 로깅
      logger.info(
        `총 ${detailedPosts.length}개의 게시물 중 ${postsWithComments}개의 게시물에 댓글이 있음`
      );
      logger.info(`총 ${totalCommentCount}개의 댓글을 저장 시도 중...`);

      // 배치 저장 실행
      await batch.commit();

      this.updateTaskStatus(
        "processing",
        `${detailedPosts.length}개의 게시물 상세 정보와 ${totalCommentCount}개의 댓글이 Firebase에 저장되었습니다.`,
        94
      );

      logger.info(
        `Firebase 저장 완료: ${detailedPosts.length}개 게시물, ${totalCommentCount}개 댓글`
      );
    } catch (error) {
      this.updateTaskStatus(
        "failed",
        `Firebase에 게시물 상세 정보 저장 중 오류 발생: ${error.message}`,
        93
      );
      logger.error(`Firebase 저장 오류: ${error.message}`);
      throw error;
    }
  }

  // 게시물 팝업에서 내용 추출을 위한 헬퍼 메서드
  async _extractPostDetailFromPopup() {
    try {
      // 현재 게시물 URL에서 postId 추출
      const currentUrl = await this.page.url();
      const postIdMatch = currentUrl.match(/\/post\/([^/?#]+)/);
      const postId = postIdMatch ? postIdMatch[1] : `unknown_${Date.now()}`;

      logger.info(`게시물 ID: ${postId} - 댓글 추출 시작`);

      // DOM이 완전히 로드될 때까지 충분한 시간 대기
      logger.debug(`게시물 및 댓글이 로드될 때까지 3초 대기 중...`);
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // 게시물 상세 정보 및 댓글 추출 - 사용자 제공 코드 참고
      const postDetail = await this.page.evaluate(() => {
        // 현재 URL에서 postId 다시 추출 (페이지 컨텍스트 내에서)
        const currentPostId = window.location.pathname.split("/post/")[1];

        // 1. 게시물 정보 추출
        // 본문 내용 추출
        const txtBody = document.querySelector(".postText._postText .txtBody");
        const postContent = txtBody ? txtBody.innerText.trim() : "";

        // 게시물 제목 (있을 경우)
        const titleElement = document.querySelector(
          ".dPostDetailTitleView h1, .postTitle"
        );
        const postTitle = titleElement ? titleElement.innerText.trim() : "";

        // 작성자 정보 추출
        const authorEl = document.querySelector(".postWriter .userName");
        const authorName = authorEl ? authorEl.innerText.trim() : "Unknown";

        // 작성 일시 추출
        const timeEl = document.querySelector(".postWriter .time, .createTime");
        const postTime = timeEl
          ? timeEl.innerText.trim()
          : new Date().toISOString();

        // 조회수 추출
        const readCountEl = document.querySelector(
          ".postWriter .readCount, .read .count"
        );
        const readCount = readCountEl
          ? parseInt(readCountEl.innerText.replace(/[^0-9]/g, "") || "0", 10)
          : 0;

        // 이미지 URL 추출 (있다면)
        const imageElements = document.querySelectorAll(
          ".postBody .uCollage .collageImage img, .photoImage img"
        );
        const imageUrls = Array.from(imageElements)
          .map((img) => img.src)
          .filter(Boolean);

        // 댓글 수 추출 - UI에 표시된 댓글 수
        const commentCountEl = document.querySelector(
          ".comment._commentCountBtn .count"
        );
        const commentCountText = commentCountEl
          ? commentCountEl.innerText
          : "0";
        const commentCount = parseInt(
          commentCountText.replace(/[^0-9]/g, "") || "0",
          10
        );

        console.log(`화면에 표시된 댓글 수: ${commentCount}`);
        console.log(`현재 게시물 ID: ${currentPostId}`);
        console.log(`게시물 작성자: ${authorName}`);
        console.log(`게시물 시간: ${postTime}`);
        console.log(`게시물 제목: ${postTitle}`);
        console.log(`게시물 이미지 수: ${imageUrls.length}`);

        // 2. 댓글 추출
        const comments = [];

        // 댓글 리스트 찾기
        const commentElements = document.querySelectorAll(
          ".dPostCommentMainView .cComment"
        );
        console.log(`화면에서 찾은 댓글 요소 수: ${commentElements.length}`);

        // 댓글 요소 순회하며 정보 추출
        commentElements.forEach((comment, index) => {
          try {
            // 댓글 작성자 정보
            const commentAuthorEl = comment.querySelector(".writeInfo .name");
            const commentAuthor = commentAuthorEl
              ? commentAuthorEl.innerText.trim()
              : "알 수 없음";

            // 댓글 작성자 닉네임 (있다면)
            const commentNicknameEl = comment.querySelector(
              ".writeInfo .nickname"
            );
            const commentNickname = commentNicknameEl
              ? commentNicknameEl.innerText.trim()
              : null;

            // 관리자 여부
            const isManager =
              comment.querySelector(".writeInfo .nameWrap.-manager") !== null;

            // 프로필 이미지
            const profileImg = comment.querySelector(
              ".writeInfo .uProfile img._image"
            );
            const profileImageUrl = profileImg
              ? profileImg.getAttribute("src")
              : null;

            // 비밀 댓글인지 확인
            const isSecretComment =
              comment.querySelector(".secretGuideBox") !== null;

            // 댓글 내용
            const commentContentEl = comment.querySelector(
              ".commentBody .txt._commentContent"
            );
            let commentContent;

            if (isSecretComment) {
              commentContent = "비밀 댓글입니다.";
            } else {
              commentContent = commentContentEl
                ? commentContentEl.innerText.trim()
                : "";
            }

            // 댓글 작성 시간
            const commentTimeEl = comment.querySelector(".commentBody .time");
            const commentTime = commentTimeEl
              ? commentTimeEl.innerText.trim()
              : "";
            const commentTimeTitle = commentTimeEl
              ? commentTimeEl.getAttribute("title") || ""
              : "";

            // 유효한 댓글만 추가
            if (commentAuthor !== "알 수 없음" && commentContent) {
              console.log(
                `댓글 ${index} 추출: ${commentAuthor} - ${commentContent.substring(
                  0,
                  20
                )}${commentContent.length > 20 ? "..." : ""}`
              );

              comments.push({
                index,
                name: commentAuthor,
                content: commentContent,
                commentTime,
                commentTimeTitle,
                nickname: commentNickname,
                isManager,
                profileImageUrl,
                isSecret: isSecretComment,
              });
            } else {
              console.log(
                `댓글 ${index}: 불완전한 데이터 - 작성자: ${commentAuthor}, 내용 길이: ${
                  (commentContent || "").length
                }`
              );
            }
          } catch (err) {
            console.error(`댓글 ${index} 추출 중 오류: ${err.message}`);
          }
        });

        // 댓글 수가 UI와 다른 경우 경고
        if (comments.length !== commentCount) {
          console.warn(
            `추출된 댓글 수(${comments.length})가 UI에 표시된 댓글 수(${commentCount})와 다릅니다.`
          );
        }

        return {
          postId: currentPostId || `unknown_${Date.now()}`, // 반드시 postId가 있도록 보장
          postTitle,
          postContent,
          authorName,
          postTime,
          readCount,
          commentCount,
          comments,
          imageUrls,
        };
      });

      // 추출된 결과 로깅
      logger.info(
        `추출된 댓글 수: ${
          postDetail.comments?.length || 0
        } / 게시물에 표시된 댓글 수: ${postDetail.commentCount}`
      );

      if (postDetail.comments?.length > 0) {
        logger.info(`첫 번째 댓글: ${JSON.stringify(postDetail.comments[0])}`);
        if (postDetail.comments.length > 1) {
          logger.info(
            `마지막 댓글: ${JSON.stringify(
              postDetail.comments[postDetail.comments.length - 1]
            )}`
          );
        }
      }

      // postId가 undefined인 경우를 대비한 안전 조치
      if (!postDetail.postId || postDetail.postId === "undefined") {
        postDetail.postId = postId || `unknown_${Date.now()}`;
        logger.warn(
          `유효하지 않은 postId 감지, 대체 ID 사용: ${postDetail.postId}`
        );
      }

      // 완성된 게시물 정보 반환
      return {
        ...postDetail,
        bandId: this.bandId,
        crawledAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error(`게시물 내용 추출 중 오류: ${error.message}`);
      return null;
    }
  }

  // 다음 게시물 버튼 찾기 및 클릭을 위한 헬퍼 메서드
  async _findAndClickNextButton() {
    try {
      // 다음 버튼이 로드될 때까지 충분히 대기
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // 다양한 셀렉터를 시도하여 다음 버튼 찾기
      let nextButton = null;

      // 방법 1: 정확한 클래스 조합으로 찾기
      nextButton = await this.page.$(".btnNextPost._btnNextPost");

      // 방법 2: 컨테이너 내부에서 찾기
      if (!nextButton) {
        const container = await this.page.$(".lyWrap._scrollContainer");
        if (container) {
          nextButton = await container.$(".btnNextPost");
        }
      }

      // 방법 3: 기본 클래스로만 찾기
      if (!nextButton) {
        nextButton = await this.page.$(".btnNextPost");
      }

      // 방법 4: XPath 사용
      if (!nextButton) {
        const elements = await this.page.$x(
          "//button[contains(@class, 'btnNextPost')]"
        );
        if (elements.length > 0) {
          nextButton = elements[0];
        }
      }

      // 버튼을 찾았으면 클릭
      if (nextButton) {
        await nextButton.click();
        // 다음 페이지 로드 대기
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return true;
      }

      // 디버그 정보 수집
      this.updateTaskStatus(
        "processing",
        "다음 버튼을 찾을 수 없습니다. 페이지 구조를 디버깅합니다.",
        85
      );

      // 페이지 구조 분석
      const buttonInfo = await this.page.evaluate(() => {
        // 버튼 관련 요소 찾기
        const containers = document.querySelectorAll(
          ".lyWrap._scrollContainer"
        );
        const allButtons = document.querySelectorAll("button");
        const possibleNextButtons = Array.from(allButtons).filter(
          (btn) =>
            btn.className.includes("Next") ||
            btn.className.includes("next") ||
            btn.innerText.includes("다음") ||
            btn.className.includes("btnNext")
        );

        return {
          containersCount: containers.length,
          allButtonsCount: allButtons.length,
          possibleNextButtons: possibleNextButtons.map((btn) => ({
            className: btn.className,
            innerText: btn.innerText,
            isVisible: btn.offsetParent !== null,
            style: btn.getAttribute("style"),
          })),
        };
      });

      logger.info("버튼 디버그 정보:", JSON.stringify(buttonInfo, null, 2));
      return false;
    } catch (error) {
      logger.error(`다음 버튼 처리 중 오류: ${error.message}`);
      return false;
    }
  }
}

module.exports = BandCrawler;
