import { BRAND_NAME } from "@art/shared";
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  api,
  getWasherToken,
  isUnauthorized,
  setWasherToken,
  type ClientDto,
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
};

function newVehicleKey() {
  return `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const emptyDraft = (): Draft => ({
  name: "",
  phone: "",
  vehicles: [{ key: newVehicleKey(), plate: "", isDefault: true }],
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

  async function reload(q = query) {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const res = q.trim()
        ? await api.searchClients(q.trim(), token, 100)
        : await api.listClients(token, 100);
      setClients(res.clients);
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
    });
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

  async function onDelete(id: string) {
    if (!token) return;
    if (!window.confirm("Удалить клиента?")) return;
    setError("");
    try {
      await api.deleteClient(id, token);
      if (draft.id === id) setDraft(emptyDraft());
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка удаления");
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
              <form className="stack" onSubmit={onSave}>
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
                <div className="clients-form-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setDraft(emptyDraft())}
                  >
                    {draft.id ? "Отмена" : "Очистить"}
                  </button>
                  {draft.id && (
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => void onDelete(draft.id!)}
                    >
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
      </div>
    </TouchKeyboardProvider>
  );
}
