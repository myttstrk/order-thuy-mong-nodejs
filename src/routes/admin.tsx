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

type InventoryItem = {
  id: string;
  name: string;
  type?: "ticket" | "merch" | string;
  price?: number | string;
  quantity?: number | null;
  baseQuantity?: number | null;
  benefit?: string;
  image?: string;
};

function Dashboard({ password, onLogout }: { password: string; onLogout: () => void }) {
  const listOrders = useServerFn(adminListOrders);
  const [tab, setTab] = useState<"orders" | "checkin" | "inventory">("orders");
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
          <TabButton active={tab === "inventory"} onClick={() => setTab("inventory")}>
            Tồn kho
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
        ) : tab === "checkin" ? (
          <CheckinPanel password={password} />
        ) : (
          <InventoryPanel />
        )}
      </div>
    </>
  );
}

function InventoryPanel() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    id: "",
    title: "",
    name: "",
    type: "ticket",
    price: "0",
    quantity: "",
    benefit: "",
  });

  async function refreshItems() {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/admin/items");
      if (!response.ok) throw new Error("Không tải được danh sách sản phẩm.");
      const data = await response.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được danh sách sản phẩm.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshItems();
  }, []);

  async function openEditor(item?: InventoryItem) {
    const fallbackItem = item ?? items.find((entry) => entry.id === editingId) ?? null;

    if (!fallbackItem) {
      setEditingId(null);
      setForm({
        id: "",
        title: "",
        name: "",
        type: "ticket",
        price: "0",
        quantity: "",
        benefit: "",
      });
      setOpenForm(true);
      return;
    }

    setEditingId(fallbackItem.id ?? null);
    setForm({
      id: fallbackItem.id ?? "",
      title: fallbackItem.title ?? fallbackItem.name ?? "",
      name: fallbackItem.name ?? "",
      type: fallbackItem.type ?? "ticket",
      price: String(fallbackItem.price ?? 0),
      quantity: fallbackItem.baseQuantity != null ? String(fallbackItem.baseQuantity) : "",
      benefit: fallbackItem.benefit ?? "",
    });
    setOpenForm(true);

    try {
      setError(null);
      const response = await fetch("/api/admin/items");
      if (!response.ok) throw new Error("Không tải được thông tin mặt hàng.");
      const list = await response.json();
      const found = Array.isArray(list) ? list.find((entry: InventoryItem) => entry.id === fallbackItem.id) : null;
      if (!found) throw new Error("Không tìm thấy sản phẩm cần sửa.");

      setEditingId(found.id ?? null);
      setForm({
        id: found.id ?? "",
        title: found.title ?? found.name ?? "",
        name: found.name ?? "",
        type: found.type ?? "ticket",
        price: String(found.price ?? 0),
        quantity: found.baseQuantity != null ? String(found.baseQuantity) : "",
        benefit: found.benefit ?? "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không mở được form sửa.");
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const payload = {
      id: form.id.trim(),
      name: form.name.trim(),
      title: (form.title || form.name).trim(),
      type: form.type,
      price: Number(form.price || 0),
      benefit: form.benefit.trim(),
    };

    if (!payload.id || !payload.name) {
      setError("Vui lòng nhập đủ mã và tên sản phẩm.");
      return;
    }

    if (form.quantity.trim() !== "") {
      payload.quantity = Number(form.quantity);
    }

    try {
      setSaving(true);
      setError(null);
      const response = await fetch("/api/admin/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || "Không lưu được sản phẩm.");
      setOpenForm(false);
      setEditingId(null);
      await refreshItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được sản phẩm.");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(itemId: string) {
    const ok = window.confirm(`Xóa mặt hàng "${itemId}" khỏi hệ thống?`);
    if (!ok) return;

    try {
      setError(null);
      const response = await fetch(`/api/admin/items/${itemId}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || "Xóa thất bại.");
      await refreshItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xóa thất bại.");
    }
  }

  return (
    <div className="mt-7 surface-panel p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-foreground">Quản lý tồn kho</h2>
          <p className="mt-1 text-sm text-muted-foreground">Theo dõi tổng kho và số lượng còn lại của vé / merch.</p>
        </div>
        <button
          type="button"
          onClick={() => void openEditor()}
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110"
        >
          + Thêm mặt hàng
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-[0.14em] text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Tên</th>
              <th className="px-4 py-3">Mã</th>
              <th className="px-4 py-3">Loại</th>
              <th className="px-4 py-3">Giá</th>
              <th className="px-4 py-3">Tổng kho</th>
              <th className="px-4 py-3">Còn lại</th>
              <th className="px-4 py-3">Hành động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  Đang tải danh sách sản phẩm...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  Chưa có mặt hàng nào.
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const totalStock = item.baseQuantity != null ? item.baseQuantity : item.quantity ?? 0;
                const remaining = item.quantity != null ? item.quantity : totalStock;
                return (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{item.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{item.title || item.name}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-primary">{item.id}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.type === "merch" ? "Merch" : "Vé"}</td>
                    <td className="px-4 py-3 font-mono">{formatVnd(Number(item.price ?? 0))}</td>
                    <td className="px-4 py-3 font-mono">{totalStock}</td>
                    <td className="px-4 py-3 font-mono text-primary">{remaining}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void openEditor(item)}
                          className="rounded-full border border-border px-3 py-1.5 text-xs transition hover:border-primary/60 hover:text-primary"
                        >
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDelete(item.id)}
                          className="rounded-full border border-destructive/60 px-3 py-1.5 text-xs text-destructive transition hover:bg-destructive/10"
                        >
                          Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {openForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-3xl border border-border bg-background p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="font-display text-xl text-foreground">
                {editingId ? "Sửa mặt hàng" : "Thêm mặt hàng"}
              </h3>
              <button
                type="button"
                onClick={() => setOpenForm(false)}
                className="text-sm text-muted-foreground transition hover:text-foreground"
              >
                Đóng
              </button>
            </div>

            <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm md:col-span-2">
                <span className="text-muted-foreground">Title hiển thị</span>
                <input
                  value={form.title}
                  onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-foreground outline-none focus:border-primary/60"
                  placeholder="VD: Combo merch độc quyền"
                />
              </label>

              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">Mã sản phẩm</span>
                <input
                  value={form.id}
                  onChange={(e) => setForm((p) => ({ ...p, id: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-foreground outline-none focus:border-primary/60"
                  placeholder="vd: combo-merch"
                  required
                />
              </label>

              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">Tên mặt hàng</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-foreground outline-none focus:border-primary/60"
                  placeholder="Tên mặt hàng"
                  required
                />
              </label>

              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">Loại</span>
                <select
                  value={form.type}
                  onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-foreground outline-none focus:border-primary/60"
                >
                  <option value="ticket">Vé</option>
                  <option value="merch">Merch</option>
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">Giá bán</span>
                <input
                  type="number"
                  min="0"
                  value={form.price}
                  onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-foreground outline-none focus:border-primary/60"
                />
              </label>

              <label className="space-y-2 text-sm md:col-span-2">
                <span className="text-muted-foreground">Tổng số lượng kho</span>
                <input
                  type="number"
                  min="0"
                  value={form.quantity}
                  onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-foreground outline-none focus:border-primary/60"
                  placeholder="Ví dụ: 50"
                />
              </label>

              <label className="space-y-2 text-sm md:col-span-2">
                <span className="text-muted-foreground">Quyền lợi / mô tả</span>
                <textarea
                  rows={4}
                  value={form.benefit}
                  onChange={(e) => setForm((p) => ({ ...p, benefit: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-foreground outline-none focus:border-primary/60"
                  placeholder="Mô tả quyền lợi của sản phẩm"
                />
              </label>

              <div className="md:col-span-2 flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setOpenForm(false)}
                  className="rounded-full border border-border px-5 py-2.5 text-sm text-foreground transition hover:border-primary/60 hover:text-primary"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
                >
                  {saving ? "Đang lưu..." : editingId ? "Lưu thay đổi" : "Thêm mới"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
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
      className={`rounded-full px-5 py-2.5 text-sm transition ${active
          ? "bg-primary text-primary-foreground"
          : "border border-border text-muted-foreground hover:text-foreground"
        }`}
    >
      {children}
    </button>
  );
}
