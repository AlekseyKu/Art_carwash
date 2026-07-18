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
  ensureClientTables,
  findClientByPlate,
  latestAnprEvent,
  recordAnprEvent,
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
  getCatalogTabBySlug,
  getSetting,
  migrate,
  seedIfEmpty,
  setSetting,
  TAB_SLUG_SERVICES,
} from "./db.js";
import {
  analytics,
  cancelOrder,
  getOrCreateDraft,
  getOrder,
  listRecentOrders,
  markAwaitingPayment,
  markPaid,
  setOrderItems,
} from "./orders.js";
import { isOnline, providers } from "./payments.js";
import { flushOutbox, startSyncLoop } from "./sync.js";

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
  return {
    online,
    pendingSync: pending.c,
    siteName: getSetting("site_name") ?? "Автомойка АРТ",
  };
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
  price_kopecks: number;
  active: number;
  sort_order: number;
  tab_id: string | null;
}) {
  return {
    id: s.id,
    name: s.name,
    priceKopecks: s.price_kopecks,
    active: !!s.active,
    sortOrder: s.sort_order,
    tabId: s.tab_id ?? "",
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

function slugifyTabName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || `tab-${nanoid(6)}`;
}

app.get("/api/catalog", async () => {
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
    price_kopecks: number;
    active: number;
    sort_order: number;
    tab_id: string | null;
  }[];
  const discounts = db
    .prepare("SELECT * FROM discounts WHERE active = 1")
    .all() as {
    id: string;
    name: string;
    type: string;
    value: number;
    active: number;
  }[];
  return {
    tabs: tabs.map(mapTabRow),
    services: services.map(mapServiceRow),
    discounts: discounts.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      value: d.value,
      active: !!d.active,
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

app.post<{ Body: { plate?: string; phone?: string; name?: string; id?: string } }>(
  "/api/clients",
  async (req) => {
    requireWasher(req);
    return upsertClient(req.body ?? {});
  }
);

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

app.put<{
  Params: { id: string };
  Body: { items: { serviceId: string; qty: number }[]; discountId: string | null };
}>("/api/orders/:id", async (req) => {
  requireWasher(req);
  return setOrderItems(req.params.id, req.body.items ?? [], req.body.discountId ?? null);
});

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
  return { ok: true };
});

app.get("/api/admin/services", async (req) => {
  requireAdmin(req);
  const rows = db.prepare("SELECT * FROM services ORDER BY sort_order, name").all() as {
    id: string;
    name: string;
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
    priceKopecks: number;
    active?: boolean;
    sortOrder?: number;
    tabId?: string;
  };
}>("/api/admin/services", async (req) => {
  requireAdmin(req);
  const id = nanoid();
  const tabId =
    req.body.tabId || getCatalogTabBySlug(TAB_SLUG_SERVICES)?.id || "";
  if (!tabId) throw new Error("Не найдена вкладка каталога");
  db.prepare(
    "INSERT INTO services (id, name, price_kopecks, active, sort_order, tab_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    req.body.name,
    req.body.priceKopecks,
    req.body.active === false ? 0 : 1,
    req.body.sortOrder ?? 0,
    tabId
  );
  return { id };
});

app.put<{
  Params: { id: string };
  Body: {
    name: string;
    priceKopecks: number;
    active: boolean;
    sortOrder: number;
    tabId?: string;
  };
}>("/api/admin/services/:id", async (req) => {
  requireAdmin(req);
  const existing = db
    .prepare("SELECT tab_id FROM services WHERE id = ?")
    .get(req.params.id) as { tab_id: string | null } | undefined;
  const tabId =
    req.body.tabId ||
    existing?.tab_id ||
    getCatalogTabBySlug(TAB_SLUG_SERVICES)?.id ||
    "";
  db.prepare(
    "UPDATE services SET name = ?, price_kopecks = ?, active = ?, sort_order = ?, tab_id = ? WHERE id = ?"
  ).run(
    req.body.name,
    req.body.priceKopecks,
    req.body.active ? 1 : 0,
    req.body.sortOrder,
    tabId,
    req.params.id
  );
  return { ok: true };
});

app.delete<{ Params: { id: string } }>("/api/admin/services/:id", async (req) => {
  requireAdmin(req);
  const result = db.prepare("DELETE FROM services WHERE id = ?").run(req.params.id);
  if (result.changes === 0) throw new Error("Позиция не найдена");
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
  if (count.c <= 1) throw new Error("Нельзя удалить последнего мойщика");
  db.prepare("DELETE FROM sessions WHERE washer_id = ?").run(req.params.id);
  const result = db.prepare("DELETE FROM washers WHERE id = ?").run(req.params.id);
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
    // rough Moscow month start
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

app.post("/api/admin/sync", async (req) => {
  requireAdmin(req);
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

async function desktopCtrl(pathname: string, method: "GET" | "POST" = "GET") {
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
  const res = await fetch(`${base.replace(/\/$/, "")}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
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
if (webDist && fs.existsSync(path.join(webDist, "index.html"))) {
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
}

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
startSyncLoop();
console.log(`local-api on :${port}`);
