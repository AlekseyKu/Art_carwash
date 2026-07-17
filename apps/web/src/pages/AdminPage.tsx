import { BRAND_NAME, formatRub } from "@art/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi, api, getAdminToken, setAdminToken } from "../api";

type Tab = "services" | "discounts" | "washers" | "terminal" | "analytics" | "security";

export function AdminPage() {
  const [token, setToken] = useState(getAdminToken());
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("services");

  const [services, setServices] = useState<
    { id: string; name: string; priceKopecks: number; active: boolean; sortOrder: number }[]
  >([]);
  const [discounts, setDiscounts] = useState<
    { id: string; name: string; type: string; value: number; active: boolean }[]
  >([]);
  const [washers, setWashers] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [terminal, setTerminal] = useState({
    adapter: "emulator",
    host: "",
    port: "8080",
    comPort: "",
    notes: "",
  });
  const [period, setPeriod] = useState<"day" | "month">("day");
  const [analytics, setAnalytics] = useState<{
    totalKopecks: number;
    orderCount: number;
    byService: { label: string; totalKopecks: number; count: number }[];
    byPost: { label: string; totalKopecks: number; count: number }[];
    byPaymentMethod: { label: string; totalKopecks: number; count: number }[];
  } | null>(null);

  const [svcForm, setSvcForm] = useState({ name: "", priceRub: "", sortOrder: "0" });
  const [discForm, setDiscForm] = useState({ name: "", type: "percent", value: "" });
  const [washerForm, setWasherForm] = useState({ name: "", pin: "" });
  const [masterForm, setMasterForm] = useState({ current: "", next: "" });
  const [syncUrl, setSyncUrl] = useState("http://127.0.0.1:3002");
  const [syncMsg, setSyncMsg] = useState("");

  async function login() {
    setError("");
    const res = await api.loginAdmin(code);
    if (!res.ok || !res.token) {
      setError(res.error ?? "Ошибка");
      return;
    }
    setAdminToken(res.token);
    setToken(res.token);
    setCode("");
  }

  async function refresh() {
    if (!token) return;
    const [s, d, w, t, sync] = await Promise.all([
      adminApi.services(token),
      adminApi.discounts(token),
      adminApi.washers(token),
      adminApi.terminal(token),
      adminApi.syncSettings(token),
    ]);
    setServices(s);
    setDiscounts(d);
    setWashers(w);
    setTerminal({
      adapter: String(t.adapter ?? "emulator"),
      host: String(t.host ?? ""),
      port: String(t.port ?? 8080),
      comPort: String(t.comPort ?? ""),
      notes: String(t.notes ?? ""),
    });
    if (sync.cloudSyncUrl) setSyncUrl(sync.cloudSyncUrl);
  }

  useEffect(() => {
    if (!token) return;
    refresh().catch((e) => setError(e.message));
  }, [token]);

  useEffect(() => {
    if (!token || tab !== "analytics") return;
    adminApi.analytics(token, period).then(setAnalytics).catch((e) => setError(e.message));
  }, [token, tab, period]);

  if (!token) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">{BRAND_NAME}</div>
          <Link to="/">Касса</Link>
        </header>
        <main className="content" style={{ display: "grid", placeItems: "center" }}>
          <div className="panel" style={{ width: "min(420px, 100%)" }}>
            <h1 className="h1" style={{ fontSize: "1.5rem" }}>
              Админ
            </h1>
            <p className="muted">Мастер-код</p>
            <div className="field">
              <input
                type="password"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void login()}
              />
            </div>
            {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
            <button type="button" className="btn-primary" style={{ width: "100%" }} onClick={() => void login()}>
              Войти
            </button>
          </div>
        </main>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "services", label: "Услуги" },
    { id: "discounts", label: "Скидки" },
    { id: "washers", label: "Мойщики" },
    { id: "terminal", label: "Терминал" },
    { id: "analytics", label: "Аналитика" },
    { id: "security", label: "Безопасность" },
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">{BRAND_NAME} · Админ</div>
        <div className="row">
          <Link to="/" className="btn-ghost" style={{ textDecoration: "none", display: "grid", placeItems: "center" }}>
            Касса
          </Link>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setAdminToken(null);
              setToken(null);
            }}
          >
            Выйти
          </button>
        </div>
      </header>

      <main className="content">
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="admin-nav">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? "active" : "btn-secondary"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "services" && (
          <div className="panel stack">
            <h2 className="h2">Услуги</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Цена</th>
                  <th>Активна</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{formatRub(s.priceKopecks)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() =>
                          void adminApi
                            .saveService(
                              token,
                              {
                                name: s.name,
                                priceKopecks: s.priceKopecks,
                                active: !s.active,
                                sortOrder: s.sortOrder,
                              },
                              s.id
                            )
                            .then(refresh)
                        }
                      >
                        {s.active ? "Выкл" : "Вкл"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row">
              <input
                placeholder="Название"
                value={svcForm.name}
                onChange={(e) => setSvcForm({ ...svcForm, name: e.target.value })}
              />
              <input
                placeholder="Цена ₽"
                value={svcForm.priceRub}
                onChange={(e) => setSvcForm({ ...svcForm, priceRub: e.target.value })}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  void adminApi
                    .saveService(token, {
                      name: svcForm.name,
                      priceKopecks: Math.round(Number(svcForm.priceRub) * 100),
                      active: true,
                      sortOrder: Number(svcForm.sortOrder) || 0,
                    })
                    .then(() => {
                      setSvcForm({ name: "", priceRub: "", sortOrder: "0" });
                      return refresh();
                    })
                }
              >
                Добавить
              </button>
            </div>
          </div>
        )}

        {tab === "discounts" && (
          <div className="panel stack">
            <h2 className="h2">Скидки</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Тип</th>
                  <th>Значение</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {discounts.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td>{d.type}</td>
                    <td>{d.type === "percent" ? `${d.value}%` : formatRub(d.value)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() =>
                          void adminApi
                            .saveDiscount(
                              token,
                              { name: d.name, type: d.type, value: d.value, active: !d.active },
                              d.id
                            )
                            .then(refresh)
                        }
                      >
                        {d.active ? "Выкл" : "Вкл"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row">
              <input
                placeholder="Название"
                value={discForm.name}
                onChange={(e) => setDiscForm({ ...discForm, name: e.target.value })}
              />
              <select
                value={discForm.type}
                onChange={(e) => setDiscForm({ ...discForm, type: e.target.value })}
              >
                <option value="percent">%</option>
                <option value="fixed">₽</option>
              </select>
              <input
                placeholder="Значение"
                value={discForm.value}
                onChange={(e) => setDiscForm({ ...discForm, value: e.target.value })}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  const raw = Number(discForm.value);
                  const value = discForm.type === "fixed" ? Math.round(raw * 100) : raw;
                  void adminApi
                    .saveDiscount(token, {
                      name: discForm.name,
                      type: discForm.type,
                      value,
                      active: true,
                    })
                    .then(() => {
                      setDiscForm({ name: "", type: "percent", value: "" });
                      return refresh();
                    });
                }}
              >
                Добавить
              </button>
            </div>
          </div>
        )}

        {tab === "washers" && (
          <div className="panel stack">
            <h2 className="h2">Мойщики</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Имя</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {washers.map((w) => (
                  <tr key={w.id}>
                    <td>{w.name}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() =>
                          void adminApi
                            .saveWasher(token, { name: w.name, active: !w.active }, w.id)
                            .then(refresh)
                        }
                      >
                        {w.active ? "Активен" : "Выкл"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row">
              <input
                placeholder="Имя"
                value={washerForm.name}
                onChange={(e) => setWasherForm({ ...washerForm, name: e.target.value })}
              />
              <input
                placeholder="PIN 4–6"
                value={washerForm.pin}
                onChange={(e) => setWasherForm({ ...washerForm, pin: e.target.value })}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  void adminApi
                    .saveWasher(token, {
                      name: washerForm.name,
                      pin: washerForm.pin,
                      active: true,
                    })
                    .then(() => {
                      setWasherForm({ name: "", pin: "" });
                      return refresh();
                    })
                }
              >
                Добавить
              </button>
            </div>
          </div>
        )}

        {tab === "terminal" && (
          <div className="panel stack">
            <h2 className="h2">Терминал оплаты</h2>
            <div className="field">
              <label>Адаптер</label>
              <select
                value={terminal.adapter}
                onChange={(e) => setTerminal({ ...terminal, adapter: e.target.value })}
              >
                <option value="emulator">Эмулятор</option>
                <option value="generic_http">Generic HTTP</option>
                <option value="sdk_bridge">SDK Bridge (localhost)</option>
              </select>
            </div>
            <div className="field">
              <label>Host</label>
              <input
                value={terminal.host}
                onChange={(e) => setTerminal({ ...terminal, host: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Port</label>
              <input
                value={terminal.port}
                onChange={(e) => setTerminal({ ...terminal, port: e.target.value })}
              />
            </div>
            <div className="field">
              <label>COM-порт</label>
              <input
                value={terminal.comPort}
                onChange={(e) => setTerminal({ ...terminal, comPort: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Заметки</label>
              <input
                value={terminal.notes}
                onChange={(e) => setTerminal({ ...terminal, notes: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={() =>
                void adminApi
                  .saveTerminal(token, {
                    adapter: terminal.adapter,
                    host: terminal.host || undefined,
                    port: Number(terminal.port) || undefined,
                    comPort: terminal.comPort || undefined,
                    notes: terminal.notes,
                  })
                  .then(() => setSyncMsg("Сохранено"))
              }
            >
              Сохранить
            </button>
            {syncMsg && <p className="muted">{syncMsg}</p>}
          </div>
        )}

        {tab === "analytics" && (
          <div className="panel stack">
            <div className="row">
              <h2 className="h2" style={{ flex: 1 }}>
                Аналитика
              </h2>
              <button
                type="button"
                className={period === "day" ? "btn-primary" : "btn-secondary"}
                onClick={() => setPeriod("day")}
              >
                День
              </button>
              <button
                type="button"
                className={period === "month" ? "btn-primary" : "btn-secondary"}
                onClick={() => setPeriod("month")}
              >
                Месяц
              </button>
            </div>
            {analytics && (
              <>
                <p>
                  Выручка <strong>{formatRub(analytics.totalKopecks)}</strong> · заказов{" "}
                  {analytics.orderCount}
                </p>
                <h3 className="h2">По услугам</h3>
                <ul>
                  {analytics.byService.map((b) => (
                    <li key={b.label}>
                      {b.label}: {formatRub(b.totalKopecks)} ({b.count})
                    </li>
                  ))}
                </ul>
                <h3 className="h2">По постам</h3>
                <ul>
                  {analytics.byPost.map((b) => (
                    <li key={b.label}>
                      {b.label}: {formatRub(b.totalKopecks)} ({b.count})
                    </li>
                  ))}
                </ul>
                <h3 className="h2">По оплате</h3>
                <ul>
                  {analytics.byPaymentMethod.map((b) => (
                    <li key={b.label}>
                      {b.label}: {formatRub(b.totalKopecks)} ({b.count})
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {tab === "security" && (
          <div className="panel stack">
            <h2 className="h2">Мастер-код</h2>
            <div className="field">
              <label>Текущий</label>
              <input
                type="password"
                value={masterForm.current}
                onChange={(e) => setMasterForm({ ...masterForm, current: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Новый</label>
              <input
                type="password"
                value={masterForm.next}
                onChange={(e) => setMasterForm({ ...masterForm, next: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={() =>
                void adminApi
                  .changeMaster(token, masterForm.current, masterForm.next)
                  .then((r) => {
                    if (!r.ok) setError(r.error ?? "Ошибка");
                    else {
                      setMasterForm({ current: "", next: "" });
                      setSyncMsg("Код изменён");
                    }
                  })
              }
            >
              Сменить код
            </button>

            <h2 className="h2" style={{ marginTop: "1.5rem" }}>
              Облачная синхронизация
            </h2>
            <div className="field">
              <label>URL cloud-api</label>
              <input value={syncUrl} onChange={(e) => setSyncUrl(e.target.value)} />
            </div>
            <div className="row">
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  void adminApi.saveSyncSettings(token, syncUrl).then(() => setSyncMsg("URL сохранён"))
                }
              >
                Сохранить URL
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  void adminApi.sync(token).then((r) =>
                    setSyncMsg(r.error ? r.error : `Синхронизировано: ${r.synced}`)
                  )
                }
              >
                Синхронизировать сейчас
              </button>
            </div>
            {syncMsg && <p className="muted">{syncMsg}</p>}
            <p className="muted">
              Отчёты для телефона: <Link to="/reports">/reports</Link>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
