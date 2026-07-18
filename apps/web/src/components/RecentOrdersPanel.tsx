import { formatRub } from "@art/shared";
import { useCallback, useEffect, useState } from "react";
import { api, type RecentOrderDto } from "../api";

const PAY_LABEL: Record<string, string> = {
  cash: "Нал",
  card: "Карта",
  sbp: "СБП",
};

const STATUS_LABEL: Record<string, string> = {
  paid: "Оплачен",
  cancelled: "Отменён",
  awaiting_payment: "Ожидает",
};

function formatTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

type Props = {
  token: string;
  refreshKey?: number;
  /** Без своей рамки/заголовка — для drawer */
  embedded?: boolean;
};

export function RecentOrdersPanel({ token, refreshKey = 0, embedded = false }: Props) {
  const [orders, setOrders] = useState<RecentOrderDto[]>([]);

  const load = useCallback(() => {
    api
      .recentOrders(token, 5)
      .then((r) => setOrders(r.orders))
      .catch(() => undefined);
  }, [token]);

  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load, refreshKey]);

  const body = (
    <>
      {orders.length === 0 && (
        <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
          Пока нет завершённых заказов
        </p>
      )}
      <ul className="recent-orders-list">
        {orders.map((o) => (
          <li key={o.id} className={`recent-order-item status-${o.status}`}>
            <div className="recent-order-top">
              <strong>#{o.number}</strong>
              <span className="recent-order-sum">{formatRub(o.totalKopecks)}</span>
            </div>
            <div className="recent-order-meta muted">
              <span>{STATUS_LABEL[o.status] ?? o.status}</span>
              {o.paymentMethod && <span>· {PAY_LABEL[o.paymentMethod] ?? o.paymentMethod}</span>}
              <span>· {formatTime(o.paidAt ?? o.updatedAt)}</span>
            </div>
            {(o.plateNumber || o.itemsPreview.length > 0) && (
              <div className="recent-order-extra">
                {o.plateNumber && <span className="recent-plate">{o.plateNumber}</span>}
                {o.itemsPreview.length > 0 && (
                  <span className="muted">{o.itemsPreview.join(", ")}</span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );

  if (embedded) {
    return <div className="recent-orders-embedded">{body}</div>;
  }

  return (
    <aside className="panel recent-orders-panel">
      <h2 className="h2">Последние заказы</h2>
      {body}
    </aside>
  );
}
