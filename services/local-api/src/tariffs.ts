import { nanoid } from "nanoid";
import { db, isClassPricedTabId } from "./db.js";
import { enqueueOutbox } from "./outbox.js";
import { mskDateString } from "./time.js";

export type TariffPriceInput = {
  serviceId: string;
  classId: string;
  priceKopecks: number;
};

export type TariffDto = {
  id: string;
  name: string;
  validFrom: string;
  validTo: string | null;
  active: boolean;
  priceCount: number;
  clientCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TariffDetailDto = TariffDto & {
  prices: TariffPriceInput[];
  clientIds: string[];
};

function parseDateYmd(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function validatePeriod(validFrom: string, validTo: string | null) {
  if (validTo && validTo < validFrom) {
    throw new Error("Дата окончания не может быть раньше начала");
  }
}

export function ensureTariffTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tariffs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      valid_from TEXT NOT NULL,
      valid_to TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tariff_prices (
      tariff_id TEXT NOT NULL REFERENCES tariffs(id) ON DELETE CASCADE,
      service_id TEXT NOT NULL,
      class_id TEXT NOT NULL,
      price_kopecks INTEGER NOT NULL,
      PRIMARY KEY (tariff_id, service_id, class_id)
    );

    CREATE TABLE IF NOT EXISTS client_tariffs (
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      tariff_id TEXT NOT NULL REFERENCES tariffs(id) ON DELETE CASCADE,
      PRIMARY KEY (client_id, tariff_id)
    );
  `);
  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_tariff_prices_lookup ON tariff_prices(service_id, class_id)"
    );
  } catch {
    /* ignore */
  }
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_client_tariffs_client ON client_tariffs(client_id)");
  } catch {
    /* ignore */
  }
}

/** Мин. оверрайд из активных тарифов клиента на сегодня (MSK); null = нет. */
export function resolveTariffPrice(
  clientId: string | null | undefined,
  serviceId: string,
  classId: string | null | undefined
): number | null {
  if (!clientId || !classId) return null;
  const today = mskDateString();
  const row = db
    .prepare(
      `SELECT MIN(tp.price_kopecks) AS price
       FROM client_tariffs ct
       JOIN tariffs t ON t.id = ct.tariff_id
       JOIN tariff_prices tp ON tp.tariff_id = t.id
       WHERE ct.client_id = ?
         AND t.active = 1
         AND t.valid_from <= ?
         AND (t.valid_to IS NULL OR t.valid_to >= ?)
         AND tp.service_id = ?
         AND tp.class_id = ?`
    )
    .get(clientId, today, today, serviceId, classId) as { price: number | null } | undefined;
  if (row?.price == null) return null;
  return Number(row.price);
}

function mapListRow(row: {
  id: string;
  name: string;
  valid_from: string;
  valid_to: string | null;
  active: number;
  created_at: string;
  updated_at: string;
  price_count: number;
  client_count: number;
}): TariffDto {
  return {
    id: row.id,
    name: row.name,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    active: !!row.active,
    priceCount: row.price_count,
    clientCount: row.client_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTariffs(): TariffDto[] {
  const rows = db
    .prepare(
      `SELECT t.*,
         (SELECT COUNT(*) FROM tariff_prices tp WHERE tp.tariff_id = t.id) AS price_count,
         (SELECT COUNT(*) FROM client_tariffs ct WHERE ct.tariff_id = t.id) AS client_count
       FROM tariffs t
       ORDER BY t.name COLLATE NOCASE`
    )
    .all() as {
    id: string;
    name: string;
    valid_from: string;
    valid_to: string | null;
    active: number;
    created_at: string;
    updated_at: string;
    price_count: number;
    client_count: number;
  }[];
  return rows.map(mapListRow);
}

export function getTariff(id: string): TariffDetailDto | null {
  const row = db
    .prepare(
      `SELECT t.*,
         (SELECT COUNT(*) FROM tariff_prices tp WHERE tp.tariff_id = t.id) AS price_count,
         (SELECT COUNT(*) FROM client_tariffs ct WHERE ct.tariff_id = t.id) AS client_count
       FROM tariffs t WHERE t.id = ?`
    )
    .get(id) as
    | {
        id: string;
        name: string;
        valid_from: string;
        valid_to: string | null;
        active: number;
        created_at: string;
        updated_at: string;
        price_count: number;
        client_count: number;
      }
    | undefined;
  if (!row) return null;

  const prices = (
    db
      .prepare(
        "SELECT service_id, class_id, price_kopecks FROM tariff_prices WHERE tariff_id = ?"
      )
      .all(id) as { service_id: string; class_id: string; price_kopecks: number }[]
  ).map((p) => ({
    serviceId: p.service_id,
    classId: p.class_id,
    priceKopecks: p.price_kopecks,
  }));

  const clientIds = (
    db.prepare("SELECT client_id FROM client_tariffs WHERE tariff_id = ?").all(id) as {
      client_id: string;
    }[]
  ).map((r) => r.client_id);

  return { ...mapListRow(row), prices, clientIds };
}

function replaceTariffPrices(tariffId: string, prices: TariffPriceInput[]) {
  db.prepare("DELETE FROM tariff_prices WHERE tariff_id = ?").run(tariffId);
  const insert = db.prepare(
    `INSERT INTO tariff_prices (tariff_id, service_id, class_id, price_kopecks)
     VALUES (?, ?, ?, ?)`
  );
  for (const p of prices) {
    const serviceId = String(p.serviceId ?? "").trim();
    const classId = String(p.classId ?? "").trim();
    if (!serviceId || !classId) continue;
    const svc = db
      .prepare("SELECT id, tab_id FROM services WHERE id = ?")
      .get(serviceId) as { id: string; tab_id: string | null } | undefined;
    if (!svc || !isClassPricedTabId(svc.tab_id)) continue;
    const price = Math.max(0, Math.round(Number(p.priceKopecks) || 0));
    insert.run(tariffId, serviceId, classId, price);
  }
}

function replaceTariffClients(tariffId: string, clientIds: string[]) {
  const prevClients = (
    db.prepare("SELECT client_id FROM client_tariffs WHERE tariff_id = ?").all(tariffId) as {
      client_id: string;
    }[]
  ).map((r) => r.client_id);

  db.prepare("DELETE FROM client_tariffs WHERE tariff_id = ?").run(tariffId);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO client_tariffs (client_id, tariff_id) VALUES (?, ?)"
  );
  const next = new Set<string>();
  for (const raw of clientIds) {
    const clientId = String(raw ?? "").trim();
    if (!clientId) continue;
    const exists = db.prepare("SELECT id FROM clients WHERE id = ?").get(clientId);
    if (!exists) continue;
    insert.run(clientId, tariffId);
    next.add(clientId);
  }

  for (const id of new Set([...prevClients, ...next])) {
    enqueueClientTariffsSync(id);
  }
}

export function createTariff(input: {
  name: string;
  validFrom: string;
  validTo?: string | null;
  active?: boolean;
  prices?: TariffPriceInput[];
  clientIds?: string[];
}): TariffDetailDto {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Укажите название тарифа");
  const validFrom = parseDateYmd(input.validFrom);
  if (!validFrom) throw new Error("Некорректная дата начала (YYYY-MM-DD)");
  const validToRaw =
    input.validTo == null || String(input.validTo).trim() === ""
      ? null
      : parseDateYmd(input.validTo);
  if (input.validTo != null && String(input.validTo).trim() !== "" && !validToRaw) {
    throw new Error("Некорректная дата окончания (YYYY-MM-DD)");
  }
  validatePeriod(validFrom, validToRaw);

  const id = nanoid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tariffs (id, name, valid_from, valid_to, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, validFrom, validToRaw, input.active === false ? 0 : 1, now, now);

  replaceTariffPrices(id, input.prices ?? []);
  replaceTariffClients(id, input.clientIds ?? []);
  return getTariff(id)!;
}

export function updateTariff(
  id: string,
  input: {
    name: string;
    validFrom: string;
    validTo?: string | null;
    active: boolean;
    prices?: TariffPriceInput[];
    clientIds?: string[];
  }
): TariffDetailDto {
  const existing = getTariff(id);
  if (!existing) throw new Error("Тариф не найден");

  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("Укажите название тарифа");
  const validFrom = parseDateYmd(input.validFrom);
  if (!validFrom) throw new Error("Некорректная дата начала (YYYY-MM-DD)");
  const validToRaw =
    input.validTo == null || String(input.validTo).trim() === ""
      ? null
      : parseDateYmd(input.validTo);
  if (input.validTo != null && String(input.validTo).trim() !== "" && !validToRaw) {
    throw new Error("Некорректная дата окончания (YYYY-MM-DD)");
  }
  validatePeriod(validFrom, validToRaw);

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE tariffs SET name = ?, valid_from = ?, valid_to = ?, active = ?, updated_at = ?
     WHERE id = ?`
  ).run(name, validFrom, validToRaw, input.active ? 1 : 0, now, id);

  if (input.prices) replaceTariffPrices(id, input.prices);
  if (input.clientIds) replaceTariffClients(id, input.clientIds);
  return getTariff(id)!;
}

