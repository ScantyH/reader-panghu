# 两阶段构建：builder 装全量依赖并打包前端，runtime 只保留服务端运行所需依赖。
# 不使用 `# syntax=docker/dockerfile:1`：那条指令会让 BuildKit 去 Docker Hub
# 拉取 frontend 镜像，离线或受限网络（例如国内的 NAS）构建会直接超时。

FROM node:24-alpine AS builder
# 极空间等国内网络的 Docker 构建环境里 IPv6 常不可达；先试 IPv4 避免
# pnpm 下载依赖时卡在 ENETUNREACH。
ENV NODE_OPTIONS=--dns-result-order=ipv4first
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile --config.strict-dep-builds=false \
  && pnpm --filter reader-panghu-web run build

FROM node:24-alpine AS runtime
ENV NODE_OPTIONS=--dns-result-order=ipv4first
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/server ./apps/server
COPY apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/apps/web/dist ./apps/web/dist

# 前端已在 builder 里打成静态 dist，runtime 只装服务端生产依赖；
# 装完立刻删掉 pnpm store 与缓存，避免它们进入镜像层。
RUN pnpm install --prod --frozen-lockfile --filter "@reader-panghu/server..." \
      --config.strict-dep-builds=false \
  && pnpm store prune \
  && rm -rf "$(pnpm store path)" /root/.cache

ENV NODE_ENV=production \
    PORT=18080 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

RUN mkdir -p /app/data/sources /app/data/covers /app/data/books
VOLUME ["/app/data"]
EXPOSE 18080

CMD ["node", "apps/server/src/index.js"]
