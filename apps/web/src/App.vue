<script setup>
import { ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const toast = ref('')
let timer = 0

/** Any view can call window.__toast('...') for a transient message. */
window.__toast = (message) => {
  toast.value = String(message)
  clearTimeout(timer)
  timer = setTimeout(() => (toast.value = ''), 2600)
}

const isReader = () => route.name === 'reader'
</script>

<template>
  <div v-if="isReader()" class="app-reader">
    <router-view />
  </div>
  <div v-else class="app">
    <aside class="sidebar">
      <div class="brand">胖虎<span>阅读</span></div>
      <router-link class="nav-link" active-class="active" to="/bookshelf">书架</router-link>
      <router-link class="nav-link" active-class="active" to="/recent">最近</router-link>
      <router-link class="nav-link" active-class="active" to="/search">搜索</router-link>
      <router-link class="nav-link" active-class="active" to="/sources">书源</router-link>
      <router-link class="nav-link" active-class="active" to="/rss">RSS</router-link>
      <router-link class="nav-link" active-class="active" to="/backup">备份</router-link>
    </aside>
    <main class="main">
      <router-view />
    </main>
  </div>
  <div v-if="toast" class="toast">{{ toast }}</div>
</template>
