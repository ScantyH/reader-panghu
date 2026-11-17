# 设置两级菜单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把书架工具栏的 10 个入口收进设置页，设置页呈现「一级分类 + 二级条目」结构，桌面左栏、手机 chips。

**Architecture:** 只改前端（`apps/web`）。路由加 `:section?` 参数；`Settings.vue` 重写为左侧一级导航 + 右侧各分类面板；`Bookshelf.vue` 删除工具栏、分组弹层和动作函数，只保留浏览与多选；动作（导入/检查更新/刷新缓存/退出）在设置面板里执行。

**Tech Stack:** Vue 3 `<script setup>`、vue-router 4、现有 CSS 变量（styles.css / ui.css）。

**Spec:** `docs/superpowers/specs/2026-11-17-settings-menu-design.md`

## Global Constraints

- 不改后端、不改 `/reader3` 契约；详情页路由（`/warehouse`、`/bookmarks`、`/cache`、`/replace`、`/stats`、`/backup`、`/webdav`、`/users`）保持原样。
- 一级分类固定四个：`account`、`shelf`、`data`、`system`；未知 section 回落 `account`。
- 所有颜色、圆角、间距用现有变量，不新增依赖、不引 UI 库。
- 手机（≤760px）一级菜单横向滚动；桌面 ≥761px 左侧竖排。
- 项目根在 `F:\胖虎阅读\reader-panghu`（不在 DSH 工作区）；node 用 DSH 内置 `C:\Users\30879\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`。
- 本目录无 git：跳过提交步骤。

## Review Focus

- 书架页残留：删除工具栏后不能有孤立函数/变量导致编译错误（`checkUpdates`/`refreshCache`/`importBook`/`fileInput`/`showGroups` 等）。
- 批量管理入口：`/bookshelf?manage=1` 进入多选、点击书切换选中、退出后恢复普通点击；直接访问 `/bookshelf` 不得默认进入多选。
- 动作在设置里可用：导入（文件选择）、检查更新（轮询结束）、刷新缓存（最近 5 本）、退出登录（清 token 跳登录）。
- 管理员的用户管理只对有 admin 角色显示；普通用户看不到用户列表也不能触发接口。
- 未知 section（如 `/settings/xxx`）回落到账号面板且左侧高亮正确。

---

### Task 1: 路由与 App.vue 修正

**Files:**
- Modify: `apps/web/src/router.js:37`
- Modify: `apps/web/src/App.vue:2`

**Interfaces:**
- Produces: 路由 `name: 'settings'`，path `/settings/:section?`；`Settings.vue` 可从 `route.params.section` 读取一级分类。

- [ ] **Step 1:** `router.js` 的 settings 路由改为 `{ path: '/settings/:section?', name: 'settings', component: Settings }`。
- [ ] **Step 2:** `App.vue` script 顶部补 `import { api, setToken } from './api.js'`（现在用了但没 import，运行时会 `api is not defined`）。
- [ ] **Step 3:** 构建确认不报错：`node node_modules/vite/bin/vite.js build`（目录 `apps/web`）。

### Task 2: 设置页样式

**Files:**
- Modify: `apps/web/src/ui.css`（末尾追加 `/* ─── 设置：一级菜单 + 二级面板 ─── */` 段）

**Interfaces（类名，Task 3 使用）:**
- `.settings-layout` 桌面 `grid-template-columns: 220px minmax(0, 1fr); gap: 24px`
- `.settings-nav` / `.settings-nav-item` / `.settings-nav-item.active`
- `.settings-panel` / `.settings-panel-head`
- `.settings-card` / `.settings-card-title`
- `.settings-row`（`<router-link>`、`<button>`、`<div>` 通用；button 需重置字体/背景/边框/对齐）
- `.settings-row-title` / `.settings-row-desc` / `.settings-row-meta` / `.settings-row.danger`
- `.settings-kv`（label + value 两列）
- `@media (max-width: 760px)`：layout 单列、nav 横排 `overflow-x:auto`

- [ ] **Step 1:** 按上面的选择器写样式，全部使用 `--color-*`/`--radius-*`/`--space-*`/`--text-*` 变量；`settings-row` 的 button 重置 `display:flex; width:100%; padding; background:none; border:0; font:inherit; color:inherit; text-align:left; cursor:pointer`。
- [ ] **Step 2:** 手机断点里 nav 不允许换行（`flex-wrap: nowrap`）、`-webkit-overflow-scrolling: touch`，隐藏滚动条。

### Task 3: 重写 Settings.vue

