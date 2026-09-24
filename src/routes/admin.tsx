import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { PageShell, PageHeading } from "@/components/PageShell";
import { ORDER_STATUS, formatVnd } from "@/lib/event";
import { adminCheckin, adminListOrders, adminLogin } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Quản trị — Thủy Mộng" },
      { name: "description", content: "Trang quản trị đơn hàng và check-in đêm diễn Thủy Mộng." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Quản trị Thủy Mộng" },
      { property: "og:description", content: "Theo dõi doanh thu, đơn hàng và check-in khán giả." },
    ],
  }),
  component: AdminPage,
});

const PASS_KEY = "thuymong.admin.v1";

type OrdersResult = Awaited<ReturnType<typeof adminListOrders>>;
type CheckinResult = Awaited<ReturnType<typeof adminCheckin>>;

function AdminPage() {
  const [password, setPassword] = useState<string | null>(null);

  useEffect(() => {
    setPassword(window.sessionStorage.getItem(PASS_KEY));
  }, []);

  if (!password) {
    return (
      <PageShell>
        <LoginForm
          onSuccess={(p) => {
            window.sessionStorage.setItem(PASS_KEY, p);
            setPassword(p);
          }}
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Dashboard
        password={password}
        onLogout={() => {
          window.sessionStorage.removeItem(PASS_KEY);
          setPassword(null);
        }}
      />
    </PageShell>
  );
}

function LoginForm({ onSuccess }: { onSuccess: (password: string) => void }) {
  const login = useServerFn(adminLogin);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login({ data: { password: value } });
      onSuccess(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đăng nhập thất bại.");
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-5 py-24">
      <h1 className="font-display text-3xl text-foreground">Khu vực quản trị</h1>
      <p className="mt-2 text-sm text-muted-foreground">Nhập mật khẩu quản trị để tiếp tục.</p>
      <form onSubmit={submit} className="surface-panel mt-7 space-y-4 p-6">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Mật khẩu"
          required
          className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground outline-none focus:border-primary/60"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
        >
          {pending ? "Đang kiểm tra..." : "Đăng nhập"}
        </button>
      </form>
    </div>
  );
}

function Dashboard({ password, onLogout }: { password: string; onLogout: () => void }) {
  const listOrders = useServerFn(adminListOrders);
  const [tab, setTab] = useState<"orders" | "checkin">("orders");
  const [status, setStatus] = useState<"all" | "pending" | "paid" | "used" | "cancelled">("all");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<OrdersResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setData(await listOrders({ data: { password, status, search } }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được dữ liệu.");
    }
  }

  useEffect(() => {
    const t = window.setTimeout(load, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, search, password]);

  return (
    <>
      <PageHeading eyebrow="Bảng điều khiển" title="Quản trị Thủy Mộng" />

      <div className="mx-auto max-w-6xl px-5 pb-20">
        <div className="flex flex-wrap items-center gap-3">
          <TabButton active={tab === "orders"} onClick={() => setTab("orders")}>
            Đơn hàng
          </TabButton>
          <TabButton active={tab === "checkin"} onClick={() => setTab("checkin")}>
            Check-in QR
          </TabButton>
          <button
            type="button"
            onClick={onLogout}
            className="ml-auto text-xs text-muted-foreground transition hover:text-destructive"
          >
            Đăng xuất
          </button>
        </div>

        {error && <p className="mt-6 text-sm text-destructive">{error}</p>}

        {tab === "orders" ? (
          <>
            {data && (
              <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Stat label="Doanh thu" value={formatVnd(data.stats.revenue)} highlight />
                <Stat label="Đã thanh toán" value={String(data.stats.paidCount)} />
                <Stat label="Chờ thanh toán" value={String(data.stats.pendingCount)} />
                <Stat label="Đã check-in" value={String(data.stats.usedCount)} />
                <Stat label="Tổng đơn" value={String(data.stats.totalCount)} />
              </div>
            )}

            <div className="mt-7 flex flex-wrap gap-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm theo tên, SĐT, email hoặc mã đơn"
                className="min-w-[240px] flex-1 rounded-full border border-border bg-surface px-5 py-2.5 text-sm text-foreground outline-none focus:border-primary/60"
              />
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                className="rounded-full border border-border bg-surface px-5 py-2.5 text-sm text-foreground outline-none focus:border-primary/60"
              >
                <option value="all">Tất cả trạng thái</option>
                <option value="pending">Đang chờ thanh toán</option>
                <option value="paid">Đã thanh toán</option>
                <option value="used">Đã sử dụng</option>
                <option value="cancelled">Đã huỷ</option>
              </select>
              <button
                type="button"
                onClick={load}
                className="rounded-full border border-primary/45 px-5 py-2.5 text-sm text-primary transition hover:bg-primary/10"
              >
                Làm mới
              </button>
            </div>

            <div className="surface-panel mt-6 overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <tr>
                    <th className="px-5 py-4">Mã đơn</th>
                    <th className="px-5 py-4">Khách hàng</th>
                    <th className="px-5 py-4">Mặt hàng</th>
                    <th className="px-5 py-4">Tổng tiền</th>
                    <th className="px-5 py-4">Trạng thái</th>
                    <th className="px-5 py-4">Ngày tạo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(data?.orders ?? []).map((o) => (
                    <tr key={o.id}>
                      <td className="px-5 py-4 font-mono text-primary">{o.order_code}</td>
                      <td className="px-5 py-4">
                        <p className="text-foreground">{o.customer_name}</p>
                        <p className="text-xs text-muted-foreground">{o.customer_phone}</p>
                        <p className="text-xs text-muted-foreground">{o.customer_email}</p>
                      </td>
                      <td className="px-5 py-4 text-xs text-muted-foreground">
                        {o.items.map((i) => `${i.item_name} ×${i.quantity}`).join(", ")}
                      </td>
                      <td className="px-5 py-4 font-mono text-foreground">
                        {formatVnd(o.total_amount)}
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={o.status} />
                      </td>
                      <td className="px-5 py-4 text-xs text-muted-foreground">
                        {new Date(o.created_at).toLocaleString("vi-VN")}
                      </td>
                    </tr>
                  ))}
                  {data && data.orders.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                        Không có đơn hàng nào khớp bộ lọc.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <CheckinPanel password={password} />
        )}
      </div>
    </>
  );
}

function CheckinPanel({ password }: { password: string }) {
  const checkin = useServerFn(adminCheckin);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const busyRef = useRef(false);

  async function submitToken(token: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      setResult(await checkin({ data: { password, token } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không kiểm tra được vé.");
    } finally {
      window.setTimeout(() => (busyRef.current = false), 1500);
    }
  }

  async function stopScan() {
    const s = scannerRef.current;
    scannerRef.current = null;
    setScanning(false);
    if (s) {
      try {
        await s.stop();
        s.clear();
      } catch {
        /* máy quét đã dừng */
      }
    }
  }

  async function startScan() {
    setError(null);
    setScanning(true);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner as unknown as { stop: () => Promise<void>; clear: () => void };
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => {
          void submitToken(decoded.trim());
        },
        () => {
          /* bỏ qua khung hình không đọc được */
        },
      );
    } catch (err) {
      setScanning(false);
      setError(
        err instanceof Error
          ? `Không mở được camera: ${err.message}`
          : "Không mở được camera. Hãy cấp quyền camera cho trang này.",
      );
    }
  }

  useEffect(() => () => void stopScan(), []);

  return (
    <div className="mt-7 grid gap-6 lg:grid-cols-2">
      <div className="surface-panel p-7">
        <h2 className="font-display text-2xl text-foreground">Quét mã QR vé</h2>
        <div
          id="qr-reader"
          className="mt-5 overflow-hidden rounded-2xl border border-border bg-surface-2"
        />
        <div className="mt-5 flex gap-3">
          {scanning ? (
            <button
              type="button"
              onClick={() => void stopScan()}
              className="rounded-full border border-border px-5 py-2.5 text-sm text-foreground transition hover:border-destructive/60 hover:text-destructive"
            >
              Dừng quét
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void startScan()}
              className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110"
            >
              Mở camera
            </button>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) void submitToken(manual.trim());
          }}
          className="mt-6 flex gap-3 border-t border-border pt-6"
        >
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Nhập mã đơn hoặc mã check-in"
            className="flex-1 rounded-full border border-border bg-surface px-5 py-2.5 text-sm text-foreground outline-none focus:border-primary/60"
          />
          <button
            type="submit"
            className="rounded-full border border-primary/45 px-5 py-2.5 text-sm text-primary transition hover:bg-primary/10"
          >
            Kiểm tra
          </button>
        </form>
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </div>

      <div className="surface-panel p-7">
        <h2 className="font-display text-2xl text-foreground">Kết quả</h2>
        {!result ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Chưa có vé nào được quét. Hướng mã QR của khách vào camera.
          </p>
        ) : (
          <ResultCard result={result} />
        )}
      </div>
    </div>
  );
}

