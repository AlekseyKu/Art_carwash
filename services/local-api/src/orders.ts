import { calcDiscountKopecks, type Discount, type PaymentMethod } from "@art/shared";
import { nanoid } from "nanoid";
import { db } from "./db.js";
import { getOpenShift, isShiftStale } from "./shifts.js";
import { enqueueOutbox } from "./sync.js";

type OrderRow = {
  id: string;
  number: number;
  post_id: number;
  washer_id: string;
  client_id: string | null;
  discount_id: string | null;
  status: string;
  payment_method: string | null;
  subtotal_kopecks: number;
  discount_kopecks: number;
  total_kopecks: number;
  created_at: string;
  paid_at: string | null;
  updated_at: string;
};

function mapOrder(row: OrderRow) {
  const items = db
    .prepare("SELECT * FROM order_items WHERE order_id = ?")
    .all(row.id) as {
    id: string;
    order_id: string;
    service_id: string;
    name_snapshot: string;
    price_kopecks: number;
    qty: number;
  }[];

  return {
    id: row.id,
    number: row.number,
    postId: row.post_id,
    washerId: row.washer_id,
    clientId: row.client_id,
    discountId: row.discount_id,
    status: row.status,
    paymentMethod: row.payment_method,
    subtotalKopecks: row.subtotal_kopecks,
    discountKopecks: row.discount_kopecks,
    totalKopecks: row.total_kopecks,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    updatedAt: row.updated_at,
    items: items.map((i) => ({
      id: i.id,
      orderId: i.order_id,
      serviceId: i.service_id,
      nameSnapshot: i.name_snapshot,
      priceKopecks: i.price_kopecks,
      qty: i.qty,
    })),
  };
}

function dayStartUtcIso() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  // Approximate Moscow midnight as UTC-3
  return new Date(`${y}-${m}-${d}T00:00:00+03:00`).toISOString();
}

function nextOrderNumber() {
  const start = dayStartUtcIso();
  const row = db
    .prepare("SELECT COALESCE(MAX(number), 0) as n FROM orders WHERE created_at >= ?")
    .get(start) as { n: number };
  return row.n + 1;
}

function getDiscount(id: string | null): Discount | null {
  if (!id) return null;
  const row = db.prepare("SELECT * FROM discounts WHERE id = ? AND active = 1").get(id) as
    | { id: string; name: string; type: "percent" | "fixed"; value: number; active: number }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    value: row.value,
    active: !!row.active,
  };
}

function recalc(orderId: string) {
  const items = db
    .prepare("SELECT price_kopecks, qty FROM order_items WHERE order_id = ?")
    .all(orderId) as { price_kopecks: number; qty: number }[];
  const subtotal = items.reduce((s, i) => s + i.price_kopecks * i.qty, 0);
  const order = db.prepare("SELECT discount_id FROM orders WHERE id = ?").get(orderId) as {
    discount_id: string | null;
  };
  const discount = getDiscount(order.discount_id);
  const discountKopecks = calcDiscountKopecks(subtotal, discount);
  const total = Math.max(0, subtotal - discountKopecks);
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE orders SET subtotal_kopecks = ?, discount_kopecks = ?, total_kopecks = ?, updated_at = ? WHERE id = ?"
  ).run(subtotal, discountKopecks, total, now, orderId);
}

export function getOrCreateDraft(postId: number, washerId: string) {
  const existing = db
    .prepare(
      "SELECT * FROM orders WHERE post_id = ? AND status = 'draft' ORDER BY updated_at DESC LIMIT 1"
    )
    .get(postId) as OrderRow | undefined;
  if (existing) {
    if (existing.washer_id !== washerId) {
      const now = new Date().toISOString();
      db.prepare("UPDATE orders SET washer_id = ?, updated_at = ? WHERE id = ?").run(
        washerId,
        now,
        existing.id
      );
      existing.washer_id = washerId;
    }
    return mapOrder(existing);
  }

  const now = new Date().toISOString();
  const id = nanoid();
  const number = nextOrderNumber();
  db.prepare(
    `INSERT INTO orders (id, number, post_id, washer_id, client_id, discount_id, status,
      payment_method, subtotal_kopecks, discount_kopecks, total_kopecks, created_at, paid_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, 'draft', NULL, 0, 0, 0, ?, NULL, ?)`
  ).run(id, number, postId, washerId, now, now);
  return mapOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow);
}

export function getOrder(id: string) {
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow | undefined;
  return row ? mapOrder(row) : null;
}

export function setOrderItems(
  orderId: string,
  items: { serviceId: string; qty: number }[],
  discountId: string | null
) {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId) as OrderRow | undefined;
  if (!order || order.status !== "draft") throw new Error("Заказ нельзя изменить");

  db.prepare("DELETE FROM order_items WHERE order_id = ?").run(orderId);
  for (const item of items) {
    if (item.qty <= 0) continue;
    const svc = db
      .prepare("SELECT id, name, price_kopecks FROM services WHERE id = ? AND active = 1")
      .get(item.serviceId) as { id: string; name: string; price_kopecks: number } | undefined;
    if (!svc) continue;
    db.prepare(
      "INSERT INTO order_items (id, order_id, service_id, name_snapshot, price_kopecks, qty) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(nanoid(), orderId, svc.id, svc.name, svc.price_kopecks, item.qty);
  }
  db.prepare("UPDATE orders SET discount_id = ?, updated_at = ? WHERE id = ?").run(
    discountId,
    new Date().toISOString(),
    orderId
  );
  recalc(orderId);
  return getOrder(orderId)!;
}

