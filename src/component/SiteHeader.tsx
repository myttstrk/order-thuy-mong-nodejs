import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { EVENT } from "@/lib/event";
import { useCart } from "@/lib/cart";

const NAV = [
  { to: "/", label: "Sự kiện" },
  { to: "/ve", label: "Hạng vé" },
  { to: "/luu-niem", label: "Lưu niệm" },
  { to: "/lien-he", label: "Liên hệ" },
] as const;

export function SiteHeader() {
  const { count } = useCart();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
        <Link to="/" className="flex items-baseline gap-2.5">
          <span className="font-display text-2xl leading-none text-gilded">Thủy Mộng</span>
          <span className="hidden text-[10px] uppercase tracking-[0.3em] text-muted-foreground sm:inline">
            Múa rối nước
          </span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="transition-colors hover:text-foreground"
              activeProps={{ className: "text-primary" }}
              activeOptions={{ exact: n.to === "/" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden font-mono text-xs text-muted-foreground lg:inline">
            {EVENT.dateShort}
          </span>
          <Link
            to="/thanh-toan"
            className="rounded-full border border-primary/45 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            Giỏ hàng · {count}
          </Link>
          <button
            type="button"
            aria-label="Mở menu"
            onClick={() => setOpen((v) => !v)}
            className="rounded-full border border-border px-3 py-2 text-sm text-muted-foreground md:hidden"
          >
            ☰
          </button>
        </div>
      </div>

      {open && (
        <nav className="flex flex-col border-t border-border bg-surface px-5 py-2 md:hidden">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              onClick={() => setOpen(false)}
              className="border-b border-border/60 py-3 text-sm text-muted-foreground last:border-0"
              activeProps={{ className: "text-primary" }}
              activeOptions={{ exact: n.to === "/" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
