#!/usr/bin/env bash
# Docker 冒烟测试：构建镜像 → 启动 → 健康检查 → 契约测试 → 清理。
# 用法：bash scripts/docker-smoke.sh [端口]
set -euo pipefail
PORT="${1:-18080}"
cd "$(dirname "$0")/.."

echo "==> docker version"
docker version --format '{{.Server.Version}}'

echo "==> build & start"
docker compose -f docker/compose.yml up -d --build

echo "==> waiting for health"
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "http://127.0.0.1:${PORT}/api/health"; echo

echo "==> contract smoke test"
node scripts/test-reader3.mjs "http://127.0.0.1:${PORT}"

echo "==> UI served"
curl -fsS "http://127.0.0.1:${PORT}/" | grep -q '<div id="app"' && echo "UI ok"

echo "==> logs (last 30 lines)"
docker compose -f docker/compose.yml logs --tail 30

echo "==> keep it running? (docker compose -f docker/compose.yml down 清理)"