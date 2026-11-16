# 项目状态（可验证清单）

本文件只记录**有实测证据**的能力，以及明确未完成的部分。更新于第 8 轮收尾。

## 已实测通过

| 能力 | 验证方式 | 结果 |
|---|---|---|
| `/reader3` 契约（书架/详情/目录/正文/进度/SSE 搜索） | `scripts/test-reader3.mjs` | ✅ |
| 书签、替换规则、书源导入、TXT 本地书 | `scripts/test-extras.mjs` | ✅ |
| EPUB 元数据/章节/封面 | `scripts/test-epub.mjs` | ✅ |
| DOCX 段落解析与分章 | `scripts/test-docx.mjs` | ✅ |
| MOBI PalmDOC 解压与 EXTH | `scripts/test-mobi.mjs` | ✅ |
| PDF 文字提取（可选，非目标） | `scripts/test-pdf.mjs` | ✅ |
| 进度冲突：过期写入被拒、新写入生效 | `scripts/test-sync.mjs` | ✅ |
| 书源订阅 `/api/subscribe` | `scripts/test-subscribe.mjs` | ✅ |
| Docker 构建输入自洽 | `scripts/check-docker.mjs` | ✅ 28/28 |
| 真实起点自建源端到端 | `scripts/probe-source.js` | ✅ 搜索/952 章目录/正文 |

所有测试使用仓库内合成样本，不依赖任何私有书源或密钥；空数据库冷启动即可全绿。

## 明确未验证

| 项 | 原因 | 影响 |
|---|---|---|
| Docker 镜像实际构建与启动 | 开发机未安装 Docker | 只能证明构建输入齐全，不能保证 `docker build` 成功 |
| Legado iOS 真机联调 | 需要实体设备与安装 IPA | 接口形态与书源生成已验证，未在真机点过 |

## 范围之外（已确认）

- PDF 扫描版 / OCR：不做。
- RSS、WebDAV：接口返回明确的「尚未接入」，不伪造成功。

## 关键设计约束（为什么这样做）

1. **服务端执行 WebView 书源**：起点自建源依赖 `flutter_inappwebview` 桥，`legado-ios` 二进制里没有该桥（`ruleSearch` 有、`callHandler` 无），所以只能由服务端跑运行时，再把结果降级成规则型书源给 APP。
2. **`node:sqlite` 而非 better-sqlite3**：避免镜像内原生编译，alpine 可直接构建。
3. **进度以后端为权威**：`saveBookProgress` 带 `clientUpdatedAt`，晚于服务端才接受，避免旧客户端回滚新进度。
4. **UI 自写**：reader-next 未声明许可证，因此只借鉴交互、不搬运代码，规避授权风险。
