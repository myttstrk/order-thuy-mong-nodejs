'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dns = require('dns').promises;
const config = require('./config');
const sec = require('./security');

let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (_) {}

const app = express();
app.set('trust proxy', 1); // Vercel/nginx: req.ip lấy đúng IP client, không tin header tự gửi
app.disable('x-powered-by');

/* ================================================================== */
/* 1. LƯU TRỮ (file local + Supabase)                                  */
/* ================================================================== */
const DATA_DIR = process.env.VERCEL ? path.join('/tmp', 'thuy-mong-data') : path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const BUNDLED_ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');
const BUNDLED_ITEMS_FILE = path.join(__dirname, 'data', 'items.json');
const MAX_STORED_ORDERS = 700;

fs.mkdirSync(DATA_DIR, { recursive: true });
function ensureDataFile(target, bundled) {
  if (fs.existsSync(target)) return;
  try {
    if (fs.existsSync(bundled)) return fs.copyFileSync(bundled, target);
  } catch (_) {}
  fs.writeFileSync(target, '[]', 'utf8');
}
ensureDataFile(ORDERS_FILE, BUNDLED_ORDERS_FILE);
ensureDataFile(ITEMS_FILE, BUNDLED_ITEMS_FILE);

function readItems() {
  try {
    return JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf8')) || [];
  } catch (error) {
    console.error('Error reading items:', error.message);
    return [];
  }
}

