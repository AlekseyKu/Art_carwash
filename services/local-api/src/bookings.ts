import { formatHm, resolveDayWindow } from "@art/shared";
import { nanoid } from "nanoid";
import {
  defaultDurationMinutesForTabId,
  getCatalogTabBySlug,
  resolveServiceDurationMinutes,
  TAB_SLUG_EXTRA_SERVICES,
  TAB_SLUG_SERVICES,
  db,
} from "./db.js";
import { getSiteSchedule } from "./siteSchedule.js";
import {
  addMinutesIso,
  formatMskTime,
  isOccupyingStatus,
  LINE_POST_ID,
  mskDateString,
  mskParts,
  mskWallToUtcIso,
  rangesOverlap,
  roundDownToSlotIso,
  SLOT_STEP_MINUTES,
} from "./time.js";

export type BookingPayload = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  vehicleId: string | null;
  plateNumber: string | null;
  classId: string | null;
  postId: number;
  startsAt: string;
  endsAt: string;
  status: string;
  source: string;
  totalKopecks: number;
  localOrderId: string | null;
  createdAt: string;
  updatedAt: string;
  items: {
    id: string;
    serviceId: string;
    serviceName: string;
    kind: string;
    priceKopecks: number;
    durationMinutes: number;
    sortOrder: number;
  }[];
};

