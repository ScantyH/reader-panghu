<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api, getToken, isNativeApp, withImageToken } from '../api.js'

const props = defineProps({ bookUrl: { type: String, required: true } })
const router = useRouter()

const PAPER = {
  parchment: { name: '羊皮纸', bg: '#f3e9d2', text: '#3b2f24' },
  white: { name: '白纸', bg: '#ffffff', text: '#242424' },
  green: { name: '浅绿', bg: '#e6f0e2', text: '#2c3a2a' },
  gray: { name: '灰调', bg: '#ececec', text: '#2b2b2b' },
  blue: { name: '雾蓝', bg: '#e9f1f7', text: '#24323d' },
  mint: { name: '薄荷', bg: '#e8f4ef', text: '#244038' },
  rose: { name: '藕粉', bg: '#f7ebee', text: '#3d2b30' },
  sand: { name: '米沙', bg: '#f2eadc', text: '#3a3026' },
  paper: {
    name: '宣纸',
    bg: '#f6f1e4',
    text: '#352d23',
    pattern: 'radial-gradient(circle at 20% 30%, rgba(120,90,50,0.05) 0 1px, transparent 1px)',
  },
  bamboo: {
    name: '竹影',
    bg: '#eaf1e5',
    text: '#2b3928',
    pattern: 'linear-gradient(135deg, rgba(80,120,70,0.06) 25%, transparent 25%, transparent 75%, rgba(80,120,70,0.06) 75%)',
  },
}
const DARK = { name: '夜间', bg: '#121212', text: '#c9c4bb' }
const APPEARANCE = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]
const FONT_OPTIONS = [
  { value: '', label: '系统默认' },
  { value: 'serif', label: '宋体' },
  { value: 'kai', label: '楷体' },
  { value: 'sans', label: '黑体' },
  { value: 'fangsong', label: '仿宋' },
  { value: 'noto-serif', label: '思源宋体' },
  { value: 'lxgw', label: '霞鹜文楷' },
  { value: 'round', label: '圆体' },
]
const FONT_STACKS = {
  '': '',
  serif: '"Songti SC", "SimSun", "Noto Serif CJK SC", serif',
  kai: '"Kaiti SC", "KaiTi", "STKaiti", serif',
  sans: '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  fangsong: '"FangSong", "STFangsong", "FangSong_GB2312", serif',
  'noto-serif': '"Noto Serif CJK SC", "Noto Serif SC", "Source Han Serif SC", serif',
  lxgw: '"LXGW WenKai", "LXGW WenKai Screen", "Kaiti SC", serif',
  round: '"YouYuan", "Yuanti SC", "Hiragino Sans GB", sans-serif',
}
const ALIGNS = [
  { value: 'justify', label: '两端对齐' },
  { value: 'left', label: '左对齐' },
]
const ANIMATIONS = [
  { value: 'none', label: '无动画' },
  { value: 'fade', label: '淡入' },
  { value: 'slide', label: '滑动' },
]
const TAPS = [
  { value: 'prev', label: '上一页/章' },
  { value: 'next', label: '下一页/章' },
  { value: 'none', label: '无' },
]

const DEFAULT_PREFS = {
  fontSize: 19,
  lineHeight: 2.05,
  paragraphSpacing: 0.8,
  textIndent: 2,
  letterSpacing: 0,
  fontFamily: '',
  textAlign: 'justify',
  pageWidth: 760,
  pagePadding: 24,
  pageTop: 0,
  pageBottom: 0,
  appearance: 'light',
  paper: 'parchment',
  brightness: 100,
  pageMode: 'scroll',
  animation: 'slide',
  showChapterTitle: true,
  separateAreas: false,
  convert: '',
  ttsRate: 1,
  ttsPitch: 1,
  ttsVolume: 1,
  ttsVoice: '',
}

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem('readerPrefs') || 'null')
    if (saved && typeof saved === 'object') {
      if (saved.paper === 'paper' || saved.paper === 'warm') saved.paper = 'parchment'
      if (saved.appearance === 'system' && !saved.paper) saved.paper = 'parchment'
      return { ...DEFAULT_PREFS, ...saved }
    }
  } catch {
    /* ignore */
  }
  // 迁移旧版本单独存的键
  return {
    ...DEFAULT_PREFS,
    fontSize: Number(localStorage.getItem('readerFontSize') || DEFAULT_PREFS.fontSize),
    lineHeight: Number(localStorage.getItem('readerLineHeight') || DEFAULT_PREFS.lineHeight),
    paper: 'parchment',
    fontFamily: localStorage.getItem('readerFont') || DEFAULT_PREFS.fontFamily,
    convert: localStorage.getItem('readerConvert') || '',
    pageMode: localStorage.getItem('readerPageMode') || DEFAULT_PREFS.pageMode,
  }
}

const prefs = ref(loadPrefs())
/** 打开设置面板时的快照：面板内先实时预览，点 ✓ 才保存，点 × 回滚 */
const settingsSnapshot = ref('')
const settingsDirty = computed(
  () => Boolean(settingsSnapshot.value) && JSON.stringify(prefs.value) !== settingsSnapshot.value,
)
let skipNextPrefsPersist = false
watch(
  prefs,
  (value) => {
    if (skipNextPrefsPersist) {
      skipNextPrefsPersist = false
      return
    }
    // 设置面板打开期间只预览，写入由 ✓ 触发；面板内快捷切换不受影响
    if (!showSettings.value) localStorage.setItem('readerPrefs', JSON.stringify(value))
    nextTick(updateRangeFills)
  },
  { deep: true },
)

/** 原生 range 的已选段填充：保证拉到 100% 时轨道真正铺满 */
function updateRangeFills() {
  document.querySelectorAll('.panel-row input[type="range"]').forEach((input) => {
    const min = Number(input.min || 0)
    const max = Number(input.max || 100)
    const value = Number(input.value || 0)
    const percent = max > min ? ((value - min) / (max - min)) * 100 : 0
    input.style.setProperty('--range-fill', `${Math.max(0, Math.min(100, percent))}%`)
  })
}

const book = ref(null)
const chapters = ref([])
const current = ref(0)
const content = ref('')
const loading = ref(false)
const readingEl = ref(null)

const showCatalog = ref(false)
const showSettings = ref(false)
const showSearch = ref(false)
const showNotes = ref(false)
const showBookmarks = ref(false)
const showSource = ref(false)
const showReaderSource = ref(false)
const readerSourceLines = ref([])
const readerSourceCurrent = ref('')
const readerSourceLoading = ref(false)
const readerSourceBusy = ref(false)
const showDp = ref(false)
const showDpPanel = ref(false)

const catalogFilter = ref('')
const searchText = ref('')
const searchHits = ref([])
const searchIndex = ref(0)

const notes = ref([])
const noteDraft = ref('')
const bookmarks = ref([])

const sourceCandidates = ref([])
const sourceLoading = ref(false)

const dpMarkers = ref([])
const dpCards = ref([])
const dpLoading = ref(false)
const dpPanelError = ref('')
const dpPanelLoading = ref(false)
const dpPanelTitle = ref('')
const dpComments = ref([])
const dpPanelTotal = ref(0)
const dpPanelHtml = ref('')
const dpPanelUrl = ref('')
const dpPanelTab = ref('all')
const dpPanelSort = ref('default')
const dpPanelQuote = ref('')
const dpPanelHasMore = ref(false)
const dpPanelLoadingMore = ref(false)
const dpPanelMarker = ref(null)

const turnDirection = ref('')
const caching = ref(false)
const systemDark = ref(false)
const clock = ref(new Date())
const battery = ref(null)
const isFullscreen = ref(false)
const wakeLockOn = ref(false)

const scrollState = ref({ y: 0, max: 0, viewport: typeof window !== 'undefined' ? window.innerHeight : 800, pages: 1 })

const tts = ref({ playing: false, paused: false, index: 0 })
const voices = ref([])
const sessionSeconds = ref(0)

let clockTimer = 0
let readTimer = 0
let readSeconds = 0
let wakeLock = null
let mediaQuery = null
let touchStart = null
let cacheWarmed = false

const anyPanel = computed(
  () =>
    showSettings.value ||
    showCatalog.value ||
    showSearch.value ||
    showNotes.value ||
    showBookmarks.value ||
    showSource.value ||
    showDp.value ||
    showDpPanel.value,
)

