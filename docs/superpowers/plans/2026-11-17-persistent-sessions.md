# 持久化会话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让登录会话写进现有 SQLite，服务重启后 cookie 与 Bearer token 仍然有效，登出与 30 天过期照旧生效。

**Architecture:** `sessions` 表落在 `DATA_DIR/reader.db`（容器里挂的是持久卷），`Store` 提供增删查方法，`auth.js` 不再用进程内 `Map`；新增一个真实「起服务 → 登录 → 杀进程 → 重启 → 复用 token」的验收脚本。

**Tech Stack:** Node 22+（`node:sqlite`）、Fastify、`node:test`、现有 `scripts/*.mjs` 验收脚本体系。

**Spec:** `docs/superpowers/specs/2026-11-17-persistent-sessions-design.md`

## Global Constraints

- 会话 TTL 固定为 30 天：`SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000`，不新增 env 开关。
- 不加依赖、不引 JWT；鉴权仍接受 `rp_session` cookie、`Authorization: Bearer`、`x-auth-token`、`?token=` 四种来源，前端协议不变。
- 未配置带密码用户时保持单用户模式：所有请求回落到 user 1。
- 老库（没有 `sessions` 表）打开时必须自动补表，不能报错。
- 存储位置只能是 `DATA_DIR` 下的 `reader.db`（Docker 里 `/app/data` 持久卷）。
- 本目录不是 git 仓库且未安装 git：跳过提交；若纳入版本库，用各任务给出的 commit message。
- Node 用 DSH 内置：`C:\Users\30879\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`，下文命令前先 `$env:PATH = "C:\Users\30879\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin;$env:PATH"`，工作目录 `reader-panghu`。

## Review Focus

- 老库升级：已有 `reader.db` 没有 `sessions` 表时，启动后仍能登录（缺表不能导致 500）。测试：Task 2 用例「老库补表」。
- 过期会话：超过 30 天的 token 即使重启后也不得放行，并删掉对应行。测试：Task 3 用例「TTL 边界」。
- 登出语义：重启前登出的 token 重启后不得复活；重启后登出立即失效。测试：Task 1 脚本的 token B / token A 断言。
- 单用户模式不受影响：没有密码用户时匿名请求照常可用。测试：Task 1 脚本开头的匿名 `getUserInfo`。
- 重启竞态：杀进程后同端口能再次监听，且 WAL 里已提交的会话能被新进程读到。测试：Task 1 脚本的第二次 `start()` 与重启后 token A 断言。

---

### Task 1: 写出失败的重启验收脚本

**Files:**
- Create: `scripts/test-auth-persist.mjs`
- Modify: `scripts/run-all-tests.mjs:14-34`（`SUITES` 末尾加 `'test-auth-persist'`）

**Interfaces:**
- Consumes: HTTP 契约 `POST /reader3/register`、`POST /reader3/login`、`POST /reader3/logout`、`GET /reader3/getUserInfo`、`GET /reader3/debugAuth`、`GET /api/health`；注册/登录响应 `data.token`，`set-cookie` 里的 `rp_session=...`。
- Produces: 脚本退出码 0/1；给 Task 3 的验收入口。

- [ ] **Step 1: 写 `scripts/test-auth-persist.mjs`**

用 `spawn(process.execPath, ['apps/server/src/index.js'], { env: { ...process.env, PORT, DATA_DIR: 临时目录, LOG_LEVEL: 'warn' } })` 起服务两次，中间 `kill` 并等 `exit`；每次起来后轮询 `/api/health`（最多约 20s，失败时打印子进程日志尾部）。断言顺序与内容：

```js
// 1. 未注册时是单用户模式
const anon = await call('/reader3/getUserInfo')
if (!anon.payload.isSuccess) throw new Error('单用户模式下匿名 getUserInfo 不应被拒绝')

// 2. 注册拿 token A；同一账号再登录拿 token B，并在重启前登出 B
const registered = await call('/reader3/register', { method: 'POST', body: { username, password: 'secret123' } })
const tokenA = registered.payload.data.token
// 断言注册成功、set-cookie 包含 rp_session=
const loginB = await call('/reader3/login', ...)       // tokenB
await call('/reader3/logout', { method: 'POST', token: tokenB })

// 3. 杀进程，同 DATA_DIR、同端口重启
await stop()
await start()

// 4. 重启后：Bearer token A 有效、cookie 有效、token B 无效
const meA = await call('/reader3/getUserInfo', { token: tokenA })     // isSuccess 且 username 一致，否则抛「重启后 token A 失效：…」
const viaCookie = await call('/reader3/getUserInfo', { cookie: 'rp_session=' + cookieValue })
const meB = await call('/reader3/getUserInfo', { token: tokenB })     // 必须 isSuccess === false

// 5. 重启后登出 A 立即失效；debugAuth 能看到持久化会话
```

端口用 `18500 + Math.floor(Math.random() * 300)`（避开 `run-all-tests` 的 18200–18499）；临时目录 `mkdtempSync(join(tmpdir(), 'reader-panghu-persist-'))`；退出时清理（Windows 上删目录失败可忽略）。

- [ ] **Step 2: 注册到一键验证**

`scripts/run-all-tests.mjs` 的 `SUITES` 数组末尾加 `'test-auth-persist'`。

- [ ] **Step 3: 运行并确认按预期失败**

Run: `node scripts/test-auth-persist.mjs`
Expected: FAIL，输出 `✗ 重启后 token A 失效：NEED_LOGIN`，退出码 1。

---

### Task 2: `sessions` 表与 `Store` 方法

