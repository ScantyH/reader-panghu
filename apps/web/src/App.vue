<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, isNativeApp, setToken } from './api.js'

const route = useRoute()
const router = useRouter()
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

async function loadAuth() {
  try {
    const info = await api.getUserInfo()
    authOn.value = Boolean(info?.authEnabled)
    authUser.value = info?.username || ''
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
  loadAuth()
  updateMobile()
  window.addEventListener('resize', updateMobile)
})
onBeforeUnmount(() => window.removeEventListener('resize', updateMobile))
</script>

<template>
  <router-view v-if="isReader() || isLogin()" />

  <div v-else class="app" :class="{ 'app-mobile': isMobile }">
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
        <span class="header-user-name">{{ authUser }}</span>
        <button class="header-user-logout" @click="logout">退出</button>
      </div>
    </header>

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

    <main class="app-main">
      <div v-if="parent && !isMobile" class="page-back">
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

    <nav v-if="!isMobile" class="bottom-nav">
      <router-link v-for="item in NAV" :key="item.to" :to="item.to">
        <span class="icon">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </router-link>
    </nav>

    <!-- 手机：悬浮液态玻璃标签栏 -->
    <nav v-if="isMobile" class="m-tabbar">
      <router-link v-for="item in NAV_MOBILE" :key="item.to" :to="item.to" class="m-tab">
        <span class="m-tab-icon" v-html="item.icon" />
        <span class="m-tab-label">{{ item.label }}</span>
      </router-link>
    </nav>
  </div>

  <div v-if="toast" class="toast">{{ toast }}</div>
</template>
