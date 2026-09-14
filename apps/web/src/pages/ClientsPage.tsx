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

type Draft = {
  id?: string;
  name: string;
  phone: string;
  plate: string;
};

const emptyDraft = (): Draft => ({ name: "", phone: "", plate: "" });

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
    setDraft({
      id: c.id,
      name: c.name ?? "",
      phone: c.phone ?? "",
      plate: c.plateNumber ?? "",
    });
    setError("");
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setError("");
    try {
      await api.upsertClient(
        {
          id: draft.id,
          name: draft.name.trim() || undefined,
          phone: draft.phone.trim() || undefined,
          plate: draft.plate.trim() || undefined,
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
                      <strong>{c.plateNumber ?? "без номера"}</strong>
                      <span>{[c.name, c.phone].filter(Boolean).join(" · ") || "—"}</span>
                      <span className="muted">
                        визитов: {c.visitCount}
                        {c.lastVisitAt
                          ? ` · ${new Date(c.lastVisitAt).toLocaleDateString("ru-RU")}`
                          : ""}
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
                <label className="stack" style={{ gap: 4 }}>
                  <span className="muted">Госномер</span>
                  <TouchField
                    value={draft.plate}
                    onChange={(plate) => setDraft((d) => ({ ...d, plate: plate.toUpperCase() }))}
                    placeholder="А170РТ90"
                  />
                </label>
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
                  <button type="button" className="btn-secondary" onClick={() => setDraft(emptyDraft())}>
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
