require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dns = require('dns').promises;
let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (_) { }

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.VERCEL
  ? path.join('/tmp', 'thuy-mong-data')
  : path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const BUNDLED_ITEMS_FILE = path.join(__dirname, 'data', 'items.json');

// ==========================================
// CƠ CHẾ CHỐNG SPAM (ANTI-SPAM IN-MEMORY)
// ==========================================
const ipRateLimitMap = new Map();
const IP_WINDOW_MS = 10 * 60 * 1000;    // 10 phút
const MAX_ORDERS_PER_IP = 5;             // Tối đa 5 đơn / IP / 10 phút
const MAX_PENDING_PER_USER = 1;          // Tối đa 1 đơn "Chờ thanh toán" trên cùng SĐT/Email
const ORDER_EXPIRY_MS = 15 * 60 * 1000;  // Đơn chờ thanh toán quá 15 phút tính là hết hạn

// Dọn dẹp cache rate limit định kỳ tránh leak RAM
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of ipRateLimitMap.entries()) {
    if (now - data.firstRequest > IP_WINDOW_MS) {
      ipRateLimitMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const record = ipRateLimitMap.get(ip);
  if (!record) {
    ipRateLimitMap.set(ip, { count: 1, firstRequest: now });
    return true;
  }
  if (now - record.firstRequest > IP_WINDOW_MS) {
    ipRateLimitMap.set(ip, { count: 1, firstRequest: now });
    return true;
  }
  if (record.count >= MAX_ORDERS_PER_IP) {
    return false;
  }
  record.count += 1;
  return true;
}

// ==========================================
// ĐỌC / GHI DỮ LIỆU LOCAL
// ==========================================
function readItems() {
  try {
    if (fs.existsSync(ITEMS_FILE)) {
      return JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf8'));
    }
  } catch (error) {
    console.error('Error reading items:', error.message);
  }
  return [];
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

async function readItemsPersistent() {
  const localItems = readItems();

  if (!supabaseEnabled) return localItems;

  try {
    const rows = await supabaseRequest('items?select=item_data&order=updated_at.desc');
    const remoteItems = Array.isArray(rows) ? rows.map((row) => row.item_data).filter(Boolean) : [];
    if (remoteItems.length > 0) {
      return remoteItems;
    }
  } catch (error) {
    console.warn('Supabase items read failed, falling back to local file store:', error.message);
  }

  return localItems;
}

async function saveItemsPersistent(items) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const localSaved = saveItems(normalizedItems);

  if (!supabaseEnabled) return localSaved;

  try {
    await Promise.all(normalizedItems.map((item) => supabaseRequest('items?on_conflict=item_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        item_id: String(item.id || ''),
        item_data: item,
        updated_at: new Date().toISOString()
      })
    })));
    return localSaved;
  } catch (error) {
    console.warn('Supabase items sync failed; local file was still saved:', error.message);
    return localSaved;
  }
}

const BUNDLED_ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(ORDERS_FILE)) {
  if (fs.existsSync(BUNDLED_ORDERS_FILE)) {
    try {
      fs.copyFileSync(BUNDLED_ORDERS_FILE, ORDERS_FILE);
    } catch (_) {
      fs.writeFileSync(ORDERS_FILE, '[]', 'utf8');
    }
  } else {
    fs.writeFileSync(ORDERS_FILE, '[]', 'utf8');
  }
}

if (!fs.existsSync(ITEMS_FILE)) {
  if (fs.existsSync(BUNDLED_ITEMS_FILE)) {
    try {
      fs.copyFileSync(BUNDLED_ITEMS_FILE, ITEMS_FILE);
    } catch (_) {
      fs.writeFileSync(ITEMS_FILE, '[]', 'utf8');
    }
  } else {
    fs.writeFileSync(ITEMS_FILE, '[]', 'utf8');
  }
}

function readOrders() {
  try {
    const raw = fs.readFileSync(ORDERS_FILE, 'utf8');
    return JSON.parse(raw) || [];
  } catch (error) {
    return [];
  }
}

const MAX_STORED_ORDERS = 700;

function writeOrders(orders) {
  const limitedOrders = Array.isArray(orders) ? orders.slice(-MAX_STORED_ORDERS) : [];
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(limitedOrders, null, 2), 'utf8');
}

function findOrderByCode(code) {
  return readOrders().find((order) => order.orderCode === code) || null;
}

function saveOrder(order) {
  const orders = readOrders();
  const index = orders.findIndex((entry) => entry.orderCode === order.orderCode);
  if (index >= 0) {
    orders[index] = order;
  } else {
    orders.push(order);
  }
  const trimmedOrders = orders.slice(-MAX_STORED_ORDERS);
  writeOrders(trimmedOrders);
  return order;
}

// ==========================================
// SUPABASE DATABASE LOGIC
// ==========================================
const supabaseEnabled = Boolean((process.env.SUPABASE_URL || '').trim() && (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim());

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function supabaseRequest(pathname, options = {}) {
  const response = await fetchWithTimeout(`${process.env.SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  }, 4000);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase API error: ${response.status} ${errorText}`);
  }

  if (response.status === 204) return null;
  const responseText = await response.text();
  if (!responseText) return null;
  return JSON.parse(responseText);
}

