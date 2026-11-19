<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import BookDetail from '../components/BookDetail.vue'
import { api, coverOf, searchStream } from '../api.js'

const keyword = ref('')
const bundles = ref([])
const selectedBundles = ref([])
const draftBundles = ref([])
const showScope = ref(false)
const pickerPendingSearch = ref(false)
const results = ref([])
const searching = ref(false)
const picked = ref(null)
const route = useRoute()
const progress = ref({ seen: [], counts: {} })

const totals = computed(() =>
  bundles.value.reduce(
    (sum, bundle) => ({
      count: sum.count + Number(bundle.count || 0),
      enabled: sum.enabled + Number(bundle.enabledCount || 0),
      searchable: sum.searchable + Number(bundle.searchableCount || 0),
    }),
    { count: 0, enabled: 0, searchable: 0 },
  ),
)
const selectedStats = computed(() => {
  const rows = bundles.value.filter((bundle) => selectedBundles.value.includes(bundle.name))
  return {
    count: rows.reduce((sum, bundle) => sum + Number(bundle.count || 0), 0),
    enabled: rows.reduce((sum, bundle) => sum + Number(bundle.enabledCount || 0), 0),
    searchable: rows.reduce((sum, bundle) => sum + Number(bundle.searchableCount || 0), 0),
  }
})
const scopeLabel = computed(() => {
  if (!selectedBundles.value.length) return '全部书源'
  if (selectedBundles.value.length === bundles.value.length) return `全部书源（${bundles.value.length} 个汇总）`
  return selectedBundles.value.join('、')
})
const progressTotal = computed(() => selectedStats.value.searchable)
const progressText = computed(() => {
  const done = progress.value.seen.length
  return progressTotal.value ? `已搜 ${done}/${progressTotal.value} 个源` : ''
})

async function loadBundles() {
  try {
    bundles.value = await api.sourceBundles()
    if (!bundles.value.length) {
      window.__toast?.('还没有可用的书源，先去「书源」页导入')
      return
    }
    if (bundles.value.length === 1) selectedBundles.value = [bundles.value[0].name]
    else openScope(false)
  } catch (error) {
    window.__toast?.(error.message)
  }
}

function openScope(pendingSearch = false) {
  pickerPendingSearch.value = pendingSearch
  draftBundles.value = [...selectedBundles.value]
  showScope.value = true
}

function toggleDraft(name) {
  draftBundles.value = draftBundles.value.includes(name)
    ? draftBundles.value.filter((item) => item !== name)
    : [...draftBundles.value, name]
}

function selectAllDraft() {
  draftBundles.value = bundles.value.map((bundle) => bundle.name)
}

function clearDraft() {
  draftBundles.value = []
}

function confirmScope() {
  selectedBundles.value = [...draftBundles.value]
  showScope.value = false
  if (pickerPendingSearch.value && keyword.value.trim()) search()
  pickerPendingSearch.value = false
}

