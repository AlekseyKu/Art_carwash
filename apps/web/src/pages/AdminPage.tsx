import { BRAND_NAME, formatRub, type ShiftReport } from "@art/shared";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  adminApi,
  api,
  getAdminToken,
  isUnauthorized,
  setAdminToken,
  type CatalogItemDto,
  type CatalogTabDto,
  type ShiftDto,
  type ShiftReportDto,
} from "../api";
import { TouchField, TouchKeyboardProvider } from "../components/OnScreenKeyboard";
import { ShiftReportView } from "../components/ShiftReportView";

type FixedTab =
  | "discounts"
  | "washers"
  | "terminal"
  | "analytics"
  | "security"
  | "updates"
  | "catalog-tabs";
type Tab = FixedTab | `catalog:${string}`;
type NavGroupId = "analytics" | "catalog" | "settings" | "admin";

const MAIN_NAV: { id: NavGroupId; label: string }[] = [
  { id: "analytics", label: "Аналитика" },
  { id: "catalog", label: "Товары и услуги" },
  { id: "settings", label: "Настройки" },
  { id: "admin", label: "Администрирование" },
];

function navGroupForTab(t: Tab): NavGroupId {
  if (t === "analytics") return "analytics";
  if (t === "washers") return "settings";
  if (t === "updates" || t === "terminal" || t === "security") return "admin";
  return "catalog";
}

