// 테스트 파일
import { corsHeadersGet, createJsonResponseHeaders } from "../_shared/cors.ts"; 
const responseHeaders = createJsonResponseHeaders(corsHeadersGet);

Deno.serve(async (req) => {
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: responseHeaders });
});
