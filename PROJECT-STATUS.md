# 项目状态（可验证清单）

本文件只记录**有实测证据**的能力，以及明确未完成的部分。

## 一条命令复现全部结论

```bash
pnpm verify     # 28 项静态校验 + 11 个测试套件，退出码即结论
```

最近一次运行结果：`28/28 static checks passed`、`11/11 套件通过`。

## 已实测通过

| 能力 | 验证套件 |
|---|---|
| `/reader3` 契约（书架/详情/目录/正文/进度/SSE 搜索） | `test-reader3` |
| 书签、替换规则、书源导入、TXT 本地书 | `test-extras` |
| 章节离线缓存（缓存优先读、清空自愈） | `test-cache` |
| 进度冲突：过期写入被拒、更新写入生效 | `test-sync` |
| 书源订阅 `/api/subscribe` | `test-subscribe` |
| EPUB 元数据/章节/封面 | `test-epub` |
| DOCX 段落解析与分章 | `test-docx` |
| MOBI PalmDOC 解压与 EXTH | `test-mobi` |
| 分组：创建/改名/归书/删除 | `test-groups` |
| 连载新章节检查（目录对比、幂等） | `test-updates` |
| Legado 客户端链路（订阅→搜索→详情→目录→正文） | `test-legado-client` |
| Docker 构建输入自洽 | `check-docker`（28 项） |
| 真实起点自建源端到端 | `probe-source.js`（手工，需真实书源） |

所有套件使用仓库内合成样本，空数据库冷启动即可全绿，不依赖私有书源或密钥。

## 明确未验证（环境限制，非代码问题）

| 项 | 原因 | 已做的工作 |
|---|---|---|
| Docker 镜像实际构建与启动 | 开发机 `HypervisorPresent=False`、WSL 无发行版，Docker Desktop 需管理员+重启 | Dockerfile/compose 交付；28 项静态校验；镜像内的三条关键命令（frozen install / 前端构建 / 服务启动）已在本地逐条跑通 |
| Legado iOS 真机联调 | 需实体设备安装 IPA | 用 `test-legado-client` 模拟客户端逐步走完四条规则；真机仅剩网络可达性未知 |

## 范围之外（已确认放弃）

- PDF 扫描版 / OCR：不做（文字版提取保留为可选实验路径）。
- RSS、WebDAV：接口返回明确的「尚未接入」，不伪造成功。

## 关键设计约束（为什么这样做）

1. **服务端执行 WebView 书源**：起点自建源依赖 `flutter_inappwebview` 桥，`legado-ios` 二进制里没有该桥（有 `ruleSearch`、无 `callHandler`），只能由服务端跑运行时，再把结果降级成规则型书源给 APP。
2. **`node:sqlite` 而非 better-sqlite3**：避免镜像内原生编译，alpine 可直接构建。
3. **进度以后端为权威**：`saveBookProgress` 带 `clientUpdatedAt`，晚于服务端才接受，避免旧客户端回滚新进度。
4. **本地书判定用显式 origin 白名单**：不能用 `local://` 前缀（书源自身也可能用该 scheme），否则会把书源书误判成本地书——这个坑踩过三次。
5. **UI 自写**：reader-next 未声明许可证，只借鉴交互、不搬运代码。