export function markAwaitingPayment(orderId: string) {
  const order = getOrder(orderId);
  if (!order || order.status !== "draft") throw new Error("Неверный статус");
  if (!order.items?.length) throw new Error("Пустой заказ");
  db.prepare("UPDATE orders SET status = 'awaiting_payment', updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    orderId
  );
  return getOrder(orderId)!;
}

export function markPaid(orderId: string, method: PaymentMethod) {
  const now = new Date().toISOString();
  const open = getOpenShift();
  const shiftId = open && !isShiftStale(open) ? open.id : null;
  if (shiftId) {
    db.prepare(
      "UPDATE orders SET status = 'paid', payment_method = ?, paid_at = ?, updated_at = ?, shift_id = ? WHERE id = ?"
    ).run(method, now, now, shiftId, orderId);
  } else {
    db.prepare(
      "UPDATE orders SET status = 'paid', payment_method = ?, paid_at = ?, updated_at = ? WHERE id = ?"
    ).run(method, now, now, orderId);
  }
  const order = getOrder(orderId)!;
  enqueueOutbox("order.paid", order);
  return order;
}

export function cancelOrder(orderId: string) {
  db.prepare("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    orderId
  );
  const order = getOrder(orderId)!;
  enqueueOutbox("order.cancelled", order);
  return order;
}

/** Краткие последние заказы для панели кассы (без draft). */
export function listRecentOrders(limit = 5) {
  const n = Math.min(20, Math.max(1, limit));
  const rows = db
    .prepare(
      `SELECT o.id, o.number, o.post_id, o.status, o.payment_method, o.total_kopecks,
              o.paid_at, o.created_at, o.updated_at,
              c.plate_number, w.name as washer_name
       FROM orders o
       LEFT JOIN clients c ON c.id = o.client_id
       LEFT JOIN washers w ON w.id = o.washer_id
       WHERE o.status IN ('paid', 'cancelled', 'awaiting_payment')
       ORDER BY COALESCE(o.paid_at, o.updated_at) DESC
       LIMIT ?`
    )
    .all(n) as {
    id: string;
    number: number;
    post_id: number;
    status: string;
    payment_method: string | null;
    total_kopecks: number;
    paid_at: string | null;
    created_at: string;
    updated_at: string;
    plate_number: string | null;
    washer_name: string | null;
  }[];

  return rows.map((r) => {
    const items = db
      .prepare("SELECT name_snapshot, qty FROM order_items WHERE order_id = ? LIMIT 3")
      .all(r.id) as { name_snapshot: string; qty: number }[];
    return {
      id: r.id,
      number: r.number,
      postId: r.post_id,
      status: r.status,
      paymentMethod: r.payment_method,
      totalKopecks: r.total_kopecks,
      paidAt: r.paid_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      plateNumber: r.plate_number,
      washerName: r.washer_name,
      itemsPreview: items.map((i) => (i.qty > 1 ? `${i.name_snapshot} ×${i.qty}` : i.name_snapshot)),
    };
  });
}

export function analytics(fromIso: string, toIso: string) {
  const orders = db
    .prepare(
      `SELECT * FROM orders WHERE status = 'paid' AND paid_at >= ? AND paid_at < ?`
    )
    .all(fromIso, toIso) as OrderRow[];

  const totalKopecks = orders.reduce((s, o) => s + o.total_kopecks, 0);
  const byPost = new Map<string, { total: number; count: number }>();
  const byPay = new Map<string, { total: number; count: number }>();
  const byService = new Map<string, { total: number; count: number }>();

  for (const o of orders) {
    const pKey = String(o.post_id);
    const p = byPost.get(pKey) ?? { total: 0, count: 0 };
    p.total += o.total_kopecks;
    p.count += 1;
    byPost.set(pKey, p);

    const mKey = o.payment_method ?? "unknown";
    const m = byPay.get(mKey) ?? { total: 0, count: 0 };
    m.total += o.total_kopecks;
    m.count += 1;
    byPay.set(mKey, m);

    const items = db
      .prepare("SELECT name_snapshot, price_kopecks, qty FROM order_items WHERE order_id = ?")
      .all(o.id) as { name_snapshot: string; price_kopecks: number; qty: number }[];
    for (const i of items) {
      const s = byService.get(i.name_snapshot) ?? { total: 0, count: 0 };
      s.total += i.price_kopecks * i.qty;
      s.count += i.qty;
      byService.set(i.name_snapshot, s);
    }
  }

  return {
    from: fromIso,
    to: toIso,
    totalKopecks,
    orderCount: orders.length,
    byService: [...byService.entries()].map(([label, v]) => ({
      label,
      totalKopecks: v.total,
      count: v.count,
    })),
    byPost: [...byPost.entries()].map(([label, v]) => ({
      label: `Пост ${label}`,
      totalKopecks: v.total,
      count: v.count,
    })),
    byPaymentMethod: [...byPay.entries()].map(([label, v]) => ({
      label,
      totalKopecks: v.total,
      count: v.count,
    })),
  };
}
