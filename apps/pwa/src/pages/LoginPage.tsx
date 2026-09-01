import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../auth";
import { AuthLayout } from "../components/layout/AuthLayout";
import { Button, Field, FormError } from "../components/ui";

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
    <AuthLayout
      title="Вход"
      lead="Войдите по номеру телефона и паролю."
      footer={
        <>
          {!onboardingDone && (
            <p className="ui-link-row">
              <Link className="ui-link" to="/welcome">
                Назад к описанию
              </Link>
            </p>
          )}
          <p className="ui-link-row">
            <Link className="ui-link" to="/register">
              Создать аккаунт
            </Link>
          </p>
        </>
      }
    >
      <form onSubmit={onSubmit}>
        <Field
          label="Телефон"
          htmlFor="phone"
          inputProps={{
            type: "tel",
            inputMode: "tel",
            placeholder: "+7 (___) ___-__-__",
            value: phone,
            onChange: (e) => setPhone(e.target.value),
            required: true,
            autoComplete: "tel",
          }}
        />
        <Field
          label="Пароль"
          htmlFor="password"
          inputProps={{
            type: "password",
            autoComplete: "current-password",
            value: password,
            onChange: (e) => setPassword(e.target.value),
            required: true,
          }}
        />
        <FormError message={error} />
        <Button type="submit" block disabled={loading}>
          {loading ? "Входим…" : "Войти"}
        </Button>
      </form>
    </AuthLayout>
  );
}
