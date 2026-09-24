const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { app } = require('../server');

const request = async (fetchImpl, method, path, body, port) => {
  const response = await fetchImpl(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await response.json();
  return { status: response.status, json };
};

test('POST /api/orders stores expiry metadata and marks orders as expired when time passes', async () => {
  process.env.ORDER_EXPIRY_MINUTES = '0.001';
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const result = await request(global.fetch, 'POST', '/api/orders', {
      customer: { name: 'Khách hết hạn', phone: '0900000001', email: 'expired@example.com' },
      cart: { items: [{ id: 'pt', name: 'Vé Phổ Thông', price: 100000, quantity: 1, type: 'ticket' }] },
      paymentMethod: 'BANK',
      captcha: { token: 'skip', answer: 'skip' }
    }, port);

    assert.equal(result.status, 201);
    assert.ok(result.json.order.expiresAt);

    await new Promise((resolve) => setTimeout(resolve, 200));

    const status = await request(global.fetch, 'GET', `/api/orders/${result.json.order.orderCode}/status?email=expired%40example.com`, null, port);
    assert.equal(status.status, 200);
    assert.equal(status.json.order.status, 'Hết hạn');
  } finally {
    delete process.env.ORDER_EXPIRY_MINUTES;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/orders enforces rate limiting for suspicious repeated checkout attempts', async () => {
  process.env.ORDER_RATE_LIMIT_ENABLED = 'true';
  process.env.ORDER_RATE_LIMIT_WINDOW_MS = '60000';
  process.env.ORDER_RATE_LIMIT_MAX_REQUESTS = '2';

  const server = app.listen(0);
  try {
    const port = server.address().port;
    const body = {
      customer: { name: 'Khách spam', phone: '0901111111', email: 'spam@example.com' },
      cart: { items: [{ id: 'pt', name: 'Vé Phổ Thông', price: 100000, quantity: 1, type: 'ticket' }] },
      paymentMethod: 'BANK',
      captcha: { token: 'skip', answer: 'skip' }
    };

    const first = await request(global.fetch, 'POST', '/api/orders', body, port);
    const second = await request(global.fetch, 'POST', '/api/orders', body, port);
    const third = await request(global.fetch, 'POST', '/api/orders', body, port);

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(third.status, 429);
  } finally {
    delete process.env.ORDER_RATE_LIMIT_ENABLED;
    delete process.env.ORDER_RATE_LIMIT_WINDOW_MS;
    delete process.env.ORDER_RATE_LIMIT_MAX_REQUESTS;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/orders creates a pending order with total and orderCode', async () => {
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const result = await request(global.fetch, 'POST', '/api/orders', {
      customer: { name: 'Nguyễn Văn A', phone: '0900000000', email: 'a@example.com' },
      cart: { items: [{ id: 'pt', name: 'Vé Phổ Thông', price: 100000, quantity: 2, type: 'ticket' }] },
      paymentMethod: 'BANK'
    }, port);

    assert.equal(result.status, 201);
    assert.equal(result.json.message, 'Đặt vé thành công!');
    assert.equal(result.json.order.status, 'Chờ thanh toán');
    assert.equal(result.json.order.total, 200000);
    assert.ok(result.json.order.orderCode);

    const status = await request(global.fetch, 'GET', `/api/orders/${result.json.order.orderCode}/status?email=a%40example.com`, null, port);
    assert.equal(status.status, 200);
    assert.equal(status.json.order.status, 'Chờ thanh toán');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/orders saves deliveryLocation and defaults to Nhận tại sự kiện', async () => {
  const server = app.listen(0);
  try {
    const port = server.address().port;

    const resNeu = await request(global.fetch, 'POST', '/api/orders', {
      customer: { name: 'Khách NEU', phone: '0901234567', email: 'neu@example.com' },
      deliveryLocation: 'Nhận ở NEU',
      cart: { items: [{ id: 'pt', name: 'Vé Phổ Thông', price: 100000, quantity: 1, type: 'ticket' }] },
      paymentMethod: 'BANK'
    }, port);

    assert.equal(resNeu.status, 201);
    assert.equal(resNeu.json.order.deliveryLocation, 'Nhận ở NEU');

    const statusNeu = await request(global.fetch, 'GET', `/api/orders/${resNeu.json.order.orderCode}/status?email=neu%40example.com`, null, port);
    assert.equal(statusNeu.status, 200);
    assert.equal(statusNeu.json.order.deliveryLocation, 'Nhận ở NEU');

    const resDefault = await request(global.fetch, 'POST', '/api/orders', {
      customer: { name: 'Khách Sự Kiện', phone: '0907654321', email: 'event@example.com' },
      cart: { items: [{ id: 'pt', name: 'Vé Phổ Thông', price: 100000, quantity: 1, type: 'ticket' }] },
      paymentMethod: 'BANK'
    }, port);

    assert.equal(resDefault.status, 201);
    assert.equal(resDefault.json.order.deliveryLocation, 'Nhận tại sự kiện');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/orders requires email at checkout so QR can be sent later', async () => {
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const result = await request(global.fetch, 'POST', '/api/orders', {
      customer: { name: 'Khách không email', phone: '0909999999', email: '' },
      cart: { items: [{ id: 'pt', name: 'Vé Phổ Thông', price: 1000, quantity: 1, type: 'ticket' }] },
      paymentMethod: 'BANK'
    }, port);

    assert.equal(result.status, 400);
    assert.match(result.json.message, /email/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/admin/confirm-payment marks a pending order as paid', async () => {
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const created = await request(global.fetch, 'POST', '/api/orders', {
      customer: { name: 'Khách xác nhận', phone: '0907777777', email: 'confirm@example.com' },
      cart: { items: [{ id: 'tc', name: 'Vé Tiêu Chuẩn', price: 150000, quantity: 1, type: 'ticket' }] },
      paymentMethod: 'BANK'
    }, port);

    const response = await request(global.fetch, 'POST', '/api/admin/confirm-payment', {
      orderCode: created.json.order.orderCode
    }, port);

    assert.equal(response.status, 200);
    assert.equal(response.json.order.status, 'Đã thanh toán');
    assert.ok(response.json.order.qrCodeUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/orders accepts payment proof image and admin confirmation emails QR', async () => {
  const originalFetch = global.fetch;
  const server = app.listen(0);

  try {
    process.env.RESEND_API_KEY = 'test-key';
    const port = server.address().port;

    global.fetch = async (url, options) => {
      if (String(url).includes('api.resend.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'email-proof' }),
          text: async () => ''
        };
      }
      return originalFetch(url, options);
    };

    const created = await request(global.fetch, 'POST', '/api/orders', {
      customer: { name: 'Khách chụp ảnh', phone: '0901111111', email: 'proof@example.com' },
      cart: { items: [{ id: 'pt', name: 'Vé Phổ Thông', price: 100000, quantity: 1, type: 'ticket' }] },
      paymentMethod: 'BANK',
      proofImage: 'data:image/png;base64,AAAA'
    }, port);

    assert.equal(created.status, 201);
    assert.equal(created.json.order.proofImage, 'data:image/png;base64,AAAA');

    const response = await request(global.fetch, 'POST', '/api/admin/confirm-payment', {
      orderCode: created.json.order.orderCode
    }, port);

    assert.equal(response.status, 200);
    assert.equal(response.json.order.status, 'Đã thanh toán');
    assert.ok(response.json.order.qrCodeUrl);
    assert.equal(response.json.order.customer.email, 'proof@example.com');
  } finally {
    global.fetch = originalFetch;
    delete process.env.RESEND_API_KEY;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/admin/confirm-payment rejects payment when Google Sheet has no matching transaction', async () => {
  const originalFetch = global.fetch;
  const server = app.listen(0);

  try {
    const port = server.address().port;
    process.env.GOOGLE_SHEET_URL = 'https://example.com/sheet.csv';
    global.fetch = async (url, options) => {
      if (String(url).startsWith('https://example.com')) {
        return new Response('orderCode,amount,content,status\nTM-FAKE,999999,TM-FAKE,success\n', {
          status: 200,
          headers: { 'Content-Type': 'text/csv; charset=utf-8' }
        });
      }
      return originalFetch(url, options);
    };

    const created = await request(global.fetch, 'POST', '/api/orders', {
      customer: { name: 'Khách sheet', phone: '0908888888', email: 'sheet@example.com' },
      cart: { items: [{ id: 'pt', name: 'Vé Phổ Thông', price: 90000, quantity: 1, type: 'ticket' }] },
      paymentMethod: 'BANK'
    }, port);

    const response = await request(global.fetch, 'POST', '/api/admin/confirm-payment', {
      orderCode: created.json.order.orderCode
    }, port);

    assert.equal(response.status, 409);
    assert.match(response.json.message, /Google Sheet|không khớp|không tìm thấy/i);
  } finally {
    delete process.env.GOOGLE_SHEET_URL;
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/sepay-webhook accepts webhook signatures generated from raw request body', async () => {
  const originalFetch = global.fetch;
  const server = app.listen(0);

  try {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.SEPAY_WEBHOOK_SECRET = 'test-secret';

    const port = server.address().port;
    const created = await request(global.fetch, 'POST', '/api/orders', {
      customer: { name: 'Nguyễn Văn C', phone: '0902222222', email: 'c@example.com' },
      cart: { items: [{ id: 'cc', name: 'Vé Cao Cấp', price: 160000, quantity: 1, type: 'ticket' }] },
      paymentMethod: 'MOMO'
    }, port);

    const orderCode = created.json.order.orderCode;
    const payload = {
      amount: 160000,
      orderCode,
      code: '00',
      description: orderCode,
      transferType: 'in'
    };
    const rawBody = '{"amount":160000,"orderCode":"' + orderCode + '","code":"00","description":"' + orderCode + '","transferType":"in"}';
    const signature = crypto.createHmac('sha256', process.env.SEPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');

    global.fetch = async (url, options) => {
      if (String(url).includes('api.resend.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'email-2' }),
          text: async () => ''
        };
      }
      return originalFetch(url, options);
    };

    const response = await fetch(`http://127.0.0.1:${port}/api/sepay-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': signature
      },
      body: rawBody
    });

    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.order.status, 'Đã thanh toán');
    assert.ok(result.order.qrCodeUrl);
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/sepay-webhook accepts callbacks where SePay signs only the nested data object', async () => {
  const originalFetch = global.fetch;
  const server = app.listen(0);

  try {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.SEPAY_WEBHOOK_SECRET = 'test-secret';

    const port = server.address().port;
    const created = await request(global.fetch, 'POST', '/api/orders', {
      customer: { name: 'Nguyễn Văn E', phone: '0904444444', email: 'e@example.com' },
      cart: { items: [{ id: 'pt', name: 'Vé Phổ Thông', price: 170000, quantity: 1, type: 'ticket' }] },
      paymentMethod: 'MOMO'
    }, port);

    const orderCode = created.json.order.orderCode;
    const payload = {
      data: {
        amount: 170000,
        orderCode,
        code: '00',
        description: orderCode,
        transferType: 'in'
      }
    };
    const rawBody = JSON.stringify(payload.data);
    const signature = crypto.createHmac('sha256', process.env.SEPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');

    global.fetch = async (url, options) => {
      if (String(url).includes('api.resend.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'email-3' }),
          text: async () => ''
        };
      }
      return originalFetch(url, options);
    };

    const response = await fetch(`http://127.0.0.1:${port}/api/sepay-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sepay-signature': signature
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.order.status, 'Đã thanh toán');
    assert.ok(result.order.qrCodeUrl);
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/sepay-webhook updates status, creates QR and sends email when amount matches', async () => {
  const originalFetch = global.fetch;
  const server = app.listen(0);
  const calls = [];

  try {
    process.env.RESEND_API_KEY = 'test-key';
    const port = server.address().port;
    const created = await request(global.fetch, 'POST', '/api/orders', {
      customer: { name: 'Nguyễn Văn B', phone: '0901111111', email: 'b@example.com' },
      cart: { items: [{ id: 'tc', name: 'Vé Tiêu Chuẩn', price: 130000, quantity: 1, type: 'ticket' }] },
      paymentMethod: 'MOMO'
    }, port);

    const orderCode = created.json.order.orderCode;
    global.fetch = async (url, options) => {
      if (String(url).includes('api.resend.com')) {
        calls.push({ url, options });
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'email-1' }),
          text: async () => ''
        };
      }
      return originalFetch(url, options);
    };

    const result = await request(originalFetch, 'POST', '/api/sepay-webhook', {
      code: '00',
      orderCode,
      amount: 130000,
      description: orderCode,
      transferType: 'in'
    }, port);

    assert.equal(result.status, 200);
    assert.equal(result.json.order.status, 'Đã thanh toán');
    assert.ok(result.json.order.qrCodeUrl);
    assert.equal(calls.length >= 1, true);
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('paid order email includes QR attachment and check-in is single-use', async () => {
  const originalFetch = global.fetch;
  const server = app.listen(0);
  let resendPayload;

  try {
    process.env.RESEND_API_KEY = 'test-key';
    const port = server.address().port;
    const created = await request(originalFetch, 'POST', '/api/orders', {
      customer: { name: 'Nguyễn Văn D', phone: '0903333333', email: 'd@example.com' },
      cart: { items: [{ id: 'vip', name: 'Vé VIP', price: 200000, quantity: 1, type: 'ticket' }] },
      paymentMethod: 'BANK'
    }, port);

    const order = created.json.order;
    global.fetch = async (url, options) => {
      if (String(url).includes('api.qrserver.com')) {
        return {
          ok: true,
          arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer
        };
      }
      if (String(url).includes('api.resend.com')) {
        resendPayload = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'email-qr' }),
          text: async () => ''
        };
      }
      return originalFetch(url, options);
    };

    const paid = await request(originalFetch, 'POST', '/api/sepay-webhook', {
      code: '00',
      orderCode: order.orderCode,
      amount: 200000,
      description: order.orderCode,
      transferType: 'in'
    }, port);

    assert.equal(paid.status, 200);
    assert.equal(paid.json.order.emailSent, true);
    assert.equal(resendPayload.attachments.length, 1);
    assert.equal(resendPayload.attachments[0].filename, `qr-checkin-${order.orderCode}.png`);
    assert.match(resendPayload.html, /cid:thuy-mong-checkin-qr/);

    const qrPayload = `THUY_MONG|${order.orderCode}|${order.customer.email}|${order.customer.name}|${order.createdAt}`;
    const checkedIn = await request(originalFetch, 'POST', '/api/admin/checkin', { qrCode: qrPayload }, port);
    const repeated = await request(originalFetch, 'POST', '/api/admin/checkin', { qrCode: qrPayload }, port);

    assert.equal(checkedIn.status, 200);
    assert.equal(checkedIn.json.order.ticketStatus, 'Đã sử dụng');
    assert.equal(repeated.status, 409);
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('SePay transactionContent payload updates payment and sends QR email', async () => {
  const originalFetch = global.fetch;
  const server = app.listen(0);
  try {
    process.env.RESEND_API_KEY = 'test-key';
    const port = server.address().port;
    const created = await request(originalFetch, 'POST', '/api/orders', {
      customer: { name: 'SePay Customer', phone: '0904444444', email: 'sepay@example.com' },
      cart: { items: [{ id: 'pt', name: 'Vé Phổ Thông', price: 100000, quantity: 1, type: 'ticket' }] },
      paymentMethod: 'BANK'
    }, port);
    const order = created.json.order;

    global.fetch = async (url, options) => {
      if (String(url).includes('api.qrserver.com')) {
        return { ok: true, arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer };
      }
      if (String(url).includes('api.resend.com')) {
        return { ok: true, status: 200, json: async () => ({ id: 'email-sepay' }), text: async () => '' };
      }
      return originalFetch(url, options);
    };

    const result = await request(originalFetch, 'POST', '/api/sepay-webhook', {
      id: 123,
      transferType: 'in',
      transferAmount: 100000,
      transactionContent: `Thanh toan ${order.orderCode}`,
      referenceCode: 'FT123'
    }, port);

    assert.equal(result.status, 200);
    assert.equal(result.json.order.status, 'Đã thanh toán');
    assert.equal(result.json.order.emailSent, true);
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Resend uses testing address when customer email is example.com and test email mode is enabled', async () => {
  const originalFetch = global.fetch;
  const server = app.listen(0);
  let resendPayload;

  try {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.RESEND_ALLOW_TEST_EMAIL = 'true';
    const port = server.address().port;
    const created = await request(originalFetch, 'POST', '/api/orders', {
      customer: { name: 'Example Tester', phone: '0905555555', email: 'testlive@example.com' },
      cart: { items: [{ id: 'pt', name: 'Vé Phổ Thông', price: 100000, quantity: 1, type: 'ticket' }] },
      paymentMethod: 'BANK'
    }, port);

    const order = created.json.order;
    global.fetch = async (url, options) => {
      if (String(url).includes('api.qrserver.com')) {
        return { ok: true, arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer };
      }
      if (String(url).includes('api.resend.com')) {
        resendPayload = JSON.parse(options.body);
        return { ok: true, status: 200, json: async () => ({ id: 'email-test-example' }), text: async () => '' };
      }
      return originalFetch(url, options);
    };

    const result = await request(originalFetch, 'POST', '/api/sepay-webhook', {
      code: '00',
      orderCode: order.orderCode,
      amount: 100000,
      description: order.orderCode,
      transferType: 'in'
    }, port);

    assert.equal(result.status, 200);
    assert.equal(result.json.order.emailSent, true);
    assert.equal(resendPayload.to[0], 'delivered@resend.dev');
  } finally {
    delete process.env.RESEND_ALLOW_TEST_EMAIL;
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/orders/:orderCode/proof saves proof image and updates status', async () => {
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const created = await request(global.fetch, 'POST', '/api/orders', {
      customer: { name: 'Khách up proof', phone: '0901234567', email: 'proof@example.com' },
      cart: { items: [{ id: 'pt', name: 'Vé Phổ Thông', price: 100000, quantity: 1, type: 'ticket' }] },
      paymentMethod: 'BANK'
    }, port);

    assert.equal(created.status, 201);
    const orderCode = created.json.order.orderCode;

    const proofRes = await request(global.fetch, 'POST', `/api/orders/${orderCode}/proof`, {
      proofImage: 'data:image/jpeg;base64,sampleproofimagecontent'
    }, port);

    assert.equal(proofRes.status, 200);
    assert.equal(proofRes.json.order.orderCode, orderCode);
    assert.ok(proofRes.json.order.proofUploadedAt);

    const statusRes = await request(global.fetch, 'GET', `/api/orders/${orderCode}/status?email=proof%40example.com`, null, port);
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.json.order.proofImage, 'data:image/jpeg;base64,sampleproofimagecontent');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

