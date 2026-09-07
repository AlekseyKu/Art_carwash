# Автомойка АРТ

Кассовое приложение для автомойки (local-first POS + админ + облачные отчёты).

Документация: [`doc/`](doc/). Фичи: [`doc/features/`](doc/features/).

## Быстрый старт

```bash
pnpm install
pnpm dev
```

| URL | Назначение |
|-----|------------|
| http://localhost:5173 | Касса |
| http://localhost:5173/admin | Админ |
| http://localhost:5173/reports | Отчёты (телефон) |
| http://localhost:3001 | Local API |
| http://localhost:3002 | Cloud API |

Только мойка (без облака): `pnpm dev:local`

### Сенсорная касса (Windows)

| Команда | Что делает |
|---------|------------|
| `pnpm kiosk` | Edge/Chrome kiosk + local-api (быстрый тест) |
| `pnpm dist:pos` | Portable exe → `apps/desktop/release/` (**сначала bump `apps/desktop/package.json` version**) |
| `pnpm dev:desktop` | Electron kiosk в режиме разработки |

Подробнее: [`doc/features/02-windows-exe-packaging.md`](doc/features/02-windows-exe-packaging.md).

## Демо-доступ

| Роль | Данные |
|------|--------|
| Мойщик | PIN `1111` |
| Админ | мастер-код `9999` |
| Собственник (отчёты) | пароль `owner` |

## Возможности этапа 1–3

- Касса: PIN, 2 поста (черновики), услуги, скидки, оплата нал / карта / СБП
- Офлайн: касса на SQLite; СБП без сети недоступен
- Админ: каталог, мойщики, терминал, аналитика, sync
- Облако: outbox sync → отчёты владельцу
- Адаптеры терминала/СБП: эмулятор + HTTP + sdk_bridge (`pnpm dev:bridge`)
- Камера ANPR на въезде — в [бэклоге](doc/features/01-entry-camera-anpr.md) до покупки камеры

## Стек

TypeScript, React+Vite, Fastify, SQLite (`node:sqlite`).
