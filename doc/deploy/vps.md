# Деплой PWA + cloud-api (VPS)

Прод: **https://carwash-jd.ru/**  
Хост: SSH-алиас `art-vps`, секреты в `deploy/.env` (не коммитить).

```bash
pnpm deploy:vps
```

Скрипт `scripts/deploy-vps.mjs`:

1. Собирает `apps/pwa` → `deploy/pwa-dist`
2. Пакует context (cloud-api, shared, deploy)
3. `scp` + на VPS: `docker compose up -d --build`

Compose: `deploy/docker-compose.yml` — Caddy раздаёт `pwa-dist`, cloud-api на volume `cloud_data`.

После выкладки PWA часто кэшируется service worker — жёсткое обновление вкладки/приложения.

Каталог для PWA приходит sync’ом с кассы (`catalog.snapshot`). Публичное имя сайта: `pwa_site_name` → **«Автомойка у ЖД»** (не путать с `site_name` кассы «Автомойка АРТ»).
