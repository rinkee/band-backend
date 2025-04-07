# 1. 베이스 Node.js 이미지 선택
FROM node:18-slim 

# 2. 시스템 업데이트 및 Chromium과 필요 라이브러리 설치
RUN apt-get update \
    # 필수 도구 설치 (ca-certificates 등은 chromium 설치 시 자동으로 처리될 수 있음)
    && apt-get install -y wget gnupg ca-certificates \
    # Chromium 브라우저와 Puppeteer 실행에 필요한 라이브러리 설치
    # google-chrome-stable 대신 chromium 설치
    && apt-get install -y chromium \
       libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
       libexpat1 libfontconfig1 libgcc1 libglib2.0-0 \
       libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 \
       libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 \
       libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 \
       fonts-liberation libnss3 xdg-utils \
       # --no-install-recommends 옵션
       --no-install-recommends \
    # apt 캐시 정리
    && rm -rf /var/lib/apt/lists/*

# 3. 작업 디렉토리 설정
WORKDIR /app

# 4. package.json 및 package-lock.json 복사
COPY package*.json ./

# 5. 종속성 설치 및 Puppeteer 환경 변수 설정
#    Chromium의 기본 설치 경로는 보통 /usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# npm install 실행
RUN npm install

# 6. 애플리케이션 소스 코드 복사
COPY . .

# 7. 애플리케이션 실행 명령어
CMD [ "node", "src/server.js" ]