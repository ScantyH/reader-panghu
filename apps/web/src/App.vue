<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, coverOf, setToken } from './api.js'
import { desktopNavLayout } from './use-layout.js'

const route = useRoute()
const router = useRouter()
const toast = ref('')
const headerQuery = ref('')
const searchReadonly = ref(true)
const appVersion = __APP_VERSION__
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
const showLeftNav = computed(() => desktopNavLayout.value === 'left')

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
  { to: '/backup', label: '备份', icon: '💾' },
  { to: '/settings', label: '设置', icon: '⚙️' },
]
onMounted(() => {
  loadAuth()
  loadSidebarBooks()
  window.addEventListener('rp-user-updated', loadAuth)
  window.addEventListener('rp-layout-updated', loadSidebarBooks)
  document.addEventListener('click', closeUserInfo)
})
onBeforeUnmount(() => {
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

  <div v-else class="app" :class="{ 'nav-left': showLeftNav }">
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




    <main class="app-main" :class="{ 'nav-constrained': showLeftNav && route.name !== 'bookshelf', 'stats-wide': route.name === 'stats' }">
      <div v-if="parent" class="page-back">
        <button class="page-back-btn" :title="`返回 ${parent.label}`" @click="goParent">
          <span aria-hidden="true">←</span>
          <span>返回 {{ parent.label }}</span>
        </button>
      </div>
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <nav class="bottom-nav">
      <router-link v-for="item in NAV" :key="item.to" :to="item.to" :class="{ 'force-active': activeNav === item.to }">
        <span class="icon">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </router-link>
    </nav>
  </div>

  <div v-if="toast" class="toast">{{ toast }}</div>
</template>
