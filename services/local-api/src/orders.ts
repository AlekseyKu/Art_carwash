import { calcDiscountKopecks, type Discount, type PaymentMethod } from "@art/shared";
import { nanoid } from "nanoid";
import {
  db,
  getDefaultVehicleClass,
  resolveServicePrice,
  type VehicleClassRow,
} from "./db.js";
import { getOpenShift, isShiftStale } from "./shifts.js";
import { enqueueOutbox } from "./sync.js";
import { linkPaidOrderToCalendar } from "./bookings.js";

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
  tips_kopecks: number;
  created_at: string;
  paid_at: string | null;
  updated_at: string;
  vehicle_class_id: string | null;
  vehicle_class_name: string | null;
};

export type OrderItemInput = {
  serviceId?: string | null;
  name?: string;
  qty: number;
  priceKopecks?: number;
  basePriceKopecks?: number;
  coefficientExtraKopecks?: number;
  discountPercent?: number;
  isManual?: boolean;
};

type ItemRow = {
  id: string;
  order_id: string;
  service_id: string;
  name_snapshot: string;
  price_kopecks: number;
  qty: number;
  is_manual?: number;
  base_price_kopecks?: number | null;
  coefficient_extra_kopecks?: number;
  discount_percent?: number;
};

function clampDiscountPercent(raw: unknown): number {
  const n = Math.round(Number(raw) || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function linePriceKopecks(base: number, extra: number, discountPercent: number): number {
  const gross = Math.max(0, base) + Math.max(0, extra);
  const pct = clampDiscountPercent(discountPercent);
  return Math.round((gross * (100 - pct)) / 100);
}

function mapOrder(row: OrderRow) {
  const items = db
    .prepare("SELECT * FROM order_items WHERE order_id = ?")
    .all(row.id) as ItemRow[];

  const staff = db
    .prepare(
      `SELECT sw.id, sw.name, sw.salary_percent
       FROM order_staff_washers osw
       JOIN staff_washers sw ON sw.id = osw.staff_washer_id
       WHERE osw.order_id = ?
       ORDER BY sw.sort_order, sw.name`
    )
    .all(row.id) as { id: string; name: string; salary_percent: number }[];

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
    tipsKopecks: row.tips_kopecks ?? 0,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    updatedAt: row.updated_at,
    vehicleClassId: row.vehicle_class_id,
    vehicleClassName: row.vehicle_class_name,
    staffWasherIds: staff.map((s) => s.id),
    staffWashers: staff.map((s) => ({
      id: s.id,
      name: s.name,
      salaryPercent: s.salary_percent,
    })),
    items: items.map((i) => {
      const isManual = !!i.is_manual || !i.service_id;
      const base = i.base_price_kopecks ?? i.price_kopecks;
      const extra = i.coefficient_extra_kopecks ?? 0;
      const discountPercent = clampDiscountPercent(i.discount_percent);
      return {
        id: i.id,
        orderId: i.order_id,
        serviceId: isManual ? null : i.service_id,
        nameSnapshot: i.name_snapshot,
        priceKopecks: i.price_kopecks,
        qty: i.qty,
        isManual,
        basePriceKopecks: base,
        coefficientExtraKopecks: extra,
        discountPercent,
      };
    }),
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

function ensureOrderHasVehicleClass(order: OrderRow): OrderRow {
  if (order.vehicle_class_id) return order;
  const sedan = getDefaultVehicleClass();
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE orders SET vehicle_class_id = ?, vehicle_class_name = ?, updated_at = ? WHERE id = ?"
  ).run(sedan.id, sedan.name, now, order.id);
  order.vehicle_class_id = sedan.id;
  order.vehicle_class_name = sedan.name;
  order.updated_at = now;
  return order;
}

function setOrderStaffWashers(orderId: string, staffWasherIds: string[] | undefined) {
  if (staffWasherIds === undefined) return;
  db.prepare("DELETE FROM order_staff_washers WHERE order_id = ?").run(orderId);
  const insert = db.prepare(
    "INSERT INTO order_staff_washers (order_id, staff_washer_id) VALUES (?, ?)"
  );
  const seen = new Set<string>();
  for (const id of staffWasherIds) {
    if (!id || seen.has(id)) continue;
    const row = db
      .prepare("SELECT id FROM staff_washers WHERE id = ? AND active = 1")
      .get(id) as { id: string } | undefined;
    if (!row) continue;
    seen.add(id);
    insert.run(orderId, id);
  }
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
    return mapOrder(ensureOrderHasVehicleClass(existing));
  }

  const now = new Date().toISOString();
  const id = nanoid();
  const number = nextOrderNumber();
  const sedan = getDefaultVehicleClass();
  db.prepare(
    `INSERT INTO orders (id, number, post_id, washer_id, client_id, discount_id, status,
      payment_method, subtotal_kopecks, discount_kopecks, total_kopecks, created_at, paid_at, updated_at,
      vehicle_class_id, vehicle_class_name)
     VALUES (?, ?, ?, ?, NULL, NULL, 'draft', NULL, 0, 0, 0, ?, NULL, ?, ?, ?)`
  ).run(id, number, postId, washerId, now, now, sedan.id, sedan.name);
  return mapOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow);
}