export function initLocalBookingSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      vehicle_id TEXT,
      plate_number TEXT,
      class_id TEXT,
      post_id INTEGER NOT NULL DEFAULT 1,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      total_kopecks INTEGER NOT NULL DEFAULT 0,
      local_order_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_starts ON bookings(starts_at);

    CREATE TABLE IF NOT EXISTS booking_items (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      service_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      price_kopecks INTEGER NOT NULL DEFAULT 0,
      duration_minutes INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_booking_items_booking ON booking_items(booking_id);
  `);
}

type BookingRow = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  vehicle_id: string | null;
  plate_number: string | null;
  class_id: string | null;
  post_id: number;
  starts_at: string;
  ends_at: string;
  status: string;
  source: string;
  total_kopecks: number;
  local_order_id: string | null;
  created_at: string;
  updated_at: string;
};

function listItems(bookingId: string) {
  return db
    .prepare(`SELECT * FROM booking_items WHERE booking_id = ? ORDER BY sort_order, kind`)
    .all(bookingId) as {
    id: string;
    booking_id: string;
    service_id: string;
    service_name: string;
    kind: string;
    price_kopecks: number;
    duration_minutes: number;
    sort_order: number;
  }[];
}

export function bookingRowToPayload(row: BookingRow): BookingPayload {
  const items = listItems(row.id);
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    vehicleId: row.vehicle_id,
    plateNumber: row.plate_number,
    classId: row.class_id,
    postId: row.post_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    source: row.source,
    totalKopecks: row.total_kopecks,
    localOrderId: row.local_order_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map((i) => ({
      id: i.id,
      serviceId: i.service_id,
      serviceName: i.service_name,
      kind: i.kind,
      priceKopecks: i.price_kopecks,
      durationMinutes: i.duration_minutes,
      sortOrder: i.sort_order,
    })),
  };
}

export function upsertLocalBooking(payload: BookingPayload | Record<string, unknown>) {
  const p = payload as BookingPayload;
  const id = String(p.id ?? "");
  if (!id) return;
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT id FROM bookings WHERE id = ?").get(id) as
    | { id: string }
    | undefined;

  const startsAt = String(p.startsAt ?? "");
  const endsAt = String(p.endsAt ?? "");
  const status = String(p.status ?? "booked");
  const source = String(p.source ?? "pwa");
  const postId = Number(p.postId ?? LINE_POST_ID) || LINE_POST_ID;
  const totalKopecks = Number(p.totalKopecks ?? 0) || 0;

  if (existing) {
    db.prepare(
      `UPDATE bookings SET
        customer_id = ?, customer_name = ?, customer_phone = ?,
        vehicle_id = ?, plate_number = ?, class_id = ?,
        post_id = ?, starts_at = ?, ends_at = ?, status = ?, source = ?,
        total_kopecks = ?, local_order_id = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      p.customerId ?? null,
      p.customerName ?? null,
      p.customerPhone ?? null,
      p.vehicleId ?? null,
      p.plateNumber ?? null,
      p.classId ?? null,
      postId,
      startsAt,
      endsAt,
      status,
      source,
      totalKopecks,
      p.localOrderId ?? null,
      now,
      id
    );
  } else {
    db.prepare(
      `INSERT INTO bookings (
        id, customer_id, customer_name, customer_phone, vehicle_id, plate_number, class_id,
        post_id, starts_at, ends_at, status, source, total_kopecks, local_order_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      p.customerId ?? null,
      p.customerName ?? null,
      p.customerPhone ?? null,
      p.vehicleId ?? null,
      p.plateNumber ?? null,
      p.classId ?? null,
      postId,
      startsAt,
      endsAt,
      status,
      source,
      totalKopecks,
      p.localOrderId ?? null,
      p.createdAt ?? now,
      now
    );
  }

  db.prepare("DELETE FROM booking_items WHERE booking_id = ?").run(id);
  const insertItem = db.prepare(
    `INSERT INTO booking_items (
      id, booking_id, service_id, service_name, kind, price_kopecks, duration_minutes, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  (p.items ?? []).forEach((it, idx) => {
    insertItem.run(
      it.id || nanoid(),
      id,
      it.serviceId,
      it.serviceName,
      it.kind,
      it.priceKopecks ?? 0,
      it.durationMinutes ?? 0,
      it.sortOrder ?? idx
    );
  });
}

export function listBookingsForDate(date: string): BookingPayload[] {
  const dayStart = new Date(`${date}T00:00:00+03:00`).toISOString();
  const dayEnd = new Date(`${date}T23:59:59+03:00`).toISOString();
  const rows = db
    .prepare(
      `SELECT * FROM bookings
       WHERE starts_at >= ? AND starts_at <= ?
       ORDER BY starts_at ASC`
    )
    .all(dayStart, dayEnd) as BookingRow[];
  return rows.map(bookingRowToPayload);
}

/** Ближайшая активная запись из PWA + метка свежести для индикатора на кассе. */
export function getPwaBookingSummary() {
  const nowIso = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT * FROM bookings
       WHERE source = 'pwa'
         AND status IN ('booked', 'arrived')
         AND ends_at > ?
       ORDER BY starts_at ASC`
    )
    .all(nowIso) as BookingRow[];

  const latest = db
    .prepare(
      `SELECT MAX(created_at) as m FROM bookings
       WHERE source = 'pwa' AND status IN ('booked', 'arrived')`
    )
    .get() as { m: string | null };

  return {
    next: rows[0] ? bookingRowToPayload(rows[0]) : null,
    upcomingCount: rows.length,
    latestCreatedAt: latest?.m ?? null,
  };
}

export function getBooking(id: string): BookingPayload | null {
  const row = db.prepare("SELECT * FROM bookings WHERE id = ?").get(id) as BookingRow | undefined;
  return row ? bookingRowToPayload(row) : null;
}

function assertSlotFree(startsAt: string, endsAt: string, excludeId?: string) {
  const rows = db.prepare(`SELECT id, starts_at, ends_at, status FROM bookings`).all() as {
    id: string;
    starts_at: string;
    ends_at: string;
    status: string;
  }[];
  const clash = rows.some(
    (r) =>
      r.id !== excludeId &&
      isOccupyingStatus(r.status) &&
      rangesOverlap(startsAt, endsAt, r.starts_at, r.ends_at)
  );
  if (clash) throw Object.assign(new Error("Слот уже занят"), { statusCode: 409 });
}

export function createKassaBooking(input: {
  startsAt: string;
  durationMinutes: number;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  plateNumber?: string | null;
  classId?: string | null;
  localOrderId?: string | null;
  status?: string;
  /** Walk-in с кассы: не блокировать оплату из‑за пересечения слота */
  skipSlotCheck?: boolean;
  items: {
    serviceId: string;
    serviceName: string;
    kind: "main" | "addon";
    priceKopecks: number;
    durationMinutes: number;
  }[];
}): BookingPayload {
  const startsAt = input.startsAt;
  const duration =
    input.durationMinutes ||
    input.items.reduce((s, i) => s + (i.durationMinutes || 0), 0) ||
    60;
  const endsAt = addMinutesIso(startsAt, duration);
  if (!input.skipSlotCheck) {
    const date = mskParts(new Date(startsAt)).date;
    const window = resolveDayWindow(date, getSiteSchedule());
    if (!window) {
      throw Object.assign(new Error("В этот день мойка не работает"), { statusCode: 400 });
    }
    const dayOpen = mskWallToUtcIso(date, window.openHour, window.openMinute);
    const dayClose = mskWallToUtcIso(date, window.closeHour, window.closeMinute);
    if (startsAt < dayOpen || endsAt > dayClose) {
      throw Object.assign(
        new Error(
          `Время вне рабочих часов ${formatHm(window.openHour, window.openMinute)}–${formatHm(window.closeHour, window.closeMinute)}`
        ),
        { statusCode: 400 }
      );
    }
    assertSlotFree(startsAt, endsAt);
  }

  const now = new Date().toISOString();
  const id = nanoid();
  const totalKopecks = input.items.reduce((s, i) => s + (i.priceKopecks || 0), 0);
  const payload: BookingPayload = {
    id,
    customerId: input.customerId ?? null,
    customerName: input.customerName ?? null,
    customerPhone: input.customerPhone ?? null,
    vehicleId: null,
    plateNumber: input.plateNumber ?? null,
    classId: input.classId ?? null,
    postId: LINE_POST_ID,
    startsAt,
    endsAt,
    status: input.status ?? "booked",
    source: "kassa",
    totalKopecks,
    localOrderId: input.localOrderId ?? null,
    createdAt: now,
    updatedAt: now,
    items: input.items.map((it, idx) => ({
      id: nanoid(),
      serviceId: it.serviceId,
      serviceName: it.serviceName,
      kind: it.kind,
      priceKopecks: it.priceKopecks,
      durationMinutes: it.durationMinutes,
      sortOrder: idx,
    })),
  };
  upsertLocalBooking(payload);
  return payload;
}

export function findBookingByLocalOrderId(orderId: string): BookingPayload | null {
  const row = db
    .prepare("SELECT * FROM bookings WHERE local_order_id = ? ORDER BY updated_at DESC LIMIT 1")
    .get(orderId) as BookingRow | undefined;
  return row ? bookingRowToPayload(row) : null;
}

export function markBookingCompleted(id: string): BookingPayload {
  const row = db.prepare("SELECT * FROM bookings WHERE id = ?").get(id) as BookingRow | undefined;
  if (!row) throw Object.assign(new Error("Запись не найдена"), { statusCode: 404 });
  const now = new Date().toISOString();
  db.prepare(`UPDATE bookings SET status = 'completed', updated_at = ? WHERE id = ?`).run(
    now,
    id
  );
  return bookingRowToPayload({ ...row, status: "completed", updated_at: now });
}

type PaidOrderForCalendar = {
  id: string;
  number: number;
  clientId: string | null;
  vehicleClassId: string | null;
  totalKopecks: number;
  createdAt: string;
  paidAt: string | null;
  items: {
    serviceId: string | null;
    nameSnapshot: string;
    priceKopecks: number;
    qty: number;
  }[];
};

/** После оплаты: связать заказ с календарём (walk-in или завершить бронь «Прибыл»). */
export function linkPaidOrderToCalendar(order: PaidOrderForCalendar): BookingPayload | null {
  const existing = findBookingByLocalOrderId(order.id);
  if (existing) {
    if (existing.status === "completed") return existing;
    return markBookingCompleted(existing.id);
  }

  const servicesTabId = getCatalogTabBySlug(TAB_SLUG_SERVICES)?.id;
  const extrasTabId = getCatalogTabBySlug(TAB_SLUG_EXTRA_SERVICES)?.id;

  const bookingItems: {
    serviceId: string;
    serviceName: string;
    kind: "main" | "addon";
    priceKopecks: number;
    durationMinutes: number;
  }[] = [];

  for (const it of order.items) {
    const qty = Math.max(1, it.qty || 1);
    let kind: "main" | "addon" = "addon";
    let durationMinutes = 0;
    let serviceId = it.serviceId ?? "";

    if (it.serviceId) {
      const svc = db
        .prepare("SELECT id, tab_id, duration_minutes FROM services WHERE id = ?")
        .get(it.serviceId) as
        | { id: string; tab_id: string | null; duration_minutes: number | null }
        | undefined;
      if (svc) {
        durationMinutes = resolveServiceDurationMinutes(svc.duration_minutes, svc.tab_id);
        if (servicesTabId && svc.tab_id === servicesTabId) kind = "main";
        else if (extrasTabId && svc.tab_id === extrasTabId) kind = "addon";
        else {
          // товары — в календарь без длительности
          durationMinutes = 0;
          kind = "addon";
        }
      } else {
        durationMinutes = 15;
      }
    } else {
      serviceId = `manual:${nanoid(8)}`;
      durationMinutes = 0;
    }

    bookingItems.push({
      serviceId,
      serviceName: it.nameSnapshot,
      kind,
      priceKopecks: it.priceKopecks * qty,
      durationMinutes: durationMinutes * qty,
    });
  }

  if (!bookingItems.some((i) => i.kind === "main")) {
    const first = bookingItems[0];
    if (first) first.kind = "main";
    else {
      bookingItems.push({
        serviceId: `order:${order.id}`,
        serviceName: `Заказ #${order.number}`,
        kind: "main",
        priceKopecks: order.totalKopecks,
        durationMinutes: defaultDurationMinutesForTabId(servicesTabId),
      });
    }
  }

  let clientName: string | null = null;
  let clientPhone: string | null = null;
  let plateNumber: string | null = null;
  if (order.clientId) {
    const c = db
      .prepare("SELECT name, phone, plate_number FROM clients WHERE id = ?")
      .get(order.clientId) as
      | { name: string | null; phone: string | null; plate_number: string | null }
      | undefined;
    if (c) {
      clientName = c.name;
      clientPhone = c.phone;
      plateNumber = c.plate_number;
    }
  }

  const startsAt = roundDownToSlotIso(order.paidAt || order.createdAt || new Date().toISOString());
  const durationMinutes =
    bookingItems.reduce((s, i) => s + (i.durationMinutes || 0), 0) ||
    defaultDurationMinutesForTabId(servicesTabId);
  const endsAt = addMinutesIso(startsAt, durationMinutes);
  const status = new Date(endsAt).getTime() > Date.now() ? "in_service" : "completed";

  return createKassaBooking({
    startsAt,
    durationMinutes,
    customerId: order.clientId,
    customerName: clientName,
    customerPhone: clientPhone,
    plateNumber,
    classId: order.vehicleClassId,
    localOrderId: order.id,
    status,
    skipSlotCheck: true,
    items: bookingItems,
  });
}

