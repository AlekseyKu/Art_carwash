import { TIMEZONE } from "@art/shared";
import { nanoid } from "nanoid";
import { db } from "./db.js";

type ShiftRow = {
  id: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  opened_by_washer_id: string | null;
  closed_by_washer_id: string | null;
  note: string | null;
};

function moscowDateLabel(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Начало календарного дня Europe/Moscow в ISO. */
export function moscowDayStartIso(d = new Date()) {
  const label = moscowDateLabel(d);
  return new Date(`${label}T00:00:00+03:00`).toISOString();
}

function washerName(id: string | null) {
  if (!id) return null;
  const row = db.prepare("SELECT name FROM washers WHERE id = ?").get(id) as
    | { name: string }
    | undefined;
  return row?.name ?? null;
}

function mapShift(row: ShiftRow) {
  return {
    id: row.id,
    status: row.status as "open" | "closed",
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    openedByWasherId: row.opened_by_washer_id,
    closedByWasherId: row.closed_by_washer_id,
    openedByName: washerName(row.opened_by_washer_id),
    closedByName: washerName(row.closed_by_washer_id),
    note: row.note,
  };
}

export function getOpenShift() {
  const row = db
    .prepare("SELECT * FROM shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1")
    .get() as ShiftRow | undefined;
  return row ? mapShift(row) : null;
}

export function getShift(id: string) {
  const row = db.prepare("SELECT * FROM shifts WHERE id = ?").get(id) as ShiftRow | undefined;
  return row ? mapShift(row) : null;
}

/** Смена открыта, но opened_at раньше сегодняшней полуночи MSK. */
export function isShiftStale(shift: { openedAt: string } | null) {
  if (!shift) return false;
  return shift.openedAt < moscowDayStartIso();
}

export function getShiftStatus() {
  const shift = getOpenShift();
  const stale = isShiftStale(shift);
  return {
    shift,
    needsOpen: !shift,
    needsRollover: stale,
    todayLabel: moscowDateLabel(),
  };
}

export function openShift(washerId: string, note?: string | null) {
  const existing = getOpenShift();
  if (existing) {
    if (isShiftStale(existing)) {
      throw Object.assign(
        new Error("Есть незакрытая смена за прошлый день — сначала закройте или сделайте rollover"),
        { statusCode: 409 }
      );
    }
    return { shift: existing, created: false };
  }
  const now = new Date().toISOString();
  const id = nanoid();
  db.prepare(
    `INSERT INTO shifts (id, status, opened_at, closed_at, opened_by_washer_id, closed_by_washer_id, note)
     VALUES (?, 'open', ?, NULL, ?, NULL, ?)`
  ).run(id, now, washerId, note ?? null);
  return { shift: getShift(id)!, created: true };
}

export function buildShiftReport(shiftId: string) {
  const shift = getShift(shiftId);
  if (!shift) throw Object.assign(new Error("Смена не найдена"), { statusCode: 404 });

  const orders = db
    .prepare(
      `SELECT o.id, o.number, o.status, o.payment_method, o.subtotal_kopecks, o.discount_kopecks,
              o.total_kopecks, o.paid_at, o.created_at, o.washer_id,
              c.plate_number, w.name as washer_name
       FROM orders o
       LEFT JOIN clients c ON c.id = o.client_id
       LEFT JOIN washers w ON w.id = o.washer_id
       WHERE o.shift_id = ? AND o.status = 'paid'
       ORDER BY o.paid_at ASC`
    )
    .all(shiftId) as {
    id: string;
    number: number;
    status: string;
    payment_method: string | null;
    subtotal_kopecks: number;
    discount_kopecks: number;
    total_kopecks: number;
    paid_at: string | null;
    created_at: string;
    washer_id: string;
    plate_number: string | null;
    washer_name: string | null;
  }[];

  const byPay = new Map<string, { total: number; count: number }>();
  let totalKopecks = 0;

  const detailed = orders.map((o) => {
    totalKopecks += o.total_kopecks;
    const mKey = o.payment_method ?? "unknown";
    const m = byPay.get(mKey) ?? { total: 0, count: 0 };
    m.total += o.total_kopecks;
    m.count += 1;
    byPay.set(mKey, m);

    const items = db
      .prepare(
        "SELECT name_snapshot, price_kopecks, qty FROM order_items WHERE order_id = ?"
      )
      .all(o.id) as { name_snapshot: string; price_kopecks: number; qty: number }[];

    return {
      id: o.id,
      number: o.number,
      status: o.status,
      paymentMethod: o.payment_method,
      subtotalKopecks: o.subtotal_kopecks,
      discountKopecks: o.discount_kopecks,
      totalKopecks: o.total_kopecks,
      paidAt: o.paid_at,
      createdAt: o.created_at,
      washerId: o.washer_id,
      washerName: o.washer_name,
      plateNumber: o.plate_number,
      items: items.map((i) => ({
        nameSnapshot: i.name_snapshot,
        priceKopecks: i.price_kopecks,
        qty: i.qty,
        lineTotalKopecks: i.price_kopecks * i.qty,
      })),
    };
  });

  return {
    shift,
    totalKopecks,
    orderCount: detailed.length,
    byPaymentMethod: [...byPay.entries()].map(([label, v]) => ({
      label,
      totalKopecks: v.total,
      count: v.count,
    })),
    orders: detailed,
  };
}

export function closeShift(washerId: string, note?: string | null) {
  const open = getOpenShift();
  if (!open) throw Object.assign(new Error("Нет открытой смены"), { statusCode: 404 });
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE shifts SET status = 'closed', closed_at = ?, closed_by_washer_id = ?,
     note = COALESCE(?, note) WHERE id = ?`
  ).run(now, washerId, note ?? null, open.id);
  return buildShiftReport(open.id);
}

/** Закрыть вчерашнюю (stale) и открыть новую. */
export function rolloverShift(washerId: string) {
  const open = getOpenShift();
  let closedReport = null as ReturnType<typeof buildShiftReport> | null;
  if (open) {
    if (!isShiftStale(open)) {
      return { closedReport: null, shift: open, created: false };
    }
    closedReport = closeShift(washerId, "Автозакрытие: смена перешла на следующий день");
  }
  const { shift, created } = openShift(washerId, "Автооткрытие после rollover");
  return { closedReport, shift, created };
}

export function listShifts(limit = 40) {
  const n = Math.min(100, Math.max(1, limit));
  const rows = db
    .prepare("SELECT * FROM shifts ORDER BY opened_at DESC LIMIT ?")
    .all(n) as ShiftRow[];

  return rows.map((row) => {
    const shift = mapShift(row);
    const agg = db
      .prepare(
        `SELECT COUNT(*) as c, COALESCE(SUM(total_kopecks), 0) as t
         FROM orders WHERE shift_id = ? AND status = 'paid'`
      )
      .get(row.id) as { c: number; t: number };
    return {
      ...shift,
      orderCount: agg.c,
      totalKopecks: agg.t,
    };
  });
}

/** Привязать оплачиваемый заказ к текущей открытой смене (если есть). */
export function attachOrderToOpenShift(orderId: string) {
  const open = getOpenShift();
  if (!open || isShiftStale(open)) return null;
  db.prepare("UPDATE orders SET shift_id = ? WHERE id = ? AND (shift_id IS NULL OR shift_id = '')").run(
    open.id,
    orderId
  );
  return open.id;
}
