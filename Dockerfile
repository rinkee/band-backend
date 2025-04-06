# Use an official Node.js Alpine runtime as a parent image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# --- Puppeteer/Chromium Configuration for Alpine ---
# 1. Tell Puppeteer NOT to download its own Chromium, as we will install it via apk.
# 2. Tell Puppeteer where to find the system-installed Chromium executable.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# --- Install Chromium and necessary dependencies using Alpine's package manager (apk) ---
# RUN apt-get update && apt-get install gnupg wget -y && \  <-- 삭제 (apt-get 사용 불가)
#     wget --quiet --output-document=- https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /etc/apt/trusted.gpg.d/google-archive.gpg && \ <-- 삭제
#     sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' && \ <-- 삭제
#     apt-get update && \ <-- 삭제
#     apt-get install google-chrome-stable -y --no-install-recommends && \ <-- 삭제 (google-chrome-stable 대신 chromium 설치)
#     rm -rf /var/lib/apt/lists/* <-- 삭제 (apk 캐시 정리로 대체)

# === Alpine 방식 수정 ===
RUN apk update && apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    udev \
    # 필요에 따라 다른 종속성 추가 가능
    # 예: dbus
    && rm -rf /var/cache/apk/* # apk 캐시 정리

# --- 애플리케이션 종속성 설치 ---
# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install production dependencies using npm ci (recommended for CI/CD)
# 이전에 있던 'RUN npm install'은 제거합니다. 'npm ci'가 더 빠르고 안정적입니다.
RUN npm ci --only=production

# --- 애플리케이션 코드 복사 ---
# Bundle app source
COPY . .

# --- 실행 설정 ---
# Expose the port the app runs on (Cloud Run uses PORT env var)
EXPOSE 8080

# Define the command to run the app using the "start" script in package.json
CMD [ "npm", "start" ]

# --- 불필요한 검증 단계 제거 ---
# RUN ls -alh /usr/bin/google-chrome-stable && \ <-- 삭제 (경로 및 이름 변경됨)
#     /usr/bin/google-chrome-stable --version <-- 삭제