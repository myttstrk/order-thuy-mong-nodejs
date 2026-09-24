import { createFileRoute, Link } from "@tanstack/react-router";

import { PageShell, PageHeading } from "@/components/PageShell";
import { EVENT } from "@/lib/event";

export const Route = createFileRoute("/lien-he")({
  head: () => ({
    meta: [
      { title: "Liên hệ — Thủy Mộng" },
      {
        name: "description",
        content:
          "Nhà Hát Múa Rối Việt Nam, 361 Trường Chinh, Thanh Xuân, Hà Nội. Hotline 096 775 20 06, email thuymongsukien2026@gmail.com.",
      },
      { property: "og:title", content: "Liên hệ ban tổ chức Thủy Mộng" },
      {
        property: "og:description",
        content: "Thông tin liên hệ và địa điểm tổ chức đêm diễn Thủy Mộng ngày 17/10/2026.",
      },
    ],
  }),
  component: ContactPage,
});

const DETAILS = [
  { label: "Đơn vị tổ chức", value: EVENT.venue },
  { label: "Địa chỉ", value: EVENT.address },
  { label: "Điện thoại", value: EVENT.phone, href: `tel:${EVENT.phone.replace(/\s/g, "")}` },
  { label: "Email", value: EVENT.email, href: `mailto:${EVENT.email}` },
  { label: "Ngày diễn", value: `${EVENT.dateLabel} · ${EVENT.time}` },
];

function ContactPage() {
  return (
    <PageShell>
      <PageHeading
        eyebrow="Liên hệ"
        title="Ban tổ chức Thủy Mộng"
        description="Mọi thắc mắc về vé, đơn hàng hoặc ấn phẩm lưu niệm, vui lòng liên hệ trực tiếp với nhà hát."
      />

      <section className="mx-auto grid max-w-6xl gap-6 px-5 pb-16 lg:grid-cols-2">
        <dl className="surface-panel divide-y divide-border p-2">
          {DETAILS.map((d) => (
            <div key={d.label} className="flex flex-wrap items-center justify-between gap-2 px-5 py-5">
              <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{d.label}</dt>
              <dd className="text-sm text-foreground">
                {d.href ? (
                  <a href={d.href} className="text-primary hover:underline">
                    {d.value}
                  </a>
                ) : (
                  d.value
                )}
              </dd>
            </div>
          ))}
        </dl>

        <div className="surface-panel overflow-hidden">
          <iframe
            title="Bản đồ Nhà Hát Múa Rối Việt Nam"
            src="https://www.google.com/maps?q=361%20Tr%C6%B0%E1%BB%9Dng%20Chinh,%20Thanh%20Xu%C3%A2n,%20H%C3%A0%20N%E1%BB%99i&output=embed"
            className="h-full min-h-80 w-full border-0"
            loading="lazy"
          />
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-5 pb-16 text-sm text-muted-foreground">
        Dành cho ban tổ chức:{" "}
        <Link to="/admin" className="text-primary hover:underline">
          trang quản trị
        </Link>
        .
      </div>
    </PageShell>
  );
}