async function search() {
  const key = keyword.value.trim()
  if (!key || searching.value) return
  if (!selectedBundles.value.length) {
    openScope(true)
    return
  }
  results.value = []
  progress.value = { seen: [], counts: {} }
  searching.value = true
  try {
    await searchStream({ key, bookSourceBundles: selectedBundles.value }, (books) => {
      const dedupe = new Set(results.value.map((book) => `${book.origin}::${book.bookUrl}`))
      results.value = [...results.value, ...books.filter((book) => !dedupe.has(`${book.origin}::${book.bookUrl}`))]
      const origins = new Set(books.map((book) => book.origin || '未知'))
      const nextCounts = { ...progress.value.counts }
      for (const origin of origins) nextCounts[origin] = (nextCounts[origin] || 0) + books.filter((book) => (book.origin || '未知') === origin).length
      const seen = [...new Set([...progress.value.seen, ...origins])]
      progress.value = { seen, counts: nextCounts }
    })
  } catch {
    // 单个书源失败时服务端已经跳过；连接中断也保留已拿到的结果，不再弹错误
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

/** 加入书架时第一次就把目录拿回来，书架直接显示真实章节数 */
async function addToShelf(book) {
  try {
    const saved = await api.saveBook(book)
    try {
      const chapters = await api.chapterList({
        bookUrl: saved.bookUrl || book.bookUrl,
        tocUrl: saved.tocUrl || book.tocUrl,
        bookSourceUrl: saved.origin || book.origin,
      })
      if (chapters.length) {
        await api.saveBook({
          ...saved,
          totalChapterNum: chapters.length,
          latestChapterTitle: chapters.at(-1)?.title || saved.latestChapterTitle || '',
        })
      }
    } catch {
      /* 目录暂时取不到时，打开书仍会再取一次 */
    }
    picked.value = null
    window.__toast?.(`《${book.name}》已加入书架`)
  } catch (error) {
    window.__toast?.(error.message)
  }
}

onMounted(async () => {
  await loadBundles()
  const q = String(route.query.q || '').trim()
  if (q) {
    keyword.value = q
    if (selectedBundles.value.length === 1) search()
    else pickerPendingSearch.value = true
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

    <div class="row m-search-row" style="margin-bottom: 18px; flex-wrap: wrap">
      <input
        v-model="keyword"
        class="m-search-input"
        placeholder="书名 / 作者"
        style="flex: 1; min-width: 200px"
        @keyup.enter="search"
      />
      <button class="ghost m-search-scope" style="max-width: 340px" @click="openScope(false)">
        {{ scopeLabel }} · {{ selectedStats.searchable || totals.searchable }} 个源
      </button>
      <button class="primary m-search-btn" :disabled="searching" @click="search">搜索</button>
    </div>

    <div v-if="!results.length && !searching" class="empty">选择书源汇总，输入关键词后搜索。</div>

    <div class="grid m-result-grid">
      <div v-for="book in results" :key="`${book.origin}::${book.bookUrl}`" class="card" @click="pick(book)">
        <div class="cover">
          <img v-if="coverOf(book)" :src="coverOf(book)" :alt="book.name" loading="lazy" />
          <div v-else class="placeholder">{{ book.name }}</div>
          <span class="result-source-badge">{{ book.originName || '书源' }}</span>
        </div>
        <h3>{{ book.name }}</h3>
        <p>{{ book.author }}</p>
      </div>
    </div>

    <BookDetail v-if="picked" :book="picked" mode="search" @close="picked = null" @save="addToShelf" />

    <div v-if="showScope" class="sheet-backdrop" @click.self="showScope = false">
      <div class="sheet">
        <div class="sheet-handle" />
        <h2 style="margin: 0 0 6px">选择搜索书源</h2>
        <p class="muted" style="font-size: 13px; margin: 0 0 12px">勾选要搜索的书源汇总，可单选、多选或全选。</p>
        <div class="list" style="max-height: 46vh; overflow: auto">
          <label v-for="bundle in bundles" :key="bundle.name" class="list-item" style="cursor: pointer">
            <input type="checkbox" :checked="draftBundles.includes(bundle.name)" style="width: auto" @change="toggleDraft(bundle.name)" />
            <span style="flex: 1; min-width: 0">
              <strong>{{ bundle.name }}</strong>
              <span class="muted" style="font-size: 12px; margin-left: 6px">{{ bundle.count }} 个源 · 已启用 {{ bundle.enabledCount }}</span>
            </span>
          </label>
        </div>
        <div class="row" style="gap: 8px; margin-top: 14px; flex-wrap: wrap">
          <button class="ghost" @click="selectAllDraft">全选</button>
          <button class="ghost" @click="clearDraft">清空</button>
          <div class="spacer" />
          <button class="ghost" @click="showScope = false">取消</button>
          <button class="primary" :disabled="!draftBundles.length" @click="confirmScope">
            {{ pickerPendingSearch ? '按选中书源搜索' : '确定' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.result-source-badge {
  position: absolute;
  left: 6px;
  bottom: 6px;
  max-width: calc(100% - 12px);
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(20, 16, 10, 0.62);
  color: #fff;
  font-size: 11px;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
