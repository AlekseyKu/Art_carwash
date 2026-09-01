import { db, CLASS_PRICED_TAB_SLUGS, getSetting, listVehicleClasses } from "./db.js";
import { enqueueOutbox } from "./sync.js";

const CLASS_PRICED = new Set<string>(CLASS_PRICED_TAB_SLUGS);

export interface CatalogSnapshot {
  version: string;
  updatedAt: string;
  site: {
    name: string;
    city: string;
    phone: string;
    hoursText: string;
    lat: number;
    lon: number;
    addressText: string;
  };
  bookingRules: {
    horizonDays: number;
    minLeadHours: number;
    cancelBeforeHours: number;
    defaultDurationMinutes: number;
  };
  tabs: {
    id: string;
    slug: string;
    name: string;
    sortOrder: number;
    active: boolean;
  }[];
  services: {
    id: string;
    name: string;
    description: string;
    tabId: string;
    active: boolean;
    sortOrder: number;
    priceKopecks: number | null;
    durationMinutes: number | null;
  }[];
  vehicleClasses: {
    id: string;
    slug: string;
    name: string;
    description: string;
    iconKey: string;
    sortOrder: number;
    active: boolean;
  }[];
  servicePrices: {
    serviceId: string;
    classId: string;
    priceKopecks: number;
  }[];
}

export function buildCatalogSnapshot(): CatalogSnapshot {
  const tabs = (
    db.prepare("SELECT * FROM catalog_tabs ORDER BY sort_order, name").all() as {
      id: string;
      slug: string;
      name: string;
      sort_order: number;
      active: number;
    }[]
  ).map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    sortOrder: t.sort_order,
    active: !!t.active,
  }));

  const tabSlugs = new Map(tabs.map((t) => [t.id, t.slug]));

  const serviceRows = db
    .prepare("SELECT * FROM services ORDER BY sort_order, name")
    .all() as {
    id: string;
    name: string;
    description: string | null;
    price_kopecks: number;
    active: number;
    sort_order: number;
    tab_id: string | null;
  }[];

  const servicePrices = (
    db.prepare("SELECT service_id, class_id, price_kopecks FROM service_prices").all() as {
      service_id: string;
      class_id: string;
      price_kopecks: number;
    }[]
  ).map((r) => ({
    serviceId: r.service_id,
    classId: r.class_id,
    priceKopecks: r.price_kopecks,
  }));

  const priceByServiceClass = new Map<string, number>();
  for (const p of servicePrices) {
    priceByServiceClass.set(`${p.serviceId}:${p.classId}`, p.priceKopecks);
  }

  const services = serviceRows.map((s) => {
    const slug = s.tab_id ? (tabSlugs.get(s.tab_id) ?? "") : "";
    const classPriced = CLASS_PRICED.has(slug);
    let priceKopecks: number | null = classPriced ? null : s.price_kopecks;
    if (classPriced) {
      const prices = servicePrices.filter((p) => p.serviceId === s.id);
      if (prices.length === 1) priceKopecks = prices[0]!.priceKopecks;
    }
    return {
      id: s.id,
      name: s.name,
      description: s.description ?? "",
      tabId: s.tab_id ?? "",
      active: !!s.active,
      sortOrder: s.sort_order,
      priceKopecks,
      durationMinutes: null,
    };
  });

  const vehicleClasses = listVehicleClasses(false).map((vc) => ({
    id: vc.id,
    slug: vc.slug,
    name: vc.name,
    description: vc.description ?? "",
    iconKey: vc.icon_key,
    sortOrder: vc.sort_order,
    active: !!vc.active,
  }));

  const num = (key: string, fallback: number) => {
    const v = getSetting(key);
    if (!v) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  return {
    version: process.env.npm_package_version ?? "0.3.3",
    updatedAt: new Date().toISOString(),
    site: {
      name: getSetting("pwa_site_name") ?? getSetting("site_name") ?? "Автомойка у ЖД",
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
}

/** После изменения каталога / цен / классов — в outbox для cloud. */
export function enqueueCatalogSnapshot() {
  enqueueOutbox("catalog.snapshot", buildCatalogSnapshot());
}
