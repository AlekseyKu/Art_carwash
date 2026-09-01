import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import type { DatabaseSync } from "node:sqlite";
import { getCatalogSnapshot } from "./catalog.js";
import { formatPhoneDisplay, normalizePhone } from "./phone.js";

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
    };
  });

  app.get("/api/customer/catalog", async (req) => {
    requireCustomer(db, req);
    return getCatalogSnapshot(db);
  });
}

export { PRIVACY_VERSION };
