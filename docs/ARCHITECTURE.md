# 架构

## 一句话

服务端把「WebView 书源」当作可执行程序跑起来，向上同时提供两套出口：自己的 JSON API（给 Web UI）和自动生成的「阅读3 规则书源」（给 Legado 客户端）。

```
                    ┌────────────────────────────────────────────┐
   Legado iOS/安卓 ──┤ 规则型书源（JSONPath → 本服务 /api/*）      │
                    │                                            │
   Web UI (Vue3) ───┤ JSON API  /api/search|book|toc|content     │
                    │                                            │
                    │      ┌──────────────────────────────┐      │
                    │      │ source-runtime (jsdom)       │      │
   书源 HTML ───────┼─────▶│  桥: http / cookie / cache   │──────┼──▶ 上游书源 HTTP API
   (flutter bridge)  │      │  导出: search/info/chapter…  │      │
                    │      └──────────────────────────────┘      │
                    └────────────────────────────────────────────┘
```

## 为什么这么切

四种书源/客户端的组合决定了一个「中间层」是唯一可行解：

| 书源形态 | 谁执行 | 服务端能否直接跑 |
|---|---|---|
| 规则型（`ruleSearch`、`@js:`） | 客户端自带引擎 | 可以，但要重写引擎 |
| WebView 型（`html` + `callHandler`） | 客户端 WebView | 不能，需要 DOM + 桥 |
| Legado iOS（Swift） | 只支持规则型 | — |
| Web UI（浏览器） | 需要 HTTP 接口 | — |

所以服务端实现 WebView 运行时，再把结果**降维**成规则型书源，一次实现同时喂饱两端。

## 已实测的上游契约（起点自建源）

书源 HTML 里的 `API` 指向自建服务，路径前缀 `/k/<token>`。主域名已失效，备用线路可用。

| 用途 | 路径 | 返回要点 |
|---|---|---|
| 存活 | `/ping` | `{pong:true}` |
| 客户端配置 | `/config.json` | 卡片/面板配置，无需密钥 |
| 源偏好 | `/source/prefs` | **403**，需要书源密钥 |
| 搜索 | `/search?keyword=&page=&page_size=` | `Data.CardList[].Body[].ItemData` |
| 详情 | `/book/{bookId}` | `Data.BaseBookInfo`（BookName/Description/WordsCnt/BookStatus…） |
| 目录 | `/book/{bookId}/catalog` | `Data.BlockChapters` 等，952 章 |
| 正文 | `/book/{bookId}/chapter/{chapterId}` | `Content` + 段评 `comments/summary` |

书源 JS 里的 `qget()` 会给每个请求追加 `?k=<书源密钥>&did=<设备ID>`；无密钥时搜索仍可用，正文受「今日章节额度」限制。

## 组件

### `packages/source-runtime`

- `init()`：把 `html` 里的**全部内联脚本合并成一次执行**（`class` 声明不跨 `<script>` 存活），注入 jQuery，注入桥，然后导出 `search/info/chapter/content/getfinds/find`。
- 桥：`http`（Node `fetch`，含 cookie 回流、字符集解码、重定向开关）、`cookie.*`（内存 jar）、`cache.*`（内存 Map）、`log`/`showToast`/`text`。
- 交互型调用（`startBrowser`、`webview`、`getVerificationCode`）没有人工在场时返回空串并记录，避免整条链路失败。
- 返回值规范化：书源用 `JSON.stringify` 返回结构体，`call()` 会解析；`content()` 保留纯文本。

### `apps/server`

- 书源注册表：`data/sources/*.json`，启动加载，增删后热加载。
- 每次请求创建一个运行时并 `dispose()`（jsdom 初始化 ~100ms）；后续可换运行时池。
- 出站 URL 全部改写为指向自身（`/api/book?url=…`），这样规则型书源无需了解上游。
- 正文清洗：剥离 `dp:*` 段评图片标记，收敛空行。

### `packages/legado-source`

生成标准阅读3 书源的 `ruleSearch/ruleBookInfo/ruleToc/ruleContent`，全部是 `$.` JSONPath，指向本服务。

## 待实现的数据模型（M3/M4）

```sql
-- 用户
users(id PK, username UNIQUE, password_hash, created_at)
-- 书源（含类型与运行参数）
sources(id PK, name, kind, entry_json, runtime_json, enabled, updated_at)
-- 书（服务端书架的唯一事实）
books(id PK, user_id, source_id NULL, origin TEXT,      -- 'source' | 'local'
      upstream_url, file_path NULL,
      name, author, intro, cover_path, cover_url, kind, word_count,
      override_json,                                     -- 手工改过的字段快照
      created_at, updated_at)
-- 章节
chapters(id PK, book_id, idx, title, upstream_url, cached_path, cached_at)
-- 进度（服务端权威，多端同步）
progress(id PK, user_id, book_id, chapter_id, chapter_idx,
         paragraph_idx, percent REAL, updated_at,       -- 后端最新者胜出
         updated_by TEXT)                               -- 'web' | 'app:<device>' | 'server'
```

同步规则（M4 的目标行为）：

1. 客户端提交进度时带上 `clientUpdatedAt`。
2. 服务端比较 `max(progress.updated_at, clientUpdatedAt)`。
3. **后端更新 → 覆盖客户端**（返回服务端进度，客户端直接采纳）。
4. 客户端更新 → 落库，并把 `updated_at` 设为客户端时间。
5. 下载书架的设备只读服务端值，不做本地合并，避免分叉。

## 风险与已知限制

- **许可证**：`hectorqin/reader` 是 AGPL-3.0；`reader-next` 无许可证（默认保留所有权利）。UI 复用前必须确认授权。
- **书源即代码**：WebView 书源在 jsdom 里执行任意 JS，当前是进程内执行。生产应放进 `worker_threads`/子进程并限权、限时、禁网段（书源需要访问上游，需白名单）。
- **上游不稳定**：主域名失效说明这类自建源会漂移；`rewrites` + 多线路探测是必需品。
- **图片直链**：正文/封面里仍有指向上游的 `http://<ip>:4280` 图片，公网部署需要加图片代理。
- **jsdom 性能**：每请求一次初始化，搜索并发高时需要运行时池或缓存。
