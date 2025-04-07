# 1. 베이스 Node.js 이미지 선택
FROM node:18-slim

# 2. 필수 도구 및 인증서 먼저 설치
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        wget \
        gnupg \
    && rm -rf /var/lib/apt/lists/*

# 3. Google Chrome 저장소 키 추가 및 설정
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome-keyring.gpg \
    && sh -c 'echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list'

# 4. 패키지 목록 업데이트 및 Google Chrome 설치
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        google-chrome-stable \
        libgbm-dev \
        # 다양한 문자 세트 지원을 위한 폰트 (선택 사항이지만 권장)
        fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

# 5. Puppeteer 사용자 생성 (이후 과정은 동일)
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser

# 작업 디렉토리 설정 및 권한 부여
WORKDIR /app
RUN chown -R pptruser:pptruser /app

# package.json 및 package-lock.json 복사
COPY --chown=pptruser:pptruser package*.json ./

# Puppeteer 사용자로 전환
USER pptruser

# 종속성 설치
RUN npm install \
    && npm cache clean --force

# 애플리케이션 소스 코드 복사
COPY --chown=pptruser:pptruser . .

# 애플리케이션 실행 명령어
CMD [ "node", "src/server.js" ]