const isDark = computed(() => prefs.value.appearance === 'dark' || (prefs.value.appearance === 'system' && systemDark.value))
const theme = computed(() => (isDark.value ? DARK : PAPER[prefs.value.paper] || PAPER.parchment))
const dimOpacity = computed(() => ((100 - Number(prefs.value.brightness || 100)) / 100) * 0.72)
const chapter = computed(() => chapters.value[current.value] || null)
const isLocalBook = computed(() => /^local:\/\//i.test(String(book.value?.origin || '')))
const chapterTitle = computed(() => chapter.value?.title || book.value?.name || '加载中…')
const paragraphs = computed(() =>
  String(content.value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && line !== '[图片]'),
)
const cardsAt = (index) => dpCards.value.filter((card) => Number(card.paragraph) === index)
const tailCards = computed(() =>
  dpCards.value.filter((card) => {
    const paragraph = Number(card.paragraph)
    return !Number.isFinite(paragraph) || paragraph < 0 || paragraph >= paragraphs.value.length
  }),
)
const dpMarkerMap = computed(() => {
  const map = new Map()
  for (const marker of dpMarkers.value) {
    const paragraph = Number(marker.paragraph)
    if (Number.isFinite(paragraph) && paragraph >= 0 && !map.has(paragraph)) map.set(paragraph, marker)
  }
  return map
})
const dpTitleMarker = computed(() => dpMarkers.value.find((marker) => Number(marker.paragraph) === -1) || null)
const filteredChapters = computed(() => {
  const query = catalogFilter.value.trim()
  if (!query) return chapters.value
  return chapters.value.filter((item) => String(item.title || '').includes(query))
})
const PARCHMENT_TEXTURE =
  'radial-gradient(circle at 18% 10%, rgba(255,255,255,0.45), transparent 46%), radial-gradient(circle at 82% 90%, rgba(150,110,60,0.12), transparent 52%), repeating-linear-gradient(0deg, rgba(120,90,50,0.03) 0 1px, transparent 1px 4px)'
const shellStyle = computed(() => {
  const current = theme.value
  const base = {
    color: current.text,
    background: current.bg,
    '--reader-bg': current.bg,
    '--reader-half': `${prefs.value.pageWidth / 2}px`,
  }
  if (!isDark.value && prefs.value.paper === 'parchment') {
    return { ...base, backgroundImage: PARCHMENT_TEXTURE }
  }
  if (!isDark.value && current.pattern) {
    return { ...base, backgroundImage: current.pattern, backgroundSize: '10px 10px' }
  }
  return base
})
const pageStyle = computed(() => ({
  maxWidth: `${prefs.value.pageWidth}px`,
  paddingLeft: `${prefs.value.pagePadding}px`,
  paddingRight: `${prefs.value.pagePadding}px`,
  paddingTop: `${44 + Number(prefs.value.pageTop || 0)}px`,
  paddingBottom: `${90 + Number(prefs.value.pageBottom || 0)}px`,
}))
const bodyStyle = computed(() => ({
  fontSize: `${prefs.value.fontSize}px`,
  lineHeight: prefs.value.lineHeight,
  fontFamily: FONT_STACKS[prefs.value.fontFamily] || undefined,
  letterSpacing: `${prefs.value.letterSpacing}em`,
  textAlign: prefs.value.textAlign,
  '--para-gap': `${prefs.value.paragraphSpacing}em`,
  '--text-indent': `${prefs.value.textIndent}em`,
}))
const chapterRatio = computed(() => (scrollState.value.max ? Math.min(1, scrollState.value.y / scrollState.value.max) : 0))
const progress = computed(() => {
  const total = chapters.value.length
  if (!total) return 0
  return Math.min(100, Math.round(((current.value + chapterRatio.value) / total) * 100))
})
const pageInfo = computed(() => {
  const viewport = Math.max(1, scrollState.value.viewport)
  const page = Math.min(scrollState.value.pages, Math.floor(scrollState.value.y / viewport) + 1)
  return { page, pages: scrollState.value.pages }
})
const clockText = computed(() =>
  clock.value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
)
const batteryText = computed(() => {
  if (!battery.value) return ''
  return `${Math.round(battery.value.level * 100)}%${battery.value.charging ? '⚡' : ''}`
})
const ttsLabel = computed(() => (tts.value.playing ? (tts.value.paused ? '继续' : '暂停') : '朗读'))
const animationClass = computed(() => (prefs.value.animation === 'none' ? '' : `${prefs.value.animation}-${turnDirection.value}`))
const ttsSentences = computed(() => splitSentences(content.value))

function splitSentences(text) {
  return String(text)
    .split(/(?<=[。！？!?；;])\s*|\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 400)
}

function updateScroll() {
  const element = document.scrollingElement || document.documentElement
  const max = Math.max(0, element.scrollHeight - window.innerHeight)
  scrollState.value = {
    y: Math.min(window.scrollY, max),
    max,
    viewport: window.innerHeight,
    pages: Math.max(1, Math.ceil(element.scrollHeight / window.innerHeight)),
  }
  lastScrollAt = Date.now()
  scheduleProgressSave()
}

/* ---------------- 阅读进度：章节内字符位置 + 多端双向同步 ----------------
 * 存的是「章节纯文本内的字符偏移」，与排版无关：手机分页还是电脑滚动，
 * 换算出来的位置都指向同一句话。任何一端写入，另一端通过 SSE 立刻跟上。
 */
const syncDevice = isNativeApp() ? 'app:iphone' : 'web'
/** 每个标签页一个随机 id：SSE 会把写入也广播回来，靠它忽略自己的回声。 */
const syncClientId = (() => {
  try {
    let id = sessionStorage.getItem('rp_client_id')
    if (!id) {
      id = 'c-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
      sessionStorage.setItem('rp_client_id', id)
    }
    return id
  } catch {
    return 'c-' + Date.now().toString(36)
  }
})()
const PARAGRAPH_ANCHOR = 64
const pendingRemote = ref(null)

let pendingRestore = null
let progressTimer = 0
let remoteTimer = 0
let lastScrollAt = 0
let suppressSyncUntil = 0
let lastKnownUpdatedAt = 0
let progressSource = null
let progressPollTimer = 0

function paragraphNodes() {
  return readingEl.value ? Array.from(readingEl.value.querySelectorAll('p[data-para]')) : []
}

/** 当前阅读位置 → 章节内字符偏移（0 起，与 Legado 的 durChapterPos 同义）。 */
function currentCharOffset() {
  const nodes = paragraphNodes()
  if (!nodes.length) return 0
  let cumulative = 0
  let offset = 0
  for (let index = 0; index < nodes.length; index += 1) {
    const length = (paragraphs.value[index] || '').length
    const rect = nodes[index].getBoundingClientRect()
    if (rect.bottom > PARAGRAPH_ANCHOR) {
      const fraction = rect.height > 0 ? Math.min(1, Math.max(0, (PARAGRAPH_ANCHOR - rect.top) / rect.height)) : 0
      offset = cumulative + Math.round(fraction * length)
      break
    }
    cumulative += length
    offset = cumulative
  }
  return Math.max(0, offset)
}

/** 字符偏移 → 滚到对应段落的相对位置（打开书时「接着看」）。 */
function scrollToCharOffset(offset) {
  const nodes = paragraphNodes()
  if (!nodes.length) return
  let cumulative = 0
  for (let index = 0; index < nodes.length; index += 1) {
    const length = (paragraphs.value[index] || '').length
    if (cumulative + length >= offset) {
      const fraction = length > 0 ? Math.min(1, Math.max(0, (offset - cumulative) / length)) : 0
      const rect = nodes[index].getBoundingClientRect()
      const top = rect.top + window.scrollY + fraction * rect.height - PARAGRAPH_ANCHOR
      window.scrollTo({ top: Math.max(0, top) })
      updateScroll()
      return
    }
    cumulative += length
  }
  window.scrollTo({ top: document.body.scrollHeight })
  updateScroll()
}

function saveProgressNow({ force = false } = {}) {
  if (!book.value || !chapters.value.length) return
  if (!force && Date.now() < suppressSyncUntil) return
  const position = currentCharOffset()
  api
    .saveProgress(book.value.bookUrl, current.value, position, chapterTitle.value, {
      device: syncDevice,
      clientId: syncClientId,
      clientUpdatedAt: Date.now(),
    })
    .then((result) => {
      if (!result) return
      if (result.updatedAt) lastKnownUpdatedAt = Number(result.updatedAt)
      // 服务端认为我们更旧：直接采纳服务端的位置，避免两台设备各写各的。
      if (result.accepted === false) applyRemoteProgress(result, { quiet: true })
    })
    .catch(() => {})
}

function scheduleProgressSave() {
  clearTimeout(progressTimer)
  progressTimer = setTimeout(() => saveProgressNow(), 800)
}

function applyRemoteProgress(progress, { quiet = false } = {}) {
  if (!progress || !book.value) return
  if (String(progress.bookUrl || '') !== String(book.value.bookUrl)) return
  const targetIndex = Math.max(0, Number(progress.index || 0))
  const targetPosition = Math.max(0, Number(progress.position || 0))
  suppressSyncUntil = Date.now() + 2500
  lastKnownUpdatedAt = Number(progress.updatedAt || Date.now())
  const label = String(progress.device || '').startsWith('app') ? '手机' : '网页'
  if (targetIndex !== current.value) {
    pendingRestore = { index: targetIndex, position: targetPosition }
    loadChapter(targetIndex, { fromRemote: true })
    if (!quiet) window.__toast?.(`已同步到${label}端：第 ${targetIndex + 1} 章`)
  } else {
    scrollToCharOffset(targetPosition)
    if (!quiet) window.__toast?.(`已同步到${label}端阅读位置`)
  }
}

function handleRemoteProgress(progress) {
  if (!progress || !book.value) return
  if (String(progress.bookUrl || '') !== String(book.value.bookUrl)) return
  if (progress.clientId && String(progress.clientId) === syncClientId) return
  if (Number(progress.updatedAt || 0) <= lastKnownUpdatedAt) return
  if (Date.now() - lastScrollAt > 3000) {
    applyRemoteProgress(progress)
    return
  }
  // 正在滚动：先记下来，停下来几秒后再跟过去，避免打断阅读。
  pendingRemote.value = progress
  window.__toast?.('另一端更新了阅读进度，停下来后自动同步')
  clearTimeout(remoteTimer)
  remoteTimer = setTimeout(() => {
    if (pendingRemote.value && Date.now() - lastScrollAt > 2500) {
      const latest = pendingRemote.value
      pendingRemote.value = null
      applyRemoteProgress(latest)
    }
  }, 4000)
}

function subscribeProgress() {
  if (progressSource || typeof EventSource === 'undefined') return
  try {
    const token = getToken()
    const url = '/reader3/progressSSE' + (token ? `?token=${encodeURIComponent(token)}` : '')
    progressSource = new EventSource(url)
    progressSource.onmessage = (event) => {
      try {
        handleRemoteProgress(JSON.parse(event.data))
      } catch {
        /* 忽略坏帧 */
      }
    }
  } catch {
    /* 不支持 SSE 时靠轮询 */
  }
}

function unsubscribeProgress() {
  progressSource?.close()
  progressSource = null
  clearInterval(progressPollTimer)
}

/** SSE 被代理掐断时的兜底：每 20 秒查一次当前书的进度。 */
async function pollProgress() {
  if (!book.value || document.visibilityState !== 'visible') return
  try {
    const progress = await api.getBookProgress(book.value.bookUrl)
    if (progress) handleRemoteProgress(progress)
  } catch {
    /* 轮询失败忽略 */
  }
}


/* ---------------- 手机阅读器：点按分区 + 浮动控制条 ---------------- */
const isMobile = ref(false)
const mobileChrome = ref(true)
let chromeTimer = 0

function updateMobileLayout() {
  isMobile.value = window.innerWidth <= 760
}

function revealChrome({ autoHide = true } = {}) {
  mobileChrome.value = true
  clearTimeout(chromeTimer)
  if (autoHide) chromeTimer = setTimeout(() => (mobileChrome.value = false), 4000)
}

function toggleChrome() {
  if (mobileChrome.value) {
    mobileChrome.value = false
    clearTimeout(chromeTimer)
  } else {
    revealChrome()
  }
}

/** 左 28% 上一页/章，右 28% 下一页/章，中间切换控制条 */
function onReaderTap(event) {
  if (!isMobile.value) return
  if (event.target.closest('button, a, input, select, textarea, .reader-panel')) return
  const width = window.innerWidth
  if (event.clientX < width * 0.28) turnPrev()
  else if (event.clientX > width * 0.72) turnNext()
  else toggleChrome()
}

function openCatalogPanel() {
  showCatalog.value = true
  mobileChrome.value = false
}

function onTouchStart(event) {  const touch = event.changedTouches?.[0]
  if (!touch) return
  touchStart = { x: touch.clientX, y: touch.clientY, at: Date.now() }
}

function onTouchEnd(event) {
  const touch = event.changedTouches?.[0]
  if (!touch || !touchStart) return
  const dx = touch.clientX - touchStart.x
  const dy = touch.clientY - touchStart.y
  const elapsed = Date.now() - touchStart.at
  touchStart = null
  if (elapsed > 700 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return
  if (dx < 0) turnNext()
  else turnPrev()
}

function closePanels() {
  if (showSettings.value) cancelSettings()
  showSettings.value = false
  showCatalog.value = false
  showSearch.value = false
  showNotes.value = false
  showBookmarks.value = false
  showSource.value = false
  showDp.value = false
  showDpPanel.value = false
}

function onKeydown(event) {
  if (event.key === 'Escape' && anyPanel.value) {
    closePanels()
    return
  }
  if (anyPanel.value || event.target.closest?.('input, textarea, select')) return
  if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
    event.preventDefault()
    turnNext()
  } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
    event.preventDefault()
    turnPrev()
  }
}

