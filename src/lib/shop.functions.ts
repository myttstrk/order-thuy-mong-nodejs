import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Catalog } from "./catalog";

const cartSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(2, "Họ tên quá ngắn").max(120),
    phone: z
      .string()
      .trim()
      .regex(/^[0-9+\s().-]{8,20}$/, "Số điện thoại không hợp lệ"),
    email: z.string().trim().email("Email không hợp lệ").max(255),
    note: z.string().trim().max(500).optional(),
  }),
  items: z
    .array(
      z.object({
        type: z.enum(["ticket", "merch"]),
        code: z.string().trim().min(1).max(60),
        quantity: z.number().int().min(1).max(20),
      }),
    )
    .min(1, "Giỏ hàng đang trống")
    .max(30),
});

export type CreateOrderInput = z.infer<typeof cartSchema>;

function makeOrderCode(): string {
  const alphabet = "ACDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) suffix += alphabet[b % alphabet.length];
  return `TM26${suffix}`;
}

export const getCatalog = createServerFn({ method: "GET" }).handler(async (): Promise<Catalog> => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [tiersRes, merchRes] = await Promise.all([
    supabaseAdmin
      .from("ticket_tiers")
      .select("code, name, price, tagline, perks")
      .order("sort_order"),
    supabaseAdmin
      .from("merch_items")
      .select("code, name, description, price, image_key")
      .order("sort_order"),
  ]);
  return { tiers: tiersRes.data ?? [], merch: merchRes.data ?? [] };
});

export const createOrder = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => cartSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const ticketCodes = data.items.filter((i) => i.type === "ticket").map((i) => i.code);
    const merchCodes = data.items.filter((i) => i.type === "merch").map((i) => i.code);

    const [tiers, merch] = await Promise.all([
      ticketCodes.length
        ? supabaseAdmin.from("ticket_tiers").select("code, name, price").in("code", ticketCodes)
        : Promise.resolve({ data: [] as { code: string; name: string; price: number }[] }),
      merchCodes.length
        ? supabaseAdmin.from("merch_items").select("code, name, price").in("code", merchCodes)
        : Promise.resolve({ data: [] as { code: string; name: string; price: number }[] }),
    ]);

    const priceBook = new Map<string, { name: string; price: number }>();
    for (const t of tiers.data ?? []) priceBook.set(`ticket:${t.code}`, t);
    for (const m of merch.data ?? []) priceBook.set(`merch:${m.code}`, m);

    // Giá luôn lấy từ cơ sở dữ liệu, không tin giá gửi lên từ trình duyệt.
    const lines = data.items.map((item) => {
      const found = priceBook.get(`${item.type}:${item.code}`);
      if (!found) throw new Error(`Không tìm thấy mặt hàng: ${item.code}`);
      return {
        item_type: item.type,
        item_code: item.code,
        item_name: found.name,
        unit_price: found.price,
        quantity: item.quantity,
      };
    });

    const hasTicket = lines.some((l) => l.item_type === "ticket");
    if (!hasTicket) throw new Error("Đơn hàng cần có ít nhất một vé.");

    const total = lines.reduce((s, l) => s + l.unit_price * l.quantity, 0);

    let orderCode = makeOrderCode();
    let orderId: string | null = null;
    for (let attempt = 0; attempt < 5 && !orderId; attempt++) {
      const { data: inserted, error } = await supabaseAdmin
        .from("orders")
        .insert({
          order_code: orderCode,
          customer_name: data.customer.name,
          customer_phone: data.customer.phone,
          customer_email: data.customer.email.toLowerCase(),
          total_amount: total,
          note: data.customer.note ?? null,
        })
        .select("id, order_code")
        .single();
      if (inserted) {
        orderId = inserted.id;
        orderCode = inserted.order_code;
      } else if (error?.code === "23505") {
        orderCode = makeOrderCode();
      } else if (error) {
        throw new Error(error.message);
      }
    }
    if (!orderId) throw new Error("Không tạo được đơn hàng, vui lòng thử lại.");

    const { error: itemsError } = await supabaseAdmin
      .from("order_items")
      .insert(lines.map((l) => ({ ...l, order_id: orderId })));
    if (itemsError) throw new Error(itemsError.message);

    return { orderCode, total };
  });

export const getOrder = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z.object({ code: z.string().trim().min(4).max(32) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select(
        "id, order_code, customer_name, customer_phone, customer_email, total_amount, status, checkin_token, checked_in_at, paid_at, created_at",
      )
      .eq("order_code", data.code.toUpperCase())
      .maybeSingle();

    if (!order) return null;

    const { data: items } = await supabaseAdmin
      .from("order_items")
      .select("item_type, item_name, unit_price, quantity")
      .eq("order_id", order.id);

    const paid = order.status === "paid" || order.status === "used";
    const { id: _id, checkin_token, ...rest } = order;
    return {
      ...rest,
      // Mã check-in chỉ lộ ra sau khi đã thanh toán.
      checkin_token: paid ? checkin_token : null,
      items: items ?? [],
    };
  });
