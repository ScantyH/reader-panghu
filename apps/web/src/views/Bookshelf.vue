<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BookDetail from '../components/BookDetail.vue'
import { api, coverOf } from '../api.js'

const props = defineProps({ recentOnly: { type: Boolean, default: false } })

const route = useRoute()
const router = useRouter()
const books = ref([])
const groups = ref([])
const activeGroup = ref(0)
const loading = ref(false)
const editing = ref(null)
const actionBook = ref(null)
const pressing = ref('')
const layout = ref(localStorage.getItem('shelfLayout') || 'cover')
const infoBook = ref(null)
const selectMode = ref(route.query.manage === '1')
const selected = ref([])
const moveTarget = ref('0')
const isMobile = ref(false)
/** 封面加载失败的书，回退成书名占位，避免显示破图 */
const brokenCovers = reactive(new Set())
let pressTimer = 0

// 从设置里的「批量管理」进来时带 ?manage=1；点底栏「书架」回到普通模式
watch(
  () => route.query.manage,
  (value) => {
    selectMode.value = value === '1'
    if (!selectMode.value) selected.value = []
  },
)

function exitSelect() {
  selectMode.value = false
  selected.value = []
}

function setLayout(next) {
  layout.value = next
  localStorage.setItem('shelfLayout', next)
}

function toggleSelect(bookUrl) {
  selected.value = selected.value.includes(bookUrl)
    ? selected.value.filter((item) => item !== bookUrl)
    : [...selected.value, bookUrl]
}

