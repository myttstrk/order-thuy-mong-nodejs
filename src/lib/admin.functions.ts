import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const passwordField = z.string().min(1, "Vui lòng nhập mật khẩu").max(200);

function assertAdmin(password: string): void {
  const expected = process.env["ADMIN_PASSWORD"];
  if (!expected) throw new Error("Chưa cấu hình mật khẩu quản trị.");
  if (password !== expected) throw new Error("Mật khẩu quản trị không đúng.");
}

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ password: passwordField }).parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    return { ok: true };
  });

export const adminListOrders = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        password: passwordField,
        status: z.enum(["all", "pending", "paid", "used", "cancelled"]).default("all"),
        search: z.string().trim().max(120).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let query = supabaseAdmin
      .from("orders")
      .select(
        "id, order_code, customer_name, customer_phone, customer_email, total_amount, status, checked_in_at, paid_at, email_sent_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);

    if (data.status !== "all") query = query.eq("status", data.status);
    if (data.search) {
      const term = data.search.replace(/[%,]/g, "");
      query = query.or(
        `customer_name.ilike.%${term}%,customer_phone.ilike.%${term}%,order_code.ilike.%${term}%,customer_email.ilike.%${term}%`,
      );
    }

    const { data: orders, error } = await query;
    if (error) throw new Error(error.message);

    const ids = (orders ?? []).map((o) => o.id);
    const { data: items } = ids.length
      ? await supabaseAdmin
          .from("order_items")
          .select("order_id, item_type, item_name, quantity")
          .in("order_id", ids)
      : { data: [] };

    const { data: allPaid } = await supabaseAdmin
      .from("orders")
      .select("total_amount, status");

    const paidRows = (allPaid ?? []).filter((o) => o.status === "paid" || o.status === "used");
    const stats = {
      revenue: paidRows.reduce((s, o) => s + o.total_amount, 0),
      paidCount: paidRows.length,
      pendingCount: (allPaid ?? []).filter((o) => o.status === "pending").length,
      usedCount: (allPaid ?? []).filter((o) => o.status === "used").length,
      totalCount: (allPaid ?? []).length,
    };

    return {
      stats,
      orders: (orders ?? []).map((o) => ({
        ...o,
        items: (items ?? []).filter((i) => i.order_id === o.id),
      })),
    };
  });

export const adminCheckin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ password: passwordField, token: z.string().trim().min(6).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const raw = data.token.trim();
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select(
        "id, order_code, customer_name, customer_phone, total_amount, status, checked_in_at",
      )
      .or(`checkin_token.eq.${raw},order_code.eq.${raw.toUpperCase()}`)
      .maybeSingle();

    if (!order) {
      return { result: "invalid" as const, message: "Mã QR không hợp lệ hoặc không tồn tại." };
    }

    const { data: items } = await supabaseAdmin
      .from("order_items")
      .select("item_type, item_name, quantity")
      .eq("order_id", order.id);

    const detail = {
      orderCode: order.order_code,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      total: order.total_amount,
      items: items ?? [],
    };

    if (order.status === "pending") {
      return { result: "unpaid" as const, message: "Đơn hàng này chưa thanh toán.", detail };
    }
    if (order.status === "cancelled") {
      return { result: "invalid" as const, message: "Đơn hàng này đã bị huỷ.", detail };
    }
    if (order.status === "used") {
      return {
        result: "duplicate" as const,
        message: "Vé này đã được check-in trước đó!",
        checkedInAt: order.checked_in_at,
        detail,
      };
    }

    const now = new Date().toISOString();
    await supabaseAdmin
      .from("orders")
      .update({ status: "used", checked_in_at: now })
      .eq("id", order.id);

    return { result: "ok" as const, message: "Check-in thành công", checkedInAt: now, detail };
  });
