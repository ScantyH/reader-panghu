# 统计页与 RSS 归位设计

日期：2026-11-17

## 背景

底部导航目前是 书架 / 搜索 / 书源 / RSS / 备份 / 设置。RSS 使用频率低，却占了一级入口；阅读统计藏在设置里，入口太深。统计页现在只有数字和 30 天条形列表，缺少分布视图。

## 目标

- 底部导航：RSS 移除，原位置换成「统计」；顺序为 书架 / 搜索 / 书源 / 统计 / 备份 / 设置。
- RSS 功能并入「书源」页，作为书源顶部的第 3 个标签（管理 / 探索 / RSS / 检测 / 调试）。
- 统计页用饼图展示阅读分布：阅读时长按书、阅读进度、分组、最近 30 天时间段。
- 保留原有汇总数字与 30 天明细条形图。

## 非目标

- 不改后端接口；统计继续用 `/reader3/getReadingStats` + `/reader3/getBookshelf` + `/reader3/getBookGroups`。
- 不引入图表库；饼图用原生 SVG 圆环绘制。
- 不改阅读器与书源管理逻辑。

## 设计

### 导航与 RSS

- `App.vue` 的 `NAV` 把 `/rss` 换成 `/stats`（标签「统计」，图标 📊）。
- `Sources.vue`：`TAB` 增加 `rss: 'RSS'`，内容区渲染 `<Rss embedded />`；保留原 `/rss` 路由。
- `Rss.vue` 增加 `embedded` 布尔 prop：为 true 时隐藏页面大标题与源数量徽标，只留一行说明 + 订阅输入框，避免在书源页里再出现一个页面头。

### 统计页

数据来源：`api.readingStats()`（days/totalSeconds/totalChapters/books/finished）、`api.bookshelf()`（每本书的 `readingSeconds`、`durChapterIndex`、`totalChapterNum`、`group`）、`api.groups()`（分组名）。

汇总卡片：今日阅读、今日章节、累计阅读、累计章节、书架本数、读完本数。

四张饼图（SVG 圆环 + 图例，图例显示数值与百分比）：

1. **阅读时长分布**：按书聚合 `readingSeconds`，取前 6 本，其余合并为「其他」。
2. **阅读进度分布**：未开始 / 1–25% / 26–50% / 51–75% / 76–99% / 已读完。
3. **分组分布**：按书籍分组聚合本数，前 6 组 + 其他。
4. **最近 30 天分布**：今天 / 1–6 天前 / 7–13 天前 / 14–29 天前，按时长聚合。

饼图组件 `components/PieChart.vue`：props `title`、`items`（label/value/color/display）、`centerValue`、`centerLabel`；空数据时显示「暂无数据」。颜色使用固定 8 色板，与主题橙协调。

### 样式

`ui.css` 增加 `.stats-cards`、`.stats-card`、`.pie-grid`、`.pie-card`、`.pie-svg`、`.pie-legend` 等；手机 ≤640px 时饼图纵向排列。

## 验证

- 构建通过；本地临时 DATA_DIR 写入多天阅读记录、不同进度与分组的书，截图核对四张饼图数值与百分比。
- 底部导航无 RSS、有统计；书源页出现 RSS 标签并可添加/查看订阅。
- 部署到 NAS 后通过公网地址确认新构建产物。
