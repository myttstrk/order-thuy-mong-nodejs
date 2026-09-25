import { createFileRoute } from "@tanstack/react-router";
import { sendTicketEmail } from "@/lib/mailer.server";

/**
 * Webhook nhận biến động số dư từ SePay.
 * Cấu hình URL trong SePay: <domain>/api/public/sepay-webhook
 */
export const Route = createFileRoute("/api/public/sepay-webhook")({
  // `server.handlers` is supported by the TanStack Start server route API, but not by the
  // client-side route typings in the currently installed package version. Cast the config so
  // the route remains usable without breaking the TypeScript checker.
  server: {
    handlers: {
      GET: async () => {
        return Response.json({
          success: true,
          message: "SePay webhook endpoint is active and listening for POST events.",
        });
      },

      POST: async ({ request }) => {
        // 1. Kiểm tra xác thực API Key từ SePay
        const expectedKey = process.env["SEPAY_WEBHOOK_API_KEY"] || process.env["SEPAY_API_KEY"];
        const authHeader = request.headers.get("authorization") ?? "";
        const providedKey = authHeader.replace(/^Apikey\s+/i, "").replace(/^Bearer\s+/i, "").trim();

        let payload: Record<string, unknown> = {};
        try {
          payload = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ success: false, message: "Body không hợp lệ" }, { status: 400 });
        }

        // Kiểm tra API Key (bỏ qua nếu là sự kiện test do SePay gửi)
        const isTestRequest = Boolean(payload["test"] || (payload["data"] as Record<string, unknown>)?.["test"]);
        if (expectedKey && !isTestRequest && providedKey !== expectedKey) {
          return Response.json({ success: false, message: "Sai API key" }, { status: 401 });
        }

        // SePay có thể bọc transaction trong payload.data hoặc đặt trực tiếp ở root
        const transaction = (payload["data"] && typeof payload["data"] === "object"
          ? payload["data"]
          : payload) as Record<string, unknown>;

        // Phản hồi thành công ngay nếu là request test kết nối từ SePay
        if (isTestRequest) {
          return Response.json({ success: true, message: "Webhook test connection verified." });
        }

        // 2. Chỉ xử lý tiền vào (in)
        const transferType = String(transaction["transferType"] ?? payload["transferType"] ?? "in").toLowerCase();
        if (transferType !== "in") {
          return Response.json({ success: true, message: "Bỏ qua giao dịch chuyển ra" });
        }

        const amount = Number(transaction["transferAmount"] ?? transaction["amount"] ?? payload["amount"] ?? 0);
        const content = [
          transaction["content"],
          transaction["description"],
          transaction["code"],
          payload["content"],
          payload["description"],
          payload["code"],
        ]
          .filter(Boolean)
          .join(" ");

        const reference = String(
          transaction["referenceCode"] ?? transaction["id"] ?? payload["referenceCode"] ?? payload["id"] ?? ""
        );

        // 3. Bóc tách mã đơn hàng:
        // Khớp pattern MUA_VE_TM26XXXXXX hoặc TM-Timestamp-XXXXX
        const match =
          /MUA[_\s-]?VE[_\s-]?(TM26[A-Z0-9]{6})/i.exec(content) ||
          /(TM-\d+-[A-Z0-9]+)/i.exec(content) ||
          /(TM26[A-Z0-9]{6})/i.exec(content);

        if (!match) {
          return Response.json({
            success: true,
            message: "Không tìm thấy mã đơn hàng trong nội dung giao dịch",
          });
        }

        const orderCode = match[1]!.toUpperCase();

        // 4. Truy vấn đơn hàng từ Supabase
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: order, error: fetchError } = await supabaseAdmin
          .from("orders")
          .select("id, order_code, customer_name, customer_email, customer_phone, delivery_location, total_amount, status, checkin_token")
          .eq("order_code", orderCode)
          .maybeSingle();

        if (fetchError || !order) {
          return Response.json({ success: false, message: "Không tìm thấy đơn hàng" }, { status: 404 });
        }

        // Chống lặp nếu đã thanh toán
        if (order.status === "paid" || order.status === "used" || order.status === "Đã thanh toán") {
          return Response.json({ success: true, message: "Đơn hàng đã được thanh toán trước đó" });
        }

        // 5. Kiểm tra số tiền nhận được
        if (amount < Number(order.total_amount)) {
          await supabaseAdmin
            .from("orders")
            .update({ note: `Chuyển thiếu: nhận ${amount}đ / cần ${order.total_amount}đ` })
            .eq("id", order.id);
          return Response.json({ success: false, message: "Số tiền chưa đủ" }, { status: 409 });
        }

        const paidAt = new Date().toISOString();

        // 6. Cập nhật trạng thái sang "paid"
        await supabaseAdmin
          .from("orders")
          .update({
            status: "paid",
            paid_at: paidAt,
            bank_reference: reference,
          })
          .eq("id", order.id);

        // 7. Lấy danh sách item để gửi mail và đồng bộ Sheet
        const { data: items } = await supabaseAdmin
          .from("order_items")
          .select("item_name, unit_price, quantity")
          .eq("order_id", order.id);

        const safeItems = items ?? [];
        const itemsStr = safeItems.map((it) => `${it.item_name} (x${it.quantity})`).join(", ");

        // 8. Tự động gửi Email vé kèm mã QR Check-in
        let sent = false;
        try {
          sent = await sendTicketEmail({
            orderCode: order.order_code,
            customerName: order.customer_name,
            customerEmail: order.customer_email,
            total: order.total_amount,
            checkinToken: order.checkin_token,
            items: safeItems,
          });

          if (sent) {
            await supabaseAdmin
              .from("orders")
              .update({ email_sent_at: new Date().toISOString() })
              .eq("id", order.id);
          }
        } catch (emailErr) {
          console.error("Lỗi gửi ticket email:", emailErr);
        }

        // 9. Đồng bộ sang Google Sheet (nếu có cấu hình webhook Apps Script)
        const sheetWebhookUrl = process.env["GOOGLE_SHEET_WEBHOOK_URL"];
        if (sheetWebhookUrl) {
          try {
            await fetch(sheetWebhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "CONFIRM_PAID",
                orderCode: order.order_code,
                customerName: order.customer_name,
                customerPhone: order.customer_phone || "",
                customerEmail: order.customer_email,
                deliveryLocation: order.delivery_location || "Nhận tại sự kiện",
                status: "Đã thanh toán",
                items: itemsStr,
                total: order.total_amount,
                paidAt,
              }),
            });
          } catch (sheetErr) {
            console.error("Lỗi gửi webhook Google Sheet:", sheetErr);
          }
        }

        return Response.json({
          success: true,
          orderCode,
          emailSent: sent,
        });
      },
    },
  },
});