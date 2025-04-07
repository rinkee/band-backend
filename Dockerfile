# 1. 베이스 Node.js 이미지 선택
FROM node:18-slim

# 2. 시스템 업데이트 및 Puppeteer 실행에 필요한 라이브러리 설치
#    (이 목록은 Puppeteer 버전에 따라 달라질 수 있습니다. 최신 정보는 Puppeteer 문서를 확인하세요.)
RUN apt-get update \
    && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    # Puppeteer가 필요로 하는 추가 라이브러리 (예시)
    && apt-get install -yq --no-install-recommends \
      libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
      libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 \
      libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 \
      libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 \
      libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
      ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release \
      xdg-utils

# 3. 작업 디렉토리 설정
WORKDIR /app

# 4. package.json 및 package-lock.json 복사
COPY package*.json ./

# 5. 종속성 설치 (Puppeteer 포함)
#    주의: PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true 를 설정하여 Dockerfile에서 Chrome을 직접 설치했으므로,
#    npm install 시 Puppeteer가 자동으로 Chromium을 다운로드하지 않도록 합니다.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

RUN npm install

# 6. 애플리케이션 소스 코드 복사
COPY . .

# 7. 애플리케이션 실행 명령어 (기존 시작 명령어 사용)
#    예시: CMD [ "node", "src/server.js" ]
#    만약 yarn을 사용한다면 CMD [ "yarn", "start" ] 등
CMD [ "node", "src/server.js" ]