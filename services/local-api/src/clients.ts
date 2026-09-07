import { nanoid } from "nanoid";
import { db } from "./db.js";

export type ClientDto = {
  id: string;
  phone: string | null;
  plateNumber: string | null;
  name: string | null;
  points: number;
  tier: string;
  personalDiscountPercent: number;
  visitCount: number;
  lastVisitAt: string | null;
};

export type AnprEventDto = {
  id: string;
  plate: string;
  plateNormalized: string;
  confidence: number | null;
  snapshotUrl: string | null;
  source: string;
  createdAt: string;
  client: ClientDto | null;
};

/** Нормализация госномера РФ: без пробелов/дефисов, upper. */
export function normalizePlate(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/[A-Z]/g, (ch) => {
      const map: Record<string, string> = {
        A: "А",
        B: "В",
        E: "Е",
        K: "К",
        M: "М",
        H: "Н",
        O: "О",
        P: "Р",
        C: "С",
        T: "Т",
        Y: "У",
        X: "Х",
      };
      return map[ch] ?? ch;
    });
}

export function ensureClientTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plate_events (
      id TEXT PRIMARY KEY,
      plate_raw TEXT NOT NULL,
      plate_normalized TEXT NOT NULL,
      confidence REAL,
      snapshot_url TEXT,
      source TEXT NOT NULL DEFAULT 'camera',
      created_at TEXT NOT NULL
    );
  `);
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_clients_plate ON clients(plate_number)");
  } catch {
    /* ignore */
  }
  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_plate_events_created ON plate_events(created_at DESC)"
    );
  } catch {
    /* ignore */
  }
}

function visitStats(clientId: string): { visitCount: number; lastVisitAt: string | null } {
  const row = db
    .prepare(
      `SELECT COUNT(*) as c, MAX(paid_at) as last_at
       FROM orders WHERE client_id = ? AND status = 'paid'`
    )
    .get(clientId) as { c: number; last_at: string | null };
  return { visitCount: row.c, lastVisitAt: row.last_at };
}

export function mapClient(row: {
  id: string;
  phone: string | null;
  plate_number: string | null;
  name: string | null;
}): ClientDto {
  const loyalty = db
    .prepare(
      "SELECT points, tier, personal_discount_percent FROM loyalty_accounts WHERE client_id = ?"
    )
    .get(row.id) as
    | { points: number; tier: string; personal_discount_percent: number }
    | undefined;
  const visits = visitStats(row.id);
  return {
    id: row.id,
    phone: row.phone,
    plateNumber: row.plate_number,
    name: row.name,
    points: loyalty?.points ?? 0,
    tier: loyalty?.tier ?? "standard",
    personalDiscountPercent: loyalty?.personal_discount_percent ?? 0,
    visitCount: visits.visitCount,
    lastVisitAt: visits.lastVisitAt,
  };
}

export function findClientByPlate(plateRaw: string): ClientDto | null {
  const plate = normalizePlate(plateRaw);
  if (!plate) return null;
  const row = db
    .prepare("SELECT id, phone, plate_number, name FROM clients WHERE plate_number = ?")
    .get(plate) as
    | { id: string; phone: string | null; plate_number: string | null; name: string | null }
    | undefined;
  return row ? mapClient(row) : null;
}

export function findClientById(id: string): ClientDto | null {
  const row = db
    .prepare("SELECT id, phone, plate_number, name FROM clients WHERE id = ?")
    .get(id) as
    | { id: string; phone: string | null; plate_number: string | null; name: string | null }
    | undefined;
  return row ? mapClient(row) : null;
}

/** Поиск по телефону или госномеру (частичное совпадение). */
export function searchClients(queryRaw: string, limit = 20): ClientDto[] {
  const q = queryRaw.trim();
  if (!q) return listClients(limit);

  const plate = normalizePlate(q);
  const digits = q.replace(/\D/g, "");
  const phoneLike = digits.length >= 3 ? `%${digits}%` : null;
  const plateLike = plate.length >= 2 ? `%${plate}%` : null;
  const nameLike = `%${q}%`;

  const rows = db
    .prepare(
      `SELECT id, phone, plate_number, name FROM clients
       WHERE
         (? IS NOT NULL AND replace(replace(replace(coalesce(phone,''),'+',''),' ',''),'-','') LIKE ?)
         OR (? IS NOT NULL AND plate_number LIKE ?)
         OR (name IS NOT NULL AND name LIKE ?)
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(
      phoneLike,
      phoneLike,
      plateLike,
      plateLike,
      nameLike,
      limit
    ) as { id: string; phone: string | null; plate_number: string | null; name: string | null }[];

  return rows.map(mapClient);
}

