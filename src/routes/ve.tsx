import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";

import { PageShell, PageHeading } from "@/components/PageShell";
import { TicketTierCard } from "@/components/TicketTierCard";
import { catalogQuery } from "@/lib/queries";
import { EVENT } from "@/lib/event";

export const Route = createFileRoute("/ve")({
  head: () => ({
    meta: [
      { title: "Hạng vé — Thủy Mộng 17/10/2026" },
      {
        name: "description",
        content:
          "Bốn hạng vé Thủy Mộng: Phổ Thông 100.000đ, Tiêu Chuẩn 130.000đ, Cao Cấp 160.000đ và VIP 200.000đ kèm trọn bộ quà tặng.",
      },
      { property: "og:title", content: "Hạng vé — Thủy Mộng" },
      {
        property: "og:description",
        content: "So sánh quyền lợi bốn hạng vé và đặt chỗ cho đêm diễn 17/10/2026.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogQuery),
  component: TicketsPage,
});

function TicketsPage() {
  const { data } = useSuspenseQuery(catalogQuery);

  return (
    <PageShell>
      <PageHeading
        eyebrow={`Đêm diễn ${EVENT.dateShort}`}
        title="Bốn hạng vé, bốn giấc mộng"
        description="Mỗi hạng vé là một khoảng cách khác nhau với mặt nước. Giá đã bao gồm toàn bộ suất diễn 60 phút."
      />

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {data.tiers.map((tier) => (
            <TicketTierCard key={tier.code} tier={tier} featured={tier.code === "vip"} />
          ))}
        </div>

        <div className="surface-panel mt-10 flex flex-wrap items-center justify-between gap-4 p-7">
          <div>
            <p className="font-display text-2xl text-foreground">Đã chọn xong hạng vé?</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Bạn có thể thêm ấn phẩm lưu niệm trước khi thanh toán.
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              to="/luu-niem"
              className="rounded-full border border-border px-6 py-3 text-sm text-foreground transition hover:border-primary/60 hover:text-primary"
            >
              Xem lưu niệm
            </Link>
            <Link
              to="/thanh-toan"
              className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-110"
            >
              Tới thanh toán
            </Link>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
