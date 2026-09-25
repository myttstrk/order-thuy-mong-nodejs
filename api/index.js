const { app } = require('../server');

module.exports = (req, res) => {
  // Nếu Vercel cắt mất prefix /api, gắn lại để khớp route trong Express
  if (!req.url.startsWith('/api') && !req.url.startsWith('/public') && !req.url.startsWith('/assets')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  return app(req, res);
};