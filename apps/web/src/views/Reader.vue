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
const chromeVisible = ref(true)
const showCatalog = ref(false)
const showSettings = ref(false)
const showBookmarks = ref(false)
const bookmarks = ref([])
const prefs = ref({ fontSize: 17, lineHeight: 1.95, theme: 'light' })
const readingEl = ref(null)

const THEMES = {
  light: { bg: '#faf9f7', text: '#1a1a1a' },
  sepia: { bg: '#f4ecd8', text: '#3b3226' },
  dark: { bg: '#141414', text: '#c9c6c1' },
}

let saveTimer = 0
function persistPrefs() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      const config = await api.getUserConfig()
      await api.saveUserConfig({ ...config, reading: { ...prefs.value } })
    } catch {
      /* 偏好保存失败不影响阅读 */
    }
  }, 400)
}

async function loadPrefs() {
  try {
    const config = await api.getUserConfig()
    if (config?.reading) prefs.value = { ...prefs.value, ...config.reading }
  } catch {
    /* 用默认值 */
  }
}

const title = computed(() => book.value?.name || '加载中')
const chapterTitle = computed(() => chapters.value[current.value]?.title || '')
const hasPrev = computed(() => current.value > 0)
const hasNext = computed(() => current.value < chapters.value.length - 1)
const percent = computed(() => {
  const total = chapters.value.length
  return total ? Math.round(((current.value + 1) / total) * 100) : 0
})

async function loadBookmarks() {
  try {
    const all = await api.bookmarks()
    bookmarks.value = all.filter((item) => item.bookUrl === props.bookUrl)
  } catch {
    /* 书签是辅助功能 */
  }
}

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

async function addBookmark() {
  const chapter = chapters.value[current.value]
  if (!chapter) return
  try {
    await api.saveBookmark({ bookUrl: props.bookUrl, chapterIndex: current.value, chapterTitle: chapter.title })
    await loadBookmarks()
    window.__toast?.('已加入书签')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function removeBookmark(bookmark) {
  try {
    await api.deleteBookmark(bookmark)
    await loadBookmarks()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

function jump(bookmark) {
  showBookmarks.value = false
  loadChapter(bookmark.chapterIndex)
}

/** 点正文切换控制条（reader-next 的行为）。 */
function toggleChrome() {
  chromeVisible.value = !chromeVisible.value
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
    await loadPrefs()
    await loadBookmarks()
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
  <div class="reader" :style="{ background: THEMES[prefs.theme]?.bg }">
    <div class="reader-floating-top" :class="{ hidden: !chromeVisible }">
      <button class="icon-btn" title="返回" @click="router.back()">←</button>
      <button class="icon-btn" title="目录" @click="showCatalog = !showCatalog">☰</button>
      <div class="reader-title" style="max-width: 30vw">{{ title }}</div>
      <div class="spacer" />
      <button class="icon-btn" title="书签" @click="showBookmarks = true">🔖</button>
      <button class="icon-btn" title="加入书签" @click="addBookmark">＋</button>
      <button class="icon-btn" title="设置" @click="showSettings = true">Aa</button>
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

      <div ref="readingEl" class="reading" :style="{ background: THEMES[prefs.theme]?.bg }" @click="toggleChrome">
        <h2 v-if="chapterTitle" :style="{ color: THEMES[prefs.theme]?.text }">{{ chapterTitle }}</h2>
        <div v-if="loading" class="muted">加载中…</div>
        <div
          v-else
          class="text"
          :style="{ fontSize: prefs.fontSize + 'px', lineHeight: prefs.lineHeight, color: THEMES[prefs.theme]?.text }"
        >
          {{ content || '（本章暂无正文）' }}
        </div>
      </div>
    </div>

    <div class="reader-floating-bottom" :class="{ hidden: !chromeVisible }">
      <button class="icon-btn" :disabled="!hasPrev" title="上一章" @click="loadChapter(current - 1)">‹</button>
      <div class="reader-progress">
        <span>{{ current + 1 }} / {{ chapters.length }}</span>
        <span>·</span>
        <span>{{ percent }}%</span>
      </div>
      <button class="icon-btn" :disabled="!hasNext" title="下一章" @click="loadChapter(current + 1)">›</button>
    </div>

    <!-- 设置：底部抽屉 -->
    <div v-if="showSettings" class="sheet-backdrop" @click.self="showSettings = false">
      <div class="sheet">
        <div class="sheet-handle" />
        <h2>阅读设置</h2>
        <div class="field">
          <label>字号 {{ prefs.fontSize }}px</label>
          <input v-model.number="prefs.fontSize" type="range" min="14" max="26" step="1" @input="persistPrefs" />
        </div>
        <div class="field">
          <label>行距 {{ prefs.lineHeight }}</label>
          <input v-model.number="prefs.lineHeight" type="range" min="1.4" max="2.6" step="0.05" @input="persistPrefs" />
        </div>
        <div class="field">
          <label>背景</label>
          <div class="row" style="gap: 8px">
            <button
              v-for="(value, name) in THEMES"
              :key="name"
              :class="{ primary: prefs.theme === name }"
              @click="prefs.theme = name; persistPrefs()"
            >
              {{ name }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 书签：底部抽屉 -->
    <div v-if="showBookmarks" class="sheet-backdrop" @click.self="showBookmarks = false">
      <div class="sheet">
        <div class="sheet-handle" />
        <h2>书签 · {{ bookmarks.length }}</h2>
        <div v-if="!bookmarks.length" class="muted" style="font-size: 13px">还没有书签</div>
        <div class="list">
          <div v-for="bookmark in bookmarks" :key="bookmark.id" class="list-item">
            <button class="ghost" style="flex: 1; text-align: left; border: none" @click="jump(bookmark)">
              {{ bookmark.chapterTitle || ('第 ' + (bookmark.chapterIndex + 1) + ' 章') }}
            </button>
            <button class="ghost" style="padding: 2px 8px; font-size: 12px" @click="removeBookmark(bookmark)">删</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
