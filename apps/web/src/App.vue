<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, coverOf, isNativeApp, setToken } from './api.js'
import { desktopNavLayout } from './use-layout.js'

const route = useRoute()
const router = useRouter()
const isBookshelfPath = () => window.location.pathname.startsWith('/bookshelf')
const layoutRouteName = ref(isBookshelfPath() ? 'bookshelf' : route.name)

function syncLayoutRoute() {
  layoutRouteName.value = isBookshelfPath() ? 'bookshelf' : route.name
}
const toast = ref('')
const headerQuery = ref('')
const searchReadonly = ref(true)
const appVersion = __APP_VERSION__
const isMobile = ref(false)
let timer = 0

/** 子页面的上一级菜单：返回按钮据此显示上一级名称 */
const PARENTS = {
  warehouse: { label: '书架管理', to: '/settings/shelf' },
  bookmarks: { label: '书架管理', to: '/settings/shelf' },
  cache: { label: '书架管理', to: '/settings/shelf' },
  replace: { label: '书架管理', to: '/settings/shelf' },
  webdav: { label: '数据管理', to: '/settings/data' },
  users: { label: '账号管理', to: '/settings/account' },
  rss: { label: '书源', to: '/sources' },
  'book-detail': { label: '书架', to: '/bookshelf' },
}
const parent = computed(() => PARENTS[route.name] || null)
const goParent = () => {
  if (parent.value) router.push(parent.value.to)
}

/** 任何视图都可以用 window.__toast('...') 弹一条短提示。 */
window.__toast = (message) => {
  toast.value = String(message)
  clearTimeout(timer)
  timer = setTimeout(() => (toast.value = ''), 2600)
}

const isReader = () => route.name === 'reader'
const isLogin = () => route.name === 'login'
const authUser = ref('')
const authOn = ref(false)
const authAvatar = ref('')
const authRole = ref('')
const userInfoOpen = ref(false)
const sidebarBooks = ref([])

const showLeftNav = computed(() => !isMobile.value && desktopNavLayout.value === 'left')

/** 子页面归属哪个主栏目，保证在子页面时主栏目标签始终高亮 */
const activeNav = computed(() => {
  const path = route.path || ''
  if (path.startsWith('/settings') || path.startsWith('/warehouse') || path.startsWith('/bookmarks') || path.startsWith('/cache') || path.startsWith('/replace') || path.startsWith('/webdav') || path.startsWith('/users')) return '/settings'
  if (path.startsWith('/backup')) return NAV.some((item) => item.to === '/backup') ? '/backup' : '/settings'
  if (path.startsWith('/book/') || path.startsWith('/recent') || path.startsWith('/bookshelf')) return '/bookshelf'
  if (path.startsWith('/sources') || path.startsWith('/rss')) return '/sources'
  if (path.startsWith('/search')) return '/search'
  if (path.startsWith('/stats')) return '/stats'
  return ''
})

async function loadSidebarBooks() {
  try {
    const list = await api.bookshelf()
    sidebarBooks.value = [...list]
      .sort((a, b) => Number(b.durChapterTime || 0) - Number(a.durChapterTime || 0))
      .slice(0, 3)
  } catch {
    sidebarBooks.value = []
  }
}

async function loadAuth() {
  try {
    const info = await api.getUserInfo()
    authOn.value = Boolean(info?.authEnabled)
    authUser.value = info?.username || ''
    authAvatar.value = info?.avatar || ''
    authRole.value = info?.role || ''
  } catch {
    authOn.value = true
    authUser.value = ''
  }
}

async function logout() {
  await api.logout().catch(() => {})
  setToken('')
  authUser.value = ''
  location.href = '/login'
}
// 顶部搜索框在所有页面都显示（阅读页与登录页除外）
const showHeaderSearch = () => !isReader() && !isLogin()

function submitSearch() {
  const q = headerQuery.value.trim()
  if (!q) return
  router.push({ path: '/search', query: { q } })
}

const NAV = [
  { to: '/bookshelf', label: '书架', icon: '📚' },
  { to: '/search', label: '搜索', icon: '🔍' },
  { to: '/sources', label: '书源', icon: '🔗' },
  { to: '/stats', label: '统计', icon: '📊' },
  { to: '/settings', label: '设置', icon: '⚙️' },
]

