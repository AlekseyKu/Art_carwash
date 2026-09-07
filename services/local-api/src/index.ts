import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { calcDiscountKopecks } from "@art/shared";
import bcrypt from "bcryptjs";
import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  attachClientToOrder,
  deleteClient,
  ensureClientTables,
  findClientByPlate,
  latestAnprEvent,
  listClients,
  recordAnprEvent,
  searchClients,
  seedDemoClient,
  upsertClient,
} from "./clients.js";
import {
  changeMasterCode,
  deleteSession,
  getSession,
  loginAdmin,
  loginWasher,
} from "./auth.js";
import {
  db,
  defaultDurationMinutesForTabId,
  getCatalogTabBySlug,
  getDefaultVehicleClass,
  getSetting,
  isClassPricedTabId,
  listVehicleClasses,
  migrate,
  resolveServiceDurationMinutes,
  resolveServicePrice,
  seedIfEmpty,
  setSetting,
  TAB_SLUG_EXTRA_SERVICES,
  TAB_SLUG_SERVICES,
  type VehicleClassRow,
} from "./db.js";
import {
  analytics,
  analyticsByWasher,
  cancelOrder,
  getOrCreateDraft,
  getOrder,
  listRecentOrders,
  markAwaitingPayment,
  markPaid,
  setOrderItems,
  setOrderVehicleClass,
} from "./orders.js";
import { isOnline, providers } from "./payments.js";
import {
  cancelLocalBooking,
  createKassaBooking,
  dayCalendarGrid,
  getBooking,
  initLocalBookingSchema,
  markBookingArrived,
} from "./bookings.js";
import { enqueueCatalogSnapshot } from "./catalogSnapshot.js";
import { enqueueOutbox, flushOutbox, startSyncLoop } from "./sync.js";
import { mskDateString } from "./time.js";

function afterCatalogChange() {
  enqueueCatalogSnapshot();
}
import {
  buildShiftReport,
  closeShift,
  getOpenShift,
  getShift,
  getShiftStatus,
  listShifts,
  openShift,
  rolloverShift,
} from "./shifts.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
  try {
    const text = typeof body === "string" ? body : "";
    done(null, text ? JSON.parse(text) : {});
  } catch (err) {
    done(err as Error, undefined);
  }
});

migrate();
seedIfEmpty();
ensureClientTables();
seedDemoClient();
initLocalBookingSchema();

// Старые сессии с лимитом 12ч — бессрочные (выход только вручную)
db.prepare(
  "UPDATE sessions SET expires_at = '9999-12-31T23:59:59.000Z' WHERE expires_at < '9999-01-01'"
).run();

function bearer(req: { headers: { authorization?: string } }) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return undefined;
  return h.slice(7);
}

function requireWasher(req: { headers: { authorization?: string } }) {
  const s = getSession(bearer(req));
  if (!s || s.kind !== "washer" || !s.washer_id) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  return s;
}

function requireAdmin(req: { headers: { authorization?: string } }) {
  const s = getSession(bearer(req));
  if (!s || s.kind !== "admin") throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  return s;
}

app.setErrorHandler((err, _req, reply) => {
  const e = err as Error & { statusCode?: number };
  const status = e.statusCode ?? 400;
  reply.code(status).send({ error: e.message });
});

app.get("/api/health", async () => ({ ok: true, brand: "Автомойка АРТ" }));

app.get("/api/status", async () => {
  const online = await isOnline();
  const pending = db.prepare("SELECT COUNT(*) as c FROM outbox WHERE synced_at IS NULL").get() as {
    c: number;
  };
  const desktop = Boolean(
    process.env.ART_DESKTOP_CTRL_URL?.trim() && process.env.ART_DESKTOP_CTRL_TOKEN?.trim()
  );
  return {
    online,
    pendingSync: pending.c,
    siteName: getSetting("site_name") ?? "Автомойка АРТ",
    desktop,
  };
});

app.post("/api/desktop/minimize", async () => {
  return desktopCtrl("/window/minimize", "POST");
});

app.post("/api/desktop/close", async () => {
  return desktopCtrl("/window/close", "POST");
});

app.post<{ Body: { pin: string } }>("/api/auth/washer", async (req) => {
  return loginWasher(req.body.pin);
});

app.post<{ Body: { code: string } }>("/api/auth/admin", async (req) => {
  return loginAdmin(req.body.code);
});

app.post("/api/auth/logout", async (req) => {
  const t = bearer(req);
  if (t) deleteSession(t);
  return { ok: true };
});

app.get("/api/posts", async () => {
  return db.prepare("SELECT id, name FROM posts ORDER BY id").all();
});

function mapServiceRow(s: {
  id: string;
  name: string;
  description?: string | null;
  price_kopecks: number;
  active: number;
  sort_order: number;
  tab_id: string | null;
  coefficient_enabled?: number | null;
  coefficient_step_kopecks?: number | null;
  duration_minutes?: number | null;
}) {
  return {
    id: s.id,
    name: s.name,
    description: s.description ?? "",
    priceKopecks: s.price_kopecks,
    active: !!s.active,
    sortOrder: s.sort_order,
    tabId: s.tab_id ?? "",
    coefficientEnabled: !!s.coefficient_enabled,
    coefficientStepKopecks: s.coefficient_step_kopecks ?? 5000,
    durationMinutes: resolveServiceDurationMinutes(s.duration_minutes, s.tab_id),
  };
}

function mapTabRow(t: {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
  active: number;
}) {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    sortOrder: t.sort_order,
    active: !!t.active,
  };
}