function saveItems(items) {
  try {
    fs.writeFileSync(ITEMS_FILE, JSON.stringify(items, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving items:', error.message);
    return false;
  }
}

function readOrders() {
  try {
    return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')) || [];
  } catch (_) {
    return [];
  }
}

function writeOrders(orders) {
  const limited = Array.isArray(orders) ? orders.slice(-MAX_STORED_ORDERS) : [];
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(limited, null, 2), 'utf8');
}

function findOrderByCode(code) {
  return readOrders().find((o) => o.orderCode === code) || null;
}

function saveOrder(order) {
  const orders = readOrders();
  const index = orders.findIndex((o) => o.orderCode === order.orderCode);
  if (index >= 0) orders[index] = order;
  else orders.push(order);
  writeOrders(orders);
  return order;
}

const supabaseEnabled = Boolean(config.supabase.url && config.supabase.key);

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function supabaseRequest(pathname, options = {}, timeoutMs = 4000) {
  const response = await fetchWithTimeout(`${config.supabase.url}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: config.supabase.key,
      Authorization: `Bearer ${config.supabase.key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  }, timeoutMs);

  if (!response.ok) {
    throw new Error(`Supabase API error: ${response.status} ${await response.text()}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function readOrdersPersistent(limit = 500) {
  const local = readOrders();
  if (!supabaseEnabled) return local;
  try {
    const rows = await supabaseRequest(`orders?select=order_data&order=created_at.desc&limit=${limit}`, {}, 4000);
    const remote = Array.isArray(rows) ? rows.map((r) => r.order_data).filter(Boolean) : [];
    return remote.length ? remote : local;
  } catch (error) {
    console.warn('Supabase read failed, fallback to local store:', error.message);
    return local;
  }
}

async function findOrderPersistent(orderCode) {
  const local = findOrderByCode(orderCode);
  if (!supabaseEnabled) return local;
  try {
    const rows = await supabaseRequest(`orders?order_code=eq.${encodeURIComponent(orderCode)}&select=order_data&limit=1`, {}, 2500);
    return rows?.[0]?.order_data || local;
  } catch (error) {
    console.warn('Supabase lookup failed, falling back to local file store:', error.message);
    return local;
  }
}

async function saveOrderPersistent(order) {
  const local = saveOrder(order);
  if (!supabaseEnabled) return local;
  try {
    await supabaseRequest('orders?on_conflict=order_code', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ order_code: order.orderCode, order_data: order, updated_at: new Date().toISOString() })
    }, 3000);
  } catch (error) {
    console.warn('Supabase save failed, kept in local file store:', error.message);
  }
  return order;
}

async function deleteOrderPersistent(orderCode) {
  const orders = readOrders();
  const index = orders.findIndex((o) => o.orderCode === orderCode);
  if (index !== -1) {
    orders.splice(index, 1);
    writeOrders(orders);
  }
  if (supabaseEnabled) {
    try {
      await supabaseRequest(`orders?order_code=eq.${encodeURIComponent(orderCode)}`, { method: 'DELETE' });
    } catch (err) {
      console.warn('Supabase delete order failed:', err.message);
    }
  }
}

/* Idempotency-Key: chặn tạo đơn trùng khi client retry do timeout/mất mạng.
   Best-effort trong bộ nhớ (giống orderLimiter/locks) — trên Vercel serverless mỗi instance
   có bộ nhớ riêng nên không chặn được 100% giữa các instance khác nhau, nhưng vẫn hữu ích
   cho phần lớn trường hợp double-click / client tự động retry trên cùng 1 lambda ấm.
   Lớp chống trùng "chắc" hơn (qua Supabase) là bước 7 (sameContactPending) bên dưới. */
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 phút
const IDEMPOTENCY_MAX_ENTRIES = 5000; // giới hạn bộ nhớ, tránh phình vô hạn
const idempotencyCache = new Map(); // key -> { status, body, expiresAt }

function getIdempotentResponse(key) {
  if (!key) return null;
  const entry = idempotencyCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    idempotencyCache.delete(key);
    return null;
  }
  return entry;
}

function setIdempotentResponse(key, status, body) {
  if (!key) return;
  if (idempotencyCache.size >= IDEMPOTENCY_MAX_ENTRIES) idempotencyCache.clear(); // an toàn bộ nhớ, hiếm khi chạm tới với quy mô 1 sự kiện
  idempotencyCache.set(key, { status, body, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
}

/* Khoá theo đơn hàng: chặn xử lý song song (webhook lặp, quét QR 2 lần cùng lúc) */
const locks = new Map();
async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = prev.then(() => gate);
  locks.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}

/* ================================================================== */
/* 2. GOOGLE SHEET (tuỳ chọn)                                          */
/* ================================================================== */
async function pushOrderToSheet(order, timeoutMs = 8000) {
  if (!config.sheet.webhookUrl) return;
  try {
    await fetchWithTimeout(config.sheet.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order)
    }, timeoutMs);
  } catch (err) {
    console.error('Lỗi gửi dữ liệu về Sheet:', err.message);
  }
}

async function readGoogleSheetTransactions() {
  if (!config.sheet.readUrl) return [];
  try {
    const response = await fetchWithTimeout(config.sheet.readUrl, { method: 'GET' }, 12000);
    if (!response.ok) return [];
    const text = await response.text();
    if (!text || /<\/?html|<!doctype\s+html/i.test(text)) return [];

    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    if (Array.isArray(json)) return json.map(normalizeSheetRecord);
    if (json && Array.isArray(json.values)) {
      return json.values.slice(1).map((row) => normalizeSheetRecord({
        orderCode: row[0], amount: row[1], transferContent: row[2], status: row[3]
      }));
    }
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const headers = lines[0].split(',').map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const cells = line.split(',');
      const row = {};
      headers.forEach((h, i) => { row[h] = cells[i] || ''; });
      return normalizeSheetRecord(row);
    });
  } catch (error) {
    console.warn('Google Sheet verification unavailable:', error.message);
    return [];
  }
}

function normalizeSheetRecord(row = {}) {
  const v = row && typeof row === 'object' ? row : {};
  return {
    orderCode: String(v.orderCode || v.order_code || v['Mã đơn'] || v.reference || v.content || v.transferContent || v['Nội dung'] || '').trim(),
    amount: Number(v.amount ?? v.total ?? v['Số tiền'] ?? v.transferAmount ?? 0),
    content: String(v.transferContent || v['Nội dung'] || v.content || v.description || '').trim()
  };
}

async function findGoogleSheetMatch(orderCode, amount) {
  if (!config.sheet.readUrl) return null;
  const rows = await readGoogleSheetTransactions();
  const code = String(orderCode || '').trim();
  const row = rows.find((r) => code && (r.orderCode === code || r.content.includes(code) || r.orderCode.includes(code)));
  if (!row) return null;
  if (amount && row.amount && Number(row.amount) !== Number(amount)) {
    return { matched: false, reason: 'amount-mismatch', row };
  }
  return { matched: true, row };
}

/* ================================================================== */
/* 3. NGHIỆP VỤ ĐƠN HÀNG                                               */
/* ================================================================== */
const PENDING = 'Chờ thanh toán';
const PAID = 'Đã thanh toán';
const EXPIRED = 'Hết hạn';

// Không dùng dấu "-" vì nhiều ngân hàng loại bỏ ký tự đặc biệt trong nội dung chuyển khoản
function generateOrderCode() {
  return `TM${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtVnd = (n) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);

function isOrderExpired(order) {
  if (!order || order.status === PAID || order.status === EXPIRED) return false;
  const expiresAt = order.expiresAt ? new Date(order.expiresAt).getTime() : null;
  return Boolean(expiresAt) && Date.now() > expiresAt;
}

function normalizeOrderStatus(order) {
  if (!order) return PENDING;
  if (isOrderExpired(order)) return EXPIRED;
  return order.status || PENDING;
}

function isPendingActive(order) {
  return normalizeOrderStatus(order) === PENDING;
}

function getOrderSummary(orders) {
  return {
    totalRevenue: orders.filter((o) => o.status === PAID).reduce((s, o) => s + Number(o.total || 0), 0),
    totalOrders: orders.length,
    paidOrders: orders.filter((o) => o.status === PAID).length,
    pendingOrders: orders.filter((o) => normalizeOrderStatus(o) === PENDING).length,
    expiredOrders: orders.filter((o) => normalizeOrderStatus(o) === EXPIRED).length,
    usedTickets: orders.filter((o) => o.ticketStatus === 'Đã sử dụng').length
  };
}

/* ---- Tồn kho (chỉ tính đơn ĐÃ THANH TOÁN → đơn rác không giữ chỗ được) ---- */
let inventoryCache = null;
let inventoryCacheTime = 0;
const invalidateInventory = () => { inventoryCacheTime = 0; };

async function getInventory() {
  const now = Date.now();
  if (inventoryCache && now - inventoryCacheTime < 60000) return inventoryCache;

  let orders = readOrders();
  if (supabaseEnabled) {
    try {
      const rows = await supabaseRequest('orders?select=order_data', {}, 4000);
      if (Array.isArray(rows)) orders = rows.map((r) => r.order_data).filter(Boolean);
    } catch (e) {
      console.warn('Error fetching remote orders for inventory:', e.message);
    }
  }

  const sold = {};
  orders.forEach((order) => {
    if (order.status === PAID && Array.isArray(order.items)) {
      order.items.forEach((it) => {
        sold[it.id] = (sold[it.id] || 0) + (Number(it.quantity) || 0);
      });
    }
  });
  inventoryCache = sold;
  inventoryCacheTime = now;
  return sold;
}

function withAvailability(item, sold) {
  const copy = { ...item };
  if (copy.baseQuantity !== undefined) {
    copy.quantity = Math.max(0, Number(copy.baseQuantity) - (sold[copy.id] || 0));
  }
  return copy;
}

/* ---- Giá & giỏ hàng: CHỈ tin danh mục trên server, bỏ qua giá client gửi ---- */
function calculateOrderTotal(items = []) {
  const list = items.map((i) => ({ id: String(i.id || ''), price: Number(i.price) || 0, quantity: Number(i.quantity) || 0, type: String(i.type || 'ticket') }));
  const tickets = list.filter((i) => i.type === 'ticket');
  const merch = list.filter((i) => i.type === 'merch');
  const ticketCount = tickets.reduce((s, i) => s + i.quantity, 0);
  const ids = new Set(tickets.map((i) => i.id));
  const hasValueTicket = ids.has('sao-may') || ids.has('thanh-la') || ids.has('y-mon');
  const hasTuLinh = ids.has('tu-linh');
  const khan = merch.find((i) => i.id === 'khan');
  const combo = merch.find((i) => i.id === 'combo-merch');

  let subtotal = list.reduce((s, i) => s + i.price * i.quantity, 0);
  if (ticketCount >= 4) subtotal -= tickets.reduce((s, i) => s + i.price * i.quantity, 0) * 0.1;
  if ((hasValueTicket || hasTuLinh) && khan) subtotal -= khan.price * khan.quantity * (hasTuLinh ? 0.15 : 0.05);
  if (hasTuLinh && combo) subtotal -= combo.price * combo.quantity;
  return Math.round(Math.max(0, subtotal));
}

function buildTrustedItems(cartItems, sold) {
  const catalog = new Map(readItems().map((i) => [String(i.id), i]));
  const merged = new Map();

  for (const raw of cartItems) {
    const id = String(raw?.id || '');
    const quantity = Math.floor(Number(raw?.quantity));
    if (!id || !Number.isFinite(quantity) || quantity <= 0) {
      return { error: 'Giỏ hàng có mặt hàng không hợp lệ.' };
    }
    merged.set(id, (merged.get(id) || 0) + quantity);
  }
  if (!merged.size) return { error: 'Giỏ hàng trống.' };

  const items = [];
  let totalQty = 0;
  for (const [id, quantity] of merged) {
    const entry = catalog.get(id);
    if (!entry) return { error: 'Mặt hàng không tồn tại hoặc đã ngừng bán.' };
    const price = Number(entry.price);
    if (!Number.isFinite(price) || price < 0) return { error: `Mặt hàng "${entry.name}" chưa có giá hợp lệ.` };
    if (quantity > config.antiSpam.maxQtyPerLine) {
      return { error: `Tối đa ${config.antiSpam.maxQtyPerLine} sản phẩm cho mỗi loại "${entry.name}".` };
    }
    const available = withAvailability(entry, sold).quantity;
    if (available !== undefined && Number.isFinite(Number(available)) && quantity > Number(available)) {
      return { error: `"${entry.name}" chỉ còn ${Math.max(0, Number(available))} sản phẩm.` };
    }
    totalQty += quantity;
    items.push({ id, name: String(entry.name), price, quantity, type: entry.type || 'ticket' });
  }
  if (totalQty > config.antiSpam.maxItemsPerOrder) {
    return { error: `Mỗi đơn tối đa ${config.antiSpam.maxItemsPerOrder} sản phẩm.` };
  }
  return { items };
}

const cartSignature = (items) => items.map((i) => `${i.id}:${i.quantity}`).sort().join(',');

/* ---- QR & thanh toán ---- */
function createQrCodeUrl(order) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(sec.buildQrPayload(order))}`;
}

function createBankPayment(order) {
  const { code, name, accountNumber, accountName } = config.bank;
  const paymentQrUrl = `https://img.vietqr.io/image/${encodeURIComponent(code)}-${encodeURIComponent(accountNumber)}-compact2.png?amount=${order.total}&addInfo=${encodeURIComponent(order.orderCode)}&accountName=${encodeURIComponent(accountName)}`;
  return { provider: 'bank-transfer', bankName: name, accountNumber, accountName, paymentQrUrl, transferContent: order.orderCode };
}

async function createSePayPayment(order) {
  const { paymentUrl, apiKey, returnUrl } = config.sepay;
  const mock = (message) => ({
    provider: 'mock',
    paymentUrl: `${returnUrl}?orderCode=${encodeURIComponent(order.orderCode)}&amount=${order.total}`,
    qrCodeUrl: createBankPayment(order).paymentQrUrl,
    message
  });
  if (!paymentUrl || !apiKey) return mock('SePay payment API chưa cấu hình — dùng QR chuyển khoản.');

  try {
    const response = await fetchWithTimeout(paymentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ orderCode: order.orderCode, amount: order.total, description: order.orderCode, returnUrl })
    }, 8000);
    if (!response.ok) throw new Error(`SePay payment API error: ${response.status}`);
    const data = await response.json();
    return {
      provider: 'sepay',
      paymentUrl: data.paymentUrl || data.url || data.checkoutUrl || data.link || `${returnUrl}?orderCode=${encodeURIComponent(order.orderCode)}`,
      qrCodeUrl: data.qrCodeUrl || data.qr || data.qrcode || createBankPayment(order).paymentQrUrl,
      raw: data
    };
  } catch (error) {
    console.error('SePay payment creation failed:', error.message);
    return mock('SePay API lỗi — dùng QR chuyển khoản.');
  }
}

