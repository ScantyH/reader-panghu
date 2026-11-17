<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
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
const showSettings = ref(false)
const showSearch = ref(false)
const showNotes = ref(false)
const showSource = ref(false)
const showDp = ref(false)

const catalogFilter = ref('')
const searchText = ref('')
const searchHits = ref([])
const searchIndex = ref(0)

const notes = ref([])
const noteDraft = ref('')

const sourceCandidates = ref([])
const sourceLoading = ref(false)

const dpMarkers = ref([])
const dpCards = ref([])
const dpLoading = ref(false)

const ttsOn = ref(false)
const turnDirection = ref('')
const readingEl = ref(null)
const caching = ref(false)

const THEMES = {
  paper: { bg: '#f3e9d2', text: '#3b2f24', name: '米黄' },
  light: { bg: '#faf9f7', text: '#2b2b2b', name: '月白' },
  green: { bg: '#e3eddf', text: '#2f3a2c', name: '豆绿' },
  dark: { bg: '#141414', text: '#c9c4bb', name: '夜间' },
}

const prefs = ref({
  fontSize: Number(localStorage.getItem('readerFontSize') || 19),
  lineHeight: Number(localStorage.getItem('readerLineHeight') || 2.05),
  theme: localStorage.getItem('readerTheme') || 'paper',
  fontFamily: localStorage.getItem('readerFont') || '',
  convert: localStorage.getItem('readerConvert') || '',
  pageMode: localStorage.getItem('readerPageMode') || 'scroll',
})

const theme = computed(() => THEMES[prefs.value.theme] || THEMES.paper)
const progress = computed(() => {
  const total = chapters.value.length
  if (!total) return 0
  return Math.min(100, Math.round(((current.value + 1) / total) * 100))
})
const paragraphs = computed(() => String(content.value).split(/\n+/).filter((line) => line.trim()))
const filteredChapters = computed(() => {
  const q = catalogFilter.value.trim()
  if (!q) return chapters.value
  return chapters.value.filter((item) => String(item.title || '').includes(q))
})

function savePrefs() {
  localStorage.setItem('readerFontSize', String(prefs.value.fontSize))
  localStorage.setItem('readerLineHeight', String(prefs.value.lineHeight))
  localStorage.setItem('readerTheme', prefs.value.theme)
  localStorage.setItem('readerFont', prefs.value.fontFamily)
  localStorage.setItem('readerConvert', prefs.value.convert)
  localStorage.setItem('readerPageMode', prefs.value.pageMode)
}

