# Debian 기반 이미지 사용 (예: node:18-slim)
FROM node:18-slim

# 시스템 업데이트 및 필수 종속성 설치 (Puppeteer 공식 가이드 목록 참고)
# Chromium 실행에 필요한 라이브러리들입니다.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    # Puppeteer 버전에 따라 필요한 라이브러리가 약간 다를 수 있습니다.
    # 에러 발생 시 로그를 보고 누락된 라이브러리를 추가해야 할 수 있습니다.
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Puppeteer는 기본적으로 Chromium을 다운로드합니다. (이 방식이 더 간단할 수 있음)
# 만약 시스템 Chromium을 사용하고 싶다면 아래 주석 처리된 부분을 사용하고
# apk add chromium 부분을 추가해야 합니다. (Alpine에서 주로 사용)
# ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
#     PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium # 또는 chromium-browser

COPY package*.json ./

# 종속성 설치 (Puppeteer 포함)
# --only=production 은 devDependencies를 제외합니다. Puppeteer가 devDependencies에 있다면 제거하세요.
RUN npm ci --only=production

COPY . .

EXPOSE 8080
CMD [ "npm", "start" ]