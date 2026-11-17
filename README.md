<p align="center">
  <img src="apps/web/public/brand/logo-256.png" alt="胖虎阅读" width="140" />
</p>

<h1 align="center">胖虎阅读</h1>

<p align="center">自建小说阅读服务 · 阅读 3 书源 · 本地书籍 · 多设备同步</p>

---

## 功能

**书源**

- 阅读 3（Legado）书源：CSS / JSONPath / XPath / `@js:` / `@get:` / `@put:` / `##` 正则，另支持 WebView 型书源
- 书源管理：搜索、分组筛选、启停、JSON 编辑、文件/URL 导入、导出
- 书源探索：按 `exploreUrl` 分类拉取书单
- 失效检测：关键词批量检测，可标记失效并一键清理
- 书源调试：搜索 / 详情 / 目录 / 正文逐阶段查看原始响应与解析结果
- 阅读 3 客户端订阅：`/api/subscribe` 供 Legado 自动拉取书源

**书架与阅读**

- 书架：网格/列表布局、多选批量管理、分组
- 本地书籍导入：TXT / EPUB / DOCX / MOBI / AZW3 / PDF
- 书仓：服务端目录即分类，新建分类、上传、一键导入书架
- 阅读器：目录搜索、简繁转换（opencc）、自定义字体、TTS 朗读、正文查找、换源、段落笔记、段评面板
- 缓存管理、替换规则、书签、阅读统计
- 阅读进度多设备同步（服务端权威）

**其它**

- RSS 订阅与定时刷新
- WebDAV 备份/恢复 + 目录浏览
- 备份导出为 JSON
- 多用户：scrypt 密码、会话持久化、按用户隔离数据、管理员角色
- PWA：可安装到桌面/主屏

## 快速开始

```bash
pnpm install
pnpm --filter reader-panghu-web run build
PORT=18080 DATA_DIR=./data node apps/server/src/index.js
```

打开 `http://127.0.0.1:18080`。

### 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `PORT` | 监听端口 | `18080` |
| `DATA_DIR` | 数据目录（SQLite、书仓） | `./data` |
| `LIBRARY_DIR` | 书仓根目录 | `$DATA_DIR/library` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 启动时创建/提权管理员 | 无 |
| `SOURCE_TIMEOUT_MS` | 书源请求超时 | `30000` |
| `RSS_REFRESH_MINUTES` | RSS 刷新间隔 | `30` |
| `CHAPTER_CHECK_INTERVAL_HOURS` | 章节更新检查间隔，0 关闭 | `24` |

## 部署

仓库自带 `docs/FEATURES` 与 Docker 文件：

```bash
docker build -f docker/Dockerfile -t reader-panghu:latest .
docker run -d -p 18080:18080 -v $PWD/data:/app/data reader-panghu:latest
```

NAS 上的一次性部署脚本见 `scripts/deploy-nas.mjs`（上传源码 → 重启容器 → 等待就绪）。

## 测试

```bash
node scripts/run-all-tests.mjs
```

覆盖：阅读 3 契约、书源规则引擎、书源工具、书仓、缓存、同步、订阅、EPUB/DOCX/MOBI/PDF 解析、RSS、WebDAV、认证与多用户隔离、阅读增强。

## 目录结构

```
apps/server         Fastify 服务端（/reader3 契约、/api、书源运行时）
apps/web            Vue 3 前端
packages/source-runtime   WebView 书源运行时（jsdom + 桥）
packages/legado-source    规则型书源生成
scripts             测试与部署脚本
docs                功能对照与说明
```

## 许可

见 [LICENSE](LICENSE)。仅供个人自建使用，请遵守内容来源的授权与当地法律。