const ICONS = {
  shelf:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.2C9.8 4.6 7.2 4 4.5 4v14.2c2.7 0 5.3.6 7.5 2.2 2.2-1.6 4.8-2.2 7.5-2.2V4c-2.7 0-5.3.6-7.5 2.2Z"/><path d="M12 6.2v14.2"/></svg>',
  compass:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.4"/><path d="m15.2 8.8-2 4.4-4.4 2 2-4.4 4.4-2Z"/></svg>',
  chart:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 19V11"/><path d="M12 19V5"/><path d="M19 19v-5"/></svg>',
  person:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.4" r="3.6"/><path d="M4.8 19.4c1.1-3.2 3.8-5 7.2-5s6.1 1.8 7.2 5"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.4"/><path d="m16 16 3.4 3.4"/></svg>',
  more:
    '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/></svg>',
}

const NAV_MOBILE = [
  { to: '/bookshelf', label: '书架', icon: ICONS.shelf },
  { to: '/search', label: '发现', icon: ICONS.compass },
  { to: '/stats', label: '统计', icon: ICONS.chart },
  { to: '/settings', label: '我的', icon: ICONS.person },
]

const PAGE_META = {
  bookshelf: { title: '书架', subtitle: '阅读，让时间有了形状' },
  recent: { title: '最近阅读', subtitle: '' },
  search: { title: '发现', subtitle: '多书源并发搜索' },
  sources: { title: '书源', subtitle: '' },
  stats: { title: '统计', subtitle: '' },
  settings: { title: '我的', subtitle: '' },
  backup: { title: '备份', subtitle: '' },
  warehouse: { title: '书仓' },
  bookmarks: { title: '书签' },
  cache: { title: '缓存' },
  replace: { title: '替换规则' },
  webdav: { title: 'WebDAV' },
  users: { title: '账号' },
  rss: { title: 'RSS' },
}
const pageMeta = computed(() => PAGE_META[route.name] || { title: '胖虎阅读', subtitle: '' })

function updateMobile() {
  isMobile.value = window.innerWidth <= 760
}

onMounted(() => {
  layoutRouteName.value = isBookshelfPath() ? 'bookshelf' : route.name
  loadAuth()
  loadSidebarBooks()
  updateMobile()
  window.addEventListener('resize', updateMobile)
  window.addEventListener('rp-user-updated', loadAuth)
  window.addEventListener('rp-layout-updated', loadSidebarBooks)
  document.addEventListener('click', closeUserInfo)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateMobile)
  window.removeEventListener('rp-user-updated', loadAuth)
  window.removeEventListener('rp-layout-updated', loadSidebarBooks)
  document.removeEventListener('click', closeUserInfo)
})

function closeUserInfo(event) {
  if (!userInfoOpen.value) return
  if (event.target?.closest?.('.header-user')) return
  userInfoOpen.value = false
}
</script>

