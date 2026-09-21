import { formatRub } from "@art/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  api,
  getWasherToken,
  isUnauthorized,
  type BookingDto,
  type CatalogItemDto,
  type CatalogTabDto,
  type ClientDto,
  type VehicleClassDto,
} from "../api";
import { TouchField, TouchKeyboardProvider } from "../components/OnScreenKeyboard";
import { vehicleClassIconSrc } from "../vehicleClassIcons";

function mskToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00+03:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function formatDayTitle(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${date}T12:00:00+03:00`));
}

function formatMskClock(d = new Date()) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function LiveMskClock() {
  const [clock, setClock] = useState(() => formatMskClock());
  useEffect(() => {
    const tick = () => setClock(formatMskClock());
    const id = window.setInterval(tick, 15_000);
    // выравнивание на границу минуты
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    const align = window.setTimeout(() => {
      tick();
    }, msToNextMinute + 50);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(align);
    };
  }, []);
  return <span className="calendar-day-clock">{clock}</span>;
}

function formatSlotTime(startsAt: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(startsAt));
}

function statusLabel(status: string) {
  switch (status) {
    case "booked":
      return "бронь";
    case "arrived":
      return "прибыл";
    case "in_service":
      return "в работе";
    case "cancelled":
      return "отмена";
    case "completed":
      return "готово";
    case "no_show":
      return "неявка";
    default:
      return status;
  }
}

function CloseIconButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label="Закрыть"
      title="Закрыть"
      disabled={disabled}
      onClick={onClick}
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
  );
}

function durationOf(s: CatalogItemDto, fallback: number) {
  return s.durationMinutes && s.durationMinutes > 0 ? s.durationMinutes : fallback;
}

export function CalendarPage() {
  const navigate = useNavigate();
  const token = getWasherToken();
  const [date, setDate] = useState(mskToday());
  const [slots, setSlots] = useState<
    { time: string; startsAt: string; booking: BookingDto | null }[]
  >([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftStartsAt, setDraftStartsAt] = useState<string | null>(null);
  const [servicePicker, setServicePicker] = useState<"main" | "addons" | null>(null);

  const [classes, setClasses] = useState<VehicleClassDto[]>([]);
  const [tabs, setTabs] = useState<CatalogTabDto[]>([]);
  const [services, setServices] = useState<CatalogItemDto[]>([]);
  const [classId, setClassId] = useState("");
  const [mainId, setMainId] = useState("");
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [clientHits, setClientHits] = useState<ClientDto[]>([]);

  const load = useCallback(async () => {
    if (!token) {
      navigate("/", { replace: true });
      return;
    }
    try {
      const res = await api.bookingsDay(token, date);
      setSlots(res.slots);
    } catch (e) {
      if (isUnauthorized(e)) {
        navigate("/", { replace: true });
        return;
      }
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    }
  }, [token, date, navigate]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    setDraftStartsAt(null);
    setSelectedId(null);
  }, [date]);

  useEffect(() => {
    void api
      .catalog()
      .then((c) => {
        setClasses(c.vehicleClasses.filter((x) => x.active !== false));
        setTabs(c.tabs);
        const def =
          c.vehicleClasses.find((x) => x.slug === "sedan") ?? c.vehicleClasses[0];
        if (def && !classId) setClassId(def.id);
      })
      .catch(() => {
        /* каталог подтянется при выборе класса */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial class only
  }, []);

  useEffect(() => {
    if (!classId) return;
    void api
      .catalog(classId)
      .then((c) => {
        setServices(c.services);
        setTabs(c.tabs);
        setClasses(c.vehicleClasses.filter((x) => x.active !== false));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Каталог"));
  }, [classId]);

  useEffect(() => {
    if (!token || !clientQuery.trim() || clientQuery.trim().length < 2) {
      setClientHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void api
        .searchClients(clientQuery.trim(), token, 8)
        .then((r) => setClientHits(r.clients))
        .catch(() => setClientHits([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [clientQuery, token]);

  const servicesTab = useMemo(
    () => tabs.find((t) => t.slug === "services" && t.active),
    [tabs]
  );
  const extrasTab = useMemo(
    () => tabs.find((t) => t.slug === "extra-services" && t.active),
    [tabs]
  );

  const mainServices = useMemo(() => {
    if (!servicesTab) return [];
    return services
      .filter((s) => s.active && s.tabId === servicesTab.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [services, servicesTab]);

  const addonServices = useMemo(() => {
    if (!extrasTab) return [];
    return services
      .filter((s) => s.active && s.tabId === extrasTab.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [services, extrasTab]);

  useEffect(() => {
    if (!draftStartsAt) return;
    if (mainId && mainServices.some((s) => s.id === mainId)) return;
    const first = mainServices[0]?.id ?? "";
    setMainId(first);
    setAddonIds([]);
  }, [draftStartsAt, mainServices, mainId]);

  const durationMinutes = useMemo(() => {
    const main = mainServices.find((s) => s.id === mainId);
    if (!main) return 0;
    let d = durationOf(main, 60);
    for (const id of addonIds) {
      const a = addonServices.find((s) => s.id === id);
      if (a) d += durationOf(a, 15);
    }
    return d;
  }, [mainServices, addonServices, mainId, addonIds]);

  const totalKopecks = useMemo(() => {
    const main = mainServices.find((s) => s.id === mainId);
    if (!main) return 0;
    let sum = main.priceKopecks;
    for (const id of addonIds) {
      const a = addonServices.find((s) => s.id === id);
      if (a) sum += a.priceKopecks;
    }
    return sum;
  }, [mainServices, addonServices, mainId, addonIds]);

  const selected = slots.find((s) => s.booking?.id === selectedId)?.booking ?? null;

  function pickClient(c: ClientDto) {
    setCustomerId(c.id);
    setCustomerName(c.name ?? "");
    setCustomerPhone(c.phone ?? "");
    setPlateNumber(c.plateNumber ?? "");
    setClientQuery("");
    setClientHits([]);
  }

  function resetDraftForm() {
    setMainId("");
    setAddonIds([]);
    setCustomerId(null);
    setCustomerName("");
    setCustomerPhone("");
    setPlateNumber("");
    setClientQuery("");
    setClientHits([]);
    setServicePicker(null);
  }

  async function onArrive() {
    if (!token || !selected) return;
    setBusy(true);
    setError("");
    try {
      await api.arriveBooking(token, selected.id, 1);
      setSelectedId(null);
      await load();
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (!token || !selected) return;
    if (!window.confirm("Отменить бронь?")) return;
    setBusy(true);
    setError("");
    try {
      await api.cancelBooking(token, selected.id);
      setSelectedId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function onCreate() {
    if (!token || !draftStartsAt || !mainId || !classId) return;
    const main = mainServices.find((s) => s.id === mainId);
    if (!main) return;
    const items = [
      {
        serviceId: main.id,
        serviceName: main.name,
        kind: "main" as const,
        priceKopecks: main.priceKopecks,
        durationMinutes: durationOf(main, 60),
      },
      ...addonIds
        .map((id) => addonServices.find((s) => s.id === id))
        .filter((s): s is CatalogItemDto => !!s)
        .map((a) => ({
          serviceId: a.id,
          serviceName: a.name,
          kind: "addon" as const,
          priceKopecks: a.priceKopecks,
          durationMinutes: durationOf(a, 15),
        })),
    ];

    setBusy(true);
    setError("");
    try {
      const created = await api.createBooking(token, {
        startsAt: draftStartsAt,
        durationMinutes,
        customerId,
        customerName: customerName.trim() || null,
        customerPhone: customerPhone.trim() || null,
        plateNumber: plateNumber.trim() || null,
        classId,
        items,
      });
      setDraftStartsAt(null);
      resetDraftForm();
      setSelectedId(created.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать запись");
    } finally {
      setBusy(false);
    }
  }

  return (
    <TouchKeyboardProvider>
      <div className="app-shell calendar-page">
        <header className="topbar">
          <div className="brand">Календарь записи</div>
          <div className="topbar-actions">
            <Link to="/" className="topbar-pill">
              Касса
            </Link>
            <Link to="/clients" className="topbar-pill">
              Клиенты
            </Link>
            <Link to="/admin" className="topbar-pill">
              Админ
            </Link>
          </div>
        </header>

        <main className="content calendar-content">
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

          <div className="calendar-day-nav">
            <div className="calendar-day-title">
              <strong>{formatDayTitle(date)}</strong>
              <span className="calendar-day-meta muted">
                <span>{date}</span>
                <LiveMskClock />
              </span>
            </div>
            <div className="calendar-day-nav__actions">
              <button
                type="button"
                className="icon-btn"
                aria-label="Предыдущий день"
                title="Предыдущий день"
                onClick={() => setDate((d) => addDays(d, -1))}
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M15 6 9 12l6 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="Следующий день"
                title="Следующий день"
                onClick={() => setDate((d) => addDays(d, 1))}
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="m9 6 6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="icon-btn calendar-day-nav__today"
                onClick={() => setDate(mskToday())}
              >
                Сегодня
              </button>
            </div>
          </div>

          <div className="calendar-body">
            <div className="calendar-grid-scroll">
              {slots.length === 0 ? (
                <p className="muted" style={{ margin: "1rem 0" }}>
                  В этот день мойка не работает — слотов нет.
                </p>
              ) : (
                <div className="calendar-slots" role="list">
                  {slots.map((row) => {
                    const b = row.booking;
                    const isDraft = !b && draftStartsAt === row.startsAt;
                    const isSelected = !!b && selectedId === b.id;
                    return (
                      <button
                        key={row.startsAt}
                        type="button"
                        role="listitem"
                        title={
                          b
                            ? `${b.plateNumber || b.customerName || "Запись"} · ${statusLabel(b.status)}`
                            : "Свободно — создать запись"
                        }
                        className={`calendar-slot${b ? " calendar-slot--busy" : ""}${
                          isSelected ? " calendar-slot--selected" : ""
                        }${isDraft ? " calendar-slot--draft" : ""}`}
                        onClick={() => {
                          if (b) {
                            setSelectedId(b.id);
                            setDraftStartsAt(null);
                          } else {
                            setSelectedId(null);
                            setError("");
                            setAddonIds([]);
                            setServicePicker(null);
                            setDraftStartsAt(row.startsAt);
                            setMainId(mainServices[0]?.id ?? "");
                          }
                        }}
                      >
                        {row.time}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <aside className="calendar-side panel stack" aria-label="Карточка записи">
              {draftStartsAt && servicePicker === "main" ? (
                <>
                  <div className="calendar-side__head">
                    <h2 className="h2">Основная услуга</h2>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setServicePicker(null)}
                    >
                      Назад
                    </button>
                  </div>
                  <div className="calendar-service-pick-list">
                    {mainServices.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`calendar-service-pick${mainId === s.id ? " active" : ""}`}
                        onClick={() => {
                          setMainId(s.id);
                          setServicePicker(null);
                        }}
                      >
                        <span className="calendar-service-pick__name">{s.name}</span>
                        <span className="calendar-service-pick__meta">
                          {formatRub(s.priceKopecks)} · {durationOf(s, 60)} мин
                        </span>
                      </button>
                    ))}
                    {mainServices.length === 0 && (
                      <p className="muted">Нет услуг с ценой для этого класса</p>
                    )}
                  </div>
                </>
              ) : draftStartsAt && servicePicker === "addons" ? (
                <>
                  <div className="calendar-side__head">
                    <h2 className="h2">Дополнительно</h2>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setServicePicker(null)}
                    >
                      Назад
                    </button>
                  </div>
                  <p className="muted" style={{ margin: 0 }}>
                    Можно выбрать несколько
                  </p>
                  <div className="calendar-service-pick-list">
                    {addonServices.map((s) => {
                      const on = addonIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className={`calendar-service-pick${on ? " active" : ""}`}
                          aria-pressed={on}
                          onClick={() =>
                            setAddonIds((ids) =>
                              on ? ids.filter((x) => x !== s.id) : [...ids, s.id]
                            )
                          }
                        >
                          <span className="calendar-service-pick__name">{s.name}</span>
                          <span className="calendar-service-pick__meta">
                            {formatRub(s.priceKopecks)} · {durationOf(s, 15)} мин
                          </span>
                        </button>
                      );
                    })}
                    {addonServices.length === 0 && (
                      <p className="muted">Нет доп. услуг с ценой для этого класса</p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setServicePicker(null)}
                  >
                    Готово
                    {addonIds.length > 0 ? ` · ${addonIds.length}` : ""}
                  </button>
                </>
              ) : draftStartsAt ? (
                <>
                  <div className="calendar-side__head">
                    <h2 className="h2">Новая запись · {formatSlotTime(draftStartsAt)}</h2>
                    <CloseIconButton
                      disabled={busy}
                      onClick={() => {
                        setDraftStartsAt(null);
                        resetDraftForm();
                        setError("");
                      }}
                    />
                  </div>
                  {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

                  <div className="stack" style={{ gap: 6 }}>
                    <span className="muted">Класс авто</span>
                    <div className="vehicle-class-row" role="group" aria-label="Класс автомобиля">
                      {classes.map((c) => {
                        const src = vehicleClassIconSrc(c.iconKey || c.slug);
                        const active = classId === c.id;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            className={`vehicle-class-btn${active ? " active" : ""}`}
                            aria-label={c.name}
                            aria-pressed={active}
                            title={c.name}
                            onClick={() => {
                              setClassId(c.id);
                              setMainId("");
                              setAddonIds([]);
                            }}
                          >
                            {src ? (
                              <img src={src} alt="" className="vehicle-class-icon" />
                            ) : (
                              <span className="vehicle-class-fallback">{c.name.slice(0, 1)}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <label className="stack" style={{ gap: 4 }}>
                    <span className="muted">Клиент (поиск)</span>
                    <TouchField
                      value={clientQuery}
                      onChange={setClientQuery}
                      placeholder="Телефон, номер или имя"
                    />
                  </label>
                  {clientHits.length > 0 && (
                    <ul className="calendar-client-hits">
                      {clientHits.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => pickClient(c)}
                          >
                            {[c.plateNumber, c.name, c.phone].filter(Boolean).join(" · ") ||
                              c.id}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="calendar-create-grid">
                    <label className="stack" style={{ gap: 4 }}>
                      <span className="muted">Госномер</span>
                      <TouchField
                        value={plateNumber}
                        onChange={(v) => setPlateNumber(v.toUpperCase())}
                        placeholder="А170РТ90"
                      />
                    </label>
                    <label className="stack" style={{ gap: 4 }}>
                      <span className="muted">Телефон</span>
                      <TouchField
                        value={customerPhone}
                        onChange={setCustomerPhone}
                        placeholder="+7…"
                        mode="numeric"
                      />
                    </label>
                    <label className="stack" style={{ gap: 4 }}>
                      <span className="muted">Имя</span>
                      <TouchField
                        value={customerName}
                        onChange={setCustomerName}
                        placeholder="Имя"
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    className={`calendar-pick-btn${mainId ? " calendar-pick-btn--filled" : ""}`}
                    onClick={() => setServicePicker("main")}
                  >
                    <span className="calendar-pick-btn__label">Основная услуга</span>
                    <span className="calendar-pick-btn__value">
                      {(() => {
                        const main = mainServices.find((s) => s.id === mainId);
                        if (!main) return "Выберите →";
                        return `${main.name} · ${formatRub(main.priceKopecks)}`;
                      })()}
                    </span>
                  </button>

                  <button
                    type="button"
                    className={`calendar-pick-btn${
                      addonIds.length ? " calendar-pick-btn--filled" : ""
                    }`}
                    onClick={() => setServicePicker("addons")}
                    disabled={addonServices.length === 0}
                  >
                    <span className="calendar-pick-btn__label">Дополнительно</span>
                    <span className="calendar-pick-btn__value">
                      {addonServices.length === 0
                        ? "Нет доп. услуг"
                        : addonIds.length === 0
                          ? "Не выбрано →"
                          : (() => {
                              const names = addonIds
                                .map((id) => addonServices.find((s) => s.id === id)?.name)
                                .filter(Boolean);
                              if (names.length <= 2) return names.join(", ");
                              return `${names[0]}, ${names[1]} +${names.length - 2}`;
                            })()}
                    </span>
                  </button>

                  <p>
                    <strong>
                      {durationMinutes} мин · {formatRub(totalKopecks)}
                    </strong>
                    {!mainId && <span className="muted"> · выберите основную услугу</span>}
                  </p>

                  <div className="row gap">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busy || !mainId}
                      onClick={() => {
                        setError("");
                        void onCreate();
                      }}
                    >
                      Записать
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() => {
                        setDraftStartsAt(null);
                        resetDraftForm();
                        setError("");
                      }}
                    >
                      Отмена
                    </button>
                  </div>
                </>
              ) : selected ? (
                <>
                  <div className="calendar-side__head">
                    <h2 className="h2">Запись</h2>
                    <CloseIconButton onClick={() => setSelectedId(null)} />
                  </div>
                  {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
                  <p className="calendar-side__when">
                    <strong>
                      {formatSlotTime(selected.startsAt)}
                      {selected.endsAt ? ` – ${formatSlotTime(selected.endsAt)}` : ""}
                    </strong>
                    <span className="muted"> · {statusLabel(selected.status)}</span>
                  </p>
                  <p>
                    {selected.plateNumber || "—"}
                    <span className="muted">
                      {" "}
                      · {selected.source === "pwa" ? "PWA" : "касса"}
                    </span>
                  </p>
                  <p className="muted">
                    {selected.customerName || "Без имени"}
                    {selected.customerPhone ? ` · ${selected.customerPhone}` : ""}
                  </p>
                  <ul className="calendar-side__items">
                    {selected.items.map((it) => (
                      <li key={it.id}>
                        {it.kind === "main" ? "●" : "○"} {it.serviceName} ({it.durationMinutes}{" "}
                        мин)
                        {it.priceKopecks != null ? ` · ${formatRub(it.priceKopecks)}` : ""}
                      </li>
                    ))}
                  </ul>
                  {selected.totalKopecks != null && (
                    <p>
                      <strong>{formatRub(selected.totalKopecks)}</strong>
                    </p>
                  )}
                  <div className="row gap">
                    {selected.status === "booked" && (
                      <>
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={busy}
                          onClick={() => void onArrive()}
                        >
                          Прибыл → в заказ
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() => void onCancel()}
                        >
                          Отменить
                        </button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <div className="calendar-side__empty muted">
                  <p>Выберите свободный слот, чтобы создать запись, или нажмите на бронь слева
                    — здесь появятся детали.</p>
                </div>
              )}
            </aside>
          </div>
        </main>
      </div>
    </TouchKeyboardProvider>
  );
}
