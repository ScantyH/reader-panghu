<script setup>
import { ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const toast = ref('')
let timer = 0

/** 任何视图都可以用 window.__toast('...') 弹一条短提示。 */
window.__toast = (message) => {
  toast.value = String(message)
  clearTimeout(timer)
  timer = setTimeout(() => (toast.value = ''), 2600)
}

const isReader = () => route.name === 'reader'

const NAV = [
  { to: '/bookshelf', label: '书架', icon: '📚' },
  { to: '/search', label: '搜索', icon: '🔍' },
  { to: '/sources', label: '书源', icon: '🔗' },
  { to: '/rss', label: 'RSS', icon: '📰' },
  { to: '/backup', label: '备份', icon: '💾' },
]
</script>

<template>
  <router-view v-if="isReader()" />

  <div v-else class="app">
    <header class="app-header">
      <div class="app-title">胖虎<span>阅读</span></div>
      <div class="spacer" />
      <router-link class="badge" to="/recent">最近阅读</router-link>
    </header>

    <main class="app-main">
      <router-view />
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
