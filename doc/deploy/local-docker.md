# Локальный Docker-стенд

Полный стек: local-api + web (касса), cloud-api, Caddy + PWA.

```bash
copy deploy\.env.local.example deploy\.env.local
pnpm docker:up
```

| URL | Назначение |
|-----|------------|
| http://localhost:8080 | PWA (`/api` → cloud) |
| http://localhost:3001 | Касса (web + local-api) |

Логи: `pnpm docker:logs` · стоп: `pnpm docker:down`

Вход кассы: мойщик `1111` · админ `9999` · owner: `ART_OWNER_PASSWORD` из `.env.local`.

Файлы: `deploy/docker-compose.local.yml`, `deploy/Caddyfile.local`, Dockerfiles в `deploy/`.