async function readOrdersPersistent(timeoutMs = 2500) {
  const localOrders = readOrders();

  if (!supabaseEnabled) return localOrders;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders?select=order_data&order=created_at.desc&limit=60`, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!response.ok) return localOrders;
    const rows = await response.json();
    const remoteOrders = Array.isArray(rows) ? rows.map((r) => r.order_data).filter(Boolean) : [];
    return remoteOrders.length ? remoteOrders : localOrders;
  } catch (error) {
    clearTimeout(timer);
    console.warn('Supabase read failed, fallback to local store:', error.message);
    return localOrders;
  }
}

async function findOrderPersistent(orderCode) {
  const localOrder = findOrderByCode(orderCode);
  if (!supabaseEnabled) return localOrder;

  try {
    const rows = await Promise.race([
      supabaseRequest(`orders?order_code=eq.${encodeURIComponent(orderCode)}&select=order_data&limit=1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase lookup timeout')), 1500))
    ]);

    if (rows?.[0]?.order_data) return rows[0].order_data;
    return localOrder;
  } catch (error) {
    console.warn('Supabase lookup failed, falling back to local file store:', error.message);
    return localOrder;
  }
}

async function saveOrderPersistent(order) {
  const localSaved = saveOrder(order);
  if (!supabaseEnabled) return localSaved;

  try {
    await Promise.race([
      supabaseRequest('orders?on_conflict=order_code', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          order_code: order.orderCode,
          order_data: order,
          updated_at: new Date().toISOString()
        })
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase save timeout')), 1500))
    ]);
    return order;
  } catch (error) {
    console.warn('Supabase save failed, falling back to local file store:', error.message);
    return localSaved;
  }
}

