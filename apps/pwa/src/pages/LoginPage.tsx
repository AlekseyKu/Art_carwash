import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export function LoginPage() {
  const { login, onboardingDone } = useAuth();
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(phone, password);
      navigate("/app/price", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-main" style={{ paddingTop: 24 }}>
      <h1 style={{ marginTop: 0, fontSize: 22 }}>Вход</h1>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="phone">Телефон</label>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            placeholder="+7 (___) ___-__-__"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Пароль</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading ? "Входим…" : "Войти"}
        </button>
      </form>
      {!onboardingDone && (
        <p style={{ textAlign: "center", marginTop: 16 }}>
          <Link to="/welcome">Назад к описанию</Link>
        </p>
      )}
      <p style={{ textAlign: "center", marginTop: 16 }}>
        <Link to="/register">Создать аккаунт</Link>
      </p>
    </div>
  );
}