export function getOrder(id: string) {
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow | undefined;
  return row ? mapOrder(row) : null;
}

export function setOrderItems(
  orderId: string,
  items: OrderItemInput[],
  discountId: string | null,
  staffWasherIds?: string[]
) {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId) as OrderRow | undefined;
  if (!order || order.status !== "draft") throw new Error("Заказ нельзя изменить");
  ensureOrderHasVehicleClass(order);

  db.prepare("DELETE FROM order_items WHERE order_id = ?").run(orderId);
  const insert = db.prepare(
    `INSERT INTO order_items (
      id, order_id, service_id, name_snapshot, price_kopecks, qty,
      is_manual, base_price_kopecks, coefficient_extra_kopecks, discount_percent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const item of items) {
    if (item.qty <= 0) continue;
    const isManual = !!item.isManual || !item.serviceId;
    const discountPercent = clampDiscountPercent(item.discountPercent);

    if (isManual) {
      const name = String(item.name ?? "").trim();
      if (!name) continue;
      const base = Math.max(0, Math.round(item.basePriceKopecks ?? item.priceKopecks ?? 0));
      const price = linePriceKopecks(base, 0, discountPercent);
      insert.run(nanoid(), orderId, "", name, price, item.qty, 1, base, 0, discountPercent);
      continue;
    }

    const svc = db
      .prepare(
        "SELECT id, name, coefficient_enabled, coefficient_step_kopecks FROM services WHERE id = ? AND active = 1"
      )
      .get(item.serviceId!) as
      | {
          id: string;
          name: string;
          coefficient_enabled: number;
          coefficient_step_kopecks: number;
        }
      | undefined;
    if (!svc) continue;
    const catalogPrice = resolveServicePrice(svc.id, order.vehicle_class_id);
    if (catalogPrice === null) continue;

    const base =
      item.basePriceKopecks != null && Number.isFinite(item.basePriceKopecks)
        ? Math.max(0, Math.round(item.basePriceKopecks))
        : catalogPrice;
    let extra = Math.max(0, Math.round(item.coefficientExtraKopecks ?? 0));
    if (!svc.coefficient_enabled) extra = 0;
    const price = linePriceKopecks(base, extra, discountPercent);

    insert.run(
      nanoid(),
      orderId,
      svc.id,
      svc.name,
      price,
      item.qty,
      0,
      base,
      extra,
      discountPercent
    );
  }

  db.prepare("UPDATE orders SET discount_id = ?, updated_at = ? WHERE id = ?").run(
    discountId,
    new Date().toISOString(),
    orderId
  );
  setOrderStaffWashers(orderId, staffWasherIds);
  recalc(orderId);
  return getOrder(orderId)!;
}

export function setOrderVehicleClass(orderId: string, classId: string) {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId) as OrderRow | undefined;
  if (!order || order.status !== "draft") throw new Error("Заказ нельзя изменить");

  const vc = db.prepare("SELECT * FROM vehicle_classes WHERE id = ? AND active = 1").get(classId) as
    | VehicleClassRow
    | undefined;
  if (!vc) throw new Error("Класс автомобиля не найден");

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE orders SET vehicle_class_id = ?, vehicle_class_name = ?, updated_at = ? WHERE id = ?"
  ).run(vc.id, vc.name, now, orderId);

  const items = db
    .prepare(
      `SELECT id, service_id, qty, is_manual, coefficient_extra_kopecks, discount_percent
       FROM order_items WHERE order_id = ?`
    )
    .all(orderId) as {
    id: string;
    service_id: string;
    qty: number;
    is_manual: number;
    coefficient_extra_kopecks: number;
    discount_percent: number;
  }[];

  for (const item of items) {
    if (item.is_manual || !item.service_id) continue;
    const price = resolveServicePrice(item.service_id, vc.id);
    if (price === null) {
      db.prepare("DELETE FROM order_items WHERE id = ?").run(item.id);
    } else {
      const extra = Math.max(0, item.coefficient_extra_kopecks ?? 0);
      const discountPercent = clampDiscountPercent(item.discount_percent);
      const finalPrice = linePriceKopecks(price, extra, discountPercent);
      db.prepare(
        `UPDATE order_items SET base_price_kopecks = ?, price_kopecks = ?, coefficient_extra_kopecks = ?,
         discount_percent = ? WHERE id = ?`
      ).run(price, finalPrice, extra, discountPercent, item.id);
    }
  }

  recalc(orderId);
  return getOrder(orderId)!;
}

export function setOrderTips(orderId: string, tipsKopecks: number) {
  const order = getOrder(orderId);
  if (!order) throw new Error("Заказ не найден");
  if (order.status === "paid" || order.status === "cancelled") {
    throw new Error("Нельзя менять чаевые у закрытого заказа");
  }
  const tips = Math.max(0, Math.round(Number(tipsKopecks) || 0));
  db.prepare("UPDATE orders SET tips_kopecks = ?, updated_at = ? WHERE id = ?").run(
    tips,
    new Date().toISOString(),
    orderId
  );
  return getOrder(orderId)!;
}

export function markAwaitingPayment(orderId: string) {
  const order = getOrder(orderId);
  if (!order || order.status !== "draft") throw new Error("Неверный статус");
  if (!order.items?.length) throw new Error("Пустой заказ");
  if (!order.staffWasherIds?.length) throw new Error("Выберите мойщика");
  db.prepare("UPDATE orders SET status = 'awaiting_payment', updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    orderId
  );
  return getOrder(orderId)!;
}

export function markPaid(orderId: string, method: PaymentMethod) {
  const current = getOrder(orderId);
  if (current && !current.staffWasherIds?.length && current.status !== "paid") {
    throw new Error("Выберите мойщика");
  }
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
  try {
    const booking = linkPaidOrderToCalendar(order);
    if (booking) enqueueOutbox("booking.upsert", booking);
  } catch (e) {
    console.warn(
      "[calendar] не удалось внести заказ в календарь:",
      e instanceof Error ? e.message : e
    );
  }
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
    .prepare(`SELECT * FROM orders WHERE status = 'paid' AND paid_at >= ? AND paid_at < ?`)
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

/** Аналитика по мойщикам-персоналу: выручка и чаевые делятся поровну между участниками заказа. */
export function analyticsByWasher(fromIso: string, toIso: string) {
  const orders = db
    .prepare(
      `SELECT id, total_kopecks, COALESCE(tips_kopecks, 0) as tips_kopecks FROM orders
       WHERE status = 'paid' AND paid_at >= ? AND paid_at < ?`
    )
    .all(fromIso, toIso) as { id: string; total_kopecks: number; tips_kopecks: number }[];

  type Acc = {
    id: string;
    name: string;
    salaryPercent: number;
    orderCount: number;
    revenueKopecks: number;
    tipsKopecks: number;
    salaryKopecks: number;
  };
  const byStaff = new Map<string, Acc>();

  for (const o of orders) {
    const staff = db
      .prepare(
        `SELECT sw.id, sw.name, sw.salary_percent
         FROM order_staff_washers osw
         JOIN staff_washers sw ON sw.id = osw.staff_washer_id
         WHERE osw.order_id = ?`
      )
      .all(o.id) as { id: string; name: string; salary_percent: number }[];
    if (!staff.length) continue;
    const n = staff.length;
    const share = Math.round(o.total_kopecks / n);
    const tipShare = Math.round((o.tips_kopecks || 0) / n);
    for (const s of staff) {
      const acc = byStaff.get(s.id) ?? {
        id: s.id,
        name: s.name,
        salaryPercent: s.salary_percent,
        orderCount: 0,
        revenueKopecks: 0,
        tipsKopecks: 0,
        salaryKopecks: 0,
      };
      acc.orderCount += 1;
      acc.revenueKopecks += share;
      acc.tipsKopecks += tipShare;
      acc.salaryKopecks += Math.round((share * s.salary_percent) / 100);
      acc.salaryPercent = s.salary_percent;
      byStaff.set(s.id, acc);
    }
  }

  const rows = [...byStaff.values()].sort((a, b) => b.revenueKopecks - a.revenueKopecks);
  return {
    from: fromIso,
    to: toIso,
    washers: rows,
  };
}