function getOrderSummary(orders) {
  const totalRevenue = orders
    .filter((order) => order.status === 'Đã thanh toán')
    .reduce((sum, order) => sum + Number(order.total || 0), 0);

  return {
    totalRevenue,
    totalOrders: orders.length,
    paidOrders: orders.filter((order) => order.status === 'Đã thanh toán').length,
    pendingOrders: orders.filter((order) => order.status === 'Chờ thanh toán').length,
    usedTickets: orders.filter((order) => order.ticketStatus === 'Đã sử dụng').length
  };
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/assets', express.static(path.join(__dirname, 'public')));

function generateOrderCode() {
  return `TM-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function calculateOrderTotal(items = []) {
  const normalizedItems = Array.isArray(items) ? items.map((item) => ({
    id: String(item.id || ''),
    price: Number(item.price) || 0,
    quantity: Number(item.quantity) || 0,
    type: String(item.type || 'ticket')
  })) : [];

  const ticketItems = normalizedItems.filter((item) => item.type === 'ticket');
  const merchItems = normalizedItems.filter((item) => item.type === 'merch');
  const ticketCount = ticketItems.reduce((sum, item) => sum + item.quantity, 0);
  const ticketTierIds = new Set(ticketItems.map((item) => item.id));
  const hasValueTicket = ticketTierIds.has('sao-may') || ticketTierIds.has('thanh-la') || ticketTierIds.has('y-mon');
  const hasTuLinh = ticketTierIds.has('tu-linh');
  const khanItem = merchItems.find((item) => item.id === 'khan');
  const comboItem = merchItems.find((item) => item.id === 'combo-merch');

  let subtotal = normalizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  if (ticketCount >= 4) {
    const ticketSubtotal = ticketItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    subtotal -= ticketSubtotal * 0.1;
  }

  if ((hasValueTicket || hasTuLinh) && khanItem) {
    const rate = hasTuLinh ? 0.15 : 0.05;
    subtotal -= khanItem.price * khanItem.quantity * rate;
  }

  if (hasTuLinh && comboItem) {
    subtotal -= comboItem.price * comboItem.quantity;
  }

  return Math.round(Math.max(0, subtotal));
}

function createQrCodeUrl(order) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(getQrPayload(order))}`;
}

function createBankPayment(order) {
  const bankCode = process.env.BANK_CODE || 'TPB';
  const accountNumber = process.env.BANK_ACCOUNT_NUMBER || '20327264235';
  const accountName = process.env.BANK_ACCOUNT_NAME || 'TRINH THANH MY';
  const paymentQrUrl = `https://img.vietqr.io/image/${bankCode}-${accountNumber}-compact2.png?amount=${order.total}&addInfo=${encodeURIComponent(order.orderCode)}&accountName=${encodeURIComponent(accountName)}`;

  return {
    provider: 'bank-transfer',
    bankName: `${bankCode} Bank`,
    accountNumber,
    accountName,
    paymentQrUrl,
    transferContent: order.orderCode
  };
}

function getQrPayload(order) {
  const qrSecret = process.env.QR_SECRET || 'thuy_mong_qr_secret_2026';
  const raw = `THUY_MONG|${order.orderCode}|${order.customer.email}|${order.customer.name}|${order.createdAt}`;
  const sig = crypto.createHmac('sha256', qrSecret).update(raw).digest('hex').slice(0, 16);
  return `${raw}|${sig}`;
}

function decodeQrPayload(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return null;
  const parts = rawValue.split('|');
  if (parts.length < 2 || parts[0] !== 'THUY_MONG') return null;
  return parts[1];
}

function resolveResendRecipient(email) {
  const rawEmail = String(email || '').trim().toLowerCase();
  if (!rawEmail) return 'delivered@resend.dev';

  const allowTestSend = String(process.env.RESEND_ALLOW_TEST_EMAIL || '').toLowerCase() === 'true';
  const usesExampleDomain = rawEmail.endsWith('@example.com') || rawEmail.includes('example.com');

  if (usesExampleDomain && allowTestSend) {
    return process.env.RESEND_TEST_EMAIL || 'delivered@resend.dev';
  }

  return rawEmail;
}

async function sendGmailSmtpEmail(order) {
  const gmailUser = (process.env.GMAIL_USER || process.env.SMTP_USER || '').trim();
  const gmailPass = (process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || '').trim().replace(/\s+/g, '');

  if (!gmailUser || !gmailPass || !nodemailer) {
    return null;
  }

  const recipient = String(order.customer?.email || '').trim();
  if (!recipient) {
    return { skipped: true, reason: 'Không có email người nhận.' };
  }

  if (String(process.env.EMAIL_DRY_RUN).toLowerCase() === 'true') {
    return { id: 'dry-run-message-id', provider: 'dry-run' };
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailPass
    }
  });

  const qrCodeUrl = order.qrCodeUrl || createQrCodeUrl(order);
  const attachments = [];
  try {
    const qrResponse = await fetchWithTimeout(qrCodeUrl, {}, 5000);
    if (qrResponse.ok) {
      const qrBuffer = Buffer.from(await qrResponse.arrayBuffer());
      attachments.push({
        filename: `qr-checkin-${order.orderCode}.png`,
        content: qrBuffer,
        cid: 'thuy-mong-checkin-qr'
      });
    }
  } catch (err) {
    console.warn('QR attachment download failed:', err.message);
  }

  const itemsList = (order.items || []).map((it) => `${it.name} x${it.quantity}`).join(', ');
  const checkinText = process.env.EVENT_CHECKIN_TEXT || '17:30 - 19:35 — Thứ Bảy, 17/10/2026';
  const venueText = process.env.EVENT_VENUE || 'Nhà Hát Múa Rối Việt Nam, 361 Trường Chinh, Thanh Xuân, Hà Nội';
  const contactPhone = process.env.CONTACT_PHONE || '0327264235';
  const contactEmail = process.env.CONTACT_EMAIL || 'myth.superking@gmail.com';

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #222; line-height: 1.6; border: 1px solid #e8decb; border-radius: 12px; overflow: hidden; background: #ffffff;">
      <div style="background: #071a1d; color: #f6f2ea; padding: 24px; text-align: center;">
        <h1 style="color: #f1c66b; margin: 0 0 6px; font-family: Georgia, serif; letter-spacing: 2px;">${process.env.EVENT_NAME || 'THỦY MỘNG'}</h1>
        <p style="margin: 0; font-size: 14px; opacity: 0.85;">Vé & QR Check-in Sự Kiện Múa Rối Nước</p>
      </div>
      <div style="padding: 24px;">
        <h2 style="color: #071a1d; margin-top: 0;">Xin chào ${order.customer.name},</h2>
        <p>Chúc mừng bạn! Đơn hàng đặt vé sự kiện <strong>${process.env.EVENT_NAME || 'Thủy Mộng'}</strong> của bạn đã được xác nhận thanh toán thành công.</p>
        
        <div style="background: #fdfbf7; border: 1px solid #f1e4ce; border-radius: 8px; padding: 16px; margin: 18px 0;">
          <p style="margin: 6px 0;"><strong>Mã đơn hàng:</strong> <span style="font-size: 1.1em; color: #071a1d; font-weight: bold;">${order.orderCode}</span></p>
          <p style="margin: 6px 0;"><strong>Các mặt hàng:</strong> ${itemsList || '—'}</p>
          <p style="margin: 6px 0;"><strong>Nơi nhận hàng:</strong> ${order.deliveryLocation || 'Nhận tại sự kiện'}</p>
          <p style="margin: 6px 0;"><strong>Tổng tiền:</strong> <span style="color: #c99a61; font-weight: bold; font-size: 1.1em;">${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(order.total)}</span></p>
          <p style="margin: 6px 0;"><strong>Giờ check in:</strong> ${checkinText}</p>
          <p style="margin: 6px 0;"><strong>Địa điểm:</strong> ${venueText}</p>
        </div>

        <div style="text-align: center; margin: 24px 0;">
          <p style="font-weight: bold; margin-bottom: 12px; color: #071a1d; font-size: 15px;">MÃ QR CHECK-IN VÀO CỬA</p>
          <img src="${attachments.length ? 'cid:thuy-mong-checkin-qr' : qrCodeUrl}" alt="QR Check-in" style="width: 200px; height: 200px; border: 2px solid #f1c66b; border-radius: 12px; padding: 8px; background: white; box-shadow: 0 4px 12px rgba(0,0,0,0.08);" />
          <p style="font-size: 13px; color: #777; margin-top: 8px;">(Vui lòng mang theo email này hoặc lưu ảnh QR đính kèm để check-in tại cửa sự kiện)</p>
        </div>

        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="font-size: 13px; color: #666; margin: 0;">
          Mọi thắc mắc vui lòng liên hệ Ban tổ chức:<br />
          Hotline: <strong>${contactPhone}</strong> | Email: <strong>${contactEmail}</strong>
        </p>
      </div>
    </div>
  `;

  const info = await transporter.sendMail({
    from: `"${process.env.EVENT_NAME || 'Thủy Mộng'}" <${gmailUser}>`,
    to: recipient,
    subject: `[${process.env.EVENT_NAME || 'Thủy Mộng'}] Vé & QR Check-in sự kiện ngày ${process.env.EVENT_DATE || '17/10/2026'} - ${order.orderCode}`,
    html: htmlContent,
    attachments
  });

  return { id: info.messageId, provider: 'gmail' };
}

async function sendResendEmail(order) {
  const gmailResult = await sendGmailSmtpEmail(order);
  if (gmailResult) return gmailResult;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('Chưa cấu hình Gmail hay Resend API. Bỏ qua gửi email.');
    return { skipped: true };
  }

  const qrCodeUrl = order.qrCodeUrl || createQrCodeUrl(order);
  const fromAddress = process.env.RESEND_FROM || `Thủy Mộng <${process.env.CONTACT_EMAIL || 'onboarding@resend.dev'}>`;
  const recipient = resolveResendRecipient(order.customer.email);
  const emailPayload = {
    from: fromAddress,
    to: [recipient],
    subject: `Xác nhận đặt vé ${process.env.EVENT_NAME || 'Thủy Mộng'} - ${order.orderCode}`,
    html: `
      <h2>Xin chào ${order.customer.name},</h2>
      <p>Đơn hàng của bạn đã được xác nhận thanh toán thành công.</p>
      <p><strong>Mã đơn hàng:</strong> ${order.orderCode}</p>
      <p><strong>Nơi nhận hàng:</strong> ${order.deliveryLocation || 'Nhận tại sự kiện'}</p>
      <p><strong>Tổng tiền:</strong> ${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(order.total)}</p>
      <p><strong>Thời gian:</strong> ${process.env.EVENT_CHECKIN_TEXT || '17:30 - 19:35 — 17/10/2026'}</p>
      <p><strong>Địa điểm:</strong> ${process.env.EVENT_VENUE || '361 Trường Chinh, Thanh Xuân, Hà Nội'}</p>
    `
  };

  try {
    const qrResponse = await fetchWithTimeout(qrCodeUrl, {}, 5000);
    if (qrResponse.ok) {
      const qrBuffer = Buffer.from(await qrResponse.arrayBuffer());
      emailPayload.attachments = [{
        filename: `qr-checkin-${order.orderCode}.png`,
        content: qrBuffer.toString('base64'),
        content_id: 'thuy-mong-checkin-qr'
      }];
    }
  } catch (error) {
    console.warn('QR attachment unavailable; sending email with fallback:', error.message);
  }

  const response = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(emailPayload)
  }, 8000);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Resend API error: ${response.status} ${errorText}`);
  }

  return response.json();
}

