# Архитектура

## Принцип local-first

Касса всегда пишет в локальный SQLite. Облако не участвует в проведении оплаты. Синхронизация — через таблицу `outbox` при наличии сети.

```
[Касса UI] → [local-api Fastify] → [SQLite node:sqlite]
                    ↓ outbox
              [cloud-api] → [SQLite] → [Отчёты владельца]
```

## Компоненты монорепо

| Пакет | Назначение |
|-------|------------|
| `apps/web` | React + Vite: касса `/`, админ `/admin`, отчёты `/reports` |
| `services/local-api` | Fastify + `node:sqlite` на мини-ПК |
| `services/cloud-api` | Fastify + SQLite sync + отчёты |
| `packages/shared` | Общие типы и константы |

## Офлайн

| Сценарий | Поведение |
|----------|-----------|
| Нет интернета | каталог, наличные, карта (эмулятор/локальный терминал) работают |
| СБП без сети | недоступно |
| Сеть есть | outbox → cloud sync |
| Конфликты | локальный заказ = source of truth |

## Оплата

Интерфейс `PaymentProvider`:

- `CashProvider` — сразу paid
- `SbpQrProvider` — нужен интернет; эмулятор / реальный адаптер
- `CardTerminalProvider` — эмулятор или SDK терминала (возможен local bridge)

## Деплой мойки

PM2 для local-api + браузер kiosk на `http://localhost:5173` (dev) / статике + API на `:3001`.
