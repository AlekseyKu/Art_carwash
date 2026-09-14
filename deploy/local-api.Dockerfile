FROM node:22-bookworm AS build

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared packages/shared
COPY services/local-api services/local-api
COPY apps/web apps/web

RUN echo "minimum-release-age=0" >> .npmrc

RUN pnpm install --frozen-lockfile --filter @art/local-api... --filter @art/web...

RUN pnpm --filter @art/shared build \
 && node -e "const fs=require('fs');const p='packages/shared/package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.main='./dist/index.js';j.types='./dist/index.d.ts';j.exports={'.':{types:'./dist/index.d.ts',import:'./dist/index.js',default:'./dist/index.js'}};fs.writeFileSync(p,JSON.stringify(j,null,2)+'\\n');"
RUN pnpm --filter @art/web build
RUN pnpm --filter @art/local-api build
RUN pnpm --filter @art/local-api --prod deploy --legacy /prod/local-api

FROM node:22-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV ART_DATA_DIR=/data
ENV ART_WEB_DIST=/app/web

COPY --from=build /prod/local-api ./
COPY --from=build /app/apps/web/dist ./web

EXPOSE 3001

CMD ["node", "dist/index.js"]