export function deleteTariff(id: string): boolean {
  const clientIds = (
    db.prepare("SELECT client_id FROM client_tariffs WHERE tariff_id = ?").all(id) as {
      client_id: string;
    }[]
  ).map((r) => r.client_id);
  db.prepare("DELETE FROM tariff_prices WHERE tariff_id = ?").run(id);
  db.prepare("DELETE FROM client_tariffs WHERE tariff_id = ?").run(id);
  const result = db.prepare("DELETE FROM tariffs WHERE id = ?").run(id);
  if (result.changes === 0) return false;
  for (const clientId of clientIds) enqueueClientTariffsSync(clientId);
  return true;
}

export function listClientTariffIds(clientId: string): string[] {
  return (
    db.prepare("SELECT tariff_id FROM client_tariffs WHERE client_id = ?").all(clientId) as {
      tariff_id: string;
    }[]
  ).map((r) => r.tariff_id);
}

export function setClientTariffIds(clientId: string, tariffIds: string[]) {
  const exists = db.prepare("SELECT id FROM clients WHERE id = ?").get(clientId);
  if (!exists) throw new Error("Клиент не найден");

  db.prepare("DELETE FROM client_tariffs WHERE client_id = ?").run(clientId);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO client_tariffs (client_id, tariff_id) VALUES (?, ?)"
  );
  for (const raw of tariffIds) {
    const tariffId = String(raw ?? "").trim();
    if (!tariffId) continue;
    const t = db.prepare("SELECT id FROM tariffs WHERE id = ?").get(tariffId);
    if (!t) continue;
    insert.run(clientId, tariffId);
  }
  enqueueClientTariffsSync(clientId);
}

