# 1. 베이스 Node.js 이미지 선택
FROM node:18-slim

# 2. 시스템 업데이트 및 Puppeteer 실행에 필요한 라이브러리 설치
#    Chromium 자체는 설치하지 않음 (Puppeteer가 다운로드)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       # 필수 종속 라이브러리 (제거하면 안됨!)
       libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
       libexpat1 libfontconfig1 libgcc1 libglib2.0-0 \
       libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 \
       libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 \
       libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 \
       fonts-liberation libnss3 xdg-utils \
       # wget은 Puppeteer 다운로드를 위해 필요할 수 있음
       wget \
    # apt 캐시 정리
    && rm -rf /var/lib/apt/lists/*

# 3. 작업 디렉토리 설정
WORKDIR /app

# 4. package.json 및 package-lock.json 복사
COPY package*.json ./

# 5. 종속성 설치 (이제 Puppeteer가 Chromium 다운로드)
#    관련 환경 변수 제거됨
RUN npm install

# 6. 애플리케이션 소스 코드 복사
COPY . .

# 7. 애플리케이션 실행 명령어
CMD [ "node", "src/server.js" ]