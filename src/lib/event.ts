export const EVENT = {
  name: "Thủy Mộng",
  subtitle: "Đêm nghệ thuật múa rối nước",
  dateLabel: "17 tháng 10, 2026",
  dateShort: "17/10/2026",
  time: "19:30",
  venue: "Nhà Hát Múa Rối Việt Nam",
  address: "361 Trường Chinh, Thanh Xuân, Hà Nội",
  phone: "096 775 20 06",
  email: "thuymongsukien2026@gmail.com",
} as const;

export const BANK = {
  name: "Techcombank",
  bin: "TCB",
  accountNumber: "800009022006",
  accountName: "NGUYEN QUANG MINH",
  accountNameDisplay: "Nguyễn Quang Minh",
} as const;

export const ORDER_STATUS = {
  pending: "Đang chờ thanh toán",
  paid: "Đã thanh toán",
  used: "Đã sử dụng",
  cancelled: "Đã huỷ",
} as const;

export type OrderStatus = keyof typeof ORDER_STATUS;

export function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN").format(amount) + "đ";
}

export function transferContent(orderCode: string): string {
  return `MUA_VE_${orderCode}`;
}

/** Ảnh VietQR động cho Techcombank. */
export function vietQrUrl(orderCode: string, amount: number): string {
  const params = new URLSearchParams({
    amount: String(amount),
    addInfo: transferContent(orderCode),
    accountName: BANK.accountName,
  });
  return `https://img.vietqr.io/image/${BANK.bin}-${BANK.accountNumber}-compact2.png?${params.toString()}`;
}

/** Ảnh QR check-in sinh từ token của đơn hàng. */
export function checkinQrUrl(token: string, size = 420): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(
    token,
  )}`;
}
