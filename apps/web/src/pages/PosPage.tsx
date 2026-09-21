import { BRAND_NAME, formatRub, type ShiftReport } from "@art/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  api,
  getWasherToken,
  isUnauthorized,
  setWasherToken,
  type OrderDto,
  type OrderItemInput,
  type ClientDto,
  type BookingDto,
  type ShiftDto,
  type ShiftReportDto,
  type VehicleClassDto,
} from "../api";
import { RecentOrdersPanel } from "../components/RecentOrdersPanel";
import { ShiftReportView } from "../components/ShiftReportView";
import {
  TouchField,
  TouchKeyboardProvider,
  useTouchKeyboard,
} from "../components/OnScreenKeyboard";
import { WindowControls } from "../components/WindowControls";
import { vehicleClassIconSrc } from "../vehicleClassIcons";

type Catalog = Awaited<ReturnType<typeof api.catalog>>;

type CartLine = {
  key: string;
  serviceId: string | null;
  name: string;
  description?: string;
  qty: number;
  basePriceKopecks: number;
  coefficientExtraKopecks: number;
  discountPercent: number;
  priceKopecks: number;
  isManual: boolean;
  coefficientEnabled?: boolean;
  coefficientStepKopecks?: number;
  /** Скидка на позицию только для вкладок Услуги / Доп.услуги */
  lineDiscountEnabled?: boolean;
};

/** Черновик всегда на одном «посту» — выбор постов в UI убран. */
const DRAFT_POST_ID = 1;
const PWA_BOOKING_SEEN_KEY = "art_pwa_booking_seen_at";

const LINE_DISCOUNT_PRESETS = [10, 25, 50] as const;

function readPwaSeenAt(): string | null {
  try {
    return localStorage.getItem(PWA_BOOKING_SEEN_KEY);
  } catch {
    return null;
  }
}

function writePwaSeenAt(iso: string) {
  try {
    localStorage.setItem(PWA_BOOKING_SEEN_KEY, iso);
  } catch {
    /* ignore */
  }
}

function formatPwaNextLabel(startsAt: string): string {
  const start = new Date(startsAt);
  const today = mskDateParts();
  const day = mskDateParts(start);
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  }).format(start);

  if (day.date === today.date) return `сегодня ${time}`;

  const tomorrow = new Date(`${today.date}T12:00:00+03:00`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(tomorrow);
  if (day.date === tomorrowDate) return `завтра ${time}`;

  const short = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(start);
  return `${short} · ${time}`;
}

function mskDateParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function clampDiscountPercent(raw: unknown): number {
  const n = Math.round(Number(raw) || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function lineGrossKopecks(line: Pick<CartLine, "basePriceKopecks" | "coefficientExtraKopecks">) {
  return Math.max(0, line.basePriceKopecks) + Math.max(0, line.coefficientExtraKopecks);
}

function priceWithLineDiscount(
  base: number,
  extra: number,
  discountPercent: number
): number {
  const gross = Math.max(0, base) + Math.max(0, extra);
  const pct = clampDiscountPercent(discountPercent);
  return Math.round((gross * (100 - pct)) / 100);
}

function isLineDiscountTab(slug: string | undefined) {
  return slug === "services" || slug === "extra-services";
}

function qtyFromLines(lines: CartLine[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const line of lines) {
    if (line.serviceId) map[line.serviceId] = (map[line.serviceId] ?? 0) + line.qty;
  }
  return map;
}

function linesFromOrder(o: OrderDto, cat: Catalog | null): CartLine[] {
  return (o.items ?? []).map((i, idx) => {
    const isManual = !!i.isManual || !i.serviceId;
    const svc =
      !isManual && i.serviceId
        ? cat?.services.find((s) => s.id === i.serviceId)
        : undefined;
    const tabSlug = svc ? cat?.tabs.find((t) => t.id === svc.tabId)?.slug : undefined;
    const extra = Math.max(0, i.coefficientExtraKopecks ?? 0);
    const base =
      i.basePriceKopecks != null
        ? Math.max(0, i.basePriceKopecks)
        : Math.max(0, i.priceKopecks - extra);
    const discountPercent = clampDiscountPercent(i.discountPercent);
    return {
      key: isManual ? (i.id ?? `manual-${idx}-${i.nameSnapshot}`) : String(i.serviceId),
      serviceId: isManual ? null : i.serviceId,
      name: i.nameSnapshot,
      description: svc?.description ?? "",
      qty: i.qty,
      basePriceKopecks: base,
      coefficientExtraKopecks: extra,
      discountPercent,
      priceKopecks: i.priceKopecks,
      isManual,
      coefficientEnabled: Boolean(svc?.coefficientEnabled) && !isManual,
      coefficientStepKopecks: svc?.coefficientStepKopecks ?? 5000,
      lineDiscountEnabled: !isManual && isLineDiscountTab(tabSlug),
    };
  });
}

function toOrderItemInputs(lines: CartLine[]): OrderItemInput[] {
  return lines.map((l) => ({
    serviceId: l.isManual ? null : l.serviceId,
    name: l.name,
    qty: l.qty,
    priceKopecks: l.priceKopecks,
    basePriceKopecks: l.basePriceKopecks,
    coefficientExtraKopecks: l.coefficientExtraKopecks,
    discountPercent: l.lineDiscountEnabled || l.isManual ? l.discountPercent : 0,
    isManual: l.isManual,
  }));
}

export function PosPage() {
  const [token, setToken] = useState(getWasherToken());
  const [washerName, setWasherName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [online, setOnline] = useState(true);
  const [desktopShell, setDesktopShell] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [cartLines, setCartLines] = useState<CartLine[]>([]);
  const [lineDiscountKey, setLineDiscountKey] = useState<string | null>(null);
  const [lineDiscountManual, setLineDiscountManual] = useState("");
  const [staffWasherIds, setStaffWasherIds] = useState<string[]>([]);
  const [discountId, setDiscountId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualPriceRub, setManualPriceRub] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [tipsRub, setTipsRub] = useState("0");
  const [pendingPay, setPendingPay] = useState<{
    paymentId: string;
    method: "card" | "sbp";
    qrPayload?: string;
    message?: string;
  } | null>(null);
  const [recentKey, setRecentKey] = useState(0);
  const [recentOpen, setRecentOpen] = useState(false);
  const [classInfoOpen, setClassInfoOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [clientHits, setClientHits] = useState<ClientDto[]>([]);
  const [clientSearchBusy, setClientSearchBusy] = useState(false);
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [attachedClient, setAttachedClient] = useState<ClientDto | null>(null);
  const [catalogTabId, setCatalogTabId] = useState<string | null>(null);
  const [shift, setShift] = useState<ShiftDto | null>(null);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [openShiftPrompt, setOpenShiftPrompt] = useState(false);
  const [rolloverPrompt, setRolloverPrompt] = useState(false);
  const [closeReport, setCloseReport] = useState<ShiftReportDto | null>(null);
  const [shiftConfirm, setShiftConfirm] = useState<"open" | "close" | null>(null);
  const [vehicleClassId, setVehicleClassId] = useState<string | null>(null);
  const [pwaNext, setPwaNext] = useState<BookingDto | null>(null);
  const [pwaLatestCreatedAt, setPwaLatestCreatedAt] = useState<string | null>(null);
  const [pwaSeenAt, setPwaSeenAt] = useState<string | null>(() => readPwaSeenAt());
  const navigate = useNavigate();

  const vehicleClasses = catalog?.vehicleClasses ?? [];

  const pwaHasNew = Boolean(
    pwaLatestCreatedAt && (!pwaSeenAt || pwaLatestCreatedAt > pwaSeenAt)
  );

  const selectedClass: VehicleClassDto | null = useMemo(() => {
    if (!vehicleClasses.length) return null;
    return (
      vehicleClasses.find((c) => c.id === vehicleClassId) ??
      vehicleClasses.find((c) => c.slug === "sedan") ??
      vehicleClasses[0] ??
      null
    );
  }, [vehicleClasses, vehicleClassId]);

  function forceLogout(message?: string) {
    setWasherToken(null);
    setToken(null);
    setOrder(null);
    setCatalog(null);
    setQty({});
    setCartLines([]);
    setLineDiscountKey(null);
    setLineDiscountManual("");
    setStaffWasherIds([]);
    setDiscountId(null);
    setPayOpen(false);
    setPendingPay(null);
    setTipsRub("0");
    setRecentOpen(false);
    setClassInfoOpen(false);
    setClientQuery("");
    setClientHits([]);
    setClientSearchOpen(false);
    setAttachedClient(null);
    setVehicleClassId(null);
    setPwaNext(null);
    setPwaLatestCreatedAt(null);
    setWasherName("");
    setShift(null);
    setOpenShiftPrompt(false);
    setRolloverPrompt(false);
    setCloseReport(null);
    setShiftConfirm(null);
    setManualOpen(false);
    if (message) setError(message);
  }

  async function refreshShift(t = token) {
    if (!t) return;
    const st = await api.shiftCurrent(t);
    setShift(st.shift);
    if (st.needsRollover) setRolloverPrompt(true);
    return st;
  }

  useEffect(() => {
    const onUnauthorized = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (detail === "washer" || detail == null) {
        forceLogout("Сессия недействительна — введите PIN снова");
      }
    };
    window.addEventListener("art:unauthorized", onUnauthorized);
    return () => window.removeEventListener("art:unauthorized", onUnauthorized);
  }, []);

  useEffect(() => {
    const tick = () => {
      api
        .status()
        .then((s) => {
          setOnline(s.online);
          setPendingSync(s.pendingSync);
          setDesktopShell(Boolean(s.desktop));
        })
        .catch(() => setOnline(false));
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!token) return;
    api
      .catalog(vehicleClassId ?? undefined, order?.clientId ?? undefined)
      .then((c) => {
        const tabs = c.tabs ?? [];
        setCatalog({
          ...c,
          tabs,
          services: c.services ?? [],
          discounts: c.discounts ?? [],
          vehicleClasses: c.vehicleClasses ?? [],
          staffWashers: c.staffWashers ?? [],
        });
        setCatalogTabId((prev) => prev ?? tabs[0]?.id ?? null);
        if (!vehicleClassId) {
          const classes = c.vehicleClasses ?? [];
          const def = classes.find((x) => x.slug === "sedan") ?? classes[0];
          if (def) setVehicleClassId(def.id);
        }
      })
      .catch((e) => {
        if (isUnauthorized(e)) forceLogout(e.message);
        else setError(e.message);
      });
  }, [token, vehicleClassId, order?.clientId]);

  const catalogItems = useMemo(() => {
    if (!catalog) return [];
    const tabs = catalog.tabs ?? [];
    const services = catalog.services ?? [];
    const tabId = catalogTabId ?? tabs[0]?.id;
    if (!tabId) return services;
    return services.filter((s) => s.tabId === tabId);
  }, [catalog, catalogTabId]);

  useEffect(() => {
    if (!token) return;
    api
      .draft(DRAFT_POST_ID, token)
      .then((o) => {
        applyOrder(o);
      })
      .catch((e) => {
        if (isUnauthorized(e)) forceLogout(e.message);
        else setError(e.message);
      });
    refreshShift(token).catch((e) => {
      if (isUnauthorized(e)) forceLogout(e.message);
    });
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const loadPwa = () => {
      void api
        .pwaBookingSummary(token)
        .then((r) => {
          if (cancelled) return;
          setPwaNext(r.next);
          setPwaLatestCreatedAt(r.latestCreatedAt);
        })
        .catch((e) => {
          if (isUnauthorized(e)) forceLogout(e.message);
        });
    };
    loadPwa();
    const id = window.setInterval(loadPwa, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [token]);

  const subtotal = useMemo(
    () => cartLines.reduce((s, line) => s + line.priceKopecks * line.qty, 0),
    [cartLines]
  );

  const staffWashers = useMemo(
    () => (catalog?.staffWashers ?? []).filter((w) => w.active !== false),
    [catalog]
  );

  function applyOrder(o: OrderDto, cat: Catalog | null = catalog) {
    setOrder(o);
    const lines = linesFromOrder(o, cat);
    setCartLines(lines);
    setQty(qtyFromLines(lines));
    setDiscountId(o.discountId);
    setStaffWasherIds(o.staffWasherIds ?? []);
    if (o.vehicleClassId) setVehicleClassId(o.vehicleClassId);
  }

  // Enrich coefficient flags / descriptions when catalog arrives or class prices change
  useEffect(() => {
    if (!catalog) return;
    setCartLines((prev) => {
      if (!prev.length) return prev;
      let changed = false;
      const next = prev.map((line) => {
        if (line.isManual || !line.serviceId) return line;
        const svc = catalog.services.find((s) => s.id === line.serviceId);
        if (!svc) return line;
        const tabSlug = catalog.tabs.find((t) => t.id === svc.tabId)?.slug;
        const coefficientEnabled = Boolean(svc.coefficientEnabled);
        const coefficientStepKopecks = svc.coefficientStepKopecks ?? 5000;
        const description = svc.description ?? "";
        const lineDiscountEnabled = isLineDiscountTab(tabSlug);
        if (
          line.coefficientEnabled === coefficientEnabled &&
          line.coefficientStepKopecks === coefficientStepKopecks &&
          (line.description ?? "") === description &&
          line.lineDiscountEnabled === lineDiscountEnabled
        ) {
          return line;
        }
        changed = true;
        return {
          ...line,
          description,
          coefficientEnabled,
          coefficientStepKopecks,
          lineDiscountEnabled,
        };
      });
      return changed ? next : prev;
    });
  }, [catalog]);

  async function submitPin() {
    setError("");
    const res = await api.loginWasher(pin);
    if (!res.ok || !res.token) {
      setError(res.error ?? "Ошибка входа");
      setPin("");
      return;
    }
    setWasherToken(res.token);
    setToken(res.token);
    setWasherName(res.washer?.name ?? "");
    setPin("");
  }

  async function persist(
    nextLines = cartLines,
    nextDisc = discountId,
    nextStaff = staffWasherIds
  ) {
    if (!token || !order) return;
    const updated = await api.saveOrder(
      order.id,
      {
        items: toOrderItemInputs(nextLines),
        discountId: nextDisc,
        staffWasherIds: nextStaff,
      },
      token
    );
    applyOrder(updated);
  }

  function toggleService(id: string) {
    const svc = catalog?.services.find((s) => s.id === id);
    if (!svc) return;
    const servicesTabId = catalog?.tabs.find((t) => t.slug === "services")?.id;
    const tabSlug = catalog?.tabs.find((t) => t.id === svc.tabId)?.slug;
    const isMainService = Boolean(servicesTabId && svc.tabId === servicesTabId);
    const exists = cartLines.some((l) => l.serviceId === id);
    const newLine: CartLine = {
      key: id,
      serviceId: id,
      name: svc.name,
      description: svc.description ?? "",
      qty: 1,
      basePriceKopecks: svc.priceKopecks,
      coefficientExtraKopecks: 0,
      discountPercent: 0,
      priceKopecks: svc.priceKopecks,
      isManual: false,
      coefficientEnabled: Boolean(svc.coefficientEnabled),
      coefficientStepKopecks: svc.coefficientStepKopecks ?? 5000,
      lineDiscountEnabled: isLineDiscountTab(tabSlug),
    };
    let next: CartLine[];
    if (exists) {
      next = cartLines.filter((l) => l.serviceId !== id);
    } else if (isMainService && servicesTabId) {
      // Вкладка «Услуги»: только одна позиция — новая заменяет предыдущую
      next = [
        ...cartLines.filter((l) => {
          if (l.isManual || !l.serviceId) return true;
          const other = catalog?.services.find((s) => s.id === l.serviceId);
          return !other || other.tabId !== servicesTabId;
        }),
        newLine,
      ];
    } else {
      next = [...cartLines, newLine];
    }
    setCartLines(next);
    setQty(qtyFromLines(next));
    void persist(next, discountId, staffWasherIds);
  }

  function removeLine(key: string) {
    if (lineDiscountKey === key) {
      setLineDiscountKey(null);
      setLineDiscountManual("");
    }
    const next = cartLines.filter((l) => l.key !== key);
    setCartLines(next);
    setQty(qtyFromLines(next));
    void persist(next, discountId, staffWasherIds);
  }

  function adjustCoefficient(key: string, direction: 1 | -1) {
    const next = cartLines.map((line) => {
      if (line.key !== key || !line.coefficientEnabled || line.isManual) return line;
      const step = line.coefficientStepKopecks ?? 5000;
      const extra = Math.max(0, line.coefficientExtraKopecks + direction * step);
      return {
        ...line,
        coefficientExtraKopecks: extra,
        priceKopecks: priceWithLineDiscount(line.basePriceKopecks, extra, line.discountPercent),
      };
    });
    setCartLines(next);
    void persist(next, discountId, staffWasherIds);
  }

  function setLineDiscount(key: string, percent: number) {
    const pct = clampDiscountPercent(percent);
    const next = cartLines.map((line) => {
      if (line.key !== key || !line.lineDiscountEnabled) return line;
      return {
        ...line,
        discountPercent: pct,
        priceKopecks: priceWithLineDiscount(
          line.basePriceKopecks,
          line.coefficientExtraKopecks,
          pct
        ),
      };
    });
    setCartLines(next);
    setLineDiscountManual(pct ? String(pct) : "");
    void persist(next, discountId, staffWasherIds);
  }

  function openLineDiscount(line: CartLine) {
    if (!line.lineDiscountEnabled) return;
    if (lineDiscountKey === line.key) {
      setLineDiscountKey(null);
      setLineDiscountManual("");
      return;
    }
    setLineDiscountKey(line.key);
    setLineDiscountManual(line.discountPercent ? String(line.discountPercent) : "");
  }

  function toggleStaffWasher(id: string) {
    const next = staffWasherIds.includes(id)
      ? staffWasherIds.filter((x) => x !== id)
      : [...staffWasherIds, id];
    setStaffWasherIds(next);
    void persist(cartLines, discountId, next);
  }

  function addManualLine() {
    const name = manualName.trim();
    const rub = Number(String(manualPriceRub).replace(",", "."));
    if (!name) {
      setError("Укажите название позиции");
      return;
    }
    if (!Number.isFinite(rub) || rub < 0) {
      setError("Укажите цену");
      return;
    }
    const priceKopecks = Math.round(rub * 100);
    const key = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const next: CartLine[] = [
      ...cartLines,
      {
        key,
        serviceId: null,
        name,
        qty: 1,
        basePriceKopecks: priceKopecks,
        coefficientExtraKopecks: 0,
        discountPercent: 0,
        priceKopecks,
        isManual: true,
        coefficientEnabled: false,
        lineDiscountEnabled: false,
      },
    ];
    setCartLines(next);
    setQty(qtyFromLines(next));
    setManualOpen(false);
    setManualName("");
    setManualPriceRub("");
    setError("");
    void persist(next, discountId, staffWasherIds);
  }

  async function changeVehicleClass(classId: string) {
    if (!token || !order || classId === vehicleClassId) return;
    setError("");
    try {
      const updated = await api.setVehicleClass(order.id, classId, token);
      applyOrder(updated);
      setVehicleClassId(classId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сменить класс");
    }
  }

  useEffect(() => {
    if (!token) return;
    const q = clientQuery.trim();
    if (q.length < 2) {
      setClientHits([]);
      return;
    }
    const handle = window.setTimeout(() => {
      setClientSearchBusy(true);
      api
        .searchClients(q, token, 8)
        .then((res) => setClientHits(res.clients))
        .catch(() => setClientHits([]))
        .finally(() => setClientSearchBusy(false));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [clientQuery, token]);

  async function applyClient(client: ClientDto) {
    if (!token || !order) return;
    setError("");
    try {
      const updated = await api.attachClient(order.id, client.id, token);
      applyOrder(updated);
      setAttachedClient(client);
      setClientQuery("");
      setClientHits([]);
      setClientSearchOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось привязать клиента");
    }
  }

  async function clearAttachedClient() {
    if (!token || !order) return;
    try {
      const updated = await api.attachClient(order.id, null, token);
      applyOrder(updated);
      setAttachedClient(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отвязать клиента");
    }
  }

  async function logout() {
    if (token) await api.logout(token).catch(() => undefined);
    forceLogout();
    setError("");
  }

  async function confirmOpenShiftAndPay() {
    if (!token) return;
    setShiftBusy(true);
    setError("");
    try {
      const res = await api.shiftOpen(token);
      setShift(res.shift);
      setOpenShiftPrompt(false);
      setPendingPay(null);
      setTipsRub("0");
      setPayOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось открыть смену");
    } finally {
      setShiftBusy(false);
    }
  }

  async function confirmRollover() {
    if (!token) return;
    setShiftBusy(true);
    setError("");
    try {
      const res = await api.shiftRollover(token);
      setShift(res.shift);
      setRolloverPrompt(false);
      if (res.closedReport) setCloseReport(res.closedReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сменить смену");
    } finally {
      setShiftBusy(false);
    }
  }

  async function handleCloseShift() {
    if (!token || !shift) return;
    setShiftBusy(true);
    setError("");
    setShiftConfirm(null);
    try {
      const report = await api.shiftClose(token);
      setShift(null);
      setCloseReport(report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось закрыть смену");
    } finally {
      setShiftBusy(false);
    }
  }

  async function handleOpenShiftManual() {
    if (!token) return;
    setShiftBusy(true);
    setError("");
    setShiftConfirm(null);
    try {
      const st = await refreshShift(token);
      if (st?.needsRollover) return;
      const res = await api.shiftOpen(token);
      setShift(res.shift);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось открыть смену");
    } finally {
      setShiftBusy(false);
    }
  }

  function handleShiftPillClick() {
    if (shiftBusy || rolloverPrompt || shiftConfirm) return;
    setShiftConfirm(shift ? "close" : "open");
  }

  function formatShiftDate(iso?: string | null) {
    const d = iso ? new Date(iso) : new Date();
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  }

  function formatShiftDateTime(iso?: string | null) {
    if (!iso) return "—";
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  }

  async function onPayClick() {
    setError("");
    if (!token) return;
    if (!cartLines.length) {
      setError("Добавьте позиции в заказ");
      return;
    }
    if (!staffWasherIds.length) {
      setError("Выберите мойщика");
      return;
    }
    try {
      const st = await refreshShift(token);
      if (st?.needsRollover) return;
      if (!st?.shift) {
        setOpenShiftPrompt(true);
        return;
      }
      setPendingPay(null);
      setTipsRub("0");
      setPayOpen(true);
    } catch (e) {
      if (isUnauthorized(e)) forceLogout(e instanceof Error ? e.message : undefined);
      else setError(e instanceof Error ? e.message : "Ошибка смены");
    }
  }

  async function startPay(method: "cash" | "card" | "sbp", emulate?: "success" | "cancel") {
    if (!token || !order) return;
    if (!staffWasherIds.length) {
      setError("Выберите мойщика");
      setPayOpen(false);
      return;
    }
    const tipsKopecks = Math.max(
      0,
      Math.round((Number(String(tipsRub).replace(",", ".")) || 0) * 100)
    );
    setPayBusy(true);
    setError("");
    try {
      await persist();
      await api.checkout(order.id, token);
      const res = await api.pay(
        order.id,
        { method, tipsKopecks, emulateResult: emulate },
        token
      );
      if (res.blocked || res.error) {
        setError(res.error ?? "Оплата недоступна");
        return;
      }
      if (res.cancelled) {
        setPayOpen(false);
        setPendingPay(null);
        return;
      }
      if (res.order?.status === "paid") {
        setPayOpen(false);
        setPendingPay(null);
        const fresh = await api.draft(DRAFT_POST_ID, token);
        applyOrder(fresh);
        setRecentKey((k) => k + 1);
        return;
      }
      if (res.pending && res.payment) {
        setPendingPay({
          paymentId: res.payment.paymentId,
          method: method === "cash" ? "card" : method,
          qrPayload: res.payment.qrPayload,
          message: res.payment.message,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка оплаты");
    } finally {
      setPayBusy(false);
    }
  }

  async function resolvePending(action: "confirm" | "cancel") {
    if (!token || !order || !pendingPay) return;
    setPayBusy(true);
    try {
      const res = await api.resolvePay(
        order.id,
        { paymentId: pendingPay.paymentId, method: pendingPay.method, action },
        token
      );
      if (action === "confirm" && res.order?.status === "paid") {
        setPayOpen(false);
        setPendingPay(null);
        const fresh = await api.draft(DRAFT_POST_ID, token);
        applyOrder(fresh);
        setRecentKey((k) => k + 1);
      } else {
        setPendingPay(null);
        setPayOpen(false);
      }
    } finally {
      setPayBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">{BRAND_NAME}</div>
          <div className="topbar-actions">
            <Link className="topbar-pill" to="/admin">
              Админ
            </Link>
            <WindowControls visible={desktopShell} />
          </div>
        </header>
        <main className="content" style={{ display: "grid", placeItems: "center" }}>
          <div className="panel" style={{ width: "min(420px, 100%)", textAlign: "center" }}>
            <div className="brand" style={{ fontSize: "1.75rem", marginBottom: "0.25rem" }}>
              {BRAND_NAME}
            </div>
            <p className="muted">Введите PIN оператора</p>
            <div className="pin-dots">
              {Array.from({ length: Math.max(4, pin.length || 4) }).map((_, i) => (
                <span key={i} className={i < pin.length ? "filled" : ""} />
              ))}
            </div>
            {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
            <div className="pin-pad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "OK"].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    if (k === "C") setPin("");
                    else if (k === "OK") void submitPin();
                    else if (pin.length < 6) setPin((p) => p + k);
                  }}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <TouchKeyboardProvider>
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">{BRAND_NAME}</div>
          <div className="muted" style={{ fontSize: "0.85rem" }}>
            Оператор{washerName ? `: ${washerName}` : ""} · заказ #{order?.number ?? "—"}
            {selectedClass ? ` · ${selectedClass.name}` : ""}
          </div>
        </div>
        <div className="topbar-actions">
          <span className={`topbar-pill ${online ? "online" : "offline"}`}>
            {online ? "Сеть OK" : "Офлайн"}
            {pendingSync > 0 ? ` · sync ${pendingSync}` : ""}
          </span>
          <button
            type="button"
            className={`topbar-pill ${shift ? "shift-open" : "shift-closed"}`}
            disabled={shiftBusy || rolloverPrompt}
            title={shift ? "Нажмите, чтобы закрыть смену" : "Нажмите, чтобы открыть смену"}
            onClick={() => handleShiftPillClick()}
          >
            {shift ? `Смена ${formatShiftDate(shift.openedAt)}` : "Смена не открыта"}
          </button>
          <Link to="/calendar" className="topbar-pill">
            Календарь
          </Link>
          <Link to="/clients" className="topbar-pill">
            Клиенты
          </Link>
          <Link to="/admin" className="topbar-pill">
            Админ
          </Link>
          <button
            type="button"
            className="topbar-pill topbar-pill--icon"
            onClick={() => void logout()}
            aria-label="Смена PIN"
            title="Смена PIN"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect
                x="5"
                y="11"
                width="14"
                height="10"
                rx="2"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M8 11V8a4 4 0 0 1 8 0v3"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <WindowControls visible={desktopShell} />
        </div>
      </header>

      <main className="content content-wide pos-main">
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

        <div className="pos-toolbar">
          <div className="pos-toolbar-primary">
          <button
            type="button"
            className="icon-btn"
            aria-label="Последние заказы"
            title="Последние заказы"
            onClick={() => setRecentOpen(true)}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 6h12M4 12h12M4 18h8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle cx="18.5" cy="17.5" r="3.5" stroke="currentColor" strokeWidth="2" />
              <path
                d="M18.5 16v1.5l1 1"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <div className="vehicle-class-row" role="group" aria-label="Класс автомобиля">
            {vehicleClasses.map((c) => {
              const src = vehicleClassIconSrc(c.iconKey || c.slug);
              const active = selectedClass?.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`vehicle-class-btn${active ? " active" : ""}`}
                  aria-label={c.name}
                  aria-pressed={active}
                  title={c.name}
                  onClick={() => void changeVehicleClass(c.id)}
                >
                  {src ? (
                    <img src={src} alt="" className="vehicle-class-icon" />
                  ) : (
                    <span className="vehicle-class-fallback">{c.name.slice(0, 1)}</span>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              className="icon-btn vehicle-class-info-btn"
              aria-label="Описание классов авто"
              title="Описание классов"
              onClick={() => setClassInfoOpen(true)}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M12 10.5v5.5M12 7.5h.01"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

            <button
              type="button"
              className={`pwa-next-chip${pwaHasNew ? " pwa-next-chip--new" : ""}${
                !pwaNext ? " pwa-next-chip--empty" : ""
              }`}
              title={
                pwaNext
                  ? `Ближайшая запись PWA${pwaHasNew ? " · новая" : ""}`
                  : "Нет ближайших записей из PWA"
              }
              onClick={() => {
                const stamp = pwaLatestCreatedAt ?? new Date().toISOString();
                writePwaSeenAt(stamp);
                setPwaSeenAt(stamp);
                if (pwaNext) {
                  const day = mskDateParts(new Date(pwaNext.startsAt)).date;
                  navigate(
                    `/calendar?date=${encodeURIComponent(day)}&booking=${encodeURIComponent(pwaNext.id)}`
                  );
                } else {
                  navigate("/calendar");
                }
              }}
            >
              <span className="pwa-next-chip__label">PWA</span>
              <span className="pwa-next-chip__value">
                {pwaNext ? formatPwaNextLabel(pwaNext.startsAt) : "нет записей"}
              </span>
              {pwaHasNew ? <span className="pwa-next-chip__badge" aria-hidden="true" /> : null}
            </button>
          </div>

          <div className="pos-toolbar-nav" aria-label="Разделы">
            <ClientSearchControl
              open={clientSearchOpen}
              onOpenChange={setClientSearchOpen}
              query={clientQuery}
              onQueryChange={setClientQuery}
              hits={clientHits}
              busy={clientSearchBusy}
              attached={attachedClient}
              onApply={(c) => void applyClient(c)}
              onClearAttached={() => void clearAttachedClient()}
            />
            <Link to="/clients" className="icon-btn" aria-label="Клиенты" title="Клиенты">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="9" cy="8" r="3.25" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx="17" cy="9" r="2.5" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M15.2 19c.35-1.7 1.4-2.9 3-3.4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </Link>
          </div>
        </div>

        <div className="pos-layout">
          <section className="panel">
            <div className="catalog-tabs" role="tablist">
              {(catalog?.tabs ?? []).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={(catalogTabId ?? catalog?.tabs[0]?.id) === t.id}
                  className={(catalogTabId ?? catalog?.tabs[0]?.id) === t.id ? "active" : ""}
                  onClick={() => setCatalogTabId(t.id)}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <div className="grid-touch">
              {catalogItems.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`service-chip ${qty[s.id] ? "selected" : ""}`}
                  onClick={() => toggleService(s.id)}
                >
                  <span className="service-chip-text">
                    <span className="service-chip-name">{s.name}</span>
                    {s.description ? (
                      <span className="service-chip-desc">{s.description}</span>
                    ) : null}
                  </span>
                  <strong>{formatRub(s.priceKopecks)}</strong>
                </button>
              ))}
              {catalogItems.length === 0 && (
                <p className="muted" style={{ margin: 0 }}>
                  В этой вкладке пока нет позиций
                </p>
              )}
            </div>
          </section>

          <section className="panel pos-cart-panel">
            <div className="pos-cart-header">
              <h2 className="h2" style={{ margin: 0 }}>
                Заказ
              </h2>
              <button
                type="button"
                className="icon-btn"
                aria-label="Добавить ручную позицию"
                title="Ручная позиция"
                onClick={() => {
                  setManualName("");
                  setManualPriceRub("");
                  setManualOpen(true);
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 5v14M5 12h14"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <div className="pos-cart-list">
              {cartLines.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  Нет выбранных позиций
                </p>
              ) : (
                cartLines.map((line) => {
                  const gross = lineGrossKopecks(line);
                  const discountOpen = lineDiscountKey === line.key;
                  const hasLineDiscount = line.lineDiscountEnabled && line.discountPercent > 0;
                  return (
                    <div
                      key={line.key}
                      className={`pos-cart-line${discountOpen ? " pos-cart-line--open" : ""}${
                        hasLineDiscount ? " pos-cart-line--discounted" : ""
                      }`}
                    >
                      <div
                        className={`pos-cart-line-main${
                          line.lineDiscountEnabled ? " pos-cart-line-main--tap" : ""
                        }`}
                        role={line.lineDiscountEnabled ? "button" : undefined}
                        tabIndex={line.lineDiscountEnabled ? 0 : undefined}
                        onClick={() => openLineDiscount(line)}
                        onKeyDown={(e) => {
                          if (!line.lineDiscountEnabled) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openLineDiscount(line);
                          }
                        }}
                      >
                        <div className="pos-cart-line-text">
                          <span className="pos-cart-line-name">{line.name}</span>
                          {line.description ? (
                            <span className="pos-cart-line-desc">{line.description}</span>
                          ) : null}
                          {line.coefficientExtraKopecks > 0 ? (
                            <span className="pos-cart-line-coeff">
                              Коэффициент +{line.coefficientExtraKopecks / 100} руб
                            </span>
                          ) : null}
                          {hasLineDiscount ? (
                            <span className="pos-cart-line-discount-badge">
                              {line.discountPercent >= 100
                                ? "Подарок"
                                : `Скидка −${line.discountPercent}%`}
                            </span>
                          ) : line.lineDiscountEnabled ? (
                            <span className="pos-cart-line-meta muted">Скидка на позицию…</span>
                          ) : null}
                          {line.qty > 1 ? (
                            <span className="pos-cart-line-meta muted">
                              {formatRub(line.priceKopecks)} × {line.qty}
                            </span>
                          ) : null}
                          {line.coefficientEnabled ? (
                            <div className="pos-cart-coeff-controls">
                              <button
                                type="button"
                                className="pos-cart-coeff-btn"
                                aria-label="Уменьшить коэффициент"
                                disabled={line.coefficientExtraKopecks <= 0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  adjustCoefficient(line.key, -1);
                                }}
                              >
                                −
                              </button>
                              <button
                                type="button"
                                className="pos-cart-coeff-btn"
                                aria-label="Увеличить коэффициент"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  adjustCoefficient(line.key, 1);
                                }}
                              >
                                +
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <div className="pos-cart-line-aside">
                          {hasLineDiscount ? (
                            <span className="pos-cart-line-was muted">
                              {formatRub(gross * line.qty)}
                            </span>
                          ) : null}
                          <strong className="pos-cart-line-sum">
                            {formatRub(line.priceKopecks * line.qty)}
                          </strong>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="pos-cart-line-remove"
                        aria-label="Удалить позицию"
                        title="Удалить"
                        onClick={() => removeLine(line.key)}
                      >
                        ×
                      </button>
                      {discountOpen ? (
                        <div className="pos-cart-line-discount">
                          <div className="pos-cart-line-discount-presets">
                            <button
                              type="button"
                              className={`pos-cart-disc-chip${
                                line.discountPercent === 0 ? " active" : ""
                              }`}
                              onClick={() => setLineDiscount(line.key, 0)}
                            >
                              0%
                            </button>
                            {LINE_DISCOUNT_PRESETS.map((p) => (
                              <button
                                key={p}
                                type="button"
                                className={`pos-cart-disc-chip${
                                  line.discountPercent === p ? " active" : ""
                                }`}
                                onClick={() => setLineDiscount(line.key, p)}
                              >
                                {p}%
                              </button>
                            ))}
                            <button
                              type="button"
                              className={`pos-cart-disc-chip${
                                line.discountPercent === 100 ? " active" : ""
                              }`}
                              onClick={() => setLineDiscount(line.key, 100)}
                            >
                              Подарок
                            </button>
                          </div>
                          <label className="pos-cart-line-discount-manual">
                            <span className="muted">Вручную, %</span>
                            <TouchField
                              title="Скидка %"
                              mode="numeric"
                              placeholder="0–100"
                              value={lineDiscountManual}
                              onChange={(v) => {
                                const cleaned = v.replace(/[^\d]/g, "").slice(0, 3);
                                setLineDiscountManual(cleaned);
                              }}
                            />
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() =>
                                setLineDiscount(line.key, Number(lineDiscountManual || 0))
                              }
                            >
                              Применить
                            </button>
                          </label>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>

            <h2 className="h2" style={{ marginTop: "1rem" }}>
              Мойщики
            </h2>
            <div className="pos-cart-staff-chips">
              {staffWashers.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  Нет активных мойщиков
                </p>
              ) : (
                staffWashers.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    className={`pos-staff-chip${staffWasherIds.includes(w.id) ? " selected" : ""}`}
                    onClick={() => toggleStaffWasher(w.id)}
                  >
                    {w.name}
                  </button>
                ))
              )}
            </div>

            <h2 className="h2" style={{ marginTop: "1rem" }}>
              Скидка
            </h2>
            <select
              className="discount-select"
              value={discountId ?? ""}
              onChange={(e) => {
                const v = e.target.value || null;
                setDiscountId(v);
                void persist(cartLines, v, staffWasherIds);
              }}
            >
              <option value="">Без скидки</option>
              {catalog?.discounts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>

            <div className="pos-cart-totals">
              <div className="pos-cart-total-row">
                <span className="muted">Подытог</span>
                <span>{formatRub(order?.subtotalKopecks ?? subtotal)}</span>
              </div>
              <div className="pos-cart-total-row">
                <span className="muted">Скидка</span>
                <span>−{formatRub(order?.discountKopecks ?? 0)}</span>
              </div>
              <div className="pos-cart-total-row pos-cart-total-row-final">
                <span className="muted">Итого</span>
                <span>{formatRub(order?.totalKopecks ?? subtotal)}</span>
              </div>
            </div>

            <button
              type="button"
              className="btn-primary"
              style={{ width: "100%", marginTop: "1.25rem" }}
              disabled={!cartLines.length || !staffWasherIds.length || rolloverPrompt}
              onClick={() => void onPayClick()}
            >
              Оплата
            </button>
          </section>
        </div>
      </main>

      {recentOpen && token && (
        <div className="drawer-backdrop" onClick={() => setRecentOpen(false)}>
          <aside
            className="drawer-panel drawer-panel-right"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Последние заказы"
          >
            <div className="drawer-header">
              <h2 className="h2" style={{ margin: 0 }}>
                Последние заказы
              </h2>
              <button
                type="button"
                className="icon-btn"
                aria-label="Закрыть"
                onClick={() => setRecentOpen(false)}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <RecentOrdersPanel token={token} refreshKey={recentKey} embedded />
          </aside>
        </div>
      )}

      {shiftConfirm === "open" && (
        <div className="modal-backdrop">
          <div className="modal stack">
            <h2 className="h2">Открытие смены</h2>
            <p style={{ margin: 0 }}>
              Будет открыта новая кассовая смена на{" "}
              <strong>{formatShiftDate()}</strong>. Продажи и оплаты будут привязаны к этой смене.
            </p>
            <button
              type="button"
              className="btn-primary"
              disabled={shiftBusy}
              onClick={() => void handleOpenShiftManual()}
            >
              Открыть
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={shiftBusy}
              onClick={() => setShiftConfirm(null)}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {shiftConfirm === "close" && shift && (
        <div className="modal-backdrop">
          <div className="modal stack">
            <h2 className="h2">Закрытие смены</h2>
            <p style={{ margin: 0 }}>
              Смена <strong>{formatShiftDate(shift.openedAt)}</strong> будет закрыта.
              {shift.openedByName ? (
                <>
                  {" "}
                  Открыл: <strong>{shift.openedByName}</strong>
                  {shift.openedAt ? ` (${formatShiftDateTime(shift.openedAt)})` : ""}.
                </>
              ) : null}{" "}
              После закрытия покажется краткий отчёт по продажам.
            </p>
            <button
              type="button"
              className="btn-primary"
              disabled={shiftBusy}
              onClick={() => void handleCloseShift()}
            >
              Закрыть
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={shiftBusy}
              onClick={() => setShiftConfirm(null)}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {rolloverPrompt && (
        <div className="modal-backdrop">
          <div className="modal stack">
            <h2 className="h2">Смена за прошлый день</h2>
            <p style={{ margin: 0 }}>
              Вчерашняя смена не была закрыта. Она будет закрыта, и откроется новая смена на сегодня.
              Работа кассы не блокируется после подтверждения.
            </p>
            <button
              type="button"
              className="btn-primary"
              disabled={shiftBusy}
              onClick={() => void confirmRollover()}
            >
              Понятно, продолжить
            </button>
          </div>
        </div>
      )}

      {openShiftPrompt && (
        <div className="modal-backdrop">
          <div className="modal stack">
            <h2 className="h2">Открытие смены</h2>
            <p style={{ margin: 0 }}>
              Смена ещё не открыта. При продолжении будет открыта новая смена, затем можно принять
              оплату.
            </p>
            <button
              type="button"
              className="btn-primary"
              disabled={shiftBusy}
              onClick={() => void confirmOpenShiftAndPay()}
            >
              Открыть смену и оплатить
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={shiftBusy}
              onClick={() => setOpenShiftPrompt(false)}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {closeReport && (
        <div className="modal-backdrop">
          <div className="modal modal-wide stack">
            <ShiftReportView report={closeReport as ShiftReport} title="Отчёт по смене" />
            <button type="button" className="btn-primary" onClick={() => setCloseReport(null)}>
              Готово
            </button>
          </div>
        </div>
      )}

      {classInfoOpen && (
        <div className="drawer-backdrop" onClick={() => setClassInfoOpen(false)}>
          <aside
            className="drawer-panel drawer-panel-right"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Классификация авто"
          >
            <div className="drawer-header">
              <h2 className="h2" style={{ margin: 0 }}>
                Классификация авто
              </h2>
              <button
                type="button"
                className="icon-btn"
                aria-label="Закрыть"
                onClick={() => setClassInfoOpen(false)}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <ul className="class-info-list">
              {vehicleClasses.map((c) => {
                const src = vehicleClassIconSrc(c.iconKey || c.slug);
                return (
                  <li key={c.id} className="class-info-item">
                    {src ? <img src={src} alt="" /> : <span />}
                    <div>
                      <strong>{c.name}</strong>
                      <p className="muted">{c.description || "—"}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
      )}

      {payOpen && (
        <div className="modal-backdrop">
          <div className="modal stack">
            <h2 className="h2">Способ оплаты</h2>
            <p className="muted" style={{ margin: 0 }}>
              Услуги {formatRub(order?.totalKopecks ?? 0)}
            </p>
            {!pendingPay && (
              <div className="pay-tips">
                <div className="muted" style={{ marginBottom: "0.35rem" }}>
                  Чаевые
                  {staffWasherIds.length > 1
                    ? ` · на ${staffWasherIds.length} мойщиков поровну`
                    : ""}
                </div>
                <div className="pay-tips__presets">
                  {[0, 50, 100, 200].map((rub) => (
                    <button
                      key={rub}
                      type="button"
                      className={`pay-tips__chip${tipsRub === String(rub) ? " active" : ""}`}
                      disabled={payBusy}
                      onClick={() => setTipsRub(String(rub))}
                    >
                      {rub === 0 ? "Без" : `${rub} ₽`}
                    </button>
                  ))}
                </div>
                <TouchField
                  className="pay-tips__custom"
                  mode="numeric"
                  title="Чаевые, ₽"
                  placeholder="Своя сумма, ₽"
                  value={tipsRub === "0" || ["50", "100", "200"].includes(tipsRub) ? "" : tipsRub}
                  onChange={(v) => setTipsRub(v.replace(/[^\d.,]/g, "") || "0")}
                />
              </div>
            )}
            <p style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700 }}>
              К оплате{" "}
              {formatRub(
                (order?.totalKopecks ?? 0) +
                  Math.max(0, Math.round((Number(String(tipsRub).replace(",", ".")) || 0) * 100))
              )}
            </p>
            {!online && (
              <p style={{ color: "var(--warning)", margin: 0 }}>Нет сети — СБП недоступен</p>
            )}

            {pendingPay ? (
              <>
                <p>{pendingPay.message}</p>
                {pendingPay.qrPayload && (
                  <p className="muted" style={{ wordBreak: "break-all", fontSize: "0.8rem" }}>
                    QR: {pendingPay.qrPayload}
                  </p>
                )}
                <button
                  type="button"
                  className="btn-success"
                  disabled={payBusy}
                  onClick={() => void resolvePending("confirm")}
                >
                  Подтвердить оплату
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={payBusy}
                  onClick={() => void resolvePending("cancel")}
                >
                  Отмена
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={payBusy}
                  onClick={() => void startPay("cash")}
                >
                  Наличные
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={payBusy}
                  onClick={() => void startPay("card")}
                >
                  Карта (терминал)
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={payBusy || !online}
                  onClick={() => void startPay("sbp")}
                >
                  QR / СБП
                </button>
                <button type="button" className="btn-ghost" onClick={() => setPayOpen(false)}>
                  Закрыть
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {manualOpen && (
        <div className="modal-backdrop">
          <div className="modal stack">
            <h2 className="h2">Ручная позиция</h2>
            <TouchField
              placeholder="Название"
              title="Название"
              mode="text"
              value={manualName}
              onChange={setManualName}
            />
            <TouchField
              placeholder="Цена ₽"
              title="Цена ₽"
              mode="numeric"
              value={manualPriceRub}
              onChange={setManualPriceRub}
            />
            <button type="button" className="btn-primary" onClick={() => addManualLine()}>
              Добавить
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setManualOpen(false);
                setManualName("");
                setManualPriceRub("");
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
    </TouchKeyboardProvider>
  );
}

function ClientSearchControl({
  open,
  onOpenChange,
  query,
  onQueryChange,
  hits,
  busy,
  attached,
  onApply,
  onClearAttached,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (q: string) => void;
  hits: ClientDto[];
  busy: boolean;
  attached: ClientDto | null;
  onApply: (c: ClientDto) => void;
  onClearAttached: () => void;
}) {
  const kb = useTouchKeyboard();
  const rootRef = useRef<HTMLDivElement>(null);

  function collapse() {
    onOpenChange(false);
    onQueryChange("");
    kb.close();
  }

  function expand() {
    onOpenChange(true);
    kb.open({
      mode: "text",
      title: "Телефон, номер или имя",
      value: query,
      onChange: onQueryChange,
      layout: "ru",
    });
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      // Клавиатура рендерится вне блока поиска — не сворачивать по тапу по ней
      if (target instanceof Element && target.closest(".osk-backdrop")) return;
      if (!query.trim()) {
        onOpenChange(false);
        kb.close();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, query, onOpenChange, kb]);

  return (
    <div
      ref={rootRef}
      className={`client-search${open ? " client-search--open" : ""}${attached ? " client-search--attached" : ""}`}
    >
      {!open ? (
        <button
          type="button"
          className={`icon-btn${attached ? " active" : ""}`}
          aria-label="Поиск клиента"
          title={attached ? `Клиент: ${attached.plateNumber ?? attached.phone ?? attached.name ?? "привязан"}` : "Поиск клиента"}
          onClick={expand}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
            <path
              d="M16.5 16.5 20 20"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : (
        <>
          <div className="client-search__row">
            <TouchField
              className="client-search__input"
              value={query}
              onChange={onQueryChange}
              placeholder="Телефон, номер или имя"
              title="Поиск клиента"
            />
            <button
              type="button"
              className="icon-btn client-search__close"
              aria-label="Свернуть поиск"
              title="Свернуть"
              onClick={collapse}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M6 6l12 12M18 6 6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          {attached && !query && (
            <div className="client-search__attached">
              <span>
                {(attached.vehicles?.length
                  ? attached.vehicles.map((v) => v.plateNumber).join(" · ")
                  : attached.plateNumber) ?? "—"}
                {attached.name ? ` · ${attached.name}` : ""}
                {attached.phone ? ` · ${attached.phone}` : ""}
                {attached.activeTariffNames?.length
                  ? ` · ${attached.activeTariffNames.join(", ")}`
                  : ""}
              </span>
              <button type="button" className="client-search__clear" onClick={onClearAttached}>
                ×
              </button>
            </div>
          )}
          {(hits.length > 0 || busy) && query.trim().length >= 2 && (
            <div className="client-search__dropdown" role="listbox">
              {busy && <div className="client-search__hint">Поиск…</div>}
              {hits.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="client-search__hit"
                  onClick={() => onApply(c)}
                >
                  <strong>
                    {(c.vehicles?.length
                      ? c.vehicles.map((v) => v.plateNumber).join(" · ")
                      : c.plateNumber) ?? "без номера"}
                  </strong>
                  <span>{[c.name, c.phone].filter(Boolean).join(" · ") || "Клиент"}</span>
                </button>
              ))}
              {!busy && hits.length === 0 && (
                <div className="client-search__hint">Ничего не найдено</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
