<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import BookDetail from '../components/BookDetail.vue'
import { api, coverOf, searchStream } from '../api.js'

const keyword = ref('')
const bundles = ref([])
const scope = ref('')
const results = ref([])
const searching = ref(false)
const picked = ref(null)
const route = useRoute()
const progress = ref({ seen: [], counts: {} })

const totals = computed(() => {
  return bundles.value.reduce(
    (sum, bundle) => ({
      count: sum.count + Number(bundle.count || 0),
      enabled: sum.enabled + Number(bundle.enabledCount || 0),
      searchable: sum.searchable + Number(bundle.searchableCount || 0),
    }),
    { count: 0, enabled: 0, searchable: 0 },
  )
})
const scopeStat = computed(() => bundles.value.find((bundle) => bundle.name === scope.value) || null)
const progressTotal = computed(() => (scopeStat.value ? Number(scopeStat.value.searchableCount) || 0 : totals.value.searchable))
const progressText = computed(() => {
  const done = progress.value.seen.length
  return progressTotal.value ? `已搜 ${done}/${progressTotal.value} 个源` : ''
})

async function loadBundles() {
  try {
    bundles.value = await api.sourceBundles()
    if (!bundles.value.length) window.__toast?.('还没有可用的书源，先去「书源」页导入')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function search() {
  const key = keyword.value.trim()
  if (!key || searching.value) return
  results.value = []
  progress.value = { seen: [], counts: {} }
  searching.value = true
  try {
    await searchStream({ key, bookSourceBundle: scope.value || undefined }, (books) => {
      const dedupe = new Set(results.value.map((book) => `${book.origin}::${book.bookUrl}`))
      results.value = [...results.value, ...books.filter((book) => !dedupe.has(`${book.origin}::${book.bookUrl}`))]
      // 按来源累计，没有结果的书源也要算作"已搜过"
      const origins = new Set(books.map((book) => book.origin || '未知'))
      const nextCounts = { ...progress.value.counts }
      for (const origin of origins) nextCounts[origin] = (nextCounts[origin] || 0) + books.filter((book) => (book.origin || '未知') === origin).length
      const seen = [...new Set([...progress.value.seen, ...origins])]
      progress.value = { seen, counts: nextCounts }
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

onMounted(async () => {
  await loadBundles()
  // 顶部栏搜索框跳过来时带着 q，直接搜
  const q = String(route.query.q || '').trim()
  if (q) {
    keyword.value = q
    search()
  }
})
</script>

<template>
  <div>
    <div class="page-head">
      <h1>搜索</h1>
      <div class="spacer" />
      <span v-if="searching" class="badge accent">搜索中… {{ progressText }}</span>
      <span v-else-if="results.length" class="badge">{{ results.length }} 个结果</span>
    </div>

    <div class="row" style="margin-bottom: 18px; flex-wrap: wrap">
      <input
        v-model="keyword"
        placeholder="书名 / 作者"
        style="flex: 1; min-width: 200px"
        @keyup.enter="search"
      />
      <select v-model="scope" style="max-width: 340px; background: var(--bg-soft); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px">
        <option value="">全部书源 · {{ totals.count }} 个源 / 已启用 {{ totals.enabled }}</option>
        <option v-for="bundle in bundles" :key="bundle.name" :value="bundle.name">
          {{ bundle.name }} · {{ bundle.count }} 个源 / 已启用 {{ bundle.enabledCount }}
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
