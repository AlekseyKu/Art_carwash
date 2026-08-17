import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.ART_DATA_DIR ?? path.join(__dirname, "../../../data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "local.db");
/** timeout помогает при hot-reload tsx: старый процесс ещё держит файл */
export const db = new DatabaseSync(dbPath, { timeout: 10_000 });
db.exec("PRAGMA busy_timeout = 10000");
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

function tableColumns(table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

/** Вкладки кассы: Услуги / Товары (+ можно добавить новые). */
export const TAB_SLUG_SERVICES = "services";
export const TAB_SLUG_EXTRA_SERVICES = "extra-services";
export const TAB_SLUG_PRODUCTS = "products";

/** Вкладки, где цена берётся из service_prices по классу авто. */
export const CLASS_PRICED_TAB_SLUGS = [TAB_SLUG_SERVICES, TAB_SLUG_EXTRA_SERVICES] as const;

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS washers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS catalog_tabs (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_kopecks INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      tab_id TEXT
    );

    CREATE TABLE IF NOT EXISTS discounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      value INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      phone TEXT,
      plate_number TEXT,
      name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loyalty_accounts (
      client_id TEXT PRIMARY KEY REFERENCES clients(id),
      points INTEGER NOT NULL DEFAULT 0,
      tier TEXT NOT NULL DEFAULT 'standard',
      personal_discount_percent INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      number INTEGER NOT NULL,
      post_id INTEGER NOT NULL,
      washer_id TEXT NOT NULL,
      client_id TEXT,
      discount_id TEXT,
      status TEXT NOT NULL,
      payment_method TEXT,
      subtotal_kopecks INTEGER NOT NULL DEFAULT 0,
      discount_kopecks INTEGER NOT NULL DEFAULT 0,
      total_kopecks INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      paid_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      service_id TEXT NOT NULL,
      name_snapshot TEXT NOT NULL,
      price_kopecks INTEGER NOT NULL,
      qty INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      washer_id TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      opened_by_washer_id TEXT,
      closed_by_washer_id TEXT,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS vehicle_classes (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon_key TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS service_prices (
      service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      class_id TEXT NOT NULL REFERENCES vehicle_classes(id) ON DELETE CASCADE,
      price_kopecks INTEGER NOT NULL,
      PRIMARY KEY (service_id, class_id)
    );
  `);

  // Существующие БД без tab_id / description — данные не трогаем
  if (!tableColumns("services").has("tab_id")) {
    db.exec("ALTER TABLE services ADD COLUMN tab_id TEXT");
  }
  if (!tableColumns("services").has("description")) {
    db.exec("ALTER TABLE services ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }
  if (!tableColumns("services").has("coefficient_enabled")) {
    db.exec("ALTER TABLE services ADD COLUMN coefficient_enabled INTEGER NOT NULL DEFAULT 0");
  }
  if (!tableColumns("services").has("coefficient_step_kopecks")) {
    db.exec(
      "ALTER TABLE services ADD COLUMN coefficient_step_kopecks INTEGER NOT NULL DEFAULT 5000"
    );
  }

  const orderCols = tableColumns("orders");
  if (!orderCols.has("shift_id")) {
    db.exec("ALTER TABLE orders ADD COLUMN shift_id TEXT");
  }
  if (!orderCols.has("vehicle_class_id")) {
    db.exec("ALTER TABLE orders ADD COLUMN vehicle_class_id TEXT");
  }
  if (!orderCols.has("vehicle_class_name")) {
    db.exec("ALTER TABLE orders ADD COLUMN vehicle_class_name TEXT");
  }

  const itemCols = tableColumns("order_items");
  if (!itemCols.has("is_manual")) {
    db.exec("ALTER TABLE order_items ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0");
  }
  if (!itemCols.has("base_price_kopecks")) {
    db.exec("ALTER TABLE order_items ADD COLUMN base_price_kopecks INTEGER");
  }
  if (!itemCols.has("coefficient_extra_kopecks")) {
    db.exec(
      "ALTER TABLE order_items ADD COLUMN coefficient_extra_kopecks INTEGER NOT NULL DEFAULT 0"
    );
  }
  // Ручные позиции: service_id может быть пустым (SQLite NOT NULL уже стоит — пишем '')
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_washers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      salary_percent INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS order_staff_washers (
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      staff_washer_id TEXT NOT NULL REFERENCES staff_washers(id) ON DELETE CASCADE,
      PRIMARY KEY (order_id, staff_washer_id)
    );
  `);

  // Заполнить base_price из price, если ещё пусто
  db.exec(
    `UPDATE order_items SET base_price_kopecks = price_kopecks
     WHERE base_price_kopecks IS NULL`
  );

  ensureDefaultCatalogTabs();
  ensureVehicleClassesAndPrices();
}

export type VehicleClassRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon_key: string;
  sort_order: number;
  active: number;
};

const DEFAULT_VEHICLE_CLASS_SLUG = "sedan";

const DEFAULT_VEHICLE_CLASSES: {
  slug: string;
  name: string;
  description: string;
  icon_key: string;
  sort_order: number;
}[] = [
  {
    slug: "small",
    name: "Маленькие",
    description: "Daewoo Matiz и т.п.",
    icon_key: "small",
    sort_order: 1,
  },
  {
    slug: "sedan",
    name: "Легковые",
    description: "Лада Гранта, Ford Focus, Audi A4 и т.п.",
    icon_key: "sedan",
    sort_order: 2,
  },
  {
    slug: "crossover",
    name: "Паркетники",
    description: "Toyota RAV4, Haval Jolion, Kia Sportage и т.п.",
    icon_key: "crossover",
    sort_order: 3,
  },
  {
    slug: "suv",
    name: "Джипы",
    description: "Toyota Land Cruiser, Mercedes G-Class, Land Rover Defender и т.п.",
    icon_key: "suv",
    sort_order: 4,
  },
  {
    slug: "bus",
    name: "Автобусы",
    description: "Mercedes-Benz, Iveco, Ford Transit и т.п.",
    icon_key: "bus",
    sort_order: 5,
  },
];

export function getVehicleClassBySlug(slug: string): VehicleClassRow | null {
  const row = db
    .prepare("SELECT * FROM vehicle_classes WHERE slug = ?")
    .get(slug) as VehicleClassRow | undefined;
  return row ?? null;
}

export function getDefaultVehicleClass(): VehicleClassRow {
  const row = getVehicleClassBySlug(DEFAULT_VEHICLE_CLASS_SLUG);
  if (!row) throw new Error("Класс Легковые (sedan) не найден");
  return row;
}

export function listVehicleClasses(activeOnly = false): VehicleClassRow[] {
  if (activeOnly) {
    return db
      .prepare("SELECT * FROM vehicle_classes WHERE active = 1 ORDER BY sort_order, name")
      .all() as VehicleClassRow[];
  }
  return db
    .prepare("SELECT * FROM vehicle_classes ORDER BY sort_order, name")
    .all() as VehicleClassRow[];
}

export function isClassPricedTabId(tabId: string | null | undefined): boolean {
  if (!tabId) return false;
  for (const slug of CLASS_PRICED_TAB_SLUGS) {
    const tab = getCatalogTabBySlug(slug);
    if (tab && tab.id === tabId) return true;
  }
  return false;
}

export function isServiceTabItem(serviceId: string): boolean {
  const row = db
    .prepare("SELECT tab_id FROM services WHERE id = ?")
    .get(serviceId) as { tab_id: string | null } | undefined;
  return isClassPricedTabId(row?.tab_id);
}

/** Цена для кассы: товары — services.price_kopecks; услуги/доп.услуги — service_prices или null. */
export function resolveServicePrice(serviceId: string, classId: string | null): number | null {
  const svc = db
    .prepare("SELECT id, price_kopecks, tab_id FROM services WHERE id = ?")
    .get(serviceId) as { id: string; price_kopecks: number; tab_id: string | null } | undefined;
  if (!svc) return null;

  if (!isClassPricedTabId(svc.tab_id)) {
    return svc.price_kopecks;
  }

  if (!classId) return null;
  const price = db
    .prepare("SELECT price_kopecks FROM service_prices WHERE service_id = ? AND class_id = ?")
    .get(serviceId, classId) as { price_kopecks: number } | undefined;
  return price ? price.price_kopecks : null;
}

/** Seed классов + миграция цен услуг только в Легковые; draft без класса → sedan. */
export function ensureVehicleClassesAndPrices() {
  const count = db.prepare("SELECT COUNT(*) as c FROM vehicle_classes").get() as { c: number };
  if (count.c === 0) {
    for (const vc of DEFAULT_VEHICLE_CLASSES) {
      db.prepare(
        `INSERT INTO vehicle_classes (id, slug, name, description, icon_key, sort_order, active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`
      ).run(nanoid(), vc.slug, vc.name, vc.description, vc.icon_key, vc.sort_order);
    }
  }

  const sedan = getDefaultVehicleClass();
  const servicesTab = getCatalogTabBySlug(TAB_SLUG_SERVICES);
  if (servicesTab) {
    const services = db
      .prepare("SELECT id, price_kopecks FROM services WHERE tab_id = ?")
      .all(servicesTab.id) as { id: string; price_kopecks: number }[];
    const hasPrice = db.prepare(
      "SELECT 1 as ok FROM service_prices WHERE service_id = ? LIMIT 1"
    );
    const insertPrice = db.prepare(
      "INSERT INTO service_prices (service_id, class_id, price_kopecks) VALUES (?, ?, ?)"
    );
    for (const svc of services) {
      const existing = hasPrice.get(svc.id) as { ok: number } | undefined;
      if (existing) continue;
      insertPrice.run(svc.id, sedan.id, svc.price_kopecks);
    }
  }

  db.prepare(
    `UPDATE orders SET vehicle_class_id = ?, vehicle_class_name = ?
     WHERE status = 'draft' AND (vehicle_class_id IS NULL OR vehicle_class_id = '')`
  ).run(sedan.id, sedan.name);
}

export function getCatalogTabBySlug(slug: string): { id: string; slug: string; name: string } | null {
  const row = db
    .prepare("SELECT id, slug, name FROM catalog_tabs WHERE slug = ?")
    .get(slug) as { id: string; slug: string; name: string } | undefined;
  return row ?? null;
}

/** Гарантирует вкладки Услуги / Доп.услуги / Товары и привязку позиций. */
export function ensureDefaultCatalogTabs() {
  function ensureTab(slug: string, name: string, sortOrder: number): string {
    const existing = getCatalogTabBySlug(slug);
    if (existing) return existing.id;
    const id = nanoid();
    db.prepare(
      "INSERT INTO catalog_tabs (id, slug, name, sort_order, active) VALUES (?, ?, ?, ?, 1)"
    ).run(id, slug, name, sortOrder);
    return id;
  }

  const servicesTabId = ensureTab(TAB_SLUG_SERVICES, "Услуги", 1);
  const extrasTabId = ensureTab(TAB_SLUG_EXTRA_SERVICES, "Доп.услуги", 2);
  const productsTabId = ensureTab(TAB_SLUG_PRODUCTS, "Товары", 3);

  // Фиксированный порядок системных вкладок на кассе
  db.prepare("UPDATE catalog_tabs SET name = ?, sort_order = 1 WHERE id = ?").run(
    "Услуги",
    servicesTabId
  );
  db.prepare("UPDATE catalog_tabs SET name = ?, sort_order = 2 WHERE id = ?").run(
    "Доп.услуги",
    extrasTabId
  );
  db.prepare("UPDATE catalog_tabs SET name = ?, sort_order = 3 WHERE id = ?").run(
    "Товары",
    productsTabId
  );

  db.prepare(
    "UPDATE services SET tab_id = ? WHERE tab_id IS NULL OR tab_id = ''"
  ).run(servicesTabId);

  const productCount = db
    .prepare("SELECT COUNT(*) as c FROM services WHERE tab_id = ?")
    .get(productsTabId) as { c: number };
  if (productCount.c === 0) {
    const products = [
      ["Кофе", 15000, 1],
      ["Чай", 10000, 2],
      ["Вода", 8000, 3],
    ] as const;
    for (const [name, price, sort] of products) {
      db.prepare(
        "INSERT INTO services (id, name, price_kopecks, active, sort_order, tab_id) VALUES (?, ?, ?, 1, ?, ?)"
      ).run(nanoid(), name, price, sort, productsTabId);
    }
  }
}

export function seedIfEmpty() {
  const postCount = db.prepare("SELECT COUNT(*) as c FROM posts").get() as { c: number };
  if (postCount.c > 0) return;

  const now = new Date().toISOString();
  const masterCode = process.env.ART_MASTER_CODE ?? "9999";
  const masterHash = bcrypt.hashSync(masterCode, 10);

  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("master_code_hash", masterHash);
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("site_name", "Автомойка АРТ");
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
    "terminal_config",
    JSON.stringify({
      adapter: "emulator",
      notes: "Замените на реальный адаптер после уточнения модели терминала",
    })
  );
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
    "cloud_sync_url",
    process.env.ART_CLOUD_URL ?? "http://127.0.0.1:3002"
  );
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
    "cloud_sync_token",
    process.env.ART_SYNC_TOKEN ?? "art-sync-secret"
  );

  db.prepare("INSERT INTO posts (id, name) VALUES (1, 'Пост 1'), (2, 'Пост 2')").run();

  const washerId = nanoid();
  db.prepare(
    "INSERT INTO washers (id, name, pin_hash, active, created_at) VALUES (?, ?, ?, 1, ?)"
  ).run(washerId, "Демо мойщик", bcrypt.hashSync("1111", 10), now);

  ensureDefaultCatalogTabs();
  const servicesTabId = getCatalogTabBySlug(TAB_SLUG_SERVICES)!.id;

  const svcCount = db
    .prepare("SELECT COUNT(*) as c FROM services WHERE tab_id = ?")
    .get(servicesTabId) as { c: number };
  if (svcCount.c === 0) {
    const services = [
      ["Кузов стандарт", 80000, 1],
      ["Кузов + салон", 150000, 2],
      ["Химчистка салона", 350000, 3],
    ] as const;
    for (const [name, price, sort] of services) {
      db.prepare(
        "INSERT INTO services (id, name, price_kopecks, active, sort_order, tab_id) VALUES (?, ?, ?, 1, ?, ?)"
      ).run(nanoid(), name, price, sort, servicesTabId);
    }
  }

  ensureVehicleClassesAndPrices();

  db.prepare(
    "INSERT INTO discounts (id, name, type, value, active) VALUES (?, ?, ?, ?, 1)"
  ).run(nanoid(), "Скидка 10%", "percent", 10);

  console.log("[seed] master=9999 washer PIN=1111");
}

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}
