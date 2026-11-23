# 发布规则（自 v0.9.1 起）

每次改动完成并通过验证后，**不再等用户要求**，按下面流程自动发布：

1. **递增版本号**：同步修改以下文件的 `version`：
   - `package.json`
   - `apps/web/package.json`
   - `apps/server/package.json`
   - `packages/legado-source/package.json`
   - `packages/source-runtime/package.json`

   **版本号规则（自 1.0.0 起）**：
   - `1.0.0 → 1.0.1 → … → 1.0.10`
   - 然后进入 `1.1.0 → 1.1.1 → … → 1.1.10`
   - 再到 `1.2.0 → 1.2.1 → … → 1.2.10`，以此类推
   - 每个次版本最多到 `.10`，下一个次版本从 `.0` 重新开始

   前端顶栏的版本号由 `apps/web/vite.config.js` 在构建时从根 `package.json` 注入，改完根版本后必须重新构建 `apps/web`。

2. **构建前端**：
   ```bash
   pnpm --filter reader-panghu-web run build
   ```

3. **推送 GitHub**（需要环境变量 `GITHUB_TOKEN`，不要写入仓库或脚本）：
   ```bash
   node push-github.mjs
   ```
   （在项目上级目录执行，脚本默认推送到本仓库的 `main`。）

4. **创建 GitHub Release**：tag 为 `v<version>`（如 `v0.9.1`），target 为 `main` 最新提交，release 标题与 tag 一致。

5. **部署 NAS**（自建示例）：
   ```bash
   node scripts/deploy-nas.mjs
   ```
   该命令上传源码到 NAS 的数据目录，重启 compose 项目并等待就绪；数据卷 `/app/data` 不受影响。公网访问地址、NAS 路径等按自己的环境替换。

6. **验证**：请求公网首页，确认引用的 `assets/index-*.js` 是新产物且包含当前版本号（如 `v0.9.1`），`/api/health` 的 `uptime` 已重置。用户刷新 F5 即可看到。

## 注意

- 版本号唯一来源是根 `package.json`；不要在代码里硬编码。
- GitHub 仓库现已公开，Release、tag 和 GHCR 镜像都可匿名访问。
- 每次发布后建议在 `PROJECT-STATUS.md` 或提交信息里留一句变更摘要。
