# Документация Автомойка АРТ

Карта репозитория. Статусы фич: `backlog` · `spec` · `in-progress` · `shipped` · `parked`.

**План развития:** [`product/roadmap.md`](product/roadmap.md) — единственный общий roadmap.  
**Идеи:** [`product/backlog.md`](product/backlog.md).

## Структура

| Папка | О чём |
|-------|--------|
| [`product/`](product/) | Обзор, бренд, roadmap, бэклог |
| [`architecture/`](architecture/) | Local-first, модель данных, оплаты |
| [`pos/`](pos/) | Касса `apps/web` + `local-api` + Electron |
| [`pwa/`](pwa/) | Клиентское приложение «Автомойка у ЖД» |
| [`deploy/`](deploy/) | Docker локально, VPS, релиз кассы |

## Быстрые ссылки

| Задача | Документ |
|--------|----------|
| Что делать дальше | [product/roadmap.md](product/roadmap.md) |
| Релиз кассы (exe / GitHub) | [pos/packaging.md](pos/packaging.md), [deploy/pos-release.md](deploy/pos-release.md) |
| PWA: запись, кабинет, каталог | [pwa/customer-app.md](pwa/customer-app.md) |
| Деплой `carwash-jd.ru` | [deploy/vps.md](deploy/vps.md) |
| Локальный Docker-стенд | [deploy/local-docker.md](deploy/local-docker.md) |
| Цены по классу авто | [pos/vehicle-classes.md](pos/vehicle-classes.md) |
| Бренд АРТ vs «у ЖД» | [product/brand.md](product/brand.md) |

## Как обновлять

1. Новая фича → файл в `pos/` или `pwa/` (+ строка в README папки).
2. Идея без спеки → строка в `product/backlog.md`.
3. Смена этапа / приоритета → только `product/roadmap.md`.
4. Старые пути `doc/01-…`, `doc/features/…` — заглушки с редиректом (не править по ним).
