import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { PageShell } from "@/components/PageShell";
import { useCart } from "@/lib/cart";
import { orderQuery } from "@/lib/queries";
import {
  BANK,
  EVENT,
  ORDER_STATUS,
  checkinQrUrl,
  formatVnd,
  transferContent,
  vietQrUrl,
} from "@/lib/event";

export const Route = createFileRoute("/don-hang/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `Đơn hàng ${params.code} — Thủy Mộng` },
      {
        name: "description",
        content: `Theo dõi trạng thái thanh toán và vé điện tử cho đơn hàng ${params.code} của đêm diễn Thủy Mộng.`,
      },
      { property: "og:title", content: `Đơn hàng ${params.code} — Thủy Mộng` },
      {
        property: "og:description",
        content: "Quét mã VietQR để thanh toán và nhận vé điện tử kèm mã QR check-in.",
      },
    ],
  }),
  component: OrderPage,
});

function OrderPage() {
  const { code } = Route.useParams();
  const { clear } = useCart();

  const { data, isLoading } = useQuery({
    ...orderQuery(code),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" ? 4000 : false;
    },
  });

  const paid = data?.status === "paid" || data?.status === "used";

  useEffect(() => {
    if (paid) clear();
  }, [paid, clear]);

  if (isLoading) {
    return (
      <PageShell>
        <div className="mx-auto max-w-2xl px-5 py-24 text-center text-sm text-muted-foreground">
          Đang tải đơn hàng...
        </div>
      </PageShell>
    );
  }

  if (!data) {
    return (
      <PageShell>
        <div className="mx-auto max-w-2xl px-5 py-24 text-center">
          <h1 className="font-display text-3xl text-foreground">Không tìm thấy đơn hàng</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Mã đơn <span className="font-mono text-primary">{code}</span> không tồn tại.
          </p>
          <Link
            to="/ve"
            className="mt-7 inline-block rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
          >
            Đặt vé mới
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="mx-auto max-w-3xl px-5 pb-20 pt-14">
        <p className="text-[11px] uppercase tracking-[0.3em] text-primary">
          Đơn hàng {data.order_code}
        </p>
        <h1 className="mt-3 font-display text-4xl text-foreground">
          {paid ? "Thanh toán thành công" : "Đang chờ thanh toán..."}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {paid
            ? "Vé điện tử đã được gửi tới email của bạn. Vui lòng mang mã QR bên dưới tới quầy check-in."
            : "Quét mã VietQR dưới đây để chuyển khoản. Trang sẽ tự cập nhật ngay khi nhận được tiền."}
        </p>

        {paid ? (
          <section className="surface-panel mt-8 p-8 text-center">
            <p className="text-xs uppercase tracking-[0.24em] text-success">
              {ORDER_STATUS[data.status as keyof typeof ORDER_STATUS]}
            </p>
            {data.checkin_token && (
              <img
                src={checkinQrUrl(data.checkin_token)}
                alt="Mã QR check-in"
                width={300}
                height={300}
                className="mx-auto mt-6 h-[300px] w-[300px] rounded-2xl bg-card p-3"
              />
            )}
            <p className="mt-5 font-display text-2xl text-foreground">{data.customer_name}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {EVENT.venue} · {EVENT.dateLabel} · {EVENT.time}
            </p>
            {data.checked_in_at && (
              <p className="mt-3 text-xs text-primary">
                Đã check-in lúc {new Date(data.checked_in_at).toLocaleString("vi-VN")}
              </p>
            )}
          </section>
        ) : (
          <section className="surface-panel mt-8 grid gap-7 p-8 md:grid-cols-[auto_1fr]">
            <img
              src={vietQrUrl(data.order_code, data.total_amount)}
              alt="Mã VietQR thanh toán"
              width={280}
              height={380}
              className="mx-auto w-[280px] rounded-2xl bg-card p-2"
            />
            <dl className="space-y-3 text-sm">
              <Row label="Ngân hàng" value={BANK.name} />
              <Row label="Số tài khoản" value={BANK.accountNumber} mono />
              <Row label="Chủ tài khoản" value={BANK.accountNameDisplay} />
              <Row label="Số tiền" value={formatVnd(data.total_amount)} mono />
              <Row label="Nội dung" value={transferContent(data.order_code)} mono />
              <p className="pt-2 text-xs leading-relaxed text-muted-foreground">
                Giữ nguyên nội dung chuyển khoản để hệ thống tự xác nhận. Đừng đóng trang này trong
                khi chờ.
              </p>
            </dl>
          </section>
        )}

        <section className="surface-panel mt-6 p-7">
          <h2 className="font-display text-xl text-foreground">Chi tiết đơn hàng</h2>
          <ul className="mt-4 divide-y divide-border text-sm">
            {data.items.map((i, idx) => (
              <li key={`${i.item_name}-${idx}`} className="flex justify-between py-3">
                <span className="text-muted-foreground">
                  {i.item_name} × {i.quantity}
                </span>
                <span className="font-mono text-foreground">
                  {formatVnd(i.unit_price * i.quantity)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-between border-t border-border pt-4">
            <span className="text-sm text-muted-foreground">Tổng cộng</span>
            <span className="font-display text-2xl text-gilded">
              {formatVnd(data.total_amount)}
            </span>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {data.customer_name} · {data.customer_phone} · {data.customer_email}
          </p>
        </section>
      </div>
    </PageShell>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-right text-foreground ${mono ? "font-mono text-sm" : ""}`}>{value}</dd>
    </div>
  );
}
