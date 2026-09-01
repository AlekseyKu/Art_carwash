import { useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../api";
import { OwnerLayout } from "../components/layout/OwnerLayout";
import { Button, ButtonLink, Field, FormError, StubPanel } from "../components/ui";

function FeedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 6h16M4 12h10M4 18h14" strokeLinecap="round" />
    </svg>
  );
}

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
      <OwnerLayout title="Собственник" lead="Админ-режим PWA">
        <StubPanel
          title="Лента записей"
          icon={<FeedIcon />}
          action={
            <ButtonLink to="/app/price" variant="primary">
              Открыть как клиент
            </ButtonLink>
          }
        >
          <p className="stub-panel__text">
            Заглушка до фазы C. Аналитика доступна в /reports на кассе.
          </p>
        </StubPanel>
      </OwnerLayout>
    );
  }

  return (
    <OwnerLayout
      title="Вход собственника"
      lead="Скрытый раздел для владельца автомойки"
      footer={
        <p className="ui-link-row">
          <Link className="ui-link" to="/">
            На главную
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit}>
        <Field
          label="Пароль"
          htmlFor="owner-pwd"
          inputProps={{
            id: "owner-pwd",
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
    </OwnerLayout>
  );
}
