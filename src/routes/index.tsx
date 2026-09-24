import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";

import heroImage from "@/assets/hero.jpg";
import { PageShell } from "@/components/PageShell";
import { TicketTierCard } from "@/components/TicketTierCard";
import { MerchCard } from "@/components/MerchCard";
import { catalogQuery } from "@/lib/queries";
import { BANK, EVENT } from "@/lib/event";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Thủy Mộng — Đêm nghệ thuật múa rối nước 17/10/2026" },
      {
        name: "description",
        content:
          "Đặt vé trực tuyến cho đêm múa rối nước Thủy Mộng, diễn duy nhất ngày 17/10/2026 tại Nhà Hát Múa Rối Việt Nam, Hà Nội.",
      },
      { property: "og:title", content: "Thủy Mộng — Đêm nghệ thuật múa rối nước" },
      {
        property: "og:description",
        content: "Bốn hạng vé, ấn phẩm lưu niệm và thanh toán VietQR tự động. Duy nhất 17/10/2026.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogQuery),
  component: HomePage,
});

function HomePage() {
  const { data } = useSuspenseQuery(catalogQuery);

  return (
    <PageShell>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <img
          src={heroImage}
          alt="Sân khấu múa rối nước dưới ánh trăng"
          width={1920}
          height={1088}
          className="absolute inset-0 h-full w-full object-cover opacity-60"
        />
        <div className="absolute inset-0 bg-[var(--gradient-water)]" />
        <div className="ripple-lines animate-ripple absolute inset-0 opacity-40" />

        <div className="relative mx-auto max-w-6xl px-5 pb-28 pt-28 md:pt-36">
          <div className="animate-rise max-w-2xl">
            <div className="mb-7 flex items-center gap-3 text-[11px] uppercase tracking-[0.32em] text-primary">
              <span className="h-px w-8 bg-primary/60" />
              Diễn duy nhất · {EVENT.dateShort}
            </div>
            <h1 className="font-display text-6xl leading-none text-foreground md:text-8xl">
              Thủy <span className="italic text-gilded">Mộng</span>
            </h1>
            <p className="mt-8 max-w-lg text-base leading-relaxed text-muted-foreground md:text-lg">
              Một đêm duy nhất giữa gợn nước và ánh trăng — khi mặt ao làng phủ sương, những con rối
              gỗ thắp sáng mùa thu Hà Nội.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link
                to="/ve"
                className="rounded-full bg-primary px-7 py-3.5 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-gold)] transition hover:brightness-110"
              >
                Đặt vé ngay
              </Link>
              <Link
                to="/luu-niem"
                className="rounded-full border border-border px-7 py-3.5 text-sm font-medium text-foreground transition hover:border-primary/60 hover:text-primary"
              >
                Xem ấn phẩm lưu niệm
              </Link>
            </div>

            <dl className="mt-14 flex flex-wrap gap-x-12 gap-y-5 border-t border-border pt-7">
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">Giờ mở màn</dt>
                <dd className="font-display text-2xl text-foreground">{EVENT.time}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">Thời lượng</dt>
                <dd className="font-display text-2xl text-foreground">60 phút</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">Địa điểm</dt>
                <dd className="font-display text-2xl text-foreground">361 Trường Chinh</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* Giới thiệu */}
      <section className="mx-auto max-w-6xl px-5 py-24">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-primary">Về đêm diễn</p>
            <h2 className="mt-3 font-display text-4xl leading-tight text-foreground">
              Nghìn năm rối nước, một đêm hội ngộ
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-relaxed text-muted-foreground md:text-base">
            <p>
              Ra đời từ những ruộng lúa ngập nước đồng bằng Bắc Bộ, múa rối nước là di sản hiếm hoi
              mà sân khấu chính là mặt nước. Nghệ nhân đứng sau mành tre, ngâm mình điều khiển những
              con rối gỗ sơn mài qua hệ thống sào và dây ngầm.
            </p>
            <p>
              <span className="text-foreground">Thủy Mộng</span> quy tụ các tích trò kinh điển — chú
              Tễu giáo đầu, múa rồng, Lê Lợi trả gươm, đánh cá, múa tiên — được dàn dựng lại với ánh
              sáng, âm nhạc dân tộc phối khí hiện đại và không gian sân khấu hoàn toàn mới.
            </p>
            <p>
              Toàn bộ suất diễn kéo dài 60 phút tại {EVENT.venue}, {EVENT.address}. Vé điện tử kèm mã
              QR check-in được gửi tự động vào email của bạn ngay sau khi thanh toán thành công.
            </p>
          </div>
        </div>
      </section>

      {/* Hạng vé */}
      <section className="mx-auto max-w-6xl px-5 pb-24">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-primary">Bốn hạng vé</p>
            <h2 className="mt-3 font-display text-4xl text-foreground">
              Chọn vị trí của bạn trên mặt nước
            </h2>
          </div>
          <Link to="/ve" className="text-sm text-primary hover:underline">
            Xem chi tiết quyền lợi →
          </Link>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {data.tiers.map((tier) => (
            <TicketTierCard key={tier.code} tier={tier} featured={tier.code === "vip"} />
          ))}
        </div>
      </section>

      {/* Lưu niệm */}
      <section className="mx-auto max-w-6xl px-5 pb-24">
        <div className="mb-10">
          <p className="text-[11px] uppercase tracking-[0.3em] text-primary">Ấn phẩm lưu niệm</p>
          <h2 className="mt-3 font-display text-4xl text-foreground">
            Mang một mảnh Thủy Mộng về nhà
          </h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {data.merch.map((item) => (
            <MerchCard key={item.code} item={item} />
          ))}
        </div>
      </section>

      {/* Thanh toán */}
      <section className="mx-auto max-w-6xl px-5 pb-8">
        <div className="surface-panel grid gap-10 p-8 md:p-12 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-primary">Thanh toán tự động</p>
            <h2 className="mt-3 font-display text-3xl text-foreground">VietQR động qua {BANK.name}</h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Sau khi đặt vé, hệ thống sinh mã đơn hàng riêng và hiển thị mã VietQR đúng số tiền. Quét
              bằng ứng dụng ngân hàng bất kỳ, giao dịch khớp lệnh sẽ tự động xác nhận và gửi vé điện
              tử kèm mã QR check-in vào email của bạn.
            </p>
          </div>
          <dl className="space-y-3">
            {[
              ["Ngân hàng", BANK.name],
              ["Số tài khoản", BANK.accountNumber],
              ["Chủ tài khoản", BANK.accountNameDisplay],
              ["Nội dung chuyển khoản", "MUA_VE_[Mã đơn hàng]"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background/40 px-5 py-3.5"
              >
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="font-mono text-sm text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </PageShell>
  );
}
