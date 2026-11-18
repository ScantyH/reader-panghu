<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, coverOf } from '../api.js'

const route = useRoute()
const router = useRouter()
const book = ref(null)
const groups = ref([])
const loading = ref(true)
const editingIntro = ref(false)
const introDraft = ref('')
const coverFailed = ref(false)
const switching = ref(false)
const coverUrl = computed(() => coverOf(book.value))
const isLocal = computed(() => /^local:\/\//i.test(String(book.value?.origin || '')))

const decodeUrl = (value) => {
  try {
    return decodeURIComponent(atob(value))
  } catch {
    return value
  }
}

function encodeUrl(value) {
  return btoa(encodeURIComponent(value))
}

const progress = computed(() => {
  const total = Number(book.value?.totalChapterNum || 0)
  const index = Number(book.value?.durChapterIndex || 0)
  if (!total) return 0
  return Math.min(100, Math.round(((index + 1) / total) * 100))
})

async function load() {
  loading.value = true
  try {
    const bookUrl = decodeUrl(String(route.params.id || ''))
    const shelf = await api.bookshelf()
    book.value = shelf.find((item) => item.bookUrl === bookUrl) || null
    coverFailed.value = false
    if (!book.value) window.__toast?.('这本书不在书架里')
    groups.value = await api.groups().catch(() => [])
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

function read() {
  router.push({ path: '/read', query: { book: book.value.bookUrl } })
}

async function moveTo(groupId) {
  try {
    await api.saveBookGroupId(book.value.bookUrl, Number(groupId))
    book.value.group = Number(groupId)
    window.__toast?.('已移动分组')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function saveIntro() {
  try {
    const updated = await api.saveBook({ ...book.value, intro: introDraft.value })
    book.value = updated
    editingIntro.value = false
    window.__toast?.('简介已保存')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function remove() {
  if (!confirm(`从书架移除《${book.value.name}》？`)) return
  try {
    await api.deleteBooks([{ bookUrl: book.value.bookUrl }])
    router.replace('/bookshelf')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/** 旧书源失效时，一键自动找可用来源并保留阅读进度 */
async function changeSource() {
  if (isLocal.value || switching.value) return
  if (!confirm(`自动为《${book.value.name}》寻找可用书源并切换？`)) return
  switching.value = true
  try {
    const result = await api.autoSwitchBookSource({ bookUrl: book.value.bookUrl })
    book.value = result.book
    window.__toast?.(`已换到「${result.originName}」`)
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    switching.value = false
  }
}

function share() {
  const url = location.origin + '/book/' + encodeUrl(book.value.bookUrl)
  navigator.clipboard?.writeText(url)
  window.__toast?.('链接已复制')
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <button class="ghost" @click="router.back()">← 返回</button>
      <div class="spacer" />
      <button v-if="book" class="ghost" @click="share">复制链接</button>
    </div>

    <div v-if="loading" class="muted">加载中…</div>
    <div v-else-if="!book" class="empty">没有这本书。</div>
    <template v-else>
      <div class="row" style="gap: 18px; align-items: flex-start; margin-bottom: 20px">
        <div class="cover" style="width: 116px; flex: none">
          <img v-if="coverUrl && !coverFailed" :src="coverUrl" :alt="book.name" @error="coverFailed = true" />
          <div v-else class="placeholder">{{ book.name }}</div>
        </div>
        <div style="flex: 1; min-width: 0">
          <h1 style="font-size: 20px; margin: 0 0 6px">{{ book.name }}</h1>
          <p class="muted" style="margin: 0 0 8px">{{ book.author || '未知作者' }}</p>
          <div class="row" style="flex-wrap: wrap; gap: 6px; margin-bottom: 10px">
            <span class="badge">{{ book.originName || '未知来源' }}</span>
            <span class="badge">{{ book.totalChapterNum || 0 }} 章</span>
            <span v-if="book.wordCount" class="badge">{{ book.wordCount }} 字</span>
          </div>
          <div style="height: 6px; background: var(--color-bg-sunken); border-radius: 999px; overflow: hidden">
            <i :style="{ display: 'block', height: '100%', width: progress + '%', background: 'var(--color-primary)' }" />
          </div>
          <div class="muted" style="font-size: 12px; margin-top: 4px">
            已读 {{ progress }}% · {{ book.durChapterTitle || '还没开始读' }}
          </div>
        </div>
      </div>

      <div class="row" style="flex-wrap: wrap; gap: 8px; margin-bottom: 20px">
        <button class="primary" @click="read">{{ progress ? '继续阅读' : '开始阅读' }}</button>
        <select :value="book.group" style="max-width: 160px" @change="moveTo($event.target.value)">
          <option v-for="group in groups" :key="group.groupId" :value="group.groupId">{{ group.groupName }}</option>
        </select>
        <button v-if="!isLocal" class="ghost" :disabled="switching" @click="changeSource">
          {{ switching ? '换源中…' : '换源' }}
        </button>
        <button class="ghost" @click="editingIntro = true; introDraft = book.intro || ''">编辑简介</button>
        <button class="ghost" @click="remove">移出书架</button>
      </div>

      <h3 style="font-size: 14px; margin: 0 0 8px">简介</h3>
      <p v-if="!editingIntro" class="book-intro">
        {{ book.intro || '（没有简介）' }}
      </p>
      <div v-else>
        <textarea v-model="introDraft" rows="6" style="width: 100%" />
        <div class="row" style="justify-content: flex-end; margin-top: 8px">
          <button class="ghost" @click="editingIntro = false">取消</button>
          <button class="primary" @click="saveIntro">保存</button>
        </div>
      </div>
    </template>
  </div>
</template>