**Files:**
- Modify: `apps/web/src/views/Settings.vue`（整体重写）

**Interfaces:**
- Consumes: `api`（`getUserInfo`、`userList`、`setUserRole`、`deleteUser`、`changePassword`、`groups`、`saveBookGroup`、`deleteBookGroup`、`bookshelf`、`cacheBook`、`checkChapterUpdates`、`chapterUpdateStatus`、`uploadLocal`、`logout`）、`setToken`、`useRoute`。
- Produces: 四个面板；一级导航 key 与路由 section 一致。

**结构：**

- `SECTIONS = [{id:'account',label:'账号',icon:'👤'},{id:'shelf',label:'书架',icon:'📚'},{id:'data',label:'数据',icon:'📈'},{id:'system',label:'系统',icon:'⚙️'}]`
- `section = computed(() => SECTIONS.some(s => s.id === route.params.section) ? route.params.section : 'account')`
- 状态：`me`、`users`、`health`、`groups`、`oldPassword/newPassword`、`importInput`、`shelfBusy`、`shelfStatus`、`newGroupName`。

**账号面板：** 账号信息（用户名/角色/登录模式）、修改密码表单、管理员用户列表（角色切换/删除）、退出登录行。

**书架面板：**
- 导入：隐藏 `<input type="file" accept=".txt,.epub,.docx,.mobi,.azw3,.azw,.pdf">`，行点击触发；成功 toast「已加入《name》」。
- 批量管理：`router.push('/bookshelf?manage=1')`。
- 分组管理：新建输入 + 分组列表（改名 `prompt`、删除 `confirm`），增删改后刷新。
- 链接行：书仓 `/warehouse`、书签 `/bookmarks`、缓存管理 `/cache`、替换规则 `/replace`。
- 动作行：检查更新（复制 Bookshelf 的 started/轮询逻辑，结束 toast 更新数）、刷新缓存（`api.bookshelf()` 按 `durChapterTime` 倒序取前 5，`cacheBook(url,20,true)`）。

**数据面板：** 阅读统计 `/stats`、备份与恢复 `/backup`、WebDAV `/webdav`。

**系统面板：** `/api/health` 的书源/书籍/运行时长；关于（胖虎阅读 · 自建小说阅读服务）。

- [ ] **Step 1:** 重写 `<script setup>` 与 `<template>`，一级导航用 `<router-link :to="'/settings/' + s.id">`，active 类按 `section` 判断。
- [ ] **Step 2:** 所有动作失败走 `window.__toast?.(error.message)`，不吞异常。
- [ ] **Step 3:** 构建通过。

### Task 4: Bookshelf.vue 收口

**Files:**
- Modify: `apps/web/src/views/Bookshelf.vue`

**改动：**
- 删除 `.shelf-toolbar` 整块与隐藏 file input；`page-head` 加「设置」`<router-link class="ghost" to="/settings/shelf">设置</router-link>`。
- 删除 `checkUpdates`、`refreshCache`、`importBook`、`fileInput`、`showGroups`、`newGroupName`、`addGroup`、`renameGroup`、`removeGroup` 及对应模板（分组管理弹层、分组 tabs 的「管理」按钮）。
- 引入 `useRoute`；`selectMode = ref(route.query.manage === '1')`；`watch(() => route.query.manage, v => { selectMode.value = v === '1'; if (!selectMode.value) selected.value = [] })`。
- 多选栏增加「退出管理」按钮（清空 selected、selectMode=false）。
- 空书架文案改为「去 设置 → 书架 → 导入本地书」。
- 保留：布局切换、分类 tabs、长按/更多菜单、批量移动/删除、书籍信息弹层、继续阅读。

- [ ] **Step 1:** 按上面删改，确认无未使用变量残留。
- [ ] **Step 2:** 构建通过。

### Task 5: 构建与截图验证

**Files:** 无

- [ ] **Step 1:** `apps/web` 下 `node node_modules/vite/bin/vite.js build`，产物 `dist/` 更新。
- [ ] **Step 2:** 起临时服务（`DATA_DIR` 指向临时目录，单用户模式，避免登录），Edge headless 截图：
  - 1280×900：`/bookshelf`、`/settings/account`、`/settings/shelf`、`/settings/data`、`/settings/system`
  - 420×900：`/settings/shelf`、`/bookshelf`
  检查：书架无工具栏、设置左栏/chips 高亮正确、四个面板内容齐全、手机不横向溢出。
- [ ] **Step 3:** `node scripts/check-docker.mjs` 仍 28/28（后端未动）。
