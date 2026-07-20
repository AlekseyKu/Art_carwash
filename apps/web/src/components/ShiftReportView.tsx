import { formatRub, type ShiftReport } from "@art/shared";
import { useState } from "react";

const PAY_LABEL: Record<string, string> = {
  cash: "Наличные",
  card: "Карта",
  sbp: "СБП",
  unknown: "Другое",
};

function payLabel(m: string | null | undefined) {
  if (!m) return "—";
  return PAY_LABEL[m] ?? m;
}

function fmtDt(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

type Props = {
  report: ShiftReport;
  /** Компактный заголовок без лишних кнопок */
  title?: string;
};

export function ShiftReportView({ report, title }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { shift, totalKopecks, orderCount, byPaymentMethod, orders } = report;

  return (
    <div className="stack shift-report">
      {title ? <h2 className="h2">{title}</h2> : null}
      <p style={{ margin: 0 }}>
        Смена{" "}
        <strong>{shift.status === "open" ? "открыта" : "закрыта"}</strong>
        {" · "}
        {fmtDt(shift.openedAt)}
        {shift.closedAt ? ` → ${fmtDt(shift.closedAt)}` : ""}
      </p>
      <p className="muted" style={{ margin: 0 }}>
        Открыл: {shift.openedByName ?? "—"}
        {shift.closedByName ? ` · закрыл: ${shift.closedByName}` : ""}
      </p>
      <p style={{ margin: 0 }}>
        Выручка <strong>{formatRub(totalKopecks)}</strong> · чеков {orderCount}
      </p>
      {byPaymentMethod.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
          {byPaymentMethod.map((b) => (
            <li key={b.label}>
              {payLabel(b.label)}: {formatRub(b.totalKopecks)} ({b.count})
            </li>
          ))}
        </ul>
      )}

      <h3 className="h2" style={{ marginBottom: 0 }}>
        Чеки
      </h3>
      {orders.length === 0 ? (
        <p className="muted">Нет оплаченных заказов за смену</p>
      ) : (
        <ul className="shift-order-list">
          {orders.map((o) => {
            const expanded = openId === o.id;
            return (
              <li key={o.id} className="shift-order-item">
                <button
                  type="button"
                  className="shift-order-toggle"
                  aria-expanded={expanded}
                  onClick={() => setOpenId(expanded ? null : o.id)}
                >
                  <span>
                    #{o.number}
                    {o.plateNumber ? ` · ${o.plateNumber}` : ""}
                    {" · "}
                    {payLabel(o.paymentMethod)}
                  </span>
                  <span>
                    {formatRub(o.totalKopecks)}
                    <span className="muted" style={{ marginLeft: "0.5rem" }}>
                      {expanded ? "▲" : "▼"}
                    </span>
                  </span>
                </button>
                {expanded && (
                  <div className="shift-order-details">
                    <p className="muted" style={{ margin: "0 0 0.35rem" }}>
                      {fmtDt(o.paidAt)} · {o.washerName ?? "—"}
                    </p>
                    <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                      {o.items.map((i, idx) => (
                        <li key={`${o.id}-${idx}`}>
                          {i.nameSnapshot}
                          {i.qty > 1 ? ` ×${i.qty}` : ""} — {formatRub(i.lineTotalKopecks)}
                        </li>
                      ))}
                    </ul>
                    {o.discountKopecks > 0 && (
                      <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                        Скидка −{formatRub(o.discountKopecks)}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
