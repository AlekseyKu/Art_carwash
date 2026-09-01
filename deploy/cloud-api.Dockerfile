FROM node:22-slim AS build

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared packages/shared
COPY services/cloud-api services/cloud-api

RUN echo "minimum-release-age=0" >> .npmrc

RUN pnpm install --frozen-lockfile --filter @art/cloud-api...

RUN pnpm --filter @art/cloud-api build
RUN pnpm --filter @art/cloud-api --prod deploy --legacy /prod/cloud-api

FROM node:22-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV ART_CLOUD_DATA_DIR=/data

COPY --from=build /prod/cloud-api ./

EXPOSE 3002

CMD ["node", "dist/index.js"]
