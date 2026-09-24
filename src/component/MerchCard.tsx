import { useState } from "react";

import { formatVnd } from "@/lib/event";
import { useCart } from "@/lib/cart";
import { MERCH_IMAGES, type MerchItem } from "@/lib/catalog";

export function MerchCard({ item }: { item: MerchItem }) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);
  const src = MERCH_IMAGES[item.image_key];

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="aspect-square overflow-hidden bg-surface-2">
        {src && (
          <img
            src={src}
            alt={item.name}
            loading="lazy"
            width={816}
            height={816}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-display text-xl text-foreground">{item.name}</h3>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
          {item.description}
        </p>
        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="font-mono text-sm text-primary">{formatVnd(item.price)}</span>
          <button
            type="button"
            onClick={() => {
              add({ type: "merch", code: item.code, name: item.name, price: item.price });
              setAdded(true);
              window.setTimeout(() => setAdded(false), 1600);
            }}
            className="rounded-full border border-border px-4 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/60 hover:text-primary"
          >
            {added ? "Đã thêm ✓" : "Thêm vào giỏ"}
          </button>
        </div>
      </div>
    </article>
  );
}
