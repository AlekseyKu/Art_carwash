import { BRAND_NAME } from "@art/shared";
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  adminApi,
  api,
  getWasherToken,
  isUnauthorized,
  setWasherToken,
  type ClientDto,
  type TariffDto,
} from "../api";
import { TouchField, TouchKeyboardProvider } from "../components/OnScreenKeyboard";
import { WindowControls } from "../components/WindowControls";

type DraftVehicle = {
  key: string;
  id?: string;
  plate: string;
  isDefault: boolean;
};

type Draft = {
  id?: string;
  name: string;
  phone: string;
  vehicles: DraftVehicle[];
  tariffIds: string[];
};

function newVehicleKey() {
  return `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const emptyDraft = (): Draft => ({
  name: "",
  phone: "",
  vehicles: [{ key: newVehicleKey(), plate: "", isDefault: true }],
  tariffIds: [],
});

function platesLabel(c: ClientDto): string {
  const plates =
    c.vehicles?.length > 0
      ? c.vehicles.map((v) => v.plateNumber)
      : c.plateNumber
        ? [c.plateNumber]
        : [];
  if (!plates.length) return "без номера";
  return plates.join(" · ");
}

export function ClientsPage() {
  const [token, setToken] = useState(getWasherToken());
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<ClientDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [saving, setSaving] = useState(false);
  const [tariffs, setTariffs] = useState<TariffDto[]>([]);
  const [tariffPanel, setTariffPanel] = useState<"pick" | "create" | null>(null);
  const [newTariffName, setNewTariffName] = useState("");
  const [creatingTariff, setCreatingTariff] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteCode, setDeleteCode] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function reload(q = query) {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [res, tariffList] = await Promise.all([
        q.trim()
          ? api.searchClients(q.trim(), token, 100)
          : api.listClients(token, 100),
        adminApi.tariffs(token),
      ]);
      setClients(res.clients);
      setTariffs(tariffList);
    } catch (e) {
      if (isUnauthorized(e)) {
        setWasherToken(null);
        setToken(null);
        return;
      }
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    const t = window.setTimeout(() => void reload(query), 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload by query/token
  }, [token, query]);

  if (!token) return <Navigate to="/" replace />;

  function openCreate() {
    setDraft(emptyDraft());
    setTariffPanel(null);
    setNewTariffName("");
    setError("");
  }

  function openEdit(c: ClientDto) {
    const vehicles =
      c.vehicles?.length > 0
        ? c.vehicles.map((v) => ({
            key: v.id,
            id: v.id,
            plate: v.plateNumber,
            isDefault: v.isDefault,
          }))
        : [
            {
              key: newVehicleKey(),
              plate: c.plateNumber ?? "",
              isDefault: true,
            },
          ];
    setDraft({
      id: c.id,
      name: c.name ?? "",
      phone: c.phone ?? "",
      vehicles,
      tariffIds: c.tariffIds ?? [],
    });
    setTariffPanel(null);
    setNewTariffName("");
    setError("");
  }

  function addVehicle() {
    setDraft((d) => ({
      ...d,
      vehicles: [...d.vehicles, { key: newVehicleKey(), plate: "", isDefault: false }],
    }));
  }

  function removeVehicle(key: string) {
    setDraft((d) => {
      const next = d.vehicles.filter((v) => v.key !== key);
      if (!next.length) {
        return { ...d, vehicles: [{ key: newVehicleKey(), plate: "", isDefault: true }] };
      }
      if (!next.some((v) => v.isDefault)) next[0].isDefault = true;
      return { ...d, vehicles: next };
    });
  }

  function setDefaultVehicle(key: string) {
    setDraft((d) => ({
      ...d,
      vehicles: d.vehicles.map((v) => ({ ...v, isDefault: v.key === key })),
    }));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setError("");
    try {
      const vehicles = draft.vehicles
        .map((v) => ({
          id: v.id,
          plateNumber: v.plate.trim(),
          isDefault: v.isDefault,
        }))
        .filter((v) => v.plateNumber);
      if (!vehicles.length) {
        setError("Укажите хотя бы один госномер");
        setSaving(false);
        return;
      }
      if (!vehicles.some((v) => v.isDefault)) vehicles[0].isDefault = true;

      await api.upsertClient(
        {
          id: draft.id,
          name: draft.name.trim() || undefined,
          phone: draft.phone.trim() || undefined,
          vehicles,
          tariffIds: draft.tariffIds,
        },
        token
      );
      setDraft(emptyDraft());
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  function openDeleteConfirm() {
    setDeleteCode("");
    setDeleteError("");
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!token || !draft.id) return;
    const code = deleteCode.trim();
    if (!code) {
      setDeleteError("Введите пароль администратора");
      return;
    }
    setDeleteBusy(true);
    setDeleteError("");
    try {
      const auth = await api.loginAdmin(code);
      if (!auth.ok || !auth.token) {
        setDeleteError(auth.error ?? "Неверный пароль администратора");
        return;
      }
      try {
        await api.deleteClient(draft.id, token);
      } finally {
        await api.logout(auth.token).catch(() => undefined);
      }
      setDeleteOpen(false);
      setDeleteCode("");
      setDraft(emptyDraft());
      setTariffPanel(null);
      await reload();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Ошибка удаления");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <TouchKeyboardProvider>
      <div className="app-shell">
        <header className="topbar">
          <div>
            <div className="brand">{BRAND_NAME}</div>
            <div className="muted" style={{ fontSize: "0.85rem" }}>
              Клиенты
            </div>
          </div>
          <div className="topbar-actions">
            <Link to="/" className="topbar-pill">
              Касса
            </Link>
            <Link to="/calendar" className="topbar-pill">
              Календарь
            </Link>
            <Link to="/admin" className="topbar-pill">
              Админ
            </Link>
            <WindowControls visible={false} />
          </div>
        </header>

        <main className="content content-wide clients-page">
          <div className="clients-toolbar">
            <TouchField
              className="clients-search"
              value={query}
              onChange={setQuery}
              placeholder="Поиск: телефон, номер или имя"
            />
            <button type="button" className="btn-primary" onClick={openCreate}>
              Добавить
            </button>
          </div>

          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
          {loading && <p className="muted">Загрузка…</p>}

          <div className="clients-layout">
            <section className="panel clients-list-panel">
              <ul className="clients-list">
                {clients.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={`clients-row${draft.id === c.id ? " active" : ""}`}
                      onClick={() => openEdit(c)}
                    >
                      <strong>{platesLabel(c)}</strong>
                      <span>{[c.name, c.phone].filter(Boolean).join(" · ") || "—"}</span>
                      <span className="muted">
                        визитов: {c.visitCount}
                        {c.lastVisitAt
                          ? ` · ${new Date(c.lastVisitAt).toLocaleDateString("ru-RU")}`
                          : ""}
                        {c.vehicles?.length > 1 ? ` · авто: ${c.vehicles.length}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
                {!loading && clients.length === 0 && (
                  <li className="muted" style={{ padding: "1rem" }}>
                    Клиентов не найдено
                  </li>
                )}
              </ul>
            </section>

            <section className="panel clients-form-panel">
              <h2 className="h2">{draft.id ? "Редактировать" : "Новый клиент"}</h2>
              <form className="stack clients-form" onSubmit={onSave}>
                <div className="stack" style={{ gap: 8 }}>
                  <span className="muted">Автомобили</span>
                  {draft.vehicles.map((v) => (
                    <div key={v.key} className="clients-vehicle-row">
                      <TouchField
                        value={v.plate}
                        onChange={(plate) =>
                          setDraft((d) => ({
                            ...d,
                            vehicles: d.vehicles.map((x) =>
                              x.key === v.key ? { ...x, plate: plate.toUpperCase() } : x
                            ),
                          }))
                        }
                        placeholder="А170РТ90"
                      />
                      <label className="clients-vehicle-default">
                        <input
                          type="radio"
                          name="default-vehicle"
                          checked={v.isDefault}
                          onChange={() => setDefaultVehicle(v.key)}
                        />
                        <span>осн.</span>
                      </label>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Удалить авто"
                        title="Удалить"
                        disabled={draft.vehicles.length <= 1}
                        onClick={() => removeVehicle(v.key)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button type="button" className="btn-secondary" onClick={addVehicle}>
                    + Авто
                  </button>
                </div>
                <label className="stack" style={{ gap: 4 }}>
                  <span className="muted">Телефон</span>
                  <TouchField
                    value={draft.phone}
                    onChange={(phone) => setDraft((d) => ({ ...d, phone }))}
                    placeholder="+7…"
                    mode="numeric"
                  />
                </label>
                <label className="stack" style={{ gap: 4 }}>
                  <span className="muted">Имя</span>
                  <TouchField
                    value={draft.name}
                    onChange={(name) => setDraft((d) => ({ ...d, name }))}
                    placeholder="Имя клиента"
                  />
                </label>

                <div className="stack clients-tariffs" style={{ gap: 8 }}>
                  <span className="muted">Тарифы</span>
                  <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                    {draft.tariffIds.map((id) => {
                      const t = tariffs.find((x) => x.id === id);
                      return (
                        <button
                          key={id}
                          type="button"
                          className="topbar-pill active"
                          onClick={() =>
                            setDraft((d) => ({
                              ...d,
                              tariffIds: d.tariffIds.filter((x) => x !== id),
                            }))
                          }
                        >
                          {t?.name ?? id} ×
                        </button>
                      );
                    })}
                  </div>
                  <div className="clients-tariffs-actions">
                    <button
                      type="button"
                      className={`btn-secondary clients-tariffs-btn${tariffPanel === "pick" ? " active" : ""}`}
                      onClick={() => {
                        setTariffPanel((p) => (p === "pick" ? null : "pick"));
                        setNewTariffName("");
                      }}
                    >
                      Выбрать
                    </button>
                    <button
                      type="button"
                      className={`btn-secondary clients-tariffs-btn${tariffPanel === "create" ? " active" : ""}`}
                      onClick={() => {
                        setTariffPanel((p) => (p === "create" ? null : "create"));
                      }}
                    >
                      Создать
                    </button>
                  </div>
                  {tariffPanel === "pick" && (
                    <div className="clients-tariffs-picker">
                      {tariffs
                        .filter((t) => !draft.tariffIds.includes(t.id))
                        .map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            className="btn-secondary clients-tariffs-pick-item"
                            onClick={() => {
                              setDraft((d) => ({
                                ...d,
                                tariffIds: [...d.tariffIds, t.id],
                              }));
                              setTariffPanel(null);
                            }}
                          >
                            {t.name}
                            {!t.active ? " (выкл)" : ""}
                          </button>
                        ))}
                      {tariffs.filter((t) => !draft.tariffIds.includes(t.id)).length === 0 && (
                        <span className="muted">Нет доступных тарифов</span>
                      )}
                    </div>
                  )}
                  {tariffPanel === "create" && (
                    <div className="clients-tariffs-create">
                      <TouchField
                        className="clients-tariffs-name"
                        value={newTariffName}
                        onChange={setNewTariffName}
                        placeholder="Название, напр. Такси-2026"
                        title="Название тарифа"
                      />
                      <button
                        type="button"
                        className="btn-primary clients-tariffs-btn"
                        disabled={creatingTariff || !newTariffName.trim()}
                        onClick={async () => {
                          if (!token || !newTariffName.trim()) return;
                          setCreatingTariff(true);
                          setError("");
                          try {
                            const today = new Date();
                            const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
                            const created = await adminApi.saveTariff(token, {
                              name: newTariffName.trim(),
                              validFrom: ymd,
                              validTo: null,
                              active: true,
                              prices: [],
                              clientIds: draft.id ? [draft.id] : [],
                            });
                            setTariffs(await adminApi.tariffs(token));
                            setDraft((d) => ({
                              ...d,
                              tariffIds: d.tariffIds.includes(created.id)
                                ? d.tariffIds
                                : [...d.tariffIds, created.id],
                            }));
                            setNewTariffName("");
                            setTariffPanel(null);
                          } catch (err) {
                            setError(
                              err instanceof Error ? err.message : "Не удалось создать тариф"
                            );
                          } finally {
                            setCreatingTariff(false);
                          }
                        }}
                      >
                        {creatingTariff ? "…" : "Сохранить"}
                      </button>
                    </div>
                  )}
                  <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                    Цены тарифа настройте в Админ → Тарифы
                  </p>
                </div>

                <div className="clients-form-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setDraft(emptyDraft());
                      setTariffPanel(null);
                      setNewTariffName("");
                    }}
                  >
                    {draft.id ? "Отмена" : "Очистить"}
                  </button>
                  {draft.id && (
                    <button type="button" className="btn-danger" onClick={openDeleteConfirm}>
                      Удалить
                    </button>
                  )}
                  <button type="submit" className="btn-primary" disabled={saving}>
                    {saving ? "…" : "Сохранить"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        </main>

        {deleteOpen && (
          <div className="modal-backdrop" onClick={() => !deleteBusy && setDeleteOpen(false)}>
            <div
              className="modal stack"
              role="dialog"
              aria-label="Подтверждение удаления"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="h2" style={{ margin: 0 }}>
                Удалить клиента?
              </h2>
              <p style={{ margin: 0 }}>
                Для удаления введите пароль администратора (мастер-код).
              </p>
              <TouchField
                value={deleteCode}
                onChange={setDeleteCode}
                placeholder="Пароль админа"
                title="Пароль администратора"
                mode="pin"
                secret
              />
              {deleteError && <p style={{ color: "var(--danger)", margin: 0 }}>{deleteError}</p>}
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={deleteBusy}
                  onClick={() => setDeleteOpen(false)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={deleteBusy}
                  onClick={() => void confirmDelete()}
                >
                  {deleteBusy ? "…" : "Удалить"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </TouchKeyboardProvider>
  );
}
