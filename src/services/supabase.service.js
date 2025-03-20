const { createClient } = require("@supabase/supabase-js");
const logger = require("../config/logger");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Supabase 클라이언트 가져오기
const getSupabase = () => {
  return supabase;
};

// 사용자 참조 가져오기
async function getUserById(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) {
    logger.error(`사용자 조회 오류 (${userId}):`, error);
    throw error;
  }

  return data;
}

// 상품 참조 가져오기
async function getProductsByUserId(userId) {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    logger.error(`상품 조회 오류 (${userId}):`, error);
    throw error;
  }

  return data;
}

// 특정 상품 참조 가져오기
async function getProductById(productId) {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .single();

  if (error) {
    logger.error(`상품 조회 오류 (${productId}):`, error);
    throw error;
  }

  return data;
}

// 주문 참조 가져오기
async function getOrdersByUserId(userId) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    logger.error(`주문 조회 오류 (${userId}):`, error);
    throw error;
  }

  return data;
}

// 특정 상품의 주문 참조 가져오기
async function getOrdersByProductId(productId) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("product_id", productId);

  if (error) {
    logger.error(`상품 주문 조회 오류 (${productId}):`, error);
    throw error;
  }

  return data;
}

module.exports = {
  getSupabase,
  getUserById,
  getProductsByUserId,
  getProductById,
  getOrdersByUserId,
  getOrdersByProductId,
};