async function batchDelete() {
  if (!selected.value.length) return
  if (!confirm(`从书架删除选中的 ${selected.value.length} 本？`)) return
  try {
    await api.deleteBooks(selected.value.map((bookUrl) => ({ bookUrl })))
    selected.value = []
    selectMode.value = false
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function batchMove() {
  if (!selected.value.length) return
  try {
    for (const bookUrl of selected.value) await api.saveBookGroupId(bookUrl, Number(moveTarget.value))
    window.__toast?.(`已移动 ${selected.value.length} 本`)
    selected.value = []
    selectMode.value = false
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/** 长按卡片弹出操作菜单（移动端 500ms，桌面端同样可用）。 */
function startPress(book) {
  pressing.value = book.bookUrl
  clearTimeout(pressTimer)
  pressTimer = setTimeout(() => {
    actionBook.value = book
    pressing.value = ''
  }, 500)
}

function cancelPress() {
  clearTimeout(pressTimer)
  pressing.value = ''
}

function runAction(action) {
  const book = actionBook.value
  actionBook.value = null
  if (!book) return
  if (action === 'edit') editing.value = { ...book }
  else if (action === 'cache') cache(book)
  else if (action === 'delete') remove(book)
}

const visible = computed(() => {
  let list = books.value
  if (props.recentOnly) list = list.filter((book) => Number(book.durChapterTime) > 0)
  else if (activeGroup.value) list = list.filter((book) => Number(book.group || 0) === activeGroup.value)
  // 最近阅读优先；没读过的用最近检查时间、书名兜底，保证同一屏内顺序稳定。
  // 渲染顺序即 DOM 顺序，封面/网格模式按从左到右、从上到下排列。
  return [...list].sort((a, b) => {
    const byRead = Number(b.durChapterTime || 0) - Number(a.durChapterTime || 0)
    if (byRead) return byRead
    const byCheck = Number(b.lastCheckTime || 0) - Number(a.lastCheckTime || 0)
    if (byCheck) return byCheck
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN')
  })
})

const groupOptions = computed(() => {
  const rest = groups.value.filter((group) => Number(group.groupId) !== 0)
  return [{ groupId: 0, groupName: '未分组' }, ...rest]
})

/** 手机「继续阅读」卡片：优先最近读过的一本 */
const continueBook = computed(() => {
  const read = visible.value.filter((book) => Number(book.durChapterTime) > 0)
  return read[0] || visible.value[0] || null
})

function updateMobile() {
  isMobile.value = window.innerWidth <= 760
}

const tabs = computed(() => groups.value.filter((group) => group.groupId !== 0 || groups.value.length === 1))

const unread = (book) => {
  const total = Number(book.totalChapterNum || 0)
  if (!total) return 0
  const read = Number(book.durChapterIndex || 0) + 1
  return total > read ? total - read : 0
}

const progressOf = (book) => {
  const total = Number(book.totalChapterNum || 0)
  if (!total) return 0
  return Math.min(100, Math.round(((Number(book.durChapterIndex || 0) + 1) / total) * 100))
}

async function load() {
  loading.value = true
  try {
    const [shelf, groupList] = await Promise.all([api.bookshelf(), api.groups()])
    books.value = shelf
    groups.value = groupList
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

const open = (book) => router.push({ path: '/read', query: { book: book.bookUrl } })

async function cache(book) {
  try {
    window.__toast?.(`正在缓存《${book.name}》…`)
    const result = await api.cacheBook(book.bookUrl, 20)
    window.__toast?.(`已缓存 ${result.cached} 章（累计 ${result.totalCached} 章）`)
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function saveEdited(book) {
  try {
    await api.saveBook(book)
    editing.value = null
    window.__toast?.('已保存')
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function remove(book) {
  if (!confirm(`从书架删除《${book.name}》？`)) return
  try {
    await api.deleteBooks([{ bookUrl: book.bookUrl }])
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/** X 天前：卡片第四行用，信息弹层也共用 */
function updatedAgo(book) {
  const stamp = Number(book.lastCheckTime || 0) || Number(book.durChapterTime || 0)
  if (!stamp) return '暂无记录'
  const days = Math.floor((Date.now() - stamp) / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 365) return days + ' 天前'
  return Math.floor(days / 365) + ' 年前'
}

/** 第三行：已读章节名称；没读过返回空串，但模板会保留这一行的高度 */
function readText(book) {
  const read = Number(book.durChapterIndex) || 0
  if (!(Number(book.durChapterTime) > 0 || read > 0)) return ''
  const title = String(book.durChapterTitle || '').trim()
  return `已读：${title || `第 ${read + 1} 章`}`
}

/** 分组名 */
function groupName(book) {
  const group = tabs.value.find((item) => item.groupId === Number(book.group || 0))
  return group?.groupName || '未分组'
}

/** 未读章节数，超过 99 显示 99+ */
function unreadCount(book) {
  const total = Number(book.totalChapterNum || 0)
  const read = Number(book.durChapterIndex || 0)
  if (!total) return ''
  const left = Math.max(0, total - read - 1)
  if (!left) return ''
  return left > 99 ? '99+' : String(left)
}

/** 最新章节名：优先书架记录的，其次当前进度章节 */
/** 打开详情：最新章节缺失时抓一次目录补上 */
async function openInfo(book) {
  infoBook.value = book
  if (String(book.latestChapterTitle || '').trim()) return
  try {
    const chapters = await api.chapterList({
      bookUrl: book.bookUrl,
      tocUrl: book.tocUrl,
      bookSourceUrl: book.origin,
    })
    const last = Array.isArray(chapters) && chapters.length ? chapters[chapters.length - 1] : null
    if (!last?.title) return
    book.latestChapterTitle = last.title
    api.saveBook({ ...book, latestChapterTitle: last.title }).catch(() => {})
  } catch {
    /* 抓不到就保持 — */
  }
}

function latestName(book) {
  const name = String(book?.latestChapterTitle || '').trim()
  if (name) return name
  const fallback = String(book?.durChapterTitle || '').trim()
  return fallback || '—'
}

/** 在详情里直接改分组 */
async function changeGroup(book, groupId) {
  try {
    await api.saveBookGroupId(book.bookUrl, Number(groupId))
    book.group = Number(groupId)
    const target = groups.value.find((item) => item.groupId === Number(groupId))
    window.__toast?.('已移动到「' + (target?.groupName || '未分组') + '」')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/** 详情里点「继续阅读」：先记住书，再关弹层，否则会拿到 null */
function continueReading(book) {
  const target = book
  infoBook.value = null
  open(target)
}

/** 详情里点「更多」 */
function openMore(book) {
  const target = book
  infoBook.value = null
  actionBook.value = target
}

onMounted(() => {
  updateMobile()
  window.addEventListener('resize', updateMobile)
  load()
})

onBeforeUnmount(() => window.removeEventListener('resize', updateMobile))
</script>

<template>
  <div>
    <div class="page-head shelf-head">
      <h1>{{ recentOnly ? '最近阅读' : '书架' }}</h1>
      <span class="badge">{{ visible.length }} 本</span>
      <div class="spacer" />
      <div class="layout-toggle" role="group" aria-label="布局切换">
        <button :class="{ active: layout === 'cover' }" title="封面模式" aria-label="封面模式" @click="setLayout('cover')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="2.5" /></svg>
        </button>
        <button :class="{ active: layout === 'grid' }" title="网格模式" aria-label="网格模式" @click="setLayout('grid')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.8" /><rect x="13" y="4" width="7" height="7" rx="1.8" /><rect x="4" y="13" width="7" height="7" rx="1.8" /><rect x="13" y="13" width="7" height="7" rx="1.8" /></svg>
        </button>
        <button :class="{ active: layout === 'list' }" title="横向模式" aria-label="横向模式" @click="setLayout('list')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="5" height="14" rx="1.6" /><rect x="12" y="6.5" width="8" height="2.2" rx="1.1" /><rect x="12" y="11" width="8" height="2.2" rx="1.1" /><rect x="12" y="15.5" width="5" height="2.2" rx="1.1" /></svg>
        </button>
      </div>
    </div>

    <!-- 手机：继续阅读卡片 + 全部书籍 -->
    <template v-if="isMobile">
      <section v-if="continueBook" class="m-continue" @click="open(continueBook)">
        <div class="m-continue-main">
          <h2>{{ continueBook.name }}</h2>
          <p class="m-author">{{ continueBook.author || '未知作者' }}</p>
          <p class="m-chapter">第 {{ Number(continueBook.durChapterIndex || 0) + 1 }} 章 · 共 {{ continueBook.totalChapterNum || 0 }} 章</p>
          <div class="m-bar" :style="{ '--value': progressOf(continueBook) + '%' }">
            <i />
            <span>{{ progressOf(continueBook) }}%</span>
          </div>
          <button class="m-continue-btn" @click.stop="open(continueBook)">继续阅读 →</button>
        </div>
        <img
          v-if="coverOf(continueBook)"
          class="m-continue-cover"
          :src="coverOf(continueBook)"
          :alt="continueBook.name"
        />
      </section>

      <div class="m-section-head">
        <h2>全部书籍</h2>
        <span class="m-count">{{ visible.length }} 本</span>
        <div class="m-layout">
          <button :class="{ active: layout === 'cover' }" aria-label="封面" @click="setLayout('cover')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="5" y="3.5" width="14" height="17" rx="3" />
            </svg>
          </button>
          <button :class="{ active: layout === 'list' }" aria-label="列表" @click="setLayout('list')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          </button>
        </div>
      </div>
    </template>

    <div v-if="!recentOnly" class="group-tabs">
      <button class="group-tab" :class="{ active: activeGroup === 0 }" @click="activeGroup = 0">全部</button>
      <button
        v-for="group in tabs.filter((item) => item.groupId !== 0)"
        :key="group.groupId"
        class="group-tab"
        :class="{ active: activeGroup === group.groupId }"
        @click="activeGroup = group.groupId"
      >
        {{ group.groupName }}
      </button>
    </div>

    <div v-if="!visible.length" class="empty">
      书架还是空的。去「设置 → 书架 → 导入本地书」加一本，或去「搜索」找书。
    </div>

    <div v-if="selectMode" class="row" style="margin-bottom: 12px; flex-wrap: wrap">
      <span class="badge">已选 {{ selected.length }} 本</span>
      <div class="spacer" />
      <select v-model="moveTarget" style="max-width: 160px">
        <option v-for="group in groupOptions" :key="group.groupId" :value="Number(group.groupId)">{{ group.groupName }}</option>
      </select>
      <button :disabled="!selected.length" @click="batchMove">移动到分组</button>
      <button :disabled="!selected.length" @click="batchDelete">删除选中</button>
      <button class="ghost" @click="exitSelect">退出管理</button>
    </div>

    <div class="shelf" :class="'mode-' + layout">
      <article
        v-for="book in visible"
        :key="book.bookUrl"
        class="shelf-card"
        :class="{ selected: selected.includes(book.bookUrl), 'is-select': selectMode }"
        @click="selectMode ? toggleSelect(book.bookUrl) : layout === 'cover' ? openInfo(book) : open(book)"
        @contextmenu.prevent="actionBook = book"
      >
        <div class="shelf-cover">
          <img
            v-if="coverOf(book) && !brokenCovers.has(book.bookUrl)"
            :src="coverOf(book)"
            :alt="book.name"
            loading="lazy"
            @error="brokenCovers.add(book.bookUrl)"
          />
          <div v-else class="placeholder">{{ book.name }}</div>
          <div v-if="progressOf(book)" class="progress"><i :style="{ width: progressOf(book) + '%' }" /></div>
          <span v-if="unreadCount(book)" class="unread-badge">{{ unreadCount(book) }}</span>
          <button class="card-more" title="更多操作" aria-label="更多操作" @click.stop="actionBook = book">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
        </div>

        <div v-if="layout !== 'cover'" class="shelf-info">
          <h3 class="shelf-title">{{ book.name }}</h3>
          <p class="shelf-line">{{ book.author || '未知作者' }} · 共 {{ book.totalChapterNum || 0 }} 章</p>
          <p class="shelf-line shelf-read">{{ readText(book) }}</p>
          <p class="shelf-line">{{ updatedAgo(book) }}：{{ latestName(book) }}</p>
          <p class="shelf-line shelf-intro">{{ book.intro || '' }}</p>
        </div>
        <!-- 手机封面模式：书名 / 作者 / 进度 -->
        <h3 v-else class="shelf-cover-title">{{ book.name }}</h3>
        <p v-if="layout === 'cover'" class="shelf-cover-author">{{ book.author || '未知作者' }}</p>
        <div
          v-if="layout === 'cover' && progressOf(book)"
          class="shelf-card-progress"
          :style="{ '--value': progressOf(book) + '%' }"
        >
          <i />
          <span>已读 {{ progressOf(book) }}%</span>
        </div>
      </article>
    </div>

    <BookDetail v-if="editing" :book="editing" :groups="groups" mode="shelf" @close="editing = null" @save="saveEdited" />

    <!-- 书籍信息 -->
    <div v-if="infoBook" class="sheet-backdrop" @click.self="infoBook = null">
      <div class="sheet">
        <div class="sheet-handle" />
        <div class="info-head">
          <div class="info-cover">
            <img
              v-if="coverOf(infoBook) && !brokenCovers.has(infoBook.bookUrl)"
              :src="coverOf(infoBook)"
              :alt="infoBook.name"
              @error="brokenCovers.add(infoBook.bookUrl)"
            />
            <div v-else class="placeholder">{{ infoBook.name }}</div>
          </div>
          <div class="info-meta">
            <h2>{{ infoBook.name }}</h2>
            <p class="info-line">{{ infoBook.author || '未知作者' }} · 共 {{ infoBook.totalChapterNum || 0 }} 章</p>
            <p class="info-line info-read">{{ readText(infoBook) }}</p>
            <p class="info-line">{{ updatedAgo(infoBook) }}：{{ latestName(infoBook) }}</p>
          </div>
        </div>
        <p class="info-intro">{{ infoBook.intro || '（没有简介）' }}</p>
        <div class="info-group" style="margin-top: 14px">
          <span class="muted" style="font-size: 12px">分组</span>
          <select :value="Number(infoBook.group || 0)" @change="changeGroup(infoBook, $event.target.value)">
            <option v-for="group in groups" :key="group.groupId" :value="group.groupId">{{ group.groupName }}</option>
          </select>
        </div>
        <div class="row" style="gap: 8px; margin-top: 16px">
          <button class="primary" style="flex: 1" @click="continueReading(infoBook)">继续阅读</button>
          <button class="ghost" @click="openMore(infoBook)">更多</button>
        </div>
      </div>
    </div>

    <!-- 长按操作菜单 -->
    <div v-if="actionBook" class="sheet-backdrop" @click.self="actionBook = null">
      <div class="sheet">
        <div class="sheet-handle" />
        <div class="row" style="margin-bottom: 12px">
          <div style="flex: 1; min-width: 0">
            <strong>{{ actionBook.name }}</strong>
            <div class="muted" style="font-size: 12.5px">{{ actionBook.author || '未知作者' }}</div>
          </div>
        </div>
        <button class="action-sheet-item" @click="runAction('edit')">✏️ 编辑信息与封面</button>
        <button class="action-sheet-item" @click="runAction('cache')">⬇️ 缓存前 20 章</button>
        <button class="action-sheet-item danger" @click="runAction('delete')">🗑️ 从书架删除</button>
      </div>
    </div>
  </div>
</template>
