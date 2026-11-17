<script setup>
import { computed, onMounted, ref } from 'vue'
import PieChart from '../components/PieChart.vue'
import { api } from '../api.js'

const PALETTE = ['#d4812a', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#14b8a6', '#f59e0b', '#94a3b8']

const stats = ref({ days: [], totalSeconds: 0, totalChapters: 0, books: 0, finished: 0 })
const books = ref([])
const groups = ref([])
const loading = ref(false)

const fmt = (seconds) => {
  const value = Number(seconds) || 0
  if (value < 60) return `${value} 秒`
  if (value < 3600) return `${Math.round(value / 60)} 分钟`
  const hours = Math.floor(value / 3600)
  const minutes = Math.round((value % 3600) / 60)
  return `${hours} 小时 ${minutes} 分`
}

const today = computed(() => {
  const key = new Date().toISOString().slice(0, 10)
  return stats.value.days.find((day) => day.date === key) || { seconds: 0, chapters: 0 }
})

const maxSeconds = computed(() => Math.max(1, ...stats.value.days.map((day) => day.seconds)))

/** 阅读时长按书分布：前 6 本 + 其他 */
const bookTimePie = computed(() => {
  const ranked = books.value
    .map((book) => ({ label: book.name || '未命名', value: Number(book.readingSeconds) || 0 }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
  if (!ranked.length) return []
  const items = ranked.slice(0, 6).map((item, index) => ({
    ...item,
    color: PALETTE[index % PALETTE.length],
    display: fmt(item.value),
  }))
  const rest = ranked.slice(6).reduce((sum, item) => sum + item.value, 0)
  if (rest > 0) items.push({ label: '其他', value: rest, color: PALETTE[7], display: fmt(rest) })
  return items
})

const bookTimeTotal = computed(() => bookTimePie.value.reduce((sum, item) => sum + item.value, 0))

/** 阅读进度分布 */
const progressPie = computed(() => {
  const buckets = [
    { label: '未开始', value: 0, color: '#94a3b8' },
    { label: '1–25%', value: 0, color: '#f59e0b' },
    { label: '26–50%', value: 0, color: '#10b981' },
    { label: '51–75%', value: 0, color: '#3b82f6' },
    { label: '76–99%', value: 0, color: '#8b5cf6' },
    { label: '已读完', value: 0, color: '#d4812a' },
  ]
  for (const book of books.value) {
    const total = Number(book.totalChapterNum) || 0
    const read = Number(book.durChapterIndex) || 0
    if (!total || !Number(book.durChapterTime)) {
      buckets[0].value += 1
      continue
    }
    const percent = Math.min(100, ((read + 1) / total) * 100)
    if (percent >= 100) buckets[5].value += 1
    else if (percent <= 25) buckets[1].value += 1
    else if (percent <= 50) buckets[2].value += 1
    else if (percent <= 75) buckets[3].value += 1
    else buckets[4].value += 1
  }
  return buckets.map((bucket) => ({ ...bucket, display: `${bucket.value} 本` }))
})

/** 分组分布 */
const groupPie = computed(() => {
  const nameOf = new Map(groups.value.map((group) => [Number(group.groupId), group.groupName]))
  const counts = new Map()
  for (const book of books.value) {
    const id = Number(book.group || 0)
    const name = id === 0 ? '未分组' : nameOf.get(id) || `分组 ${id}`
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  const ranked = [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
  const items = ranked.slice(0, 6).map((item, index) => ({
    ...item,
    color: PALETTE[index % PALETTE.length],
    display: `${item.value} 本`,
  }))
  const rest = ranked.slice(6).reduce((sum, item) => sum + item.value, 0)
  if (rest > 0) items.push({ label: '其他', value: rest, color: PALETTE[7], display: `${rest} 本` })
  return items
})

/** 最近 30 天按时间段分布 */
const recentPie = computed(() => {
  const buckets = [
    { label: '今天', value: 0, color: PALETTE[0] },
    { label: '1–6 天前', value: 0, color: PALETTE[1] },
    { label: '7–13 天前', value: 0, color: PALETTE[2] },
    { label: '14–29 天前', value: 0, color: PALETTE[3] },
  ]
  const todayUtc = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  for (const day of stats.value.days) {
    const stamp = Date.parse(`${day.date}T00:00:00Z`)
    if (!Number.isFinite(stamp)) continue
    const daysAgo = Math.round((todayUtc - stamp) / 86400000)
    const index = daysAgo <= 0 ? 0 : daysAgo <= 6 ? 1 : daysAgo <= 13 ? 2 : 3
    buckets[index].value += Number(day.seconds) || 0
  }
  return buckets.map((bucket) => ({ ...bucket, display: fmt(bucket.value) }))
})

async function load() {
  loading.value = true
  try {
    const [reading, shelf, groupList] = await Promise.all([
      api.readingStats(),
      api.bookshelf().catch(() => []),
      api.groups().catch(() => []),
    ])
    stats.value = reading
    books.value = Array.isArray(shelf) ? shelf : []
    groups.value = Array.isArray(groupList) ? groupList : []
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <h1>阅读统计</h1>
      <span class="badge">最近 30 天</span>
      <div class="spacer" />
      <button class="ghost" :disabled="loading" @click="load">刷新</button>
    </div>

    <div v-if="loading" class="muted">加载中…</div>
    <template v-else>
      <div class="stats-cards">
        <div class="stats-card">
          <div class="stats-card-label">今日阅读</div>
          <div class="stats-card-value">{{ fmt(today.seconds) }}</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-label">今日章节</div>
          <div class="stats-card-value">{{ today.chapters }} 章</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-label">累计阅读</div>
          <div class="stats-card-value">{{ fmt(stats.totalSeconds) }}</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-label">累计章节</div>
          <div class="stats-card-value">{{ stats.totalChapters }} 章</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-label">书架</div>
          <div class="stats-card-value">{{ books.length }} 本</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-label">已读完</div>
          <div class="stats-card-value">{{ stats.finished }} 本</div>
        </div>
      </div>

      <div class="pie-grid">
        <PieChart
          title="阅读时长分布"
          :items="bookTimePie"
          :center-value="fmt(bookTimeTotal)"
          center-label="累计"
        />
        <PieChart
          title="阅读进度分布"
          :items="progressPie"
          :center-value="String(books.length)"
          center-label="本书"
        />
        <PieChart
          title="分组分布"
          :items="groupPie"
          :center-value="String(books.length)"
          center-label="本书"
        />
        <PieChart
          title="最近 30 天分布"
          :items="recentPie"
          :center-value="fmt(stats.totalSeconds)"
          center-label="30 天"
        />
      </div>

      <h3 class="section-title" style="margin-bottom: 12px">最近 30 天明细</h3>
      <div v-if="!stats.days.length" class="empty">还没有阅读记录。去读几章再回来。</div>
      <div v-else class="list">
        <div v-for="day in stats.days.slice().reverse()" :key="day.date" class="list-item">
          <span class="muted" style="width: 96px; font-size: 12px">{{ day.date }}</span>
          <div style="flex: 1; height: 8px; background: var(--color-bg-sunken); border-radius: 999px; overflow: hidden">
            <i :style="{ display: 'block', height: '100%', width: (day.seconds / maxSeconds) * 100 + '%', background: 'var(--color-primary)' }" />
          </div>
          <span class="muted" style="font-size: 12px; width: 96px; text-align: right">{{ fmt(day.seconds) }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
