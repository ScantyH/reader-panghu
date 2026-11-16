<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../api.js'

const books = ref([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    books.value = await api.shelfWithCache()
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

async function clear(book) {
  if (!confirm(`清除《${book.name}》的章节缓存？`)) return
  try {
    await api.deleteBookCache(book.bookUrl)
    window.__toast?.('已清除')
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function cache(book) {
  try {
    const result = await api.cacheBook(book.bookUrl, 50)
    window.__toast?.(`已缓存 ${result.cached} 章（累计 ${result.totalCached}）`)
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <h1>缓存管理</h1>
      <span class="badge">{{ books.length }} 本</span>
      <div class="spacer" />
      <button class="ghost" @click="load">刷新</button>
    </div>

    <p class="muted" style="font-size: 13px; margin-top: -6px">
      缓存过的章节断网也能读；缓存存放在服务端，换设备同样有效。
    </p>

    <div v-if="loading" class="muted">加载中…</div>
    <div v-else-if="!books.length" class="empty">书架是空的。</div>
    <div v-else class="list">
      <div v-for="book in books" :key="book.bookUrl" class="list-item">
        <div style="flex: 1; min-width: 0">
          <strong style="font-size: 14px">{{ book.name }}</strong>
          <div class="muted" style="font-size: 12px">
            {{ book.totalChapterNum || 0 }} 章 · 已缓存 {{ book.cachedChapterCount || 0 }} 章
          </div>
        </div>
        <button class="ghost" @click="cache(book)">缓存 50 章</button>
        <button class="ghost" @click="clear(book)">清除缓存</button>
      </div>
    </div>
  </div>
</template>
