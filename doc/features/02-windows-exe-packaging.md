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
1. Установите [Node.js **22+** x64](https://nodejs.org/) (нужен `node:sqlite`; после установки **перезагрузите ПК**).
2. Скопируйте только portable exe (папку `release` целиком не нужно).
3. Запуск → полноэкранная касса (kiosk). При старте на рабочий стол создаётся ярлык **ArtCarwash**.
4. Данные SQLite: `%APPDATA%/ArtCarwash-POS/data` (если была старая папка `автомойка-арт` — она продолжает использоваться).
5. Конфиг обновлений / GitHub token: `%APPDATA%/ArtCarwash-POS/update-config.json`
6. Лог API: `%APPDATA%/ArtCarwash-POS/local-api.log`
7. Лог обновлений: `%APPDATA%/ArtCarwash-POS/update.log`
8. Выход: кнопка ✕ в шапке или `Ctrl+Shift+Q`. Свернуть: кнопка −. Переключить kiosk: `F11`.
9. Окно не в kiosk (отладка): `ART_KIOSK=0` перед запуском.

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
- После обновления UI/API берутся из `%APPDATA%/автомойка-арт/runtime` (если есть), иначе из `resources` внутри portable.

## Обновления из GitHub (админка)

1. На машине разработки (нужен `gh auth login`):

```bash
pnpm release:pos
# или задать версию: pnpm release:pos 0.2.1
# только артефакты: pnpm release:pos --dry-run
```

Создаётся GitHub Release с тегом `pos-vX.Y.Z` и файлами:
- `art-pos-update.zip` — web + api + `desktop/updater.cjs` (кнопка «Обновить» в админке)
- `ArtCarwash-POS-X.Y.Z-portable.exe` — полная сборка (нужна при первой установке / смене оболочки)

2. На кассе (нужен интернет):  
   - Репозиторий **публичный** → token не нужен.  
   - Репозиторий **приватный** → один раз сохраните GitHub Personal Access Token  
     (fine-grained или classic, право **Contents: Read** на `AlekseyKu/Art_carwash`)  
     в **Админ → Обновления**.  
   - Затем **Проверить → Обновить**.  
   Приложение скачает `art-pos-update.zip`, поставит `web`+`api` (+ `desktop/updater.cjs`) в  
   `%APPDATA%/ArtCarwash-POS/runtime` и перезапустится.  
   При следующем старте Electron предпочитает `runtime/desktop/updater.cjs` — фиксы логики  
   обновлений тоже приходят через zip, без новой portable.  
   Portable `.exe` при каждом запуске пересобирает свой `resources` — поэтому обновление  
   **не пишется внутрь exe**, а лежит в AppData и подхватывается при старте.  
   SQLite в `%APPDATA%/ArtCarwash-POS/data` не трогается.  
   Token: `%APPDATA%/ArtCarwash-POS/update-config.json`.  
   Лог обновлений: `%APPDATA%/ArtCarwash-POS/update.log`.  
   Загрузки/бэкапы: `%APPDATA%/ArtCarwash-POS/updates`.

Выбор версии: среди Releases с `art-pos-update.zip` берётся **максимальный semver**  
(список GitHub не отсортирован по версиям — иначе «первый» мог быть 0.2.9 при наличии 0.2.12).

## Код

- `apps/desktop/` — Electron shell + electron-builder (portable)
- `apps/desktop/src/updater.cjs` — проверка/скачивание GitHub Releases
- `apps/desktop/scripts/prepare-resources.mjs` — сборка web/api в `resources/`
- `scripts/publish-pos-release.mjs` — публикация релиза
- `services/local-api` — раздача UI при `ART_WEB_DIST`, прокси `/api/admin/updates/*`
- `scripts/start-touch-kiosk.ps1` — запасной kiosk без exe

## Критерии готовности

- [x] Двойной клик / скрипт → касса на весь экран, API отвечает
- [x] Офлайн-оплата наличными (local SQLite)
- [x] Обновление без потери БД (runtime в AppData, data/ не трогается)
- [ ] Опционально: встроить Node в portable (не требовать системный Node)
- [ ] Код-сайнинг перед продом

## Вне scope

- Microsoft Store
- Код-сайнинг (отдельная задача)
- Cloud-api внутри exe