<template>
  <router-view v-if="isReader() || isLogin()" />

  <div v-else class="app" :class="{ 'app-mobile': isMobile, 'nav-left': showLeftNav }">
    <header class="app-header">
      <div class="app-title">
        <img class="app-logo" src="/brand/logo-128.png" alt="胖虎阅读" />
        <span class="app-title-text">胖虎<span>阅读</span></span>
      </div>
      <div v-if="showHeaderSearch()" class="header-search">
        <span class="muted" style="font-size: 13px">🔍</span>
        <input
          v-model="headerQuery"
          name="reader-search"
          type="search"
          autocomplete="off"
          :readonly="searchReadonly"
          @focus="searchReadonly = false"
          @blur="searchReadonly = true"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="搜索书名 / 作者"
          @keyup.enter="submitSearch"
        />
      </div>
      <div v-else class="spacer" />
      <span class="badge version-badge" :title="'系统版本 ' + appVersion">{{ appVersion }}</span>
      <div v-if="authUser" class="header-user">
        <button class="header-user-trigger" title="用户信息" @click.stop="userInfoOpen = !userInfoOpen">
          <span class="header-avatar">
            <img v-if="authAvatar" :src="authAvatar" alt="" />
            <span v-else>👤</span>
          </span>
          <span class="header-user-name">{{ authUser }}</span>
        </button>
        <div v-if="userInfoOpen" class="user-popover" @click.stop>
          <div class="user-popover-head">
            <button class="header-avatar large" @click="router.push('/settings/account'); userInfoOpen = false">
              <img v-if="authAvatar" :src="authAvatar" alt="" />
              <span v-else>👤</span>
            </button>
            <div>
              <strong>{{ authUser }}</strong>
              <div class="muted" style="font-size: 12px">{{ authRole === 'admin' ? '管理员' : '普通用户' }}</div>
            </div>
          </div>
          <button class="ghost" style="width: 100%; margin-top: 8px" @click="router.push('/settings/account'); userInfoOpen = false">账号设置</button>
          <button class="ghost" style="width: 100%; margin-top: 4px" @click="logout">退出登录</button>
        </div>
      </div>
    </header>

    <aside v-if="showLeftNav" class="side-nav">
      <nav class="side-nav-links">
        <router-link v-for="item in NAV" :key="item.to" :to="item.to" :title="item.label" :class="{ 'force-active': activeNav === item.to }">
          <span class="side-nav-icon">{{ item.icon }}</span>
          <span class="side-nav-label">{{ item.label }}</span>
        </router-link>
      </nav>
      <div class="side-nav-detail">
        <div class="side-nav-title">最近阅读</div>
        <router-link v-for="book in sidebarBooks" :key="book.bookUrl" :to="{ path: '/read', query: { book: book.bookUrl } }" class="side-book">
          <img v-if="coverOf(book)" :src="coverOf(book)" alt="" />
          <span v-else class="side-book-placeholder">📖</span>
          <span class="side-book-text">
            <strong>{{ book.name }}</strong>
            <small>{{ book.durChapterTitle || '还没开始读' }}</small>
          </span>
        </router-link>
        <div v-if="!sidebarBooks.length" class="side-nav-empty">书架还没有书</div>
      </div>
    </aside>

    <!-- 手机：原生风格大标题 + 右侧玻璃圆钮 -->
    <header v-if="isMobile" class="m-header">
      <div class="m-header-text">
        <h1>{{ pageMeta.title }}</h1>
        <p v-if="pageMeta.subtitle" class="m-sub">{{ pageMeta.subtitle }}</p>
      </div>
      <div class="m-header-actions">
        <button class="m-circle" aria-label="搜索" @click="router.push('/search')"><span v-html="ICONS.search" /></button>
        <button v-if="route.name !== 'settings'" class="m-circle" aria-label="更多" @click="router.push('/settings')"><span v-html="ICONS.more" /></button>
      </div>
    </header>

    <main class="app-main" :class="{ 'nav-constrained': showLeftNav && layoutRouteName !== 'bookshelf', 'stats-wide': route.name === 'stats' }">
      <div v-if="parent && !isMobile" class="page-back">
        <button class="page-back-btn" :title="`返回 ${parent.label}`" @click="goParent">
          <span aria-hidden="true">←</span>
          <span>返回 {{ parent.label }}</span>
        </button>
      </div>
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in" @after-leave="syncLayoutRoute">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <nav v-if="!isMobile && !showLeftNav" class="bottom-nav">
      <router-link v-for="item in NAV" :key="item.to" :to="item.to" :class="{ 'force-active': activeNav === item.to }">
        <span class="icon">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </router-link>
    </nav>

    <!-- 手机：悬浮液态玻璃标签栏 -->
    <nav v-if="isMobile" class="m-tabbar">
      <router-link v-for="item in NAV_MOBILE" :key="item.to" :to="item.to" class="m-tab" :class="{ 'force-active': activeNav === item.to }">
        <span class="m-tab-icon" v-html="item.icon" />
        <span class="m-tab-label">{{ item.label }}</span>
      </router-link>
    </nav>
  </div>

  <div v-if="toast" class="toast">{{ toast }}</div>
</template>