function savePrefs() {
  localStorage.setItem('readerPrefs', JSON.stringify(prefs.value))
}

function openSettings() {
  settingsSnapshot.value = JSON.stringify(prefs.value)
  showSettings.value = true
  nextTick(updateRangeFills)
}

function saveSettings() {
  savePrefs()
  settingsSnapshot.value = ''
  showSettings.value = false
  window.__toast?.('阅读设置已保存')
}

function cancelSettings() {
  if (settingsSnapshot.value) {
    try {
      const restored = JSON.parse(settingsSnapshot.value)
      skipNextPrefsPersist = true
      prefs.value = restored
    } catch {
      /* 快照损坏时保持当前值 */
    }
  }
  settingsSnapshot.value = ''
  showSettings.value = false
}

/** 从设置面板跳到别的面板：有改动先保存，没改动直接关 */
function leaveSettingsTo(open) {
  if (settingsDirty.value) saveSettings()
  else {
    settingsSnapshot.value = ''
    showSettings.value = false
  }
  open()
}

function openCatalogFromSettings() {
  leaveSettingsTo(() => {
    showCatalog.value = true
  })
}

function openSearchFromSettings() {
  leaveSettingsTo(() => {
    showSearch.value = true
  })
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
    if (book.value.hasUpdate) {
      book.value.hasUpdate = false
      book.value.newChapterCount = 0
      api.clearBookUpdate(book.value.bookUrl).catch(() => {})
    }
    chapters.value = await api.chapterList({
      bookUrl: book.value.bookUrl,
      tocUrl: book.value.tocUrl,
      bookSourceUrl: book.value.origin,
    })
    current.value = Number(book.value.durChapterIndex || 0)
    // 打开书：先按服务端进度定位，再把「当前章 + 章节内位置」交给 loadChapter 还原
    pendingRestore = { index: current.value, position: Number(book.value.durChapterPos || 0) }
    await loadChapter(current.value, { fromRemote: true })
    loadNotes()
    loadBookmarks()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function loadChapter(index, { fromRemote = false } = {}) {
  if (!chapters.value.length) return
  stopTts()
  const target = Math.max(0, Math.min(index, chapters.value.length - 1))
  loading.value = true
  turnDirection.value = target > current.value ? 'next' : target < current.value ? 'prev' : ''
  if (fromRemote) suppressSyncUntil = Date.now() + 2000
  try {
    const text = await api.content({
      bookUrl: book.value.bookUrl,
      index: target,
      convert: prefs.value.convert || undefined,
    })
    content.value = text
    current.value = target
    searchHits.value = []
    loadParagraphComments()
    warmCache(target)
    await nextTick()
    const restore = pendingRestore && Number(pendingRestore.index) === target ? pendingRestore : null
    pendingRestore = null
    if (restore && Number(restore.position) > 0) {
      scrollToCharOffset(Number(restore.position))
    } else {
      window.scrollTo({ top: 0 })
      updateScroll()
    }
    // 用户自己翻章：立刻把新章节写进服务端，另一端马上能看到。
    if (!fromRemote) saveProgressNow({ force: true })
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

function turnNext() {
  if (prefs.value.pageMode === 'page') {
    const remaining = scrollState.value.max - scrollState.value.y
    if (remaining > scrollState.value.viewport * 0.35) {
      window.scrollBy({ top: scrollState.value.viewport - 24, behavior: prefs.value.animation === 'none' ? 'auto' : 'smooth' })
      return
    }
  }
  if (current.value < chapters.value.length - 1) loadChapter(current.value + 1)
}

function turnPrev() {
  if (prefs.value.pageMode === 'page') {
    if (scrollState.value.y > scrollState.value.viewport * 0.35) {
      window.scrollBy({ top: -(scrollState.value.viewport - 24), behavior: prefs.value.animation === 'none' ? 'auto' : 'smooth' })
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
    await loadBookmarks()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function loadBookmarks() {
  if (!book.value) return
  try {
    bookmarks.value = (await api.bookmarks()).filter((item) => item.bookUrl === book.value.bookUrl)
  } catch {
    bookmarks.value = []
  }
}

async function jumpBookmark(bookmark) {
  showBookmarks.value = false
  await loadChapter(Number(bookmark.chapterIndex) || 0)
}

async function removeBookmark(bookmark) {
  await api.deleteBookmark(bookmark).catch(() => {})
  await loadBookmarks()
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
async function openReaderSource() {
  if (!book.value) return
  showReaderSource.value = true
  readerSourceLoading.value = true
  readerSourceLines.value = []
  readerSourceCurrent.value = ''
  try {
    const result = await api.sourceLines(book.value.origin)
    readerSourceLines.value = result?.lines || []
    readerSourceCurrent.value = result?.current || ''
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    readerSourceLoading.value = false
  }
}

async function switchReaderLine(line) {
  if (!book.value || readerSourceBusy.value) return
  readerSourceBusy.value = true
  try {
    await api.setSourceLine(book.value.origin, line)
    readerSourceCurrent.value = line.url
    window.__toast?.(`已切换到「${line.name}」`)
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    readerSourceBusy.value = false
  }
}

function readerLineClass(line) {
  if (!line.ok || line.latency < 0) return 'bad'
  if (line.latency < 300) return 'good'
  if (line.latency < 900) return 'mid'
  return 'slow'
}

async function findSources() {
  if (isLocalBook.value) {
    window.__toast?.('本地导入的书不需要换源')
    return
  }
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
    const switched = await api.setBookSource({
      bookUrl: book.value.bookUrl,
      newUrl: candidate.bookUrl,
      bookSourceUrl: candidate.origin,
    })
    book.value = switched
    chapters.value = await api.chapterList({
      bookUrl: switched.bookUrl,
      tocUrl: switched.tocUrl,
      bookSourceUrl: switched.origin,
    })
    showSource.value = false
    window.__toast?.(`已切换到「${candidate.originName}」`)
    router.replace({ path: '/read', query: { book: switched.bookUrl } }).catch(() => {})
    const index = Math.min(Math.max(0, Number(switched.durChapterIndex) || 0), Math.max(0, chapters.value.length - 1))
    await loadChapter(index, { fromRemote: true })
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/* ---------------- 段评 ---------------- */
async function loadParagraphComments() {
  if (!book.value) return
  const wanted = current.value
  try {
    const result = await api.paragraphComments({ bookUrl: props.bookUrl, index: wanted })
    if (current.value !== wanted) return
    dpMarkers.value = result.markers || []
    dpCards.value = result.cards || []
  } catch {
    if (current.value === wanted) {
      dpMarkers.value = []
      dpCards.value = []
    }
  }
}

async function openDp() {
  showDp.value = true
  dpLoading.value = true
  await loadParagraphComments()
  dpLoading.value = false
}

async function openDpComment(marker) {
  if (!marker || dpPanelLoading.value) return
  showDpPanel.value = true
  dpPanelMarker.value = marker
  dpPanelTab.value = 'all'
  dpPanelSort.value = 'default'
  dpPanelQuote.value =
    Number(marker.paragraph) >= 0 ? String(paragraphs.value[Number(marker.paragraph)] || '').trim() : ''
  dpPanelTitle.value =
    Number(marker.paragraph) === -1
      ? `章节名 · ${marker.count} 条段评`
      : `第 ${Number(marker.paragraph) + 1} 段 · ${marker.count} 条段评`
  await loadDpComments(0)
}

async function changeDpTab(tab) {
  if (dpPanelTab.value === tab) return
  dpPanelTab.value = tab
  await loadDpComments(0)
}

async function loadDpComments(offset) {
  const marker = dpPanelMarker.value
  if (!marker) return
  if (offset === 0) {
    dpPanelLoading.value = true
    dpPanelError.value = ''
    dpComments.value = []
    dpPanelHtml.value = ''
    dpPanelUrl.value = ''
    dpPanelTotal.value = 0
    dpPanelHasMore.value = false
  } else {
    dpPanelLoadingMore.value = true
  }
  try {
    const result = await api.paragraphCommentPanel({
      bookUrl: props.bookUrl,
      index: current.value,
      paragraph: Number(marker.paragraph),
      offset,
      limit: offset === 0 ? 10 : 6,
      tab: dpPanelTab.value,
      sort: dpPanelSort.value,
    })
    if (result.html) {
      dpPanelHtml.value = result.html
      dpPanelUrl.value = result.panelUrl || ''
      dpPanelHasMore.value = false
      return
    }
    dpComments.value = offset === 0 ? result.comments || [] : [...dpComments.value, ...(result.comments || [])]
    dpPanelTotal.value = Number(result.total || dpComments.value.length)
    dpPanelUrl.value = result.panelUrl || ''
    dpPanelHasMore.value = Boolean(result.hasMore)
    if (!dpComments.value.length) dpPanelError.value = '没有取到段评内容'
  } catch (error) {
    if (offset === 0) dpPanelError.value = error.message
  } finally {
    dpPanelLoading.value = false
    dpPanelLoadingMore.value = false
  }
}

function onDpPanelScroll(event) {
  if (!dpPanelHasMore.value || dpPanelLoadingMore.value || dpPanelLoading.value) return
  const el = event.target
  if (!el || el.scrollTop + el.clientHeight < el.scrollHeight - 80) return
  loadDpComments(dpComments.value.length)
}

function formatCommentTime(value) {
  const stamp = Number(value || 0)
  if (!stamp) return ''
  const date = new Date(stamp)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/* ---------------- 朗读 ---------------- */
function refreshVoices() {
  if (!window.speechSynthesis) return
  const all = window.speechSynthesis.getVoices()
  const chinese = all.filter((voice) => /zh|chinese|中文/i.test(`${voice.lang} ${voice.name}`))
  voices.value = chinese.length ? chinese : all
}

function selectedVoice() {
  if (!prefs.value.ttsVoice) return null
  return voices.value.find((voice) => voice.voiceURI === prefs.value.ttsVoice) || null
}

function speakAt(index) {
  if (!tts.value.playing) return
  const sentences = ttsSentences.value
  if (index >= sentences.length) {
    stopTts()
    return
  }
  tts.value.index = index
  const utterance = new SpeechSynthesisUtterance(sentences[index])
  utterance.lang = 'zh-CN'
  utterance.rate = Number(prefs.value.ttsRate) || 1
  utterance.pitch = Number(prefs.value.ttsPitch) || 1
  utterance.volume = Number(prefs.value.ttsVolume) || 1
  const voice = selectedVoice()
  if (voice) utterance.voice = voice
  utterance.onend = () => {
    if (tts.value.playing && !tts.value.paused) speakAt(index + 1)
  }
  utterance.onerror = () => {
    tts.value.playing = false
    window.__toast?.('朗读中断')
  }
  window.speechSynthesis.speak(utterance)
}

function startTts() {
  if (!window.speechSynthesis) return window.__toast?.('浏览器不支持朗读')
  if (!ttsSentences.value.length) return
  window.speechSynthesis.cancel()
  tts.value = { playing: true, paused: false, index: 0 }
  speakAt(0)
}

function toggleTtsPause() {
  if (!tts.value.playing) return startTts()
  if (tts.value.paused) {
    window.speechSynthesis.resume()
    tts.value.paused = false
  } else {
    window.speechSynthesis.pause()
    tts.value.paused = true
  }
}

function stopTts() {
  if (window.speechSynthesis) window.speechSynthesis.cancel()
  tts.value = { playing: false, paused: false, index: 0 }
}

function ttsPrev() {
  if (!tts.value.playing || tts.value.index <= 0) return
  window.speechSynthesis.cancel()
  tts.value.paused = false
  speakAt(tts.value.index - 1)
}

function ttsNext() {
  if (!tts.value.playing || tts.value.index >= ttsSentences.value.length - 1) return
  window.speechSynthesis.cancel()
  tts.value.paused = false
  speakAt(tts.value.index + 1)
}

async function refreshCatalog() {
  if (!book.value) return
  try {
    chapters.value = await api.chapterList({
      bookUrl: book.value.bookUrl,
      tocUrl: book.value.tocUrl,
      bookSourceUrl: book.value.origin,
      refresh: true,
    })
    if (current.value >= chapters.value.length) current.value = Math.max(0, chapters.value.length - 1)
    window.__toast?.('目录已刷新')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/* ---------------- 阅读时长 ---------------- */
function flushReading() {
  if (!book.value || readSeconds <= 0) return
  const seconds = readSeconds
  readSeconds = 0
  api.saveReadingTime({ bookUrl: book.value.bookUrl, seconds, chapters: 0 }).catch(() => {})
}

/* ---------------- 显示工具 ---------------- */
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.()
  else document.documentElement.requestFullscreen?.().catch(() => window.__toast?.('当前浏览器不允许全屏'))
}

async function toggleWakeLock() {
  try {
    if (wakeLock) {
      await wakeLock.release()
      wakeLock = null
      wakeLockOn.value = false
      return
    }
    if (!navigator.wakeLock) return window.__toast?.('当前浏览器不支持常亮')
    wakeLock = await navigator.wakeLock.request('screen')
    wakeLockOn.value = true
    wakeLock.addEventListener('release', () => {
      wakeLock = null
      wakeLockOn.value = false
    })
  } catch (error) {
    window.__toast?.(`常亮失败：${error.message}`)
  }
}

async function cacheChapter() {
  caching.value = true
  try {
    const from = current.value
    const result = await api.cacheBook(book.value.bookUrl, 50, false, from)
    window.__toast?.(`已缓存 ${result.cached} 章（从第 ${from + 1} 章起，累计 ${result.totalCached}）`)
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    caching.value = false
  }
}

/**
 * 打开一本书时只预热「当前章 + 后 49 章」，不整本缓存。
 * 之后每读一章，服务端在取正文时顺手把它写入缓存，所以缓存随阅读位置向后长。
 */
const warmCache = (index) => {
  const origin = String(book.value?.origin || '')
  // 只有本地文件书不需要预热；书源自己的 URL 也可能以 local:// 开头，不能一律跳过。
  if (!origin || /^local:\/\/(txt|epub|docx|mobi|pdf)(\/|$)/i.test(origin) || cacheWarmed) return
  cacheWarmed = true
  api
    .cacheBook(book.value.bookUrl, 10, false, index)
    .then((result) => {
      if (result?.cached) window.__toast?.(`已从第 ${index + 1} 章起缓存 ${result.cached} 章`)
    })
    .catch(() => {})
}

async function setConvert(mode) {
  prefs.value.convert = mode
  await loadChapter(current.value)
}

function selectPaper(key) {
  prefs.value.paper = key
  if (isDark.value) prefs.value.appearance = 'light'
}

function onVisibility() {
  if (document.visibilityState === 'visible') {
    updateScroll()
    pollProgress()
  } else {
    saveProgressNow({ force: true })
  }
}

onMounted(() => {
  mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)')
  systemDark.value = Boolean(mediaQuery?.matches)
  mediaQuery?.addEventListener?.('change', (event) => (systemDark.value = event.matches))

  window.addEventListener('scroll', updateScroll, { passive: true })
  window.addEventListener('resize', updateScroll)
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('fullscreenchange', () => (isFullscreen.value = Boolean(document.fullscreenElement)))

  refreshVoices()
  window.speechSynthesis?.addEventListener?.('voiceschanged', refreshVoices)

  if (navigator.getBattery) {
    navigator.getBattery().then((manager) => {
      const sync = () => (battery.value = { level: manager.level, charging: manager.charging })
      sync()
      manager.addEventListener?.('levelchange', sync)
      manager.addEventListener?.('chargingchange', sync)
    }).catch(() => {})
  }

  clockTimer = window.setInterval(() => (clock.value = new Date()), 30000)
  readTimer = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return
    readSeconds += 15
    sessionSeconds.value += 15
    if (readSeconds >= 60) flushReading()
  }, 15000)

  updateScroll()
  loadBook()
  updateMobileLayout()
  window.addEventListener('resize', updateMobileLayout)
  revealChrome()
  subscribeProgress()
  progressPollTimer = window.setInterval(pollProgress, 20000)
  // App 切后台前原生会调这个函数，保证最后一段阅读位置不丢
  window.__panghuFlushProgress = () => saveProgressNow({ force: true })
})

onBeforeUnmount(() => {
  stopTts()
  flushReading()
  saveProgressNow({ force: true })
  unsubscribeProgress()
  clearTimeout(progressTimer)
  clearTimeout(remoteTimer)
  clearTimeout(chromeTimer)
  window.removeEventListener('resize', updateMobileLayout)
  delete window.__panghuFlushProgress
  clearInterval(clockTimer)
  clearInterval(readTimer)
  window.removeEventListener('scroll', updateScroll)
  window.removeEventListener('resize', updateScroll)
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('visibilitychange', onVisibility)
  mediaQuery?.removeEventListener?.('change', () => {})
  window.speechSynthesis?.removeEventListener?.('voiceschanged', refreshVoices)
  wakeLock?.release?.().catch(() => {})
})

watch(
  () => prefs.value.pageMode,
  () => nextTick(updateScroll),
)

watch(chapterTitle, () => {
  dpMarkers.value = []
  dpCards.value = []
})
</script>

<template>
  <div class="reader-shell" :class="{ 'separate-areas': prefs.separateAreas }" :style="shellStyle">
    <div class="reader-dim" :style="{ opacity: dimOpacity }" />

    <!-- 手机：浮动顶部栏（返回/书名/目录） -->
    <div v-if="isMobile" class="m-topbar" :class="{ shown: mobileChrome }">
      <button class="m-icon" title="返回书架" @click="router.push('/bookshelf')">‹</button>
      <div class="m-title">
        <strong>{{ book?.name || '胖虎阅读' }}</strong>
        <span>{{ chapterTitle }}</span>
      </div>
      <button class="m-icon" title="目录" @click="openCatalogPanel">☰</button>
    </div>

    <!-- 手机：浮动底部控制条（目录/上一章/进度/下一章/设置） -->
    <div v-if="isMobile" class="m-bottombar" :class="{ shown: mobileChrome }">
      <button title="目录" @click="openCatalogPanel"><i>☰</i><span>目录</span></button>
      <button title="上一章" @click="turnPrev"><i>‹</i><span>上一章</span></button>
      <button class="m-progress" title="目录" @click="openCatalogPanel">
        <strong>{{ Math.round(progress) }}%</strong>
        <span>{{ current + 1 }}/{{ chapters.length }}</span>
      </button>
      <button title="下一章" @click="turnNext"><i>›</i><span>下一章</span></button>
      <button title="设置" @click="openSettings"><i>⚙</i><span>设置</span></button>
    </div>

    <aside class="rail rail-left">
      <button class="rail-btn" title="返回书架" @click="router.push('/bookshelf')"><span>⌂</span><i>书架</i></button>
      <button class="rail-btn" title="书源" @click="openReaderSource"><span>⌘</span><i>书源</i></button>
      <button class="rail-btn" title="目录" @click="showCatalog = true"><span>☰</span><i>目录</i></button>
      <button class="rail-btn" title="设置" @click="openSettings"><span>⚙</span><i>设置</i></button>
      <button class="rail-btn" title="顶部" @click="toTop"><span>︿</span><i>顶部</i></button>
      <button class="rail-btn" title="底部" @click="toBottom"><span>﹀</span><i>底部</i></button>
    </aside>

    <main
      ref="readingEl"
      class="reader-main"
      :class="animationClass"
      :style="pageStyle"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
      @click="onReaderTap"
    >
      <h1 v-if="prefs.showChapterTitle" class="chapter-title" :style="{ fontSize: prefs.fontSize * 1.28 + 'px' }">
        {{ chapterTitle }}
        <button v-if="dpTitleMarker" class="dp-bubble" :title="`${dpTitleMarker.count} 条章节名段评`" @click.stop="openDpComment(dpTitleMarker)">
          {{ dpTitleMarker.count }}
        </button>
      </h1>
      <div v-if="loading" class="reader-loading">加载中…</div>
      <div v-else class="chapter-body" :style="bodyStyle">
        <template v-for="(paragraph, index) in paragraphs" :key="index">
          <p :data-para="index">
            {{ paragraph }}
            <button
              v-if="dpMarkerMap.get(index)"
              class="dp-bubble"
              :title="`${dpMarkerMap.get(index).count} 条段评`"
              @click.stop="openDpComment(dpMarkerMap.get(index))"
            >
              {{ dpMarkerMap.get(index).count }}
            </button>
          </p>
          <div v-for="(card, cardIndex) in cardsAt(index)" :key="'card-' + cardIndex" class="chapter-card">
            <img :src="withImageToken(card.src)" :alt="card.alt || ''" loading="lazy" />
          </div>
        </template>
        <div v-for="(card, cardIndex) in tailCards" :key="'tail-card-' + cardIndex" class="chapter-card">
          <img :src="withImageToken(card.src)" :alt="card.alt || ''" loading="lazy" />
        </div>
      </div>
      <div class="chapter-end">
        <button class="chapter-end-btn" @click.stop="turnNext">下一章 →</button>
      </div>
    </main>

    <aside class="rail rail-right">
      <button class="rail-btn round" title="加书签" @click="addBookmark">🔖</button>
      <button class="rail-btn round" title="查找" @click="showSearch = !showSearch">⌕</button>
      <button class="rail-btn round" title="笔记" @click="showNotes = true; loadNotes()">✎</button>
      <button class="rail-btn round" title="段评" @click="openDp">💬</button>
      <button class="rail-btn round" :title="caching ? '缓存中…' : '缓存 50 章'" @click="cacheChapter">⤓</button>
      <button class="rail-btn round" title="刷新本章" @click="loadChapter(current)">↻</button>
      <button class="rail-btn round" title="简繁" @click="setConvert(prefs.convert === 'tw' ? 'cn' : 'tw')">文</button>
      <button class="rail-btn round" :title="tts.playing ? '停止朗读' : '朗读'" @click="tts.playing ? stopTts() : startTts()">🎧</button>
      <div class="rail-progress">{{ progress }}%</div>
      <div class="rail-page">{{ current + 1 }}/{{ chapters.length }}</div>
      <button class="rail-btn round" title="上一章" @click="turnPrev">‹</button>
      <button class="rail-btn round" title="下一章" @click="turnNext">›</button>
    </aside>

    <!-- 正文搜索条 -->
    <div v-if="showSearch" class="search-bar">
      <input v-model="searchText" placeholder="本章查找" @keyup.enter="runSearch" />
      <span class="search-count">{{ searchHits.length ? `${searchIndex + 1}/${searchHits.length}` : '—' }}</span>
      <button class="chrome-btn" @click="jumpHit(-1)">‹</button>
      <button class="chrome-btn" @click="jumpHit(1)">›</button>
      <button class="chrome-btn" @click="showSearch = false">×</button>
    </div>

    <!-- 阅读设置（沿用旧版底部弹层） -->
    <div v-if="showSettings" class="sheet-backdrop" @click.self="cancelSettings">
      <div class="sheet reader-sheet settings-sheet" :style="{ background: theme.bg, color: theme.text }">
        <div class="sheet-handle" />
        <header class="panel-head settings-head">
          <h2>阅读设置</h2>
          <div class="settings-head-actions">
            <button
              v-if="settingsDirty"
              class="chrome-btn save-btn"
              aria-label="保存阅读设置"
              title="保存阅读设置"
              @click="saveSettings"
            >
              <span class="check-glyph" aria-hidden="true" />
            </button>
            <button class="chrome-btn close-btn" aria-label="关闭阅读设置" title="关闭" @click="cancelSettings">
              <span class="close-glyph" aria-hidden="true" />
            </button>
          </div>
        </header>
        <div class="panel-body settings-body">
        <section class="panel-section">
          <h3>主题</h3>
          <div class="segmented">
            <button
              v-for="item in APPEARANCE"
              :key="item.value"
              :class="{ active: prefs.appearance === item.value }"
              @click="prefs.appearance = item.value"
            >{{ item.label }}</button>
          </div>
          <div class="swatches">
            <button
              v-for="(paper, key) in PAPER"
              :key="key"
              class="theme-swatch"
              :class="{ active: prefs.paper === key && !isDark }"
              :style="{ background: paper.bg, color: paper.text }"
              @click="selectPaper(key)"
            >{{ paper.name }}</button>
          </div>
          <label class="panel-row">
            <span>亮度</span>
            <input v-model.number="prefs.brightness" type="range" min="20" max="100" step="1" />
            <b>{{ prefs.brightness }}%</b>
          </label>
        </section>

        <section class="panel-section">
          <h3>排版</h3>
          <label class="panel-row">
            <span>字体</span>
            <select v-model="prefs.fontFamily">
              <option v-for="item in FONT_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </label>
          <div class="panel-row">
            <span>字号</span>
            <button class="step-btn" @click="prefs.fontSize = Math.max(12, prefs.fontSize - 1)">A−</button>
            <b>{{ prefs.fontSize }}px</b>
            <button class="step-btn" @click="prefs.fontSize = Math.min(32, prefs.fontSize + 1)">A＋</button>
          </div>
          <label class="panel-row">
            <span>行距</span>
            <input v-model.number="prefs.lineHeight" type="range" min="1.4" max="2.8" step="0.05" />
            <b>{{ prefs.lineHeight.toFixed(2) }}</b>
          </label>
          <label class="panel-row">
            <span>段距</span>
            <input v-model.number="prefs.paragraphSpacing" type="range" min="0" max="2" step="0.1" />
            <b>{{ prefs.paragraphSpacing.toFixed(1) }}em</b>
          </label>
          <label class="panel-row">
            <span>首行缩进</span>
            <input v-model.number="prefs.textIndent" type="range" min="0" max="3" step="0.5" />
            <b>{{ prefs.textIndent }}em</b>
          </label>
          <label class="panel-row">
            <span>字距</span>
            <input v-model.number="prefs.letterSpacing" type="range" min="0" max="0.2" step="0.01" />
            <b>{{ prefs.letterSpacing.toFixed(2) }}em</b>
          </label>
          <label class="panel-row">
            <span>页宽</span>
            <input v-model.number="prefs.pageWidth" type="range" min="520" max="1000" step="20" />
            <b>{{ prefs.pageWidth }}px</b>
          </label>
          <label class="panel-row">
            <span>页边距</span>
            <input v-model.number="prefs.pagePadding" type="range" min="8" max="64" step="4" />
            <b>{{ prefs.pagePadding }}px</b>
          </label>
          <label class="panel-row">
            <span>上留白</span>
            <input v-model.number="prefs.pageTop" type="range" min="0" max="160" step="8" />
            <b>{{ prefs.pageTop }}px</b>
          </label>
          <label class="panel-row">
            <span>下留白</span>
            <input v-model.number="prefs.pageBottom" type="range" min="0" max="160" step="8" />
            <b>{{ prefs.pageBottom }}px</b>
          </label>
          <div class="panel-row">
            <span>对齐</span>
            <div class="segmented small">
              <button
                v-for="item in ALIGNS"
                :key="item.value"
                :class="{ active: prefs.textAlign === item.value }"
                @click="prefs.textAlign = item.value"
              >{{ item.label }}</button>
            </div>
          </div>
          <label class="panel-row"><span>显示章节标题</span><input v-model="prefs.showChapterTitle" type="checkbox" /></label>
          <label class="panel-row"><span>区分正文/侧栏</span><input v-model="prefs.separateAreas" type="checkbox" /></label>
        </section>

        <section class="panel-section">
          <h3>翻页</h3>
          <div class="segmented">
            <button :class="{ active: prefs.pageMode === 'scroll' }" @click="prefs.pageMode = 'scroll'">上下滚动</button>
            <button :class="{ active: prefs.pageMode === 'page' }" @click="prefs.pageMode = 'page'">整屏翻页</button>
          </div>
          <label class="panel-row">
            <span>动画</span>
            <select v-model="prefs.animation">
              <option v-for="item in ANIMATIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </label>
        </section>

        <section class="panel-section">
          <h3>朗读</h3>
          <label class="panel-row">
            <span>声音</span>
            <select v-model="prefs.ttsVoice">
              <option value="">默认</option>
              <option v-for="voice in voices" :key="voice.voiceURI" :value="voice.voiceURI">{{ voice.name }}</option>
            </select>
          </label>
          <label class="panel-row">
            <span>语速</span>
            <input v-model.number="prefs.ttsRate" type="range" min="0.5" max="2" step="0.1" />
            <b>{{ prefs.ttsRate.toFixed(1) }}x</b>
          </label>
          <label class="panel-row">
            <span>音调</span>
            <input v-model.number="prefs.ttsPitch" type="range" min="0.5" max="2" step="0.1" />
            <b>{{ prefs.ttsPitch.toFixed(1) }}</b>
          </label>
          <label class="panel-row">
            <span>音量</span>
            <input v-model.number="prefs.ttsVolume" type="range" min="0" max="1" step="0.05" />
            <b>{{ Math.round(prefs.ttsVolume * 100) }}%</b>
          </label>
          <div class="row tts-actions">
            <button class="primary" @click="startTts">从头朗读</button>
            <button class="ghost" @click="ttsPrev">上一句</button>
            <button class="ghost" @click="toggleTtsPause">{{ ttsLabel }}</button>
            <button class="ghost" @click="ttsNext">下一句</button>
            <button class="ghost" :disabled="!tts.playing" @click="stopTts">停止</button>
            <span class="muted" style="font-size: 12px">{{ tts.playing ? `第 ${tts.index + 1}/${ttsSentences.length} 句` : '' }}</span>
          </div>
        </section>

        <section class="panel-section">
          <h3>其它</h3>
          <div class="panel-row">
            <span>本次阅读</span>
            <b>{{ Math.round(sessionSeconds / 60) }} 分钟</b>
          </div>
          <label class="panel-row">
            <span>简繁转换</span>
            <select :value="prefs.convert" @change="setConvert($event.target.value)">
              <option value="">原文</option>
              <option value="tw">繁体</option>
              <option value="cn">简体</option>
            </select>
          </label>
          <div class="panel-actions">
            <button class="ghost" @click="openCatalogFromSettings">目录</button>
            <button class="ghost" @click="showBookmarks = true; loadBookmarks()">书签</button>
            <button class="ghost" @click="showNotes = true; loadNotes()">笔记</button>
            <button class="ghost" @click="openDp">段评</button>
            <button v-if="!isLocalBook" class="ghost" @click="findSources">换源</button>
            <button class="ghost" :disabled="caching" @click="cacheChapter">{{ caching ? '缓存中…' : '缓存 50 章' }}</button>
            <button class="ghost" @click="openSearchFromSettings">正文查找</button>
            <button class="ghost" @click="toggleFullscreen">{{ isFullscreen ? '退出全屏' : '全屏' }}</button>
            <button class="ghost" @click="toggleWakeLock">{{ wakeLockOn ? '取消常亮' : '保持常亮' }}</button>
            <button class="ghost" @click="toTop">回顶部</button>
            <button class="ghost" @click="toBottom">到底部</button>
          </div>
        </section>
        </div>
      </div>
    </div>

    <!-- 目录 -->
    <div v-if="showCatalog" class="sheet-backdrop" @click.self="showCatalog = false">
      <div class="sheet reader-sheet" :style="{ background: theme.bg, color: theme.text }">
        <div class="sheet-handle" />
        <div class="row" style="align-items: center; gap: 8px">
          <h2 style="margin: 0">目录 · {{ chapters.length }} 章</h2>
          <div class="spacer" />
          <button class="ghost" @click="refreshCatalog">刷新目录</button>
        </div>
        <input v-model="catalogFilter" placeholder="搜索章节名" style="margin: 10px 0" />
        <div class="list" style="max-height: 60vh; overflow: auto">
          <div
            v-for="(item, index) in filteredChapters"
            :key="index"
            class="list-item"
            :style="chapters.indexOf(item) === current ? 'color: var(--color-primary)' : ''"
            @click="showCatalog = false; loadChapter(chapters.indexOf(item))"
          >
            <span style="flex: 1; font-size: 14px">{{ item.title }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 书签 -->
    <div v-if="showBookmarks" class="sheet-backdrop" @click.self="showBookmarks = false">
      <div class="sheet reader-sheet" :style="{ background: theme.bg, color: theme.text }">
        <div class="sheet-handle" />
        <h2>书签</h2>
        <div v-if="!bookmarks.length" class="muted" style="font-size: 13px">这本书还没有书签。</div>
        <div v-else class="list">
          <div v-for="item in bookmarks" :key="item.id" class="list-item">
            <span style="flex: 1; font-size: 13px">第 {{ Number(item.chapterIndex) + 1 }} 章 · {{ item.chapterTitle || '未命名' }}</span>
            <button class="ghost" @click="jumpBookmark(item)">跳转</button>
            <button class="ghost" @click="removeBookmark(item)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 笔记 -->
    <div v-if="showNotes" class="sheet-backdrop" @click.self="showNotes = false">
      <div class="sheet reader-sheet" :style="{ background: theme.bg, color: theme.text }">
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

    <!-- 书源 / 线路 -->
    <div v-if="showReaderSource" class="sheet-backdrop" @click.self="showReaderSource = false">
      <div class="sheet reader-sheet" :style="{ background: theme.bg, color: theme.text }">
        <div class="sheet-handle" />
        <div class="row" style="align-items: center">
          <h2 style="margin: 0">书源 · {{ book?.name }}</h2>
          <div class="spacer" />
          <button class="ghost" @click="showReaderSource = false">关闭</button>
        </div>
        <div class="reader-source-current">
          <span>当前书源</span>
          <strong>{{ book?.originName || '书源' }}</strong>
          <small>{{ book?.origin }}</small>
        </div>
        <div v-if="readerSourceLoading" class="muted" style="padding: 12px 0">正在测速…</div>
        <div v-else-if="!readerSourceLines.length" class="muted" style="padding: 12px 0">该书源没有可切换线路。</div>
        <div v-else class="reader-line-list">
          <button
            v-for="line in readerSourceLines"
            :key="line.url"
            class="reader-line-item"
            :class="{ active: line.url === readerSourceCurrent }"
            :disabled="readerSourceBusy"
            @click="switchReaderLine(line)"
          >
            <i class="line-dot" :class="readerLineClass(line)" />
            <span>{{ line.name }}</span>
            <b :class="readerLineClass(line)">{{ line.ok && line.latency >= 0 ? line.latency + 'ms' : '超时' }}</b>
            <em v-if="line.url === readerSourceCurrent">当前</em>
          </button>
        </div>
        <div class="row" style="justify-content: flex-end; margin-top: 14px; flex-wrap: wrap">
          <button v-if="!isLocalBook" class="ghost" @click="showReaderSource = false; findSources()">换源</button>
          <button class="ghost" @click="showReaderSource = false; router.push('/sources')">书源管理</button>
          <button class="primary" @click="showReaderSource = false">完成</button>
        </div>
      </div>
    </div>

    <!-- 换源 -->
    <div v-if="showSource" class="sheet-backdrop" @click.self="showSource = false">
      <div class="sheet reader-sheet" :style="{ background: theme.bg, color: theme.text }">
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
      <div class="sheet reader-sheet" :style="{ background: theme.bg, color: theme.text }">
        <div class="sheet-handle" />
        <h2>段评 · 本章说</h2>
        <div v-if="dpLoading" class="muted">读取中…</div>
        <div v-else-if="!dpMarkers.length && !dpCards.length" class="muted" style="font-size: 13px">
          本章没有段评标记（只有起点类书源会带这类数据）。
        </div>
        <template v-else>
          <div class="list">
            <div v-for="(marker, index) in dpMarkers" :key="index" class="list-item">
              <span style="flex: 1">
                {{ Number(marker.paragraph) === -1 ? '章节名' : `第 ${Number(marker.paragraph) + 1} 段` }} · {{ marker.count }} 条
              </span>
              <button v-if="marker.count" class="ghost" @click="openDpComment(marker)">查看</button>
            </div>
          </div>
          <div v-if="dpCards.length" class="list" style="margin-top: 12px">
            <div v-for="(card, index) in dpCards" :key="index" class="list-item">
              <img :src="withImageToken(card.src)" alt="" style="max-width: 100%; border-radius: 8px" loading="lazy" />
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 段评面板 -->
    <div v-if="showDpPanel" class="sheet-backdrop" @click.self="showDpPanel = false">
      <div class="sheet reader-sheet dp-panel-sheet" :style="{ background: theme.bg, color: theme.text }">
        <div class="sheet-handle" />
        <div class="row" style="align-items: center; gap: 8px">
          <h2 style="margin: 0">{{ dpPanelTitle }}</h2>
          <div class="spacer" />
          <button class="ghost" @click="showDpPanel = false">关闭</button>
        </div>
        <div v-if="dpPanelLoading" class="muted" style="padding: 24px 0">正在加载段评…</div>
        <div v-else-if="dpPanelError && !dpComments.length && !dpPanelHtml" class="muted" style="padding: 24px 0">{{ dpPanelError }}</div>
        <template v-else>
          <iframe
            v-if="dpPanelHtml"
            class="dp-panel-iframe"
            :srcdoc="dpPanelHtml"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            title="段评面板"
          />
          <template v-else>
            <div class="dp-filter-row">
              <div class="dp-tabs">
                <button :class="{ active: dpPanelTab === 'all' }" @click="changeDpTab('all')">全部</button>
                <button :class="{ active: dpPanelTab === 'img' }" @click="changeDpTab('img')">配图</button>
                <button :class="{ active: dpPanelTab === 'audio' }" @click="changeDpTab('audio')">配音</button>
              </div>
              <select v-model="dpPanelSort" class="dp-sort" @change="loadDpComments(0)">
                <option value="default">默认排序</option>
                <option value="hot">按热度</option>
                <option value="new">按时间</option>
              </select>
            </div>
            <div v-if="dpPanelQuote" class="dp-origin-quote">
              <span>引用原文</span>
              <p>{{ dpPanelQuote }}</p>
            </div>
            <div class="dp-comment-summary">共 {{ dpPanelTotal }} 条 · 已显示 {{ dpComments.length }} 条</div>
            <div class="dp-comment-list" @scroll.passive="onDpPanelScroll">
              <div v-for="(comment, index) in dpComments" :key="comment.id || index" class="dp-comment-item">
                <div class="dp-comment-head">
                  <img
                    v-if="comment.avatar"
                    class="dp-comment-avatar"
                    :src="comment.avatar"
                    alt=""
                    referrerpolicy="no-referrer"
                    loading="lazy"
                  />
                  <span v-else class="dp-comment-avatar placeholder">👤</span>
                  <div class="dp-comment-meta">
                    <strong>{{ comment.user }}</strong>
                    <span>{{ comment.ip }} {{ formatCommentTime(comment.time) }}</span>
                  </div>
                  <span class="dp-comment-like">👍 {{ comment.agree }}</span>
                </div>
                <div v-if="comment.quote" class="dp-comment-quote">{{ comment.quote }}</div>
                <p class="dp-comment-content">{{ comment.content }}</p>
                <div v-if="comment.images?.length" class="dp-comment-images">
                  <img
                    v-for="(image, imageIndex) in comment.images"
                    :key="imageIndex"
                    :src="image"
                    alt="段评图片"
                    referrerpolicy="no-referrer"
                    loading="lazy"
                  />
                </div>
                <div v-if="comment.audio" class="dp-comment-audio-row">
                  <audio :src="comment.audio" controls preload="none" />
                  <span v-if="comment.audioTime">{{ comment.audioTime }}″</span>
                </div>
              </div>
              <div v-if="dpPanelLoadingMore" class="muted" style="padding: 10px 0; text-align: center">正在加载更多…</div>
              <div v-else-if="!dpPanelHasMore && dpComments.length" class="muted" style="padding: 10px 0; text-align: center">没有更多了</div>
            </div>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reader-shell {
  min-height: 100vh;
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 24px;
  padding: 0 96px;
  transition: background 180ms ease, color 180ms ease;
  overflow-x: hidden;
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

.rail-left {
  margin-right: auto;
}

.rail-right {
  margin-left: auto;
}

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

.rail-btn i {
  font-size: 11px;
  font-style: normal;
}

.rail-btn:hover {
  opacity: 1;
}

.rail-btn.round {
  width: 34px;
  height: 34px;
  padding: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.55);
  font-size: 15px;
  line-height: 1;
  justify-content: center;
  box-shadow: 0 1px 2px rgba(80, 60, 30, 0.12);
}

.rail-progress {
  font-size: 12px;
  opacity: 0.6;
  margin-top: 4px;
}

.rail-page {
  font-size: 10.5px;
  opacity: 0.45;
}

.reader-main {
  flex: 1;
  margin: 0 auto;
  padding-top: 84px;
  padding-bottom: 130px;
  min-height: 100vh;
  box-sizing: border-box;
  transition: max-width 180ms ease;
}

.reader-dim {
  position: fixed;
  inset: 0;
  z-index: 45;
  background: #000;
  pointer-events: none;
}

.reader-top,
.reader-bottom {
  position: fixed;
  left: 0;
  right: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: transform 220ms ease, opacity 220ms ease;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.08);
}

.reader-top {
  top: 0;
  height: 54px;
  padding: 0 10px;
  transform: translateY(-105%);
  opacity: 0;
  border-bottom: 1px solid rgba(127, 127, 127, 0.16);
}

.reader-top.visible {
  transform: translateY(0);
  opacity: 1;
}

.reader-bottom {
  bottom: 0;
  min-height: 62px;
  padding: 6px 10px calc(6px + env(safe-area-inset-bottom, 0px));
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto auto;
  gap: 8px;
  transform: translateY(105%);
  opacity: 0;
  border-top: 1px solid rgba(127, 127, 127, 0.16);
}

.reader-bottom.visible {
  transform: translateY(0);
  opacity: 1;
}

.chrome-btn {
  border: 1px solid rgba(127, 127, 127, 0.24);
  background: rgba(127, 127, 127, 0.08);
  color: inherit;
  width: 34px;
  height: 34px;
  padding: 0;
  border-radius: 50%;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  flex: none;
  display: inline-grid;
  place-items: center;
}

/* 关闭按钮用两条线画 ×，避免字体基线和字重导致图标偏心 */
.close-glyph {
  position: relative;
  display: block;
  width: 14px;
  height: 14px;
}

.close-glyph::before,
.close-glyph::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 14px;
  height: 1.5px;
  border-radius: 2px;
  background: currentColor;
  transform: translate(-50%, -50%) rotate(45deg);
}

.close-glyph::after {
  transform: translate(-50%, -50%) rotate(-45deg);
}

.chrome-btn:disabled {
  opacity: 0.4;
}

.top-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-size: 12.5px;
  opacity: 0.86;
}

.top-title strong {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.top-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.7;
}

.top-clock {
  font-size: 12px;
  opacity: 0.65;
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.reader-main {
  margin: 0 auto;
  padding-top: 84px;
  padding-bottom: 130px;
  min-height: 100vh;
  box-sizing: border-box;
  transition: max-width 180ms ease;
}

.chapter-title {
  font-weight: 600;
  text-align: center;
  margin: 4px 0 30px;
  line-height: 1.45;
}

.chapter-body p {
  margin: 0 0 var(--para-gap, 0.8em);
  text-indent: var(--text-indent, 2em);
  text-align: inherit;
  word-break: break-word;
  line-height: inherit;
}

/* 神评论 / 本章说：书源生成的 PNG/SVG 卡片，按段落位置插在正文里 */
.chapter-card {
  margin: 0 0 var(--para-gap, 0.8em);
  text-indent: 0;
}

.chapter-card img {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 10px;
  box-shadow: var(--shadow-sm);
}

.reader-loading {
  text-align: center;
  opacity: 0.5;
  padding: 80px 0;
}

.chapter-end {
  margin-top: 46px;
  text-align: center;
}

.dp-bubble {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  margin-left: 6px;
  border-radius: 999px;
  border: 1px solid rgba(120, 90, 50, 0.35);
  background: rgba(255, 255, 255, 0.55);
  color: inherit;
  font-size: 10.5px;
  line-height: 1;
  vertical-align: 1px;
  text-indent: 0;
  cursor: pointer;
}

.chapter-title .dp-bubble {
  vertical-align: 6px;
}

.dp-panel-sheet {
  max-height: 88vh;
}

.dp-comment-summary {
  font-size: 12px;
  opacity: 0.55;
  padding: 8px 0;
}

.dp-panel-iframe {
  width: 100%;
  height: 68vh;
  border: 0;
  border-radius: 12px;
  background: #fff;
}

.dp-comment-list {
  max-height: 64vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dp-comment-item {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(127, 127, 127, 0.07);
  border: 1px solid rgba(127, 127, 127, 0.14);
}

.dp-comment-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.dp-comment-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  object-fit: cover;
  flex: none;
  background: rgba(127, 127, 127, 0.12);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}

.dp-comment-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
  font-size: 12px;
}

.dp-comment-meta strong {
  font-size: 13px;
}

.dp-comment-meta span {
  opacity: 0.55;
}

.dp-comment-quote {
  font-size: 12px;
  opacity: 0.6;
  border-left: 2px solid rgba(120, 90, 50, 0.3);
  padding-left: 8px;
  margin: 6px 0 4px 38px;
}

.dp-comment-content {
  margin: 5px 0 4px 38px;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.dp-comment-like {
  font-size: 11px;
  opacity: 0.55;
  flex: none;
  margin-left: auto;
  white-space: nowrap;
}

.dp-comment-images {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 6px;
  margin: 8px 0 4px 38px;
}

.dp-comment-images img {
  width: 100%;
  max-height: 180px;
  object-fit: cover;
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.08);
}

.dp-comment-audio-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 2px 38px;
}

.dp-comment-audio-row audio {
  width: min(300px, 100%);
  height: 32px;
}

.dp-comment-audio-row span {
  font-size: 11px;
  opacity: 0.55;
}

.chapter-end-btn {
  border: 1px solid currentColor;
  background: transparent;
  color: inherit;
  border-radius: 999px;
  padding: 8px 22px;
  font-size: 13px;
  cursor: pointer;
  opacity: 0.75;
}

.bottom-btn {
  border: none;
  background: transparent;
  color: inherit;
  font-size: 13px;
  padding: 6px 4px;
  cursor: pointer;
  white-space: nowrap;
}

.bottom-btn:disabled {
  opacity: 0.35;
}

.bottom-progress {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.progress-line {
  height: 3px;
  border-radius: 999px;
  background: rgba(127, 127, 127, 0.25);
  overflow: hidden;
}

.progress-line i {
  display: block;
  height: 100%;
  background: var(--color-primary);
  transition: width 160ms ease;
}

.progress-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
}

.reader-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 380px;
  max-width: 92vw;
  z-index: 70;
  transform: translateX(105%);
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
  border-left: 1px solid rgba(127, 127, 127, 0.18);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.reader-panel.open {
  transform: translateX(0);
}

.tools-panel {
  width: 360px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(127, 127, 127, 0.16);
  flex: none;
}

.panel-head h2 {
  margin: 0;
  font-size: 16px;
}

.panel-body {
  overflow-y: auto;
  padding: 0 18px 40px;
  flex: 1;
}

.settings-sheet {
  max-height: 82vh;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.settings-head {
  padding: 0 0 10px;
  border: none;
}

.settings-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.save-btn {
  color: var(--color-primary);
  border-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
}

.check-glyph {
  display: block;
  width: 15px;
  height: 8px;
  margin-top: -3px;
  border-left: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: rotate(-45deg);
}

.settings-body {
  padding: 0;
  overflow: visible;
}

.panel-section {
  padding: 16px 0;
  border-bottom: 1px solid rgba(127, 127, 127, 0.14);
}

.panel-section h3 {
  margin: 0 0 10px;
  font-size: 13px;
  opacity: 0.7;
  font-weight: 600;
}

.panel-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  font-size: 13px;
}

.panel-row > span:first-child {
  flex: none;
  width: 72px;
  opacity: 0.75;
}

.panel-row input[type='range'] {
  flex: 1;
  accent-color: var(--color-primary);
}

.panel-row b {
  width: 48px;
  text-align: right;
  font-weight: 500;
  font-size: 12px;
  opacity: 0.7;
}

.panel-row input[type='checkbox'] {
  width: auto;
  accent-color: var(--color-primary);
}

.panel-row select {
  flex: 1;
  min-width: 0;
}

.step-btn {
  border: 1px solid rgba(127, 127, 127, 0.3);
  background: transparent;
  color: inherit;
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 13px;
  cursor: pointer;
}

.segmented {
  display: flex;
  gap: 6px;
  margin: 4px 0 10px;
}

.segmented button {
  flex: 1;
  padding: 7px 6px;
  border-radius: 8px;
  border: 1px solid rgba(127, 127, 127, 0.24);
  background: transparent;
  color: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.segmented button.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

.segmented.small button {
  padding: 5px 8px;
  font-size: 12px;
  white-space: nowrap;
}

.reader-panel select,
.reader-panel input:not([type='range']):not([type='checkbox']) {
  background: rgba(127, 127, 127, 0.12);
  color: inherit;
  border: 1px solid rgba(127, 127, 127, 0.24);
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 13px;
  outline: none;
}

.swatches {
  display: flex;
  gap: 8px;
  margin: 6px 0 4px;
}

.theme-swatch {
  flex: 1;
  height: 44px;
  border-radius: 10px;
  border: 1px solid rgba(127, 127, 127, 0.25);
  cursor: pointer;
  font-size: 12px;
}

.theme-swatch.active {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 6px;
}

.panel-actions button,
.tts-actions button {
  border: 1px solid rgba(127, 127, 127, 0.28);
  background: transparent;
  color: inherit;
  border-radius: 8px;
  padding: 7px 12px;
  font-size: 12.5px;
  cursor: pointer;
}

.panel-actions button:disabled {
  opacity: 0.45;
}

.tts-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 6px;
}

.panel-backdrop {
  position: fixed;
  inset: 0;
  z-index: 65;
  background: rgba(0, 0, 0, 0.25);
}

.search-bar {
  position: fixed;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.96);
  color: #333;
  padding: 8px 12px;
  border-radius: 999px;
  box-shadow: 0 6px 20px rgba(60, 40, 20, 0.18);
  z-index: 80;
}

.search-bar input {
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  min-width: 180px;
  color: #333;
}

.search-count {
  font-size: 12px;
  opacity: 0.6;
}

.reader-sheet .list-item {
  background: rgba(127, 127, 127, 0.07);
  border-color: rgba(127, 127, 127, 0.16);
}

.chapter-body {
  transition: font-size 140ms ease, line-height 140ms ease;
}

.fade-next,
.fade-prev {
  animation: reader-fade 220ms ease;
}

.slide-next {
  animation: reader-slide-next 260ms ease;
}

.slide-prev {
  animation: reader-slide-prev 260ms ease;
}

@keyframes reader-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes reader-slide-next {
  from { opacity: 0; transform: translateX(18px); }
  to { opacity: 1; transform: none; }
}

@keyframes reader-slide-prev {
  from { opacity: 0; transform: translateX(-18px); }
  to { opacity: 1; transform: none; }
}

/* 两侧功能区固定在正文左右：左栏贴顶、右栏贴底 */
.reader-shell {
  display: block;
  padding: 0;
}

.rail {
  position: fixed;
  top: 16px;
  left: calc(50% - var(--reader-half, 380px) - 88px);
  height: auto;
  width: 62px;
  padding: 10px 6px;
  gap: 6px;
  background: color-mix(in srgb, var(--reader-bg, #f3e9d2) 88%, white);
  border: 1px solid rgba(120, 90, 50, 0.12);
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(80, 60, 30, 0.1);
  z-index: 30;
}

.rail-left {
  margin: 0;
}

.rail-right {
  top: auto;
  bottom: 16px;
  left: auto;
  right: calc(50% - var(--reader-half, 380px) - 88px);
  margin: 0;
}

.reader-main {
  margin: 0 auto;
}

.rail-btn.round {
  background: rgba(255, 255, 255, 0.7);
}

@media (max-width: 900px) {
  .reader-shell {
    padding: 0 6px;
    gap: 0;
  }

  .rail {
    position: fixed;
    top: auto;
    bottom: 12px;
    height: auto;
    width: auto;
    flex-direction: row;
    padding: 8px 10px;
    gap: 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--reader-bg, #f3e9d2) 92%, transparent);
    box-shadow: 0 6px 18px rgba(60, 40, 20, 0.18);
    z-index: 20;
  }

  .rail-left {
    left: 8px;
    bottom: 10px;
    padding: 6px 8px;
    margin: 0;
  }

  .rail-right {
    left: 8px;
    right: 8px;
    bottom: 62px;
    padding: 6px 6px;
    gap: 2px;
    max-width: none;
    flex-wrap: nowrap;
    justify-content: flex-start;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .rail-right::-webkit-scrollbar {
    display: none;
  }

  .rail-left .rail-btn i {
    display: none;
  }

  .rail-right .rail-btn.round {
    width: 30px;
    height: 30px;
    font-size: 13px;
  }

  .rail-progress,
  .rail-page {
    display: none;
  }

  .reader-main {
    padding-top: 30px !important;
    padding-bottom: 185px !important;
  }

  .chapter-title {
    margin-bottom: 22px;
  }

  .reader-panel {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    max-width: 100vw;
    max-height: 84vh;
    border-left: none;
    border-top: 1px solid rgba(127, 127, 127, 0.2);
    border-radius: 18px 18px 0 0;
    transform: translateY(105%);
  }

  .reader-panel.open {
    transform: translateY(0);
  }

  .reader-panel .panel-body {
    padding-bottom: 60px;
  }
}

/* ───────── 手机阅读器：浮动控制条（点中间唤出，4 秒后自动收起） ───────── */
.m-topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: calc(env(safe-area-inset-top, 0px) + 6px) 12px 8px;
  background: color-mix(in srgb, var(--reader-bg, #f3e9d2) 90%, transparent);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(127, 127, 127, 0.14);
  transform: translateY(-105%);
  transition: transform 0.22s ease;
}

.m-topbar.shown {
  transform: translateY(0);
}

.m-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.m-title strong,
.m-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.m-title strong {
  font-size: 14px;
}

.m-title span {
  font-size: 11.5px;
  opacity: 0.62;
}

.m-icon {
  width: 34px;
  height: 34px;
  flex: none;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 20px;
  line-height: 1;
}

.m-bottombar {
  position: fixed;
  left: 10px;
  right: 10px;
  z-index: 40;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 10px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 8px;
  border-radius: 22px;
  background: color-mix(in srgb, var(--reader-bg, #f3e9d2) 94%, transparent);
  box-shadow: 0 10px 30px rgba(60, 40, 20, 0.22);
  backdrop-filter: blur(16px);
  opacity: 0;
  transform: translateY(140%);
  transition: transform 0.22s ease, opacity 0.22s ease;
}

.m-bottombar.shown {
  opacity: 1;
  transform: translateY(0);
}

.m-bottombar button {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 10.5px;
  opacity: 0.92;
}

.m-bottombar button i {
  font-size: 17px;
  font-style: normal;
  line-height: 1;
}

.m-bottombar .m-progress strong {
  font-size: 14px;
}

.m-bottombar .m-progress span {
  font-size: 10px;
  opacity: 0.6;
}

@media (max-width: 760px) {
  .rail {
    display: none !important;
  }

  .reader-main {
    padding-top: 64px !important;
    padding-bottom: 118px !important;
  }
}
</style>
