const { createClient } = require("@supabase/supabase-js");
const logger = require("./logger");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase URL과 Key가 환경변수에 설정되지 않았습니다.");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Supabase 연결 테스트
const testConnection = async () => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("count")
      .limit(1);
    if (error) throw error;
    logger.info("Supabase 연결 성공");
    return true;
  } catch (error) {
    logger.error("Supabase 연결 실패:", error.message);
    return false;
  }
};

module.exports = {
  supabase,
  testConnection,
};
