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
    setError("");
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
    if (mainId && !mainServices.some((s) => s.id === mainId)) {
      setMainId("");
      setAddonIds([]);
    }
  }, [mainServices, mainId]);

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

  const rows: { time: string; startsAt: string; booking: BookingDto | null; spanStart: boolean }[] =
    [];
  let lastId: string | null = null;
  for (const s of slots) {
    const id = s.booking?.id ?? null;
    rows.push({
      time: s.time,
      startsAt: s.startsAt,
      booking: s.booking,
      spanStart: id !== lastId,
    });
    lastId = id;
  }

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
      <div className="page calendar-page">
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

        <main className="content">
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

          <div className="calendar-day-nav">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setDate((d) => addDays(d, -1))}
            >
              ←
            </button>
            <div className="calendar-day-title">
              <strong>{formatDayTitle(date)}</strong>
              <span className="muted">{date} · Europe/Moscow</span>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setDate((d) => addDays(d, 1))}
            >
              →
            </button>
            <button type="button" className="btn-secondary" onClick={() => setDate(mskToday())}>
              Сегодня
            </button>
          </div>

          <div className="calendar-grid">
            {rows.map((row) => {
              if (row.booking && !row.spanStart) {
                return (
                  <div key={`${row.time}-cont`} className="calendar-row calendar-row--cont">
                    <div className="calendar-time">{row.time}</div>
                    <div className="calendar-cell calendar-cell--cont" />
                  </div>
                );
              }
              const b = row.booking;
              const isDraft = !b && draftStartsAt === row.startsAt;
              return (
                <div key={row.time} className="calendar-row">
                  <div className="calendar-time">{row.time}</div>
                  <button
                    type="button"
                    className={`calendar-cell${b ? " calendar-cell--busy" : ""}${
                      b && selectedId === b.id ? " calendar-cell--selected" : ""
                    }${isDraft ? " calendar-cell--draft" : ""}`}
                    onClick={() => {
                      if (b) {
                        setSelectedId(b.id);
                        setDraftStartsAt(null);
                      } else {
                        setSelectedId(null);
                        setDraftStartsAt(row.startsAt);
                      }
                    }}
                  >
                    {b ? (
                      <>
                        <span className="calendar-cell__title">
                          {b.plateNumber || b.customerName || "Запись"} · {statusLabel(b.status)}
                        </span>
                        <span className="calendar-cell__meta">
                          {b.source === "pwa" ? "PWA" : "касса"}
                          {b.customerPhone ? ` · ${b.customerPhone}` : ""}
                          {b.items[0] ? ` · ${b.items[0].serviceName}` : ""}
                        </span>
                      </>
                    ) : (
                      <span className={isDraft ? "" : "muted"}>
                        {isDraft ? "новая запись…" : "свободно — нажмите, чтобы записать"}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {draftStartsAt && (
            <div className="panel stack calendar-detail calendar-create">
              <h2 className="h2">Новая запись · {formatSlotTime(draftStartsAt)}</h2>

              <label className="stack" style={{ gap: 4 }}>
                <span className="muted">Класс авто</span>
                <select
                  value={classId}
                  onChange={(e) => {
                    setClassId(e.target.value);
                    setMainId("");
                    setAddonIds([]);
                  }}
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="stack" style={{ gap: 4 }}>
                <span className="muted">Клиент (поиск)</span>
                <TouchField
                  value={clientQuery}
                  onChange={setClientQuery}
                  placeholder="Телефон или госномер"
                />
              </label>
              {clientHits.length > 0 && (
                <ul className="calendar-client-hits">
                  {clientHits.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="btn-secondary" onClick={() => pickClient(c)}>
                        {[c.plateNumber, c.name, c.phone].filter(Boolean).join(" · ") || c.id}
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
                  <TouchField value={customerName} onChange={setCustomerName} placeholder="Имя" />
                </label>
              </div>

              <div className="stack" style={{ gap: 6 }}>
                <span className="muted">Основная услуга</span>
                <div className="calendar-service-list">
                  {mainServices.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`calendar-service-chip${mainId === s.id ? " active" : ""}`}
                      onClick={() => setMainId(s.id)}
                    >
                      {s.name}
                      <span className="muted">
                        {formatRub(s.priceKopecks)} · {durationOf(s, 60)} мин
                      </span>
                    </button>
                  ))}
                  {mainServices.length === 0 && (
                    <span className="muted">Нет услуг с ценой для этого класса</span>
                  )}
                </div>
              </div>

              {addonServices.length > 0 && (
                <div className="stack" style={{ gap: 6 }}>
                  <span className="muted">Дополнительно</span>
                  <div className="calendar-service-list">
                    {addonServices.map((s) => {
                      const on = addonIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className={`calendar-service-chip${on ? " active" : ""}`}
                          onClick={() =>
                            setAddonIds((ids) =>
                              on ? ids.filter((x) => x !== s.id) : [...ids, s.id]
                            )
                          }
                        >
                          {s.name}
                          <span className="muted">
                            {formatRub(s.priceKopecks)} · {durationOf(s, 15)} мин
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <p>
                <strong>
                  {durationMinutes} мин · {formatRub(totalKopecks)}
                </strong>
              </p>

              <div className="row gap">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || !mainId}
                  onClick={() => void onCreate()}
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
                  }}
                >
                  Отмена
                </button>
              </div>
            </div>
          )}

          {selected && !draftStartsAt && (
            <div className="panel stack calendar-detail">
              <h2 className="h2">Запись</h2>
              <p>
                {selected.plateNumber || "—"} · {statusLabel(selected.status)} · {selected.source}
              </p>
              <p className="muted">
                {selected.customerName || "Без имени"}
                {selected.customerPhone ? ` · ${selected.customerPhone}` : ""}
              </p>
              <ul>
                {selected.items.map((it) => (
                  <li key={it.id}>
                    {it.kind === "main" ? "●" : "○"} {it.serviceName} ({it.durationMinutes} мин)
                  </li>
                ))}
              </ul>
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
                <button type="button" className="btn-secondary" onClick={() => setSelectedId(null)}>
                  Закрыть
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </TouchKeyboardProvider>
  );
}
