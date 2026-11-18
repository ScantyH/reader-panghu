# 胖虎阅读 iOS App 设计（2026-11-18）

## 意图

手机（iPhone 13 Pro Max）上有一个像 App 的胖虎阅读客户端：输入后端地址与账号即可登录，
**后端有的功能手机端全都有**，且与电脑网页**实时双向同步阅读进度**——网页看到第 12 章 40%，
打开 App 接着看；App 读到哪里，网页刷新/切换时也回到同一处。

同时要能在开发过程中实时看到手机画面并调试。

## 目标

- iOS App 安装在用户手机上（用户自行签名），可长期使用。
- 覆盖 `/reader3` 契约的全部功能：书架、分组、搜索（SSE 多源）、书源管理/调试/订阅、
  目录、正文、缓存、书签、替换规则、RSS、统计、备份/恢复、本地书导入、书仓、用户与权限。
- 进度双向同步：任何一端写入，另一端在数秒内看到并采纳（最新者胜）。
- 章节内位置也要同步（不只是第几章）。

## 非目标

- 不做安卓/iPad 专门优化（先 iPhone 竖屏）。
- 不重写书源引擎，不复制 legado-ios 的 Swift 代码。
- 不做 App Store 上架与推送通知（个人签名使用）。
- 不替换现有网页的桌面布局。

## 约束

- 开发机是 Windows：**无法编译 iOS**，Swift 只能靠 GitHub Actions 构建验证。
- 现有网页是 Vue 3 + Vite，功能齐全，且已有移动端雏形（底部导航、阅读器移动样式）。
- 后端是 Fastify + node:sqlite，进度字段 `durChapterPos` 已存在但网页没写入。
- 证书为 Let's Encrypt，iOS 可直接 https 访问，ATS 不需特殊放行（局域网 http 另说）。

## 方案选择

| 方案 | 做法 | 结论 |
|---|---|---|
| **A 原生外壳 + 现有网页（选定）** | SwiftUI 外壳 + WKWebView 加载同一套 Vue 网页；改 UI 只部署后端，不用重新签名 | 照 MoviePilot-App 的成熟形态；网页即 App 本体，能在浏览器里实时预览调试；风险最小 |
| B 原生重写 | Fork legado-ios 改 SwiftUI | 手感最好，但 Windows 上只能盲改，每轮等 CI，周期不可控 |
| C PWA | 只做网页 | 最快，但不是 IPA，WebView 存储与体验受 Safari 限制 |

选 A 的关键理由：用户要的「实时预览 + 调试」只有在网页层才成立；而功能覆盖度由网页决定，
外壳只承担 iOS 原生体验（启动、登录、状态栏、返回手势、分享、保活、错误页）。

## 架构

```
┌──────────────── iPhone ────────────────┐
│ SwiftUI 外壳                            │
│  · 连接页（实例地址 + 账号密码）         │
│  · WKWebView（持久 Cookie/LocalStorage）│
│  · JS 桥：进度、分享、TTS、保活、错误    │
│  · 原生错误页 / 离线页 / 关于页          │
│         ↓ 加载 {实例}/?token=…          │
│ Vue 网页（手机布局，与桌面同一份代码）    │
└───────────────┬────────────────────────┘
                │ /reader3/*  HTTPS
┌───────────────▼────────────────────────┐
│ reader-panghu 后端（已有）               │
│  · 进度服务端权威（最新者胜）            │
│  · 新增：章节内位置、设备标识、SSE 推送   │
└────────────────────────────────────────┘
          ▲
          │ 同一套 API
   电脑浏览器（桌面布局）
```

外壳仓库：`ScantyH/panghu-reader-ios`（private）。网页与后端改动留在 `reader-panghu` 仓库。

## 同步协议

存储：`books.durChapterIndex / durChapterPos / durChapterTime / durChapterTitle`。

- `durChapterPos` 语义：**章节纯文本内的字符偏移**（0-based）。与排版无关，滚动模式与分页模式都能换算。
- 写入：`POST /reader3/saveBookProgress`
  - 入参 `{ bookUrl, index, position, chapterTitle, clientUpdatedAt?, device? }`
  - 服务端规则：带 `clientUpdatedAt` 且不晚于已存时间 → 拒绝（返回权威值）；否则写库，时间用服务端 `Date.now()`。
  - 返回 `{ updatedAt, accepted, index, position, chapterTitle }`（兼容旧字符串返回由网页侧适配）。
