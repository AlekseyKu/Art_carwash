import { formatRub } from "@art/shared";
import { useEffect, useMemo, useState } from "react";
import {
  adminApi,
  api,
  type CatalogItemDto,
  type CatalogTabDto,
  type ClientDto,
  type TariffDetailDto,
  type TariffDto,
  type TariffPriceDto,
  type VehicleClassDto,
} from "../api";
import { vehicleClassIconSrc } from "../vehicleClassIcons";
import { TouchField } from "./OnScreenKeyboard";

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatPeriod(from: string, to: string | null) {
  const fmt = (s: string) => {
    const [y, m, d] = s.split("-");
    return `${d}.${m}.${y}`;
  };
  if (!to) return `с ${fmt(from)}`;
  return `${fmt(from)} — ${fmt(to)}`;
}

type Props = {
  token: string;
  services: CatalogItemDto[];
  catalogTabs: CatalogTabDto[];
  vehicleClasses: VehicleClassDto[];
  onError: (msg: string) => void;
  removeWithConfirm: (msg: string, action: () => Promise<void>) => void;
};

export function TariffsAdminPanel({
  token,
  services,
  catalogTabs,
  vehicleClasses,
  onError,
  removeWithConfirm,
}: Props) {
  const [tariffs, setTariffs] = useState<TariffDto[]>([]);
  const [clients, setClients] = useState<ClientDto[]>([]);
  const [editing, setEditing] = useState<TariffDetailDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [validFrom, setValidFrom] = useState(todayYmd());
  const [validTo, setValidTo] = useState("");
  const [active, setActive] = useState(true);
  const [classId, setClassId] = useState("");
  const [priceTabSlug, setPriceTabSlug] = useState<"services" | "extra-services">("services");
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [clientQuery, setClientQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [addClientsOpen, setAddClientsOpen] = useState(false);
  const [validToHintOpen, setValidToHintOpen] = useState(false);

  const hasExtrasTab = useMemo(
    () => catalogTabs.some((t) => t.slug === "extra-services"),
    [catalogTabs]
  );

  const pricedServicesForTab = useMemo(() => {
    const tab = catalogTabs.find((t) => t.slug === priceTabSlug);
    if (!tab) return [];
    return services.filter((s) => s.tabId === tab.id && s.active !== false);
  }, [services, catalogTabs, priceTabSlug]);

  const activeClasses = useMemo(
    () => vehicleClasses.filter((c) => c.active !== false),
    [vehicleClasses]
  );

  async function reload() {
    const [list, cl] = await Promise.all([
      adminApi.tariffs(token),
      api.listClients(token, 200),
    ]);
    setTariffs(list);
    setClients(cl.clients);
  }

  useEffect(() => {
    void reload().catch((e) => onError(e instanceof Error ? e.message : "Ошибка тарифов"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!classId && activeClasses[0]) setClassId(activeClasses[0].id);
  }, [activeClasses, classId]);

  useEffect(() => {
    if (!validToHintOpen) return;
    const close = () => setValidToHintOpen(false);
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", close);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", close);
    };
  }, [validToHintOpen]);

  function openCreate() {
    setCreating(true);
    setEditing(null);
    setName("");
    setValidFrom(todayYmd());
    setValidTo("");
    setActive(true);
    setPriceTabSlug("services");
    setPriceDraft({});
    setClientIds([]);
    setAddClientsOpen(false);
    setClientQuery("");
    setValidToHintOpen(false);
  }

  async function openEdit(id: string) {
    try {
      const t = await adminApi.tariff(token, id);
      setCreating(false);
      setEditing(t);
      setValidToHintOpen(false);
      setName(t.name);
      setValidFrom(t.validFrom);
      setValidTo(t.validTo ?? "");
      setActive(t.active);
      setClientIds(t.clientIds);
      setPriceTabSlug("services");
      setAddClientsOpen(false);
      setClientQuery("");
      const draft: Record<string, string> = {};
      for (const p of t.prices) {
        draft[`${p.classId}:${p.serviceId}`] = String(p.priceKopecks / 100);
      }
      setPriceDraft(draft);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Не удалось открыть тариф");
    }
  }

  function collectPrices(): TariffPriceDto[] {
    const out: TariffPriceDto[] = [];
    for (const [key, raw] of Object.entries(priceDraft)) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const n = Number(trimmed.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) continue;
      const [cid, sid] = key.split(":");
      if (!cid || !sid) continue;
      out.push({ classId: cid, serviceId: sid, priceKopecks: Math.round(n * 100) });
    }
    return out;
  }

  async function save() {
    setSaving(true);
    try {
      await adminApi.saveTariff(
        token,
        {
          name: name.trim(),
          validFrom,
          validTo: validTo.trim() || null,
          active,
          prices: collectPrices(),
          clientIds,
        },
        editing?.id
      );
      setCreating(false);
      setEditing(null);
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Не удалось сохранить тариф");
    } finally {
      setSaving(false);
    }
  }

  const formOpen = creating || editing;
  const filteredClients = clientQuery.trim()
    ? clients.filter((c) => {
        const q = clientQuery.trim().toLowerCase();
        return (
          (c.name ?? "").toLowerCase().includes(q) ||
          (c.phone ?? "").includes(q) ||
          (c.plateNumber ?? "").toLowerCase().includes(q)
        );
      })
    : clients;

  return (
    <div className={`stack tariffs-admin${formOpen ? " tariffs-admin--editing" : " panel"}`}>
      {!formOpen && (
        <div className="row tariffs-admin__head">
          <h2 className="h2">Тарифы</h2>
          <button type="button" className="btn-primary tariffs-admin__btn" onClick={openCreate}>
            Создать тариф
          </button>
        </div>
      )}

      {!formOpen && (
        <table className="table">
          <thead>
            <tr>
              <th>Название</th>
              <th>Период</th>
              <th>Цены</th>
              <th>Клиенты</th>
              <th className="table-actions">Действия</th>
            </tr>
          </thead>
          <tbody>
            {tariffs.map((t) => (
              <tr key={t.id}>
                <td>
                  {t.name}
                  {!t.active ? " (выкл)" : ""}
                </td>
                <td>{formatPeriod(t.validFrom, t.validTo)}</td>
                <td>{t.priceCount}</td>
                <td>{t.clientCount}</td>
                <td className="table-actions">
                  <div className="row table-actions-row">
                    <button
                      type="button"
                      className="btn-secondary tariffs-admin__btn"
                      onClick={() => void openEdit(t.id)}
                    >
                      Изменить
                    </button>
                    <button
                      type="button"
                      className="btn-ghost tariffs-admin__btn"
                      onClick={() =>
                        void removeWithConfirm(`Выключить тариф «${t.name}»?`, async () => {
                          const detail = await adminApi.tariff(token, t.id);
                          await adminApi.saveTariff(
                            token,
                            {
                              name: detail.name,
                              validFrom: detail.validFrom,
                              validTo: detail.validTo,
                              active: !detail.active,
                              prices: detail.prices,
                              clientIds: detail.clientIds,
                            },
                            detail.id
                          );
                          await reload();
                        })
                      }
                    >
                      {t.active ? "Выкл" : "Вкл"}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost tariffs-admin__btn"
                      onClick={() =>
                        void removeWithConfirm(`Удалить тариф «${t.name}»?`, async () => {
                          await adminApi.deleteTariff(token, t.id);
                          await reload();
                        })
                      }
                    >
                      Удалить
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {tariffs.length === 0 && (
              <tr>
                <td colSpan={5}>Пока нет тарифов</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {formOpen && (
        <div className="stack tariffs-admin__form" style={{ gap: 16 }}>
          <h2 className="h2" style={{ margin: 0 }}>
            {editing ? "Изменить тариф" : "Новый тариф"}
          </h2>

          <div className="tariffs-admin__split">
            <div className="panel stack tariffs-admin__main">
              <div className="tariffs-admin__meta">
                <span className="tariffs-admin__meta-label">Название</span>
                <span className="tariffs-admin__meta-label">С</span>
                <div className="tariffs-admin__meta-label tariffs-admin__label-with-info">
                  <span>До</span>
                  <button
                    type="button"
                    className="tariffs-admin__info"
                    aria-expanded={validToHintOpen}
                    aria-controls="tariff-valid-to-hint"
                    aria-label="Подсказка по дате окончания"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setValidToHintOpen((v) => !v);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                      <path
                        d="M12 10.5v5.5M12 7.5h.01"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                  {validToHintOpen && (
                    <span
                      id="tariff-valid-to-hint"
                      className="tariffs-admin__hint"
                      role="tooltip"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      Пустое значение — бессрочно
                    </span>
                  )}
                </div>
                <span className="tariffs-admin__meta-label tariffs-admin__meta-label--center">
                  Активность
                </span>

                <TouchField
                  className="tariffs-admin__meta-control"
                  value={name}
                  onChange={setName}
                  placeholder="Такси-2026"
                  title="Название"
                />
                <input
                  className="tariffs-admin__meta-control"
                  type="date"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                  aria-label="С"
                />
                <input
                  id="tariff-valid-to"
                  className="tariffs-admin__meta-control"
                  type="date"
                  value={validTo}
                  onChange={(e) => setValidTo(e.target.value)}
                  aria-label="До"
                />
                <label
                  className="admin-toggle tariffs-admin__meta-control tariffs-admin__meta-toggle"
                  title="Активность тарифа"
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                  />
                  <span className="admin-toggle__ui" />
                </label>
              </div>

              <div className="vehicle-class-row tariffs-admin__class-row" role="group" aria-label="Класс автомобиля">
                {activeClasses.map((c) => {
                  const src = vehicleClassIconSrc(c.iconKey || c.slug);
                  const selected = classId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`vehicle-class-btn${selected ? " active" : ""}`}
                      aria-label={c.name}
                      aria-pressed={selected}
                      title={c.name}
                      onClick={() => setClassId(c.id)}
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

              <div className="catalog-tabs">
                <button
                  type="button"
                  className={priceTabSlug === "services" ? "active" : ""}
                  onClick={() => setPriceTabSlug("services")}
                >
                  Услуги
                </button>
                {hasExtrasTab && (
                  <button
                    type="button"
                    className={priceTabSlug === "extra-services" ? "active" : ""}
                    onClick={() => setPriceTabSlug("extra-services")}
                  >
                    Доп.услуги
                  </button>
                )}
              </div>

              <p className="muted" style={{ margin: 0 }}>
                Спец.цены для выбранного класса (пусто = цена из матрицы)
              </p>

              <table className="table">
                <thead>
                  <tr>
                    <th>{priceTabSlug === "extra-services" ? "Доп.услуга" : "Услуга"}</th>
                    <th className="table-field">Цена ₽</th>
                  </tr>
                </thead>
                <tbody>
                  {pricedServicesForTab.map((s) => {
                    const key = `${classId}:${s.id}`;
                    return (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td className="table-field">
                          <TouchField
                            placeholder="—"
                            title={`Цена: ${s.name}`}
                            mode="numeric"
                            value={priceDraft[key] ?? ""}
                            onChange={(v) =>
                              setPriceDraft((prev) => ({ ...prev, [key]: v }))
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {pricedServicesForTab.length === 0 && (
                <p className="muted" style={{ margin: 0 }}>
                  {priceTabSlug === "extra-services"
                    ? "Нет доп.услуг — добавьте их во вкладке «Доп.услуги»."
                    : "Нет услуг — добавьте их во вкладке «Услуги»."}
                </p>
              )}
            </div>

            <aside className="panel stack tariffs-admin__clients-panel">
              <div className="pos-cart-header tariffs-admin__clients-head">
                <h2 className="h2" style={{ margin: 0 }}>
                  Клиенты тарифа
                </h2>
                <button
                  type="button"
                  className="btn-secondary tariffs-admin__btn"
                  onClick={() => {
                    setAddClientsOpen((v) => !v);
                    setClientQuery("");
                  }}
                >
                  {addClientsOpen ? "Закрыть" : "Добавить"}
                </button>
              </div>

              <ul className="tariffs-admin__assigned">
                {clientIds.map((id) => {
                  const c = clients.find((x) => x.id === id);
                  const plates =
                    c?.vehicles?.length
                      ? c.vehicles.map((v) => v.plateNumber).join(" · ")
                      : c?.plateNumber || "—";
                  return (
                    <li key={id} className="tariffs-admin__assigned-row">
                      <div className="tariffs-admin__assigned-info">
                        <strong>{c?.name || "без имени"}</strong>
                        <span>{plates}</span>
                        <span className="muted">{c?.phone || "—"}</span>
                      </div>
                      <button
                        type="button"
                        className="pos-cart-line-remove"
                        aria-label="Убрать клиента"
                        title="Убрать"
                        onClick={() => setClientIds((prev) => prev.filter((x) => x !== id))}
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
                {clientIds.length === 0 && (
                  <li className="muted tariffs-admin__assigned-empty">Клиенты не назначены</li>
                )}
              </ul>

              {addClientsOpen && (
                <div className="stack tariffs-admin__add-block">
                  <TouchField
                    className="tariffs-admin__search"
                    title="Поиск"
                    value={clientQuery}
                    onChange={setClientQuery}
                    placeholder="телефон / номер / имя"
                  />
                  <div className="tariffs-admin__client-list">
                    {filteredClients
                      .filter((c) => !clientIds.includes(c.id))
                      .slice(0, 40)
                      .map((c) => {
                        const plates =
                          c.vehicles?.length
                            ? c.vehicles.map((v) => v.plateNumber).join(" · ")
                            : c.plateNumber || "—";
                        return (
                          <button
                            key={c.id}
                            type="button"
                            className="service-chip tariffs-admin__pick-chip"
                            onClick={() => {
                              setClientIds((prev) => [...prev, c.id]);
                            }}
                          >
                            <span className="service-chip-text">
                              <strong>{c.name || "без имени"}</strong>
                              <span className="muted">{plates}</span>
                              <span className="muted">{c.phone || "—"}</span>
                            </span>
                          </button>
                        );
                      })}
                    {filteredClients.filter((c) => !clientIds.includes(c.id)).length === 0 && (
                      <span className="muted">Нет клиентов для добавления</span>
                    )}
                  </div>
                </div>
              )}
            </aside>
          </div>

          <div className="row tariffs-admin__footer">
            <button
              type="button"
              className="btn-primary tariffs-admin__btn"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "…" : "Сохранить"}
            </button>
            <button
              type="button"
              className="btn-secondary tariffs-admin__btn"
              onClick={() => {
                setCreating(false);
                setEditing(null);
                setAddClientsOpen(false);
              }}
            >
              Отмена
            </button>
          </div>
          {editing && (
            <p className="muted">
              Оверрайдов: {collectPrices().length}. Пример цены:{" "}
              {collectPrices()[0] ? formatRub(collectPrices()[0].priceKopecks) : "—"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
