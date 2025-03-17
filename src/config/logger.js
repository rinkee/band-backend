const winston = require("winston");
const path = require("path");

// 로그 파일 저장 경로
const LOG_DIR = path.join(__dirname, "../../logs");

// 로그 포맷 설정
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message }) => {
    return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
  })
);

// 로거 생성
const logger = winston.createLogger({
  format: logFormat,
  transports: [
    // 콘솔 출력
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), logFormat),
    }),
    // 파일 출력 (error)
    new winston.transports.File({
      filename: path.join(LOG_DIR, "error.log"),
      level: "error",
    }),
    // 파일 출력 (combined)
    new winston.transports.File({
      filename: path.join(LOG_DIR, "combined.log"),
    }),
    // 크롤러 전용 로그
    new winston.transports.File({
      filename: path.join(LOG_DIR, "crawler.log"),
      level: "info",
    }),
  ],
});

// 개발 환경에서는 더 자세한 로깅
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
