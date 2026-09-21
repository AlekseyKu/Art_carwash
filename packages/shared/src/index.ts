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

export type ShiftStatus = "open" | "closed";

export interface CashShift {
  id: string;
  status: ShiftStatus;
  openedAt: string;
  closedAt: string | null;
  openedByWasherId: string | null;
  closedByWasherId: string | null;
  openedByName?: string | null;
  closedByName?: string | null;
  note?: string | null;
  orderCount?: number;
  totalKopecks?: number;
}

export interface ShiftOrderLine {
  nameSnapshot: string;
  priceKopecks: number;
  qty: number;
  lineTotalKopecks: number;
}

export interface ShiftOrderDetail {
  id: string;
  number: number;
  status: string;
  paymentMethod: PaymentMethod | null;
  subtotalKopecks: number;
  discountKopecks: number;
  totalKopecks: number;
  tipsKopecks?: number;
  paidAt: string | null;
  createdAt: string;
  washerId: string;
  washerName: string | null;
  plateNumber: string | null;
  items: ShiftOrderLine[];
}

export interface ShiftReport {
  shift: CashShift;
  totalKopecks: number;
  tipsKopecks?: number;
  orderCount: number;
  byPaymentMethod: AnalyticsBucket[];
  orders: ShiftOrderDetail[];
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

/** ISO weekday: 1=Пн … 7=Вс */
export type SiteScheduleWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type SiteScheduleDay = {
  weekday: SiteScheduleWeekday;
  closed: boolean;
  /** "HH:mm" */
  open: string;
  /** "HH:mm" */
  close: string;
};

export type SiteSchedule = {
  days: SiteScheduleDay[];
};

export type DayWindow = {
  openHour: number;
  openMinute: number;
  closeHour: number;
  closeMinute: number;
};

export const SITE_SCHEDULE_WEEKDAY_LABELS_SHORT = [
  "Пн",
  "Вт",
  "Ср",
  "Чт",
  "Пт",
  "Сб",
  "Вс",
] as const;

export function defaultSiteSchedule(): SiteSchedule {
  return {
    days: ([1, 2, 3, 4, 5, 6, 7] as SiteScheduleWeekday[]).map((weekday) => ({
      weekday,
      closed: false,
      open: "09:00",
      close: "21:00",
    })),
  };
}

export function parseHm(hm: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm ?? "").trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function formatHm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** YYYY-MM-DD (календарный день) → ISO weekday 1–7. */
export function isoWeekdayFromDate(date: string): SiteScheduleWeekday {
  const [y, mo, da] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y, mo - 1, da, 12, 0, 0));
  const sun0 = utc.getUTCDay();
  return (sun0 === 0 ? 7 : sun0) as SiteScheduleWeekday;
}

export function normalizeSiteSchedule(raw: unknown): SiteSchedule {
  const fallback = defaultSiteSchedule();
  if (!raw || typeof raw !== "object") return fallback;
  const daysIn = (raw as { days?: unknown }).days;
  if (!Array.isArray(daysIn)) return fallback;
  const byWd = new Map<number, SiteScheduleDay>();
  for (const row of daysIn) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const weekday = Number(r.weekday);
    if (weekday < 1 || weekday > 7) continue;
    const closed = Boolean(r.closed);
    const open = typeof r.open === "string" && parseHm(r.open) ? r.open : "09:00";
    const close = typeof r.close === "string" && parseHm(r.close) ? r.close : "21:00";
    byWd.set(weekday, {
      weekday: weekday as SiteScheduleWeekday,
      closed,
      open,
      close,
    });
  }
  return {
    days: fallback.days.map((d) => byWd.get(d.weekday) ?? d),
  };
}

/** null = выходной / невалидное окно. */
export function resolveDayWindow(
  date: string,
  schedule?: SiteSchedule | null
): DayWindow | null {
  const sched = schedule ? normalizeSiteSchedule(schedule) : defaultSiteSchedule();
  const wd = isoWeekdayFromDate(date);
  const day = sched.days.find((d) => d.weekday === wd) ?? defaultSiteSchedule().days[wd - 1];
  if (day.closed) return null;
  const open = parseHm(day.open);
  const close = parseHm(day.close);
  if (!open || !close) return null;
  if (open.hour * 60 + open.minute >= close.hour * 60 + close.minute) return null;
  return {
    openHour: open.hour,
    openMinute: open.minute,
    closeHour: close.hour,
    closeMinute: close.minute,
  };
}

function daySignature(d: SiteScheduleDay): string {
  if (d.closed) return "closed";
  return `${d.open}-${d.close}`;
}

/** Сводка для site.hoursText. */
export function formatHoursText(schedule?: SiteSchedule | null): string {
  const sched = schedule ? normalizeSiteSchedule(schedule) : defaultSiteSchedule();
  const groups: { label: string; text: string }[] = [];
  let i = 0;
  while (i < 7) {
    const start = i;
    const sig = daySignature(sched.days[i]);
    i += 1;
    while (i < 7 && daySignature(sched.days[i]) === sig) i += 1;
    const a = SITE_SCHEDULE_WEEKDAY_LABELS_SHORT[start];
    const b = SITE_SCHEDULE_WEEKDAY_LABELS_SHORT[i - 1];
    const range = start === i - 1 ? a : `${a}–${b}`;
    const day = sched.days[start];
    const text = day.closed ? "выходной" : `${day.open}–${day.close}`;
    groups.push({ label: range, text });
  }
  if (groups.length === 1) {
    return groups[0].text === "выходной"
      ? "Выходной"
      : `Ежедневно ${groups[0].text}`;
  }
  return groups.map((g) => `${g.label} ${g.text}`).join(" · ");
}

export const SITE_SCHEDULE_WEEKDAY_LABELS = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
] as const;