async function loadBook() {
  try {
    const shelf = await api.bookshelf()
    book.value = shelf.find((item) => item.bookUrl === props.bookUrl) || null
    if (!book.value) {
      window.__toast?.('这本书不在书架里')
      router.replace('/bookshelf')
      return
    }
    chapters.value = await api.chapterList({
      bookUrl: book.value.bookUrl,
      tocUrl: book.value.tocUrl,
      bookSourceUrl: book.value.origin,
    })
    current.value = Number(book.value.durChapterIndex || 0)
    await loadChapter(current.value)
    loadNotes()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function loadChapter(index) {
  if (!chapters.value.length) return
  const target = Math.max(0, Math.min(index, chapters.value.length - 1))
  loading.value = true
  turnDirection.value = target > current.value ? 'next' : target < current.value ? 'prev' : ''
  try {
    content.value = await api.content({
      bookUrl: book.value.bookUrl,
      index: target,
      convert: prefs.value.convert || undefined,
    })
    current.value = target
    searchHits.value = []
    api.saveBookProgress({ bookUrl: book.value.bookUrl, index: target }).catch(() => {})
    await nextTick()
    window.scrollTo({ top: 0 })
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

function turnNext() {
  if (prefs.value.pageMode === 'page') {
    const viewport = window.innerHeight - 80
    const maxScroll = document.body.scrollHeight - window.innerHeight
    if (window.scrollY + viewport < maxScroll - 40) {
      window.scrollBy({ top: viewport, behavior: 'smooth' })
      return
    }
  }
  if (current.value < chapters.value.length - 1) loadChapter(current.value + 1)
}

function turnPrev() {
  if (prefs.value.pageMode === 'page') {
    const viewport = window.innerHeight - 80
    if (window.scrollY > viewport / 2) {
      window.scrollBy({ top: -viewport, behavior: 'smooth' })
      return
    }
  }
  if (current.value > 0) loadChapter(current.value - 1)
}

function toTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
function toBottom() {
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
}

/* ---------------- 书签 ---------------- */
async function addBookmark() {
  try {
    await api.saveBookmark({
      bookUrl: book.value.bookUrl,
      chapterIndex: current.value,
      chapterTitle: chapters.value[current.value]?.title || '',
    })
    window.__toast?.('已加入书签')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/* ---------------- 正文搜索 ---------------- */
function runSearch() {
  const needle = searchText.value.trim()
  if (!needle) return
  const source = String(content.value)
  const hits = []
  let index = source.indexOf(needle)
  while (index >= 0 && hits.length < 200) {
    hits.push(index)
    index = source.indexOf(needle, index + needle.length)
  }
  searchHits.value = hits
  searchIndex.value = 0
  if (hits.length) {
    const found = typeof window.find === 'function' ? window.find(needle, false, false, true) : false
    if (!found) window.__toast?.(`命中 ${hits.length} 处`)
  } else {
    window.__toast?.('本章没有找到')
  }
}

function jumpHit(direction) {
  if (!searchHits.value.length) return
  const needle = searchText.value.trim()
  searchIndex.value = (searchIndex.value + direction + searchHits.value.length) % searchHits.value.length
  window.find?.(needle, false, direction < 0, true)
}

/* ---------------- 笔记 ---------------- */
async function loadNotes() {
  try {
    notes.value = await api.chapterNotes(book.value.bookUrl)
  } catch {
    notes.value = []
  }
}

async function addNote() {
  const quote = noteDraft.value.trim()
  if (!quote) {
    window.__toast?.('先写下要记录的原文或想法')
    return
  }
  try {
    await api.saveChapterNote({
      bookUrl: book.value.bookUrl,
      chapterIndex: current.value,
      quote: quote.slice(0, 300),
      note: noteDraft.value.slice(0, 800),
    })
    noteDraft.value = ''
    await loadNotes()
    window.__toast?.('已保存')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function removeNote(note) {
  await api.deleteChapterNote({ bookUrl: book.value.bookUrl, id: note.id }).catch(() => {})
  await loadNotes()
}

/* ---------------- 换源 ---------------- */
async function findSources() {
  showSource.value = true
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
    if (!sourceCandidates.value.length) window.__toast?.('其它书源里没找到同名书')
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    sourceLoading.value = false
  }
}

async function switchSource(candidate) {
  try {
    await api.setBookSource({
      bookUrl: props.bookUrl,
      newUrl: candidate.bookUrl,
      bookSourceUrl: candidate.origin,
    })
    showSource.value = false
    window.__toast?.(`已切换到「${candidate.originName}」`)
    location.reload()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/* ---------------- 段评 ---------------- */
async function openDp(withComments = false) {
  showDp.value = true
  dpLoading.value = true
  try {
    const result = await api.paragraphComments({ bookUrl: props.bookUrl, index: current.value, withComments })
    dpMarkers.value = result.markers || []
    dpCards.value = result.cards || []
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    dpLoading.value = false
  }
}

/* ---------------- 朗读 ---------------- */
function toggleTts() {
  if (!window.speechSynthesis) return window.__toast?.('浏览器不支持朗读')
  if (ttsOn.value) {
    window.speechSynthesis.cancel()
    ttsOn.value = false
    return
  }
  const text = String(content.value).trim()
  if (!text) return
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 20000))
  utterance.lang = 'zh-CN'
  utterance.onend = () => (ttsOn.value = false)
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
  ttsOn.value = true
}

/* ---------------- 其它 ---------------- */
function cycleTheme() {
  const order = ['paper', 'light', 'green', 'dark']
  prefs.value.theme = order[(order.indexOf(prefs.value.theme) + 1) % order.length]
  savePrefs()
}

async function cacheChapter() {
  caching.value = true
  try {
    const result = await api.cacheBook(book.value.bookUrl, 50)
    window.__toast?.(`已缓存 ${result.cached} 章（累计 ${result.totalCached}）`)
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    caching.value = false
  }
}

async function setConvert(mode) {
  prefs.value.convert = mode
  savePrefs()
  await loadChapter(current.value)
}

onMounted(loadBook)
onBeforeUnmount(() => {
  if (ttsOn.value) window.speechSynthesis?.cancel()
})
</script>

<template>
  <div class="reader-shell" :style="{ background: theme.bg, color: theme.text }">
    <aside class="rail rail-left">
      <button class="rail-btn" title="首页" @click="router.push('/bookshelf')"><span>⌂</span><i>首页</i></button>
      <button class="rail-btn" title="书架" @click="router.push('/bookshelf')"><span>▤</span><i>书架</i></button>
      <button class="rail-btn" title="书源" @click="router.push('/sources')"><span>⌘</span><i>书源</i></button>
      <button class="rail-btn" title="目录" @click="showCatalog = true"><span>☰</span><i>目录</i></button>
      <button class="rail-btn" title="设置" @click="showSettings = true"><span>⚙</span><i>设置</i></button>
      <button class="rail-btn" title="顶部" @click="toTop"><span>︿</span><i>顶部</i></button>
      <button class="rail-btn" title="底部" @click="toBottom"><span>﹀</span><i>底部</i></button>
    </aside>

    <main class="reader-main">
      <div ref="readingEl" class="reader-page" :class="turnDirection">
        <h1 class="chapter-title">{{ chapters[current]?.title || book?.name || '加载中…' }}</h1>
        <div v-if="loading" class="reader-loading">加载中…</div>
        <div
          v-else
          class="chapter-body"
          :style="{ fontSize: prefs.fontSize + 'px', lineHeight: prefs.lineHeight, fontFamily: prefs.fontFamily || undefined }"
        >
          <p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph.trim() }}</p>
        </div>
      </div>
    </main>

    <aside class="rail rail-right">
      <button class="rail-btn round" title="书签" @click="addBookmark">⌘</button>
      <button class="rail-btn round" title="查找" @click="showSearch = !showSearch">⌕</button>
      <button class="rail-btn round" title="换源" @click="findSources">⇄</button>
      <button class="rail-btn round" title="笔记" @click="showNotes = true; loadNotes()">✎</button>
      <button class="rail-btn round" title="段评" @click="openDp(false)">💬</button>
      <button class="rail-btn round" :title="caching ? '缓存中' : '缓存 50 章'" @click="cacheChapter">⤓</button>
      <button class="rail-btn round" title="刷新" @click="loadChapter(current)">↻</button>
      <button class="rail-btn round" title="简繁" @click="setConvert(prefs.convert === 'tw' ? 'cn' : 'tw')">文</button>
      <button class="rail-btn round" :title="ttsOn ? '停止' : '朗读'" @click="toggleTts">{{ ttsOn ? '⏹' : '🎧' }}</button>
      <button class="rail-btn round" title="主题" @click="cycleTheme">☾</button>
      <div class="rail-progress">{{ progress }}%</div>
      <button class="rail-btn round" title="上一章" @click="turnPrev">‹</button>
      <button class="rail-btn round" title="下一章" @click="turnNext">›</button>
    </aside>

    <!-- 搜索条 -->
    <div v-if="showSearch" class="search-bar">
      <input v-model="searchText" placeholder="本章查找" @keyup.enter="runSearch" />
      <span class="search-count">{{ searchHits.length ? `${searchIndex + 1}/${searchHits.length}` : '—' }}</span>
      <button class="rail-btn round" @click="jumpHit(-1)">‹</button>
      <button class="rail-btn round" @click="jumpHit(1)">›</button>
      <button class="rail-btn round" @click="showSearch = false">×</button>
    </div>

    <!-- 目录 -->
    <div v-if="showCatalog" class="sheet-backdrop" @click.self="showCatalog = false">
      <div class="sheet">
        <div class="sheet-handle" />
        <h2>目录 · {{ chapters.length }} 章</h2>
        <input v-model="catalogFilter" placeholder="搜索章节名" style="margin-bottom: 10px" />
        <div class="list" style="max-height: 60vh; overflow: auto">
          <div
            v-for="(chapter, index) in filteredChapters"
            :key="index"
            class="list-item"
            :style="chapters.indexOf(chapter) === current ? 'color: var(--color-primary)' : ''"
            @click="showCatalog = false; loadChapter(chapters.indexOf(chapter))"
          >
            <span style="flex: 1; font-size: 14px">{{ chapter.title }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 设置 -->
    <div v-if="showSettings" class="sheet-backdrop" @click.self="showSettings = false">
      <div class="sheet">
        <div class="sheet-handle" />
        <h2>阅读设置</h2>
        <div class="setting-row"><span>字号</span><input v-model.number="prefs.fontSize" type="range" min="14" max="28" @change="savePrefs" /><b>{{ prefs.fontSize }}</b></div>
        <div class="setting-row"><span>行距</span><input v-model.number="prefs.lineHeight" type="range" min="1.5" max="2.6" step="0.05" @change="savePrefs" /><b>{{ prefs.lineHeight.toFixed(2) }}</b></div>
        <div class="setting-row">
          <span>背景</span>
          <div style="display: flex; gap: 8px">
            <button
              v-for="(value, key) in THEMES"
              :key="key"
              class="theme-dot"
              :title="value.name"
              :style="{ background: value.bg, borderColor: prefs.theme === key ? 'var(--color-primary)' : '#d8d2c4' }"
              @click="prefs.theme = key; savePrefs()"
            />
          </div>
        </div>
        <div class="setting-row">
          <span>字体</span>
          <select :value="prefs.fontFamily" @change="prefs.fontFamily = $event.target.value; savePrefs()">
            <option value="">默认</option>
            <option value="var(--font-serif)">宋体</option>
            <option value="var(--font-kai)">楷体</option>
          </select>
        </div>
        <div class="setting-row">
          <span>简繁</span>
          <select :value="prefs.convert" @change="setConvert($event.target.value)">
            <option value="">原文</option>
            <option value="tw">繁体</option>
            <option value="cn">简体</option>
          </select>
        </div>
        <div class="setting-row">
          <span>翻页</span>
          <select :value="prefs.pageMode" @change="prefs.pageMode = $event.target.value; savePrefs()">
            <option value="scroll">上下滚动</option>
            <option value="page">整屏翻页</option>
          </select>
        </div>
      </div>
    </div>

    <!-- 笔记 -->
    <div v-if="showNotes" class="sheet-backdrop" @click.self="showNotes = false">
      <div class="sheet">
        <div class="sheet-handle" />
        <h2>笔记</h2>
        <textarea v-model="noteDraft" rows="3" placeholder="记一段原文或想法" style="width: 100%; margin-bottom: 10px" />
        <button class="primary" style="width: 100%" @click="addNote">保存到第 {{ current + 1 }} 章</button>
        <div class="list" style="margin-top: 14px; max-height: 46vh; overflow: auto">
          <div v-for="note in notes" :key="note.id" class="list-item">
            <div style="flex: 1; min-width: 0">
              <div class="muted" style="font-size: 12px">第 {{ note.chapterIndex + 1 }} 章</div>
              <div style="font-size: 13px">「{{ note.quote }}」</div>
              <div v-if="note.note" class="muted" style="font-size: 12px">{{ note.note }}</div>
            </div>
            <button class="ghost" @click="removeNote(note)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 换源 -->
    <div v-if="showSource" class="sheet-backdrop" @click.self="showSource = false">
      <div class="sheet">
        <div class="sheet-handle" />
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

    <!-- 段评 -->
    <div v-if="showDp" class="sheet-backdrop" @click.self="showDp = false">
      <div class="sheet">
        <div class="sheet-handle" />
        <h2>段评 · 本章说</h2>
        <div v-if="dpLoading" class="muted">读取中…</div>
        <div v-else-if="!dpMarkers.length && !dpCards.length" class="muted" style="font-size: 13px">
          本章没有段评标记（只有起点类书源会带这类数据）。
        </div>
        <template v-else>
          <div class="list">
            <div v-for="(marker, index) in dpMarkers" :key="index" class="list-item">
              <span style="flex: 1">第 {{ marker.paragraph + 1 }} 段 · {{ marker.count }} 条</span>
              <a v-if="marker.url" class="ghost" :href="marker.url" target="_blank" rel="noopener">打开</a>
            </div>
          </div>
          <div v-if="dpCards.length" class="list" style="margin-top: 12px">
            <div v-for="(card, index) in dpCards" :key="index" class="list-item">
              <img :src="card.src" alt="" style="max-width: 100%; border-radius: 8px" loading="lazy" />
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reader-shell {
  min-height: 100vh;
  display: flex;
  padding: 0 96px;
  gap: 24px;
}
.rail {
  position: sticky;
  top: 0;
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 22px 0;
  height: 100vh;
  width: 64px;
  flex: none;
}
.rail-left { margin-right: auto; }
.rail-right { margin-left: auto; }
.rail-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  border: none;
  background: transparent;
  color: inherit;
  opacity: 0.72;
  font-size: 17px;
  cursor: pointer;
  padding: 4px 6px;
}
.rail-btn i { font-size: 11px; font-style: normal; }
.rail-btn:hover { opacity: 1; }
.rail-btn.round {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.55);
  font-size: 15px;
  box-shadow: 0 1px 2px rgba(80, 60, 30, 0.12);
}
.rail-progress { font-size: 12px; opacity: 0.6; margin-top: 4px; }
.reader-main { flex: 1; max-width: 760px; margin: 0 auto; padding: 44px 0 90px; }
.reader-page.next { animation: pn 240ms ease; }
.reader-page.prev { animation: pp 240ms ease; }
@keyframes pn { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: none; } }
@keyframes pp { from { opacity: 0; transform: translateX(-18px); } to { opacity: 1; transform: none; } }
.chapter-title { font-size: 22px; font-weight: 600; text-align: center; margin: 0 0 30px; }
.chapter-body p { text-indent: 2em; margin: 0 0 0.75em; text-align: justify; word-break: break-word; }
.reader-loading { text-align: center; opacity: 0.5; padding: 60px 0; }
.search-bar {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.95);
  padding: 8px 12px;
  border-radius: 999px;
  box-shadow: 0 6px 20px rgba(60, 40, 20, 0.18);
  z-index: 30;
}
.search-bar input { border: none; outline: none; background: transparent; font-size: 14px; min-width: 180px; }
.search-count { font-size: 12px; opacity: 0.6; }
.setting-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; font-size: 14px; }
.setting-row span { width: 44px; }
.setting-row input[type='range'] { flex: 1; }
.theme-dot { width: 26px; height: 26px; border-radius: 50%; border: 2px solid #d8d2c4; cursor: pointer; }
@media (max-width: 900px) {
  .reader-shell { padding: 0 12px; gap: 0; }
  .rail {
    position: fixed;
    bottom: 12px;
    top: auto;
    height: auto;
    flex-direction: row;
    width: auto;
    padding: 8px 12px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.9);
    box-shadow: 0 6px 18px rgba(60, 40, 20, 0.18);
    z-index: 20;
  }
  .rail-left { left: 12px; }
  .rail-right { right: 12px; flex-wrap: wrap; max-width: 46vw; }
  .rail-left .rail-btn i { display: none; }
  .reader-main { padding: 24px 4px 150px; }
}
</style>
