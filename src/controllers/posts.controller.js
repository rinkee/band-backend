// src/controllers/posts.controller.js - 게시글 관련 컨트롤러
const { createClient } = require("@supabase/supabase-js");
const logger = require("../config/logger");

// Supabase 클라이언트 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * 게시글 목록 조회
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getAllPosts = async (req, res) => {
  try {
    const { bandId } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const startIndex = (page - 1) * limit;
    const sortBy = req.query.sortBy || "posted_at";
    const sortOrder = req.query.sortOrder === "asc" ? true : false;

    if (!bandId) {
      return res.status(400).json({
        success: false,
        message: "밴드 ID가 필요합니다.",
      });
    }

    // 게시글 목록 조회 쿼리
    let query = supabase
      .from("posts")
      .select(
        `
        *
      `,
        { count: "exact" }
      )
      .eq("band_id", bandId)
      .order(sortBy, { ascending: sortOrder })
      .range(startIndex, startIndex + limit - 1);

    // 필터링 조건 추가
    if (req.query.status && req.query.status !== "undefined") {
      query = query.eq("status", req.query.status);
    }

    if (req.query.search && req.query.search !== "undefined") {
      query = query.ilike("title", `%${req.query.search}%`);
    }

    if (req.query.startDate && req.query.endDate) {
      query = query
        .gte("posted_at", req.query.startDate)
        .lte("posted_at", req.query.endDate);
    }

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    // 전체 페이지 수 계산
    const totalPages = Math.ceil(count / limit);

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        total: count,
        totalPages,
        currentPage: page,
        limit,
      },
    });
  } catch (error) {
    logger.error("게시글 목록 조회 오류:", error);
    return res.status(500).json({
      success: false,
      message: "게시글 목록을 불러오는 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 특정 게시글 정보 조회
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const getPostById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "게시글 ID가 필요합니다.",
      });
    }

    const { data, error } = await supabase
      .from("posts")
      .select(`*`)
      .eq("post_id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          message: "해당 ID의 게시글을 찾을 수 없습니다.",
        });
      }
      throw error;
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    logger.error(`게시글 정보 조회 오류 (ID: ${req.params.id}):`, error);
    return res.status(500).json({
      success: false,
      message: "게시글 정보를 불러오는 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 게시글 상태 업데이트
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const updatePostStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!id || !status) {
      return res.status(400).json({
        success: false,
        message: "게시글 ID와 상태 정보가 필요합니다.",
      });
    }

    const updateData = {
      status,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("posts")
      .update(updateData)
      .eq("post_id", id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return res.status(200).json({
      success: true,
      message: "게시글 상태가 업데이트되었습니다.",
      data,
    });
  } catch (error) {
    logger.error(`게시글 상태 업데이트 오류 (ID: ${req.params.id}):`, error);
    return res.status(500).json({
      success: false,
      message: "게시글 상태 업데이트 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

/**
 * 게시글 삭제
 * @param {Object} req - 요청 객체
 * @param {Object} res - 응답 객체
 */
const deletePost = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "게시글 ID가 필요합니다.",
      });
    }

    // 게시글 삭제
    const { error } = await supabase.from("posts").delete().eq("post_id", id);

    if (error) {
      throw error;
    }

    return res.status(200).json({
      success: true,
      message: "게시글이 삭제되었습니다.",
    });
  } catch (error) {
    logger.error(`게시글 삭제 오류 (ID: ${req.params.id}):`, error);
    return res.status(500).json({
      success: false,
      message: "게시글 삭제 중 오류가 발생했습니다.",
      error: error.message,
    });
  }
};

module.exports = {
  getAllPosts,
  getPostById,
  updatePostStatus,
  deletePost,
};