let inventoryCache = null;
let inventoryCacheTime = 0;

async function getInventory() {
  const now = Date.now();
  if (inventoryCache && (now - inventoryCacheTime < 60000)) {
    return inventoryCache;
  }

  let orders = readOrders();
  if (supabaseEnabled) {
    try {
      const rows = await supabaseRequest('orders?select=order_data');
      if (Array.isArray(rows)) {
        orders = rows.map(r => r.order_data).filter(Boolean);
      }
    } catch (e) {
      console.warn("Error fetching remote orders for inventory:", e.message);
    }
  }

  const soldQuantities = {};
  orders.forEach(order => {
    if (order.status === 'Đã thanh toán') {
      if (Array.isArray(order.items)) {
        order.items.forEach(cartItem => {
          soldQuantities[cartItem.id] = (soldQuantities[cartItem.id] || 0) + (Number(cartItem.quantity) || 0);
        });
      }
    }
  });

  inventoryCache = soldQuantities;
  inventoryCacheTime = now;
  return inventoryCache;
}

// ==========================================
// ROUTES
// ==========================================

app.get('/api/config', async (req, res) => {
  const allItems = await readItemsPersistent();
  const soldQuantities = await getInventory();

  const ticketTypes = allItems.filter(i => i.type === 'ticket').map(ticket => {
    if (ticket.baseQuantity !== undefined) {
      const sold = soldQuantities[ticket.id] || 0;
      ticket.quantity = Math.max(0, ticket.baseQuantity - sold);
    }
    return ticket;
  });

  const merchItems = allItems.filter(i => i.type === 'merch').map(merch => {
    if (merch.baseQuantity !== undefined) {
      const sold = soldQuantities[merch.id] || 0;
      merch.quantity = Math.max(0, merch.baseQuantity - sold);
    }
    return merch;
  });

  res.json({
    eventName: process.env.EVENT_NAME || 'Thủy Mộng',
    eventDate: process.env.EVENT_DATE || '2026-10-17',
    formattedDate: '17/10/2026',
    tickets: ticketTypes,
    merch: merchItems,
    contact: {
      unit: 'Nhà Hát Múa Rối Việt Nam',
      address: process.env.EVENT_VENUE || '361 Trường Chinh, Thanh Xuân, Hà Nội',
      phone: process.env.CONTACT_PHONE || '0327264235',
      email: process.env.CONTACT_EMAIL || 'myth.superking@gmail.com'
    },
    payment: {
      bankName: `${process.env.BANK_CODE || 'TPB'} Bank`,
      accountNumber: process.env.BANK_ACCOUNT_NUMBER || '20327264235',
      accountName: process.env.BANK_ACCOUNT_NAME || 'TRINH THANH MY',
      webhookUrl: `${process.env.PUBLIC_BASE_URL || 'https://thuy-mong-sk.vercel.app'}/api/sepay-webhook`
    }
  });
});

app.get('/api/health', async (req, res) => {
  const startedAt = Date.now();
  if (!supabaseEnabled) {
    return res.json({ ok: true, supabase: 'not-configured' });
  }

  try {
    await supabaseRequest('orders?select=order_code&limit=1');
    return res.json({ ok: true, supabase: 'connected', durationMs: Date.now() - startedAt });
  } catch (error) {
    return res.status(503).json({ ok: false, supabase: 'error', durationMs: Date.now() - startedAt, error: error.message });
  }
});

app.get('/api/captcha', (req, res) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let cap = '';
  for (let i = 0; i < 5; i++) {
    cap += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const secret = process.env.CAPTCHA_SECRET || 'f2e0625d9c22231ef2d0966bc08bf9b980ac905734ddcc738eed02ea06f51188';
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(cap);
  const hash = hmac.digest('hex');

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="50">
    <rect width="100%" height="100%" fill="#2c2c2c"/>`;

  for (let i = 0; i < 5; i++) {
    const x = 20 + i * 24 + Math.random() * 5;
    const y = 32 + Math.random() * 5;
    const rot = (Math.random() - 0.5) * 40;
    svg += `<text x="${x}" y="${y}" transform="rotate(${rot} ${x} ${y})" fill="#f1c66b" font-size="26" font-family="sans-serif" font-weight="bold">${cap[i]}</text>`;
  }

  for (let i = 0; i < 10; i++) {
    svg += `<line x1="${Math.random() * 160}" y1="${Math.random() * 50}" x2="${Math.random() * 160}" y2="${Math.random() * 50}" stroke="#f1c66b" stroke-width="2" opacity="0.6"/>`;
  }

  svg += `</svg>`;

  res.json({ token: hash, image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` });
});