export function cancelLocalBooking(id: string): BookingPayload {
  const row = db.prepare("SELECT * FROM bookings WHERE id = ?").get(id) as BookingRow | undefined;
  if (!row) throw Object.assign(new Error("Запись не найдена"), { statusCode: 404 });
  const now = new Date().toISOString();
  db.prepare(`UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(
    now,
    id
  );
  return bookingRowToPayload({ ...row, status: "cancelled", updated_at: now });
}

export function markBookingArrived(id: string, localOrderId: string): BookingPayload {
  const row = db.prepare("SELECT * FROM bookings WHERE id = ?").get(id) as BookingRow | undefined;
  if (!row) throw Object.assign(new Error("Запись не найдена"), { statusCode: 404 });
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE bookings SET status = 'arrived', local_order_id = ?, updated_at = ? WHERE id = ?`
  ).run(localOrderId, now, id);
  return bookingRowToPayload({
    ...row,
    status: "arrived",
    local_order_id: localOrderId,
    updated_at: now,
  });
}

/** Сетка дня для UI кассы: слоты по SLOT_STEP_MINUTES с занятостью. */
export function dayCalendarGrid(date: string) {
  const bookings = listBookingsForDate(date).filter(
    (b) => isOccupyingStatus(b.status) || b.status === "completed"
  );
  const slots: {
    time: string;
    startsAt: string;
    booking: BookingPayload | null;
  }[] = [];

  const window = resolveDayWindow(date, getSiteSchedule());
  if (!window) {
    return {
      date,
      timezone: "Europe/Moscow",
      today: mskDateString(),
      slots,
      bookings,
      closed: true as const,
    };
  }

  const openMs = new Date(
    mskWallToUtcIso(date, window.openHour, window.openMinute)
  ).getTime();
  const closeMs = new Date(
    mskWallToUtcIso(date, window.closeHour, window.closeMinute)
  ).getTime();
  const stepMs = SLOT_STEP_MINUTES * 60_000;
  const lastMs = closeMs - stepMs;
  for (let t = openMs; t <= lastMs; t += stepMs) {
    const startsAt = new Date(t).toISOString();
    const booking =
      bookings.find((b) => startsAt >= b.startsAt && startsAt < b.endsAt) ?? null;
    slots.push({
      time: formatMskTime(startsAt),
      startsAt,
      booking,
    });
  }
  return {
    date,
    timezone: "Europe/Moscow",
    today: mskDateString(),
    slots,
    bookings,
    closed: false as const,
  };
}
