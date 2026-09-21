import type { DatabaseSync } from "node:sqlite";
import { defaultSiteSchedule, formatHoursText } from "@art/shared";

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
    schedule?: {
      days: {
        weekday: number;
        closed: boolean;
        open: string;
        close: string;
      }[];
    };
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
    visibleInPwa?: boolean;
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
  tariffs?: {
    id: string;
    name: string;
    validFrom: string;
    validTo: string | null;
    active: boolean;
    prices: {
      serviceId: string;
      classId: string;
      priceKopecks: number;
    }[];
  }[];
}

const defaultSchedule = defaultSiteSchedule();

export const DEFAULT_CATALOG: CatalogSnapshot = {
  version: "0.0.0",
  updatedAt: new Date(0).toISOString(),
  site: {
    name: "Автомойка у ЖД",
    city: "г. Ступино",
    phone: "+79852741430",
    hoursText: formatHoursText(defaultSchedule),
    schedule: defaultSchedule,
    lat: 54.90929,
    lon: 38.077015,
    addressText: "г. Ступино",
  },
  bookingRules: {
    horizonDays: 14,
    minLeadHours: 4,
    cancelBeforeHours: 1,
    defaultDurationMinutes: 60,
  },
  tabs: [],
  services: [],
  vehicleClasses: [],
  servicePrices: [],
  tariffs: [],
};

export function initCatalogSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
  `);
}

export function saveCatalogSnapshot(db: DatabaseSync, snapshot: CatalogSnapshot) {
  db.prepare(
    `INSERT INTO catalog_snapshot (id, version, updated_at, payload)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       version = excluded.version,
       updated_at = excluded.updated_at,
       payload = excluded.payload`
  ).run(snapshot.version, snapshot.updatedAt, JSON.stringify(snapshot));
}

export function getCatalogSnapshot(db: DatabaseSync): CatalogSnapshot {
  const row = db.prepare("SELECT payload FROM catalog_snapshot WHERE id = 1").get() as
    | { payload: string }
    | undefined;
  if (!row) return DEFAULT_CATALOG;
  try {
    return JSON.parse(row.payload) as CatalogSnapshot;
  } catch {
    return DEFAULT_CATALOG;
  }
}
