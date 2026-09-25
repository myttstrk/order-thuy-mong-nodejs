const { app } = require('../server');

module.exports = async (req, res) => {
  // Lấy URL thực tế từ headers nếu Vercel rewrite
  const requestUrl = req.headers['x-matched-path'] || req.url || '';

  // 1. Nếu request gọi vào sepay-webhook
  if (requestUrl.includes('sepay-webhook')) {
    // Cho phép GET để SePay ping kiểm tra
    if (req.method === 'GET') {
      return res.status(200).json({
        success: true,
        message: 'SePay webhook endpoint is active.'
      });
    }

    if (req.method === 'POST') {
      try {
        const payload = req.body || {};
        const transaction = (payload.data && typeof payload.data === 'object' ? payload.data : payload) || {};

        // Xử lý request test từ SePay
        if (payload.test === true || transaction.test === true) {
          return res.status(200).json({
            success: true,
            message: 'Webhook test connection verified.'
          });
        }

        // Lấy nội dung chuyển khoản
        const rawContent = [
          transaction.content,
          transaction.description,
          payload.content,
          payload.description
        ].filter(Boolean).join(' ');

        // Bỏ khoảng trắng, dấu gạch ngang để khớp mã đơn (VD: TM1790360200792VNU70)
        const normalizedContent = rawContent.replace(/[\s\-_]/g, '').toUpperCase();
        const match = /(TM\d{10,15}[A-Z0-9]+)/i.exec(normalizedContent) || /(TM26[A-Z0-9]{6})/i.exec(normalizedContent);

        if (!match) {
          return res.status(200).json({
            success: true,
            message: `Không tìm thấy mã đơn trong nội dung: ${rawContent}`
          });
        }

        const extractedCode = match[1].toUpperCase();
        const amount = Number(transaction.transferAmount || transaction.amount || payload.amount || 0);

        // Cập nhật Supabase
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (supabaseUrl && supabaseKey) {
          try {
            const queryRes = await fetch(`${supabaseUrl}/rest/v1/orders?select=*&order=created_at.desc&limit=50`, {
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`
              }
            });

            if (queryRes.ok) {
              const orders = await queryRes.json();
              const matchedOrder = orders.find((entry) => {
                const dbCode = (entry.order_code || entry.orderCode || '').replace(/[\s\-_]/g, '').toUpperCase();
                return dbCode === extractedCode || normalizedContent.includes(dbCode);
              });

              if (matchedOrder) {
                const targetCode = matchedOrder.order_code || matchedOrder.orderCode;
                await fetch(`${supabaseUrl}/rest/v1/orders?order_code=eq.${encodeURIComponent(targetCode)}`, {
                  method: 'PATCH',
                  headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=minimal'
                  },
                  body: JSON.stringify({
                    status: 'Đã thanh toán',
                    paid_at: new Date().toISOString()
                  })
                });
              }
            }
          } catch (dbErr) {
            console.warn('Lỗi Supabase:', dbErr.message);
          }
        }

        // Gửi Google Sheet nếu có
        const sheetWebhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
        if (sheetWebhookUrl) {
          try {
            await fetch(sheetWebhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'CONFIRM_PAID',
                orderCode: extractedCode,
                status: 'Đã thanh toán',
                total: amount,
                paidAt: new Date().toISOString()
              })
            });
          } catch (sheetErr) {
            console.warn('Lỗi Google Sheet:', sheetErr.message);
          }
        }

        return res.status(200).json({
          success: true,
          message: 'Xác nhận thanh toán thành công!',
          orderCode: extractedCode
        });

      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    }
  }

  // 2. Với các request khác, chuyển tiếp cho Express app trong server.js
  return app(req, res);
};