**Files:**
- Modify: `apps/server/src/db.js:31-120`（SCHEMA）
- Modify: `apps/server/src/db.js`（`Store` 末尾，users 方法旁边）
- Create: `apps/server/test/sessions.test.js`
- Modify: `package.json:13`（`test` 脚本追加 `apps/server/test/*.test.js`）

**Interfaces:**
- Produces（Task 3 依赖，精确签名）:
  - `store.createSession(token: string, { userId: number, username: string, createdAt?: number }): void`（`createdAt` 默认 `Date.now()`，仅测试注入）
  - `store.getSession(token: string): { token: string, userId: number, username: string, createdAt: number } | null`
  - `store.deleteSession(token: string): boolean`
  - `store.deleteExpiredSessions(beforeTs: number): number`
  - `store.countSessions(): number`

- [ ] **Step 1: 先写失败的单元测试 `apps/server/test/sessions.test.js`**

用 `node:test` + `node:assert/strict`；`openDatabase(join(mkdtempSync(...), 'reader.db'))` 建库，用 `store.db.close()` 关库再 `openDatabase` 打开同文件模拟重启。用例与断言：

```js
test('createSession + getSession 往返', ...)        // userId/username/createdAt 原样读回
test('关库再开后会话仍在', ...)                      // 重启持久化核心
test('老库补表', ...)                                // 先用 raw DatabaseSync 建只有 users 表的库 → openDatabase 后 createSession 可用
test('deleteSession 与 countSessions', ...)
test('deleteExpiredSessions 只删更早的行', ...)       // createdAt 注入 1000/2000，cutoff 1500
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test apps/server/test/sessions.test.js`
Expected: FAIL，`store.createSession is not a function`。

- [ ] **Step 3: SCHEMA 加表**

```sql
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions (created_at);
```

- [ ] **Step 4: `Store` 实现五个方法**

`getSession` 把 `user_id`/`created_at` 映射成 `userId`/`createdAt`；`deleteSession` 返回 `changes > 0`；`deleteExpiredSessions` 用 `DELETE ... WHERE created_at < ?` 返回 `changes`；`countSessions` 用 `SELECT COUNT(*) AS n`。会话表是全局的，方法不接收 `userId` 参数。

- [ ] **Step 5: 跑单元测试与现有包测试**

Run: `node --test apps/server/test/sessions.test.js`
Expected: PASS（5 个用例）。
Run: `node --test packages/*/test/*.test.js apps/server/test/*.test.js`
Expected: 全 PASS。若 Windows 下 `node --test` 不展开 glob，在 `package.json` 用 Node 测试运行器支持的 glob 写法并记录实际命令。

---

### Task 3: `auth.js` 改用 `store`，补齐 TTL 边界测试与文档

**Files:**
- Modify: `apps/server/src/auth.js:18-20, 80-90, 122-134, 136-165, 177-195`
- Create: `apps/server/test/auth.test.js`
- Modify: `docs/FEATURE-GAPS.md:56`

**Interfaces:**
- Consumes: Task 2 的五个 `Store` 方法。
- Produces: `__test__.isSessionExpired(session, now = Date.now()): boolean`（Task 3 自身测试用）。

- [ ] **Step 1: 写 TTL 边界测试 `apps/server/test/auth.test.js`**

导入 `{ __test__ }`，断言：`now - createdAt === 30 天` 为 false（恰好在 TTL 上仍有效）、`+1ms` 为 true。运行确认失败（`__test__.isSessionExpired` 不存在）。

- [ ] **Step 2: 改 `auth.js`**

- 删除 `const sessions = new Map()`；保留 `SESSION_TTL_MS`。
- 加 `const isSessionExpired = (session, now = Date.now()) => Boolean(session) && now - session.createdAt > SESSION_TTL_MS`，并放进 `__test__`。
- `resolveUserId`：`const session = token ? store.getSession(token) : null`；`isSessionExpired(session)` 时 `store.deleteSession(token)` 后返回 null。
- `register` / `login`：`store.createSession(token, { userId: user.id, username: user.username })`。
- `logout`：`store.deleteSession(token)`。
- `debugAuth`：`sessions: store.countSessions()`。
- `registerAuth` 末尾：`const pruned = store.deleteExpiredSessions(Date.now() - SESSION_TTL_MS)`；`pruned > 0` 时 `app.log.info(...)`。

- [ ] **Step 3: 跑单测与重启验收**

Run: `node --test apps/server/test/auth.test.js`
Expected: PASS。
Run: `node scripts/test-auth-persist.mjs`
Expected: PASS，输出 `会话持久化 checks passed`，退出码 0。

- [ ] **Step 4: 更新 `docs/FEATURE-GAPS.md`**

第 56 行“多用户认证（scrypt + cookie/Bearer）”补为“多用户认证（scrypt + cookie/Bearer，会话持久化在 SQLite，重启不掉登录）”。

---

### Task 4: 全量验证

**Files:** 无新增

- [ ] **Step 1: 静态检查**

Run: `node scripts/check-docker.mjs`
Expected: `28/28 static checks passed`，退出码 0。

- [ ] **Step 2: 全部套件**

Run: `node scripts/run-all-tests.mjs`
Expected: `20/20 套件通过`（原 19 + 新增 `test-auth-persist`），退出码 0；其中 `test-auth`、`test-isolation` 仍通过。

- [ ] **Step 3: 手工确认（可选，需 NAS）**

`docker restart reader-panghu` 后用原浏览器刷新，不出现登录页。若容器内 Node 低于 22.5，`node:sqlite` 不可用——现有镜像基于 `node:22`，不额外处理。
