// src/services/crawler/band.js
const BandAuth = require("./band.auth");
const BandPosts = require("./band.posts");
const BandComments = require("./band.comments");
const utils = require("./band.utils");

/**
 * 기존 인터페이스와의 호환성을 위한 BandCrawler 클래스
 */
class BandCrawler extends BandComments {
  constructor(bandNumber, options = {}) {
    super(bandNumber, options);
  }
}

// 모든 모듈 내보내기
module.exports = {
  BandCrawler, // 기존 코드와의 호환성 유지
  BandAuth, // 인증 관련 기능
  BandPosts, // 게시물 관련 기능
  BandComments, // 댓글 관련 기능
  utils, // 유틸리티 함수
};
