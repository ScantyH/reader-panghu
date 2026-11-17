<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import BookDetail from '../components/BookDetail.vue'
import { api, coverOf } from '../api.js'

const props = defineProps({ recentOnly: { type: Boolean, default: false } })

const router = useRouter()
const books = ref([])
const groups = ref([])
const activeGroup = ref(0)
const loading = ref(false)
const editing = ref(null)
const showGroups = ref(false)
const newGroupName = ref('')
const fileInput = ref(null)
const actionBook = ref(null)
const pressing = ref('')
const layout = ref(localStorage.getItem('shelfLayout') || 'cover')
const infoBook = ref(null)
const selectMode = ref(false)
const selected = ref([])
const moveTarget = ref('0')
let pressTimer = 0

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

async function refreshCache() {
  const targets = visible.value.slice(0, 5)
  if (!targets.length) return
  window.__toast?.(`正在刷新前 ${targets.length} 本的缓存…`)
  for (const book of targets) await api.cacheBook(book.bookUrl, 20, true).catch(() => {})
  await load()
  window.__toast?.('缓存已刷新')
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
  return [...list].sort((a, b) => Number(b.durChapterTime || 0) - Number(a.durChapterTime || 0))
})

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

async function addGroup() {
  const name = newGroupName.value.trim()
  if (!name) return
  try {
    await api.saveBookGroup({ groupId: Date.now() % 100000, groupName: name })
    newGroupName.value = ''
    showGroups.value = false
    await load()
    window.__toast?.('分组已创建')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function renameGroup(group) {
  const name = prompt('新的分组名', group.groupName)
  if (!name || name === group.groupName) return
  try {
    await api.saveBookGroup({ groupId: group.groupId, groupName: name, orderNo: group.orderNo || 0 })
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function removeGroup(group) {
  if (!confirm('删除分组「' + group.groupName + '」？组内书籍会回到"全部"，不会被删除')) return
  try {
    await api.deleteBookGroup(group.groupId)
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function checkUpdates() {
  try {
    const started = await api.checkChapterUpdates()
    if (!started.started) {
      window.__toast?.(started.reason === 'already-running' ? '已有检查在进行中' : '书架里还没有连载书')
      return
    }
    window.__toast?.(`正在检查 ${started.total} 本…`)
    for (let round = 0; round < 160; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const status = await api.chapterUpdateStatus()
      if (status.running) continue
      await load()
      const count = status.updatedBooks?.length || 0
      window.__toast?.(count ? `${count} 本有新章节` : '暂无更新')
      return
    }
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function importBook(event) {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    const book = await api.uploadLocal(file)
    window.__toast?.(`已加入《${book.name}》`)
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    event.target.value = ''
  }
}

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

/** X 天前更新 */
function updatedAgo(book) {
  const stamp = Number(book.lastCheckTime || 0) || Number(book.durChapterTime || 0)
  if (!stamp) return '暂无更新记录'
  const days = Math.floor((Date.now() - stamp) / 86400000)
  if (days <= 0) return '今天更新'
  if (days === 1) return '昨天更新'
  if (days < 30) return days + ' 天前更新'
  return Math.floor(days / 30) + ' 个月前更新'
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

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
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

    <div class="row shelf-toolbar">
      <input ref="fileInput" type="file" accept=".txt,.epub,.docx,.mobi,.azw3,.azw,.pdf" hidden @change="importBook" />
      <button class="ghost" @click="selectMode = !selectMode; selected = []">{{ selectMode ? '取消选择' : '管理' }}</button>
      <router-link class="ghost" to="/warehouse" style="padding: 8px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md)">书仓</router-link>
      <router-link class="ghost" to="/bookmarks" style="padding: 8px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md)">书签</router-link>
      <router-link class="ghost" to="/replace" style="padding: 8px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md)">替换规则</router-link>
      <router-link class="ghost" to="/cache" style="padding: 8px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md)">缓存</router-link>
      <router-link class="ghost" to="/users" style="padding: 8px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md)">账号</router-link>
      <router-link class="ghost" to="/stats" style="padding: 8px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md)">统计</router-link>
      <button class="ghost" @click="checkUpdates">检查更新</button>
      <button class="ghost" @click="refreshCache">刷新缓存</button>
      <button class="primary" @click="fileInput.click()">导入</button>
    </div>

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
      <button class="group-tab" @click="showGroups = true">管理</button>
    </div>

    <div v-if="!visible.length" class="empty">
      书架还是空的。去「搜索」找书，或点右上角「导入」加一本本地书。
    </div>

    <div v-if="selectMode" class="row" style="margin-bottom: 12px; flex-wrap: wrap">
      <span class="badge">已选 {{ selected.length }} 本</span>
      <div class="spacer" />
      <select v-model="moveTarget" style="max-width: 160px">
        <option v-for="group in groups" :key="group.groupId" :value="group.groupId">{{ group.groupName }}</option>
      </select>
      <button :disabled="!selected.length" @click="batchMove">移动到分组</button>
      <button :disabled="!selected.length" @click="batchDelete">删除选中</button>
    </div>

    <div class="shelf" :class="'mode-' + layout">
      <article
        v-for="book in visible"
        :key="book.bookUrl"
        class="shelf-card"
        :class="{ selected: selected.includes(book.bookUrl), 'is-select': selectMode }"
        @click="selectMode ? toggleSelect(book.bookUrl) : layout === 'cover' ? (infoBook = book) : open(book)"
        @contextmenu.prevent="actionBook = book"
      >
        <div class="shelf-cover">
          <img v-if="coverOf(book)" :src="coverOf(book)" :alt="book.name" loading="lazy" />
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
          <p class="shelf-author">{{ book.author || '未知作者' }}</p>
          <p class="shelf-meta">
            <span>{{ book.totalChapterNum || 0 }} 章</span>
            <span class="dot">·</span>
            <span>{{ updatedAgo(book) }}</span>
          </p>
          <p class="shelf-latest">{{ book.latestChapterTitle || book.durChapterTitle || '还没有章节信息' }}</p>
          <p v-if="layout === 'list' && book.intro" class="shelf-intro">{{ book.intro }}</p>
          <p v-if="layout === 'list'" class="shelf-tags">
            <span class="chip">{{ groupName(book) }}</span>
            <span v-if="book.kind" class="chip">{{ book.kind }}</span>
          </p>
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
            <img v-if="coverOf(infoBook)" :src="coverOf(infoBook)" :alt="infoBook.name" />
            <div v-else class="placeholder">{{ infoBook.name }}</div>
          </div>
          <div class="info-meta">
            <h2>{{ infoBook.name }}</h2>
            <p class="muted">{{ infoBook.author || '未知作者' }}</p>
            <p class="shelf-meta">
              <span>{{ updatedAgo(infoBook) }}：{{ infoBook.totalChapterNum || 0 }} 章：{{ latestName(infoBook) }}</span>
            </p>
            <p class="muted" style="font-size: 12px">阅读进度：{{ progressOf(infoBook) }}%</p>
          </div>
        </div>
        <div class="info-group">
          <span class="muted" style="font-size: 12px">分组</span>
          <select :value="Number(infoBook.group || 0)" @change="changeGroup(infoBook, $event.target.value)">
            <option v-for="group in groups" :key="group.groupId" :value="group.groupId">{{ group.groupName }}</option>
          </select>
        </div>
        <h3 class="info-subtitle">简介</h3>
        <p class="info-intro">{{ infoBook.intro || '（没有简介）' }}</p>
        <div class="row" style="gap: 8px; margin-top: 16px">
          <button class="primary" style="flex: 1" @click="infoBook = null; open(infoBook)">继续阅读</button>
          <button class="ghost" @click="actionBook = infoBook; infoBook = null">更多</button>
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

    <div v-if="showGroups" class="sheet-backdrop" @click.self="showGroups = false">
      <div class="sheet">
        <div class="sheet-handle" />
        <h2>分组管理</h2>
        <div class="row" style="margin-bottom: 16px">
          <input v-model="newGroupName" placeholder="新分组名称" @keyup.enter="addGroup" />
          <button class="primary" @click="addGroup">新建</button>
        </div>
        <div class="list">
          <div v-for="group in tabs.filter((item) => item.groupId !== 0)" :key="group.groupId" class="list-item">
            <span style="flex: 1">{{ group.groupName }}</span>
            <span class="badge">{{ books.filter((book) => Number(book.group || 0) === group.groupId).length }} 本</span>
            <button class="ghost" @click="renameGroup(group)">改名</button>
            <button class="ghost" @click="removeGroup(group)">删除</button>
          </div>
          <div v-if="!tabs.filter((item) => item.groupId !== 0).length" class="muted" style="font-size: 13px">还没有分组</div>
        </div>
      </div>
    </div>
  </div>
</template>