function mapVehicleClassRow(v: VehicleClassRow) {
  return {
    id: v.id,
    slug: v.slug,
    name: v.name,
    description: v.description,
    iconKey: v.icon_key,
    sortOrder: v.sort_order,
    active: !!v.active,
  };
}

function slugifyTabName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || `tab-${nanoid(6)}`;
}

function slugifyClassName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || `class-${nanoid(6)}`;
}

app.get<{ Querystring: { classId?: string } }>("/api/catalog", async (req) => {
  const vehicleClasses = listVehicleClasses(true);
  const classId = req.query.classId || getDefaultVehicleClass().id;

  const tabs = db
    .prepare(
      "SELECT * FROM catalog_tabs WHERE active = 1 ORDER BY sort_order, name"
    )
    .all() as {
    id: string;
    slug: string;
    name: string;
    sort_order: number;
    active: number;
  }[];
  const services = db
    .prepare("SELECT * FROM services WHERE active = 1 ORDER BY sort_order, name")
    .all() as {
    id: string;
    name: string;
    description?: string | null;
    price_kopecks: number;
    active: number;
    sort_order: number;
    tab_id: string | null;
  }[];

  const catalogServices = [];
  for (const s of services) {
    if (isClassPricedTabId(s.tab_id)) {
      const price = resolveServicePrice(s.id, classId);
      if (price === null) continue;
      catalogServices.push({
        ...mapServiceRow(s),
        priceKopecks: price,
      });
      continue;
    }
    // Товары и прочие вкладки — цена из services.price_kopecks
    catalogServices.push(mapServiceRow(s));
  }

  const discounts = db
    .prepare("SELECT * FROM discounts WHERE active = 1")
    .all() as {
    id: string;
    name: string;
    type: string;
    value: number;
    active: number;
  }[];
  const staffWashers = db
    .prepare(
      "SELECT id, name, salary_percent, sort_order FROM staff_washers WHERE active = 1 ORDER BY sort_order, name"
    )
    .all() as { id: string; name: string; salary_percent: number; sort_order: number }[];
  return {
    vehicleClasses: vehicleClasses.map(mapVehicleClassRow),
    tabs: tabs.map(mapTabRow),
    services: catalogServices,
    discounts: discounts.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      value: d.value,
      active: !!d.active,
    })),
    staffWashers: staffWashers.map((w) => ({
      id: w.id,
      name: w.name,
      salaryPercent: w.salary_percent,
      sortOrder: w.sort_order,
    })),
  };
});

app.get("/api/anpr/latest", async (req) => {
  requireWasher(req);
  return { event: latestAnprEvent() };
});

app.post<{
  Body: { plate: string; confidence?: number; snapshotUrl?: string; source?: string };
}>("/api/anpr/event", async (req) => {
  // Камера/мост может слать без сессии мойщика; опционально защитить токеном позже
  if (!req.body?.plate) throw new Error("plate обязателен");
  return recordAnprEvent({
    plate: req.body.plate,
    confidence: req.body.confidence,
    snapshotUrl: req.body.snapshotUrl,
    source: req.body.source ?? "camera",
  });
});

app.get<{ Querystring: { plate: string } }>("/api/clients/by-plate", async (req) => {
  requireWasher(req);
  const plate = req.query.plate;
  if (!plate) throw new Error("plate обязателен");
  return { client: findClientByPlate(plate) };
});

app.get<{ Querystring: { query?: string; limit?: string } }>("/api/clients", async (req) => {
  requireWasher(req);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
  const query = (req.query.query ?? "").trim();
  const clients = query ? searchClients(query, limit) : listClients(limit);
  return { clients };
});

app.post<{ Body: { plate?: string; phone?: string; name?: string; id?: string } }>(
  "/api/clients",
  async (req) => {
    requireWasher(req);
    return upsertClient(req.body ?? {});
  }
);

app.delete<{ Params: { id: string } }>("/api/clients/:id", async (req) => {
  requireWasher(req);
  const ok = deleteClient(req.params.id);
  if (!ok) throw Object.assign(new Error("Клиент не найден"), { statusCode: 404 });
  return { ok: true };
});