// ==========================================
// TẠO ĐƠN HÀNG (TÁI SỬ DỤNG ĐƠN CŨ NẾU CÒN HẠN)
// ==========================================
app.post('/api/orders', async (req, res) => {
  // 1. Chống Spam: Bẫy Honeypot
  if (req.body?.website || req.body?.address_confirm) {
    console.warn('[SPAM BOT TRAPPED] Phát hiện bot điền honeypot field.');
    return res.status(400).json({ message: 'Yêu cầu không hợp lệ.' });
  }

  // 2. Chống Spam: Rate Limit IP
  const clientIp = getClientIp(req);
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({
      message: 'Bạn đang thao tác quá nhanh. Vui lòng đợi vài phút trước khi đặt thêm đơn mới.'
    });
  }

  const { customer, cart, paymentMethod, captcha } = req.body || {};

  if (!customer || !cart || !Array.isArray(cart.items) || !customer.name || !customer.phone) {
    return res.status(400).json({ message: 'Thiếu thông tin khách hàng hoặc giỏ hàng.' });
  }

  // Xác thực Captcha
  const skipCaptcha = String(process.env.SKIP_CAPTCHA).toLowerCase() === 'true';
  if (!skipCaptcha) {
    if (!captcha || !captcha.token || !captcha.answer) {
      return res.status(400).json({ message: 'Vui lòng xác thực mã bảo vệ.' });
    }

    const secret = process.env.CAPTCHA_SECRET || 'f2e0625d9c22231ef2d0966bc08bf9b980ac905734ddcc738eed02ea06f51188';
    const expectedHash = crypto.createHmac('sha256', secret).update(String(captcha.answer).trim().toUpperCase()).digest('hex');

    if (expectedHash !== captcha.token) {
      return res.status(400).json({ message: 'Mã bảo vệ không chính xác.' });
    }
  }

  const normalizedCustomer = {
    name: String(customer.name || '').trim(),
    phone: String(customer.phone || '').trim(),
    email: String(customer.email || '').trim().toLowerCase()
  };

  if (!normalizedCustomer.name || !normalizedCustomer.phone || !normalizedCustomer.email) {
    return res.status(400).json({ message: 'Vui lòng nhập đầy đủ họ tên, số điện thoại và email.' });
  }

  // Kiểm tra email MX Record
  const emailParts = normalizedCustomer.email.split('@');
  if (emailParts.length !== 2) {
    return res.status(400).json({ message: 'Địa chỉ email không đúng định dạng.' });
  }
  const domain = emailParts[1];
  try {
    const mxRecords = await dns.resolveMx(domain);
    if (!mxRecords || mxRecords.length === 0) {
      return res.status(400).json({ message: 'Tên miền email này không có máy chủ nhận thư.' });
    }
  } catch (error) {
    return res.status(400).json({ message: 'Tên miền email không tồn tại hoặc không thể nhận thư.' });
  }

  if (normalizedCustomer.name.length < 2) {
    return res.status(400).json({ message: 'Vui lòng nhập họ tên đầy đủ.' });
  }

  const cleanPhone = normalizedCustomer.phone.replace(/\D/g, '');
  const vnPhoneRegex = /^0(3|5|7|8|9)[0-9]{8}$/;
  if (!vnPhoneRegex.test(cleanPhone)) {
    return res.status(400).json({ message: 'Số điện thoại không hợp lệ. Vui lòng nhập số điện thoại Việt Nam thực tế.' });
  }

  // 3. Chống Spam: Tìm đơn "Chờ thanh toán" MỚI NHẤT còn hiệu lực (< 15 phút) của người dùng này
  const currentTime = Date.now();
  const fifteenMinutesAgo = new Date(currentTime - ORDER_EXPIRY_MS).toISOString();
  let matchedPendingOrders = [];

  // A. Truy vấn từ Supabase
  if (supabaseEnabled) {
    try {
      const pendingRows = await supabaseRequest(
        `orders?order_data->>status=eq.Chờ thanh toán&created_at=gte.${encodeURIComponent(fifteenMinutesAgo)}&select=order_data`
      );

      if (Array.isArray(pendingRows)) {
        matchedPendingOrders = pendingRows
          .map((r) => r.order_data)
          .filter((o) => {
            if (!o || !o.customer) return false;
            const phoneMatch = String(o.customer.phone || '').replace(/\D/g, '') === cleanPhone;
            const emailMatch = String(o.customer.email || '').toLowerCase().trim() === normalizedCustomer.email;
            return (phoneMatch || emailMatch);
          });
      }
    } catch (err) {
      console.warn('Lỗi kiểm tra pending orders trên Supabase:', err.message);
    }
  }

  // B. Fallback kiểm tra thêm trong cache local
  if (matchedPendingOrders.length === 0) {
    const localOrders = readOrders();
    matchedPendingOrders = localOrders.filter((o) => {
      if (o.status !== 'Chờ thanh toán') return false;
      const phoneMatch = String(o.customer?.phone || '').replace(/\D/g, '') === cleanPhone;
      const emailMatch = String(o.customer?.email || '').toLowerCase().trim() === normalizedCustomer.email;
      const isNotExpired = (currentTime - new Date(o.createdAt).getTime()) < ORDER_EXPIRY_MS;
      return (phoneMatch || emailMatch) && isNotExpired;
    });
  }

  // C. SẮP XẾP MỚI NHẤT LÊN ĐẦU VÀ LẤY ĐƠN ĐẦU TIÊN
  matchedPendingOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const existingPendingOrder = matchedPendingOrders[0] || null;

  // NẾU ĐÃ CÓ ĐƠN CHỜ THANH TOÁN -> DẪN VỀ MÃ QR ĐƠN MỚI NHẤT
  if (existingPendingOrder) {
    const existingPayment = createBankPayment(existingPendingOrder);
    const existingExpiresAt = new Date(new Date(existingPendingOrder.createdAt).getTime() + ORDER_EXPIRY_MS).toISOString();
    return res.status(200).json({
      message: 'Bạn có một đơn hàng đang chờ thanh toán. Đang chuyển bạn đến mã thanh toán...',
      isExistingOrder: true,
      order: {
        ...existingPendingOrder,
        expiresAt: existingExpiresAt
      },
      payment: existingPayment
    });
  }

  // 4. Nếu chưa có đơn pending -> Tạo đơn mới bình thường
  const items = cart.items.map((item) => ({
    id: item.id,
    name: item.name,
    price: Number(item.price) || 0,
    quantity: Number(item.quantity) || 0,
    type: item.type || 'ticket'
  }));

  if (!items.length || items.some((item) => !item.id || !item.name || item.quantity <= 0 || item.price < 0)) {
    return res.status(400).json({ message: 'Số lượng sản phẩm phải lớn hơn 0.' });
  }

  const total = calculateOrderTotal(items);
  const orderCode = generateOrderCode();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ORDER_EXPIRY_MS).toISOString();
  const normalizedPaymentMethod = String(paymentMethod || 'BANK_TRANSFER').toUpperCase();
  const proofImage = String(req.body?.proofImage || '').trim();
  const deliveryLocation = String(req.body?.deliveryLocation || 'Nhận tại sự kiện').trim();
  const itemsStr = items.map(item => `${item.name} (x${item.quantity})`).join(', ');

  const order = {
    id: `TM-${Date.now()}`,
    orderCode,
    customer: {
      name: normalizedCustomer.name,
      phone: normalizedCustomer.phone,
      email: normalizedCustomer.email
    },
    deliveryLocation: deliveryLocation || 'Nhận tại sự kiện',
    paymentMethod: normalizedPaymentMethod,
    items,
    itemsStr,
    total,
    status: 'Chờ thanh toán',
    ticketStatus: 'Chưa thanh toán',
    createdAt: now,
    expiresAt,
    qrCodeUrl: null,
    emailSent: false,
    checkedInAt: null,
    proofImage: proofImage || null,
    proofUploadedAt: proofImage ? now : null
  };

  const payment = createBankPayment(order);

  await saveOrderPersistent(order);
  inventoryCacheTime = 0;

  // Ghi đơn vào Google Sheet ngầm (Non-blocking)
  const sheetWebhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  if (sheetWebhookUrl) {
    fetchWithTimeout(sheetWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'CREATE_ORDER',
        createdAt: order.createdAt,
        orderCode: order.orderCode,
        customerName: order.customer.name,
        customerPhone: order.customer.phone,
        customerEmail: order.customer.email,
        deliveryLocation: order.deliveryLocation,
        status: order.status,
        items: order.itemsStr,
        total: order.total
      })
    }, 5000).catch((err) => {
      console.warn('Lỗi gửi dữ liệu tạo đơn về Sheet:', err.message);
    });
  }

  res.status(201).json({
    message: 'Đặt vé thành công!',
    isExistingOrder: false,
    order,
    payment
  });
});

