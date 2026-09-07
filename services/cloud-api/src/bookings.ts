import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import type { DatabaseSync } from "node:sqlite";
import { getCatalogSnapshot, type CatalogSnapshot } from "./catalog.js";
import {
  addMinutesIso,
  candidateStarts,
  filterFreeSlots,
  formatMskTime,
  isOccupyingStatus,
  LINE_POST_ID,
  mskDateString,
  mskParts,
  rangesOverlap,
} from "./time.js";

export type BookingItemRow = {
  id: string;
  booking_id: string;
  service_id: string;
  service_name: string;
  kind: string;
  price_kopecks: number;
  duration_minutes: number;
  sort_order: number;
};

export type BookingRow = {
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

export function initBookingSchema(db: DatabaseSync) {
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
    CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

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

    CREATE TABLE IF NOT EXISTS station_outbox (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT
    );
  `);
}

function bearer(req: { headers: { authorization?: string } }) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return undefined;
  return h.slice(7);
}

function requireCustomer(
  db: DatabaseSync,
  req: { headers: { authorization?: string } }
) {
  const token = bearer(req);
  if (!token) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  const row = db
    .prepare(
      `SELECT s.customer_id, s.expires_at, c.phone, c.name
       FROM customer_sessions s
       JOIN customer_accounts c ON c.id = s.customer_id
       WHERE s.token = ?`
    )
    .get(token) as
    | { customer_id: string; expires_at: string; phone: string; name: string | null }
    | undefined;
  if (!row || row.expires_at < new Date().toISOString()) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }
  return { customerId: row.customer_id, phone: row.phone, name: row.name };
}

export function enqueueStationOutbox(db: DatabaseSync, type: string, payload: unknown) {
  db.prepare(
    "INSERT INTO station_outbox (id, type, payload, created_at, delivered_at) VALUES (?, ?, ?, ?, NULL)"
  ).run(nanoid(), type, JSON.stringify(payload), new Date().toISOString());
}

export function pullStationOutbox(db: DatabaseSync, limit = 50) {
  const rows = db
    .prepare(
      `SELECT id, type, payload, created_at FROM station_outbox
       WHERE delivered_at IS NULL ORDER BY created_at ASC LIMIT ?`
    )
    .all(limit) as { id: string; type: string; payload: string; created_at: string }[];
  const now = new Date().toISOString();
  const mark = db.prepare("UPDATE station_outbox SET delivered_at = ? WHERE id = ?");
  for (const r of rows) mark.run(now, r.id);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    payload: JSON.parse(r.payload) as unknown,
    createdAt: r.created_at,
  }));
}

function listItems(db: DatabaseSync, bookingId: string) {
  return db
    .prepare(
      `SELECT * FROM booking_items WHERE booking_id = ? ORDER BY sort_order, kind`
    )
    .all(bookingId) as BookingItemRow[];
}

export function bookingToPayload(db: DatabaseSync, row: BookingRow) {
  const items = listItems(db, row.id);
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
      kind: i.kind as "main" | "addon",
      priceKopecks: i.price_kopecks,
      durationMinutes: i.duration_minutes,
      sortOrder: i.sort_order,
    })),
  };
}

export function upsertBookingFromPayload(db: DatabaseSync, payload: Record<string, unknown>) {
  const id = String(payload.id ?? "");
  if (!id) return;
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT id FROM bookings WHERE id = ?").get(id) as
    | { id: string }
    | undefined;
  const startsAt = String(payload.startsAt ?? "");
  const endsAt = String(payload.endsAt ?? "");
  const status = String(payload.status ?? "booked");
  const source = String(payload.source ?? "pwa");
  const postId = Number(payload.postId ?? LINE_POST_ID) || LINE_POST_ID;
  const totalKopecks = Number(payload.totalKopecks ?? 0) || 0;

  if (existing) {
    db.prepare(
      `UPDATE bookings SET
        customer_id = ?, customer_name = ?, customer_phone = ?,
        vehicle_id = ?, plate_number = ?, class_id = ?,
        post_id = ?, starts_at = ?, ends_at = ?, status = ?, source = ?,
        total_kopecks = ?, local_order_id = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      (payload.customerId as string | null) ?? null,
      (payload.customerName as string | null) ?? null,
      (payload.customerPhone as string | null) ?? null,
      (payload.vehicleId as string | null) ?? null,
      (payload.plateNumber as string | null) ?? null,
      (payload.classId as string | null) ?? null,
      postId,
      startsAt,
      endsAt,
      status,
      source,
      totalKopecks,
      (payload.localOrderId as string | null) ?? null,
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
      (payload.customerId as string | null) ?? null,
      (payload.customerName as string | null) ?? null,
      (payload.customerPhone as string | null) ?? null,
      (payload.vehicleId as string | null) ?? null,
      (payload.plateNumber as string | null) ?? null,
      (payload.classId as string | null) ?? null,
      postId,
      startsAt,
      endsAt,
      status,
      source,
      totalKopecks,
      (payload.localOrderId as string | null) ?? null,
      String(payload.createdAt ?? now),
      now
    );
  }

  db.prepare("DELETE FROM booking_items WHERE booking_id = ?").run(id);
  const items = (payload.items as
    | {
        id?: string;
        serviceId: string;
        serviceName: string;
        kind: string;
        priceKopecks?: number;
        durationMinutes?: number;
        sortOrder?: number;
      }[]
    | undefined) ?? [];
  const insertItem = db.prepare(
    `INSERT INTO booking_items (
      id, booking_id, service_id, service_name, kind, price_kopecks, duration_minutes, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  items.forEach((it, idx) => {
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

function busyForDay(db: DatabaseSync, date: string, excludeId?: string) {
  const dayStart = `${date}T00:00:00+03:00`;
  const dayEnd = `${date}T23:59:59+03:00`;
  const startIso = new Date(dayStart).toISOString();
  const endIso = new Date(dayEnd).toISOString();
  const rows = db
    .prepare(
      `SELECT id, starts_at, ends_at, status FROM bookings
       WHERE starts_at < ? AND ends_at > ?`
    )
    .all(endIso, startIso) as {
    id: string;
    starts_at: string;
    ends_at: string;
    status: string;
  }[];
  return rows
    .filter((r) => isOccupyingStatus(r.status) && r.id !== excludeId)
    .map((r) => ({ startsAt: r.starts_at, endsAt: r.ends_at }));
}

function resolveServices(
  catalog: CatalogSnapshot,
  mainServiceId: string,
  addonIds: string[],
  classId: string
) {
  const byId = new Map(catalog.services.map((s) => [s.id, s]));
  const main = byId.get(mainServiceId);
  if (!main || !main.active) {
    throw Object.assign(new Error("Основная услуга не найдена"), { statusCode: 400 });
  }
  const tab = catalog.tabs.find((t) => t.id === main.tabId);
  if (tab && tab.slug === "extra-services") {
    throw Object.assign(new Error("Выберите основную услугу, не доп."), { statusCode: 400 });
  }
  const priceOf = (serviceId: string) => {
    const row = catalog.servicePrices.find(
      (p) => p.serviceId === serviceId && p.classId === classId
    );
    if (row) return row.priceKopecks;
    const svc = byId.get(serviceId);
    return svc?.priceKopecks ?? 0;
  };
  const durationOf = (serviceId: string) => {
    const svc = byId.get(serviceId);
    if (svc?.durationMinutes != null && svc.durationMinutes > 0) return svc.durationMinutes;
    const t = catalog.tabs.find((x) => x.id === svc?.tabId);
    return t?.slug === "extra-services" ? 15 : catalog.bookingRules.defaultDurationMinutes;
  };

  const items: {
    serviceId: string;
    serviceName: string;
    kind: "main" | "addon";
    priceKopecks: number;
    durationMinutes: number;
    sortOrder: number;
  }[] = [
    {
      serviceId: main.id,
      serviceName: main.name,
      kind: "main",
      priceKopecks: priceOf(main.id),
      durationMinutes: durationOf(main.id),
      sortOrder: 0,
    },
  ];

  const uniqueAddons = [...new Set(addonIds.filter((id) => id && id !== mainServiceId))];
  uniqueAddons.forEach((id, idx) => {
    const svc = byId.get(id);
    if (!svc || !svc.active) {
      throw Object.assign(new Error(`Доп.услуга не найдена: ${id}`), { statusCode: 400 });
    }
    items.push({
      serviceId: svc.id,
      serviceName: svc.name,
      kind: "addon",
      priceKopecks: priceOf(svc.id),
      durationMinutes: durationOf(svc.id),
      sortOrder: idx + 1,
    });
  });

  const durationMinutes = items.reduce((s, i) => s + i.durationMinutes, 0);
  const totalKopecks = items.reduce((s, i) => s + i.priceKopecks, 0);
  return { items, durationMinutes, totalKopecks };
}

function assertSlotFree(
  db: DatabaseSync,
  startsAt: string,
  endsAt: string,
  excludeId?: string
) {
  const rows = db
    .prepare(`SELECT id, starts_at, ends_at, status FROM bookings`)
    .all() as { id: string; starts_at: string; ends_at: string; status: string }[];
  const clash = rows.some(
    (r) =>
      r.id !== excludeId &&
      isOccupyingStatus(r.status) &&
      rangesOverlap(startsAt, endsAt, r.starts_at, r.ends_at)
  );
  if (clash) {
    throw Object.assign(new Error("Слот уже занят"), { statusCode: 409 });
  }
}

export function registerBookingRoutes(app: FastifyInstance, db: DatabaseSync) {
  app.get<{
    Querystring: {
      date?: string;
      mainServiceId?: string;
      addonIds?: string;
      durationMinutes?: string;
    };
  }>("/api/customer/slots", async (req, reply) => {
    requireCustomer(db, req);
    const date = (req.query.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.code(400).send({ error: "Укажите date=YYYY-MM-DD" });
    }

    const catalog = getCatalogSnapshot(db);
    const rules = catalog.bookingRules;
    const today = mskDateString();
    const horizonEnd = new Date(`${today}T12:00:00+03:00`);
    horizonEnd.setUTCDate(horizonEnd.getUTCDate() + rules.horizonDays);

    if (date < today) {
      return { date, durationMinutes: 0, slots: [] as { startsAt: string; time: string }[] };
    }
    const dateNoon = new Date(`${date}T12:00:00+03:00`);
    if (dateNoon > horizonEnd) {
      return reply.code(400).send({ error: `Запись доступна на ${rules.horizonDays} дней вперёд` });
    }

    let durationMinutes = Number(req.query.durationMinutes ?? 0);
    const mainServiceId = (req.query.mainServiceId ?? "").trim();
    const addonIds = (req.query.addonIds ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (mainServiceId) {
      // classId нужен для цены, для длительности — нет; берём default class из каталога
      const classId = catalog.vehicleClasses.find((c) => c.active)?.id ?? "";
      const resolved = resolveServices(catalog, mainServiceId, addonIds, classId);
      durationMinutes = resolved.durationMinutes;
    }
    if (!durationMinutes || durationMinutes <= 0) {
      durationMinutes = rules.defaultDurationMinutes;
    }

    const now = new Date();
    const notBefore = new Date(now.getTime() + rules.minLeadHours * 3600_000).toISOString();
    const busy = busyForDay(db, date);
    const starts = candidateStarts(date, durationMinutes);
    const free = filterFreeSlots(starts, durationMinutes, busy, notBefore);

    return {
      date,
      durationMinutes,
      timezone: "Europe/Moscow",
      slots: free.map((s) => ({
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        time: formatMskTime(s.startsAt),
      })),
    };
  });

  app.get("/api/customer/bookings", async (req) => {
    const c = requireCustomer(db, req);
    const rows = db
      .prepare(
        `SELECT * FROM bookings WHERE customer_id = ?
         ORDER BY starts_at DESC LIMIT 50`
      )
      .all(c.customerId) as BookingRow[];
    return { bookings: rows.map((r) => bookingToPayload(db, r)) };
  });

  app.post<{
    Body: {
      vehicleId?: string;
      mainServiceId?: string;
      addonIds?: string[];
      startsAt?: string;
    };
  }>("/api/customer/bookings", async (req, reply) => {
    const c = requireCustomer(db, req);
    const vehicleId = (req.body.vehicleId ?? "").trim();
    const mainServiceId = (req.body.mainServiceId ?? "").trim();
    const startsAt = (req.body.startsAt ?? "").trim();
    const addonIds = Array.isArray(req.body.addonIds) ? req.body.addonIds : [];

    if (!vehicleId || !mainServiceId || !startsAt) {
      return reply.code(400).send({ error: "Нужны vehicleId, mainServiceId, startsAt" });
    }

    const vehicle = db
      .prepare("SELECT * FROM vehicles WHERE id = ? AND customer_id = ?")
      .get(vehicleId, c.customerId) as
      | {
          id: string;
          plate_number: string;
          class_id: string;
        }
      | undefined;
    if (!vehicle) {
      return reply.code(400).send({ error: "Автомобиль не найден" });
    }

    const catalog = getCatalogSnapshot(db);
    const rules = catalog.bookingRules;
    const { items, durationMinutes, totalKopecks } = resolveServices(
      catalog,
      mainServiceId,
      addonIds,
      vehicle.class_id
    );
    const endsAt = addMinutesIso(startsAt, durationMinutes);

    const now = new Date();
    const minStart = new Date(now.getTime() + rules.minLeadHours * 3600_000).toISOString();
    if (startsAt < minStart) {
      return reply.code(400).send({ error: `Запись не раньше чем за ${rules.minLeadHours} ч` });
    }

    const date = mskParts(new Date(startsAt)).date;
    const today = mskDateString();
    if (date < today) {
      return reply.code(400).send({ error: "Нельзя записаться на прошедшую дату" });
    }

    const dayClose = new Date(`${date}T${String(21).padStart(2, "0")}:00:00+03:00`).toISOString();
    const dayOpen = new Date(`${date}T09:00:00+03:00`).toISOString();
    if (startsAt < dayOpen || endsAt > dayClose) {
      return reply.code(400).send({ error: "Время вне рабочих часов 09:00–21:00" });
    }

    try {
      assertSlotFree(db, startsAt, endsAt);
    } catch (e) {
      const err = e as { statusCode?: number; message?: string };
      return reply.code(err.statusCode ?? 400).send({ error: err.message ?? "Слот занят" });
    }

    const id = nanoid();
    const createdAt = now.toISOString();
    const row: BookingRow = {
      id,
      customer_id: c.customerId,
      customer_name: c.name,
      customer_phone: c.phone,
      vehicle_id: vehicle.id,
      plate_number: vehicle.plate_number,
      class_id: vehicle.class_id,
      post_id: LINE_POST_ID,
      starts_at: startsAt,
      ends_at: endsAt,
      status: "booked",
      source: "pwa",
      total_kopecks: totalKopecks,
      local_order_id: null,
      created_at: createdAt,
      updated_at: createdAt,
    };

    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO bookings (
          id, customer_id, customer_name, customer_phone, vehicle_id, plate_number, class_id,
          post_id, starts_at, ends_at, status, source, total_kopecks, local_order_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        row.id,
        row.customer_id,
        row.customer_name,
        row.customer_phone,
        row.vehicle_id,
        row.plate_number,
        row.class_id,
        row.post_id,
        row.starts_at,
        row.ends_at,
        row.status,
        row.source,
        row.total_kopecks,
        row.local_order_id,
        row.created_at,
        row.updated_at
      );
      const insertItem = db.prepare(
        `INSERT INTO booking_items (
          id, booking_id, service_id, service_name, kind, price_kopecks, duration_minutes, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const it of items) {
        insertItem.run(
          nanoid(),
          id,
          it.serviceId,
          it.serviceName,
          it.kind,
          it.priceKopecks,
          it.durationMinutes,
          it.sortOrder
        );
      }
      const payload = bookingToPayload(db, row);
      enqueueStationOutbox(db, "booking.upsert", payload);
      db.exec("COMMIT");
      return payload;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });

  app.post<{ Params: { id: string } }>("/api/customer/bookings/:id/cancel", async (req, reply) => {
    const c = requireCustomer(db, req);
    const row = db
      .prepare("SELECT * FROM bookings WHERE id = ? AND customer_id = ?")
      .get(req.params.id, c.customerId) as BookingRow | undefined;
    if (!row) return reply.code(404).send({ error: "Запись не найдена" });
    if (row.status === "cancelled") return bookingToPayload(db, row);
    if (row.status !== "booked") {
      return reply.code(400).send({ error: "Эту запись уже нельзя отменить" });
    }

    const catalog = getCatalogSnapshot(db);
    const cancelBefore = catalog.bookingRules.cancelBeforeHours;
    const limit = new Date(Date.now() + cancelBefore * 3600_000).toISOString();
    if (row.starts_at < limit) {
      return reply
        .code(400)
        .send({ error: `Отмена возможна не позже чем за ${cancelBefore} ч до слота` });
    }

    const now = new Date().toISOString();
    db.prepare(`UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(
      now,
      row.id
    );
    const updated = { ...row, status: "cancelled", updated_at: now };
    const payload = bookingToPayload(db, updated);
    enqueueStationOutbox(db, "booking.upsert", payload);
    return payload;
  });
}