app.get<{ Querystring: { date?: string } }>("/api/bookings", async (req) => {
  requireWasher(req);
  const date = (req.query.date ?? mskDateString()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date=YYYY-MM-DD");
  return dayCalendarGrid(date);
});

app.get<{ Params: { id: string } }>("/api/bookings/:id", async (req) => {
  requireWasher(req);
  const b = getBooking(req.params.id);
  if (!b) throw Object.assign(new Error("Запись не найдена"), { statusCode: 404 });
  return b;
});

app.post<{
  Body: {
    startsAt: string;
    durationMinutes?: number;
    customerName?: string | null;
    customerPhone?: string | null;
    plateNumber?: string | null;
    classId?: string | null;
    items: {
      serviceId: string;
      serviceName: string;
      kind: "main" | "addon";
      priceKopecks: number;
      durationMinutes: number;
    }[];
  };
}>("/api/bookings", async (req) => {
  requireWasher(req);
  const body = req.body ?? ({} as typeof req.body);
  if (!body.startsAt) throw new Error("startsAt обязателен");
  const items = body.items ?? [];
  if (!items.length) throw new Error("Нужна хотя бы одна услуга");
  const booking = createKassaBooking({
    startsAt: body.startsAt,
    durationMinutes: body.durationMinutes ?? 0,
    customerName: body.customerName,
    customerPhone: body.customerPhone,
    plateNumber: body.plateNumber,
    classId: body.classId,
    items,
  });
  enqueueOutbox("booking.upsert", booking);
  return booking;
});

app.post<{ Params: { id: string } }>("/api/bookings/:id/cancel", async (req) => {
  requireWasher(req);
  const booking = cancelLocalBooking(req.params.id);
  enqueueOutbox("booking.upsert", booking);
  return booking;
});

app.post<{
  Params: { id: string };
  Body: { postId?: number };
}>("/api/bookings/:id/arrive", async (req) => {
  const s = requireWasher(req);
  const booking = getBooking(req.params.id);
  if (!booking) throw Object.assign(new Error("Запись не найдена"), { statusCode: 404 });
  if (!isOccupyingOrBooked(booking.status)) {
    throw new Error("Запись нельзя отметить прибытием");
  }
  const postId = Number(req.body?.postId ?? 1);
  if (postId !== 1 && postId !== 2) throw new Error("Неверный пост");
  const draft = getOrCreateDraft(postId, s.washer_id!);
  if (booking.classId) {
    try {
      setOrderVehicleClass(draft.id, booking.classId);
    } catch {
      /* класс мог исчезнуть */
    }
  }
  setOrderItems(
    draft.id,
    booking.items.map((it) => ({
      serviceId: it.serviceId,
      name: it.serviceName,
      priceKopecks: it.priceKopecks,
      qty: 1,
    })),
    null
  );
  const updated = markBookingArrived(booking.id, draft.id);
  enqueueOutbox("booking.status", updated);
  return { booking: updated, order: getOrder(draft.id) };
});

function isOccupyingOrBooked(status: string) {
  return status === "booked" || status === "arrived" || status === "in_service";
}

app.put<{ Params: { id: string }; Body: { clientId: string | null } }>(
  "/api/orders/:id/client",
  async (req) => {
    requireWasher(req);
    attachClientToOrder(req.params.id, req.body.clientId);
    return getOrder(req.params.id);
  }
);

app.get<{ Querystring: { postId: string } }>("/api/orders/draft", async (req) => {
  const s = requireWasher(req);
  const postId = Number(req.query.postId);
  if (postId !== 1 && postId !== 2) throw new Error("Неверный пост");
  return getOrCreateDraft(postId, s.washer_id!);
});

app.get<{ Querystring: { limit?: string } }>("/api/orders/recent", async (req) => {
  requireWasher(req);
  const limit = Number(req.query.limit ?? 5) || 5;
  return { orders: listRecentOrders(limit) };
});

app.get("/api/shifts/current", async (req) => {
  requireWasher(req);
  return getShiftStatus();
});

app.post("/api/shifts/open", async (req) => {
  const s = requireWasher(req);
  return openShift(s.washer_id!);
});

/** Закрыть вчерашнюю смену и открыть новую (первый вход на следующий день). */
app.post("/api/shifts/rollover", async (req) => {
  const s = requireWasher(req);
  return rolloverShift(s.washer_id!);
});

app.post("/api/shifts/close", async (req) => {
  const s = requireWasher(req);
  return closeShift(s.washer_id!);
});

app.get<{ Params: { id: string } }>("/api/shifts/:id/report", async (req) => {
  requireWasher(req);
  return buildShiftReport(req.params.id);
});

app.put<{
  Params: { id: string };
  Body: {
    items: {
      serviceId?: string | null;
      name?: string;
      qty: number;
      priceKopecks?: number;
      basePriceKopecks?: number;
      coefficientExtraKopecks?: number;
      isManual?: boolean;
    }[];
    discountId: string | null;
    staffWasherIds?: string[];
  };
}>("/api/orders/:id", async (req) => {
  requireWasher(req);
  return setOrderItems(
    req.params.id,
    req.body.items ?? [],
    req.body.discountId ?? null,
    req.body.staffWasherIds
  );
});

app.put<{ Params: { id: string }; Body: { classId: string } }>(
  "/api/orders/:id/vehicle-class",
  async (req) => {
    requireWasher(req);
    if (!req.body?.classId) throw new Error("classId обязателен");
    return setOrderVehicleClass(req.params.id, req.body.classId);
  }
);

app.post<{ Params: { id: string } }>("/api/orders/:id/checkout", async (req) => {
  requireWasher(req);
  return markAwaitingPayment(req.params.id);
});

app.post<{
  Params: { id: string };
  Body: { method: "cash" | "card" | "sbp"; emulateResult?: "success" | "cancel" };
}>("/api/orders/:id/pay", async (req) => {
  requireWasher(req);
  const order = getOrder(req.params.id);
  if (!order) throw new Error("Заказ не найден");
  if (order.status !== "awaiting_payment" && order.status !== "draft") {
    throw new Error("Неверный статус заказа");
  }
  if (order.status === "draft") markAwaitingPayment(order.id);

  const method = req.body.method;
  const provider = providers[method];
  if (!provider) throw new Error("Неизвестный метод");

  if (provider.requiresOnline) {
    const online = await isOnline();
    if (!online) {
      return {
        ok: false,
        blocked: true,
        error: "Нет интернета — СБП недоступен. Выберите наличные или карту.",
      };
    }
  }

  const start = await provider.start(order.totalKopecks, order.id);
  if (!start.ok) return start;

  if (start.status === "paid") {
    return { ok: true, order: markPaid(order.id, method), payment: start };
  }

  // Эмулятор: сразу успех/отмена по запросу клиента
  if (req.body.emulateResult === "success" && provider.confirm) {
    const conf = await provider.confirm(start.paymentId);
    if (conf.status === "paid") {
      return { ok: true, order: markPaid(order.id, method), payment: conf };
    }
  }
  if (req.body.emulateResult === "cancel" && provider.cancel) {
    await provider.cancel(start.paymentId);
    return { ok: true, cancelled: true, payment: start };
  }

  return { ok: true, pending: true, payment: start, order: getOrder(order.id) };
});

app.post<{
  Params: { id: string };
  Body: { paymentId: string; method: "cash" | "card" | "sbp"; action: "confirm" | "cancel" };
}>("/api/orders/:id/pay/resolve", async (req) => {
  requireWasher(req);
  const { method, paymentId, action } = req.body;
  const provider = providers[method];
  if (action === "cancel") {
    await provider.cancel?.(paymentId);
    return { ok: true, cancelled: true };
  }
  const conf = await provider.confirm?.(paymentId);
  if (conf?.status === "paid") {
    return { ok: true, order: markPaid(req.params.id, method), payment: conf };
  }
  return { ok: false, error: "Не удалось подтвердить" };
});

app.post<{ Params: { id: string } }>("/api/orders/:id/cancel", async (req) => {
  requireWasher(req);
  return cancelOrder(req.params.id);
});

app.get("/api/admin/catalog-tabs", async (req) => {
  requireAdmin(req);
  const rows = db
    .prepare("SELECT * FROM catalog_tabs ORDER BY sort_order, name")
    .all() as {
    id: string;
    slug: string;
    name: string;
    sort_order: number;
    active: number;
  }[];
  return rows.map(mapTabRow);
});

app.post<{
  Body: { name: string; slug?: string; sortOrder?: number; active?: boolean };
}>("/api/admin/catalog-tabs", async (req) => {
  requireAdmin(req);
  const name = req.body.name?.trim();
  if (!name) throw new Error("Название вкладки обязательно");
  let slug = (req.body.slug?.trim() || slugifyTabName(name)).toLowerCase();
  const taken = getCatalogTabBySlug(slug);
  if (taken) slug = `${slug}-${nanoid(4)}`;
  const id = nanoid();
  db.prepare(
    "INSERT INTO catalog_tabs (id, slug, name, sort_order, active) VALUES (?, ?, ?, ?, ?)"
  ).run(id, slug, name, req.body.sortOrder ?? 100, req.body.active === false ? 0 : 1);
  afterCatalogChange();
  return { id, slug };
});

app.put<{
  Params: { id: string };
  Body: { name: string; sortOrder: number; active: boolean };
}>("/api/admin/catalog-tabs/:id", async (req) => {
  requireAdmin(req);
  db.prepare(
    "UPDATE catalog_tabs SET name = ?, sort_order = ?, active = ? WHERE id = ?"
  ).run(req.body.name, req.body.sortOrder, req.body.active ? 1 : 0, req.params.id);
  afterCatalogChange();
  return { ok: true };
});

app.delete<{ Params: { id: string } }>("/api/admin/catalog-tabs/:id", async (req) => {
  requireAdmin(req);
  const tab = db
    .prepare("SELECT id, slug FROM catalog_tabs WHERE id = ?")
    .get(req.params.id) as { id: string; slug: string } | undefined;
  if (!tab) throw new Error("Вкладка не найдена");
  const items = db
    .prepare("SELECT COUNT(*) as c FROM services WHERE tab_id = ?")
    .get(tab.id) as { c: number };
  if (items.c > 0) {
    throw new Error("Сначала удалите все позиции во вкладке");
  }
  const totalTabs = db.prepare("SELECT COUNT(*) as c FROM catalog_tabs").get() as { c: number };
  if (totalTabs.c <= 1) throw new Error("Нельзя удалить последнюю вкладку");
  db.prepare("DELETE FROM catalog_tabs WHERE id = ?").run(tab.id);
  afterCatalogChange();
  return { ok: true };
});

app.get("/api/admin/services", async (req) => {
  requireAdmin(req);
  const rows = db.prepare("SELECT * FROM services ORDER BY sort_order, name").all() as {
    id: string;
    name: string;
    description?: string | null;
    price_kopecks: number;
    active: number;
    sort_order: number;
    tab_id: string | null;
  }[];
  return rows.map(mapServiceRow);
});

app.post<{
  Body: {
    name: string;
    description?: string;
    priceKopecks?: number;
    active?: boolean;
    sortOrder?: number;
    tabId?: string;
    coefficientEnabled?: boolean;
    coefficientStepKopecks?: number;
    durationMinutes?: number;
  };
}>("/api/admin/services", async (req) => {
  requireAdmin(req);
  const id = nanoid();
  const tabId =
    req.body.tabId || getCatalogTabBySlug(TAB_SLUG_SERVICES)?.id || "";
  if (!tabId) throw new Error("Не найдена вкладка каталога");
  const priceKopecks = req.body.priceKopecks ?? 0;
  const description = String(req.body.description ?? "").trim();
  const step = Math.max(100, Math.round(req.body.coefficientStepKopecks ?? 5000));
  const durationMinutes =
    req.body.durationMinutes != null && Number(req.body.durationMinutes) > 0
      ? Math.round(Number(req.body.durationMinutes))
      : defaultDurationMinutesForTabId(tabId);
  db.prepare(
    `INSERT INTO services (
      id, name, description, price_kopecks, active, sort_order, tab_id,
      coefficient_enabled, coefficient_step_kopecks, duration_minutes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    req.body.name,
    description,
    priceKopecks,
    req.body.active === false ? 0 : 1,
    req.body.sortOrder ?? 0,
    tabId,
    req.body.coefficientEnabled ? 1 : 0,
    step,
    durationMinutes
  );
  afterCatalogChange();
  return { id };
});

app.put<{
  Params: { id: string };
  Body: {
    name: string;
    description?: string;
    priceKopecks: number;
    active: boolean;
    sortOrder: number;
    tabId?: string;
    coefficientEnabled?: boolean;
    coefficientStepKopecks?: number;
    durationMinutes?: number;
  };
}>("/api/admin/services/:id", async (req) => {
  requireAdmin(req);
  const existing = db
    .prepare(
      `SELECT tab_id, description, coefficient_enabled, coefficient_step_kopecks, duration_minutes
       FROM services WHERE id = ?`
    )
    .get(req.params.id) as
    | {
        tab_id: string | null;
        description: string | null;
        coefficient_enabled: number;
        coefficient_step_kopecks: number;
        duration_minutes: number | null;
      }
    | undefined;
  const tabId =
    req.body.tabId ||
    existing?.tab_id ||
    getCatalogTabBySlug(TAB_SLUG_SERVICES)?.id ||
    "";
  const description =
    req.body.description !== undefined
      ? String(req.body.description).trim()
      : (existing?.description ?? "");
  const coeffEnabled =
    req.body.coefficientEnabled !== undefined
      ? req.body.coefficientEnabled
        ? 1
        : 0
      : (existing?.coefficient_enabled ?? 0);
  const step =
    req.body.coefficientStepKopecks !== undefined
      ? Math.max(100, Math.round(req.body.coefficientStepKopecks))
      : (existing?.coefficient_step_kopecks ?? 5000);
  const durationMinutes =
    req.body.durationMinutes != null && Number(req.body.durationMinutes) > 0
      ? Math.round(Number(req.body.durationMinutes))
      : resolveServiceDurationMinutes(existing?.duration_minutes, tabId);
  db.prepare(
    `UPDATE services SET name = ?, description = ?, price_kopecks = ?, active = ?, sort_order = ?,
     tab_id = ?, coefficient_enabled = ?, coefficient_step_kopecks = ?, duration_minutes = ?
     WHERE id = ?`
  ).run(
    req.body.name,
    description,
    req.body.priceKopecks,
    req.body.active ? 1 : 0,
    req.body.sortOrder,
    tabId,
    coeffEnabled,
    step,
    durationMinutes,
    req.params.id
  );
  afterCatalogChange();
  return { ok: true };
});

app.delete<{ Params: { id: string } }>("/api/admin/services/:id", async (req) => {
  requireAdmin(req);
  db.prepare("DELETE FROM service_prices WHERE service_id = ?").run(req.params.id);
  const result = db.prepare("DELETE FROM services WHERE id = ?").run(req.params.id);
  if (result.changes === 0) throw new Error("Позиция не найдена");
  afterCatalogChange();
  return { ok: true };
});

app.get("/api/admin/vehicle-classes", async (req) => {
  requireAdmin(req);
  return listVehicleClasses(false).map(mapVehicleClassRow);
});

app.post<{
  Body: {
    name: string;
    description?: string;
    slug?: string;
    iconKey?: string;
    sortOrder?: number;
    active?: boolean;
  };
}>("/api/admin/vehicle-classes", async (req) => {
  requireAdmin(req);
  const name = req.body.name?.trim();
  if (!name) throw new Error("Название класса обязательно");
  let slug = (req.body.slug?.trim() || slugifyClassName(name)).toLowerCase();
  const taken = db
    .prepare("SELECT id FROM vehicle_classes WHERE slug = ?")
    .get(slug) as { id: string } | undefined;
  if (taken) slug = `${slug}-${nanoid(4)}`;
  const id = nanoid();
  const iconKey = (req.body.iconKey?.trim() || slug).toLowerCase();
  db.prepare(
    `INSERT INTO vehicle_classes (id, slug, name, description, icon_key, sort_order, active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    slug,
    name,
    req.body.description?.trim() ?? "",
    iconKey,
    req.body.sortOrder ?? 100,
    req.body.active === false ? 0 : 1
  );
  afterCatalogChange();
  return { id, slug };
});

app.put<{
  Params: { id: string };
  Body: {
    name: string;
    description?: string;
    iconKey?: string;
    sortOrder: number;
    active: boolean;
  };
}>("/api/admin/vehicle-classes/:id", async (req) => {
  requireAdmin(req);
  const existing = db
    .prepare("SELECT * FROM vehicle_classes WHERE id = ?")
    .get(req.params.id) as VehicleClassRow | undefined;
  if (!existing) throw new Error("Класс не найден");
  db.prepare(
    `UPDATE vehicle_classes SET name = ?, description = ?, icon_key = ?, sort_order = ?, active = ?
     WHERE id = ?`
  ).run(
    req.body.name,
    req.body.description ?? existing.description,
    req.body.iconKey ?? existing.icon_key,
    req.body.sortOrder,
    req.body.active ? 1 : 0,
    req.params.id
  );
  afterCatalogChange();
  return { ok: true };
});

app.delete<{ Params: { id: string } }>("/api/admin/vehicle-classes/:id", async (req) => {
  requireAdmin(req);
  const existing = db
    .prepare("SELECT * FROM vehicle_classes WHERE id = ?")
    .get(req.params.id) as VehicleClassRow | undefined;
  if (!existing) throw new Error("Класс не найден");
  const priceCount = db
    .prepare("SELECT COUNT(*) as c FROM service_prices WHERE class_id = ?")
    .get(req.params.id) as { c: number };
  if (priceCount.c > 0) {
    db.prepare("UPDATE vehicle_classes SET active = 0 WHERE id = ?").run(req.params.id);
    afterCatalogChange();
    return { ok: true, soft: true };
  }
  db.prepare("DELETE FROM vehicle_classes WHERE id = ?").run(req.params.id);
  afterCatalogChange();
  return { ok: true, soft: false };
});

app.get<{ Querystring: { classId?: string; tabSlug?: string } }>(
  "/api/admin/service-prices",
  async (req) => {
    requireAdmin(req);
    const classId = req.query.classId || getDefaultVehicleClass().id;
    const vc = db.prepare("SELECT id FROM vehicle_classes WHERE id = ?").get(classId) as
      | { id: string }
      | undefined;
    if (!vc) throw new Error("Класс не найден");

    const tabSlug =
      req.query.tabSlug === TAB_SLUG_EXTRA_SERVICES
        ? TAB_SLUG_EXTRA_SERVICES
        : TAB_SLUG_SERVICES;
    const catalogTab = getCatalogTabBySlug(tabSlug);
    if (!catalogTab) {
      throw new Error(
        tabSlug === TAB_SLUG_EXTRA_SERVICES
          ? "Вкладка Доп.услуги не найдена"
          : "Вкладка Услуги не найдена"
      );
    }

    const services = db
      .prepare(
        `SELECT id, name, tab_id, duration_minutes FROM services
         WHERE tab_id = ? ORDER BY sort_order, name`
      )
      .all(catalogTab.id) as {
      id: string;
      name: string;
      tab_id: string | null;
      duration_minutes: number | null;
    }[];

    const priceStmt = db.prepare(
      "SELECT price_kopecks FROM service_prices WHERE service_id = ? AND class_id = ?"
    );

    return {
      classId,
      tabSlug,
      items: services.map((s) => {
        const row = priceStmt.get(s.id, classId) as { price_kopecks: number } | undefined;
        return {
          serviceId: s.id,
          name: s.name,
          priceKopecks: row ? row.price_kopecks : null,
          durationMinutes: resolveServiceDurationMinutes(s.duration_minutes, s.tab_id),
        };
      }),
    };
  }
);

app.put<{
  Body: {
    classId: string;
    items: { serviceId: string; priceKopecks: number | null; durationMinutes?: number }[];
  };
}>("/api/admin/service-prices", async (req) => {
  requireAdmin(req);
  const classId = req.body.classId;
  if (!classId) throw new Error("classId обязателен");
  const vc = db.prepare("SELECT id FROM vehicle_classes WHERE id = ?").get(classId) as
    | { id: string }
    | undefined;
  if (!vc) throw new Error("Класс не найден");

  const upsert = db.prepare(
    `INSERT INTO service_prices (service_id, class_id, price_kopecks) VALUES (?, ?, ?)
     ON CONFLICT(service_id, class_id) DO UPDATE SET price_kopecks = excluded.price_kopecks`
  );
  const del = db.prepare(
    "DELETE FROM service_prices WHERE service_id = ? AND class_id = ?"
  );
  const updateDuration = db.prepare(
    "UPDATE services SET duration_minutes = ? WHERE id = ?"
  );
  const getTab = db.prepare("SELECT tab_id FROM services WHERE id = ?");

  for (const item of req.body.items ?? []) {
    if (item.priceKopecks === null || item.priceKopecks === undefined) {
      del.run(item.serviceId, classId);
    } else {
      upsert.run(item.serviceId, classId, item.priceKopecks);
    }
    if (item.durationMinutes != null) {
      const svc = getTab.get(item.serviceId) as { tab_id: string | null } | undefined;
      const minutes = Math.round(Number(item.durationMinutes));
      if (Number.isFinite(minutes) && minutes > 0) {
        updateDuration.run(minutes, item.serviceId);
      } else if (svc) {
        updateDuration.run(defaultDurationMinutesForTabId(svc.tab_id), item.serviceId);
      }
    }
  }
  afterCatalogChange();
  return { ok: true };
});

app.get("/api/admin/discounts", async (req) => {
  requireAdmin(req);
  const rows = db.prepare("SELECT * FROM discounts ORDER BY name").all() as {
    id: string;
    name: string;
    type: string;
    value: number;
    active: number;
  }[];
  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    value: d.value,
    active: !!d.active,
  }));
});