/* ================================================================== */
/* 4. EMAIL                                                            */
/* ================================================================== */
function resolveResendRecipient(email) {
  const raw = String(email || '').trim().toLowerCase();
  if (!raw) return 'delivered@resend.dev';
  if (raw.includes('example.com') && config.email.allowTest) return config.email.testEmail;
  return raw;
}

async function sendGmailSmtpEmail(order) {
  const { gmailUser, gmailPass } = config.email;
  if (!gmailUser || !gmailPass || !nodemailer) return null;

  const recipient = String(order.customer?.email || '').trim();
  if (!recipient) return { skipped: true, reason: 'Không có email người nhận.' };

  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } });
  const qrCodeUrl = order.qrCodeUrl || createQrCodeUrl(order);
  const attachments = [];
  try {
    const qrResponse = await fetchWithTimeout(qrCodeUrl, {}, 5000);
    if (qrResponse.ok) {
      attachments.push({
        filename: `qr-checkin-${order.orderCode}.png`,
        content: Buffer.from(await qrResponse.arrayBuffer()),
        cid: 'ticket-checkin-qr'
      });
    }
  } catch (err) {
    console.warn('QR attachment download failed:', err.message);
  }

  const itemsList = (order.items || []).map((it) => `${esc(it.name)} x${esc(it.quantity)}`).join(', ');
  const { event, contact } = config;
  const contactLine = [contact.phone && `Hotline: <strong>${esc(contact.phone)}</strong>`, contact.email && `Email: <strong>${esc(contact.email)}</strong>`].filter(Boolean).join(' | ');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #222; line-height: 1.6; border: 1px solid #e8decb; border-radius: 12px; overflow: hidden; background: #ffffff;">
      <div style="background: #071a1d; color: #f6f2ea; padding: 24px; text-align: center;">
        <h1 style="color: #f1c66b; margin: 0 0 6px; font-family: Georgia, serif; letter-spacing: 2px;">${esc(event.name.toUpperCase())}</h1>
        <p style="margin: 0; font-size: 14px; opacity: 0.85;">Vé &amp; QR Check-in Sự Kiện</p>
      </div>
      <div style="padding: 24px;">
        <h2 style="color: #071a1d; margin-top: 0;">Xin chào ${esc(order.customer.name)},</h2>
        <p>Đơn hàng đặt vé sự kiện <strong>${esc(event.name)}</strong> của bạn đã được xác nhận thanh toán thành công.</p>
        <div style="background: #fdfbf7; border: 1px solid #f1e4ce; border-radius: 8px; padding: 16px; margin: 18px 0;">
          <p style="margin: 6px 0;"><strong>Mã đơn hàng:</strong> <span style="font-weight: bold;">${esc(order.orderCode)}</span></p>
          <p style="margin: 6px 0;"><strong>Các mặt hàng:</strong> ${itemsList || '—'}</p>
          <p style="margin: 6px 0;"><strong>Nơi nhận hàng:</strong> ${esc(order.deliveryLocation || 'Nhận tại sự kiện')}</p>
          <p style="margin: 6px 0;"><strong>Tổng tiền:</strong> <span style="color: #c99a61; font-weight: bold;">${esc(fmtVnd(order.total))}</span></p>
          <p style="margin: 6px 0;"><strong>Giờ check in:</strong> ${esc(event.checkinText)}</p>
          <p style="margin: 6px 0;"><strong>Địa điểm:</strong> ${esc(event.venue)}</p>
        </div>
        <div style="text-align: center; margin: 24px 0;">
          <p style="font-weight: bold; margin-bottom: 12px; color: #071a1d;">MÃ QR CHECK-IN VÀO CỬA</p>
          <img src="${attachments.length ? 'cid:ticket-checkin-qr' : esc(qrCodeUrl)}" alt="QR Check-in" style="width: 200px; height: 200px; border: 2px solid #f1c66b; border-radius: 12px; padding: 8px; background: white;" />
          <p style="font-size: 13px; color: #777; margin-top: 8px;">(Vui lòng mang theo email này hoặc lưu ảnh QR đính kèm để check-in tại cửa sự kiện)</p>
        </div>
        ${contactLine ? `<hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" /><p style="font-size: 13px; color: #666; margin: 0;">Mọi thắc mắc vui lòng liên hệ Ban tổ chức:<br />${contactLine}</p>` : ''}
      </div>
    </div>`;

  const info = await transporter.sendMail({
    from: `"${event.name}" <${gmailUser}>`,
    to: recipient,
    subject: `[${event.name}] Vé & QR Check-in sự kiện ngày ${event.formattedDate} - ${order.orderCode}`,
    html,
    attachments
  });
  return { id: info.messageId, provider: 'gmail' };
}

async function sendResendEmail(order) {
  if (config.email.dryRun) return { id: `dry-run-${order.orderCode}`, provider: 'dry-run' };

  const gmailResult = await sendGmailSmtpEmail(order);
  if (gmailResult) return gmailResult;

  const apiKey = config.email.resendApiKey;
  if (!apiKey) {
    console.log('Chưa cấu hình Gmail hay Resend API. Bỏ qua gửi email.');
    return { skipped: true };
  }

  const qrCodeUrl = order.qrCodeUrl || createQrCodeUrl(order);
  const payload = {
    from: config.email.resendFrom,
    to: [resolveResendRecipient(order.customer.email)],
    subject: `Xác nhận đặt vé ${config.event.name} - ${order.orderCode}`,
    html: `
      <h2>Xin chào ${esc(order.customer.name)},</h2>
      <p>Đơn hàng của bạn đã được xác nhận thanh toán thành công.</p>
      <p><strong>Mã đơn hàng:</strong> ${esc(order.orderCode)}</p>
      <p><strong>Nơi nhận hàng:</strong> ${esc(order.deliveryLocation || 'Nhận tại sự kiện')}</p>
      <p><strong>Tổng tiền:</strong> ${esc(fmtVnd(order.total))}</p>
      <p><strong>Sự kiện:</strong> ${esc(config.event.name)} - ${esc(config.event.formattedDate)}</p>
      <p><strong>QR Check-in:</strong></p>
      <img src="cid:checkin-qr" alt="QR Check-in" style="width: 180px; height: 180px;" />
      <p>QR cũng được đính kèm dưới dạng ảnh PNG. Vui lòng mang mã QR này khi đến sự kiện để check-in.</p>
      <p>Trân trọng,<br />Ban tổ chức ${esc(config.event.name)}</p>`
  };

  try {
    const qrResponse = await fetchWithTimeout(qrCodeUrl, {}, 5000);
    if (qrResponse.ok) {
      payload.attachments = [{
        filename: `qr-checkin-${order.orderCode}.png`,
        content: Buffer.from(await qrResponse.arrayBuffer()).toString('base64'),
        content_id: 'checkin-qr'
      }];
    }
  } catch (error) {
    console.warn('QR attachment unavailable:', error.message);
  }

  const response = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }, 8000);
  if (!response.ok) throw new Error(`Resend API error: ${response.status} ${await response.text()}`);
  return response.json();
}

async function deliverTicketEmail(order) {
  try {
    const result = await sendResendEmail(order);
    order.emailSent = !result.skipped;
    order.emailId = result.id || null;
    delete order.emailError;
  } catch (error) {
    order.emailSent = false;
    order.emailError = error.message;
  }
  await saveOrderPersistent(order);
  return order;
}

/* Đánh dấu đã thanh toán — dùng chung cho webhook SePay và admin xác nhận tay */
async function markOrderPaid(order, meta = {}) {
  order.status = PAID;
  order.ticketStatus = order.ticketStatus === 'Đã sử dụng' ? 'Đã sử dụng' : 'Chưa sử dụng';
  order.paidAt = new Date().toISOString();
  order.paidVia = meta.source || 'unknown';
  if (meta.txId) order.sepayTransactionId = meta.txId;
  delete order.paymentIssue;
  order.qrCodeUrl = createQrCodeUrl(order); // luôn là QR check-in (không phải QR thanh toán)

  await saveOrderPersistent(order);
  invalidateInventory();
  await pushOrderToSheet(order, 5000);
  return deliverTicketEmail(order);
}

/* ================================================================== */
/* 5. MIDDLEWARE                                                       */
/* ================================================================== */
app.use(express.json({ limit: '6mb' }));
app.use(express.urlencoded({ extended: true, limit: '6mb' }));
app.use('/assets', express.static(path.join(__dirname, 'public')));

const orderLimiter = sec.createLimiter({ windowMs: config.antiSpam.orderRateWindowMs, max: config.antiSpam.orderRateMax });
const captchaLimiter = sec.createLimiter({ windowMs: config.antiSpam.orderRateWindowMs, max: config.antiSpam.captchaRateMax });
const generalLimiter = sec.createLimiter({ windowMs: 60 * 1000, max: 120 });

app.use('/api', (req, res, next) => {
  if (req.path === '/sepay-webhook' || req.path.startsWith('/admin')) return next();
  return sec.limiterMiddleware(generalLimiter)(req, res, next);
});

// Toàn bộ /api/admin/* và trang /admin yêu cầu đăng nhập
app.use('/api/admin', sec.adminAuth);

/* ================================================================== */
/* 6. API CÔNG KHAI                                                    */
/* ================================================================== */
app.get('/api/config', async (req, res) => {
  const items = readItems();
  const sold = await getInventory();
  res.json({
    eventName: config.event.name,
    eventDate: config.event.date,
    formattedDate: config.event.formattedDate,
    tickets: items.filter((i) => i.type === 'ticket').map((i) => withAvailability(i, sold)),
    merch: items.filter((i) => i.type === 'merch').map((i) => withAvailability(i, sold)),
    contact: config.contact,
    payment: {
      bankName: config.bank.name,
      accountNumber: config.bank.accountNumber,
      accountName: config.bank.accountName,
      webhookUrl: `${config.publicBaseUrl}/api/sepay-webhook`
    }
  });
});

app.get('/api/health', async (req, res) => {
  const startedAt = Date.now();
  if (!supabaseEnabled) return res.json({ ok: true, supabase: 'not-configured' });
  try {
    await supabaseRequest('orders?select=order_code&limit=1');
    return res.json({ ok: true, supabase: 'connected', durationMs: Date.now() - startedAt });
  } catch (error) {
    return res.status(503).json({ ok: false, supabase: 'error', durationMs: Date.now() - startedAt });
  }
});

app.get('/api/captcha', sec.limiterMiddleware(captchaLimiter, 'Bạn tải mã bảo vệ quá nhiều lần. Vui lòng thử lại sau.'), (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(sec.createCaptcha());
});

const DISPOSABLE_EMAIL = /@(mailinator|guerrillamail|10minutemail|tempmail|temp-mail|yopmail|trashmail|sharklasers|throwawaymail|getnada|maildrop)\./i;
const NAME_REGEX = /^[\p{L}\s]+$/u;
const VN_PHONE_REGEX = /^0(3|5|7|8|9)[0-9]{8}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/orders', async (req, res) => {
  const { customer, cart, paymentMethod, captcha } = req.body || {};
  const fail = (status, message) => res.status(status).json({ message });

  // --- 1. Hình dạng request ---
  if (!customer || typeof customer !== 'object' || !cart || !Array.isArray(cart.items) || !customer.name || !customer.phone) {
    return fail(400, 'Thiếu thông tin khách hàng hoặc giỏ hàng.');
  }

  // --- 2. Rate limit theo IP (rẻ nhất, chặn spam thô trước khi làm gì khác) ---
  const wait = orderLimiter.hit(req.ip || 'unknown');
  if (wait) {
    res.set('Retry-After', String(wait));
    return fail(429, 'Bạn đang tạo đơn hàng quá nhanh. Vui lòng chờ một lúc rồi thử lại.');
  }

  // --- 3. Idempotency-Key: nếu đây là request lặp lại (double-click, client tự retry
  // do timeout/mất mạng) trong vài phút gần đây, trả lại đúng kết quả cũ thay vì xử lý lại
  // từ đầu (tránh tạo đơn trùng và tránh tốn captcha một lần dùng). ---
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim().slice(0, 128) || null;
  const cachedResponse = getIdempotentResponse(idempotencyKey);
  if (cachedResponse) {
    return res.status(cachedResponse.status).json(cachedResponse.body);
  }

  // --- 4. Honeypot ---
  if (typeof customer.website === 'string' && customer.website.trim() !== '') {
    return fail(400, 'Lỗi xác thực hệ thống.');
  }

  // --- 5. Validate thông tin khách ---
  const name = String(customer.name || '').trim().replace(/\s+/g, ' ');
  const phone = String(customer.phone || '').replace(/\D/g, '');
  const email = String(customer.email || '').trim().toLowerCase();

  if (!name || !phone || !email) return fail(400, 'Vui lòng nhập đầy đủ họ tên, số điện thoại và email để nhận QR check-in.');
  if (name.length < 2 || name.length > 60) return fail(400, 'Vui lòng nhập họ tên đầy đủ (2-60 ký tự).');
  if (!NAME_REGEX.test(name)) return fail(400, 'Tên chỉ được chứa chữ cái và khoảng trắng, không chứa số hay ký tự đặc biệt.');

  const repeatedPhone = /^(\d)\1+$/.test(phone) || phone === '0123456789';
  if (!VN_PHONE_REGEX.test(phone) || repeatedPhone) {
    return fail(400, 'Số điện thoại không hợp lệ. Vui lòng nhập số điện thoại Việt Nam thực tế (ví dụ: 0912345678).');
  }

  const localPart = email.split('@')[0] || '';
  if (email.length > 120 || !EMAIL_REGEX.test(email) || localPart.length < 3) {
    return fail(400, 'Email không hợp lệ. Vui lòng nhập email chính xác để nhận QR check-in.');
  }

  if (!config.flags.allowTestOrders) {
    if (DISPOSABLE_EMAIL.test(email) || email.includes('@example.com') || /\b(test|testing|qa[\s_]?bot|bot)\b/i.test(name) || email.includes('qa_bot')) {
      return fail(400, 'Lỗi xác thực hệ thống.');
    }
  }

  // --- 6. Chặn sớm theo liên hệ (email/phone): lấy danh sách đơn 1 lần, dùng lại cho cả
  // bước đếm nhanh ở đây lẫn bước so khớp giỏ hàng trùng ở bước 9 — tránh query Supabase 2 lần.
  // Đặt trước bước MX/giỏ hàng (tốn hơn) để fail sớm nếu liên hệ này đã spam. ---
  const recent = await readOrdersPersistent();
  const sameContactPending = recent.filter((o) => isPendingActive(o) && (
    String(o.customer?.phone || '').replace(/\D/g, '') === phone ||
    String(o.customer?.email || '').trim().toLowerCase() === email
  ));
  if (sameContactPending.length >= config.antiSpam.maxPendingPerContact) {
    return fail(429, `Bạn đang có ${sameContactPending.length} đơn chờ thanh toán. Vui lòng thanh toán hoặc chờ ${config.antiSpam.orderExpiryMinutes} phút để đơn cũ hết hạn.`);
  }

  // --- 7. Kiểm tra MX của email (production) ---
  if (config.isProd && !config.flags.allowTestOrders) {
    try {
      const mx = await dns.resolveMx(email.split('@')[1]);
      if (!mx || !mx.length) throw new Error('no-mx');
    } catch (_) {
      return fail(400, 'Tên miền email không tồn tại hoặc không hợp lệ. Vui lòng kiểm tra lại email.');
    }
  }

  // --- 8. Giỏ hàng: giá & tên lấy từ server, kiểm tra tồn kho ---
  const sold = await getInventory();
  const trusted = buildTrustedItems(cart.items, sold);
  if (trusted.error) return fail(400, trusted.error);
  const items = trusted.items;
  const total = calculateOrderTotal(items);
  if (total <= 0) return fail(400, 'Tổng tiền đơn hàng không hợp lệ.');

  // --- 9. Đơn trùng: cùng liên hệ + cùng giỏ hàng đang chờ thanh toán → trả lại đơn cũ
  // (đây là lớp "idempotency" ở mức nghiệp vụ, bền hơn vì đi qua Supabase, không phụ
  // thuộc client có gửi Idempotency-Key hay không) ---
  const duplicate = sameContactPending.find((o) => cartSignature(o.items || []) === cartSignature(items));
  if (duplicate) {
    const body = {
      message: 'Bạn đã có đơn giống hệt đang chờ thanh toán. Vui lòng hoàn tất thanh toán cho đơn này.',
      reused: true,
      order: duplicate,
      payment: createBankPayment(duplicate)
    };
    setIdempotentResponse(idempotencyKey, 200, body);
    return res.status(200).json(body);
  }

  // --- 10. Captcha (kiểm tra sau cùng để lỗi form không làm mất captcha) ---
  if (!config.flags.skipCaptcha) {
    if (!captcha || !captcha.token || !captcha.answer) return fail(400, 'Vui lòng xác thực mã bảo vệ.');
    if (!sec.checkCaptcha(captcha.token, captcha.answer)) {
      return fail(400, 'Mã bảo vệ không chính xác hoặc đã hết hạn. Vui lòng tải mã mới.');
    }
    if (!sec.consumeCaptcha(captcha.token)) return fail(400, 'Mã bảo vệ đã được sử dụng. Vui lòng tải mã mới.');
  }

  // --- 11. Proof (tuỳ chọn) ---
  const proofImage = String(req.body?.proofImage || '').trim();
  if (proofImage && (!proofImage.startsWith('data:image/') || proofImage.length > config.antiSpam.maxProofChars)) {
    return fail(400, 'Ảnh biên lai không hợp lệ hoặc quá lớn.');
  }

  // --- 12. Tạo đơn ---
  const now = new Date().toISOString();
  const method = String(paymentMethod || 'COD').toUpperCase();
  const orderCode = generateOrderCode();
  const order = {
    id: `TM-${Date.now()}`,
    orderCode,
    customer: { name, phone: String(customer.phone).trim(), email },
    deliveryLocation: String(req.body?.deliveryLocation || 'Nhận tại sự kiện').trim().slice(0, 200) || 'Nhận tại sự kiện',
    paymentMethod: method,
    items,
    total,
    status: PENDING,
    ticketStatus: 'Chưa sử dụng',
    createdAt: now,
    expiresAt: new Date(Date.now() + config.antiSpam.orderExpiryMinutes * 60 * 1000).toISOString(),
    qrCodeUrl: null, // chỉ được gán KHI đã thanh toán (QR check-in)
    emailSent: false,
    sendEmail: false,
    checkedInAt: null,
    proofImage: proofImage || null,
    proofUploadedAt: proofImage ? now : null,
    clientIp: req.ip || null
  };

  let payment = createBankPayment(order);
  if (method === 'SEPAY' || method === 'PAYMENT_SEPAY') {
    payment = await createSePayPayment(order);
    order.paymentUrl = payment.paymentUrl;
    order.paymentQrUrl = payment.qrCodeUrl;
  }

  await saveOrderPersistent(order);
  invalidateInventory();
  await pushOrderToSheet(order, 10000);

  const body = { message: 'Đặt vé thành công!', order, payment };
  setIdempotentResponse(idempotencyKey, 201, body);
  return res.status(201).json(body);
});

app.get('/api/orders/:orderCode/status', async (req, res) => {
  const order = await findOrderPersistent(req.params.orderCode);
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!order || (email && String(order.customer.email || '').trim().toLowerCase() !== email)) {
    return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
  }

  const status = normalizeOrderStatus(order);
  if (status === EXPIRED && order.status !== EXPIRED) {
    order.status = EXPIRED;
    order.expiredAt = new Date().toISOString();
    await saveOrderPersistent(order);
  }

  return res.json({
    order: {
      orderCode: order.orderCode,
      status: status === EXPIRED ? EXPIRED : order.status,
      ticketStatus: order.ticketStatus,
      total: order.total,
      deliveryLocation: order.deliveryLocation || 'Nhận tại sự kiện',
      qrCodeUrl: order.status === PAID ? order.qrCodeUrl : null,
      emailSent: order.emailSent,
      emailError: order.emailError || null,
      paidAt: order.paidAt || null,
      checkedInAt: order.checkedInAt || null,
      proofImage: order.proofImage || null,
      proofUploadedAt: order.proofUploadedAt || null,
      expiresAt: order.expiresAt || null
    }
  });
});

app.post('/api/orders/:orderCode/proof', async (req, res) => {
  const proofImage = String(req.body?.proofImage || '').trim();
  if (!proofImage.startsWith('data:image/') || proofImage.length > config.antiSpam.maxProofChars) {
    return res.status(400).json({ message: 'Vui lòng chọn ảnh chụp biên lai hợp lệ (tối đa ~3MB).' });
  }
  const order = await findOrderPersistent(req.params.orderCode);
  if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
  if (order.status === PAID) return res.status(409).json({ message: 'Đơn hàng đã được thanh toán.' });

  order.proofImage = proofImage;
  order.proofUploadedAt = new Date().toISOString();
  await saveOrderPersistent(order);
  return res.status(200).json({
    message: 'Tải ảnh biên lai thành công!',
    order: { orderCode: order.orderCode, proofImage: order.proofImage, proofUploadedAt: order.proofUploadedAt }
  });
});

app.post('/api/orders/:orderCode/confirm', async (req, res) => {
  const order = await findOrderPersistent(req.params.orderCode);
  if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
  // Chỉ ghi nhận "khách bấm đã chuyển khoản" — KHÔNG đổi trạng thái thanh toán
  order.customerConfirmed = true;
  order.customerConfirmedAt = new Date().toISOString();
  await saveOrderPersistent(order);
  return res.status(200).json({
    message: 'Xác nhận thành công!',
    order: { orderCode: order.orderCode, customerConfirmed: true, customerConfirmedAt: order.customerConfirmedAt }
  });
});

app.post('/api/orders/:orderCode/resend-email', async (req, res) => {
  const order = await findOrderPersistent(req.params.orderCode);
  if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
  if (order.status !== PAID) return res.status(409).json({ message: 'Đơn hàng chưa được thanh toán.' });

  const email = String(req.body?.email || req.query.email || '').trim().toLowerCase();
  if (email && email !== String(order.customer.email || '').toLowerCase()) {
    return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
  }
  if ((order.publicResendCount || 0) >= config.antiSpam.maxResendPerOrder) {
    return res.status(429).json({ message: 'Đã đạt giới hạn gửi lại email. Vui lòng liên hệ ban tổ chức.' });
  }
  if (order.lastPublicResendAt && Date.now() - new Date(order.lastPublicResendAt).getTime() < 60000) {
    return res.status(429).json({ message: 'Vui lòng đợi 1 phút trước khi gửi lại.' });
  }

  order.publicResendCount = (order.publicResendCount || 0) + 1;
  order.lastPublicResendAt = new Date().toISOString();
  order.qrCodeUrl = createQrCodeUrl(order);
  await deliverTicketEmail(order);
  if (!order.emailSent) return res.status(502).json({ message: 'Gửi lại email thất bại.' });
  return res.status(200).json({ message: 'Đã gửi lại email QR check-in.' });
});

/* ================================================================== */
/* 7. WEBHOOK SEPAY                                                    */
/* ================================================================== */
app.get('/api/sepay-webhook', (req, res) => {
  res.json({ ok: true, message: 'SePay webhook is ready. Send POST transactions to this URL.' });
});

async function findOrderFromTransaction(tx) {
  const fields = [tx.code, tx.content, tx.description, tx.transactionContent, tx.transferContent].filter(Boolean).map(String);
  if (!fields.length) return null;

  // Mã đơn mới: TM + 10 ký tự hex. Ngân hàng có thể dính chữ trước/sau nên quét trong chuỗi đã chuẩn hoá.
  const candidates = new Set();
  fields.forEach((f) => {
    const t = f.trim();
    if (t.length >= 8 && t.length <= 64 && /^TM/i.test(t)) candidates.add(t.toUpperCase());
    (normCode(f).match(/TM[0-9A-F]{10}/g) || []).forEach((c) => candidates.add(c));
  });
  for (const code of candidates) {
    const order = await findOrderPersistent(code);
    if (order) return order;
  }

  // Đơn cũ mã dạng TM-<số>-<chuỗi>: so khớp sau khi bỏ ký tự đặc biệt
  const text = fields.map(normCode).join('|');
  const orders = await readOrdersPersistent(2000);
  return orders.find((o) => o.orderCode && text.includes(normCode(o.orderCode))) || null;
}

app.post('/api/sepay-webhook', async (req, res) => {
  // Fail-closed: không có/ sai API key → 401 (bản cũ cho qua nếu thiếu chữ ký!)
  if (!sec.verifySePayRequest(req)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const payload = req.body || {};
  const tx = payload.data && typeof payload.data === 'object' ? payload.data : payload;

  const transferType = String(tx.transferType || '').toLowerCase();
  if (transferType && transferType !== 'in') {
    return res.status(200).json({ success: true, ignored: 'not-incoming' });
  }

  const account = String(tx.accountNumber || '');
  if (account && config.bank.accountNumber && account !== config.bank.accountNumber) {
    return res.status(200).json({ success: true, ignored: 'other-account' });
  }

  const amount = Number(tx.transferAmount ?? tx.amount ?? 0);
  const txId = tx.id !== undefined && tx.id !== null ? String(tx.id) : (tx.referenceCode ? String(tx.referenceCode) : null);

  const found = await findOrderFromTransaction(tx);
  if (!found) {
    // 200 để SePay không retry liên tục với giao dịch không liên quan
    return res.status(200).json({ success: true, matched: false, message: 'Không tìm thấy đơn hàng tương ứng.' });
  }

  await withLock(found.orderCode, async () => {
    const order = (await findOrderPersistent(found.orderCode)) || found;

    if (order.status === PAID) {
      const already = txId && order.sepayTransactionId === txId;
      if (!already && txId) {
        order.extraPayments = [...(order.extraPayments || []), { txId, amount, at: new Date().toISOString() }];
        await saveOrderPersistent(order);
      }
      if (!order.emailSent) await deliverTicketEmail(order);
      return res.status(200).json({ success: true, matched: true, status: PAID, duplicate: true, emailSent: Boolean(order.emailSent) });
    }

    if (Number(order.total) !== amount) {
      order.paymentIssue = { reason: 'amount-mismatch', expected: order.total, received: amount, txId, at: new Date().toISOString() };
      await saveOrderPersistent(order);
      return res.status(200).json({ success: true, matched: true, paid: false, message: 'Số tiền không khớp với đơn hàng.' });
    }

    const paid = await markOrderPaid(order, { source: 'sepay-webhook', txId });
    return res.status(200).json({
      success: true,
      matched: true,
      paid: true,
      status: paid.status,
      emailSent: Boolean(paid.emailSent)
    });
  });
});

/* ================================================================== */
/* 8. API ADMIN (đã có adminAuth ở trên)                                */
/* ================================================================== */
app.get('/api/admin/orders', async (req, res) => {
  const { status, search } = req.query;
  let allOrders = await readOrdersPersistent();

  if (config.sheet.webhookUrl) {
    try {
      const sheetRes = await fetchWithTimeout(config.sheet.webhookUrl, { method: 'GET' }, 15000);
      if (sheetRes.ok) {
        const sheetData = await sheetRes.json();
        if (Array.isArray(sheetData) && sheetData.length) {
          const sheetMap = new Map(sheetData.filter((o) => o.orderCode).map((o) => [o.orderCode, o]));
          allOrders = await Promise.all(allOrders.map(async (o) => {
            const so = sheetMap.get(o.orderCode);
            if (!so) return o;

            // Sheet có thể chưa kịp cập nhật → không cho hạ đơn đã thanh toán về "chờ"
            const sheetStatus = so.status || o.status;
            const newStatus = o.status === PAID && sheetStatus === PENDING ? PAID : sheetStatus;
            let { emailSent, emailError } = o;

            const wantsEmail = so.sendEmail === true || String(so.sendEmail).trim().toLowerCase() === 'true';
            if (wantsEmail && !emailSent && newStatus === PAID) {
              const local = (await findOrderPersistent(o.orderCode)) || o;
              await deliverTicketEmail(local);
              emailSent = local.emailSent;
              emailError = local.emailError;
            }
            return { ...o, status: newStatus, emailSent, emailError };
          }));
        }
      }
    } catch (err) {
      console.warn('Không thể kéo dữ liệu từ Google Sheet:', err.message);
    }
  }

  const q = String(search || '').toLowerCase();
  const filtered = allOrders.filter((o) => {
    const st = normalizeOrderStatus(o);
    const matchesStatus = !status || status === 'all' || o.status === status || st === status;
    const text = `${o.orderCode} ${o.customer?.name} ${o.customer?.phone} ${o.deliveryLocation || ''}`.toLowerCase();
    return matchesStatus && (!q || text.includes(q));
  });

  res.json({
    summary: getOrderSummary(allOrders),
    orders: filtered
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((o) => ({
        ...o,
        status: normalizeOrderStatus(o) === EXPIRED && o.status !== PAID ? EXPIRED : o.status,
        deliveryLocation: o.deliveryLocation || 'Nhận tại sự kiện',
        proofImage: o.proofImage || null,
        proofUploadedAt: o.proofUploadedAt || null
      }))
  });
});

app.post('/api/admin/confirm-payment', async (req, res) => {
  const { orderCode } = req.body || {};
  if (!orderCode) return res.status(400).json({ message: 'Thiếu mã đơn hàng.' });

  try {
    const result = await withLock(String(orderCode), async () => {
      const order = await findOrderPersistent(String(orderCode));
      if (!order) return null;
      if (order.status === PAID) return order;

      if (config.sheet.readUrl) {
        const match = await findGoogleSheetMatch(order.orderCode, Number(order.total || 0));
        if (match === null) throw new Error('Không tìm thấy giao dịch tương ứng trong Google Sheet.');
        if (match.matched === false) throw new Error('Giao dịch trong Google Sheet không khớp với đơn hàng.');
      }
      return markOrderPaid(order, { source: 'admin-manual' });
    });
    if (!result) return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    return res.status(200).json({ message: 'Đã xác nhận thanh toán thủ công.', order: result });
  } catch (error) {
    return res.status(409).json({ message: error.message || 'Xác nhận thanh toán thất bại.' });
  }
});

app.post('/api/admin/clear-orders', async (req, res) => {
  // Thao tác nguy hiểm: bắt buộc xác nhận rõ ràng
  if ((req.body || {}).confirm !== 'DELETE_ALL') {
    return res.status(400).json({ message: 'Cần gửi { "confirm": "DELETE_ALL" } để xoá toàn bộ đơn hàng.' });
  }
  writeOrders([]);
  if (supabaseEnabled) {
    try {
      await supabaseRequest('orders?order_code=neq.__NEVER__', { method: 'DELETE' });
    } catch (err) {
      console.warn('Supabase clear orders failed:', err.message);
    }
  }
  invalidateInventory();
  return res.status(200).json({ success: true, message: 'Đã xóa toàn bộ đơn hàng thành công.' });
});

// Chỉ dọn đơn CHƯA thanh toán và ĐÃ HẾT HẠN (bản cũ xoá luôn đơn khách đang thanh toán dở)
app.post('/api/admin/cleanup-orders', async (req, res) => {
  try {
    const orders = await readOrdersPersistent(2000);
    const toDelete = orders.filter((o) => o.status !== PAID && normalizeOrderStatus(o) === EXPIRED).map((o) => o.orderCode);
    for (const code of toDelete) await deleteOrderPersistent(code);
    if (toDelete.length) invalidateInventory();
    return res.status(200).json({ success: true, message: `Đã dọn dẹp thành công ${toDelete.length} đơn rác/hết hạn.`, deletedCount: toDelete.length });
  } catch (error) {
    return res.status(500).json({ message: `Lỗi dọn dẹp đơn hàng: ${error.message}` });
  }
});

app.post('/api/admin/restore-from-sheet', async (req, res) => {
  if (!config.sheet.webhookUrl) return res.status(400).json({ success: false, message: 'Chưa cấu hình GOOGLE_SHEET_WEBHOOK_URL.' });
  try {
    const sheetRes = await fetchWithTimeout(config.sheet.webhookUrl, { method: 'GET' }, 15000);
    if (!sheetRes.ok) throw new Error('Không thể kết nối tới Google Sheet');
    const sheetData = await sheetRes.json();
    if (!Array.isArray(sheetData) || !sheetData.length) {
      return res.status(200).json({ success: true, message: 'Sheet không có dữ liệu đơn hàng.', restoredCount: 0, updatedCount: 0 });
    }

    const localMap = new Map((await readOrdersPersistent(2000)).map((o) => [o.orderCode, o]));
    let restoredCount = 0;
    let updatedCount = 0;

    const parseJson = (value, fallback) => {
      if (typeof value !== 'string') return value || fallback;
      try { return JSON.parse(value); } catch (_) { return fallback; }
    };

    for (const o of sheetData) {
      if (!o.orderCode || String(o.orderCode).trim() === '') continue;
      let cust = parseJson(o.customer, {});
      if (typeof cust !== 'object' || cust === null) cust = { name: String(cust) };
      const items = Array.isArray(o.items) ? o.items : parseJson(o.items, []);
      const emailSent = o.emailSent === true || String(o.emailSent || '').toLowerCase() === 'true';

      if (localMap.has(o.orderCode)) {
        const merged = { ...localMap.get(o.orderCode) };
        if (o.status) merged.status = o.status;
        if (o.ticketStatus) merged.ticketStatus = o.ticketStatus;
        if (o.emailSent !== undefined) merged.emailSent = emailSent;
        if (o.paidAt) merged.paidAt = o.paidAt;
        if (o.checkedInAt) merged.checkedInAt = o.checkedInAt;
        if (o.proofImage) merged.proofImage = o.proofImage;
        if (o.deliveryLocation) merged.deliveryLocation = o.deliveryLocation;
        if (cust.name || cust.phone || cust.email) merged.customer = { ...merged.customer, ...cust };
        await saveOrderPersistent(merged);
        updatedCount++;
      } else {
        await saveOrderPersistent({
          id: o.id || o.orderCode,
          orderCode: o.orderCode,
          customer: cust,
          deliveryLocation: o.deliveryLocation || 'Nhận tại sự kiện',
          paymentMethod: o.paymentMethod || 'COD',
          status: o.status || PENDING,
          ticketStatus: o.ticketStatus || 'Chưa sử dụng',
          total: Number(o.total) || 0,
          createdAt: o.createdAt || new Date().toISOString(),
          items,
          itemsStr: o.itemsStr || '',
          emailSent,
          proofImage: o.proofImage || null,
          proofUploadedAt: o.proofUploadedAt || null,
          paidAt: o.paidAt || null,
          checkedInAt: o.checkedInAt || null,
          qrCodeUrl: o.qrCodeUrl || null
        });
        restoredCount++;
      }
    }
    invalidateInventory();
    return res.status(200).json({
      success: true,
      message: `Đã tải ${sheetData.length} đơn từ Sheet: ${restoredCount} đơn mới, ${updatedCount} đơn cập nhật.`,
      restoredCount,
      updatedCount,
      totalFromSheet: sheetData.length
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: `Lỗi tải từ Sheet: ${err.message}` });
  }
});

app.delete('/api/admin/orders/:orderCode', async (req, res) => {
  const code = String(req.params.orderCode || '').trim();
  if (!code) return res.status(400).json({ message: 'Thiếu mã đơn hàng.' });
  await deleteOrderPersistent(code);
  invalidateInventory();
  return res.status(200).json({ success: true, message: `Đã xóa đơn hàng ${code}.` });
});

app.post('/api/admin/resend-email', async (req, res) => {
  const { orderCode } = req.body || {};
  if (!orderCode) return res.status(400).json({ message: 'Thiếu mã đơn hàng.' });
  const order = await findOrderPersistent(orderCode);
  if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
  if (order.status !== PAID) return res.status(409).json({ message: 'Đơn hàng chưa được thanh toán.' });

  order.qrCodeUrl = createQrCodeUrl(order);
  await deliverTicketEmail(order);
  if (!order.emailSent) {
    return res.status(502).json({ message: 'Gửi lại email thất bại.', error: order.emailError, order });
  }
  return res.status(200).json({ message: 'Đã gửi lại email QR check-in.', order });
});

app.post('/api/admin/checkin', async (req, res) => {
  const { qrCode } = req.body || {};
  if (!qrCode) return res.status(400).json({ message: 'Thiếu dữ liệu mã QR.' });

  const orderCode = sec.decodeQrPayload(String(qrCode));
  if (!orderCode) return res.status(400).json({ message: 'Mã QR không hợp lệ.' });

  // Khoá theo đơn: 2 máy quét cùng lúc chỉ 1 máy thành công
  await withLock(orderCode, async () => {
    const order = await findOrderPersistent(orderCode);
    if (!order) return res.status(404).json({ message: 'Không tìm thấy vé tương ứng với mã QR.' });
    if (order.status !== PAID) return res.status(409).json({ message: 'Vé chưa được thanh toán, chưa thể check-in.' });
    if (order.ticketStatus === 'Đã sử dụng') {
      return res.status(409).json({ message: 'Vé này đã được check-in trước đó!', order });
    }
    order.ticketStatus = 'Đã sử dụng';
    order.checkedInAt = new Date().toISOString();
    await saveOrderPersistent(order);
    return res.status(200).json({ message: 'Check-in thành công!', order });
  });
});

/* ---- Quản lý mặt hàng ---- */
app.get('/api/admin/items', async (req, res) => {
  const sold = await getInventory();
  res.json(readItems().map((i) => withAvailability(i, sold)));
});

app.post('/api/admin/items', async (req, res) => {
  const newItem = req.body;
  if (!newItem || !newItem.id || !newItem.name) {
    return res.status(400).json({ error: 'Thiếu thông tin bắt buộc (id, name).' });
  }
  if (newItem.price !== undefined && (!Number.isFinite(Number(newItem.price)) || Number(newItem.price) < 0)) {
    return res.status(400).json({ error: 'Giá không hợp lệ.' });
  }

  const items = readItems();
  const index = items.findIndex((i) => i.id === newItem.id);
  const sold = (await getInventory())[newItem.id] || 0;

  if (newItem.quantity !== undefined) {
    newItem.baseQuantity = Number(newItem.quantity) + sold;
    delete newItem.quantity;
  }
  if (index !== -1) items[index] = { ...items[index], ...newItem };
  else items.push(newItem);

  if (saveItems(items)) return res.json({ success: true, item: items[index !== -1 ? index : items.length - 1] });
  return res.status(500).json({ error: 'Không thể lưu mặt hàng.' });
});

app.delete('/api/admin/items/:id', (req, res) => {
  const items = readItems();
  const next = items.filter((i) => i.id !== req.params.id);
  if (next.length === items.length) return res.status(404).json({ error: 'Không tìm thấy mặt hàng.' });
  if (saveItems(next)) return res.json({ success: true, message: 'Đã xóa mặt hàng.' });
  return res.status(500).json({ error: 'Lỗi khi lưu dữ liệu.' });
});
////TEST SEPAY CONNECTION

app.get('/api/test-sepay-connection', async (req, res) => {
  const { paymentUrl, apiKey, webhookApiKey } = config.sepay;
  const results = {
    webhookConfigured: Boolean(webhookApiKey && webhookApiKey !== 'dev-sepay-key'),
    paymentApiConfigured: Boolean(paymentUrl && apiKey),
    sepayReachable: false,
    details: {}
  };

  console.log('[SePay Check] Checking SePay configuration and connectivity...');
  console.log(`[SePay Check] Webhook Key configured: ${results.webhookConfigured}`);
  console.log(`[SePay Check] Payment API configured: ${results.paymentApiConfigured}`);

  if (paymentUrl) {
    try {
      // Test gửi request ping/options/health tới Payment API của SePay
      const resPing = await fetchWithTimeout(paymentUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({ test: true })
      }, 5000);

      results.sepayReachable = true;
      results.details = {
        httpStatus: resPing.status,
        statusText: resPing.statusText
      };
      console.log(`[SePay Check] Reached SePay API successfully. Status: ${resPing.status}`);
    } catch (err) {
      results.details = { error: err.message };
      console.error('[SePay Check] Failed to reach SePay Payment URL:', err.message);
    }
  }

  return res.json(results);
});

/* ================================================================== */
/* 9. TRANG TĨNH                                                       */
/* ================================================================== */
app.get('/admin', sec.adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/admin.html', sec.adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/contact', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'contact.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function startServer(port = config.port) {
  return app.listen(port, () => {
    console.log(`${config.event.name} app is running at http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
  readOrders,
  findOrderByCode,
  saveOrder,
  createQrCodeUrl,
  sendResendEmail,
  decodeQrPayload: sec.decodeQrPayload,
  getOrderSummary
};