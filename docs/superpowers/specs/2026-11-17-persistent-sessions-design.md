# 持久化会话设计（重启不掉登录）

日期：2026-11-17

## 问题

`apps/server/src/auth.js` 用模块级 `sessions: Map<token, {userId, username, createdAt}>` 保存登录态。容器或进程重启后这张表清空，但浏览器 `localStorage` 里的 `rp_token` 和 30 天 cookie 还在；服务端解析不出用户，所有 `/reader3/*`、`/api/*` 请求返回 401 `NEED_LOGIN`，用户被迫重新登录。

`DATA_DIR`（默认 `/app/data`，compose 挂 `reader-data` 卷）在重启后保留，`reader.db` 里的用户、书架等数据都在。丢的只是内存里的 token。

## 目标

- 进程重启（`docker restart` / 重新部署）后，已有 cookie 和 `Bearer` token 继续有效，直到 30 天 TTL。
- 登出立即失效；过期会话不长期占库。
- 不改前端协议、不加依赖；未配置密码用户时仍回落到 user 1 的单用户模式。

## 非目标

- 不做滑动续期或更长的“记住我”；TTL 保持 30 天。
- 不做多设备会话管理界面。
- 不引入 JWT、新依赖或 token 加密存储。

## 备选方案（已弃用）

- **无状态签名 token（HMAC + 持久密钥）**：省一次查询，但登出无法真正吊销（除非再加黑名单），签名密钥还需要另一个持久化位置，和现有 logout 语义冲突。
- **文件会话存储**：要自己处理并发写、原子替换与清理，和 SQLite 已经承载的数据重复。

## 设计

### 1. `db.js`

SCHEMA 增加（`openDatabase` 对老库执行 `CREATE TABLE IF NOT EXISTS`，自动补表）：

```sql
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions (created_at);
```

`Store` 增加（会话是全局的，不走 `currentUserId()`）：

- `createSession(token, { userId, username, createdAt? })`（`createdAt` 仅测试注入，默认当前时间）
- `getSession(token)` → `{ token, userId, username, createdAt } | null`
- `deleteSession(token)` → boolean
- `deleteExpiredSessions(beforeTs)` → 删除行数
- `countSessions()` → number

### 2. `auth.js`

- 删除内存 `Map`；`SESSION_TTL_MS` 保留。
- `resolveUserId`：查 `store.getSession(token)`；缺失返回 null；`createdAt` 超过 TTL 时删掉该行并返回 null。
- 登录/注册：生成 token 后 `store.createSession(token, { userId, username })`，cookie 不变（30 天 `Max-Age`）。
- 登出：`store.deleteSession(token)`。
- `debugAuth` 的 `sessions` 改为 `store.countSessions()`。
- 启动时 `store.deleteExpiredSessions(Date.now() - SESSION_TTL_MS)` 并记录清理条数。

### 3. 测试

新增 `scripts/test-auth-persist.mjs`：用独立临时 `DATA_DIR` 起服务 → 注册并登录拿 token → 杀掉进程 → 同 `DATA_DIR`、同端口重启 → 用同一个 `Bearer` token 调 `/reader3/getUserInfo` 仍成功 → 登出后同一 token 失效 → 清理临时目录。加入 `scripts/run-all-tests.mjs` 的 `SUITES`。

### 4. 文档

`docs/FEATURE-GAPS.md` 的“已完成”里给多用户认证补一句“会话持久化（SQLite，重启不掉登录）”。

## 影响

- 每次鉴权多一次 SQLite 主键查询（本地文件，微秒级）。
- 数据库多一张小表；登出和启动清理会删行。
- 唯一的行为变化：重启后登录态保留——这正是目的。

## 验证

- `node scripts/test-auth-persist.mjs`：真实重启后复用原 token。
- `pnpm verify` 全绿；`test-auth` 仍验证错误密码拒绝与登出失效。
- 手工：`docker restart` 后用原浏览器刷新，无需重新登录。
