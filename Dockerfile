# Use an official Node.js runtime as a parent image
# LTS (Long Term Support) 버전을 사용하는 것이 안정성 측면에서 좋습니다.
# 필요에 따라 버전을 변경하세요 (예: node:18-alpine, node:20)
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# We don't need the standalone Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true

# Install Google Chrome Stable and fonts
# Note: this installs the necessary libs to make the browser work with Puppeteer.
RUN apt-get update && apt-get install gnupg wget -y && \
    wget --quiet --output-document=- https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /etc/apt/trusted.gpg.d/google-archive.gpg && \
    sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' && \
    apt-get update && \
    apt-get install google-chrome-stable -y --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Verify that Chrome is installed at the expected location
RUN ls -alh /usr/bin/google-chrome-stable && \
    /usr/bin/google-chrome-stable --version



# Copy package.json and package-lock.json (or yarn.lock)
# package-lock.json 또는 yarn.lock 파일이 있다면 함께 복사하는 것이 좋습니다.
COPY package*.json ./
# 만약 yarn을 사용한다면 아래 줄을 대신 사용하세요.
# COPY package.json yarn.lock ./

# Install app dependencies including Puppeteer
RUN npm install

# Install app dependencies
# CI=true 옵션은 불필요한 로그 출력을 줄이고, package-lock.json을 엄격하게 사용하도록 합니다.
RUN npm ci --only=production
# 만약 yarn을 사용한다면 아래 줄을 대신 사용하세요.
# RUN yarn install --frozen-lockfile --production

# Bundle app source
COPY . .

# Expose the port the app runs on
# 애플리케이션이 사용하는 포트를 명시합니다. 기본적으로 8080을 사용하지만,
# 실제 애플리케이션 포트와 일치시켜야 합니다. .env 파일이나 설정 파일을 확인하세요.
EXPOSE 8080

# Define the command to run the app
# package.json의 "start" 스크립트를 실행하는 것이 일반적입니다.
# 필요에 따라 ["node", "src/server.js"] 와 같이 직접 실행 명령을 지정할 수도 있습니다.
CMD [ "npm", "start" ]