import { Link } from "@tanstack/react-router";

import { EVENT } from "@/lib/event";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border bg-surface/60">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-3">
        <div>
          <div className="font-display text-3xl text-gilded">Thủy Mộng</div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
            {EVENT.subtitle}, diễn duy nhất {EVENT.dateLabel} lúc {EVENT.time}.
          </p>
        </div>

        <div>
          <div className="mb-4 text-[11px] uppercase tracking-[0.28em] text-primary">Liên hệ</div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="text-foreground">{EVENT.venue}</li>
            <li>{EVENT.address}</li>
            <li>
              <a href={`tel:${EVENT.phone.replace(/\s/g, "")}`} className="hover:text-primary">
                {EVENT.phone}
              </a>
            </li>
            <li>
              <a href={`mailto:${EVENT.email}`} className="hover:text-primary">
                {EVENT.email}
              </a>
            </li>
          </ul>
        </div>

        <div className="md:text-right">
          <div className="mb-4 text-[11px] uppercase tracking-[0.28em] text-primary">Điều hướng</div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <Link to="/ve" className="hover:text-foreground">
                Hạng vé
              </Link>
            </li>
            <li>
              <Link to="/luu-niem" className="hover:text-foreground">
                Ấn phẩm lưu niệm
              </Link>
            </li>
            <li>
              <Link to="/lien-he" className="hover:text-foreground">
                Liên hệ
              </Link>
            </li>
            <li>
              <Link to="/admin" className="text-primary hover:underline">
                Quản trị
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto max-w-6xl px-5 py-5 text-center font-mono text-[11px] text-muted-foreground">
          © 2026 Thủy Mộng · {EVENT.venue}
        </div>
      </div>
    </footer>
  );
}
