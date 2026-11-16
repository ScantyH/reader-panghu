<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from '../api.js'

const stats = ref({ days: [], totalSeconds: 0, totalChapters: 0, books: 0, finished: 0 })
const loading = ref(false)

const today = computed(() => {
  const key = new Date().toISOString().slice(0, 10)
  return stats.value.days.find((day) => day.date === key) || { seconds: 0, chapters: 0 }
})

const maxSeconds = computed(() => Math.max(1, ...stats.value.days.map((day) => day.seconds)))

const fmt = (seconds) => {
  const value = Number(seconds) || 0
  if (value < 60) return `${value} 秒`
  if (value < 3600) return `${Math.round(value / 60)} 分钟`
  const hours = Math.floor(value / 3600)
  const minutes = Math.round((value % 3600) / 60)
  return `${hours} 小时 ${minutes} 分`
}

async function load() {
  loading.value = true
  try {
    stats.value = await api.readingStats()
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
      <div class="spacer" />
      <button class="ghost" @click="load">刷新</button>
    </div>

    <div v-if="loading" class="muted">加载中…</div>
    <template v-else>
      <div class="list" style="margin-bottom: 24px">
        <div class="list-item"><span style="flex: 1">今日阅读</span><span class="stat-pill">{{ fmt(today.seconds) }}</span></div>
        <div class="list-item"><span style="flex: 1">今日章节</span><span class="stat-pill">{{ today.chapters }} 章</span></div>
        <div class="list-item"><span style="flex: 1">累计阅读</span><span class="stat-pill">{{ fmt(stats.totalSeconds) }}</span></div>
        <div class="list-item"><span style="flex: 1">书架</span><span class="stat-pill">{{ stats.books }} 本 / 读完 {{ stats.finished }}</span></div>
      </div>

      <h3 style="font-size: 14px; margin: 0 0 12px">最近 30 天</h3>
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
