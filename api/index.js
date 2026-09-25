const { app } = require('../server');

module.exports = (req, res) => {
  // 1. Nếu là webhook SePay bị Vercel cắt mất /api thì khôi phục lại
  if (req.url.startsWith('/sepay-webhook')) {
    req.url = '/api' + req.url;
  }

  // 2. Chuyển toàn bộ request cho Express xử lý đúng route gốc
  return app(req, res);
};