export function AdminPage() {
  const [token, setToken] = useState(getAdminToken());
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("analytics");
  const [navGroup, setNavGroup] = useState<NavGroupId>("analytics");

  const [catalogTabs, setCatalogTabs] = useState<CatalogTabDto[]>([]);
  const [services, setServices] = useState<CatalogItemDto[]>([]);
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
  const [analyticsMode, setAnalyticsMode] = useState<"period" | "shifts">("period");
  const [shiftList, setShiftList] = useState<ShiftDto[]>([]);
  const [selectedShiftReport, setSelectedShiftReport] = useState<ShiftReportDto | null>(null);
  const [analytics, setAnalytics] = useState<{
    totalKopecks: number;
    orderCount: number;
    byService: { label: string; totalKopecks: number; count: number }[];
    byPost: { label: string; totalKopecks: number; count: number }[];
    byPaymentMethod: { label: string; totalKopecks: number; count: number }[];
  } | null>(null);

  const [svcForm, setSvcForm] = useState({ name: "", priceRub: "", sortOrder: "0" });
  const [tabForm, setTabForm] = useState({ name: "", sortOrder: "10" });
  const [discForm, setDiscForm] = useState({ name: "", type: "percent", value: "" });
  const [washerForm, setWasherForm] = useState({ name: "", pin: "" });
  const [masterForm, setMasterForm] = useState({ current: "", next: "" });
  const [syncUrl, setSyncUrl] = useState("http://127.0.0.1:3002");
  const [syncMsg, setSyncMsg] = useState("");
  const [updateInfo, setUpdateInfo] = useState<{
    desktop?: boolean;
    currentVersion?: string;
    latestVersion?: string | null;
    updateAvailable?: boolean;
    message?: string;
    releaseNotes?: string;
    releaseUrl?: string | null;
    repo?: string;
    hasGithubToken?: boolean;
    runtimeSource?: string;
    runtimeDir?: string;
    updatesDir?: string;
    logPath?: string;
  } | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [githubTokenInput, setGithubTokenInput] = useState("");

  const activeCatalogTab = useMemo(() => {
    if (!tab.startsWith("catalog:")) return null;
    const key = tab.slice("catalog:".length);
    return (
      catalogTabs.find((t) => t.slug === key || t.id === key) ??
      catalogTabs.find((t) => t.slug === "services") ??
      catalogTabs[0] ??
      null
    );
  }, [tab, catalogTabs]);

  const itemsForActiveTab = useMemo(() => {
    if (!activeCatalogTab) return [];
    return services.filter((s) => s.tabId === activeCatalogTab.id);
  }, [services, activeCatalogTab]);

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

  async function removeWithConfirm(
    message: string,
    action: () => Promise<unknown>
  ) {
    if (!window.confirm(message)) return;
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить");
    }
  }

  async function refresh() {
    if (!token) return;
    const [tabs, s, d, w, t, sync] = await Promise.all([
      adminApi.catalogTabs(token),
      adminApi.services(token),
      adminApi.discounts(token),
      adminApi.washers(token),
      adminApi.terminal(token),
      adminApi.syncSettings(token),
    ]);
    setCatalogTabs(Array.isArray(tabs) ? tabs : []);
    setServices(Array.isArray(s) ? s : []);
    setDiscounts(Array.isArray(d) ? d : []);
    setWashers(Array.isArray(w) ? w : []);
    setTerminal({
      adapter: String(t?.adapter ?? "emulator"),
      host: String(t?.host ?? ""),
      port: String(t?.port ?? 8080),
      comPort: String(t?.comPort ?? ""),
      notes: String(t?.notes ?? ""),
    });
    if (sync?.cloudSyncUrl) setSyncUrl(sync.cloudSyncUrl);

    if (tab.startsWith("catalog:")) {
      const key = tab.slice("catalog:".length);
      const stillThere = (tabs ?? []).some((ct) => ct.slug === key || ct.id === key);
      if (!stillThere && tabs?.[0]) setTab(`catalog:${tabs[0].slug}`);
    }
  }

  function forceLogout(message?: string) {
    setAdminToken(null);
    setToken(null);
    if (message) setError(message);
  }

  useEffect(() => {
    const onUnauthorized = (ev: Event) => {
      if ((ev as CustomEvent).detail === "admin") {
        forceLogout("Сессия недействительна — введите мастер-код снова");
      }
    };
    window.addEventListener("art:unauthorized", onUnauthorized);
    return () => window.removeEventListener("art:unauthorized", onUnauthorized);
  }, []);

  useEffect(() => {
    if (!token) return;
    refresh().catch((e) => {
      if (isUnauthorized(e)) forceLogout(e.message);
      else setError(e.message);
    });
  }, [token]);

  useEffect(() => {
    if (!token || tab !== "analytics") return;
    if (analyticsMode === "period") {
      adminApi.analytics(token, period).then(setAnalytics).catch((e) => {
        if (isUnauthorized(e)) forceLogout(e.message);
        else setError(e.message);
      });
      return;
    }
    setSelectedShiftReport(null);
    adminApi
      .shifts(token)
      .then((r) => setShiftList(r.shifts ?? []))
      .catch((e) => {
        if (isUnauthorized(e)) forceLogout(e.message);
        else setError(e.message);
      });
  }, [token, tab, period, analyticsMode]);

  useEffect(() => {
    if (!token || tab !== "updates") return;
    setUpdateBusy(true);
    adminApi
      .updatesStatus(token)
      .then((s) => setUpdateInfo(s))
      .catch((e) => {
        if (isUnauthorized(e)) forceLogout(e.message);
        else setError(e.message);
      })
      .finally(() => setUpdateBusy(false));
  }, [token, tab]);

  useEffect(() => {
    setNavGroup(navGroupForTab(tab));
  }, [tab]);

  const catalogSubItems = useMemo(() => {
    const tabs = catalogTabs
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru"))
      .map((ct) => ({
        id: `catalog:${ct.slug}` as Tab,
        label: ct.name,
      }));
    return [
      ...tabs,
      { id: "catalog-tabs" as Tab, label: "Вкладки" },
      { id: "discounts" as Tab, label: "Скидки" },
    ];
  }, [catalogTabs]);

  const subItems = useMemo(() => {
    if (navGroup === "analytics") {
      return [
        { id: "period" as const, label: "Период" },
        { id: "shifts" as const, label: "Смены" },
      ];
    }
    if (navGroup === "catalog") return catalogSubItems;
    if (navGroup === "settings") {
      return [{ id: "washers" as Tab, label: "Мойщики" }];
    }
    return [
      { id: "updates" as Tab, label: "Обновления" },
      { id: "terminal" as Tab, label: "Терминал" },
      { id: "security" as Tab, label: "Безопасность" },
    ];
  }, [navGroup, catalogSubItems]);

  function selectNavGroup(group: NavGroupId) {
    setNavGroup(group);
    if (group === "analytics") {
      setTab("analytics");
      return;
    }
    if (group === "catalog") {
      if (navGroupForTab(tab) !== "catalog") {
        const first = catalogSubItems[0];
        if (first) setTab(first.id);
      }
      return;
    }
    if (group === "settings") {
      setTab("washers");
      return;
    }
    if (navGroupForTab(tab) !== "admin") setTab("updates");
  }

  function isSubActive(item: { id: string }): boolean {
    if (navGroup === "analytics") {
      return tab === "analytics" && analyticsMode === item.id;
    }
    return tab === item.id;
  }

  function selectSubItem(item: { id: string }) {
    if (navGroup === "analytics") {
      setTab("analytics");
      setAnalyticsMode(item.id as "period" | "shifts");
      return;
    }
    setTab(item.id as Tab);
  }

  if (!token) {
    return (
      <TouchKeyboardProvider>
        <div className="app-shell">
          <header className="topbar">
            <div className="brand">{BRAND_NAME}</div>
            <div className="topbar-actions">
              <Link to="/" className="topbar-pill">
                Касса
              </Link>
            </div>
          </header>
          <main className="content" style={{ display: "grid", placeItems: "center" }}>
            <div className="panel" style={{ width: "min(420px, 100%)", textAlign: "center" }}>
              <h1 className="h1" style={{ fontSize: "1.5rem" }}>
                Админ
              </h1>
              <p className="muted">Введите мастер-код</p>
              <div className="pin-dots">
                {Array.from({ length: Math.max(4, code.length || 4) }).map((_, i) => (
                  <span key={i} className={i < code.length ? "filled" : ""} />
                ))}
              </div>
              {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
              <div className="pin-pad">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "OK"].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      if (k === "C") setCode("");
                      else if (k === "OK") void login();
                      else if (code.length < 8) setCode((c) => c + k);
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          </main>
        </div>
      </TouchKeyboardProvider>
    );
  }

  return (
    <TouchKeyboardProvider>
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">{BRAND_NAME} · Админ</div>
        <div className="topbar-actions">
          <Link to="/" className="topbar-pill">
            Касса
          </Link>
          <button
            type="button"
            className="topbar-pill"
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
        <nav className="admin-nav" aria-label="Разделы админки">
          {MAIN_NAV.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`topbar-pill${navGroup === g.id ? " active" : ""}`}
              onClick={() => selectNavGroup(g.id)}
            >
              {g.label}
            </button>
          ))}
        </nav>
        <nav className="admin-subnav" aria-label="Подменю">
          {subItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`topbar-pill${isSubActive(item) ? " active" : ""}`}
              onClick={() => selectSubItem(item)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {activeCatalogTab && (
          <div className="panel stack">
            <h2 className="h2">{activeCatalogTab.name}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Позиции вкладки на кассе. Добавляйте услуги мойки или товары (кофе, чай и т.п.).
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Цена</th>
                  <th>Активна</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {itemsForActiveTab.map((s) => (
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
                                tabId: s.tabId,
                              },
                              s.id
                            )
                            .then(refresh)
                        }
                      >
                        {s.active ? "Выкл" : "Вкл"}
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() =>
                          void removeWithConfirm(`Удалить «${s.name}»?`, () =>
                            adminApi.deleteService(token, s.id)
                          )
                        }
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {itemsForActiveTab.length === 0 && (
              <p className="muted">Пока пусто — добавьте первую позицию ниже.</p>
            )}
            <div className="row">
              <TouchField
                placeholder="Название"
                title="Название"
                mode="text"
                value={svcForm.name}
                onChange={(name) => setSvcForm((f) => ({ ...f, name }))}
              />
              <TouchField
                placeholder="Цена ₽"
                title="Цена ₽"
                mode="numeric"
                value={svcForm.priceRub}
                onChange={(priceRub) => setSvcForm((f) => ({ ...f, priceRub }))}
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
                      tabId: activeCatalogTab.id,
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

        {tab === "catalog-tabs" && (
          <div className="panel stack">
            <h2 className="h2">Вкладки кассы</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Управляют переключателями «Услуги / Товары» на кассе. Можно добавить новую вкладку
              (например, «Химия»).
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Slug</th>
                  <th>Порядок</th>
                  <th>Активна</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {catalogTabs.map((ct) => (
                  <tr key={ct.id}>
                    <td>{ct.name}</td>
                    <td className="muted">{ct.slug}</td>
                    <td>{ct.sortOrder}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() =>
                          void adminApi
                            .saveCatalogTab(
                              token,
                              {
                                name: ct.name,
                                sortOrder: ct.sortOrder,
                                active: !ct.active,
                              },
                              ct.id
                            )
                            .then(refresh)
                        }
                      >
                        {ct.active ? "Выкл" : "Вкл"}
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() =>
                          void removeWithConfirm(
                            `Удалить вкладку «${ct.name}»? Сначала должны быть удалены все позиции.`,
                            () => adminApi.deleteCatalogTab(token, ct.id)
                          )
                        }
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row">
              <TouchField
                placeholder="Название вкладки"
                title="Название вкладки"
                mode="text"
                value={tabForm.name}
                onChange={(name) => setTabForm((f) => ({ ...f, name }))}
              />
              <TouchField
                placeholder="Порядок"
                title="Порядок"
                mode="numeric"
                value={tabForm.sortOrder}
                onChange={(sortOrder) => setTabForm((f) => ({ ...f, sortOrder }))}
                style={{ maxWidth: "6rem" }}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  void adminApi
                    .saveCatalogTab(token, {
                      name: tabForm.name,
                      sortOrder: Number(tabForm.sortOrder) || 10,
                      active: true,
                    })
                    .then(() => {
                      setTabForm({ name: "", sortOrder: "10" });
                      return refresh();
                    })
                }
              >
                Добавить вкладку
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
                      <div className="row" style={{ gap: "0.35rem", flexWrap: "nowrap" }}>
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
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() =>
                            void removeWithConfirm(`Удалить скидку «${d.name}»?`, () =>
                              adminApi.deleteDiscount(token, d.id)
                            )
                          }
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row">
              <TouchField
                placeholder="Название"
                title="Название скидки"
                mode="text"
                value={discForm.name}
                onChange={(name) => setDiscForm((f) => ({ ...f, name }))}
              />
              <select
                value={discForm.type}
                onChange={(e) => setDiscForm({ ...discForm, type: e.target.value })}
              >
                <option value="percent">%</option>
                <option value="fixed">₽</option>
              </select>
              <TouchField
                placeholder="Значение"
                title="Значение скидки"
                mode="numeric"
                value={discForm.value}
                onChange={(value) => setDiscForm((f) => ({ ...f, value }))}
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
                  <th />
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
                    <td>
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() =>
                          void removeWithConfirm(`Удалить мойщика «${w.name}»?`, () =>
                            adminApi.deleteWasher(token, w.id)
                          )
                        }
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row">
              <TouchField
                placeholder="Имя"
                title="Имя мойщика"
                mode="text"
                value={washerForm.name}
                onChange={(name) => setWasherForm((f) => ({ ...f, name }))}
              />
              <TouchField
                placeholder="PIN 4–6"
                title="PIN мойщика"
                mode="pin"
                maxLength={6}
                secret
                value={washerForm.pin}
                onChange={(pin) => setWasherForm((f) => ({ ...f, pin }))}
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
              <TouchField
                title="Host"
                mode="ascii"
                placeholder="127.0.0.1"
                value={terminal.host}
                onChange={(host) => setTerminal((t) => ({ ...t, host }))}
              />
            </div>
            <div className="field">
              <label>Port</label>
              <TouchField
                title="Port"
                mode="numeric"
                placeholder="8080"
                value={terminal.port}
                onChange={(port) => setTerminal((t) => ({ ...t, port }))}
              />
            </div>
            <div className="field">
              <label>COM-порт</label>
              <TouchField
                title="COM-порт"
                mode="ascii"
                placeholder="COM3"
                value={terminal.comPort}
                onChange={(comPort) => setTerminal((t) => ({ ...t, comPort }))}
              />
            </div>
            <div className="field">
              <label>Заметки</label>
              <TouchField
                title="Заметки"
                mode="text"
                placeholder="Заметки"
                value={terminal.notes}
                onChange={(notes) => setTerminal((t) => ({ ...t, notes }))}
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
            <h2 className="h2" style={{ marginBottom: 0 }}>
              {analyticsMode === "shifts" ? "Аналитика · Смены" : "Аналитика · Период"}
            </h2>

            {analyticsMode === "period" && (
              <>
                <div className="row">
                  <button
                    type="button"
                    className={`topbar-pill${period === "day" ? " active" : ""}`}
                    onClick={() => setPeriod("day")}
                  >
                    День
                  </button>
                  <button
                    type="button"
                    className={`topbar-pill${period === "month" ? " active" : ""}`}
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
              </>
            )}

            {analyticsMode === "shifts" && (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  Краткие отчёты по кассовым сменам. Нажмите смену, чтобы раскрыть чеки и оплаты.
                </p>
                {shiftList.length === 0 ? (
                  <p className="muted">Смен пока нет</p>
                ) : (
                  <ul className="shift-order-list">
                    {shiftList.map((s) => {
                      const active = selectedShiftReport?.shift.id === s.id;
                      const opened = new Intl.DateTimeFormat("ru-RU", {
                        timeZone: "Europe/Moscow",
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(s.openedAt));
                      return (
                        <li key={s.id} className="shift-order-item">
                          <button
                            type="button"
                            className="shift-order-toggle"
                            onClick={() => {
                              if (!token) return;
                              if (active) {
                                setSelectedShiftReport(null);
                                return;
                              }
                              adminApi
                                .shiftReport(token, s.id)
                                .then(setSelectedShiftReport)
                                .catch((e) => setError(e.message));
                            }}
                          >
                            <span>
                              {opened}
                              {" · "}
                              {s.status === "open" ? "открыта" : "закрыта"}
                              {s.openedByName ? ` · ${s.openedByName}` : ""}
                            </span>
                            <span>
                              {formatRub(s.totalKopecks ?? 0)} · {s.orderCount ?? 0} чек.
                            </span>
                          </button>
                          {active && selectedShiftReport && (
                            <div className="shift-order-details">
                              <ShiftReportView report={selectedShiftReport as ShiftReport} />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {tab === "updates" && (
          <div className="panel stack">
            <h2 className="h2">Обновления кассы</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Проверка и установка с GitHub Releases (
              {updateInfo?.repo ?? "AlekseyKu/Art_carwash"}). Работает в приложении
              ArtCarwash-POS при наличии интернета. База данных не затрагивается.
            </p>
            <p>
              Текущая версия:{" "}
              <strong>{updateInfo?.currentVersion ?? updateInfo?.message ?? "—"}</strong>
              {updateInfo?.runtimeSource === "runtime" ? " (из AppData)" : null}
            </p>
            {(updateInfo?.runtimeDir || updateInfo?.updatesDir) && (
              <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                Установка: <code>{updateInfo.runtimeDir ?? "—"}</code>
                <br />
                Загрузки: <code>{updateInfo.updatesDir ?? "—"}</code>
                {updateInfo.logPath ? (
                  <>
                    <br />
                    Лог: <code>{updateInfo.logPath}</code>
                  </>
                ) : null}
              </p>
            )}
            <p className="muted" style={{ margin: 0 }}>
              GitHub token:{" "}
              <strong>
                {updateInfo?.hasGithubToken ? "сохранён на кассе" : "не задан"}
              </strong>
            </p>
            <div className="field">
              <label>Personal Access Token (Contents: Read)</label>
              <TouchField
                title="GitHub token"
                mode="ascii"
                secret
                placeholder="ghp_… или github_pat_…"
                value={githubTokenInput}
                onChange={setGithubTokenInput}
              />
            </div>
            <div className="row">
              <button
                type="button"
                className="btn-secondary"
                disabled={updateBusy || !token || !githubTokenInput.trim()}
                onClick={() => {
                  setUpdateBusy(true);
                  setError("");
                  void adminApi
                    .updatesSetGithubToken(token!, githubTokenInput.trim())
                    .then((r) => {
                      setSyncMsg(r.message ?? "Token сохранён");
                      setGithubTokenInput("");
                      return adminApi.updatesStatus(token!);
                    })
                    .then((s) => setUpdateInfo((prev) => ({ ...prev, ...s })))
                    .catch((e) => setError(e.message))
                    .finally(() => setUpdateBusy(false));
                }}
              >
                Сохранить token
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={updateBusy || !token || !updateInfo?.hasGithubToken}
                onClick={() => {
                  if (!window.confirm("Удалить сохранённый GitHub token с этой кассы?")) return;
                  setUpdateBusy(true);
                  setError("");
                  void adminApi
                    .updatesSetGithubToken(token!, "")
                    .then((r) => {
                      setSyncMsg(r.message ?? "Token удалён");
                      return adminApi.updatesStatus(token!);
                    })
                    .then((s) => setUpdateInfo((prev) => ({ ...prev, ...s })))
                    .catch((e) => setError(e.message))
                    .finally(() => setUpdateBusy(false));
                }}
              >
                Удалить token
              </button>
            </div>
            {updateInfo?.latestVersion && (
              <p>
                На GitHub: <strong>{updateInfo.latestVersion}</strong>
                {updateInfo.updateAvailable ? " · есть обновление" : " · актуально"}
              </p>
            )}
            {updateInfo?.message && <p className="muted">{updateInfo.message}</p>}
            {updateInfo?.releaseNotes && (
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: "0.85rem",
                  background: "color-mix(in srgb, var(--brand-silver-soft) 40%, white)",
                  padding: "0.75rem",
                  borderRadius: "8px",
                  maxHeight: "12rem",
                  overflow: "auto",
                }}
              >
                {updateInfo.releaseNotes}
              </pre>
            )}
            <div className="row">
              <button
                type="button"
                className="btn-secondary"
                disabled={updateBusy || !token}
                onClick={() => {
                  setUpdateBusy(true);
                  setError("");
                  void adminApi
                    .updatesCheck(token!)
                    .then((r) => setUpdateInfo(r))
                    .catch((e) => setError(e.message))
                    .finally(() => setUpdateBusy(false));
                }}
              >
                Проверить обновления
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={updateBusy || !token || !updateInfo?.updateAvailable}
                onClick={() => {
                  if (!window.confirm("Скачать обновление с GitHub и перезапустить кассу?")) {
                    return;
                  }
                  setUpdateBusy(true);
                  setError("");
                  void adminApi
                    .updatesApply(token!)
                    .then((r) => {
                      setUpdateInfo((prev) => ({ ...prev, ...r, updateAvailable: false }));
                      if (r.restart) {
                        setSyncMsg(
                          "Обновление установлено. Касса закроется и через пару секунд откроется снова. Если окно не появилось — запустите ярлык ArtCarwash."
                        );
                      }
                    })
                    .catch((e) => setError(e.message))
                    .finally(() => setUpdateBusy(false));
                }}
              >
                Обновить
              </button>
              {updateInfo?.releaseUrl && (
                <a
                  className="btn-ghost"
                  href={updateInfo.releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: "none", display: "grid", placeItems: "center" }}
                >
                  Открыть Release
                </a>
              )}
            </div>
            {updateBusy && <p className="muted">Подождите…</p>}
            {syncMsg && <p className="muted">{syncMsg}</p>}
          </div>
        )}

        {tab === "security" && (
          <div className="panel stack">
            <h2 className="h2">Мастер-код</h2>
            <div className="field">
              <label>Текущий</label>
              <TouchField
                title="Текущий мастер-код"
                mode="pin"
                maxLength={8}
                secret
                placeholder="Текущий код"
                value={masterForm.current}
                onChange={(current) => setMasterForm((f) => ({ ...f, current }))}
              />
            </div>
            <div className="field">
              <label>Новый</label>
              <TouchField
                title="Новый мастер-код"
                mode="pin"
                maxLength={8}
                secret
                placeholder="Новый код"
                value={masterForm.next}
                onChange={(next) => setMasterForm((f) => ({ ...f, next }))}
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
              <TouchField
                title="URL cloud-api"
                mode="ascii"
                placeholder="http://127.0.0.1:3002"
                value={syncUrl}
                onChange={setSyncUrl}
              />
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
    </TouchKeyboardProvider>
  );
}
