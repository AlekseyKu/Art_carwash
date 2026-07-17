# Фича 02: Сборка в .exe для Windows мини-ПК / сенсор

**Статус:** test-ready (portable Electron + kiosk-скрипт)

## Цель

Один ярлык для мойки: сотруднику не нужно знать про Node-порты и браузер. Запуск поднимает local-api и UI кассы на весь экран (touch).

## Как тестировать на сенсорной машине

### Вариант A — portable `.exe` (Electron)

На машине сборки (Windows x64, Node.js ≥ 20, pnpm):

```bash
pnpm install
pnpm dist:pos
```

Артефакт: `apps/desktop/release/ArtCarwash-POS-0.1.0-portable.exe`

На кассовом ПК:
1. Установите [Node.js 20+](https://nodejs.org/) (нужен для sidecar local-api; в PATH должен быть `node`).
2. Скопируйте portable exe.
3. Запуск → полноэкранная касса (kiosk).
4. Данные SQLite: `%APPDATA%/автомойка-арт/data` (Electron `userData`).
5. Выход: `Ctrl+Shift+Q`. Переключить kiosk: `F11`.
6. Окно не в kiosk (отладка): `ART_KIOSK=0` перед запуском.

### Вариант B — без Electron (Edge/Chrome kiosk)

На машине с уже склонированным репо:

```powershell
pnpm install
pnpm kiosk
```

Скрипт `scripts/start-touch-kiosk.ps1` собирает web при необходимости, стартует API с раздачей UI на `:3001` и открывает Edge/Chrome в `--kiosk`.

## Архитектура

```
Electron (kiosk window)
    └─ spawn node → local-api :3001
           ├─ /api/*
           └─ static UI (ART_WEB_DIST = resources/web)
```

- Cloud-api в exe не входит (VPS / отдельно).
- `sdk_bridge` по-прежнему отдельный процесс при необходимости.

## Код

- `apps/desktop/` — Electron shell + electron-builder (portable)
- `apps/desktop/scripts/prepare-resources.mjs` — сборка web/api в `resources/`
- `services/local-api` — раздача UI при `ART_WEB_DIST`
- `scripts/start-touch-kiosk.ps1` — запасной kiosk без exe

## Критерии готовности

- [x] Двойной клик / скрипт → касса на весь экран, API отвечает
- [x] Офлайн-оплата наличными (local SQLite)
- [ ] Обновление без потери БД (документировать копирование userData)
- [ ] Опционально: встроить Node в portable (не требовать системный Node)
- [ ] Код-сайнинг перед продом

## Вне scope

- Microsoft Store
- Код-сайнинг (отдельная задача)
- Cloud-api внутри exe
