<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api.js'

const router = useRouter()
const bookmarks = ref([])
const loading = ref(false)
const filter = ref('')

const filtered = computed(() => {
  const q = filter.value.trim()
  if (!q) return bookmarks.value
  return bookmarks.value.filter(
    (item) => (item.chapterTitle || '').includes(q) || (item.bookUrl || '').includes(q),
  )
})

async function load() {
  loading.value = true
  try {
    bookmarks.value = await api.bookmarks()
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

function jump(bookmark) {
  router.push({ path: '/read', query: { book: bookmark.bookUrl } })
}

async function remove(bookmark) {
  try {
    await api.deleteBookmark(bookmark)
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function clearAll() {
  if (!bookmarks.value.length) return
  if (!confirm(`清除全部 ${bookmarks.value.length} 个书签？`)) return
  try {
    for (const bookmark of bookmarks.value) await api.deleteBookmark(bookmark)
    await load()
    window.__toast?.('已清空书签')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <h1>书签</h1>
      <span class="badge">{{ bookmarks.length }} 条</span>
      <div class="spacer" />
      <input v-model="filter" placeholder="筛选章节名" style="max-width: 200px" />
      <button class="ghost" @click="load">刷新</button>
      <button class="ghost" @click="clearAll">清空</button>
    </div>

    <div v-if="loading" class="muted">加载中…</div>
    <div v-else-if="!filtered.length" class="empty">还没有书签。阅读时点右上角「＋」即可添加。</div>
    <div v-else class="list">
      <div v-for="bookmark in filtered" :key="bookmark.id" class="list-item">
        <div style="flex: 1; min-width: 0">
          <strong style="font-size: 14px">{{ bookmark.chapterTitle || `第 ${(bookmark.chapterIndex ?? 0) + 1} 章` }}</strong>
          <div class="muted" style="font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
            {{ bookmark.bookUrl }}
          </div>
        </div>
        <button class="ghost" @click="jump(bookmark)">打开</button>
        <button class="ghost" @click="remove(bookmark)">删除</button>
      </div>
    </div>
  </div>
</template>
