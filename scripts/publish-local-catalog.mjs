/**
 * Публикует каталог из локальной local.db в локальный cloud.db (127.0.0.1:3002).
 * Не трогает PROD: только localhost + ART_SYNC_TOKEN из .env.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    })
);

const token = env.ART_SYNC_TOKEN;
if (!token) {
  console.error("ART_SYNC_TOKEN не найден в .env");
  process.exit(1);
}

const local = new DatabaseSync(path.join(root, "data/local.db"));

function getSetting(key) {
  const row = local.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row?.value ?? null;
}

function setSetting(key, value) {
  local
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

// Локальный sync только на localhost — не PROD
setSetting("cloud_sync_url", "http://127.0.0.1:3002");
setSetting("cloud_sync_token", token);
console.log("local sync → http://127.0.0.1:3002");

const tabs = local
  .prepare("SELECT * FROM catalog_tabs ORDER BY sort_order, name")
  .all()
  .map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    sortOrder: t.sort_order,
    active: !!t.active,
  }));

const tabSlugs = new Map(tabs.map((t) => [t.id, t.slug]));
const CLASS_PRICED = new Set(["services", "extra-services"]);

const servicePrices = local
  .prepare("SELECT service_id, class_id, price_kopecks FROM service_prices")
  .all()
  .map((r) => ({
    serviceId: r.service_id,
    classId: r.class_id,
    priceKopecks: r.price_kopecks,
  }));

const serviceRows = local.prepare("SELECT * FROM services ORDER BY sort_order, name").all();
const services = serviceRows.map((s) => {
  const slug = s.tab_id ? (tabSlugs.get(s.tab_id) ?? "") : "";
  const classPriced = CLASS_PRICED.has(slug);
  let priceKopecks = classPriced ? null : s.price_kopecks;
  if (classPriced) {
    const prices = servicePrices.filter((p) => p.serviceId === s.id);
    if (prices.length === 1) priceKopecks = prices[0].priceKopecks;
  }
  let durationMinutes = s.duration_minutes;
  if (durationMinutes == null || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    durationMinutes = slug === "extra-services" ? 15 : 60;
  }
  return {
    id: s.id,
    name: s.name,
    description: s.description ?? "",
    tabId: s.tab_id ?? "",
    active: !!s.active,
    sortOrder: s.sort_order,
    priceKopecks,
    durationMinutes,
  };
});

const vehicleClasses = local
  .prepare("SELECT * FROM vehicle_classes ORDER BY sort_order, name")
  .all()
  .map((vc) => ({
    id: vc.id,
    slug: vc.slug,
    name: vc.name,
    description: vc.description ?? "",
    iconKey: vc.icon_key,
    sortOrder: vc.sort_order,
    active: !!vc.active,
  }));

const num = (key, fallback) => {
  const v = getSetting(key);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const snapshot = {
  version: "local-dev",
  updatedAt: new Date().toISOString(),
  site: {
      name: getSetting("pwa_site_name") ?? "Автомойка у ЖД",
    city: getSetting("pwa_site_city") ?? "г. Ступино",
    phone: getSetting("pwa_site_phone") ?? "+79852741430",
    hoursText: getSetting("pwa_site_hours") ?? "Ежедневно 09:00–21:00",
    lat: Number(getSetting("pwa_site_lat") ?? "54.909290"),
    lon: Number(getSetting("pwa_site_lon") ?? "38.077015"),
    addressText: getSetting("pwa_site_address") ?? "г. Ступино",
  },
  bookingRules: {
    horizonDays: num("booking_horizon_days", 14),
    minLeadHours: num("booking_min_lead_hours", 4),
    cancelBeforeHours: num("booking_cancel_before_hours", 1),
    defaultDurationMinutes: num("booking_default_duration_minutes", 60),
  },
  tabs,
  services,
  vehicleClasses,
  servicePrices,
};

console.log(
  "publish:",
  services.length,
  "services,",
  vehicleClasses.length,
  "classes,",
  servicePrices.length,
  "prices"
);
for (const s of services.filter((x) => x.active)) {
  const tab = tabs.find((t) => t.id === s.tabId);
  console.log(" -", tab?.slug ?? "?", s.name);
}

const cloudUrl = "http://127.0.0.1:3002/api/sync";
const res = await fetch(cloudUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-sync-token": token,
  },
  body: JSON.stringify({
    events: [
      {
        id: `local-catalog-${Date.now()}`,
        type: "catalog.snapshot",
        payload: snapshot,
        createdAt: new Date().toISOString(),
      },
    ],
  }),
});

const text = await res.text();
console.log("cloud sync", res.status, text);
if (!res.ok) process.exit(1);

const cloud = new DatabaseSync(path.join(root, "data/cloud.db"));
const row = cloud.prepare("SELECT payload FROM catalog_snapshot WHERE id = 1").get();
const p = JSON.parse(row.payload);
console.log("cloud now: services=", p.services.length, "classes=", p.vehicleClasses.length);
