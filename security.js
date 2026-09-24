'use strict';
const crypto = require('crypto');
const config = require('./config');

const safeEqual = (a, b) => {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

/* ------------------------------------------------------------------ */
/* Rate limiter (in-memory).                                           */
/* Lưu ý: trên Vercel mỗi instance có bộ nhớ riêng → đây là lớp chặn  */
/* cơ bản; lớp chặn chính là captcha + giới hạn đơn chờ theo SĐT/email */
/* + Vercel Firewall (xem README).                                     */
/* ------------------------------------------------------------------ */
function createLimiter({ windowMs, max }) {
  const store = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, hits] of store) {
      const recent = hits.filter((t) => now - t < windowMs);
      if (recent.length) store.set(key, recent);
      else store.delete(key);
    }
  }, Math.min(windowMs, 60000));
  if (timer.unref) timer.unref();

  return {
    // Trả về null nếu được phép, hoặc số giây phải chờ nếu bị chặn
    hit(key) {
      const now = Date.now();
      const recent = (store.get(key) || []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        return Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
      }
      recent.push(now);
      store.set(key, recent);
      return null;
    },
    reset() {
      store.clear();
    }
  };
}

function limiterMiddleware(limiter, message) {
  return (req, res, next) => {
    const wait = limiter.hit(req.ip || 'unknown');
    if (wait) {
      res.set('Retry-After', String(wait));
      return res.status(429).json({ message: message || 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' });
    }
    return next();
  };
}

/* ------------------------------------------------------------------ */
/* Captcha: có hạn dùng, gắn với đáp án, chỉ dùng 1 lần.               */
/* ------------------------------------------------------------------ */
const usedCaptcha = new Map(); // token -> exp

function purgeCaptcha() {
  const now = Date.now();
  for (const [token, exp] of usedCaptcha) {
    if (exp < now) usedCaptcha.delete(token);
  }
}

function createCaptcha() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let text = '';
  for (let i = 0; i < 5; i++) text += chars[crypto.randomInt(chars.length)];

  const exp = Date.now() + config.antiSpam.captchaTtlMs;
  const nonce = crypto.randomBytes(8).toString('hex');
  const token = `${exp}.${nonce}.${hmac(config.secrets.captcha, `captcha|${exp}|${nonce}|${text}`)}`;

  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="50"><rect width="100%" height="100%" fill="#2c2c2c"/>';
  for (let i = 0; i < 5; i++) {
    const x = 20 + i * 24 + crypto.randomInt(6);
    const y = 32 + crypto.randomInt(6);
    const rot = crypto.randomInt(40) - 20;
    svg += `<text x="${x}" y="${y}" transform="rotate(${rot} ${x} ${y})" fill="#f1c66b" font-size="26" font-family="sans-serif" font-weight="bold">${text[i]}</text>`;
  }
  for (let i = 0; i < 10; i++) {
    svg += `<line x1="${crypto.randomInt(160)}" y1="${crypto.randomInt(50)}" x2="${crypto.randomInt(160)}" y2="${crypto.randomInt(50)}" stroke="#f1c66b" stroke-width="2" opacity="0.6"/>`;
  }
  svg += '</svg>';

  return { token, image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` };
}

// Kiểm tra đúng/sai nhưng CHƯA tiêu thụ (để lỗi nhập form không làm mất captcha)
function checkCaptcha(token, answer) {
  purgeCaptcha();
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  const [exp, nonce, sig] = parts;
  if (!/^\d+$/.test(exp) || Date.now() > Number(exp)) return false;
  if (usedCaptcha.has(token)) return false;
  const expected = hmac(config.secrets.captcha, `captcha|${exp}|${nonce}|${String(answer || '').trim().toUpperCase()}`);
  return safeEqual(expected, sig);
}

// Tiêu thụ token — trả false nếu đã bị dùng (chặn 2 request song song dùng chung 1 captcha)
function consumeCaptcha(token) {
  if (usedCaptcha.has(token)) return false;
  const exp = Number(String(token).split('.')[0]) || Date.now() + config.antiSpam.captchaTtlMs;
  usedCaptcha.set(token, exp);
  return true;
}

/* ------------------------------------------------------------------ */
/* Admin auth: HTTP Basic (trình duyệt nhớ, admin.html không cần sửa)  */
/* ------------------------------------------------------------------ */
const adminFailLimiter = createLimiter({ windowMs: 10 * 60 * 1000, max: 10 });

function adminAuth(req, res, next) {
  const header = String(req.headers.authorization || '');
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const user = idx >= 0 ? decoded.slice(0, idx) : '';
    const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
    if (safeEqual(user, config.admin.user) && safeEqual(pass, config.admin.password)) {
      return next();
    }
  }
  const wait = adminFailLimiter.hit(req.ip || 'unknown');
  if (wait) {
    res.set('Retry-After', String(wait));
    return res.status(429).json({ message: 'Sai thông tin quá nhiều lần. Thử lại sau.' });
  }
  res.set('WWW-Authenticate', 'Basic realm="Admin", charset="UTF-8"');
  return res.status(401).json({ message: 'Cần đăng nhập admin.' });
}

/* ------------------------------------------------------------------ */
/* SePay webhook auth: header "Authorization: Apikey <khoá>"           */
/* Không có/sai khoá → từ chối (KHÔNG fail-open như bản cũ).           */
/* ------------------------------------------------------------------ */
function verifySePayRequest(req) {
  const auth = String(req.headers.authorization || '');
  const match = auth.match(/^Apikey\s+(.+)$/i);
  const provided = match ? match[1].trim() : String(req.headers['x-api-key'] || '').trim();
  return Boolean(provided) && safeEqual(provided, config.sepay.webhookApiKey);
}

/* ------------------------------------------------------------------ */
/* QR check-in có chữ ký: THUY_MONG|<orderCode>|<sig>                  */
/* Không còn chứa tên/email khách; không thể tự tạo QR giả.            */
/* ------------------------------------------------------------------ */
const signOrderCode = (orderCode) =>
  hmac(config.secrets.qr, `qr|${orderCode}`).slice(0, 16).toUpperCase();

function buildQrPayload(order) {
  return `THUY_MONG|${order.orderCode}|${signOrderCode(order.orderCode)}`;
}

function decodeQrPayload(raw) {
  if (typeof raw !== 'string') return null;
  const parts = raw.trim().split('|');
  if (parts[0] !== 'THUY_MONG' || !parts[1]) return null;
  if (parts.length === 3) {
    return safeEqual(parts[2], signOrderCode(parts[1])) ? parts[1] : null;
  }
  // Vé cũ (THUY_MONG|code|email|name|createdAt) đã phát hành trước khi nâng cấp
  if (config.flags.qrAllowLegacy && parts.length === 5) return parts[1];
  return null;
}

module.exports = {
  createLimiter,
  limiterMiddleware,
  createCaptcha,
  checkCaptcha,
  consumeCaptcha,
  adminAuth,
  verifySePayRequest,
  buildQrPayload,
  decodeQrPayload,
  safeEqual
};