import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import type { DatabaseSync } from "node:sqlite";
import { enqueueStationOutbox } from "./bookings.js";
import { getCatalogSnapshot } from "./catalog.js";
import { formatPhoneDisplay, normalizePhone } from "./phone.js";
import { parseRfPlate } from "./plate.js";
import { mskDateString } from "./time.js";

const PRIVACY_VERSION = "2026-08-30";
const SESSION_DAYS = 30;

export function initCustomerSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_accounts (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT,
      pdn_accepted_at TEXT NOT NULL,
      privacy_policy_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_sessions (
      token TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      plate_number TEXT NOT NULL,
      class_id TEXT NOT NULL,
      nickname TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (customer_id, plate_number)
    );

    CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id);

    CREATE TABLE IF NOT EXISTS customer_tariffs (
      customer_id TEXT NOT NULL,
      tariff_id TEXT NOT NULL,
      PRIMARY KEY (customer_id, tariff_id)
    );
  `);
}

export function applyClientTariffsFromStation(
  db: DatabaseSync,
  payload: { phone?: string; tariffIds?: string[] }
) {
  const phone = normalizePhone(payload.phone ?? "");
  if (!phone) return;
  const customer = db
    .prepare("SELECT id FROM customer_accounts WHERE phone = ?")
    .get(phone) as { id: string } | undefined;
  if (!customer) return;

  db.prepare("DELETE FROM customer_tariffs WHERE customer_id = ?").run(customer.id);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO customer_tariffs (customer_id, tariff_id) VALUES (?, ?)"
  );
  for (const raw of payload.tariffIds ?? []) {
    const tariffId = String(raw ?? "").trim();
    if (!tariffId) continue;
    insert.run(customer.id, tariffId);
  }
}

export function listCustomerTariffsForMe(db: DatabaseSync, customerId: string) {
  const today = mskDateString();
  const snap = getCatalogSnapshot(db);
  const assigned = new Set(
    (
      db
        .prepare("SELECT tariff_id FROM customer_tariffs WHERE customer_id = ?")
        .all(customerId) as { tariff_id: string }[]
    ).map((r) => r.tariff_id)
  );
  if (assigned.size === 0) return [];

  const serviceName = new Map((snap.services ?? []).map((s) => [s.id, s.name]));
  const className = new Map((snap.vehicleClasses ?? []).map((c) => [c.id, c.name]));

  return (snap.tariffs ?? [])
    .filter((t) => assigned.has(t.id) && t.active !== false)
    .filter((t) => t.validFrom <= today && (t.validTo == null || t.validTo >= today))
    .map((t) => ({
      id: t.id,
      name: t.name,
      validFrom: t.validFrom,
      validTo: t.validTo,
      prices: (t.prices ?? []).map((p) => ({
        serviceId: p.serviceId,
        classId: p.classId,
        serviceName: serviceName.get(p.serviceId) ?? p.serviceId,
        className: className.get(p.classId) ?? p.classId,
        priceKopecks: p.priceKopecks,
      })),
    }));
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
  return { token, customerId: row.customer_id, phone: row.phone, name: row.name };
}

function createSession(db: DatabaseSync, customerId: string) {
  const token = nanoid(48);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString();
  db.prepare(
    "INSERT INTO customer_sessions (token, customer_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(token, customerId, now.toISOString(), expires);
  return { token, expiresAt: expires };
}

type VehicleRow = {
  id: string;
  customer_id: string;
  plate_number: string;
  class_id: string;
  nickname: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
};

function mapVehicle(row: VehicleRow) {
  return {
    id: row.id,
    plateNumber: row.plate_number,
    classId: row.class_id,
    nickname: row.nickname,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listVehicles(db: DatabaseSync, customerId: string) {
  const rows = db
    .prepare(
      `SELECT * FROM vehicles
       WHERE customer_id = ?
       ORDER BY is_default DESC, created_at ASC`
    )
    .all(customerId) as VehicleRow[];
  return rows.map(mapVehicle);
}

/** Снимок клиента для кассы (customer.upsert). */
export function buildCustomerUpsertPayload(db: DatabaseSync, customerId: string) {
  const row = db
    .prepare("SELECT id, phone, name, updated_at FROM customer_accounts WHERE id = ?")
    .get(customerId) as
    | { id: string; phone: string; name: string | null; updated_at: string }
    | undefined;
  if (!row) return null;
  const vehicles = listVehicles(db, customerId);
  return {
    id: row.id,
    phone: row.phone,
    name: row.name,
    updatedAt: row.updated_at,
    vehicles: vehicles.map((v) => ({
      id: v.id,
      plateNumber: v.plateNumber,
      classId: v.classId,
      nickname: v.nickname,
      isDefault: v.isDefault,
    })),
  };
}

export function enqueueCustomerUpsert(db: DatabaseSync, customerId: string) {
  const payload = buildCustomerUpsertPayload(db, customerId);
  if (!payload) return;
  enqueueStationOutbox(db, "customer.upsert", payload);
}

export function enqueueAllCustomerUpserts(db: DatabaseSync) {
  const ids = db.prepare("SELECT id FROM customer_accounts").all() as { id: string }[];
  for (const row of ids) enqueueCustomerUpsert(db, row.id);
  return ids.length;
}

function getVehicle(db: DatabaseSync, customerId: string, id: string) {
  return db
    .prepare("SELECT * FROM vehicles WHERE id = ? AND customer_id = ?")
    .get(id, customerId) as VehicleRow | undefined;
}

function clearDefaults(db: DatabaseSync, customerId: string) {
  db.prepare("UPDATE vehicles SET is_default = 0 WHERE customer_id = ?").run(customerId);
}

function ensureOneDefault(db: DatabaseSync, customerId: string) {
  const def = db
    .prepare("SELECT id FROM vehicles WHERE customer_id = ? AND is_default = 1")
    .get(customerId);
  if (def) return;
  const first = db
    .prepare(
      "SELECT id FROM vehicles WHERE customer_id = ? ORDER BY created_at ASC LIMIT 1"
    )
    .get(customerId) as { id: string } | undefined;
  if (first) {
    db.prepare("UPDATE vehicles SET is_default = 1 WHERE id = ?").run(first.id);
  }
}

function classExistsInCatalog(db: DatabaseSync, classId: string): boolean {
  const snap = getCatalogSnapshot(db) as {
    vehicleClasses?: { id: string; active?: boolean }[];
  };
  return (snap.vehicleClasses ?? []).some((c) => c.id === classId && c.active !== false);
}

export function registerCustomerRoutes(app: FastifyInstance, db: DatabaseSync) {
  app.post<{
    Body: {
      phone?: string;
      password?: string;
      passwordConfirm?: string;
      pdnAccepted?: boolean;
      privacyPolicyVersion?: string;
    };
  }>("/api/customer/register", async (req, reply) => {
    const phone = normalizePhone(req.body.phone ?? "");
    if (!phone) return reply.code(400).send({ error: "Некорректный телефон" });
    const password = req.body.password ?? "";
    if (password.length < 8) {
      return reply.code(400).send({ error: "Пароль не менее 8 символов" });
    }
    if (password !== (req.body.passwordConfirm ?? password)) {
      return reply.code(400).send({ error: "Пароли не совпадают" });
    }
    if (!req.body.pdnAccepted) {
      return reply.code(400).send({ error: "Необходимо согласие на обработку ПДн" });
    }
    const version = req.body.privacyPolicyVersion ?? PRIVACY_VERSION;
    const exists = db.prepare("SELECT id FROM customer_accounts WHERE phone = ?").get(phone);
    if (exists) return reply.code(409).send({ error: "Аккаунт уже существует" });

    const id = nanoid();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO customer_accounts
       (id, phone, password_hash, name, pdn_accepted_at, privacy_policy_version, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`
    ).run(id, phone, bcrypt.hashSync(password, 10), now, version, now, now);

    const session = createSession(db, id);
    enqueueCustomerUpsert(db, id);
    return {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      customer: { id, phone, phoneDisplay: formatPhoneDisplay(phone), name: null },
    };
  });

  app.post<{ Body: { phone?: string; password?: string } }>(
    "/api/customer/login",
    async (req, reply) => {
      const phone = normalizePhone(req.body.phone ?? "");
      if (!phone) return reply.code(400).send({ error: "Некорректный телефон" });
      const row = db
        .prepare("SELECT id, password_hash, name FROM customer_accounts WHERE phone = ?")
        .get(phone) as { id: string; password_hash: string; name: string | null } | undefined;
      if (!row || !bcrypt.compareSync(req.body.password ?? "", row.password_hash)) {
        return reply.code(401).send({ error: "Неверный телефон или пароль" });
      }
      const session = createSession(db, row.id);
      return {
        ok: true,
        token: session.token,
        expiresAt: session.expiresAt,
        customer: {
          id: row.id,
          phone,
          phoneDisplay: formatPhoneDisplay(phone),
          name: row.name,
        },
      };
    }
  );

  app.post("/api/customer/logout", async (req) => {
    const token = bearer(req);
    if (token) db.prepare("DELETE FROM customer_sessions WHERE token = ?").run(token);
    return { ok: true };
  });

  app.get("/api/customer/me", async (req) => {
    const c = requireCustomer(db, req);
    return {
      id: c.customerId,
      phone: c.phone,
      phoneDisplay: formatPhoneDisplay(c.phone),
      name: c.name,
      tariffs: listCustomerTariffsForMe(db, c.customerId),
    };
  });

  app.put<{ Body: { name?: string | null } }>("/api/customer/me", async (req, reply) => {
    const c = requireCustomer(db, req);
    if (!("name" in (req.body ?? {}))) {
      return reply.code(400).send({ error: "Укажите name" });
    }
    const raw = req.body?.name;
    const name =
      raw == null || String(raw).trim() === "" ? null : String(raw).trim().slice(0, 80);
    const now = new Date().toISOString();
    db.prepare("UPDATE customer_accounts SET name = ?, updated_at = ? WHERE id = ?").run(
      name,
      now,
      c.customerId
    );
    enqueueCustomerUpsert(db, c.customerId);
    return {
      id: c.customerId,
      phone: c.phone,
      phoneDisplay: formatPhoneDisplay(c.phone),
      name,
      tariffs: listCustomerTariffsForMe(db, c.customerId),
    };
  });

  app.get("/api/customer/catalog", async (req) => {
    requireCustomer(db, req);
    const snap = getCatalogSnapshot(db);
    return {
      ...snap,
      services: (snap.services ?? []).filter(
        (s) => s.active !== false && s.visibleInPwa !== false
      ),
    };
  });

  app.get("/api/customer/vehicles", async (req) => {
    const c = requireCustomer(db, req);
    return { vehicles: listVehicles(db, c.customerId) };
  });

  app.post<{
    Body: {
      plateNumber?: string;
      classId?: string;
      nickname?: string | null;
      isDefault?: boolean;
    };
  }>("/api/customer/vehicles", async (req, reply) => {
    const c = requireCustomer(db, req);
    const plate = parseRfPlate(req.body.plateNumber ?? "");
    if (!plate) {
      return reply.code(400).send({ error: "Некорректный госномер (пример А170РТ90)" });
    }
    const classId = (req.body.classId ?? "").trim();
    if (!classId || !classExistsInCatalog(db, classId)) {
      return reply.code(400).send({ error: "Выберите класс автомобиля" });
    }
    const nickname =
      req.body.nickname == null || String(req.body.nickname).trim() === ""
        ? null
        : String(req.body.nickname).trim().slice(0, 40);

    const existing = db
      .prepare("SELECT id FROM vehicles WHERE customer_id = ? AND plate_number = ?")
      .get(c.customerId, plate);
    if (existing) return reply.code(409).send({ error: "Такой номер уже в гараже" });

    const count = (
      db.prepare("SELECT COUNT(*) AS n FROM vehicles WHERE customer_id = ?").get(c.customerId) as {
        n: number;
      }
    ).n;
    const makeDefault = req.body.isDefault === true || count === 0;

    const id = nanoid();
    const now = new Date().toISOString();
    if (makeDefault) clearDefaults(db, c.customerId);

    db.prepare(
      `INSERT INTO vehicles
       (id, customer_id, plate_number, class_id, nickname, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, c.customerId, plate, classId, nickname, makeDefault ? 1 : 0, now, now);

    enqueueCustomerUpsert(db, c.customerId);
    return mapVehicle(getVehicle(db, c.customerId, id)!);
  });

  app.put<{
    Params: { id: string };
    Body: {
      plateNumber?: string;
      classId?: string;
      nickname?: string | null;
      isDefault?: boolean;
    };
  }>("/api/customer/vehicles/:id", async (req, reply) => {
    const c = requireCustomer(db, req);
    const row = getVehicle(db, c.customerId, req.params.id);
    if (!row) return reply.code(404).send({ error: "Авто не найдено" });

    let plate = row.plate_number;
    if (req.body.plateNumber != null) {
      const parsed = parseRfPlate(req.body.plateNumber);
      if (!parsed) {
        return reply.code(400).send({ error: "Некорректный госномер (пример А170РТ90)" });
      }
      plate = parsed;
    }

    let classId = row.class_id;
    if (req.body.classId != null) {
      classId = String(req.body.classId).trim();
      if (!classId || !classExistsInCatalog(db, classId)) {
        return reply.code(400).send({ error: "Выберите класс автомобиля" });
      }
    }

    let nickname = row.nickname;
    if ("nickname" in (req.body ?? {})) {
      nickname =
        req.body.nickname == null || String(req.body.nickname).trim() === ""
          ? null
          : String(req.body.nickname).trim().slice(0, 40);
    }

    const dup = db
      .prepare(
        "SELECT id FROM vehicles WHERE customer_id = ? AND plate_number = ? AND id != ?"
      )
      .get(c.customerId, plate, row.id);
    if (dup) return reply.code(409).send({ error: "Такой номер уже в гараже" });

    const makeDefault = req.body.isDefault === true;
    const now = new Date().toISOString();
    if (makeDefault) clearDefaults(db, c.customerId);

    db.prepare(
      `UPDATE vehicles
       SET plate_number = ?, class_id = ?, nickname = ?,
           is_default = CASE WHEN ? THEN 1 ELSE is_default END,
           updated_at = ?
       WHERE id = ? AND customer_id = ?`
    ).run(plate, classId, nickname, makeDefault ? 1 : 0, now, row.id, c.customerId);

    ensureOneDefault(db, c.customerId);
    enqueueCustomerUpsert(db, c.customerId);
    return mapVehicle(getVehicle(db, c.customerId, row.id)!);
  });

  app.delete<{ Params: { id: string } }>("/api/customer/vehicles/:id", async (req, reply) => {
    const c = requireCustomer(db, req);
    const row = getVehicle(db, c.customerId, req.params.id);
    if (!row) return reply.code(404).send({ error: "Авто не найдено" });
    db.prepare("DELETE FROM vehicles WHERE id = ? AND customer_id = ?").run(
      row.id,
      c.customerId
    );
    ensureOneDefault(db, c.customerId);
    enqueueCustomerUpsert(db, c.customerId);
    return { ok: true };
  });
}

export { PRIVACY_VERSION };
