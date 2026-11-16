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
const prefs = ref({ fontSize: 17, lineHeight: 1.95, theme: 'light', fontFamily: localStorage.getItem('readerFont') || '' })
const readingEl = ref(null)
const ttsOn = ref(false)
const searchOpen = ref(false)
const searchText = ref('')
const searchResult = ref('')
const catalogFilter = ref('')
const convertMode = ref(localStorage.getItem('readerConvert') || '')
const notes = ref([])
const notesOpen = ref(false)
const sourceOpen = ref(false)
const sourceCandidates = ref([])
const sourceLoading = ref(false)
const turnDirection = ref('')
let chapterStartedAt = Date.now()

/** 把这一章的停留时长上报（切章时调用） */
function reportReadingTime() {
  const seconds = Math.round((Date.now() - chapterStartedAt) / 1000)
  chapterStartedAt = Date.now()
  if (seconds > 3 && seconds < 6 * 3600) {
    api.saveReadingTime({ bookUrl: props.bookUrl, seconds, chapters: 1 }).catch(() => {})
  }
}

/** 找其它书源里的同名书 */
async function findSources() {
  sourceOpen.value = true
  sourceLoading.value = true
  sourceCandidates.value = []
  try {
    const result = await api.availableSources({
      name: book.value?.name || '',
      author: book.value?.author || '',
      origin: book.value?.origin || '',
      resultLimit: 10,
    })
    sourceCandidates.value = result.books || []
    if (!sourceCandidates.value.length) window.__toast?.('其它书源里没有找到同名书')
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    sourceLoading.value = false
  }
}

/** 换到另一个书源，保留阅读进度 */
async function switchSource(candidate) {
  try {
    const updated = await api.setBookSource({
      bookUrl: props.bookUrl,
      newUrl: candidate.bookUrl,
      bookSourceUrl: candidate.origin,
    })
    sourceOpen.value = false
    window.__toast?.(`已切换到「${candidate.originName}」`)
    book.value = updated
    chapters.value = await api.chapterList({
      bookUrl: updated.bookUrl,
      tocUrl: updated.tocUrl,
      bookSourceUrl: updated.origin,
    })
    await loadChapter(Number(updated.durChapterIndex || 0))
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/** 朗读当前章：用浏览器内置语音，停止时立刻 cancel。 */
function toggleTts() {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    window.__toast?.('当前浏览器不支持语音朗读')
    return
  }
  if (ttsOn.value) {
    window.speechSynthesis.cancel()
    ttsOn.value = false
    return
  }
  const text = String(content.value || '').trim()
  if (!text) {
    window.__toast?.('本章没有可朗读的正文')
    return
  }
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 20000))
  utterance.lang = 'zh-CN'
  utterance.rate = 1
  utterance.onend = () => (ttsOn.value = false)
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
  ttsOn.value = true
}

/** 正文内查找：用浏览器原生 find，向前/向后循环。 */
function findInChapter(backwards = false) {
  const needle = searchText.value.trim()
  if (!needle) return
  const found = typeof window.find === 'function' ? window.find(needle, false, backwards, true) : false
  searchResult.value = found ? '已定位' : '没有找到'
}

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

const filteredChapters = computed(() => {
  const q = catalogFilter.value.trim()
  if (!q) return chapters.value
  return chapters.value.filter((chapter) => String(chapter.title || '').includes(q))
})

/** 切简繁：只影响显示，不改缓存 */
async function setConvert(mode) {
  convertMode.value = mode
  localStorage.setItem('readerConvert', mode)
  await loadChapter(current.value)
}

async function loadNotes() {
  try {
    notes.value = await api.chapterNotes(props.bookUrl)
  } catch {
    notes.value = []
  }
}

