<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, setToken } from './api.js'

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
  { to: '/backup', label: '备份', icon: '💾' },
  { to: '/settings', label: '设置', icon: '⚙️' },
]
onMounted(loadAuth)
</script>

<template>
  <router-view v-if="isReader() || isLogin()" />

  <div v-else class="app">
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

    <main class="app-main">
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
      <router-link v-for="item in NAV" :key="item.to" :to="item.to">
        <span class="icon">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </router-link>
    </nav>
  </div>

  <div v-if="toast" class="toast">{{ toast }}</div>
</template>
