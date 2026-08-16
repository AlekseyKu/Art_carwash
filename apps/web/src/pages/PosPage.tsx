import { BRAND_NAME, formatRub, type ShiftReport } from "@art/shared";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  getWasherToken,
  isUnauthorized,
  setWasherToken,
  type OrderDto,
  type ShiftDto,
  type ShiftReportDto,
  type VehicleClassDto,
} from "../api";
import { RecentOrdersPanel } from "../components/RecentOrdersPanel";
import { ShiftReportView } from "../components/ShiftReportView";
import { WindowControls } from "../components/WindowControls";
import { vehicleClassIconSrc } from "../vehicleClassIcons";

type Catalog = Awaited<ReturnType<typeof api.catalog>>;

/** Черновик всегда на одном «посту» — выбор постов в UI убран. */
const DRAFT_POST_ID = 1;

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
  const [discountId, setDiscountId] = useState<string | null>(null);
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
        setOrder(o);
        const map: Record<string, number> = {};
        for (const i of o.items ?? []) map[i.serviceId] = i.qty;
        setQty(map);
        setDiscountId(o.discountId);
        if (o.vehicleClassId) setVehicleClassId(o.vehicleClassId);
      })
      .catch((e) => {
        if (isUnauthorized(e)) forceLogout(e.message);
        else setError(e.message);
      });
    refreshShift(token).catch((e) => {
      if (isUnauthorized(e)) forceLogout(e.message);
    });
  }, [token]);

  const subtotal = useMemo(() => {
    if (!catalog) return 0;
    return catalog.services.reduce((s, svc) => s + svc.priceKopecks * (qty[svc.id] ?? 0), 0);
  }, [catalog, qty]);

  function applyOrder(o: OrderDto) {
    setOrder(o);
    const map: Record<string, number> = {};
    for (const i of o.items ?? []) map[i.serviceId] = i.qty;
    setQty(map);
    setDiscountId(o.discountId);
    if (o.vehicleClassId) setVehicleClassId(o.vehicleClassId);
  }

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

  async function persist(nextQty = qty, nextDisc = discountId) {
    if (!token || !order) return;
    const items = Object.entries(nextQty)
      .filter(([, q]) => q > 0)
      .map(([serviceId, q]) => ({ serviceId, qty: q }));
    const updated = await api.saveOrder(order.id, { items, discountId: nextDisc }, token);
    applyOrder(updated);
  }

  function toggleService(id: string) {
    const next = { ...qty, [id]: qty[id] ? 0 : 1 };
    setQty(next);
    void persist(next, discountId);
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
        setQty({});
        setDiscountId(null);
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
        setQty({});
        setDiscountId(null);
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
            <p className="muted">Введите PIN мойщика</p>
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
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">{BRAND_NAME}</div>
          <div className="muted" style={{ fontSize: "0.85rem" }}>
            {washerName || "Мойщик"} · заказ #{order?.number ?? "—"}
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

      <main className="content content-wide">
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
                  <span>{s.name}</span>
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

          <section className="panel">
            <h2 className="h2">Скидка</h2>
            <select
              className="discount-select"
              value={discountId ?? ""}
              onChange={(e) => {
                const v = e.target.value || null;
                setDiscountId(v);
                void persist(qty, v);
              }}
            >
              <option value="">Без скидки</option>
              {catalog?.discounts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>

            <div style={{ marginTop: "1.25rem" }}>
              <div className="muted">Подытог</div>
              <div>{formatRub(order?.subtotalKopecks ?? subtotal)}</div>
              <div className="muted" style={{ marginTop: "0.5rem" }}>
                Скидка
              </div>
              <div>−{formatRub(order?.discountKopecks ?? 0)}</div>
              <div className="muted" style={{ marginTop: "0.5rem" }}>
                Итого
              </div>
              <div style={{ fontSize: "1.75rem", fontWeight: 800 }}>
                {formatRub(order?.totalKopecks ?? subtotal)}
              </div>
            </div>

            <button
              type="button"
              className="btn-primary"
              style={{ width: "100%", marginTop: "1.25rem" }}
              disabled={!order?.items?.length || rolloverPrompt}
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
    </div>
  );
}