export function listClients(limit = 100): ClientDto[] {
  const rows = db
    .prepare(
      `SELECT id, phone, plate_number, name FROM clients
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(limit) as {
    id: string;
    phone: string | null;
    plate_number: string | null;
    name: string | null;
  }[];
  return rows.map(mapClient);
}

export function deleteClient(id: string): boolean {
  const existing = findClientById(id);
  if (!existing) return false;
  db.prepare("UPDATE orders SET client_id = NULL WHERE client_id = ?").run(id);
  db.prepare("DELETE FROM loyalty_accounts WHERE client_id = ?").run(id);
  db.prepare("DELETE FROM clients WHERE id = ?").run(id);
  return true;
}

export function upsertClient(input: {
  plate?: string;
  phone?: string;
  name?: string;
  id?: string;
}): ClientDto {
  const now = new Date().toISOString();
  const plate = input.plate ? normalizePlate(input.plate) : null;

  if (input.id) {
    const existing = findClientById(input.id);
    if (!existing) throw new Error("Клиент не найден");
    db.prepare(
      `UPDATE clients SET phone = ?, plate_number = ?, name = ?, updated_at = ? WHERE id = ?`
    ).run(
      input.phone ?? existing.phone,
      plate ?? existing.plateNumber,
      input.name ?? existing.name,
      now,
      input.id
    );
    return findClientById(input.id)!;
  }

  if (plate) {
    const byPlate = findClientByPlate(plate);
    if (byPlate) {
      db.prepare(
        `UPDATE clients SET phone = COALESCE(?, phone), name = COALESCE(?, name), updated_at = ? WHERE id = ?`
      ).run(input.phone ?? null, input.name ?? null, now, byPlate.id);
      return findClientById(byPlate.id)!;
    }
  }

  const id = nanoid();
  db.prepare(
    `INSERT INTO clients (id, phone, plate_number, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.phone ?? null, plate, input.name ?? null, now, now);
  db.prepare(
    `INSERT INTO loyalty_accounts (client_id, points, tier, personal_discount_percent) VALUES (?, 0, 'standard', 0)`
  ).run(id);
  return findClientById(id)!;
}

export function recordAnprEvent(input: {
  plate: string;
  confidence?: number;
  snapshotUrl?: string;
  source?: string;
}): AnprEventDto {
  const plateNormalized = normalizePlate(input.plate);
  if (!plateNormalized) throw new Error("Пустой госномер");

  const id = nanoid();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO plate_events (id, plate_raw, plate_normalized, confidence, snapshot_url, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.plate.trim(),
    plateNormalized,
    input.confidence ?? null,
    input.snapshotUrl ?? null,
    input.source ?? "camera",
    createdAt
  );

  // Автосоздание карточки «незнакомый номер», чтобы касса сразу видела номер
  let client = findClientByPlate(plateNormalized);
  if (!client) {
    client = upsertClient({ plate: plateNormalized });
  }

  return {
    id,
    plate: input.plate.trim(),
    plateNormalized,
    confidence: input.confidence ?? null,
    snapshotUrl: input.snapshotUrl ?? null,
    source: input.source ?? "camera",
    createdAt,
    client,
  };
}

export function latestAnprEvent(): AnprEventDto | null {
  const row = db
    .prepare(
      `SELECT id, plate_raw, plate_normalized, confidence, snapshot_url, source, created_at
       FROM plate_events ORDER BY created_at DESC LIMIT 1`
    )
    .get() as
    | {
        id: string;
        plate_raw: string;
        plate_normalized: string;
        confidence: number | null;
        snapshot_url: string | null;
        source: string;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    plate: row.plate_raw,
    plateNormalized: row.plate_normalized,
    confidence: row.confidence,
    snapshotUrl: row.snapshot_url,
    source: row.source,
    createdAt: row.created_at,
    client: findClientByPlate(row.plate_normalized),
  };
}

export function seedDemoClient() {
  const existing = findClientByPlate("А123ВС777");
  if (existing) return;
  const client = upsertClient({
    plate: "А123ВС777",
    phone: "+79001234567",
    name: "Иван Петров",
  });
  db.prepare(
    "UPDATE loyalty_accounts SET points = ?, tier = ?, personal_discount_percent = ? WHERE client_id = ?"
  ).run(120, "silver", 5, client.id);
}

export function attachClientToOrder(orderId: string, clientId: string | null) {
  const order = db.prepare("SELECT status FROM orders WHERE id = ?").get(orderId) as
    | { status: string }
    | undefined;
  if (!order) throw new Error("Заказ не найден");
  if (order.status !== "draft" && order.status !== "awaiting_payment") {
    throw new Error("Клиента можно привязать только к открытому заказу");
  }
  db.prepare("UPDATE orders SET client_id = ?, updated_at = ? WHERE id = ?").run(
    clientId,
    new Date().toISOString(),
    orderId
  );
}
