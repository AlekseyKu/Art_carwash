import { nanoid } from "nanoid";
import { db } from "./db.js";

export type ClientVehicleDto = {
  id: string;
  plateNumber: string;
  classId: string | null;
  nickname: string | null;
  isDefault: boolean;
};

export type ClientDto = {
  id: string;
  phone: string | null;
  /** Госномер по умолчанию (для совместимости). */
  plateNumber: string | null;
  name: string | null;
  points: number;
  tier: string;
  personalDiscountPercent: number;
  visitCount: number;
  lastVisitAt: string | null;
  vehicles: ClientVehicleDto[];
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

type ClientRow = {
  id: string;
  phone: string | null;
  plate_number: string | null;
  name: string | null;
};

type VehicleInput = {
  id?: string;
  plateNumber: string;
  classId?: string | null;
  nickname?: string | null;
  isDefault?: boolean;
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS client_vehicles (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      plate_number TEXT NOT NULL,
      class_id TEXT,
      nickname TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
  try {
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_client_vehicles_client_plate ON client_vehicles(client_id, plate_number)"
    );
  } catch {
    /* ignore */
  }
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_client_vehicles_plate ON client_vehicles(plate_number)");
  } catch {
    /* ignore */
  }

  // Миграция: один plate_number → client_vehicles
  const orphans = db
    .prepare(
      `SELECT id, plate_number FROM clients
       WHERE plate_number IS NOT NULL AND trim(plate_number) != ''
         AND NOT EXISTS (SELECT 1 FROM client_vehicles WHERE client_id = clients.id)`
    )
    .all() as { id: string; plate_number: string }[];
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO client_vehicles
      (id, client_id, plate_number, class_id, nickname, is_default, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, 1, ?, ?)`
  );
  for (const row of orphans) {
    const plate = normalizePlate(row.plate_number);
    if (!plate) continue;
    insert.run(nanoid(), row.id, plate, now, now);
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

function listVehiclesForClient(clientId: string): ClientVehicleDto[] {
  const rows = db
    .prepare(
      `SELECT id, plate_number, class_id, nickname, is_default
       FROM client_vehicles WHERE client_id = ?
       ORDER BY is_default DESC, created_at ASC`
    )
    .all(clientId) as {
    id: string;
    plate_number: string;
    class_id: string | null;
    nickname: string | null;
    is_default: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    plateNumber: r.plate_number,
    classId: r.class_id,
    nickname: r.nickname,
    isDefault: !!r.is_default,
  }));
}

function replaceClientVehicles(clientId: string, vehicles: VehicleInput[]): ClientVehicleDto[] {
  const now = new Date().toISOString();
  db.prepare("DELETE FROM client_vehicles WHERE client_id = ?").run(clientId);

  const normalized: {
    id: string;
    plate: string;
    classId: string | null;
    nickname: string | null;
    isDefault: boolean;
  }[] = [];
  const seenPlates = new Set<string>();
  for (const v of vehicles) {
    const plate = normalizePlate(v.plateNumber ?? "");
    if (!plate || seenPlates.has(plate)) continue;
    seenPlates.add(plate);
    normalized.push({
      id: v.id?.trim() || nanoid(),
      plate,
      classId: v.classId ?? null,
      nickname: v.nickname?.trim() || null,
      isDefault: Boolean(v.isDefault),
    });
  }

  if (normalized.length > 0 && !normalized.some((v) => v.isDefault)) {
    normalized[0].isDefault = true;
  } else if (normalized.length > 0) {
    let found = false;
    for (const v of normalized) {
      if (v.isDefault && !found) {
        found = true;
      } else {
        v.isDefault = false;
      }
    }
  }

  const insert = db.prepare(
    `INSERT INTO client_vehicles
      (id, client_id, plate_number, class_id, nickname, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const v of normalized) {
    insert.run(
      v.id,
      clientId,
      v.plate,
      v.classId,
      v.nickname,
      v.isDefault ? 1 : 0,
      now,
      now
    );
  }

  const defaultPlate = normalized.find((v) => v.isDefault)?.plate ?? normalized[0]?.plate ?? null;
  db.prepare("UPDATE clients SET plate_number = ?, updated_at = ? WHERE id = ?").run(
    defaultPlate,
    now,
    clientId
  );

  return listVehiclesForClient(clientId);
}

