<script setup>
import { onMounted, ref } from 'vue'
import BookDetail from '../components/BookDetail.vue'
import { api, coverOf, searchStream } from '../api.js'

const keyword = ref('')
const sources = ref([])
const scope = ref('')
const results = ref([])
const searching = ref(false)
const picked = ref(null)

async function loadSources() {
  try {
    sources.value = (await api.sources()).filter((source) => source.html)
    if (!sources.value.length) window.__toast?.('还没有可用的 WebView 书源，去「书源」导入')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function search() {
  const key = keyword.value.trim()
  if (!key || searching.value) return
  results.value = []
  searching.value = true
  try {
    await searchStream({ key, bookSourceUrl: scope.value || undefined }, (books) => {
      const seen = new Set(results.value.map((book) => `${book.origin}::${book.bookUrl}`))
      results.value = [...results.value, ...books.filter((book) => !seen.has(`${book.origin}::${book.bookUrl}`))]
    })
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    searching.value = false
  }
}

async function pick(book) {
  try {
    const info = await api.bookInfo(book.bookUrl, book.origin)
    picked.value = { ...info, origin: book.origin, originName: book.originName }
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function addToShelf(book) {
  try {
    await api.saveBook(book)
    picked.value = null
    window.__toast?.(`《${book.name}》已加入书架`)
  } catch (error) {
    window.__toast?.(error.message)
  }
}

onMounted(loadSources)
</script>

<template>
  <div>
    <div class="page-head">
      <h1>搜索</h1>
      <div class="spacer" />
      <span v-if="searching" class="badge accent">搜索中…</span>
      <span v-else-if="results.length" class="badge">{{ results.length }} 个结果</span>
    </div>

    <div class="row" style="margin-bottom: 18px; flex-wrap: wrap">
      <input
        v-model="keyword"
        placeholder="书名 / 作者"
        style="flex: 1; min-width: 200px"
        @keyup.enter="search"
      />
      <select v-model="scope" style="max-width: 220px; background: var(--bg-soft); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px">
        <option value="">全部书源</option>
        <option v-for="source in sources" :key="source.bookSourceUrl" :value="source.bookSourceUrl">
          {{ source.bookSourceName }}
        </option>
      </select>
      <button class="primary" :disabled="searching" @click="search">搜索</button>
    </div>

    <div v-if="!results.length && !searching" class="empty">输入关键词，跨书源搜索。</div>

    <div class="grid">
      <div v-for="book in results" :key="`${book.origin}::${book.bookUrl}`" class="card" @click="pick(book)">
        <div class="cover">
          <img v-if="coverOf(book)" :src="coverOf(book)" :alt="book.name" loading="lazy" />
          <div v-else class="placeholder">{{ book.name }}</div>
        </div>
        <h3>{{ book.name }}</h3>
        <p>{{ book.author }}</p>
        <span class="badge" style="margin-top: 6px">{{ book.originName || book.originGroup || '书源' }}</span>
      </div>
    </div>

    <BookDetail v-if="picked" :book="picked" mode="search" @close="picked = null" @save="addToShelf" />
  </div>
</template>