- 读取（轻量）：`GET /reader3/getBookProgress?bookUrl=` → `{ index, position, chapterTitle, updatedAt, device }`
- 推送：`GET /reader3/progressSSE`（EventSource），任一设备写入后向该用户所有在线连接广播
  `{ bookUrl, index, position, updatedAt, device }`；客户端断线时降级为 15s 轮询。
- 客户端策略：
  - 打开书：先取服务端进度，定位到章节 + 字符偏移（滚动模式按段落累计字数量化）。
  - 阅读中：滚动/翻页后 800ms 防抖写一次，最长 10s 一次；`visibilitychange=hidden` 时立即写。
  - 收到他人进度：若不在阅读中 → 提示「已在手机/网页更新到第 X 章」，点击跳转；若所在书/章不同则只提示。
  - 离线：写入进本地队列（`localStorage`），恢复网络后带 `clientUpdatedAt` 重放，服务端仍按最新者胜裁决。

## 手机端信息架构（与网页共用路由）

- 底部标签：书架 / 搜索 / 书源 / 统计 / 我的（其余入口收进"我的"）
- 书架：网格 3 列 / 列表切换、分组横滑、最近阅读、多选批量
- 搜索：SSE 分源进度、加载骨架、来源筛选
- 书源：列表、分组筛选、启停、导入、调试、订阅地址复制
- 阅读器：点按分区翻页 + 上下滚动两种模式、翻页动画、字号/行距/背景、目录（长目录可搜索）、
  书签、段评面板、TTS、正文查找、换源、缓存当前章
- 我的：统计、备份/恢复、本地书导入、书仓、替换规则、缓存管理、用户/改密、关于

## iOS 外壳（v1 范围）

- SwiftUI，iOS 16+，iPhone 竖屏，Bundle ID `com.panghu.reader`，图标取 `胖虎阅读.png`。
- 连接页：实例地址（默认 `https://phyd.179613.xyz:16666`）、账号、密码；登录走 `POST /reader3/login`，
  token 存 Keychain；`?token=` 传给网页并在网页侧落 localStorage。
- WKWebView：持久数据存储、侧滑返回、下拉刷新关闭（避免与阅读冲突）、自定义 UA 追加 `PanghuReader/1.0`。
- JS 桥：`progress`（后台兜底写入）、`share`（系统分享）、`toast`、`tts`（原生朗读，v2）、`openExternal`。
- 原生错误页：连不上/超时/证书错误给出可读提示与重试；离线时保留上一次页面。
- 关于页：版本、实例地址、清除网页缓存、退出登录。

## 构建与签名

- `ios/project.yml`（XcodeGen）生成工程；CI：`macos-15` + `xcodebuild -sdk iphoneos CODE_SIGNING_ALLOWED=NO`，
  打包 `Payload/*.app` 为 `PanghuReader-<version>-unsigned.ipa`，上传 Artifact 并发布到 Release。
- 用户用 Sideloadly / SideStore 自签，免费账号 7 天续签。
- 私有仓库 Actions 免费 2000 分钟/月，macOS 按 10 倍计 → 约 200 分钟，够 ~20 次构建，需节约触发。

## 实时开发预览

- `pnpm --filter reader-panghu-web dev` 起 Vite；`/preview` 页面：iPhone 13 Pro Max 机框（430×932），
  iframe 加载真实 App，右侧调试抽屉显示接口调用、登录态、当前进度、错误。
- 「模拟另一台设备」按钮：直接向 `/reader3/saveBookProgress` 写一条带其他设备标识的进度，
  观察手机画面是否自动跟随（双向同步的可视化验证）。
- 手机连同一 Wi-Fi 打开 `http://<电脑IP>:5173` 真机预览，无需签名。
- 每个里程碑用 Edge 无头截图贴进对话。

## 里程碑

1. 仓库 + CI + 空壳 IPA 装上手机（证明签名链路）
2. 实时预览台 + 移动布局骨架 + 登录
3. 书架、搜索、书源、我的
4. 阅读器移动版 + 同步协议（含 SSE）
5. 全功能走查 + 回归测试 + 部署 NAS + 真机验收

## 风险

- 外壳无法本地编译：Swift 报错只能靠 CI 回传，预计 2–4 轮。外壳保持薄、少用新 API。
- WKWebView 的后台定时器会被挂起：进度兜底由原生在 `didEnterBackground` 触发一次。
- 现有网页桌面优先，移动适配要动 `ui.css` / `styles.css` 与 Reader.vue，注意桌面不回归。
- 免费签名 7 天续签；建议用户用 SideStore 自动续签。
