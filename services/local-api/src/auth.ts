import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { db, getSetting, setSetting } from "./db.js";

/** Сессия без авто-истечения — действует до «Смена PIN» / Выйти. */
const NEVER_EXPIRES = "9999-12-31T23:59:59.000Z";

export function createSession(kind: "washer" | "admin", washerId?: string) {
  const token = nanoid(32);
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO sessions (token, kind, washer_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).run(token, kind, washerId ?? null, now, NEVER_EXPIRES);
  return { token, expiresAt: NEVER_EXPIRES };
}

export function getSession(token: string | undefined) {
  if (!token) return null;
  const row = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token) as
    | {
        token: string;
        kind: string;
        washer_id: string | null;
        expires_at: string;
      }
    | undefined;
  return row ?? null;
}

export function deleteSession(token: string) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function loginWasher(pin: string) {
  const washers = db
    .prepare("SELECT id, name, pin_hash, active FROM washers WHERE active = 1")
    .all() as { id: string; name: string; pin_hash: string; active: number }[];
  for (const w of washers) {
    if (bcrypt.compareSync(pin, w.pin_hash)) {
      const session = createSession("washer", w.id);
      return { ok: true as const, washer: { id: w.id, name: w.name }, ...session };
    }
  }
  return { ok: false as const, error: "Неверный PIN" };
}

export function loginAdmin(code: string) {
  const hash = getSetting("master_code_hash");
  if (!hash || !bcrypt.compareSync(code, hash)) {
    return { ok: false as const, error: "Неверный мастер-код" };
  }
  const session = createSession("admin");
  return { ok: true as const, ...session };
}

export function changeMasterCode(current: string, next: string) {
  const hash = getSetting("master_code_hash");
  if (!hash || !bcrypt.compareSync(current, hash)) {
    return { ok: false as const, error: "Неверный текущий код" };
  }
  if (next.length < 4) {
    return { ok: false as const, error: "Код слишком короткий" };
  }
  setSetting("master_code_hash", bcrypt.hashSync(next, 10));
  return { ok: true as const };
}