/** 划选一段正文，加段落笔记 */
async function addNote() {
  const selection = String(window.getSelection?.() || '').trim()
  if (!selection) {
    window.__toast?.('先选中一段正文')
    return
  }
  const note = prompt('这段的笔记（可留空）') ?? ''
  try {
    await api.saveChapterNote({ bookUrl: props.bookUrl, chapterIndex: current.value, quote: selection, note })
    await loadNotes()
    window.__toast?.('已保存笔记')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function loadChapter(index) {
  if (!chapters.value.length) return
  reportReadingTime()
  const target = Math.max(0, Math.min(chapters.value.length - 1, index))
  loading.value = true
  try {
    turnDirection.value = target > current.value ? 'next' : target < current.value ? 'prev' : ''
    content.value = await api.content({ bookUrl: props.bookUrl, index: target, convert: convertMode.value || undefined })
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

/** 点正文切换控制条；点左右两侧翻页（reader-next 的行为）。 */
function toggleChrome() {
  chromeVisible.value = !chromeVisible.value
}

function onReadingClick(event) {
  const ratio = event.clientX / window.innerWidth
  if (ratio < 0.28) {
    if (hasPrev.value) loadChapter(current.value - 1)
    return
  }
  if (ratio > 0.72) {
    if (hasNext.value) loadChapter(current.value + 1)
    return
  }
  toggleChrome()
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
      <button class="icon-btn" :title="ttsOn ? '停止朗读' : '朗读'" @click="toggleTts">{{ ttsOn ? '⏹' : '🔊' }}</button>
      <button class="icon-btn" title="正文内查找" @click="searchOpen = !searchOpen">🔎</button>
      <button class="icon-btn" title="换源" @click="findSources">⇄</button>
      <button class="icon-btn" title="段落笔记" @click="notesOpen = true; loadNotes()">✎</button>
      <button class="icon-btn" title="设置" @click="showSettings = true">Aa</button>
    </div>

    <div v-if="searchOpen" class="reader-floating-top" style="top: 60px; padding: 6px 10px">
      <input v-model="searchText" placeholder="在正文中查找" style="min-width: 180px" @keyup.enter="findInChapter(false)" />
      <button class="icon-btn" title="上一个" @click="findInChapter(true)">‹</button>
      <button class="icon-btn" title="下一个" @click="findInChapter(false)">›</button>
      <span class="muted" style="font-size: 12px">{{ searchResult }}</span>
    </div>

    <div class="reader-body">
      <aside v-if="showCatalog" class="catalog">
        <template v-for="chapter in filteredChapters" :key="chapter.index">
          <div v-if="chapter.isVolume" class="volume">{{ chapter.title }}</div>
          <button
            v-else
            class="chapter"
            :class="{ current: chapter.index === current }"
            @click="loadChapter(chapter.index)"
          >
            {{ chapter.title }}
          </button>
        </template>
      </aside>

      <div ref="readingEl" class="reading" :class="turnDirection" :style="{ background: THEMES[prefs.theme]?.bg }" @click="onReadingClick">
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

    <!-- 底部阅读进度细线 -->
    <div class="reader-progress-line"><i :style="{ width: percent + '%' }" /></div>

    <!-- 换源：底部抽屉 -->
    <div v-if="sourceOpen" class="sheet-backdrop" @click.self="sourceOpen = false">
      <div class="sheet">
        <div class="sheet-handle" />
        <input v-model="catalogFilter" placeholder="搜索章节名" style="margin-bottom: 10px" />
        <h2>换源 · {{ book?.name }}</h2>
        <div v-if="sourceLoading" class="muted">正在其它书源里搜索…</div>
        <div v-else-if="!sourceCandidates.length" class="muted" style="font-size: 13px">没有找到其它来源。</div>
        <div v-else class="list">
          <div v-for="candidate in sourceCandidates" :key="candidate.origin + candidate.bookUrl" class="list-item">
            <div style="flex: 1; min-width: 0">
              <strong style="font-size: 14px">{{ candidate.originName }}</strong>
              <div class="muted" style="font-size: 12px">{{ candidate.author || '未知作者' }}</div>
            </div>
            <button class="primary" @click="switchSource(candidate)">切到此处</button>
          </div>
        </div>
      </div>
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
