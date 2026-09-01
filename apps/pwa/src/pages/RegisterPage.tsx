import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [pdnAccepted, setPdnAccepted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register({ phone, password, passwordConfirm, pdnAccepted });
      navigate("/app/price", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка регистрации");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-main" style={{ paddingTop: 24 }}>
      <h1 style={{ marginTop: 0, fontSize: 22 }}>Регистрация</h1>
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
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password2">Повтор пароля</label>
          <input
            id="password2"
            type="password"
            autoComplete="new-password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={pdnAccepted}
            onChange={(e) => setPdnAccepted(e.target.checked)}
            required
            style={{ marginTop: 4 }}
          />
          <span style={{ fontSize: 14, lineHeight: 1.5 }}>
            Я согласен(на) на{" "}
            <Link to="/privacy" target="_blank">
              обработку персональных данных
            </Link>
          </span>
        </label>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading ? "Сохраняем…" : "Зарегистрироваться"}
        </button>
      </form>
      <p style={{ textAlign: "center", marginTop: 16 }}>
        <Link to="/login">Уже есть аккаунт</Link>
      </p>
    </div>
  );
}
