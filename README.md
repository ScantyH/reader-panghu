# reader-panghu

一个把「WebView 书源」「阅读3 书源」「本地书」「多端进度同步」收敛到同一套服务端的阅读服务。

> 目标是替代多个互相不兼容的项目拼装：`reader-next` 的 Web UI + `hectorqin/reader` 的阅读3 生态 + `autobcb/qysg` 的书源运行时 + Legado 客户端（iOS/Android）的同步接口。

## 现在能跑什么

已经跑通并实测的（不是设计稿）：

| 能力 | 状态 | 实测数据 |
|---|---|---|
| 服务端执行 WebView 书源（起点自建源，HTML 一行未改） | ✅ | 搜索 1.0s / 详情 1.3s / 目录 1.4s（952 章）/ 正文 3.0s（3848 字） |
| 书源 HTML 的 `flutter_inappwebview` 桥在 Node 里实现 | ✅ | `http` / `cookie.*` / `cache.*` / `log` / `toast` |
| 自动生成标准「阅读3 书源」指向本服务 | ✅ | `/api/legado-source/:id` |
| 段评图片标记（`dp:*`）在正文中剥离 | ✅ | 17.9KB 原始 → 3.8KB 纯正文 |
| 多书源注册 / 热加载 | ✅ | `data/sources/*.json` |
| Web UI（reader-next Vue3） | ⏳ 下一步 | 计划直接对接 `/reader3/*` 契约 |
| 本地书上传、封面/书名/作者/简介编辑、多端进度同步 | ⏳ 下一步 | 见 Roadmap |

## 快速开始

```bash
# Node >= 22
pnpm install
PORT=18080 node apps/server/src/index.js
```

把一个 Legado 包装的 WebView 书源放到 `data/sources/<id>.json`：

```json
{
  "id": "my-source",
  "bookSourceName": "我的书源",
  "bookSourceUrl": "http://example.com/k/xxx",
  "html": "<!DOCTYPE html>…",
  "_runtime": {
    "rewrites": [{ "from": "http://dead-host:4280", "to": "http://live-host:4280" }],
    "key": "书源密钥",
    "timeoutMs": 45000
  }
}
```

`_runtime` 是本服务加的运行参数，导入客户端前会被忽略；`rewrites` 用来把书源里写死的主线路换成可用线路（域名失效时很有用）。

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 存活与书源数 |
| GET | `/api/sources` | 已注册书源 |
| POST | `/api/sources` | 新增书源（body 为 Legado 条目，可数组） |
| DELETE | `/api/sources/:id` | 删除书源 |
| GET | `/api/search?q=&page=&source=` | 搜索，返回 `{books:[…]}` |
| GET | `/api/book?url=&source=` | 详情 |
| GET | `/api/toc?url=&source=` | 目录，返回 `{count,chapters:[…]}` |
| GET | `/api/content?url=&source=` | 正文，返回 `{content}` |
| GET | `/api/legado-source/:id` | 生成可直接导入的阅读3 书源 |

所有 `bookUrl` / `tocUrl` / `chapterId` 都由服务端改写成指回自身的 URL，所以生成出来的阅读3 书源不需要知道上游接口，只按 JSONPath 取字段即可。

## 目录结构

```
apps/server/            HTTP 服务（Fastify）：书源注册、搜索/详情/目录/正文、书源生成
packages/source-runtime/  WebView 书源运行时（jsdom + jQuery + 桥接实现）
packages/legado-source/   阅读3 书源生成器
docs/                   架构与整合计划
docker/                 Dockerfile 与 compose
data/                   运行数据（git 忽略）
```

## 为什么需要「服务端书源运行时」

Legado 家族的书源有两种形态：

1. **规则型**（`ruleSearch` / JSONPath / CSS / `@js:`）——纯数据，任何服务端都能执行。
2. **WebView 型**（`html` 字段 + `flutter_inappwebview.callHandler`）——本质是一段运行在 WebView 里的程序，依赖 `window`、DOM、jQuery 和原生桥。

第二种在服务端跑不了，这就是本项目存在的理由：用 jsdom 提供 DOM、用 Node 实现桥，于是同一份书源既能给 Web UI 用，也能生成规则型书源给 Legado 客户端用。

实测的 `legado-ios v0.1.14`（Swift，`ruleSearch` 20 处、`SwiftSoup`、`java.ajax`，但 `flutter_inappwebview` / `callHandler` 均为 0）只支持第 1 种，因此「适配 APP」= 服务端把它翻译成规则型书源，而不是去改 Swift。

## Roadmap

1. **M1（已完成）** 服务端执行 WebView 书源 + 阅读3 书源生成
2. **M2** `/reader3/*` 契约实现 + reader-next Vue3 UI 接入（书架、阅读器）
3. **M3** 本地书上传（TXT/EPUB/MOBI/PDF）+ 封面/书名/作者/简介手工编辑
4. **M4** 多端同步：服务端为权威，进度带 `updatedAt`，后端最新进度覆盖 Web/APP 旧进度
5. **M5** Docker 一键部署 + 书源订阅 + 章节缓存

## 许可证

AGPL-3.0。本仓库当前代码为原创，但整合目标包含 `hectorqin/reader`（AGPL-3.0）的能力，按最严格上游对齐。

**注意**：`reader-next`（Maple0517 / 1432433gg）仓库未声明许可证，默认保留所有权利。把它作为 UI 复用前需要取得作者许可，否则只能参考其交互设计自行实现。
