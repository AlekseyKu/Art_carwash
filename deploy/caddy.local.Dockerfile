FROM node:22-bookworm AS pwa-build

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared packages/shared
COPY apps/pwa apps/pwa

RUN echo "minimum-release-age=0" >> .npmrc

RUN pnpm install --frozen-lockfile --filter @art/pwa...
RUN pnpm --filter @art/shared build
RUN pnpm --filter @art/pwa build

FROM caddy:2-alpine

COPY deploy/Caddyfile.local /etc/caddy/Caddyfile
COPY --from=pwa-build /app/apps/pwa/dist /srv/pwa
