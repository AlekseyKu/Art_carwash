import { BRAND_NAME, formatRub, type ShiftReport } from "@art/shared";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  adminApi,
  api,
  getAdminToken,
  isUnauthorized,
  setAdminToken,
  type CatalogItemDto,
  type CatalogTabDto,
  type ShiftDto,
  type ShiftReportDto,
  type StaffWasherDto,
  type VehicleClassDto,
} from "../api";
import { TouchField, TouchKeyboardProvider } from "../components/OnScreenKeyboard";
import { ShiftReportView } from "../components/ShiftReportView";

type FixedTab =
  | "vehicle-classes"
  | "service-prices"
  | "discounts"
  | "washers"
  | "staff-washers"
  | "terminal"
  | "analytics"
  | "security"
  | "updates"
  | "catalog-tabs";
type Tab = FixedTab | `catalog:${string}`;
type NavGroupId = "analytics" | "catalog" | "settings" | "admin";
type AnalyticsMode = "period" | "shifts" | "by-washer";
type WasherAnalyticsPeriod = "shift" | "week" | "month" | "range";

function formatAnalyticsPeriodLabel(
  fromIso: string,
  toIso: string,
  mode: WasherAnalyticsPeriod
) {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return `${fromIso} — ${toIso}`;
  }
  const dateFmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const dateTimeFmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (mode === "shift") {
    return `${dateTimeFmt.format(from)} — ${dateTimeFmt.format(to)}`;
  }
  const fromD = dateFmt.format(from);
  const toD = dateFmt.format(to);
  if (mode === "week") return `неделя ${fromD} — ${toD}`;
  if (mode === "month") return `месяц ${fromD} — ${toD}`;
  return `${fromD} — ${toD}`;
}

const MAIN_NAV: { id: NavGroupId; label: string }[] = [
  { id: "analytics", label: "Аналитика" },
  { id: "catalog", label: "Товары и услуги" },
  { id: "settings", label: "Настройки" },
  { id: "admin", label: "Администрирование" },
];

function navGroupForTab(t: Tab): NavGroupId {
  if (t === "analytics") return "analytics";
  if (t === "washers" || t === "staff-washers") return "settings";
  if (t === "updates" || t === "terminal" || t === "security") return "admin";
  return "catalog";
}

type PriceItemRow = {
  serviceId: string;
  name: string;
  priceKopecks: number | null;
  priceRub: string;
  durationMinutes: number;
  durationMin: string;
};

function priceDraftKey(classId: string, tabSlug: string) {
  return `${classId}:${tabSlug}`;
}

function defaultDurationForPriceTab(tabSlug: string) {
  return tabSlug === "extra-services" ? 15 : 60;
}

function rowsToPricePayload(items: PriceItemRow[]) {
  return items.map((item) => {
    const trimmed = item.priceRub.trim().replace(",", ".");
    const durationRaw = item.durationMin.trim().replace(",", ".");
    const durationN = Number(durationRaw);
    const durationMinutes =
      durationRaw !== "" && Number.isFinite(durationN) && durationN > 0
        ? Math.round(durationN)
        : item.durationMinutes;
    if (trimmed === "") {
      return {
        serviceId: item.serviceId,
        priceKopecks: null as number | null,
        durationMinutes,
      };
    }
    const n = Number(trimmed);
    return {
      serviceId: item.serviceId,
      priceKopecks: Number.isFinite(n) ? Math.round(n * 100) : null,
      durationMinutes,
    };
  });
}

function mapPriceApiItems(
  items: {
    serviceId: string;
    name: string;
    priceKopecks: number | null;
    durationMinutes?: number;
  }[],
  tabSlug: string
): PriceItemRow[] {
  const fallback = defaultDurationForPriceTab(tabSlug);
  return items.map((item) => {
    const durationMinutes =
      item.durationMinutes != null && item.durationMinutes > 0
        ? item.durationMinutes
        : fallback;
    return {
      serviceId: item.serviceId,
      name: item.name,
      priceKopecks: item.priceKopecks,
      priceRub:
        item.priceKopecks === null || item.priceKopecks === undefined
          ? ""
          : String(item.priceKopecks / 100),
      durationMinutes,
      durationMin: String(durationMinutes),
    };
  });
}