function ResultCard({ result }: { result: CheckinResult }) {
  const tone =
    result.result === "ok"
      ? "border-success/50 bg-success/10 text-success"
      : result.result === "duplicate"
        ? "border-destructive/60 bg-destructive/15 text-destructive"
        : "border-primary/50 bg-primary/10 text-primary";

  const detail = "detail" in result ? result.detail : undefined;

  return (
    <div className="mt-4">
      <div className={`rounded-2xl border px-5 py-4 ${tone}`}>
        <p className="font-display text-2xl">{result.message}</p>
        {"checkedInAt" in result && result.checkedInAt && (
          <p className="mt-1 text-xs">
            Thời điểm check-in: {new Date(result.checkedInAt).toLocaleString("vi-VN")}
          </p>
        )}
      </div>

      {detail && (
        <dl className="mt-5 space-y-3 text-sm">
          <div className="flex justify-between border-b border-border/60 pb-2">
            <dt className="text-muted-foreground">Mã đơn</dt>
            <dd className="font-mono text-primary">{detail.orderCode}</dd>
          </div>
          <div className="flex justify-between border-b border-border/60 pb-2">
            <dt className="text-muted-foreground">Khách hàng</dt>
            <dd className="text-foreground">{detail.customerName}</dd>
          </div>
          <div className="flex justify-between border-b border-border/60 pb-2">
            <dt className="text-muted-foreground">Điện thoại</dt>
            <dd className="font-mono text-foreground">{detail.customerPhone}</dd>
          </div>
          <div className="flex justify-between border-b border-border/60 pb-2">
            <dt className="text-muted-foreground">Tổng tiền</dt>
            <dd className="font-mono text-foreground">{formatVnd(detail.total)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Vé và lưu niệm</dt>
            <dd className="mt-2 space-y-1">
              {detail.items.map((i, idx) => (
                <p key={idx} className="text-foreground">
                  {i.item_type === "ticket" ? "Vé" : "Lưu niệm"} · {i.item_name} × {i.quantity}
                </p>
              ))}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = ORDER_STATUS[status as keyof typeof ORDER_STATUS] ?? status;
  const tone =
    status === "paid"
      ? "border-success/50 text-success"
      : status === "used"
        ? "border-primary/50 text-primary"
        : status === "cancelled"
          ? "border-destructive/50 text-destructive"
          : "border-border text-muted-foreground";
  return (
    <span className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs ${tone}`}>
      {label}
    </span>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-5 ${highlight ? "border-primary/45 bg-surface-2" : "border-border bg-surface"}`}
    >
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p
        className={`mt-2 font-display text-2xl ${highlight ? "text-gilded" : "text-foreground"}`}
      >
        {value}
      </p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-5 py-2.5 text-sm transition ${
        active
          ? "bg-primary text-primary-foreground"
          : "border border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
