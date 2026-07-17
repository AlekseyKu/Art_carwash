import { useEffect, useState } from "react";
import { api, type AnprEventDto, type ClientDto, type OrderDto } from "../api";

type Props = {
  token: string;
  orderId: string | null;
  attachedClientId: string | null;
  onAttached: (order: OrderDto) => void;
  onError: (msg: string) => void;
};

function formatVisit(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ClientSidePanel({
  token,
  orderId,
  attachedClientId,
  onAttached,
  onError,
}: Props) {
  const [event, setEvent] = useState<AnprEventDto | null>(null);
  const [manualPlate, setManualPlate] = useState("");
  const [client, setClient] = useState<ClientDto | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      api
        .anprLatest(token)
        .then((r) => {
          if (!cancelled && r.event) {
            setEvent(r.event);
            if (r.event.client) setClient(r.event.client);
          }
        })
        .catch(() => {
          /* тихо: офлайн/сеть */
        });
    };
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token]);

  async function searchManual() {
    if (!manualPlate.trim()) return;
    setBusy(true);
    try {
      const res = await api.clientByPlate(manualPlate.trim(), token);
      if (res.client) {
        setClient(res.client);
      } else {
        const created = await api.upsertClient({ plate: manualPlate.trim() }, token);
        setClient(created);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Ошибка поиска");
    } finally {
      setBusy(false);
    }
  }

  async function simulateEntry() {
    setBusy(true);
    try {
      const plate = manualPlate.trim() || "А123ВС777";
      const ev = await api.anprEvent({ plate, confidence: 0.97, source: "emulator" });
      setEvent(ev);
      setClient(ev.client);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Ошибка эмуляции");
    } finally {
      setBusy(false);
    }
  }

  async function attach() {
    if (!orderId || !client) return;
    setBusy(true);
    try {
      const order = await api.attachClient(orderId, client.id, token);
      onAttached(order);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Не удалось привязать");
    } finally {
      setBusy(false);
    }
  }

  async function clearAttach() {
    if (!orderId) return;
    setBusy(true);
    try {
      const order = await api.attachClient(orderId, null, token);
      onAttached(order);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  const isAttached = Boolean(attachedClientId && client && attachedClientId === client.id);

  return (
    <aside className="panel client-panel">
      <h2 className="h2">Клиент · въезд</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
        Камера ANPR или ручной ввод госномера
      </p>

      {event && (
        <div className="anpr-badge">
          <span className="anpr-plate">{event.plateNormalized || event.plate}</span>
          <span className="muted" style={{ fontSize: "0.75rem" }}>
            {event.source}
            {event.confidence != null ? ` · ${Math.round(event.confidence * 100)}%` : ""}
          </span>
        </div>
      )}

      {!client && (
        <p className="muted" style={{ fontSize: "0.9rem" }}>
          Ожидание автомобиля на въезде…
        </p>
      )}

      {client && (
        <div className="client-card stack">
          <div>
            <div className="muted" style={{ fontSize: "0.75rem" }}>
              Госномер
            </div>
            <div className="client-plate">{client.plateNumber ?? "—"}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: "0.75rem" }}>
              Имя
            </div>
            <div>{client.name ?? "Новый клиент"}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: "0.75rem" }}>
              Телефон
            </div>
            <div>{client.phone ?? "—"}</div>
          </div>
          <div className="client-stats">
            <div>
              <div className="muted" style={{ fontSize: "0.75rem" }}>
                Визиты
              </div>
              <strong>{client.visitCount}</strong>
            </div>
            <div>
              <div className="muted" style={{ fontSize: "0.75rem" }}>
                Баллы
              </div>
              <strong>{client.points}</strong>
            </div>
            <div>
              <div className="muted" style={{ fontSize: "0.75rem" }}>
                Скидка
              </div>
              <strong>{client.personalDiscountPercent}%</strong>
            </div>
          </div>
          <div className="muted" style={{ fontSize: "0.8rem" }}>
            Уровень: {client.tier} · был: {formatVisit(client.lastVisitAt)}
          </div>

          {isAttached ? (
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void clearAttach()}>
              Отвязать от заказа
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !orderId}
              onClick={() => void attach()}
            >
              Привязать к заказу
            </button>
          )}
        </div>
      )}

      <div className="stack" style={{ marginTop: "1rem" }}>
        <input
          placeholder="Госномер вручную"
          value={manualPlate}
          onChange={(e) => setManualPlate(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void searchManual()}
        />
        <div className="row">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void searchManual()}>
            Найти
          </button>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => void simulateEntry()}>
            Эмуляция въезда
          </button>
        </div>
      </div>
    </aside>
  );
}
