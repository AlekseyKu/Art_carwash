# Архитектура

## Принцип local-first

Касса всегда пишет в локальный SQLite. Облако не участвует в проведении оплаты. Синхронизация заказов — через `outbox` при наличии сети. Каталог для PWA — snapshot в cloud-api.

```
[Касса UI apps/web] → [local-api] → [SQLite]
        ↑ Electron (apps/desktop)      ↓ outbox / catalog.snapshot
                                   [cloud-api] → [SQLite]
                                        ↑
                              [PWA apps/pwa]  (клиенты)
                              [/reports]      (собственник)
```

## Компоненты монорепо

| Пакет | Назначение |
|-------|------------|
| `apps/web` | Касса, админ, отчёты (Vite) |
| `apps/desktop` | Electron portable / kiosk |
| `apps/pwa` | Клиентское PWA «Автомойка у ЖД» |
| `services/local-api` | Fastify + SQLite на мини-ПК |
| `services/cloud-api` | Sync, каталог, customer API, отчёты |
| `services/terminal-bridge` | Мост к SDK терминала |
| `packages/shared` | Общие типы и константы |
| `deploy/` | Docker Compose (local + VPS), Caddy |

## Офлайн (касса)

| Сценарий | Поведение |
|----------|-----------|
| Нет интернета | каталог, наличные, карта работают |
| СБП без сети | недоступно |
| Сеть есть | outbox → cloud; snapshot каталога |
| Конфликты | локальный заказ = source of truth |

## Оплата

См. [payments.md](payments.md). На мойке: нал / карта / СБП. Запись из PWA — оплата на мойке (v1).

## Деплой

| Среда | Док |
|-------|-----|
| Dev | `pnpm dev` / `pnpm dev:local` |
| Локальный Docker | [../deploy/local-docker.md](../deploy/local-docker.md) |
| Касса на Windows | [../pos/packaging.md](../pos/packaging.md) |
| PWA прод | [../deploy/vps.md](../deploy/vps.md) |
