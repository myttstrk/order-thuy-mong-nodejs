import { useState } from "react";

import { formatVnd } from "@/lib/event";
import { useCart } from "@/lib/cart";
import type { TicketTier } from "@/lib/catalog";

export function TicketTierCard({ tier, featured }: { tier: TicketTier; featured?: boolean }) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);

  return (
    <article
      className={`relative flex flex-col rounded-2xl border p-6 transition-transform duration-300 hover:-translate-y-1 ${
        featured
          ? "border-primary/45 bg-surface-2 shadow-[var(--shadow-gold)]"
          : "border-border bg-surface"
      }`}
    >
      {featured && (
        <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-foreground">
          Đặc quyền
        </span>
      )}
      <p
        className={`text-[11px] uppercase tracking-[0.24em] ${featured ? "text-primary" : "text-muted-foreground"}`}
      >
        {tier.name}
      </p>
      <p className="mt-3 font-display text-4xl text-foreground">{formatVnd(tier.price)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{tier.tagline}</p>

      <ul className="mt-6 flex-1 space-y-3 text-sm text-muted-foreground">
        {tier.perks.map((perk) => (
          <li key={perk} className="flex gap-2">
            <span className="text-primary">·</span>
            <span>{perk}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => {
          add({ type: "ticket", code: tier.code, name: tier.name, price: tier.price });
          setAdded(true);
          window.setTimeout(() => setAdded(false), 1600);
        }}
        className={`mt-7 rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
          featured
            ? "bg-primary text-primary-foreground hover:brightness-110"
            : "border border-border text-foreground hover:border-primary/60 hover:text-primary"
        }`}
      >
        {added ? "Đã thêm vào giỏ ✓" : "Chọn hạng vé"}
      </button>
    </article>
  );
}
