<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const toast = ref('')
const headerQuery = ref('')
let timer = 0

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
  { to: '/rss', label: 'RSS', icon: '📰' },
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
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="搜索书名 / 作者"
          @keyup.enter="submitSearch"
        />
      </div>
      <div v-else class="spacer" />
      <router-link class="badge" to="/recent">最近阅读</router-link>
      <div v-if="authUser" class="header-user">
        <span class="header-user-name">{{ authUser }}</span>
        <button class="header-user-logout" @click="logout">退出</button>
      </div>
    </header>

    <main class="app-main">
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
