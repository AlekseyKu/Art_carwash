import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../auth";
import { AuthLayout } from "../components/layout/AuthLayout";
import { Button, CheckboxField, Field, FormError } from "../components/ui";

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
    <AuthLayout
      title="Регистрация"
      lead="Создайте аккаунт, чтобы видеть прайс и записываться на мойку."
      footer={
        <p className="ui-link-row">
          <Link className="ui-link" to="/login">
            Уже есть аккаунт
          </Link>
        </p>
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
            autoComplete: "new-password",
            value: password,
            onChange: (e) => setPassword(e.target.value),
            minLength: 8,
            required: true,
          }}
        />
        <Field
          label="Повтор пароля"
          htmlFor="password2"
          inputProps={{
            type: "password",
            autoComplete: "new-password",
            value: passwordConfirm,
            onChange: (e) => setPasswordConfirm(e.target.value),
            minLength: 8,
            required: true,
          }}
        />
        <CheckboxField checked={pdnAccepted} onChange={setPdnAccepted} required>
          Я согласен(на) на{" "}
          <Link className="ui-link" to="/privacy" target="_blank" rel="noopener noreferrer">
            обработку персональных данных
          </Link>
        </CheckboxField>
        <FormError message={error} />
        <Button type="submit" block disabled={loading}>
          {loading ? "Сохраняем…" : "Зарегистрироваться"}
        </Button>
      </form>
    </AuthLayout>
  );
}
