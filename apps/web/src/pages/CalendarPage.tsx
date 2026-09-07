import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  api,
  getWasherToken,
  isUnauthorized,
  type BookingDto,
} from "../api";

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

  const selected = slots.find((s) => s.booking?.id === selectedId)?.booking ?? null;

  // collapse consecutive rows of same booking for display
  const rows: { time: string; booking: BookingDto | null; spanStart: boolean }[] = [];
  let lastId: string | null = null;
  for (const s of slots) {
    const id = s.booking?.id ?? null;
    rows.push({
      time: s.time,
      booking: s.booking,
      spanStart: id !== lastId,
    });
    lastId = id;
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

  return (
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
            return (
              <div key={row.time} className="calendar-row">
                <div className="calendar-time">{row.time}</div>
                <button
                  type="button"
                  className={`calendar-cell${b ? " calendar-cell--busy" : ""}${
                    b && selectedId === b.id ? " calendar-cell--selected" : ""
                  }`}
                  onClick={() => {
                    if (b) setSelectedId(b.id);
                    else setSelectedId(null);
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
                    <span className="muted">свободно</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {selected && (
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
  );
}
