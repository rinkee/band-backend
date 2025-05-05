// supabase/functions/_shared/jwt.ts
import {
  create,
  verify,
  getNumericDate,
  Header,
} from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const JWT_SECRET = Deno.env.get("JWT_SECRET"); // 환경 변수에서 시크릿 키 가져오기
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is not set!");
}

// HMAC-SHA256을 위한 키 생성
async function getKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false, // non-extractable
    ["sign", "verify"] // key usage
  );
}

const key = await getKey();
const header: Header = { alg: "HS256", typ: "JWT" };

// JWT 생성 함수
export async function generateToken(
  payload: Record<string, unknown>,
  expiresInSeconds: number = 3600 * 24 * 7
): Promise<string> {
  // 기본 7일
  const now = Math.floor(Date.now() / 1000);
  const jwtPayload = {
    ...payload,
    iss: "your-issuer-name", // 발급자 설정 (선택 사항)
    iat: now, // 발급 시간
    exp: now + expiresInSeconds, // 만료 시간
  };
  return await create(header, jwtPayload, key);
}

// JWT 검증 함수
export async function verifyToken(
  token: string
): Promise<Record<string, unknown> | null> {
  try {
    return await verify(token, key);
  } catch (error) {
    console.error("JWT verification failed:", error.message);
    return null; // 검증 실패 시 null 반환
  }
}