app.post<{
  Body: { name: string; type: "percent" | "fixed"; value: number; active?: boolean };
}>("/api/admin/discounts", async (req) => {
  requireAdmin(req);
  const id = nanoid();
  db.prepare(
    "INSERT INTO discounts (id, name, type, value, active) VALUES (?, ?, ?, ?, ?)"
  ).run(id, req.body.name, req.body.type, req.body.value, req.body.active === false ? 0 : 1);
  return { id };
});

app.put<{
  Params: { id: string };
  Body: { name: string; type: "percent" | "fixed"; value: number; active: boolean };
}>("/api/admin/discounts/:id", async (req) => {
  requireAdmin(req);
  db.prepare("UPDATE discounts SET name = ?, type = ?, value = ?, active = ? WHERE id = ?").run(
    req.body.name,
    req.body.type,
    req.body.value,
    req.body.active ? 1 : 0,
    req.params.id
  );
  return { ok: true };
});

app.delete<{ Params: { id: string } }>("/api/admin/discounts/:id", async (req) => {
  requireAdmin(req);
  // Снимаем ссылку у черновиков/заказов, чтобы не ломать историю
  db.prepare("UPDATE orders SET discount_id = NULL WHERE discount_id = ?").run(req.params.id);
  const result = db.prepare("DELETE FROM discounts WHERE id = ?").run(req.params.id);
  if (result.changes === 0) throw new Error("Скидка не найдена");
  return { ok: true };
});

