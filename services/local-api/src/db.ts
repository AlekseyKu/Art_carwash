import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.ART_DATA_DIR ?? path.join(__dirname, "../../../data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "local.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

function tableColumns(table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

/** Вкладки кассы: Услуги / Товары (+ можно добавить новые). */
export const TAB_SLUG_SERVICES = "services";
export const TAB_SLUG_PRODUCTS = "products";

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
  `);

  // Существующие БД без tab_id
  if (!tableColumns("services").has("tab_id")) {
    db.exec("ALTER TABLE services ADD COLUMN tab_id TEXT");
  }

  ensureDefaultCatalogTabs();
}

export function getCatalogTabBySlug(slug: string): { id: string; slug: string; name: string } | null {
  const row = db
    .prepare("SELECT id, slug, name FROM catalog_tabs WHERE slug = ?")
    .get(slug) as { id: string; slug: string; name: string } | undefined;
  return row ?? null;
}

/** Гарантирует вкладки Услуги/Товары и привязку позиций. */
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
  const productsTabId = ensureTab(TAB_SLUG_PRODUCTS, "Товары", 2);

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
