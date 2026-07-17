export type PaymentMethod = "cash" | "card" | "sbp";
export type OrderStatus = "draft" | "awaiting_payment" | "paid" | "cancelled";
export type DiscountType = "percent" | "fixed";

/** Вкладка каталога на кассе (Услуги, Товары, …). */
export interface CatalogTab {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface Service {
  id: string;
  name: string;
  priceKopecks: number;
  active: boolean;
  sortOrder: number;
  /** Вкладка каталога (услуги мойки / товары бара и т.п.). */
  tabId: string;
}

export interface Discount {
  id: string;
  name: string;
  type: DiscountType;
  value: number;
  active: boolean;
}

export interface Washer {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
}

export interface Post {
  id: number;
  name: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  serviceId: string;
  nameSnapshot: string;
  priceKopecks: number;
  qty: number;
}

export interface Order {
  id: string;
  number: number;
  postId: number;
  washerId: string;
  clientId: string | null;
  discountId: string | null;
  status: OrderStatus;
  paymentMethod: PaymentMethod | null;
  subtotalKopecks: number;
  discountKopecks: number;
  totalKopecks: number;
  createdAt: string;
  paidAt: string | null;
  updatedAt: string;
  items?: OrderItem[];
}

export interface TerminalConfig {
  adapter: "emulator" | "generic_http" | "sdk_bridge";
  host?: string;
  port?: number;
  comPort?: string;
  merchantId?: string;
  notes?: string;
}

export interface AnalyticsBucket {
  label: string;
  totalKopecks: number;
  count: number;
}

export interface AnalyticsReport {
  from: string;
  to: string;
  totalKopecks: number;
  orderCount: number;
  byService: AnalyticsBucket[];
  byPost: AnalyticsBucket[];
  byPaymentMethod: AnalyticsBucket[];
}

export function formatRub(kopecks: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(kopecks / 100);
}

export function calcDiscountKopecks(
  subtotal: number,
  discount: Pick<Discount, "type" | "value"> | null
): number {
  if (!discount) return 0;
  if (discount.type === "percent") {
    return Math.min(subtotal, Math.round((subtotal * discount.value) / 100));
  }
  return Math.min(subtotal, discount.value);
}

export const BRAND_NAME = "Автомойка АРТ";
export const TIMEZONE = "Europe/Moscow";
