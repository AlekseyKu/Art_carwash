import { BRAND_NAME, formatRub } from "@art/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getOwnerToken, isUnauthorized, ownerApi, setOwnerToken } from "../api";

export function ReportsPage() {
  const [token, setToken] = useState(getOwnerToken());
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<"day" | "month">("day");
  const [data, setData] = useState<{
    totalKopecks: number;
    orderCount: number;
    byService: { label: string; totalKopecks: number; count: number }[];
    byPost: { label: string; totalKopecks: number; count: number }[];
    byPaymentMethod: { label: string; totalKopecks: number; count: number }[];
  } | null>(null);

  function forceLogout(message?: string) {
    setOwnerToken(null);
    setToken(null);
    setData(null);
    if (message) setError(message);
  }

  useEffect(() => {
    const onUnauthorized = (ev: Event) => {
      if ((ev as CustomEvent).detail === "owner") {
        forceLogout("Сессия недействительна — войдите снова");
      }
    };
    window.addEventListener("art:unauthorized", onUnauthorized);
    return () => window.removeEventListener("art:unauthorized", onUnauthorized);
  }, []);

  useEffect(() => {
    if (!token) return;
    ownerApi
      .analytics(token, period)
      .then(setData)
      .catch((e) => {
        if (isUnauthorized(e)) forceLogout(e.message);
        else setError(e.message);
      });
  }, [token, period]);

  async function login() {
    setError("");
    const res = await ownerApi.login(password);
    if (!res.ok || !res.token) {
      setError(res.error ?? "Ошибка входа");
      return;
    }
    setOwnerToken(res.token);
    setToken(res.token);
    setPassword("");
  }

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
              Отчёты
            </h1>
            <p className="muted">Пароль собственника</p>
            <div className="field">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">{BRAND_NAME} · Отчёты</div>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setOwnerToken(null);
            setToken(null);
          }}
        >
          Выйти
        </button>
      </header>
      <main className="content">
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        <div className="row" style={{ marginBottom: "1rem" }}>
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
        {data && (
          <div className="panel stack">
            <p style={{ fontSize: "1.5rem", fontWeight: 800, margin: 0 }}>
              {formatRub(data.totalKopecks)}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Заказов: {data.orderCount}
            </p>
            <h2 className="h2">Услуги</h2>
            <ul>
              {data.byService.map((b) => (
                <li key={b.label}>
                  {b.label}: {formatRub(b.totalKopecks)}
                </li>
              ))}
            </ul>
            <h2 className="h2">Посты</h2>
            <ul>
              {data.byPost.map((b) => (
                <li key={b.label}>
                  {b.label}: {formatRub(b.totalKopecks)}
                </li>
              ))}
            </ul>
            <h2 className="h2">Оплата</h2>
            <ul>
              {data.byPaymentMethod.map((b) => (
                <li key={b.label}>
                  {b.label}: {formatRub(b.totalKopecks)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
