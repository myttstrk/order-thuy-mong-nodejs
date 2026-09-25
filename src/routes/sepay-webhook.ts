import { createFileRoute } from "@tanstack/react-router";
import { sendTicketEmail } from "@/lib/mailer.server";

export const Route = createFileRoute("/api/sepay-webhook")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({
          success: true,
          message: "SePay webhook endpoint is active and listening for POST events.",
        });
      },

      POST: async ({ request }) => {
        // 1. Kiểm tra API Key từ SePay
        const expectedKey = process.env["SEPAY_WEBHOOK_API_KEY"] || process.env["SEPAY_API_KEY"];
        const authHeader = request.headers.get("authorization") ?? "";
        const providedKey = authHeader.replace(/^Apikey\s+/i, "").replace(/^Bearer\s+/i, "").trim();

        let payload: Record<string, unknown> = {};
        try {
          payload = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ success: false, message: "Body không hợp lệ" }, { status: 400 });
        }

        // Bỏ qua kiểm tra key nếu là request test kết nối từ SePay
        const isTestRequest = Boolean(payload["test"] || (payload["data"] as Record<string, unknown>)?.["test"]);
        if (expectedKey && !isTestRequest && providedKey !== expectedKey) {
          return Response.json({ success: false, message: "Sai API key" }, { status: 401 });
        }

        const transaction = (payload["data"] && typeof payload["data"] === "object"
          ? payload["data"]
          : payload) as Record<string, unknown>;

        if (isTestRequest) {
          return Response.json({ success: true, message: "Webhook test connection verified." });
        }

        // 2. Chỉ xử lý tiền vào (in)
        const transferType = String(transaction["transferType"] ?? payload["transferType"] ?? "in").toLowerCase();
        if (transferType !== "in") {
          return Response.json({ success: true, message: "Bỏ qua giao dịch chuyển ra" });
        }

        const amount = Number(transaction["transferAmount"] ?? transaction["amount"] ?? payload["amount"] ?? 0);

        // Chỉ lấy content và description (KHÔNG lấy referenceCode/id để tránh nhận nhầm mã tham chiếu ngân hàng)
        const rawContent = [
          transaction["content"],
          transaction["description"],
          payload["content"],
          payload["description"]
        ]
          .filter(Boolean)
          .join(" ");

        const reference = String(
          transaction["referenceCode"] ?? transaction["id"] ?? payload["referenceCode"] ?? payload["id"] ?? ""
        );

        // 3. Chuẩn hóa chuỗi nội dung: bỏ dấu gạch ngang, dấu cách để nhận diện mã đơn bị dính liền
        const normalizedContent = rawContent.replace(/[\s\-_]/g, "").toUpperCase();

        // Bóc tách mã: TM + Timestamp (10-15 số) + chuỗi ký tự (VNU70...) hoặc TM26...
        const match =
          /(TM\d{10,15}[A-Z0-9]+)/i.exec(normalizedContent) ||
          /MUA[_\s-]?VE[_\s-]?(TM26[A-Z0-9]{6})/i.exec(normalizedContent) ||
          /(TM26[A-Z0-9]{6})/i.exec(normalizedContent);

        if (!match) {
          return Response.json({
            success: true,
            message: `Không tìm thấy mã đơn hàng hợp lệ trong nội dung: ${rawContent}`,
          });
        }

        const extractedCode = match[1]!.toUpperCase();

        // 4. Truy vấn đơn hàng từ Supabase
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Tìm kiếm chính xác hoặc tìm kiếm gần đúng với mã đơn
        let order = null;

        // Thử tìm theo mã chính xác
        const { data: directOrder } = await supabaseAdmin
          .from("orders")
          .select("id, order_code, customer_name, customer_email, customer_phone, delivery_location, total_amount, status, checkin_token")
          .eq("order_code", extractedCode)
          .maybeSingle();

        if (directOrder) {
          order = directOrder;
        } else {
          // Nếu trong DB lưu mã có dấu gạch ngang (TM-179...-VNU70), truy vấn các đơn gần nhất để đối soát
          const { data: recentOrders } = await supabaseAdmin
            .from("orders")
            .select("id, order_code, customer_name, customer_email, customer_phone, delivery_location, total_amount, status, checkin_token")
            .order("created_at", { ascending: false })
            .limit(50);

          if (recentOrders && recentOrders.length > 0) {
            order = recentOrders.find((entry) => {
              if (!entry.order_code) return false;
              const cleanDbCode = entry.order_code.replace(/[\s\-_]/g, "").toUpperCase();
              return cleanDbCode === extractedCode || normalizedContent.includes(cleanDbCode);
            }) || null;
          }
        }

        if (!order) {
          return Response.json({
            success: false,
            message: `Không tìm thấy đơn hàng tương ứng với mã: ${extractedCode}`,
          }, { status: 404 });
        }

        // Chống xử lý lặp lại nếu đơn đã thanh toán
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

        // 6. Cập nhật trạng thái "paid" và "Đã thanh toán"
        await supabaseAdmin
          .from("orders")
          .update({
            status: "Đã thanh toán",
            paid_at: paidAt,
            bank_reference: reference,
          })
          .eq("id", order.id);

        // 7. Lấy danh sách sản phẩm / vé
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

        // 9. Đồng bộ sang Google Sheet (nếu có cấu hình)
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
          orderCode: order.order_code,
          emailSent: sent,
        });
      },
    },
  },
});