app.get("/api/admin/washers", async (req) => {
  requireAdmin(req);
  const rows = db.prepare("SELECT id, name, active, created_at FROM washers ORDER BY name").all() as {
    id: string;
    name: string;
    active: number;
    created_at: string;
  }[];
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    active: !!w.active,
    createdAt: w.created_at,
  }));
});

app.post<{ Body: { name: string; pin: string; active?: boolean } }>(
  "/api/admin/washers",
  async (req) => {
    requireAdmin(req);
    if (!/^\d{4,6}$/.test(req.body.pin)) throw new Error("PIN: 4–6 цифр");
    const id = nanoid();
    db.prepare(
      "INSERT INTO washers (id, name, pin_hash, active, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(
      id,
      req.body.name,
      bcrypt.hashSync(req.body.pin, 10),
      req.body.active === false ? 0 : 1,
      new Date().toISOString()
    );
    return { id };
  }
);

app.put<{
  Params: { id: string };
  Body: { name: string; pin?: string; active: boolean };
}>("/api/admin/washers/:id", async (req) => {
  requireAdmin(req);
  if (req.body.pin) {
    if (!/^\d{4,6}$/.test(req.body.pin)) throw new Error("PIN: 4–6 цифр");
    db.prepare("UPDATE washers SET name = ?, pin_hash = ?, active = ? WHERE id = ?").run(
      req.body.name,
      bcrypt.hashSync(req.body.pin, 10),
      req.body.active ? 1 : 0,
      req.params.id
    );
  } else {
    db.prepare("UPDATE washers SET name = ?, active = ? WHERE id = ?").run(
      req.body.name,
      req.body.active ? 1 : 0,
      req.params.id
    );
  }
  return { ok: true };
});