app.get('/api/orders/:orderCode/status', async (req, res) => {
  const order = await findOrderPersistent(req.params.orderCode);
  const email = String(req.query.email || '').trim().toLowerCase();

  if (!order) {
    return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
  }

  if (email && String(order.customer.email || '').trim().toLowerCase() !== email) {
    return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
  }

  const createdAtMs = new Date(order.createdAt).getTime();
  const expiresAtMs = createdAtMs + ORDER_EXPIRY_MS;
  const isExpired = Date.now() > expiresAtMs;

  // Nếu đơn đang 'Chờ thanh toán' mà đã quá 15 phút -> Chuyển thành Đã hết hạn
  if (order.status === 'Chờ thanh toán' && isExpired) {
    order.status = 'Đã hết hạn';
    await saveOrderPersistent(order);
  }

  const payment = createBankPayment(order);

  return res.json({
    order: {
      orderCode: order.orderCode,
      status: order.status,
      ticketStatus: order.ticketStatus,
      total: order.total,
      deliveryLocation: order.deliveryLocation || 'Nhận tại sự kiện',
      qrCodeUrl: order.qrCodeUrl,
      emailSent: order.emailSent,
      emailError: order.emailError || null,
      paidAt: order.paidAt || null,
      checkedInAt: order.checkedInAt || null,
      createdAt: order.createdAt,
      expiresAt: new Date(expiresAtMs).toISOString()
    },
    payment
  });
});

// POST /api/orders/:orderCode/cancel
app.post('/api/orders/:orderCode/cancel', async (req, res) => {
  const { orderCode } = req.params;
  const order = await findOrderPersistent(orderCode);

  if (!order) {
    return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
  }

  if (order.status === 'Đã thanh toán') {
    return res.status(400).json({ message: 'Đơn hàng đã thanh toán thành công, không thể hủy.' });
  }

  // 1. Cập nhật DB
  order.status = 'Đã hủy';
  await saveOrderPersistent(order);
  inventoryCacheTime = 0;

  // 2. Đồng bộ sang Google Sheet - BẮT BUỘC DÙNG AWAIT TRÊN VERCEL
  const sheetWebhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  if (sheetWebhookUrl) {
    try {
      await fetchWithTimeout(sheetWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'follow', // Bắt buộc cho Apps Script 302
        body: JSON.stringify({
          action: 'CANCEL_ORDER',
          orderCode: order.orderCode
        })
      }, 7000);
      console.log(`[CANCEL SUCCESS] Đã gửi lệnh xóa đơn ${order.orderCode} sang Google Sheet.`);
    } catch (err) {
      console.warn('[CANCEL ERROR] Lỗi xóa đơn trên Sheet:', err.message);
    }
  }

  return res.json({ success: true, message: 'Đã hủy đơn hàng thành công.' });
});
// ==========================================
// SEPAY WEBHOOK (XÁC NHẬN TIỀN VÀO)
// ==========================================
const webhookPaths = ['/api/sepay-webhook', '/sepay-webhook'];

