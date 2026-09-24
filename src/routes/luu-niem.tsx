import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";

import { PageShell, PageHeading } from "@/components/PageShell";
import { MerchCard } from "@/components/MerchCard";
import { catalogQuery } from "@/lib/queries";

export const Route = createFileRoute("/luu-niem")({
  head: () => ({
    meta: [
      { title: "Ấn phẩm lưu niệm — Thủy Mộng" },
      {
        name: "description",
        content:
          "Áo thun, túi vải canvas, quạt giấy và móc khóa nghệ thuật thiết kế riêng cho đêm diễn Thủy Mộng.",
      },
      { property: "og:title", content: "Ấn phẩm lưu niệm Thủy Mộng" },
      {
        property: "og:description",
        content: "Bộ sưu tập lưu niệm thiết kế độc quyền cho đêm múa rối nước 17/10/2026.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogQuery),
  component: MerchPage,
});

function MerchPage() {
  const { data } = useSuspenseQuery(catalogQuery);

  return (
    <PageShell>
      <PageHeading
        eyebrow="Cửa hàng lưu niệm"
        title="Mang một mảnh Thủy Mộng về nhà"
        description="Bốn ấn phẩm thiết kế riêng cho đêm diễn, nhận cùng vé tại quầy check-in ngày 17/10/2026."
      />

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {data.merch.map((item) => (
            <MerchCard key={item.code} item={item} />
          ))}
        </div>

        <p className="mt-10 text-center text-sm text-muted-foreground">
          Ấn phẩm chỉ bán kèm vé.{" "}
          <Link to="/ve" className="text-primary hover:underline">
            Chọn hạng vé trước
          </Link>{" "}
          nếu bạn chưa có vé.
        </p>
      </section>
    </PageShell>
  );
}
