import { BRAND_NAME, formatRub, type ShiftReport } from "@art/shared";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  getWasherToken,
  isUnauthorized,
  setWasherToken,
  type OrderDto,
  type OrderItemInput,
  type ShiftDto,
  type ShiftReportDto,
  type VehicleClassDto,
} from "../api";
import { RecentOrdersPanel } from "../components/RecentOrdersPanel";
import { ShiftReportView } from "../components/ShiftReportView";
import { TouchField, TouchKeyboardProvider } from "../components/OnScreenKeyboard";
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
  priceKopecks: number;
  isManual: boolean;
  coefficientEnabled?: boolean;
  coefficientStepKopecks?: number;
};

/** Черновик всегда на одном «посту» — выбор постов в UI убран. */
const DRAFT_POST_ID = 1;

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
    const extra = Math.max(0, i.coefficientExtraKopecks ?? 0);
    const base =
      i.basePriceKopecks != null
        ? Math.max(0, i.basePriceKopecks)
        : Math.max(0, i.priceKopecks - extra);
    return {
      key: isManual ? (i.id ?? `manual-${idx}-${i.nameSnapshot}`) : String(i.serviceId),
      serviceId: isManual ? null : i.serviceId,
      name: i.nameSnapshot,
      description: svc?.description ?? "",
      qty: i.qty,
      basePriceKopecks: base,
      coefficientExtraKopecks: extra,
      priceKopecks: i.priceKopecks,
      isManual,
      coefficientEnabled: Boolean(svc?.coefficientEnabled) && !isManual,
      coefficientStepKopecks: svc?.coefficientStepKopecks ?? 5000,
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
  const [staffWasherIds, setStaffWasherIds] = useState<string[]>([]);
  const [discountId, setDiscountId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualPriceRub, setManualPriceRub] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [pendingPay, setPendingPay] = useState<{
    paymentId: string;
    method: "card" | "sbp";
    qrPayload?: string;
    message?: string;
  } | null>(null);
  const [recentKey, setRecentKey] = useState(0);
  const [recentOpen, setRecentOpen] = useState(false);
  const [classInfoOpen, setClassInfoOpen] = useState(false);
  const [catalogTabId, setCatalogTabId] = useState<string | null>(null);
  const [shift, setShift] = useState<ShiftDto | null>(null);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [openShiftPrompt, setOpenShiftPrompt] = useState(false);
  const [rolloverPrompt, setRolloverPrompt] = useState(false);
  const [closeReport, setCloseReport] = useState<ShiftReportDto | null>(null);
  const [shiftConfirm, setShiftConfirm] = useState<"open" | "close" | null>(null);
  const [vehicleClassId, setVehicleClassId] = useState<string | null>(null);

  const vehicleClasses = catalog?.vehicleClasses ?? [];

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
    setStaffWasherIds([]);
    setDiscountId(null);
    setPayOpen(false);
    setPendingPay(null);
    setRecentOpen(false);
    setClassInfoOpen(false);
    setVehicleClassId(null);
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
      .catalog(vehicleClassId ?? undefined)
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
  }, [token, vehicleClassId]);

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
        const coefficientEnabled = Boolean(svc.coefficientEnabled);
        const coefficientStepKopecks = svc.coefficientStepKopecks ?? 5000;
        const description = svc.description ?? "";
        if (
          line.coefficientEnabled === coefficientEnabled &&
          line.coefficientStepKopecks === coefficientStepKopecks &&
          (line.description ?? "") === description
        ) {
          return line;
        }
        changed = true;
        return {
          ...line,
          description,
          coefficientEnabled,
          coefficientStepKopecks,
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
      priceKopecks: svc.priceKopecks,
      isManual: false,
      coefficientEnabled: Boolean(svc.coefficientEnabled),
      coefficientStepKopecks: svc.coefficientStepKopecks ?? 5000,
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
        priceKopecks: line.basePriceKopecks + extra,
      };
    });
    setCartLines(next);
    void persist(next, discountId, staffWasherIds);
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
        priceKopecks,
        isManual: true,
        coefficientEnabled: false,
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
    setPayBusy(true);
    setError("");
    try {
      await persist();
      await api.checkout(order.id, token);
      const res = await api.pay(order.id, { method, emulateResult: emulate }, token);
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
          <Link to="/admin" className="topbar-pill">
            Админ
          </Link>
          <button type="button" className="topbar-pill" onClick={() => void logout()}>
            Смена PIN
          </button>
          <WindowControls visible={desktopShell} />
        </div>
      </header>

      <main className="content content-wide pos-main">
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

        <div className="pos-toolbar">
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
                cartLines.map((line) => (
                  <div key={line.key} className="pos-cart-line">
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
                            onClick={() => adjustCoefficient(line.key, -1)}
                          >
                            −
                          </button>
                          <button
                            type="button"
                            className="pos-cart-coeff-btn"
                            aria-label="Увеличить коэффициент"
                            onClick={() => adjustCoefficient(line.key, 1)}
                          >
                            +
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <div className="pos-cart-line-aside">
                      <strong className="pos-cart-line-sum">
                        {formatRub(line.priceKopecks * line.qty)}
                      </strong>
                      <button
                        type="button"
                        className="pos-cart-line-remove"
                        aria-label="Удалить позицию"
                        title="Удалить"
                        onClick={() => removeLine(line.key)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))
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
            <p className="muted">К оплате {formatRub(order?.totalKopecks ?? 0)}</p>
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
