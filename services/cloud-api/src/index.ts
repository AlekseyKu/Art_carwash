import cors from "@fastify/cors";
import bcrypt from "bcryptjs";
import { DatabaseSync } from "node:sqlite";
import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import {
  type CatalogSnapshot,
  initCatalogSchema,
  saveCatalogSnapshot,
} from "./catalog.js";
import { initCustomerSchema, registerCustomerRoutes } from "./customer.js";
import {
  initBookingSchema,
  pullStationOutbox,
  registerBookingRoutes,
  upsertBookingFromPayload,
} from "./bookings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveDataDir(): string {
  const fallback = path.join(__dirname, "../../../data");
  const configured = process.env.ART_CLOUD_DATA_DIR;
  if (!configured) return fallback;
  // deploy/.env на VPS: /data; на Windows используем data/ в репо
  if (process.platform === "win32" && configured.replace(/\\/g, "/") === "/data") {
    return fallback;
  }
  return configured;
}

const dataDir = resolveDataDir();
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "cloud.db"));
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS owners (
    id TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    number INTEGER,
    post_id INTEGER,
    washer_id TEXT,
    status TEXT,
    payment_method TEXT,
    subtotal_kopecks INTEGER,
    discount_kopecks INTEGER,
    total_kopecks INTEGER,
    created_at TEXT,
    paid_at TEXT,
    payload TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    received_at TEXT NOT NULL
  );
`);

initCatalogSchema(db);
initCustomerSchema(db);
initBookingSchema(db);

const ownerCount = db.prepare("SELECT COUNT(*) as c FROM owners").get() as { c: number };
if (ownerCount.c === 0) {
  const pwd = process.env.ART_OWNER_PASSWORD ?? "owner";
  db.prepare("INSERT INTO owners (id, password_hash) VALUES (?, ?)").run(
    nanoid(),
    bcrypt.hashSync(pwd, 10)
  );
  console.log("[cloud seed] owner password =", pwd);
}

const SYNC_TOKEN = process.env.ART_SYNC_TOKEN ?? "art-sync-secret";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

registerCustomerRoutes(app, db);
registerBookingRoutes(app, db);

function bearer(req: { headers: { authorization?: string } }) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return undefined;
  return h.slice(7);
}

function requireOwner(req: { headers: { authorization?: string } }) {
  const token = bearer(req);
  if (!token) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  const row = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token) as
    | { expires_at: string }
    | undefined;
  if (!row) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }
}

app.setErrorHandler((err, _req, reply) => {
  const e = err as { statusCode?: number; message?: string };
  const status = e.statusCode ?? 400;
  reply.code(status).send({ error: e.message ?? "Error" });
});

app.get("/api/health", async () => ({ ok: true, service: "cloud-api" }));

app.post<{
  Body: {
    events: { id: string; type: string; payload: unknown; createdAt: string }[];
  };
}>("/api/sync", async (req, reply) => {
  if (req.headers["x-sync-token"] !== SYNC_TOKEN) {
    return reply.code(401).send({ error: "Invalid sync token" });
  }

  const insertEvent = db.prepare(
    "INSERT OR IGNORE INTO sync_events (id, type, created_at, received_at) VALUES (?, ?, ?, ?)"
  );
  const upsertOrder = db.prepare(
    `INSERT INTO orders (id, number, post_id, washer_id, status, payment_method,
      subtotal_kopecks, discount_kopecks, total_kopecks, created_at, paid_at, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       payment_method = excluded.payment_method,
       paid_at = excluded.paid_at,
       payload = excluded.payload`
  );

  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    for (const ev of req.body.events ?? []) {
      insertEvent.run(ev.id, ev.type, ev.createdAt, now);
      if (ev.type === "catalog.snapshot") {
        saveCatalogSnapshot(db, ev.payload as CatalogSnapshot);
        continue;
      }
      if (ev.type === "booking.upsert" || ev.type === "booking.status") {
        upsertBookingFromPayload(db, (ev.payload ?? {}) as Record<string, unknown>);
        continue;
      }
      const p = ev.payload as {
        id: string;
        number: number;
        postId: number;
        washerId: string;
        status: string;
        paymentMethod: string | null;
        subtotalKopecks: number;
        discountKopecks: number;
        totalKopecks: number;
        createdAt: string;
        paidAt: string | null;
      };
      if (p?.id) {
        upsertOrder.run(
          p.id,
          p.number,
          p.postId,
          p.washerId,
          p.status,
          p.paymentMethod,
          p.subtotalKopecks,
          p.discountKopecks,
          p.totalKopecks,
          p.createdAt,
          p.paidAt,
          JSON.stringify(ev.payload)
        );
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  const pull = pullStationOutbox(db, 50);
  return { ok: true, received: req.body.events?.length ?? 0, events: pull };
});

app.post<{ Body: { password: string } }>("/api/owner/login", async (req) => {
  const owners = db.prepare("SELECT * FROM owners").all() as { password_hash: string }[];
  for (const o of owners) {
    if (bcrypt.compareSync(req.body.password, o.password_hash)) {
      const token = nanoid(32);
      const expires = "9999-12-31T23:59:59.000Z";
      db.prepare("INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)").run(
        token,
        new Date().toISOString(),
        expires
      );
      return { ok: true, token, expiresAt: expires };
    }
  }
  return { ok: false, error: "Неверный пароль" };
});

app.get<{ Querystring: { period?: string } }>("/api/owner/analytics", async (req) => {
  requireOwner(req);
  const period = req.query.period ?? "day";
  const now = new Date();
  let from: Date;
  if (period === "month") {
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

  const orders = db
    .prepare(
      `SELECT * FROM orders WHERE status = 'paid' AND paid_at IS NOT NULL AND paid_at >= ? AND paid_at < ?`
    )
    .all(from.toISOString(), now.toISOString()) as {
    post_id: number;
    payment_method: string | null;
    total_kopecks: number;
    payload: string;
  }[];

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

    try {
      const full = JSON.parse(o.payload) as {
        items?: { nameSnapshot: string; priceKopecks: number; qty: number }[];
      };
      for (const i of full.items ?? []) {
        const s = byService.get(i.nameSnapshot) ?? { total: 0, count: 0 };
        s.total += i.priceKopecks * i.qty;
        s.count += i.qty;
        byService.set(i.nameSnapshot, s);
      }
    } catch {
      /* ignore */
    }
  }

  return {
    from: from.toISOString(),
    to: now.toISOString(),
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
});

const port = Number(process.env.PORT ?? 3002);
await app.listen({ port, host: "0.0.0.0" });
console.log(`cloud-api on :${port}`);