export function AdminPage() {
  const [token, setToken] = useState(getAdminToken());
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("analytics");
  const [navGroup, setNavGroup] = useState<NavGroupId>("analytics");

  const [catalogTabs, setCatalogTabs] = useState<CatalogTabDto[]>([]);
  const [services, setServices] = useState<CatalogItemDto[]>([]);
  const [vehicleClasses, setVehicleClasses] = useState<VehicleClassDto[]>([]);
  const [discounts, setDiscounts] = useState<
    { id: string; name: string; type: string; value: number; active: boolean }[]
  >([]);
  const [washers, setWashers] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [staffWashers, setStaffWashers] = useState<StaffWasherDto[]>([]);
  const [terminal, setTerminal] = useState({
    adapter: "emulator",
    host: "",
    port: "8080",
    comPort: "",
    notes: "",
  });
  const [period, setPeriod] = useState<"day" | "month">("day");
  const [analyticsMode, setAnalyticsMode] = useState<AnalyticsMode>("period");
  const [shiftList, setShiftList] = useState<ShiftDto[]>([]);
  const [selectedShiftReport, setSelectedShiftReport] = useState<ShiftReportDto | null>(null);
  const [analytics, setAnalytics] = useState<{
    totalKopecks: number;
    orderCount: number;
    byService: { label: string; totalKopecks: number; count: number }[];
    byPost: { label: string; totalKopecks: number; count: number }[];
    byPaymentMethod: { label: string; totalKopecks: number; count: number }[];
  } | null>(null);
  const [washerAnalyticsPeriod, setWasherAnalyticsPeriod] =
    useState<WasherAnalyticsPeriod>("shift");
  const [washerAnalyticsFrom, setWasherAnalyticsFrom] = useState("");
  const [washerAnalyticsTo, setWasherAnalyticsTo] = useState("");
  const [washerAnalytics, setWasherAnalytics] = useState<{
    from: string;
    to: string;
    washers: {
      id: string;
      name: string;
      salaryPercent: number;
      orderCount: number;
      revenueKopecks: number;
      salaryKopecks: number;
    }[];
  } | null>(null);

  const emptySvcForm = {
    name: "",
    description: "",
    priceRub: "",
    sortOrder: "10",
    coefficientEnabled: false,
    coefficientStepRub: "50",
  };
  const [svcForm, setSvcForm] = useState(emptySvcForm);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [editingServiceActive, setEditingServiceActive] = useState(true);
  const [classForm, setClassForm] = useState({ name: "", description: "", sortOrder: "10" });
  const [priceClassId, setPriceClassId] = useState<string | null>(null);
  const [priceTabSlug, setPriceTabSlug] = useState<"services" | "extra-services">("services");
  const [priceItems, setPriceItems] = useState<PriceItemRow[]>([]);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, PriceItemRow[]>>({});
  const [priceDirtyKeys, setPriceDirtyKeys] = useState<Record<string, boolean>>({});
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [tabForm, setTabForm] = useState({ name: "", sortOrder: "10" });
  const [discForm, setDiscForm] = useState({ name: "", type: "percent", value: "" });
  const [editingDiscountId, setEditingDiscountId] = useState<string | null>(null);
  const [editingDiscountActive, setEditingDiscountActive] = useState(true);
  const [washerForm, setWasherForm] = useState({ name: "", pin: "" });
  const [staffWasherForm, setStaffWasherForm] = useState({
    name: "",
    salaryPercent: "0",
  });
  const [editingStaffWasherId, setEditingStaffWasherId] = useState<string | null>(null);
  const [editingStaffWasherActive, setEditingStaffWasherActive] = useState(true);
  const [masterForm, setMasterForm] = useState({ current: "", next: "" });
  const priceDirty = Object.keys(priceDirtyKeys).some((k) => priceDirtyKeys[k]);
  const [syncUrl, setSyncUrl] = useState("https://carwash-jd.ru");
  const [syncToken, setSyncToken] = useState("");
  const [hasSyncToken, setHasSyncToken] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [updateInfo, setUpdateInfo] = useState<{
    desktop?: boolean;
    currentVersion?: string;
    latestVersion?: string | null;
    updateAvailable?: boolean;
    message?: string;
    releaseNotes?: string;
    releaseUrl?: string | null;
    repo?: string;
    hasGithubToken?: boolean;
    runtimeSource?: string;
    runtimeDir?: string;
    updatesDir?: string;
    logPath?: string;
  } | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [githubTokenInput, setGithubTokenInput] = useState("");

  const activeCatalogTab = useMemo(() => {
    if (!tab.startsWith("catalog:")) return null;
    const key = tab.slice("catalog:".length);
    return (
      catalogTabs.find((t) => t.slug === key || t.id === key) ??
      catalogTabs.find((t) => t.slug === "services") ??
      catalogTabs[0] ??
      null
    );
  }, [tab, catalogTabs]);

  const isClassPricedTab =
    activeCatalogTab?.slug === "services" || activeCatalogTab?.slug === "extra-services";
  const isExtraServicesTab = activeCatalogTab?.slug === "extra-services";

  const itemsForActiveTab = useMemo(() => {
    if (!activeCatalogTab) return [];
    return services
      .filter((s) => s.tabId === activeCatalogTab.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru"));
  }, [services, activeCatalogTab]);

  const activeVehicleClasses = useMemo(
    () => vehicleClasses.filter((c) => c.active).sort((a, b) => a.sortOrder - b.sortOrder),
    [vehicleClasses]
  );

  async function login() {
    setError("");
    const res = await api.loginAdmin(code);
    if (!res.ok || !res.token) {
      setError(res.error ?? "Ошибка");
      return;
    }
    setAdminToken(res.token);
    setToken(res.token);
    setCode("");
  }

  async function removeWithConfirm(
    message: string,
    action: () => Promise<unknown>
  ) {
    if (!window.confirm(message)) return;
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить");
    }
  }

  async function refresh() {
    if (!token) return;
    const [tabs, s, vc, d, w, sw, t, sync] = await Promise.all([
      adminApi.catalogTabs(token),
      adminApi.services(token),
      adminApi.vehicleClasses(token),
      adminApi.discounts(token),
      adminApi.washers(token),
      adminApi.staffWashers(token),
      adminApi.terminal(token),
      adminApi.syncSettings(token),
    ]);
    setCatalogTabs(Array.isArray(tabs) ? tabs : []);
    setServices(Array.isArray(s) ? s : []);
    setVehicleClasses(Array.isArray(vc) ? vc : []);
    setDiscounts(Array.isArray(d) ? d : []);
    setWashers(Array.isArray(w) ? w : []);
    setStaffWashers(Array.isArray(sw) ? sw : []);
    setTerminal({
      adapter: String(t?.adapter ?? "emulator"),
      host: String(t?.host ?? ""),
      port: String(t?.port ?? 8080),
      comPort: String(t?.comPort ?? ""),
      notes: String(t?.notes ?? ""),
    });
    if (sync?.cloudSyncUrl) setSyncUrl(sync.cloudSyncUrl);
    setHasSyncToken(!!sync?.hasToken);

    const activeVc = vc.filter((c) => c.active).sort((a, b) => a.sortOrder - b.sortOrder);
    const preferred =
      activeVc.find((c) => c.slug === "sedan") ?? activeVc[0] ?? vc[0] ?? null;
    setPriceClassId((prev) => {
      if (prev && vc.some((c) => c.id === prev)) return prev;
      return preferred?.id ?? null;
    });

    if (tab.startsWith("catalog:")) {
      const key = tab.slice("catalog:".length);
      const stillThere = (tabs ?? []).some((ct) => ct.slug === key || ct.id === key);
      if (!stillThere && tabs?.[0]) setTab(`catalog:${tabs[0].slug}`);
    }
  }

  function forceLogout(message?: string) {
    setAdminToken(null);
    setToken(null);
    setPendingLeave(null);
    setPriceDrafts({});
    setPriceDirtyKeys({});
    if (message) setError(message);
  }

  useEffect(() => {
    const onUnauthorized = (ev: Event) => {
      if ((ev as CustomEvent).detail === "admin") {
        forceLogout("Сессия недействительна — введите мастер-код снова");
      }
    };
    window.addEventListener("art:unauthorized", onUnauthorized);
    return () => window.removeEventListener("art:unauthorized", onUnauthorized);
  }, []);

  async function fetchPriceRows(classId: string, tabSlug: string) {
    if (!token) return [];
    const res = await adminApi.servicePrices(token, classId, tabSlug);
    return mapPriceApiItems(res.items, tabSlug);
  }

  async function loadServicePrices(classId: string, tabSlug = priceTabSlug, force = false) {
    if (!token) return;
    const key = priceDraftKey(classId, tabSlug);
    if (!force && priceDrafts[key]) {
      setPriceItems(priceDrafts[key]);
      return;
    }
    const rows = await fetchPriceRows(classId, tabSlug);
    setPriceItems(rows);
    setPriceDrafts((prev) => ({ ...prev, [key]: rows }));
  }

  function updatePriceRub(serviceId: string, priceRub: string) {
    if (!priceClassId) return;
    const key = priceDraftKey(priceClassId, priceTabSlug);
    setPriceItems((rows) => {
      const next = rows.map((r) => (r.serviceId === serviceId ? { ...r, priceRub } : r));
      setPriceDrafts((prev) => ({ ...prev, [key]: next }));
      return next;
    });
    setPriceDirtyKeys((prev) => ({ ...prev, [key]: true }));
  }

  function updateDurationMin(serviceId: string, durationMin: string) {
    if (!priceClassId) return;
    const key = priceDraftKey(priceClassId, priceTabSlug);
    const n = Number(durationMin.trim().replace(",", "."));
    const durationMinutes =
      durationMin.trim() !== "" && Number.isFinite(n) && n > 0
        ? Math.round(n)
        : defaultDurationForPriceTab(priceTabSlug);
    setPriceItems((rows) => {
      const next = rows.map((r) =>
        r.serviceId === serviceId ? { ...r, durationMin, durationMinutes } : r
      );
      setPriceDrafts((prev) => {
        const updated: Record<string, PriceItemRow[]> = { ...prev, [key]: next };
        // Время общее для услуги — синхронизируем по всем классам той же вкладки
        for (const [draftKey, draftRows] of Object.entries(prev)) {
          if (!draftKey.endsWith(`:${priceTabSlug}`) || draftKey === key) continue;
          updated[draftKey] = draftRows.map((r) =>
            r.serviceId === serviceId ? { ...r, durationMin, durationMinutes } : r
          );
        }
        return updated;
      });
      return next;
    });
    setPriceDirtyKeys((prev) => ({ ...prev, [key]: true }));
  }

  async function saveDirtyServicePrices() {
    if (!token) return;
    const keys = Object.keys(priceDirtyKeys).filter((k) => priceDirtyKeys[k]);
    if (keys.length === 0) return;
    for (const key of keys) {
      const [classId, tabSlug] = key.split(":");
      if (!classId || !tabSlug) continue;
      const items =
        priceClassId &&
        priceDraftKey(priceClassId, priceTabSlug) === key
          ? priceItems
          : priceDrafts[key];
      if (!items) continue;
      await adminApi.saveServicePrices(token, {
        classId,
        items: rowsToPricePayload(items),
      });
    }
    setPriceDirtyKeys({});
    if (priceClassId) {
      const rows = await fetchPriceRows(priceClassId, priceTabSlug);
      const key = priceDraftKey(priceClassId, priceTabSlug);
      setPriceItems(rows);
      setPriceDrafts((prev) => {
        const next = { ...prev };
        for (const k of keys) delete next[k];
        next[key] = rows;
        return next;
      });
    } else {
      setPriceDrafts((prev) => {
        const next = { ...prev };
        for (const k of keys) delete next[k];
        return next;
      });
    }
    setSyncMsg("Цены сохранены");
  }

  function discardDirtyServicePrices() {
    setPriceDirtyKeys({});
    setPriceDrafts({});
    setPendingLeave(null);
    if (priceClassId) {
      void loadServicePrices(priceClassId, priceTabSlug, true).catch((e) => {
        if (isUnauthorized(e)) forceLogout(e.message);
        else setError(e.message);
      });
    } else {
      setPriceItems([]);
    }
  }

  function selectNavGroup(group: NavGroupId) {
    const staysOnPrices = tab === "service-prices" && group === "catalog";
    requestLeaveServicePrices(() => {
      setNavGroup(group);
      if (group === "analytics") {
        setTab("analytics");
        return;
      }
      if (group === "catalog") {
        if (navGroupForTab(tab) !== "catalog") {
          const first = catalogSubItems[0];
          if (first) setTab(first.id);
        }
        return;
      }
      if (group === "settings") {
        setTab("washers");
        return;
      }
      if (navGroupForTab(tab) !== "admin") setTab("updates");
    }, staysOnPrices);
  }

  function isSubActive(item: { id: string }): boolean {
    if (navGroup === "analytics") {
      return tab === "analytics" && analyticsMode === item.id;
    }
    return tab === item.id;
  }

  function selectSubItem(item: { id: string }) {
    const staysOnPrices =
      navGroup === "catalog" && item.id === "service-prices" && tab === "service-prices";
    requestLeaveServicePrices(() => {
      if (navGroup === "analytics") {
        setTab("analytics");
        setAnalyticsMode(item.id as AnalyticsMode);
        return;
      }
      setTab(item.id as Tab);
    }, staysOnPrices);
  }

  function requestLeaveServicePrices(action: () => void, staysOnPrices = false) {
    if (!staysOnPrices && tab === "service-prices" && priceDirty) {
      setPendingLeave(() => action);
      return;
    }
    action();
  }

  useEffect(() => {
    if (!token) return;
    refresh().catch((e) => {
      if (isUnauthorized(e)) forceLogout(e.message);
      else setError(e.message);
    });
  }, [token]);

  useEffect(() => {
    if (!token || tab !== "analytics") return;
    if (analyticsMode === "period") {
      adminApi.analytics(token, period).then(setAnalytics).catch((e) => {
        if (isUnauthorized(e)) forceLogout(e.message);
        else setError(e.message);
      });
      return;
    }
    if (analyticsMode === "shifts") {
      setSelectedShiftReport(null);
      adminApi
        .shifts(token)
        .then((r) => setShiftList(r.shifts ?? []))
        .catch((e) => {
          if (isUnauthorized(e)) forceLogout(e.message);
          else setError(e.message);
        });
      return;
    }
    if (analyticsMode === "by-washer") {
      if (washerAnalyticsPeriod === "range" && (!washerAnalyticsFrom || !washerAnalyticsTo)) {
        setWasherAnalytics(null);
        return;
      }
      adminApi
        .analyticsByWasher(token, {
          mode: washerAnalyticsPeriod,
          from: washerAnalyticsPeriod === "range" ? washerAnalyticsFrom : undefined,
          to: washerAnalyticsPeriod === "range" ? washerAnalyticsTo : undefined,
        })
        .then(setWasherAnalytics)
        .catch((e) => {
          if (isUnauthorized(e)) forceLogout(e.message);
          else setError(e.message);
        });
    }
  }, [
    token,
    tab,
    period,
    analyticsMode,
    washerAnalyticsPeriod,
    washerAnalyticsFrom,
    washerAnalyticsTo,
  ]);

  useEffect(() => {
    if (!token || tab !== "service-prices" || !priceClassId) return;
    loadServicePrices(priceClassId, priceTabSlug).catch((e) => {
      if (isUnauthorized(e)) forceLogout(e.message);
      else setError(e.message);
    });
  }, [token, tab, priceClassId, priceTabSlug]);

  useEffect(() => {
    if (!token || tab !== "updates") return;
    setUpdateBusy(true);
    adminApi
      .updatesStatus(token)
      .then((s) => setUpdateInfo(s))
      .catch((e) => {
        if (isUnauthorized(e)) forceLogout(e.message);
        else setError(e.message);
      })
      .finally(() => setUpdateBusy(false));
  }, [token, tab]);

  useEffect(() => {
    setNavGroup(navGroupForTab(tab));
  }, [tab]);

  const catalogSubItems = useMemo(() => {
    const sorted = catalogTabs
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru"));
    const servicesTab = sorted.find((ct) => ct.slug === "services");
    const extras = sorted.find((ct) => ct.slug === "extra-services");
    const products = sorted.find((ct) => ct.slug === "products");
    const others = sorted.filter(
      (ct) =>
        ct.slug !== "services" && ct.slug !== "extra-services" && ct.slug !== "products"
    );
    const items: { id: Tab; label: string }[] = [];
    if (servicesTab) items.push({ id: `catalog:${servicesTab.slug}`, label: servicesTab.name });
    if (extras) items.push({ id: `catalog:${extras.slug}`, label: extras.name });
    items.push({ id: "vehicle-classes", label: "Классификация авто" });
    items.push({ id: "service-prices", label: "Цены на услуги" });
    if (products) items.push({ id: `catalog:${products.slug}`, label: products.name });
    for (const ct of others) items.push({ id: `catalog:${ct.slug}`, label: ct.name });
    items.push({ id: "catalog-tabs", label: "Вкладки" });
    items.push({ id: "discounts", label: "Скидки" });
    return items;
  }, [catalogTabs]);

  const subItems = useMemo(() => {
    if (navGroup === "analytics") {
      return [
        { id: "period" as const, label: "Период" },
        { id: "shifts" as const, label: "Смены" },
        { id: "by-washer" as const, label: "По мойщикам" },
      ];
    }
    if (navGroup === "catalog") return catalogSubItems;
    if (navGroup === "settings") {
      return [
        { id: "washers" as Tab, label: "Операторы" },
        { id: "staff-washers" as Tab, label: "Мойщики" },
      ];
    }
    return [
      { id: "updates" as Tab, label: "Обновления" },
      { id: "terminal" as Tab, label: "Терминал" },
      { id: "security" as Tab, label: "Безопасность" },
    ];
  }, [navGroup, catalogSubItems]);

  useEffect(() => {
    setEditingServiceId(null);
    setEditingServiceActive(true);
    setSvcForm(emptySvcForm);
    setEditingDiscountId(null);
    setEditingDiscountActive(true);
    setDiscForm({ name: "", type: "percent", value: "" });
    setEditingStaffWasherId(null);
    setEditingStaffWasherActive(true);
    setStaffWasherForm({ name: "", salaryPercent: "0" });
  }, [tab]);

  if (!token) {
    return (
      <TouchKeyboardProvider>
        <div className="app-shell">
          <header className="topbar">
            <div className="brand">{BRAND_NAME}</div>
            <div className="topbar-actions">
              <Link to="/" className="topbar-pill">
                Касса
              </Link>
            </div>
          </header>
          <main className="content" style={{ display: "grid", placeItems: "center" }}>
            <div className="panel" style={{ width: "min(420px, 100%)", textAlign: "center" }}>
              <h1 className="h1" style={{ fontSize: "1.5rem" }}>
                Админ
              </h1>
              <p className="muted">Введите мастер-код</p>
              <div className="pin-dots">
                {Array.from({ length: Math.max(4, code.length || 4) }).map((_, i) => (
                  <span key={i} className={i < code.length ? "filled" : ""} />
                ))}
              </div>
              {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
              <div className="pin-pad">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "OK"].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      if (k === "C") setCode("");
                      else if (k === "OK") void login();
                      else if (code.length < 8) setCode((c) => c + k);
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          </main>
        </div>
      </TouchKeyboardProvider>
    );
  }

  return (
    <TouchKeyboardProvider>
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">{BRAND_NAME} · Админ</div>
        <div className="topbar-actions">
          <Link to="/" className="topbar-pill">
            Касса
          </Link>
          <button
            type="button"
            className="topbar-pill"
            onClick={() =>
              requestLeaveServicePrices(() => {
                setAdminToken(null);
                setToken(null);
                setPriceDrafts({});
                setPriceDirtyKeys({});
              })
            }
          >
            Выйти
          </button>
        </div>
      </header>

      <div className="admin-menu">
        <nav className="admin-nav" aria-label="Разделы админки">
          {MAIN_NAV.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`topbar-pill${navGroup === g.id ? " active" : ""}`}
              onClick={() => selectNavGroup(g.id)}
            >
              {g.label}
            </button>
          ))}
        </nav>
        <nav className="admin-subnav" aria-label="Подменю">
          {subItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`topbar-pill${isSubActive(item) ? " active" : ""}`}
              onClick={() => selectSubItem(item)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      <main className="content">
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        {pendingLeave && (
          <div
            className="panel stack"
            role="dialog"
            aria-modal="true"
            style={{
              position: "fixed",
              inset: "0",
              zIndex: 50,
              display: "grid",
              placeItems: "center",
              background: "color-mix(in srgb, black 45%, transparent)",
              padding: "1rem",
            }}
          >
            <div className="panel stack" style={{ width: "min(420px, 100%)" }}>
              <h2 className="h2" style={{ marginBottom: 0 }}>
                Несохранённые цены
              </h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Есть изменения цен на услуги. Сохранить перед уходом?
              </p>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    const next = pendingLeave;
                    void saveDirtyServicePrices()
                      .then(() => {
                        setPendingLeave(null);
                        next();
                      })
                      .catch((e) =>
                        setError(e instanceof Error ? e.message : "Ошибка сохранения цен")
                      );
                  }}
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    const next = pendingLeave;
                    discardDirtyServicePrices();
                    next();
                  }}
                >
                  Не сохранять
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setPendingLeave(null)}
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        )}

        {activeCatalogTab && (
          <div className="panel stack">
            <h2 className="h2">{activeCatalogTab.name}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {isClassPricedTab
                ? isExtraServicesTab
                  ? "Дополнительные услуги (без цены в списке). Цены задаются во вкладке «Цены на услуги» по классу авто."
                  : "Список услуг мойки (без цены). Цены задаются во вкладке «Цены на услуги» по классу авто."
                : "Позиции вкладки на кассе. Для товаров указывайте название и цену."}
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Название</th>
                  {isClassPricedTab && <th>Описание</th>}
                  {!isClassPricedTab && <th>Цена</th>}
                  <th>Порядок</th>
                  <th className="table-actions">Действия</th>
                </tr>
              </thead>
              <tbody>
                {itemsForActiveTab.map((s) => (
                  <tr key={s.id} className={editingServiceId === s.id ? "row-editing" : undefined}>
                    <td>{s.name}</td>
                    {isClassPricedTab && <td className="muted">{s.description || "—"}</td>}
                    {!isClassPricedTab && <td>{formatRub(s.priceKopecks)}</td>}
                    <td>{s.sortOrder}</td>
                    <td className="table-actions">
                      <div className="row table-actions-row">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => {
                            setEditingServiceId(s.id);
                            setEditingServiceActive(s.active);
                            setSvcForm({
                              name: s.name,
                              description: s.description ?? "",
                              priceRub: (s.priceKopecks / 100).toString(),
                              sortOrder: String(s.sortOrder),
                              coefficientEnabled: Boolean(s.coefficientEnabled),
                              coefficientStepRub: String(
                                (s.coefficientStepKopecks ?? 5000) / 100
                              ),
                            });
                          }}
                        >
                          Изменить
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() =>
                            void adminApi
                              .saveService(
                                token,
                                {
                                  name: s.name,
                                  description: s.description ?? "",
                                  priceKopecks: s.priceKopecks,
                                  active: !s.active,
                                  sortOrder: s.sortOrder,
                                  tabId: s.tabId,
                                  coefficientEnabled: s.coefficientEnabled,
                                  coefficientStepKopecks: s.coefficientStepKopecks,
                                },
                                s.id
                              )
                              .then(refresh)
                          }
                        >
                          {s.active ? "Выкл" : "Вкл"}
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() =>
                            void removeWithConfirm(`Удалить «${s.name}»?`, () =>
                              adminApi.deleteService(token, s.id)
                            )
                          }
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {itemsForActiveTab.length === 0 && (
              <p className="muted">Пока пусто — добавьте первую позицию ниже.</p>
            )}
            <div className="row" style={{ flexWrap: "wrap" }}>
              <TouchField
                placeholder="Название"
                title="Название"
                mode="text"
                value={svcForm.name}
                onChange={(name) => setSvcForm((f) => ({ ...f, name }))}
              />
              {isClassPricedTab && (
                <TouchField
                  placeholder="Описание"
                  title="Описание"
                  mode="text"
                  value={svcForm.description}
                  onChange={(description) => setSvcForm((f) => ({ ...f, description }))}
                  style={{ minWidth: "220px", flex: "1 1 220px" }}
                />
              )}
              {!isClassPricedTab && (
                <TouchField
                  placeholder="Цена ₽"
                  title="Цена ₽"
                  mode="numeric"
                  value={svcForm.priceRub}
                  onChange={(priceRub) => setSvcForm((f) => ({ ...f, priceRub }))}
                />
              )}
              <TouchField
                placeholder="Порядок"
                title="Порядок отображения"
                mode="numeric"
                value={svcForm.sortOrder}
                onChange={(sortOrder) => setSvcForm((f) => ({ ...f, sortOrder }))}
                style={{ maxWidth: "7rem" }}
              />
              {isClassPricedTab && (
                <>
                  <label className="row" style={{ alignItems: "center", gap: "0.5rem" }}>
                    <input
                      type="checkbox"
                      checked={svcForm.coefficientEnabled}
                      onChange={(e) =>
                        setSvcForm((f) => ({ ...f, coefficientEnabled: e.target.checked }))
                      }
                    />
                    Коэффициент
                  </label>
                  {svcForm.coefficientEnabled && (
                    <TouchField
                      placeholder="Шаг ₽"
                      title="Шаг коэффициента ₽"
                      mode="numeric"
                      value={svcForm.coefficientStepRub}
                      onChange={(coefficientStepRub) =>
                        setSvcForm((f) => ({ ...f, coefficientStepRub }))
                      }
                      style={{ maxWidth: "7rem" }}
                    />
                  )}
                </>
              )}
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  if (!svcForm.name.trim()) {
                    setError("Укажите название");
                    return;
                  }
                  const existing = editingServiceId
                    ? services.find((x) => x.id === editingServiceId)
                    : null;
                  const priceKopecks = isClassPricedTab
                    ? (existing?.priceKopecks ?? 0)
                    : Math.round(Number(svcForm.priceRub) * 100);
                  const stepRub = Number(String(svcForm.coefficientStepRub).replace(",", "."));
                  const coefficientStepKopecks = Number.isFinite(stepRub)
                    ? Math.round(stepRub * 100)
                    : 5000;
                  const parsedOrder = Number(String(svcForm.sortOrder).replace(",", "."));
                  const sortOrder = Number.isFinite(parsedOrder)
                    ? Math.round(parsedOrder)
                    : (existing?.sortOrder ?? 10);
                  void adminApi
                    .saveService(
                      token,
                      {
                        name: svcForm.name.trim(),
                        description: isClassPricedTab
                          ? svcForm.description.trim()
                          : (existing?.description ?? ""),
                        priceKopecks,
                        active: editingServiceId ? editingServiceActive : true,
                        sortOrder,
                        tabId: activeCatalogTab.id,
                        ...(isClassPricedTab
                          ? {
                              coefficientEnabled: svcForm.coefficientEnabled,
                              coefficientStepKopecks: svcForm.coefficientEnabled
                                ? coefficientStepKopecks || 5000
                                : 5000,
                            }
                          : {}),
                      },
                      editingServiceId ?? undefined
                    )
                    .then(() => {
                      setSvcForm(emptySvcForm);
                      setEditingServiceId(null);
                      setEditingServiceActive(true);
                      return refresh();
                    })
                    .catch((e) => setError(e instanceof Error ? e.message : "Ошибка сохранения"));
                }}
              >
                {editingServiceId ? "Сохранить" : "Добавить"}
              </button>
              {editingServiceId && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setEditingServiceId(null);
                    setEditingServiceActive(true);
                    setSvcForm(emptySvcForm);
                  }}
                >
                  Отмена
                </button>
              )}
            </div>
          </div>
        )}

        {tab === "vehicle-classes" && (
          <div className="panel stack">
            <h2 className="h2">Классификация авто</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Классы автомобилей для кассы. Описание — подсказка с примерами марок.
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Описание</th>
                  <th>Порядок</th>
                  <th className="table-actions">Действия</th>
                </tr>
              </thead>
              <tbody>
                {vehicleClasses.map((vc) => (
                  <tr key={vc.id}>
                    <td>{vc.name}</td>
                    <td className="muted">{vc.description || "—"}</td>
                    <td>{vc.sortOrder}</td>
                    <td className="table-actions">
                      <div className="row table-actions-row">
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() =>
                            void adminApi
                              .saveVehicleClass(
                                token,
                                {
                                  name: vc.name,
                                  description: vc.description,
                                  iconKey: vc.iconKey,
                                  sortOrder: vc.sortOrder,
                                  active: !vc.active,
                                },
                                vc.id
                              )
                              .then(refresh)
                          }
                        >
                          {vc.active ? "Выкл" : "Вкл"}
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() =>
                            void removeWithConfirm(`Удалить класс «${vc.name}»?`, () =>
                              adminApi.deleteVehicleClass(token, vc.id)
                            )
                          }
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {vehicleClasses.length === 0 && (
              <p className="muted">Классы ещё не созданы.</p>
            )}
            <div className="row">
              <TouchField
                placeholder="Название"
                title="Название класса"
                mode="text"
                value={classForm.name}
                onChange={(name) => setClassForm((f) => ({ ...f, name }))}
              />
              <TouchField
                placeholder="Описание / марки"
                title="Описание класса"
                mode="text"
                value={classForm.description}
                onChange={(description) => setClassForm((f) => ({ ...f, description }))}
                style={{ flex: 1, minWidth: "12rem" }}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  void adminApi
                    .saveVehicleClass(token, {
                      name: classForm.name,
                      description: classForm.description,
                      sortOrder: Number(classForm.sortOrder) || 10,
                      active: true,
                    })
                    .then(() => {
                      setClassForm({ name: "", description: "", sortOrder: "10" });
                      return refresh();
                    })
                }
              >
                Добавить
              </button>
            </div>
          </div>
        )}

        {tab === "service-prices" && (
          <div className="panel stack">
            <h2 className="h2">Цены на услуги</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Цены услуг и доп.услуг по классу авто. Пустое поле цены — позиция скрыта на кассе
              для этого класса. Колонка «Время» — длительность для записи (общая для всех классов):
              по умолчанию 60 мин для услуг и 15 мин для доп.услуг.
            </p>
            {priceDirty && (
              <p className="muted" style={{ marginTop: 0 }}>
                Есть несохранённые изменения
              </p>
            )}
            {activeVehicleClasses.length === 0 ? (
              <p className="muted">Сначала добавьте активные классы во вкладке «Классификация авто».</p>
            ) : (
              <>
                <div className="catalog-tabs">
                  <button
                    type="button"
                    className={priceTabSlug === "services" ? "active" : ""}
                    onClick={() => setPriceTabSlug("services")}
                  >
                    Услуги
                  </button>
                  <button
                    type="button"
                    className={priceTabSlug === "extra-services" ? "active" : ""}
                    onClick={() => setPriceTabSlug("extra-services")}
                  >
                    Доп.услуги
                  </button>
                </div>
                <div className="catalog-tabs">
                  {activeVehicleClasses.map((vc) => (
                    <button
                      key={vc.id}
                      type="button"
                      className={priceClassId === vc.id ? "active" : ""}
                      onClick={() => setPriceClassId(vc.id)}
                    >
                      {vc.name}
                    </button>
                  ))}
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{priceTabSlug === "extra-services" ? "Доп.услуга" : "Услуга"}</th>
                      <th>Цена ₽</th>
                      <th>Время, мин</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceItems.map((item) => (
                      <tr key={item.serviceId}>
                        <td>{item.name}</td>
                        <td style={{ maxWidth: "10rem" }}>
                          <TouchField
                            placeholder="нет цены"
                            title={`Цена: ${item.name}`}
                            mode="numeric"
                            value={item.priceRub}
                            onChange={(priceRub) => updatePriceRub(item.serviceId, priceRub)}
                          />
                        </td>
                        <td style={{ maxWidth: "8rem" }}>
                          <TouchField
                            placeholder={String(defaultDurationForPriceTab(priceTabSlug))}
                            title={`Время: ${item.name}`}
                            mode="numeric"
                            value={item.durationMin}
                            onChange={(durationMin) => updateDurationMin(item.serviceId, durationMin)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {priceItems.length === 0 && (
                  <p className="muted">
                    {priceTabSlug === "extra-services"
                      ? "Нет доп.услуг — добавьте их во вкладке «Доп.услуги»."
                      : "Нет услуг — добавьте их во вкладке «Услуги»."}
                  </p>
                )}
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!priceClassId}
                  onClick={() => {
                    if (!priceClassId) return;
                    const key = priceDraftKey(priceClassId, priceTabSlug);
                    void adminApi
                      .saveServicePrices(token, {
                        classId: priceClassId,
                        items: rowsToPricePayload(priceItems),
                      })
                      .then(async () => {
                        setPriceDirtyKeys((prev) => {
                          const next = { ...prev };
                          delete next[key];
                          return next;
                        });
                        const rows = await fetchPriceRows(priceClassId, priceTabSlug);
                        setPriceItems(rows);
                        setPriceDrafts((prev) => ({ ...prev, [key]: rows }));
                        setSyncMsg("Цены сохранены");
                      })
                      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка"));
                  }}
                >
                  Сохранить цены
                </button>
                {syncMsg && tab === "service-prices" && (
                  <p className="muted">{syncMsg}</p>
                )}
              </>
            )}
          </div>
        )}

        {tab === "catalog-tabs" && (
          <div className="panel stack">
            <h2 className="h2">Вкладки кассы</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Управляют переключателями на кассе (Услуги / Доп.услуги / Товары). Можно добавить
              новую вкладку (например, «Химия»).
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Slug</th>
                  <th>Порядок</th>
                  <th className="table-actions">Действия</th>
                </tr>
              </thead>
              <tbody>
                {catalogTabs.map((ct) => (
                  <tr key={ct.id}>
                    <td>{ct.name}</td>
                    <td className="muted">{ct.slug}</td>
                    <td>{ct.sortOrder}</td>
                    <td className="table-actions">
                      <div className="row table-actions-row">
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() =>
                            void adminApi
                              .saveCatalogTab(
                                token,
                                {
                                  name: ct.name,
                                  sortOrder: ct.sortOrder,
                                  active: !ct.active,
                                },
                                ct.id
                              )
                              .then(refresh)
                          }
                        >
                          {ct.active ? "Выкл" : "Вкл"}
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() =>
                            void removeWithConfirm(
                              `Удалить вкладку «${ct.name}»? Сначала должны быть удалены все позиции.`,
                              () => adminApi.deleteCatalogTab(token, ct.id)
                            )
                          }
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row">
              <TouchField
                placeholder="Название вкладки"
                title="Название вкладки"
                mode="text"
                value={tabForm.name}
                onChange={(name) => setTabForm((f) => ({ ...f, name }))}
              />
              <TouchField
                placeholder="Порядок"
                title="Порядок"
                mode="numeric"
                value={tabForm.sortOrder}
                onChange={(sortOrder) => setTabForm((f) => ({ ...f, sortOrder }))}
                style={{ maxWidth: "6rem" }}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  void adminApi
                    .saveCatalogTab(token, {
                      name: tabForm.name,
                      sortOrder: Number(tabForm.sortOrder) || 10,
                      active: true,
                    })
                    .then(() => {
                      setTabForm({ name: "", sortOrder: "10" });
                      return refresh();
                    })
                }
              >
                Добавить вкладку
              </button>
            </div>
          </div>
        )}

        {tab === "discounts" && (
          <div className="panel stack">
            <h2 className="h2">Скидки</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Тип</th>
                  <th>Значение</th>
                  <th className="table-actions">Действия</th>
                </tr>
              </thead>
              <tbody>
                {discounts.map((d) => (
                  <tr key={d.id} className={editingDiscountId === d.id ? "row-editing" : undefined}>
                    <td>{d.name}</td>
                    <td>{d.type}</td>
                    <td>{d.type === "percent" ? `${d.value}%` : formatRub(d.value)}</td>
                    <td className="table-actions">
                      <div className="row table-actions-row">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => {
                            setEditingDiscountId(d.id);
                            setEditingDiscountActive(d.active);
                            setDiscForm({
                              name: d.name,
                              type: d.type,
                              value:
                                d.type === "fixed"
                                  ? String(d.value / 100)
                                  : String(d.value),
                            });
                          }}
                        >
                          Изменить
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() =>
                            void adminApi
                              .saveDiscount(
                                token,
                                { name: d.name, type: d.type, value: d.value, active: !d.active },
                                d.id
                              )
                              .then(refresh)
                          }
                        >
                          {d.active ? "Выкл" : "Вкл"}
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() =>
                            void removeWithConfirm(`Удалить скидку «${d.name}»?`, () =>
                              adminApi.deleteDiscount(token, d.id)
                            )
                          }
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row">
              <TouchField
                placeholder="Название"
                title="Название скидки"
                mode="text"
                value={discForm.name}
                onChange={(name) => setDiscForm((f) => ({ ...f, name }))}
              />
              <select
                value={discForm.type}
                onChange={(e) => setDiscForm({ ...discForm, type: e.target.value })}
              >
                <option value="percent">%</option>
                <option value="fixed">₽</option>
              </select>
              <TouchField
                placeholder="Значение"
                title="Значение скидки"
                mode="numeric"
                value={discForm.value}
                onChange={(value) => setDiscForm((f) => ({ ...f, value }))}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  const raw = Number(discForm.value);
                  const value = discForm.type === "fixed" ? Math.round(raw * 100) : raw;
                  void adminApi
                    .saveDiscount(
                      token,
                      {
                        name: discForm.name,
                        type: discForm.type,
                        value,
                        active: editingDiscountId ? editingDiscountActive : true,
                      },
                      editingDiscountId ?? undefined
                    )
                    .then(() => {
                      setDiscForm({ name: "", type: "percent", value: "" });
                      setEditingDiscountId(null);
                      setEditingDiscountActive(true);
                      return refresh();
                    });
                }}
              >
                {editingDiscountId ? "Сохранить" : "Добавить"}
              </button>
              {editingDiscountId && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setEditingDiscountId(null);
                    setEditingDiscountActive(true);
                    setDiscForm({ name: "", type: "percent", value: "" });
                  }}
                >
                  Отмена
                </button>
              )}
            </div>
          </div>
        )}

        {tab === "washers" && (
          <div className="panel stack">
            <h2 className="h2">Операторы</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Операторы кассы: вход по PIN, открытие и закрытие смен.
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Имя</th>
                  <th className="table-actions">Действия</th>
                </tr>
              </thead>
              <tbody>
                {washers.map((w) => (
                  <tr key={w.id}>
                    <td>{w.name}</td>
                    <td className="table-actions">
                      <div className="row table-actions-row">
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() =>
                            void adminApi
                              .saveWasher(token, { name: w.name, active: !w.active }, w.id)
                              .then(refresh)
                          }
                        >
                          {w.active ? "Активен" : "Выкл"}
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() =>
                            void removeWithConfirm(`Удалить оператора «${w.name}»?`, () =>
                              adminApi.deleteWasher(token, w.id)
                            )
                          }
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row">
              <TouchField
                placeholder="Имя"
                title="Имя оператора"
                mode="text"
                value={washerForm.name}
                onChange={(name) => setWasherForm((f) => ({ ...f, name }))}
              />
              <TouchField
                placeholder="PIN 4–6"
                title="PIN оператора"
                mode="pin"
                maxLength={6}
                secret
                value={washerForm.pin}
                onChange={(pin) => setWasherForm((f) => ({ ...f, pin }))}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  void adminApi
                    .saveWasher(token, {
                      name: washerForm.name,
                      pin: washerForm.pin,
                      active: true,
                    })
                    .then(() => {
                      setWasherForm({ name: "", pin: "" });
                      return refresh();
                    })
                }
              >
                Добавить
              </button>
            </div>
          </div>
        )}

        {tab === "staff-washers" && (
          <div className="panel stack">
            <h2 className="h2">Мойщики</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Персонал заказа: имя и процент зарплаты от доли выручки (без PIN).
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Имя</th>
                  <th>Зарплата %</th>
                  <th className="table-actions">Действия</th>
                </tr>
              </thead>
              <tbody>
                {staffWashers.map((w) => (
                  <tr
                    key={w.id}
                    className={editingStaffWasherId === w.id ? "row-editing" : undefined}
                  >
                    <td>{w.name}</td>
                    <td>{w.salaryPercent}%</td>
                    <td className="table-actions">
                      <div className="row table-actions-row">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => {
                            setEditingStaffWasherId(w.id);
                            setEditingStaffWasherActive(w.active !== false);
                            setStaffWasherForm({
                              name: w.name,
                              salaryPercent: String(w.salaryPercent ?? 0),
                            });
                          }}
                        >
                          Изменить
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() =>
                            void adminApi
                              .saveStaffWasher(
                                token,
                                {
                                  name: w.name,
                                  salaryPercent: w.salaryPercent,
                                  active: !(w.active !== false),
                                  sortOrder: w.sortOrder,
                                },
                                w.id
                              )
                              .then(refresh)
                          }
                        >
                          {w.active !== false ? "Активен" : "Выкл"}
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() =>
                            void removeWithConfirm(`Удалить мойщика «${w.name}»?`, () =>
                              adminApi.deleteStaffWasher(token, w.id)
                            )
                          }
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {staffWashers.length === 0 && (
              <p className="muted">Пока пусто — добавьте первого мойщика ниже.</p>
            )}
            <div className="row" style={{ flexWrap: "wrap" }}>
              <TouchField
                placeholder="Имя"
                title="Имя мойщика"
                mode="text"
                value={staffWasherForm.name}
                onChange={(name) => setStaffWasherForm((f) => ({ ...f, name }))}
              />
              <TouchField
                placeholder="Зарплата %"
                title="Зарплата %"
                mode="numeric"
                value={staffWasherForm.salaryPercent}
                onChange={(salaryPercent) =>
                  setStaffWasherForm((f) => ({ ...f, salaryPercent }))
                }
                style={{ maxWidth: "8rem" }}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  if (!staffWasherForm.name.trim()) {
                    setError("Укажите имя мойщика");
                    return;
                  }
                  const raw = Number(String(staffWasherForm.salaryPercent).replace(",", "."));
                  if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
                    setError("Зарплата % должна быть от 0 до 100");
                    return;
                  }
                  const existing = editingStaffWasherId
                    ? staffWashers.find((x) => x.id === editingStaffWasherId)
                    : null;
                  void adminApi
                    .saveStaffWasher(
                      token,
                      {
                        name: staffWasherForm.name.trim(),
                        salaryPercent: Math.round(raw),
                        active: editingStaffWasherId ? editingStaffWasherActive : true,
                        sortOrder: existing?.sortOrder ?? 0,
                      },
                      editingStaffWasherId ?? undefined
                    )
                    .then(() => {
                      setStaffWasherForm({ name: "", salaryPercent: "0" });
                      setEditingStaffWasherId(null);
                      setEditingStaffWasherActive(true);
                      return refresh();
                    })
                    .catch((e) => setError(e instanceof Error ? e.message : "Ошибка"));
                }}
              >
                {editingStaffWasherId ? "Сохранить" : "Добавить"}
              </button>
              {editingStaffWasherId && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setEditingStaffWasherId(null);
                    setEditingStaffWasherActive(true);
                    setStaffWasherForm({ name: "", salaryPercent: "0" });
                  }}
                >
                  Отмена
                </button>
              )}
            </div>
          </div>
        )}

        {tab === "terminal" && (
          <div className="panel stack">
            <h2 className="h2">Терминал оплаты</h2>
            <div className="field">
              <label>Адаптер</label>
              <select
                value={terminal.adapter}
                onChange={(e) => setTerminal({ ...terminal, adapter: e.target.value })}
              >
                <option value="emulator">Эмулятор</option>
                <option value="generic_http">Generic HTTP</option>
                <option value="sdk_bridge">SDK Bridge (localhost)</option>
              </select>
            </div>
            <div className="field">
              <label>Host</label>
              <TouchField
                title="Host"
                mode="ascii"
                placeholder="127.0.0.1"
                value={terminal.host}
                onChange={(host) => setTerminal((t) => ({ ...t, host }))}
              />
            </div>
            <div className="field">
              <label>Port</label>
              <TouchField
                title="Port"
                mode="numeric"
                placeholder="8080"
                value={terminal.port}
                onChange={(port) => setTerminal((t) => ({ ...t, port }))}
              />
            </div>
            <div className="field">
              <label>COM-порт</label>
              <TouchField
                title="COM-порт"
                mode="ascii"
                placeholder="COM3"
                value={terminal.comPort}
                onChange={(comPort) => setTerminal((t) => ({ ...t, comPort }))}
              />
            </div>
            <div className="field">
              <label>Заметки</label>
              <TouchField
                title="Заметки"
                mode="text"
                placeholder="Заметки"
                value={terminal.notes}
                onChange={(notes) => setTerminal((t) => ({ ...t, notes }))}
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={() =>
                void adminApi
                  .saveTerminal(token, {
                    adapter: terminal.adapter,
                    host: terminal.host || undefined,
                    port: Number(terminal.port) || undefined,
                    comPort: terminal.comPort || undefined,
                    notes: terminal.notes,
                  })
                  .then(() => setSyncMsg("Сохранено"))
              }
            >
              Сохранить
            </button>
            {syncMsg && <p className="muted">{syncMsg}</p>}
          </div>
        )}

        {tab === "analytics" && (
          <div className="panel stack">
            <h2 className="h2" style={{ marginBottom: 0 }}>
              {analyticsMode === "shifts"
                ? "Аналитика · Смены"
                : analyticsMode === "by-washer"
                  ? "Аналитика · По мойщикам"
                  : "Аналитика · Период"}
            </h2>

            {analyticsMode === "period" && (
              <>
                <div className="row">
                  <button
                    type="button"
                    className={`topbar-pill${period === "day" ? " active" : ""}`}
                    onClick={() => setPeriod("day")}
                  >
                    День
                  </button>
                  <button
                    type="button"
                    className={`topbar-pill${period === "month" ? " active" : ""}`}
                    onClick={() => setPeriod("month")}
                  >
                    Месяц
                  </button>
                </div>
                {analytics && (
                  <>
                    <p>
                      Выручка <strong>{formatRub(analytics.totalKopecks)}</strong> · заказов{" "}
                      {analytics.orderCount}
                    </p>
                    <h3 className="h2">По услугам</h3>
                    <ul>
                      {analytics.byService.map((b) => (
                        <li key={b.label}>
                          {b.label}: {formatRub(b.totalKopecks)} ({b.count})
                        </li>
                      ))}
                    </ul>
                    <h3 className="h2">По постам</h3>
                    <ul>
                      {analytics.byPost.map((b) => (
                        <li key={b.label}>
                          {b.label}: {formatRub(b.totalKopecks)} ({b.count})
                        </li>
                      ))}
                    </ul>
                    <h3 className="h2">По оплате</h3>
                    <ul>
                      {analytics.byPaymentMethod.map((b) => (
                        <li key={b.label}>
                          {b.label}: {formatRub(b.totalKopecks)} ({b.count})
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}

            {analyticsMode === "shifts" && (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  Краткие отчёты по кассовым сменам. Нажмите смену, чтобы раскрыть чеки и оплаты.
                </p>
                {shiftList.length === 0 ? (
                  <p className="muted">Смен пока нет</p>
                ) : (
                  <ul className="shift-order-list">
                    {shiftList.map((s) => {
                      const active = selectedShiftReport?.shift.id === s.id;
                      const opened = new Intl.DateTimeFormat("ru-RU", {
                        timeZone: "Europe/Moscow",
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(s.openedAt));
                      return (
                        <li key={s.id} className="shift-order-item">
                          <button
                            type="button"
                            className="shift-order-toggle"
                            onClick={() => {
                              if (!token) return;
                              if (active) {
                                setSelectedShiftReport(null);
                                return;
                              }
                              adminApi
                                .shiftReport(token, s.id)
                                .then(setSelectedShiftReport)
                                .catch((e) => setError(e.message));
                            }}
                          >
                            <span>
                              {opened}
                              {" · "}
                              {s.status === "open" ? "открыта" : "закрыта"}
                              {s.openedByName ? ` · ${s.openedByName}` : ""}
                            </span>
                            <span>
                              {formatRub(s.totalKopecks ?? 0)} · {s.orderCount ?? 0} чек.
                            </span>
                          </button>
                          {active && selectedShiftReport && (
                            <div className="shift-order-details">
                              <ShiftReportView report={selectedShiftReport as ShiftReport} />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}

            {analyticsMode === "by-washer" && (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  Выручка заказа делится поровну между мойщиками в составе. Зарплата — доля × %.
                </p>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  {(
                    [
                      ["shift", "Смена"],
                      ["week", "Неделя"],
                      ["month", "Месяц"],
                      ["range", "Даты"],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      className={`topbar-pill${washerAnalyticsPeriod === mode ? " active" : ""}`}
                      onClick={() => setWasherAnalyticsPeriod(mode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {washerAnalyticsPeriod === "range" && (
                  <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
                    <div className="field" style={{ margin: 0 }}>
                      <label>С</label>
                      <input
                        type="date"
                        value={washerAnalyticsFrom}
                        onChange={(e) => setWasherAnalyticsFrom(e.target.value)}
                      />
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <label>По</label>
                      <input
                        type="date"
                        value={washerAnalyticsTo}
                        onChange={(e) => setWasherAnalyticsTo(e.target.value)}
                      />
                    </div>
                  </div>
                )}
                {washerAnalyticsPeriod === "range" &&
                  (!washerAnalyticsFrom || !washerAnalyticsTo) && (
                    <p className="muted">Укажите даты «С» и «По».</p>
                  )}
                {washerAnalytics && (
                  <>
                    <p style={{ marginTop: 0 }}>
                      <span className="muted">Период: </span>
                      <strong>
                        {formatAnalyticsPeriodLabel(
                          washerAnalytics.from,
                          washerAnalytics.to,
                          washerAnalyticsPeriod
                        )}
                      </strong>
                    </p>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Имя</th>
                          <th>Заказов</th>
                          <th>Выручка</th>
                          <th>Зарплата %</th>
                          <th>Зарплата, руб</th>
                        </tr>
                      </thead>
                      <tbody>
                        {washerAnalytics.washers.map((w) => (
                          <tr key={w.id}>
                            <td>{w.name}</td>
                            <td>{w.orderCount}</td>
                            <td>{formatRub(w.revenueKopecks)}</td>
                            <td>{w.salaryPercent}%</td>
                            <td>{formatRub(w.salaryKopecks)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {washerAnalytics.washers.length === 0 && (
                      <p className="muted">Нет данных за выбранный период.</p>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {tab === "updates" && (
          <div className="panel stack">
            {updateInfo?.latestVersion && (
              <p style={{ marginTop: 0 }}>
                На GitHub: <strong>{updateInfo.latestVersion}</strong>
                {updateInfo.updateAvailable ? " · есть обновление" : " · актуально"}
              </p>
            )}
            {updateInfo?.message && <p className="muted">{updateInfo.message}</p>}
            {updateInfo?.releaseNotes && (
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: "0.85rem",
                  background: "color-mix(in srgb, var(--brand-silver-soft) 40%, white)",
                  padding: "0.75rem",
                  borderRadius: "8px",
                  maxHeight: "12rem",
                  overflow: "auto",
                }}
              >
                {updateInfo.releaseNotes}
              </pre>
            )}
            <div className="row">
              <button
                type="button"
                className="btn-secondary"
                disabled={updateBusy || !token}
                onClick={() => {
                  setUpdateBusy(true);
                  setError("");
                  void adminApi
                    .updatesCheck(token!)
                    .then((r) => setUpdateInfo(r))
                    .catch((e) => setError(e.message))
                    .finally(() => setUpdateBusy(false));
                }}
              >
                Проверить обновления
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={updateBusy || !token || !updateInfo?.updateAvailable}
                onClick={() => {
                  if (!window.confirm("Скачать обновление с GitHub и перезапустить кассу?")) {
                    return;
                  }
                  setUpdateBusy(true);
                  setError("");
                  void adminApi
                    .updatesApply(token!)
                    .then((r) => {
                      setUpdateInfo((prev) => ({ ...prev, ...r, updateAvailable: false }));
                      if (r.restart) {
                        setSyncMsg(
                          "Обновление установлено. Касса закроется и через пару секунд откроется снова. Если окно не появилось — запустите ярлык ArtCarwash."
                        );
                      }
                    })
                    .catch((e) => setError(e.message))
                    .finally(() => setUpdateBusy(false));
                }}
              >
                Обновить
              </button>
              {updateInfo?.releaseUrl && (
                <a
                  className="btn-ghost"
                  href={updateInfo.releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: "none", display: "grid", placeItems: "center" }}
                >
                  Открыть Release
                </a>
              )}
            </div>
            {updateBusy && <p className="muted">Подождите…</p>}
            {syncMsg && <p className="muted">{syncMsg}</p>}

            <h2 className="h2">Обновления кассы</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Проверка и установка с GitHub Releases (
              {updateInfo?.repo ?? "AlekseyKu/Art_carwash"}). Работает в приложении
              ArtCarwash-POS при наличии интернета. База данных не затрагивается.
              Обновление ставит UI/API и логику обновлений в AppData — без ручной
              скачки portable, кроме редких правок самой оболочки Electron.
            </p>
            <p>
              Текущая версия:{" "}
              <strong>{updateInfo?.currentVersion ?? updateInfo?.message ?? "—"}</strong>
              {updateInfo?.runtimeSource === "runtime" ? " (из AppData)" : null}
            </p>
            {(updateInfo?.runtimeDir || updateInfo?.updatesDir) && (
              <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                Установка: <code>{updateInfo.runtimeDir ?? "—"}</code>
                <br />
                Загрузки: <code>{updateInfo.updatesDir ?? "—"}</code>
                {updateInfo.logPath ? (
                  <>
                    <br />
                    Лог: <code>{updateInfo.logPath}</code>
                  </>
                ) : null}
              </p>
            )}
            <p className="muted" style={{ margin: 0 }}>
              GitHub token (необязательно для публичного репо):{" "}
              <strong>
                {updateInfo?.hasGithubToken ? "сохранён на кассе" : "не задан"}
              </strong>
            </p>
            <div className="field">
              <label>Personal Access Token — только если репозиторий приватный (Contents: Read)</label>
              <div className="row" style={{ alignItems: "stretch", gap: "0.5rem" }}>
                <TouchField
                  title="GitHub token"
                  mode="ascii"
                  secret
                  keyboard={false}
                  placeholder="ghp_… или github_pat_… (вставьте из буфера)"
                  value={githubTokenInput}
                  onChange={setGithubTokenInput}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={updateBusy}
                  style={{ flex: "0 0 auto" }}
                  onClick={() => {
                    void (async () => {
                      try {
                        const text = (await navigator.clipboard.readText()).replace(/\s+/g, "").trim();
                        if (!text) {
                          setError("Буфер обмена пуст");
                          return;
                        }
                        setGithubTokenInput(text.replace(/[^\x20-\x7E]/g, ""));
                        setError("");
                      } catch {
                        setError("Не удалось вставить из буфера — скопируйте token и нажмите «Вставить» ещё раз");
                      }
                    })();
                  }}
                >
                  Вставить
                </button>
              </div>
            </div>
            <div className="row">
              <button
                type="button"
                className="btn-secondary"
                disabled={updateBusy || !token || !githubTokenInput.trim()}
                onClick={() => {
                  setUpdateBusy(true);
                  setError("");
                  void adminApi
                    .updatesSetGithubToken(token!, githubTokenInput.trim())
                    .then((r) => {
                      setSyncMsg(r.message ?? "Token сохранён");
                      setGithubTokenInput("");
                      return adminApi.updatesStatus(token!);
                    })
                    .then((s) => setUpdateInfo((prev) => ({ ...prev, ...s })))
                    .catch((e) => setError(e.message))
                    .finally(() => setUpdateBusy(false));
                }}
              >
                Сохранить token
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={updateBusy || !token || !updateInfo?.hasGithubToken}
                onClick={() => {
                  if (!window.confirm("Удалить сохранённый GitHub token с этой кассы?")) return;
                  setUpdateBusy(true);
                  setError("");
                  void adminApi
                    .updatesSetGithubToken(token!, "")
                    .then((r) => {
                      setSyncMsg(r.message ?? "Token удалён");
                      return adminApi.updatesStatus(token!);
                    })
                    .then((s) => setUpdateInfo((prev) => ({ ...prev, ...s })))
                    .catch((e) => setError(e.message))
                    .finally(() => setUpdateBusy(false));
                }}
              >
                Удалить token
              </button>
            </div>
          </div>
        )}

        {tab === "security" && (
          <div className="panel stack">
            <h2 className="h2">Мастер-код</h2>
            <div className="field">
              <label>Текущий</label>
              <TouchField
                title="Текущий мастер-код"
                mode="pin"
                maxLength={8}
                secret
                placeholder="Текущий код"
                value={masterForm.current}
                onChange={(current) => setMasterForm((f) => ({ ...f, current }))}
              />
            </div>
            <div className="field">
              <label>Новый</label>
              <TouchField
                title="Новый мастер-код"
                mode="pin"
                maxLength={8}
                secret
                placeholder="Новый код"
                value={masterForm.next}
                onChange={(next) => setMasterForm((f) => ({ ...f, next }))}
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={() =>
                void adminApi
                  .changeMaster(token, masterForm.current, masterForm.next)
                  .then((r) => {
                    if (!r.ok) setError(r.error ?? "Ошибка");
                    else {
                      setMasterForm({ current: "", next: "" });
                      setSyncMsg("Код изменён");
                    }
                  })
              }
            >
              Сменить код
            </button>

            <h2 className="h2" style={{ marginTop: "1.5rem" }}>
              Облачная синхронизация
            </h2>
            <div className="field">
              <label>URL cloud-api</label>
              <TouchField
                title="URL cloud-api"
                mode="ascii"
                placeholder="https://carwash-jd.ru"
                value={syncUrl}
                onChange={setSyncUrl}
              />
              <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
                Базовый адрес без <code>/api/sync</code> — путь добавится автоматически.
              </p>
            </div>
            <div className="field">
              <label>Sync token</label>
              <TouchField
                title="Sync token"
                mode="ascii"
                secret
                placeholder={hasSyncToken ? "•••••••• (задан — введите новый для замены)" : "токен с VPS"}
                value={syncToken}
                onChange={setSyncToken}
              />
            </div>
            <div className="row">
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  void adminApi
                    .saveSyncSettings(token, syncUrl, syncToken.trim() || undefined)
                    .then(() => {
                      if (syncToken.trim()) {
                        setSyncToken("");
                        setHasSyncToken(true);
                      }
                      setSyncMsg("Настройки sync сохранены");
                    })
                }
              >
                Сохранить
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  void adminApi.sync(token).then((r) => {
                    if (r.error) setSyncMsg(r.error);
                    else if (r.synced === 0) {
                      setSyncMsg("Очередь пуста — нечего отправлять. Сначала «Опубликовать каталог».");
                    } else setSyncMsg(`Синхронизировано: ${r.synced}`);
                  })
                }
              >
                Синхронизировать сейчас
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  void adminApi.publishCatalog(token).then((r) => {
                    if (r.error) setSyncMsg(r.error);
                    else if (r.synced === 0) {
                      setSyncMsg("Каталог в очереди, но cloud не ответил или очередь уже была пуста.");
                    } else setSyncMsg(`Каталог опубликован, отправлено: ${r.synced}`);
                  })
                }
              >
                Опубликовать каталог
              </button>
            </div>
            {syncMsg && <p className="muted">{syncMsg}</p>}
            <p className="muted">
              Отчёты для телефона: <Link to="/reports">/reports</Link>
            </p>
          </div>
        )}
      </main>
    </div>
    </TouchKeyboardProvider>
  );
}
