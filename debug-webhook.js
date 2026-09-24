const { app } = require('./server');

(async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const createRes = await fetch(`http://127.0.0.1:${port}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: { name: 'Nguyễn Văn B', phone: '0901111111', email: 'b@example.com' },
        cart: { items: [{ id: 'tc', name: 'Vé Tiêu Chuẩn', price: 130000, quantity: 1, type: 'ticket' }] },
        paymentMethod: 'MOMO'
      })
    });

    const created = await createRes.json();
    console.log('CREATED:', JSON.stringify(created, null, 2));

    const orderCode = created.order.orderCode;
    global.fetch = async (url, options) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'email-1' }),
      text: async () => ''
    });

    const hookRes = await fetch(`http://127.0.0.1:${port}/api/sepay-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '00', orderCode, amount: 130000, description: orderCode, transferType: 'in' })
    });

    const text = await hookRes.text();
    console.log('HOOK STATUS:', hookRes.status);
    console.log('HOOK BODY:', text);
  } finally {
    server.close();
  }
})();
