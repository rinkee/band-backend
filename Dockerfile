# 1. 베이스 Node.js 이미지 선택
FROM node:18-slim

# 2. 시스템 업데이트 및 Google Chrome과 필요 라이브러리 설치
RUN apt-get update \
    # Chrome 설치에 필요한 도구 설치
    && apt-get install -y wget gnupg ca-certificates \
    # Google Chrome 저장소 키 추가
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    # Google Chrome 저장소 추가
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list' \
    # 패키지 목록 다시 업데이트 (Google 저장소 포함)
    && apt-get update \
    # Google Chrome Stable 버전과 Puppeteer 실행에 필요한 라이브러리 설치
    # (이전 빌드 로그에서 실패했던 패키지들은 제외)
    && apt-get install -y google-chrome-stable \
       libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
       libexpat1 libfontconfig1 libgcc1 libglib2.0-0 \
       libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 \
       libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 \
       libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 \
       fonts-liberation libnss3 xdg-utils \
       # --no-install-recommends 옵션으로 불필요한 패키지 제외
       --no-install-recommends \
    # apt 캐시 정리하여 이미지 크기 줄이기
    && rm -rf /var/lib/apt/lists/*

# 3. 작업 디렉토리 설정
WORKDIR /app

# 4. package.json 및 package-lock.json 복사
COPY package*.json ./

# 5. 종속성 설치 (Puppeteer 포함) 및 Puppeteer 환경 변수 설정
#    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: npm install 시 Chromium 자동 다운로드 건너뛰기
#    PUPPETEER_EXECUTABLE_PATH: Dockerfile에서 설치한 Chrome 경로 지정
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/opt/google/chrome/chrome


# npm install 실행
RUN npm install

# 6. 애플리케이션 소스 코드 복사
COPY . .

# 7. 애플리케이션 실행 명령어
CMD [ "node", "src/server.js" ]