/** Активные в периоде тарифы клиента (для бейджа на кассе). */
export function listActiveClientTariffNames(clientId: string): string[] {
  const today = mskDateString();
  return (
    db
      .prepare(
        `SELECT t.name FROM client_tariffs ct
         JOIN tariffs t ON t.id = ct.tariff_id
         WHERE ct.client_id = ?
           AND t.active = 1
           AND t.valid_from <= ?
           AND (t.valid_to IS NULL OR t.valid_to >= ?)
         ORDER BY t.name COLLATE NOCASE`
      )
      .all(clientId, today, today) as { name: string }[]
  ).map((r) => r.name);
}

export function buildTariffsSnapshotPayload(): {
  id: string;
  name: string;
  validFrom: string;
  validTo: string | null;
  active: boolean;
  prices: { serviceId: string; classId: string; priceKopecks: number }[];
}[] {
  return listTariffs().map((t) => {
    const detail = getTariff(t.id)!;
    return {
      id: detail.id,
      name: detail.name,
      validFrom: detail.validFrom,
      validTo: detail.validTo,
      active: detail.active,
      prices: detail.prices,
    };
  });
}

function enqueueClientTariffsSync(clientId: string) {
  const row = db
    .prepare("SELECT phone FROM clients WHERE id = ?")
    .get(clientId) as { phone: string | null } | undefined;
  const phone = row?.phone?.trim();
  if (!phone) return;
  enqueueOutbox("client.tariffs", {
    phone,
    tariffIds: listClientTariffIds(clientId),
  });
}
