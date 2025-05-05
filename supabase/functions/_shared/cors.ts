// supabase/functions/_shared/cors.ts

const allowOrigin = Deno.env.get("CORS_ORIGIN") || "*"; // 환경 변수 또는 기본값 '*'

// 기본 CORS 헤더
export const baseCorsHeaders = {
  "Access-Control-Allow-Origin": allowOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// 메소드별 헤더 생성 함수
export function createCorsHeaders(
  allowedMethods: string[] = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ]
) {
  return {
    ...baseCorsHeaders,
    "Access-Control-Allow-Methods": allowedMethods.join(", "),
  };
}

// 자주 사용하는 메소드 조합
export const corsHeadersGet = createCorsHeaders(["GET", "OPTIONS"]);
export const corsHeadersPost = createCorsHeaders(["POST", "OPTIONS"]);
export const corsHeadersPutPatch = createCorsHeaders([
  "PUT",
  "PATCH",
  "OPTIONS",
]);
export const corsHeadersDelete = createCorsHeaders(["DELETE", "OPTIONS"]);

// 모든 응답에 기본적으로 추가할 헤더 (Content-Type 포함)
export function createJsonResponseHeaders(
  methodHeaders: Record<string, string>
) {
  return {
    ...methodHeaders, // GET, POST 등 메소드별 CORS 헤더
    "Content-Type": "application/json", // JSON 응답 타입 명시
  };
}