export function mapClient(row: ClientRow): ClientDto {
  const loyalty = db
    .prepare(
      "SELECT points, tier, personal_discount_percent FROM loyalty_accounts WHERE client_id = ?"
    )
    .get(row.id) as
    | { points: number; tier: string; personal_discount_percent: number }
    | undefined;
  const visits = visitStats(row.id);
  const vehicles = listVehiclesForClient(row.id);
  const defaultPlate =
    vehicles.find((v) => v.isDefault)?.plateNumber ??
    vehicles[0]?.plateNumber ??
    row.plate_number;
  return {
    id: row.id,
    phone: row.phone,
    plateNumber: defaultPlate,
    name: row.name,
    points: loyalty?.points ?? 0,
    tier: loyalty?.tier ?? "standard",
    personalDiscountPercent: loyalty?.personal_discount_percent ?? 0,
    visitCount: visits.visitCount,
    lastVisitAt: visits.lastVisitAt,
    vehicles,
  };
}

export function findClientByPlate(plateRaw: string): ClientDto | null {
  const plate = normalizePlate(plateRaw);
  if (!plate) return null;
  const byVehicle = db
    .prepare("SELECT client_id FROM client_vehicles WHERE plate_number = ? LIMIT 1")
    .get(plate) as { client_id: string } | undefined;
  if (byVehicle) return findClientById(byVehicle.client_id);

  const row = db
    .prepare("SELECT id, phone, plate_number, name FROM clients WHERE plate_number = ?")
    .get(plate) as ClientRow | undefined;
  return row ? mapClient(row) : null;
}

export function findClientById(id: string): ClientDto | null {
  const row = db
    .prepare("SELECT id, phone, plate_number, name FROM clients WHERE id = ?")
    .get(id) as ClientRow | undefined;
  return row ? mapClient(row) : null;
}

function findClientRowByPhone(phone: string): { id: string } | undefined {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return undefined;
  const last10 = digits.slice(-10);
  return db
    .prepare(
      `SELECT id FROM clients
       WHERE replace(replace(replace(coalesce(phone,''),'+',''),' ',''),'-','') LIKE ?`
    )
    .get(`%${last10}`) as { id: string } | undefined;
}

