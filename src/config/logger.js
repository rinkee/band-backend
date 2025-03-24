const winston = require("winston");
const path = require("path");

// 로그 파일 저장 경로
const LOG_DIR = path.join(__dirname, "../../logs");

// 로그 레벨
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// 로그 레벨 선택 (개발/프로덕션)
const level = () => {
  const env = process.env.NODE_ENV || "development";
  return env === "production" ? "warn" : "debug";
};

// 로그 포맷 설정
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, service }) => {
    return `[${timestamp}] ${level.toUpperCase()} [${
      service || "app"
    }]: ${message}`;
  })
);

// 로거 생성
const logger = winston.createLogger({
  level: level(),
  levels,
  defaultMeta: { service: "app" },
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports: [
    // 파일 출력 (error)
    new winston.transports.File({
      filename: path.join(LOG_DIR, "error.log"),
      level: "error",
      format: logFormat,
    }),
    // 파일 출력 (combined)
    new winston.transports.File({
      filename: path.join(LOG_DIR, "combined.log"),
      format: logFormat,
    }),
    // 크롤러 전용 로그
    new winston.transports.File({
      filename: path.join(LOG_DIR, "crawler.log"),
      level: "info",
      format: logFormat,
    }),
  ],
  // 예외 및 거부 처리
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(LOG_DIR, "exceptions.log"),
      format: logFormat,
    }),
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(LOG_DIR, "rejections.log"),
      format: logFormat,
    }),
  ],
});

// 개발 환경에서는 콘솔에도 출력
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    })
  );
}

module.exports = logger;