app.all(webhookPaths, async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      message: 'SePay webhook endpoint is active and listening.'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const payload = req.body || {};
    const transaction = (payload.data && typeof payload.data === 'object' ? payload.data : payload) || {};

    if (payload.test === true || transaction.test === true) {
      return res.status(200).json({ success: true, message: 'Webhook test verified.' });
    }

    const transferType = String(transaction.transferType || payload.transferType || 'in').toLowerCase();
    if (transferType !== 'in') {
      return res.status(200).json({ success: true, message: 'Bỏ qua giao dịch ra' });
    }

    const rawContent = [
      transaction.content,
      transaction.description,
      transaction.transactionContent,
      payload.content,
      payload.description
    ].filter(Boolean).join(' ');

    const normalizedContent = rawContent.replace(/[\s\-_]/g, '').toUpperCase();
    const match = /(TM\d{10,15}[A-Z0-9]+)/i.exec(normalizedContent) || /(TM26[A-Z0-9]{6})/i.exec(normalizedContent);

    if (!match) {
      return res.status(200).json({
        success: true,
        message: `Bỏ qua: Không tìm thấy mã đơn hàng trong nội dung "${rawContent}"`
      });
    }

    const extractedCleanCode = match[1].toUpperCase();
    const rawAmount = transaction.transferAmount ?? transaction.amount ?? payload.amount ?? 0;
    const amount = Number(rawAmount || 0);

    const existingOrders = await readOrdersPersistent();
    let order = existingOrders.find((entry) => {
      const cleanDbCode = String(entry.orderCode || entry.order_code || '').replace(/[\s\-_]/g, '').toUpperCase();
      return cleanDbCode === extractedCleanCode || normalizedContent.includes(cleanDbCode);
    });

    if (!order) {
      const remoteOrder = await findOrderPersistent(extractedCleanCode);
      if (remoteOrder) {
        order = remoteOrder;
      }
    }

    if (!order) {
      return res.status(200).json({
        success: true,
        message: `Đã nhận webhook nhưng chưa tìm thấy đơn khớp với mã ${extractedCleanCode}`
      });
    }

    if (Number(order.total) > 0 && amount < Number(order.total)) {
      return res.status(200).json({ message: 'Số tiền thanh toán chưa đủ với giá trị đơn hàng.', order });
    }

    if (order.status === 'Đã thanh toán' && order.emailSent) {
      return res.status(200).json({ message: 'Đơn hàng đã được xác nhận từ trước.', order });
    }

    const now = new Date().toISOString();
    order.status = 'Đã thanh toán';
    order.ticketStatus = 'Chưa sử dụng';
    order.paidAt = order.paidAt || now;
    order.qrCodeUrl = order.qrCodeUrl || createQrCodeUrl(order);

    // Gửi email vé
    try {
      const emailResult = await sendResendEmail(order);
      order.emailSent = !emailResult.skipped;
      order.emailId = emailResult?.id || null;
      delete order.emailError;
    } catch (mailErr) {
      order.emailSent = false;
      order.emailError = mailErr.message;
      console.error('Lỗi gửi email:', mailErr.message);
    }

    await saveOrderPersistent(order);
    inventoryCacheTime = 0;

    // Cập nhật Google Sheet
    const sheetWebhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
    if (sheetWebhookUrl) {
      try {
        await fetchWithTimeout(sheetWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'CONFIRM_PAID',
            createdAt: order.createdAt,
            paidAt: order.paidAt,
            orderCode: order.orderCode,
            customerName: order.customer?.name || '',
            customerPhone: order.customer?.phone || '',
            customerEmail: order.customer?.email || '',
            deliveryLocation: order.deliveryLocation || 'Nhận tại sự kiện',
            status: order.status,
            items: order.itemsStr || (order.items || []).map((i) => `${i.name} (x${i.quantity})`).join(', '),
            total: order.total
          })
        }, 7000);
      } catch (sheetErr) {
        console.warn('Lỗi gửi xác nhận thanh toán sang Google Sheet:', sheetErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Xác nhận thanh toán thành công!',
      orderCode: order.orderCode
    });

  } catch (err) {
    console.error('Lỗi xử lý webhook:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// ADMIN CHECK-IN
// ==========================================
app.post('/api/admin/checkin', async (req, res) => {
  const { qrCode } = req.body || {};
  if (!qrCode) {
    return res.status(400).json({ message: 'Thiếu dữ liệu mã QR.' });
  }

  const orderCode = decodeQrPayload(qrCode);
  if (!orderCode) {
    return res.status(400).json({ message: 'Mã QR không hợp lệ.' });
  }

  let order = await findOrderPersistent(orderCode);
  if (!order) {
    const allOrders = await readOrdersPersistent(5000);
    order = allOrders.find(o =>
      o.orderCode === orderCode ||
      o.orderCode.replace(/[\s\-_]/g, '') === orderCode.replace(/[\s\-_]/g, '')
    );
  }

  if (!order) {
    return res.status(404).json({ message: 'Không tìm thấy vé tương ứng với mã QR.' });
  }

  if (order.status !== 'Đã thanh toán') {
    return res.status(409).json({ message: 'Vé chưa được thanh toán, chưa thể check-in.' });
  }

  if (order.ticketStatus === 'Đã sử dụng') {
    const timeText = order.checkedInAt
      ? new Date(order.checkedInAt).toLocaleTimeString('vi-VN')
      : 'trước đó';
    return res.status(409).json({
      message: `Vé này đã được check-in lúc ${timeText}!`,
      order
    });
  }

  order.ticketStatus = 'Đã sử dụng';
  order.checkedInAt = new Date().toISOString();
  await saveOrderPersistent(order);

  const sheetWebhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  if (sheetWebhookUrl) {
    try {
      await fetchWithTimeout(sheetWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CHECKIN',
          orderCode: order.orderCode,
          checkedInAt: order.checkedInAt,
          ticketStatus: 'Đã sử dụng',
          customerName: order.customer?.name || '',
          customerEmail: order.customer?.email || '',
          items: order.itemsStr || (order.items || []).map((i) => `${i.name} (x${i.quantity})`).join(', ')
        })
      }, 7000);
    } catch (sheetErr) {
      console.error('[CHECKIN ERROR] Lỗi đồng bộ check-in sang Google Sheet:', sheetErr.message);
    }
  }

  return res.status(200).json({
    message: 'Check-in vé thành công!',
    order: {
      orderCode: order.orderCode,
      customerName: order.customer?.name,
      customerEmail: order.customer?.email || '',
      itemsStr: order.itemsStr || (order.items || []).map(i => `${i.name} (x${i.quantity})`).join(', '),
      ticketStatus: order.ticketStatus,
      checkedInAt: order.checkedInAt
    }
  });
});

function requireAdminAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const expectedToken = Buffer.from(
    `${process.env.ADMIN_USERNAME || 'admin'}:${process.env.ADMIN_PASSWORD || 'admin123'}`
  ).toString('base64');

  if (authHeader === `Basic ${expectedToken}` || req.headers['x-admin-token'] === expectedToken) {
    return next();
  }
  return res.status(401).json({ message: 'Bạn chưa đăng nhập hoặc phiên làm việc đã hết hạn.' });
}

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  const expectedUser = process.env.ADMIN_USERNAME || 'admin';
  const expectedPass = process.env.ADMIN_PASSWORD || 'admin123';

  if (username === expectedUser && password === expectedPass) {
    const token = Buffer.from(`${expectedUser}:${expectedPass}`).toString('base64');
    return res.json({ success: true, token });
  }

  return res.status(401).json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu.' });
});

app.get('/api/admin/items', async (req, res) => {
  const items = await readItemsPersistent();
  const soldQuantities = await getInventory();

  const updatedItems = items.map(item => {
    if (item.baseQuantity !== undefined) {
      const sold = soldQuantities[item.id] || 0;
      item.quantity = Math.max(0, item.baseQuantity - sold);
    }
    return item;
  });

  res.json(updatedItems);
});

app.get('/api/admin/checkin-history', requireAdminAuth, async (req, res) => {
  try {
    const allOrders = await readOrdersPersistent(5000);
    const scannedOrders = allOrders
      .filter((o) => o.ticketStatus === 'Đã sử dụng' && o.checkedInAt)
      .sort((a, b) => new Date(b.checkedInAt) - new Date(a.checkedInAt))
      .map((o) => ({
        orderCode: o.orderCode,
        customerName: o.customer?.name || 'Khách',
        customerPhone: o.customer?.phone || '',
        customerEmail: o.customer?.email || '',
        itemsStr: o.itemsStr || (o.items || []).map((i) => `${i.name} (x${i.quantity})`).join(', '),
        total: o.total,
        checkedInAt: o.checkedInAt
      }));

    return res.json({ success: true, count: scannedOrders.length, data: scannedOrders });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/items', async (req, res) => {
  const newItem = req.body;
  if (!newItem || !newItem.id || !newItem.name) {
    return res.status(400).json({ error: 'Thiếu thông tin bắt buộc (id, name).' });
  }

  let items = await readItemsPersistent();
  const index = items.findIndex(i => i.id === newItem.id);
  const soldQuantities = await getInventory();
  const sold = soldQuantities[newItem.id] || 0;

  if (index !== -1) {
    if (newItem.quantity !== undefined) {
      newItem.baseQuantity = Number(newItem.quantity);
      delete newItem.quantity;
    }
    items[index] = { ...items[index], ...newItem };
  } else {
    if (newItem.quantity !== undefined) {
      newItem.baseQuantity = Number(newItem.quantity);
      delete newItem.quantity;
    }
    items.push(newItem);
  }

  if (await saveItemsPersistent(items)) {
    res.json({ success: true, item: items[index !== -1 ? index : items.length - 1] });
  } else {
    res.status(500).json({ error: 'Không thể lưu mặt hàng.' });
  }
});

app.delete('/api/admin/items/:id', async (req, res) => {
  const itemId = String(req.params.id || '').trim();
  if (!itemId) {
    return res.status(400).json({ error: 'Thiếu ID mặt hàng.' });
  }

  try {
    let items = await readItemsPersistent();
    const filtered = items.filter((item) => String(item.id) !== itemId);

    if (filtered.length === items.length) {
      return res.status(404).json({ error: 'Không tìm thấy mặt hàng để xóa.' });
    }

    const saved = await saveItemsPersistent(filtered);
    if (!saved) {
      return res.status(500).json({ error: 'Không thể xóa mặt hàng.' });
    }

    if (supabaseEnabled) {
      try {
        await supabaseRequest(`items?item_id=eq.${encodeURIComponent(itemId)}`, { method: 'DELETE' });
      } catch (error) {
        console.warn('Supabase delete item failed:', error.message);
      }
    }

    return res.json({ success: true, deletedId: itemId });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Không thể xóa mặt hàng.' });
  }
});

app.get(['/admin', '/api/admin'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get(['/contact', '/api/contact'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'contact.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`Thủy Mộng app is running at http://localhost:${port}`);
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
  decodeQrPayload,
  getOrderSummary
};