app.delete<{ Params: { id: string } }>("/api/admin/washers/:id", async (req) => {
  requireAdmin(req);
  const count = db.prepare("SELECT COUNT(*) as c FROM washers").get() as { c: number };
  if (count.c <= 1) throw new Error("Нельзя удалить последнего оператора");
  db.prepare("DELETE FROM sessions WHERE washer_id = ?").run(req.params.id);
  const result = db.prepare("DELETE FROM washers WHERE id = ?").run(req.params.id);
  if (result.changes === 0) throw new Error("Оператор не найден");
  return { ok: true };
});

app.get("/api/admin/staff-washers", async (req) => {
  requireAdmin(req);
  const rows = db
    .prepare("SELECT * FROM staff_washers ORDER BY sort_order, name")
    .all() as {
    id: string;
    name: string;
    salary_percent: number;
    active: number;
    sort_order: number;
  }[];
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    salaryPercent: w.salary_percent,
    active: !!w.active,
    sortOrder: w.sort_order,
  }));
});

app.post<{
  Body: { name: string; salaryPercent?: number; active?: boolean; sortOrder?: number };
}>("/api/admin/staff-washers", async (req) => {
  requireAdmin(req);
  const name = String(req.body.name ?? "").trim();
  if (!name) throw new Error("Укажите имя мойщика");
  const salary = Math.min(100, Math.max(0, Math.round(req.body.salaryPercent ?? 0)));
  const id = nanoid();
  db.prepare(
    `INSERT INTO staff_washers (id, name, salary_percent, active, sort_order)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, name, salary, req.body.active === false ? 0 : 1, req.body.sortOrder ?? 0);
  return { id };
});

app.put<{
  Params: { id: string };
  Body: { name: string; salaryPercent: number; active: boolean; sortOrder?: number };
}>("/api/admin/staff-washers/:id", async (req) => {
  requireAdmin(req);
  const name = String(req.body.name ?? "").trim();
  if (!name) throw new Error("Укажите имя мойщика");
  const salary = Math.min(100, Math.max(0, Math.round(req.body.salaryPercent ?? 0)));
  db.prepare(
    `UPDATE staff_washers SET name = ?, salary_percent = ?, active = ?, sort_order = ?
     WHERE id = ?`
  ).run(
    name,
    salary,
    req.body.active ? 1 : 0,
    req.body.sortOrder ?? 0,
    req.params.id
  );
  return { ok: true };
});

app.delete<{ Params: { id: string } }>("/api/admin/staff-washers/:id", async (req) => {
  requireAdmin(req);
  db.prepare("DELETE FROM order_staff_washers WHERE staff_washer_id = ?").run(req.params.id);
  const result = db.prepare("DELETE FROM staff_washers WHERE id = ?").run(req.params.id);
  if (result.changes === 0) throw new Error("Мойщик не найден");
  return { ok: true };
});

app.get("/api/admin/terminal", async (req) => {
  requireAdmin(req);
  return JSON.parse(getSetting("terminal_config") ?? "{}");
});

app.put<{ Body: Record<string, unknown> }>("/api/admin/terminal", async (req) => {
  requireAdmin(req);
  setSetting("terminal_config", JSON.stringify(req.body));
  return { ok: true };
});

app.post<{ Body: { current: string; next: string } }>("/api/admin/master-code", async (req) => {
  requireAdmin(req);
  return changeMasterCode(req.body.current, req.body.next);
});

app.get<{ Querystring: { period?: string } }>("/api/admin/analytics", async (req) => {
  requireAdmin(req);
  const period = req.query.period ?? "day";
  const now = new Date();
  let from: Date;
  if (period === "month") {
    from = new Date(now);
    from.setUTCDate(1);
    from.setUTCHours(0, 0, 0, 0);
    const label = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
    }).format(now);
    from = new Date(`${label}-01T00:00:00+03:00`);
  } else {
    const label = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    from = new Date(`${label}T00:00:00+03:00`);
  }
  return analytics(from.toISOString(), now.toISOString());
});

app.get<{
  Querystring: {
    mode?: string;
    from?: string;
    to?: string;
    shiftId?: string;
  };
}>("/api/admin/analytics/by-washer", async (req) => {
  requireAdmin(req);
  const mode = req.query.mode ?? "shift";
  const now = new Date();

  function moscowDayLabel(d: Date) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  }

  let fromIso: string;
  let toIso: string = now.toISOString();

  if (mode === "range" && req.query.from && req.query.to) {
    fromIso = new Date(`${req.query.from}T00:00:00+03:00`).toISOString();
    toIso = new Date(`${req.query.to}T23:59:59.999+03:00`).toISOString();
  } else if (mode === "week") {
    const label = moscowDayLabel(now);
    const today = new Date(`${label}T12:00:00+03:00`);
    const day = today.getUTCDay(); // 0 Sun
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(today);
    monday.setUTCDate(today.getUTCDate() + mondayOffset);
    fromIso = new Date(`${moscowDayLabel(monday)}T00:00:00+03:00`).toISOString();
  } else if (mode === "month") {
    const label = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
    }).format(now);
    fromIso = new Date(`${label}-01T00:00:00+03:00`).toISOString();
  } else {
    // shift (default): current/open shift or last closed
    let shiftId = req.query.shiftId;
    if (!shiftId) {
      const open = getOpenShift();
      if (open) shiftId = open.id;
      else {
        const last = listShifts(1)[0];
        shiftId = last?.id;
      }
    }
    if (!shiftId) {
      return { from: toIso, to: toIso, washers: [], mode: "shift", shiftId: null };
    }
    const shift = getShift(shiftId);
    if (!shift) throw new Error("Смена не найдена");
    fromIso = shift.openedAt;
    toIso = shift.closedAt ?? now.toISOString();
    const result = analyticsByWasher(fromIso, toIso);
    return { ...result, mode: "shift", shiftId };
  }

  return { ...analyticsByWasher(fromIso, toIso), mode };
});

app.get<{ Querystring: { limit?: string } }>("/api/admin/shifts", async (req) => {
  requireAdmin(req);
  const limit = Number(req.query.limit ?? 40) || 40;
  return { shifts: listShifts(limit), current: getShiftStatus() };
});

app.get<{ Params: { id: string } }>("/api/admin/shifts/:id", async (req) => {
  requireAdmin(req);
  const shift = getShift(req.params.id);
  if (!shift) throw Object.assign(new Error("Смена не найдена"), { statusCode: 404 });
  return buildShiftReport(req.params.id);
});

app.post("/api/admin/sync", async (req) => {
  requireAdmin(req);
  return flushOutbox();
});

app.post("/api/admin/publish-catalog", async (req) => {
  requireAdmin(req);
  afterCatalogChange();
  return flushOutbox();
});

app.get("/api/admin/sync-settings", async (req) => {
  requireAdmin(req);
  return {
    cloudSyncUrl: getSetting("cloud_sync_url"),
    hasToken: !!getSetting("cloud_sync_token"),
  };
});

app.put<{ Body: { cloudSyncUrl: string; cloudSyncToken?: string } }>(
  "/api/admin/sync-settings",
  async (req) => {
    requireAdmin(req);
    setSetting("cloud_sync_url", req.body.cloudSyncUrl);
    if (req.body.cloudSyncToken) setSetting("cloud_sync_token", req.body.cloudSyncToken);
    return { ok: true };
  }
);

async function desktopCtrl(
  pathname: string,
  method: "GET" | "POST" = "GET",
  body?: unknown
) {
  const base = process.env.ART_DESKTOP_CTRL_URL?.trim();
  const token = process.env.ART_DESKTOP_CTRL_TOKEN?.trim();
  if (!base || !token) {
    return {
      ok: false,
      desktop: false,
      message:
        "Обновление доступно только в приложении кассы (Electron). Запустите ArtCarwash-POS.",
    };
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
  };
  let payload: string | undefined;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base.replace(/\/$/, "")}${pathname}`, {
    method,
    headers,
    body: payload,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw Object.assign(new Error(String(data.error ?? res.statusText)), {
      statusCode: res.status,
    });
  }
  return data;
}

app.get("/api/admin/updates/status", async (req) => {
  requireAdmin(req);
  return desktopCtrl("/status", "GET");
});

app.post("/api/admin/updates/check", async (req) => {
  requireAdmin(req);
  return desktopCtrl("/check", "POST");
});

app.post("/api/admin/updates/apply", async (req) => {
  requireAdmin(req);
  return desktopCtrl("/apply", "POST");
});

app.post<{ Body: { token?: string } }>("/api/admin/updates/github-token", async (req) => {
  requireAdmin(req);
  return desktopCtrl("/github-token", "POST", { token: req.body?.token ?? "" });
});

// Preview discount helper for UI
app.post<{
  Body: { subtotalKopecks: number; discountId: string | null };
}>("/api/calc-discount", async (req) => {
  let discount = null;
  if (req.body.discountId) {
    const row = db.prepare("SELECT * FROM discounts WHERE id = ?").get(req.body.discountId) as
      | { type: "percent" | "fixed"; value: number }
      | undefined;
    if (row) discount = row;
  }
  const discountKopecks = calcDiscountKopecks(req.body.subtotalKopecks, discount);
  return {
    discountKopecks,
    totalKopecks: Math.max(0, req.body.subtotalKopecks - discountKopecks),
  };
});

const webDist = process.env.ART_WEB_DIST?.trim();
if (webDist) {
  const indexHtml = path.join(webDist, "index.html");
  if (!fs.existsSync(indexHtml)) {
    console.error(`[web] ART_WEB_DIST задан, но нет index.html: ${indexHtml}`);
    process.exit(1);
  }
  await app.register(fastifyStatic, {
    root: path.resolve(webDist),
    wildcard: false,
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api") || req.url.startsWith("/cloud-api")) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html");
  });
  console.log(`[web] static from ${path.resolve(webDist)}`);
} else {
  console.warn("[web] ART_WEB_DIST не задан — UI не раздаётся (возможен белый экран в Electron)");
}

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
startSyncLoop();
console.log(`local-api on :${port}`);
