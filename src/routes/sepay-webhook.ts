import { createFileRoute } from "@tanstack/react-router";

import { sendTicketEmail } from "@/lib/mailer.server";

/**
 * Webhook nhận biến động số dư từ SePay.
 * Cấu hình URL này trong SePay: <domain>/api/public/sepay-webhook
 * Nếu đặt biến môi trường SEPAY_API_KEY, SePay phải gửi header
 * `Authorization: Apikey <giá trị>`.
 */
export const Route = createFileRoute("/api/public/sepay-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expectedKey = process.env["SEPAY_API_KEY"];
        if (expectedKey) {
          const header = request.headers.get("authorization") ?? "";
          const provided = header.replace(/^Apikey\s+/i, "").replace(/^Bearer\s+/i, "").trim();
          if (provided !== expectedKey) {
            return Response.json({ success: false, message: "Sai API key" }, { status: 401 });
          }
        }

        let payload: Record<string, unknown>;
        try {
          payload = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ success: false, message: "Body không hợp lệ" }, { status: 400 });
        }

        const transferType = String(payload["transferType"] ?? "in");
        if (transferType !== "in") {
          return Response.json({ success: true, message: "Bỏ qua giao dịch chuyển ra" });
        }

        const amount = Number(payload["transferAmount"] ?? 0);
        const content = [payload["content"], payload["description"], payload["code"]]
          .filter(Boolean)
          .join(" ");
        const reference = String(payload["referenceCode"] ?? payload["id"] ?? "");

        // Nội dung chuyển khoản có dạng MUA_VE_TM26XXXXXX (ngân hàng có thể bỏ dấu gạch dưới).
        const match = /MUA[_\s-]?VE[_\s-]?(TM26[A-Z0-9]{6})/i.exec(content);
        if (!match) {
          return Response.json({
            success: true,
            message: "Không tìm thấy mã đơn hàng trong nội dung",
          });
        }
        const orderCode = match[1]!.toUpperCase();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: order } = await supabaseAdmin
          .from("orders")
          .select("id, order_code, customer_name, customer_email, total_amount, status, checkin_token")
          .eq("order_code", orderCode)
          .maybeSingle();

        if (!order) {
          return Response.json({ success: false, message: "Không tìm thấy đơn hàng" }, { status: 404 });
        }

        if (order.status === "paid" || order.status === "used") {
          return Response.json({ success: true, message: "Đơn hàng đã được thanh toán trước đó" });
        }

        if (amount < order.total_amount) {
          await supabaseAdmin
            .from("orders")
            .update({ note: `Chuyển thiếu: nhận ${amount}đ / cần ${order.total_amount}đ` })
            .eq("id", order.id);
          return Response.json({ success: false, message: "Số tiền chưa đủ" }, { status: 409 });
        }

        await supabaseAdmin
          .from("orders")
          .update({ status: "paid", paid_at: new Date().toISOString(), bank_reference: reference })
          .eq("id", order.id);

        const { data: items } = await supabaseAdmin
          .from("order_items")
          .select("item_name, unit_price, quantity")
          .eq("order_id", order.id);

        const sent = await sendTicketEmail({
          orderCode: order.order_code,
          customerName: order.customer_name,
          customerEmail: order.customer_email,
          total: order.total_amount,
          checkinToken: order.checkin_token,
          items: items ?? [],
        });

        if (sent) {
          await supabaseAdmin
            .from("orders")
            .update({ email_sent_at: new Date().toISOString() })
            .eq("id", order.id);
        }

        return Response.json({ success: true, orderCode, emailSent: sent });
      },
    },
  },
});
