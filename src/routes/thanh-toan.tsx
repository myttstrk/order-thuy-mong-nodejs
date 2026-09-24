import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";

import { PageShell, PageHeading } from "@/components/PageShell";
import { useCart } from "@/lib/cart";
import { formatVnd } from "@/lib/event";
import { createOrder } from "@/lib/shop.functions";

export const Route = createFileRoute("/thanh-toan")({
  head: () => ({
    meta: [
      { title: "Thanh toán — Thủy Mộng 17/10/2026" },
      {
        name: "description",
        content:
          "Điền họ tên, số điện thoại và email để nhận vé điện tử Thủy Mộng kèm mã QR check-in.",
      },
      { property: "og:title", content: "Thanh toán vé Thủy Mộng" },
      {
        property: "og:description",
        content: "Hoàn tất đặt vé đêm múa rối nước Thủy Mộng bằng chuyển khoản VietQR.",
      },
    ],
  }),
  component: CheckoutPage,
});

function CheckoutPage() {
  const { items, total, setQuantity, remove } = useCart();
  const navigate = useNavigate();
  const submitOrder = useServerFn(createOrder);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const hasTicket = items.some((i) => i.type === "ticket");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!hasTicket) {
      setError("Đơn hàng cần có ít nhất một vé.");
      return;
    }
    setPending(true);
    try {
      const result = await submitOrder({
        data: {
          customer: { name, phone, email, note: note || undefined },
          items: items.map((i) => ({ type: i.type, code: i.code, quantity: i.quantity })),
        },
      });
      navigate({ to: "/don-hang/$code", params: { code: result.orderCode } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tạo được đơn hàng, vui lòng thử lại.");
      setPending(false);
    }
  }

  return (
    <PageShell>
      <PageHeading
        eyebrow="Bước cuối"
        title="Thông tin nhận vé"
        description="Vé điện tử và mã QR check-in sẽ được gửi tới email bạn nhập bên dưới."
      />

      <section className="mx-auto grid max-w-6xl gap-6 px-5 pb-20 lg:grid-cols-[1.1fr_0.9fr]">
        <form onSubmit={handleSubmit} className="surface-panel space-y-5 p-7">
          <Field label="Họ và tên" value={name} onChange={setName} placeholder="Nguyễn Văn A" required />
          <Field
            label="Số điện thoại"
            value={phone}
            onChange={setPhone}
            placeholder="0967 752 006"
            type="tel"
            required
          />
          <Field
            label="Email nhận vé"
            value={email}
            onChange={setEmail}
            placeholder="ban@email.com"
            type="email"
            required
          />
          <label className="block">
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Ghi chú (không bắt buộc)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/60"
            />
          </label>

          {error && (
            <p className="rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending || items.length === 0}
            className="w-full rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
          >
            {pending ? "Đang tạo đơn hàng..." : `Tạo mã thanh toán · ${formatVnd(total)}`}
          </button>
          <p className="text-center text-xs text-muted-foreground">
            Bạn sẽ nhận mã VietQR để chuyển khoản. Hệ thống tự xác nhận trong vài giây.
          </p>
        </form>

        <aside className="surface-panel h-fit p-7">
          <h2 className="font-display text-2xl text-foreground">Giỏ hàng</h2>

          {items.length === 0 ? (
            <div className="mt-5 text-sm text-muted-foreground">
              Giỏ hàng đang trống.{" "}
              <Link to="/ve" className="text-primary hover:underline">
                Chọn hạng vé
              </Link>
              .
            </div>
          ) : (
            <ul className="mt-5 divide-y divide-border">
              {items.map((i) => (
                <li key={`${i.type}:${i.code}`} className="flex items-center gap-3 py-4">
                  <div className="flex-1">
                    <p className="text-sm text-foreground">{i.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {i.type === "ticket" ? "Vé" : "Lưu niệm"} · {formatVnd(i.price)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <QtyButton onClick={() => setQuantity(i.type, i.code, i.quantity - 1)}>−</QtyButton>
                    <span className="w-6 text-center font-mono text-sm text-foreground">
                      {i.quantity}
                    </span>
                    <QtyButton onClick={() => setQuantity(i.type, i.code, i.quantity + 1)}>+</QtyButton>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(i.type, i.code)}
                    aria-label={`Xoá ${i.name}`}
                    className="text-xs text-muted-foreground transition hover:text-destructive"
                  >
                    Xoá
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-5 flex items-center justify-between border-t border-border pt-5">
            <span className="text-sm text-muted-foreground">Tổng cộng</span>
            <span className="font-display text-3xl text-gilded">{formatVnd(total)}</span>
          </div>
          {!hasTicket && items.length > 0 && (
            <p className="mt-3 text-xs text-destructive">Đơn hàng cần có ít nhất một vé.</p>
          )}
        </aside>
      </section>
    </PageShell>
  );
}

function QtyButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-7 w-7 rounded-full border border-border text-sm text-foreground transition hover:border-primary/60 hover:text-primary"
    >
      {children}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/60"
      />
    </label>
  );
}
