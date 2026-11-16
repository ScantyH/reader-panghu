# syntax=docker/dockerfile:1
FROM node:24-alpine

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile --config.strict-dep-builds=false \
 && pnpm --filter reader-panghu-web run build

ENV NODE_ENV=production \
    PORT=18080 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

RUN mkdir -p /app/data/sources /app/data/covers /app/data/books
VOLUME ["/app/data"]
EXPOSE 18080

CMD ["node", "apps/server/src/index.js"]
