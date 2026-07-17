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

    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price_kopecks INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
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

  const services = [
    ["Кузов стандарт", 80000, 1],
    ["Кузов + салон", 150000, 2],
    ["Химчистка салона", 350000, 3],
  ] as const;
  for (const [name, price, sort] of services) {
    db.prepare(
      "INSERT INTO services (id, name, price_kopecks, active, sort_order) VALUES (?, ?, ?, 1, ?)"
    ).run(nanoid(), name, price, sort);
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