/** Применить customer.upsert из cloud (телефон, имя, все авто). */
export function upsertClientFromCloud(payload: {
  id: string;
  phone: string;
  name: string | null;
  vehicles?: VehicleInput[];
}): ClientDto {
  const now = new Date().toISOString();
  const vehicles = payload.vehicles ?? [];
  const preferred = vehicles.find((v) => v.isDefault) ?? vehicles[0];
  const plate = preferred?.plateNumber ? normalizePlate(preferred.plateNumber) : null;
  const phone = payload.phone || null;
  const name = payload.name;

  const apply = (id: string) => {
    const existing = findClientById(id)!;
    db.prepare(
      `UPDATE clients SET phone = ?, plate_number = ?, name = ?, updated_at = ? WHERE id = ?`
    ).run(phone, plate ?? existing.plateNumber, name, now, id);
    replaceClientVehicles(id, vehicles);
    return findClientById(id)!;
  };

  if (findClientById(payload.id)) return apply(payload.id);

  if (phone) {
    const byPhone = findClientRowByPhone(phone);
    if (byPhone) return apply(byPhone.id);
  }

  if (plate) {
    const byPlate = findClientByPlate(plate);
    if (byPlate) return apply(byPlate.id);
  }

  db.prepare(
    `INSERT INTO clients (id, phone, plate_number, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(payload.id, phone, plate, name, now, now);
  db.prepare(
    `INSERT INTO loyalty_accounts (client_id, points, tier, personal_discount_percent) VALUES (?, 0, 'standard', 0)`
  ).run(payload.id);
  replaceClientVehicles(payload.id, vehicles);
  return findClientById(payload.id)!;
}

/** Поиск по телефону или госномеру (частичное совпадение). */
export function searchClients(queryRaw: string, limit = 20): ClientDto[] {
  const q = queryRaw.trim();
  if (!q) return listClients(limit);

  const plate = normalizePlate(q);
  const digits = q.replace(/\D/g, "");
  const phoneLike = digits.length >= 3 ? `%${digits}%` : null;
  const plateLike = plate.length >= 2 ? `%${plate}%` : null;

  const contactRows = db
    .prepare(
      `SELECT DISTINCT c.id, c.phone, c.plate_number, c.name FROM clients c
       LEFT JOIN client_vehicles cv ON cv.client_id = c.id
       WHERE
         (? IS NOT NULL AND replace(replace(replace(coalesce(c.phone,''),'+',''),' ',''),'-','') LIKE ?)
         OR (? IS NOT NULL AND (
           c.plate_number LIKE ?
           OR cv.plate_number LIKE ?
         ))
       ORDER BY c.updated_at DESC
       LIMIT ?`
    )
    .all(phoneLike, phoneLike, plateLike, plateLike, plateLike, limit) as ClientRow[];

  const nameTokens = q
    .toLocaleLowerCase("ru-RU")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const byName: ClientDto[] = [];
  if (nameTokens.length > 0) {
    const candidates = db
      .prepare(
        `SELECT id, phone, plate_number, name FROM clients
         WHERE name IS NOT NULL AND length(trim(name)) > 0
         ORDER BY updated_at DESC
         LIMIT 500`
      )
      .all() as ClientRow[];

    for (const row of candidates) {
      const nameLc = (row.name ?? "").toLocaleLowerCase("ru-RU");
      if (nameTokens.every((token) => nameLc.includes(token))) {
        byName.push(mapClient(row));
      }
    }
  }

  const seen = new Set<string>();
  const out: ClientDto[] = [];
  for (const client of [...contactRows.map(mapClient), ...byName]) {
    if (seen.has(client.id)) continue;
    seen.add(client.id);
    out.push(client);
    if (out.length >= limit) break;
  }
  return out;
}

export function listClients(limit = 100): ClientDto[] {
  const rows = db
    .prepare(
      `SELECT id, phone, plate_number, name FROM clients
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(limit) as ClientRow[];
  return rows.map(mapClient);
}

export function deleteClient(id: string): boolean {
  const existing = findClientById(id);
  if (!existing) return false;
  db.prepare("UPDATE orders SET client_id = NULL WHERE client_id = ?").run(id);
  db.prepare("DELETE FROM client_vehicles WHERE client_id = ?").run(id);
  db.prepare("DELETE FROM loyalty_accounts WHERE client_id = ?").run(id);
  db.prepare("DELETE FROM clients WHERE id = ?").run(id);
  return true;
}

export function upsertClient(input: {
  plate?: string;
  phone?: string;
  name?: string;
  id?: string;
  vehicles?: VehicleInput[];
}): ClientDto {
  const now = new Date().toISOString();
  const plate = input.plate ? normalizePlate(input.plate) : null;
  const vehiclesInput =
    input.vehicles && input.vehicles.length > 0
      ? input.vehicles
      : plate
        ? [{ plateNumber: plate, isDefault: true }]
        : null;

  if (input.id) {
    const existing = findClientById(input.id);
    if (!existing) throw new Error("Клиент не найден");
    const nextPlate =
      vehiclesInput && vehiclesInput.length > 0
        ? normalizePlate(
            (vehiclesInput.find((v) => v.isDefault) ?? vehiclesInput[0]).plateNumber
          ) || existing.plateNumber
        : (plate ?? existing.plateNumber);
    db.prepare(
      `UPDATE clients SET phone = ?, plate_number = ?, name = ?, updated_at = ? WHERE id = ?`
    ).run(
      input.phone ?? existing.phone,
      nextPlate,
      input.name ?? existing.name,
      now,
      input.id
    );
    if (vehiclesInput) replaceClientVehicles(input.id, vehiclesInput);
    else if (plate && existing.vehicles.length === 0) {
      replaceClientVehicles(input.id, [{ plateNumber: plate, isDefault: true }]);
    } else if (plate && existing.vehicles.length > 0) {
      // обновить default plate в списке, если прислали только plate
      const next = existing.vehicles.map((v) =>
        v.isDefault ? { ...v, plateNumber: plate } : v
      );
      replaceClientVehicles(input.id, next);
    }
    return findClientById(input.id)!;
  }

  if (plate) {
    const byPlate = findClientByPlate(plate);
    if (byPlate) {
      db.prepare(
        `UPDATE clients SET phone = COALESCE(?, phone), name = COALESCE(?, name), updated_at = ? WHERE id = ?`
      ).run(input.phone ?? null, input.name ?? null, now, byPlate.id);
      if (vehiclesInput) replaceClientVehicles(byPlate.id, vehiclesInput);
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
  if (vehiclesInput) replaceClientVehicles(id, vehiclesInput);
  else if (plate) replaceClientVehicles(id, [{ plateNumber: plate, isDefault: true }]);
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
