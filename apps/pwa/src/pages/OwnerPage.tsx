import { useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api";

export function OwnerPage() {
  const [password, setPassword] = useState("");
  const [token, setOwnerToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await apiClient.ownerLogin(password);
      if (!res.ok) throw new Error("Неверный пароль");
      setOwnerToken(res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
    } finally {
      setLoading(false);
    }
  }

  if (token) {
    return (
      <div className="app-main" style={{ paddingTop: 24 }}>
        <h1 style={{ fontSize: 20 }}>Собственник</h1>
        <div className="card stub-page">
          <h2>Лента записей</h2>
          <p>Заглушка до фазы C. Аналитика доступна в /reports на кассе.</p>
          <Link to="/app/price" className="btn btn-primary">
            Открыть как клиент
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-main" style={{ paddingTop: 24 }}>
      <h1 style={{ fontSize: 20 }}>Вход собственника</h1>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="owner-pwd">Пароль</label>
          <input
            id="owner-pwd"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading ? "…" : "Войти"}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        <Link to="/">На главную</Link>
      </p>
    </div>
  );
}
