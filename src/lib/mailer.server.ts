import { BANK, EVENT, checkinQrUrl, formatVnd } from "./event";

interface TicketEmailPayload {
  orderCode: string;
  customerName: string;
  customerEmail: string;
  total: number;
  checkinToken: string;
  items: { item_name: string; quantity: number; unit_price: number }[];
}

function buildHtml(p: TicketEmailPayload): string {
  const rows = p.items
    .map(
      (i) => `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #1f4650;color:#f2e7d0;font-size:14px">${i.item_name} <span style="color:#8fb3b8">× ${i.quantity}</span></td>
        <td style="padding:10px 0;border-bottom:1px solid #1f4650;text-align:right;color:#f2e7d0;font-size:14px">${formatVnd(i.unit_price * i.quantity)}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html><html lang="vi"><body style="margin:0;background:#0c2229;font-family:Helvetica,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px">
    <div style="text-align:center;padding-bottom:24px">
      <div style="font-size:12px;letter-spacing:4px;text-transform:uppercase;color:#e3b857">Múa rối nước</div>
      <div style="font-size:40px;color:#f2e7d0;font-family:Georgia,serif;margin-top:6px">Thủy Mộng</div>
      <div style="color:#8fb3b8;font-size:14px;margin-top:6px">${EVENT.dateLabel} · ${EVENT.time} · ${EVENT.venue}</div>
    </div>

    <div style="background:#123741;border:1px solid #1f4650;border-radius:18px;padding:28px;text-align:center">
      <div style="color:#8fb3b8;font-size:13px">Vé điện tử của</div>
      <div style="color:#f2e7d0;font-size:22px;margin:4px 0 2px">${p.customerName}</div>
      <div style="color:#e3b857;font-family:monospace;font-size:15px;letter-spacing:1px">${p.orderCode}</div>

      <div style="background:#ffffff;border-radius:14px;display:inline-block;padding:14px;margin:22px 0 10px">
        <img src="${checkinQrUrl(p.checkinToken)}" width="220" height="220" alt="Mã QR check-in" style="display:block" />
      </div>
      <div style="color:#8fb3b8;font-size:13px;line-height:1.6">Xuất trình mã QR này tại quầy soát vé<br/>ngày ${EVENT.dateShort} để vào cửa.</div>
    </div>

    <div style="background:#123741;border:1px solid #1f4650;border-radius:18px;padding:24px 28px;margin-top:16px">
      <div style="color:#e3b857;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">Chi tiết đơn hàng</div>
      <table style="width:100%;border-collapse:collapse">${rows}
        <tr>
          <td style="padding:14px 0 0;color:#f2e7d0;font-size:15px;font-weight:bold">Tổng cộng</td>
          <td style="padding:14px 0 0;text-align:right;color:#e3b857;font-size:18px;font-weight:bold">${formatVnd(p.total)}</td>
        </tr>
      </table>
      <div style="color:#6fa36b;font-size:13px;margin-top:14px">✓ Đã thanh toán qua ${BANK.name}</div>
    </div>

    <div style="color:#6d9096;font-size:12px;line-height:1.8;text-align:center;margin-top:24px">
      ${EVENT.venue}<br/>${EVENT.address}<br/>${EVENT.phone} · ${EVENT.email}
    </div>
  </div>
</body></html>`;
}

/** Gửi email vé điện tử qua Resend. Trả về true nếu gửi thành công. */
export async function sendTicketEmail(p: TicketEmailPayload): Promise<boolean> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    console.error("[mailer] Thiếu RESEND_API_KEY — bỏ qua gửi email cho", p.orderCode);
    return false;
  }

  const from = process.env["RESEND_FROM"] ?? "Thủy Mộng <onboarding@resend.dev>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [p.customerEmail],
      subject: `Vé điện tử Thủy Mộng — ${p.orderCode}`,
      html: buildHtml(p),
    }),
  });

  if (!res.ok) {
    console.error(`[mailer] Resend lỗi [${res.status}]: ${await res.text()}`);
    return false;
  }
  return true;
}
