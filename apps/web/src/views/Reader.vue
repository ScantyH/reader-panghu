<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api.js'

const props = defineProps({ bookUrl: { type: String, required: true } })
const router = useRouter()

const book = ref(null)
const chapters = ref([])
const current = ref(0)
const content = ref('')
const loading = ref(false)
const showCatalog = ref(false)
const readingEl = ref(null)

const title = computed(() => book.value?.name || '加载中')
const chapterTitle = computed(() => chapters.value[current.value]?.title || '')
const hasPrev = computed(() => current.value > 0)
const hasNext = computed(() => current.value < chapters.value.length - 1)

async function loadChapter(index) {
  if (!chapters.value.length) return
  const target = Math.max(0, Math.min(chapters.value.length - 1, index))
  loading.value = true
  try {
    content.value = await api.content({ bookUrl: props.bookUrl, index: target })
    current.value = target
    if (book.value) {
      book.value.durChapterIndex = target
      book.value.durChapterTitle = chapters.value[target]?.title || ''
    }
    await api.saveProgress(props.bookUrl, target, 0).catch(() => {})
    showCatalog.value = false
    readingEl.value?.scrollTo({ top: 0 })
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    const shelf = await api.bookshelf()
    book.value = shelf.find((item) => item.bookUrl === props.bookUrl) || null
    if (!book.value) {
      window.__toast?.('这本书不在书架中')
      router.replace('/bookshelf')
      return
    }
    chapters.value = await api.chapterList({
      bookUrl: book.value.bookUrl,
      tocUrl: book.value.tocUrl,
      bookSourceUrl: book.value.origin,
    })
    await loadChapter(Number(book.value.durChapterIndex || 0))
  } catch (error) {
    window.__toast?.(error.message)
  }
})
</script>

<template>
  <div class="reader">
    <div class="reader-bar">
      <button class="ghost" @click="router.back()">返回</button>
      <button class="ghost" @click="showCatalog = !showCatalog">目录</button>
      <div class="reader-title">
        {{ title }}<span v-if="chapterTitle" class="muted"> · {{ chapterTitle }}</span>
      </div>
      <div class="spacer" />
      <span class="badge">{{ chapters.length ? `${current + 1}/${chapters.length}` : '—' }}</span>
    </div>

    <div class="reader-body">
      <aside v-if="showCatalog" class="catalog">
        <button
          v-for="chapter in chapters"
          :key="chapter.index"
          :class="{ current: chapter.index === current }"
          @click="loadChapter(chapter.index)"
        >
          {{ chapter.title }}
        </button>
      </aside>

      <div ref="readingEl" class="reading">
        <h2 v-if="chapterTitle">{{ chapterTitle }}</h2>
        <div v-if="loading" class="muted">加载中…</div>
        <div v-else class="text">{{ content || '（本章暂无正文）' }}</div>
        <div class="reader-foot">
          <button :disabled="!hasPrev" @click="loadChapter(current - 1)">上一章</button>
          <button :disabled="!hasNext" @click="loadChapter(current + 1)">下一章</button>
        </div>
      </div>
    </div>
  </div>
</template>
