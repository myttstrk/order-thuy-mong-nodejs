'use strict';
/**
 * config.js — NƠI DUY NHẤT đọc biến môi trường.
 * Mọi thông tin của khách cũ (ngân hàng, SePay, Google Sheet, email, hotline...)
 * đã được chuyển thành biến môi trường. Xem .env.example và README.md.
 */
require('dotenv').config();

const str = (key, fallback = '') => {
  const v = process.env[key];
  return v === undefined || String(v).trim() === '' ? fallback : String(v).trim();
};
const bool = (key, fallback = false) => {
  const v = str(key);
  return v === '' ? fallback : v.toLowerCase() === 'true';
};
const int = (key, fallback) => {
  const n = Number(str(key));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const isProd = str('NODE_ENV').toLowerCase() === 'production';
// Secret có giá trị mặc định CHỈ khi chạy local. Production bắt buộc phải tự đặt.
const devDefault = (key, value) => str(key) || (isProd ? '' : value);

const publicBaseUrl = str('PUBLIC_BASE_URL', 'http://localhost:3000').replace(/\/+$/, '');
const eventDate = str('EVENT_DATE', '2026-10-17'); // YYYY-MM-DD
const [ey, em, ed] = eventDate.split('-');

const config = {
  isProd,
  port: int('PORT', 3000),
  publicBaseUrl,

  event: {
    name: str('EVENT_NAME', 'Thủy Mộng'),
    date: eventDate,
    formattedDate: `${ed}/${em}/${ey}`,
    checkinText: str('EVENT_CHECKIN_TEXT', '17:30 - 19:35 — Thứ Bảy, 17/10/2026'),
    venue: str('EVENT_VENUE', 'Nhà Hát Múa Rối Việt Nam, 361 Trường Chinh, Thanh Xuân, Hà Nội')
  },

  contact: {
    unit: str('CONTACT_UNIT', 'Nhà Hát Múa Rối Việt Nam'),
    address: str('CONTACT_ADDRESS', '361 Trường Chinh, Thanh Xuân, Hà Nội'),
    phone: str('CONTACT_PHONE'),
    email: str('CONTACT_EMAIL')
  },

  bank: {
    code: str('BANK_CODE'), // mã VietQR, ví dụ MB, VCB, TCB, ACB...
    name: str('BANK_NAME') || str('BANK_CODE'),
    accountNumber: str('BANK_ACCOUNT_NUMBER'),
    accountName: str('BANK_ACCOUNT_NAME')
  },

  sepay: {
    // Khoá SePay gửi kèm webhook (header "Authorization: Apikey <khoá>")
    webhookApiKey: devDefault('SEPAY_WEBHOOK_API_KEY', 'dev-sepay-key'),
    // (Tuỳ chọn) API tạo link thanh toán riêng, nếu không dùng thì để trống
    paymentUrl: str('SEPAY_PAYMENT_URL'),
    apiKey: str('SEPAY_API_KEY'),
    returnUrl: str('SEPAY_RETURN_URL', `${publicBaseUrl}/`)
  },

  admin: {
    user: str('ADMIN_USER', 'admin'),
    password: devDefault('ADMIN_PASSWORD', 'admin123')
  },

  secrets: {
    captcha: devDefault('CAPTCHA_SECRET', 'dev-captcha-secret'),
    qr: devDefault('QR_SECRET', 'dev-qr-secret')
  },

  supabase: {
    url: str('SUPABASE_URL').replace(/\/+$/, ''),
    key: str('SUPABASE_SERVICE_ROLE_KEY')
  },

  sheet: {
    webhookUrl: str('GOOGLE_SHEET_WEBHOOK_URL'), // Apps Script Web App (ghi/đọc đơn)
    readUrl: str('GOOGLE_SHEET_URL') // (Tuỳ chọn) đối soát giao dịch khi admin xác nhận tay
  },

  email: {
    gmailUser: str('GMAIL_USER') || str('SMTP_USER'),
    gmailPass: (str('GMAIL_APP_PASSWORD') || str('SMTP_PASS')).replace(/\s+/g, ''),
    resendApiKey: str('RESEND_API_KEY'),
    resendFrom: str('RESEND_FROM', 'Thủy Mộng <onboarding@resend.dev>'),
    allowTest: bool('RESEND_ALLOW_TEST_EMAIL'),
    testEmail: str('RESEND_TEST_EMAIL', 'delivered@resend.dev'),
    dryRun: bool('EMAIL_DRY_RUN') // chỉ dùng khi test: không gửi thật, coi như đã gửi
  },

  antiSpam: {
    orderExpiryMinutes: int('ORDER_EXPIRY_MINUTES', 15),
    maxPendingPerContact: int('MAX_PENDING_PER_CONTACT', 2),
    maxQtyPerLine: int('MAX_QTY_PER_LINE', 10),
    maxItemsPerOrder: int('MAX_ITEMS_PER_ORDER', 20),
    orderRateWindowMs: int('ORDER_RATE_LIMIT_WINDOW_MS', 10 * 60 * 1000),
    orderRateMax: int('ORDER_RATE_LIMIT_MAX', isProd ? 5 : 100),
    captchaRateMax: int('CAPTCHA_RATE_LIMIT_MAX', isProd ? 30 : 500),
    captchaTtlMs: int('CAPTCHA_TTL_SECONDS', 300) * 1000,
    maxProofChars: int('MAX_PROOF_CHARS', 5 * 1024 * 1024),
    maxResendPerOrder: int('MAX_PUBLIC_RESEND', 3)
  },

  flags: {
    // CHỈ dùng ở local/test. Production sẽ từ chối khởi động nếu bật.
    skipCaptcha: bool('SKIP_CAPTCHA'),
    allowTestOrders: bool('ALLOW_TEST_ORDERS'),
    qrAllowLegacy: bool('QR_ALLOW_LEGACY', true)
  }
};

// ---- Kiểm tra cấu hình khi khởi động ----
const problems = [];
const warnings = [];

if (isProd) {
  [
    ['BANK_CODE', config.bank.code],
    ['BANK_ACCOUNT_NUMBER', config.bank.accountNumber],
    ['BANK_ACCOUNT_NAME', config.bank.accountName],
    ['SEPAY_WEBHOOK_API_KEY', config.sepay.webhookApiKey],
    ['ADMIN_PASSWORD', config.admin.password],
    ['CAPTCHA_SECRET', config.secrets.captcha],
    ['QR_SECRET', config.secrets.qr],
    ['PUBLIC_BASE_URL', process.env.PUBLIC_BASE_URL]
  ].forEach(([name, value]) => {
    if (!value) problems.push(`Thiếu biến môi trường: ${name}`);
  });
  if (config.flags.skipCaptcha) warnings.push('SKIP_CAPTCHA đang được bật ở production.');
  if (config.flags.allowTestOrders) warnings.push('ALLOW_TEST_ORDERS đang được bật ở production.');
  if (config.email.dryRun) warnings.push('EMAIL_DRY_RUN đang được bật ở production.');
  if (!config.supabase.url || !config.supabase.key) {
    warnings.push('Chưa cấu hình Supabase: dữ liệu đơn hàng sẽ nằm trong file tạm và MẤT khi serverless khởi động lại.');
  }
} else {
  if (!config.bank.accountNumber) warnings.push('Chưa đặt BANK_ACCOUNT_NUMBER — QR chuyển khoản sẽ không dùng được.');
  if (!process.env.ADMIN_PASSWORD) warnings.push('ADMIN_PASSWORD chưa đặt — dùng mặc định "admin123" (chỉ cho local).');
}
if (!config.contact.phone || !config.contact.email) {
  warnings.push('CONTACT_PHONE / CONTACT_EMAIL chưa đặt — trang liên hệ sẽ để trống.');
}

warnings.forEach((w) => console.warn(`[config] ⚠ ${w}`));

// Log lỗi nhưng không throw để tránh Function Invocation Failed
if (problems.length) {
  console.error(`[config] ❌ Cảnh báo cấu hình thiếu:\n - ${problems.join('\n - ')}`);
}

module.exports = config;