# reader-panghu

一个把「WebView 书源」「阅读3 书源」「本地书」「多端进度同步」收敛到同一套服务端的阅读服务。

Web UI 按 `reader-next` 的交互**独立重写**（Vue 3，未复制其源码），服务端实现 `/reader3/*` 契约，同时对外提供阅读3 规则书源，Legado 客户端（iOS/Android）可直接导入。

## 现在能跑什么

全部为本地实测，非设计稿。

| 能力 | 状态 | 实测 |
|---|---|---|
| 服务端执行 WebView 书源（起点自建源，HTML 未改） | ✅ | 搜索 1.0s / 详情 1.0s / 目录 952 章 0.9s / 正文 1.7s |
| `flutter_inappwebview` 桥在 Node 里实现 | ✅ | `http` / `cookie.*` / `cache.*` / `log` / `toast` |
| `/reader3/*` 契约（书架、搜索 SSE、目录、正文、进度） | ✅ | 14 项冒烟测试全过 |
| reader-next Vue3 UI 构建并由同端口提供 | ✅ | `apps/web/dist`，SPA 回退可用 |
| 阅读3 书源生成（给 Legado 客户端） | ✅ | `/api/legado-source/:id` |
| 本地 TXT 上传 + 自动分章 + 阅读 | ✅ | 中文 GBK 兜底解码 |
| 书源导入（文件 / 远程 URL） | ✅ | `readSourceFile`、`readRemoteSourceFile` |
| 封面/书名/作者/简介手工编辑 | ✅ | `saveBook` + `uploadBookCover` |
| 书签、替换规则 | ✅ | 落库 |
| 多端进度同步（服务端权威） | ✅ | `saveBookProgress` 覆盖最新，书架回读一致 |
| 本地书格式 TXT / EPUB / DOCX / MOBI | ✅ | 各自合成样本上传后分章、正文、封面均通过 |
| 书源订阅（Legado 自动拉取） | ✅ | `/api/subscribe` 返回可导入的阅读3 书源数组 |
| PDF（文字版） | 🧪 可选，非目标 | 提取 Tj/TJ + FlateDecode；不做扫描版/OCR，可随时移除 |
| RSS / WebDAV | ⏳ | 接口明确返回“尚未接入”，不假装成功 |

## 快速开始

```bash
pnpm install
pnpm --filter reader-panghu-web run build   # 构建 UI
PORT=18080 node apps/server/src/index.js    # 同端口提供 UI + API
```

打开 <http://localhost:18080>。

放入书源（`data/sources/<id>.json`，首次启动会导入数据库）：

```json
{
  "bookSourceName": "起点·自建·家宽",
  "bookSourceUrl": "http://example.com/k/xxx",
  "html": "<!DOCTYPE html>…",
  "_runtime": {
    "rewrites": [{ "from": "http://dead-host:4280", "to": "http://live-host:4280" }],
    "key": "书源密钥"
  }
}
```

也可以用环境变量统一改线路（对所有书源生效）：

```bash
SOURCE_REWRITES='[{"from":"http://dead-host:4280","to":"http://live-host:4280"}]'
```

`_runtime` 是本服务加的运行参数，导入阅读3 客户端时会被忽略。

## 两套接口

### `/reader3/*` — Web UI / 阅读3 客户端契约

统一返回 `{isSuccess, errorMsg, data}`。主要端点：

| 端点 | 说明 |
|---|---|
| `GET /getBookshelf` | 书架（含进度） |
| `POST /getBookInfo` · `/getChapterList` · `/getBookContent` | 详情 / 目录 / 正文 |
| `POST /saveBook` · `/saveBooks` · `/saveBookProgress` | 加入书架 / 编辑元数据 / 进度 |
| `GET /getBookSources` · `POST /saveBookSources` | 书源管理 |
| `GET /searchBookMultiSSE` | 跨书源搜索（SSE 流，`data:` 帧 + `end` 事件） |
| `POST /uploadTxtBook` | 本地 TXT（自动分章） |
| `POST /uploadBookCover` · `/resetBookCover` | 封面替换 / 还原 |
| `GET/POST /getBookmarks` 系列、`/getReplaceRules` 系列 | 书签、替换规则 |

### `/api/*` — 书源导向接口

`/api/search`、`/api/book`、`/api/toc`、`/api/content`、`/api/legado-source/:id`，返回带自指 URL 的 JSON，供阅读3 规则书源直接消费。

## 目录结构

```
apps/server/             Fastify 服务：/reader3 契约、/api、SQLite、书源运行时调度
apps/web/                reader-next 的 Vue 3 前端（构建到 dist/）
packages/source-runtime/ WebView 书源运行时（jsdom + jQuery + 桥）
packages/legado-source/  阅读3 书源生成器
scripts/                 探针与冒烟测试（test-reader3 / test-extras / probe-source）
docker/                  Dockerfile 与 compose
docs/                    架构说明
data/                    运行数据（git 忽略）
```

## 为什么需要「服务端书源运行时」

Legado 家族书源有两种形态：

1. **规则型**（`ruleSearch` / JSONPath / CSS / `@js:`）——纯数据，客户端引擎执行。
2. **WebView 型**（`html` 字段 + `flutter_inappwebview.callHandler`）——本质是运行在 WebView 里的程序。

`legado-ios v0.1.14` 只支持第 1 种（二进制里有 `ruleSearch`、`SwiftSoup`、`java.ajax`，但没有 `flutter_inappwebview` / `callHandler`）。所以本项目在服务端实现 WebView 运行时，再把结果降维成规则型书源——APP 一行 Swift 都不用改。

## 测试

```bash
node scripts/check-docker.mjs   # Docker 构建输入的静态校验（无 docker 环境时用）
node scripts/test-reader3.mjs   # 契约端到端（搜索→详情→目录→正文→进度→SSE）
node scripts/test-extras.mjs    # 书签/替换规则/书源导入/本地 TXT
node scripts/probe-source.js <source.json>   # 直接跑单个书源
```

## 许可证

AGPL-3.0。全部代码为本项目原创实现：服务端、书源运行时、以及按 reader-next 交互独立重写的 Vue UI。参考项目与借鉴范围见 [NOTICE](NOTICE)。
