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
const fileInput = ref(null)

const visible = computed(() => {
  let list = books.value
  if (props.recentOnly) list = list.filter((book) => Number(book.durChapterTime) > 0)
  else if (activeGroup.value) list = list.filter((book) => Number(book.group || 0) === activeGroup.value)
  return [...list].sort((a, b) => Number(b.durChapterTime || 0) - Number(a.durChapterTime || 0))
})

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

function open(book) {
  router.push({ path: '/read', query: { book: book.bookUrl } })
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

async function remove(book) {
  if (!confirm(`从书架删除《${book.name}》？`)) return
  try {
    await api.deleteBooks([{ bookUrl: book.bookUrl }])
    await load()
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
      <input ref="fileInput" type="file" accept=".txt,.epub,.docx,.mobi,.azw3,.azw,.pdf" hidden @change="importBook" />
      <button @click="fileInput.click()">导入本地书</button>
      <button ghost class="ghost" :disabled="loading" @click="load">{{ loading ? '刷新中' : '刷新' }}</button>
    </div>

    <div v-if="!recentOnly && groups.length > 1" class="row" style="flex-wrap: wrap; margin-bottom: 16px">
      <button :class="{ primary: activeGroup === 0 }" class="ghost" @click="activeGroup = 0">全部</button>
      <button
        v-for="group in groups.filter((item) => item.groupId !== 0)"
        :key="group.groupId"
        class="ghost"
        :class="{ primary: activeGroup === group.groupId }"
        @click="activeGroup = group.groupId"
      >
        {{ group.groupName }}
      </button>
    </div>

    <div v-if="!visible.length" class="empty">
      书架还是空的。去 <router-link to="/search" style="color: var(--accent)">搜索</router-link> 找书，或导入一本 TXT / EPUB / DOCX / MOBI / PDF。
    </div>

    <div v-else class="grid">
      <div v-for="book in visible" :key="book.bookUrl" class="card" @click="open(book)">
        <div class="cover">
          <img v-if="coverOf(book)" :src="coverOf(book)" :alt="book.name" loading="lazy" />
          <div v-else class="placeholder">{{ book.name }}</div>
          <div v-if="progressOf(book)" class="progress"><i :style="{ width: progressOf(book) + '%' }" /></div>
        </div>
        <h3>{{ book.name }}</h3>
        <p>{{ book.durChapterTitle || book.author || '未开始' }}</p>
        <div class="row" style="margin-top: 6px; gap: 6px" @click.stop>
          <button class="ghost" style="padding: 2px 8px; font-size: 12px" @click="editing = { ...book }">编辑</button>
          <button class="ghost" style="padding: 2px 8px; font-size: 12px" @click="cache(book)">缓存</button>
          <button class="ghost" style="padding: 2px 8px; font-size: 12px" @click="remove(book)">删除</button>
        </div>
      </div>
    </div>

    <BookDetail v-if="editing" :book="editing" mode="shelf" @close="editing = null" @save="saveEdited" />
  </div>
</template>
