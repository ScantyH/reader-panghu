# syntax=docker/dockerfile:1
FROM node:22-alpine

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production \
    PORT=18080 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

RUN mkdir -p /app/data/sources
VOLUME ["/app/data"]
EXPOSE 18080

CMD ["node", "apps/server/src/index.js"]
