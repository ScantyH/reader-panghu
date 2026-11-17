<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../api.js'

defineProps({ embedded: { type: Boolean, default: false } })

const sources = ref([])
const activeSource = ref('')
const articles = ref([])
const article = ref(null)
const loading = ref(false)
const newUrl = ref('')
const newName = ref('')

async function loadSources() {
  try {
    sources.value = await api.rssSources()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function addSource() {
  const url = newUrl.value.trim()
  if (!url) return
  try {
    await api.saveRssSource({ sourceUrl: url, sourceName: newName.value.trim() || url })
    newUrl.value = ''
    newName.value = ''
    await loadSources()
    window.__toast?.('订阅已添加')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function removeSource(source) {
  if (!confirm(`删除订阅「${source.sourceName || source.sourceUrl}」？`)) return
  try {
    await api.deleteRssSource(source.sourceUrl)
    if (activeSource.value === source.sourceUrl) {
      activeSource.value = ''
      articles.value = []
    }
    await loadSources()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function openSource(source) {
  activeSource.value = source.sourceUrl
  loading.value = true
  articles.value = []
  try {
    const feed = await api.rssArticles(source.sourceUrl)
    articles.value = feed.first || []
    if (feed.title) source.sourceName = source.sourceName || feed.title
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

async function openArticle(item) {
  loading.value = true
  try {
    article.value = { ...item, content: await api.rssContent(item.link) }
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

onMounted(loadSources)
</script>

<template>
  <div>
    <div class="page-head" :style="embedded ? 'margin-bottom: 12px' : ''">
      <template v-if="!embedded">
        <h1>RSS 订阅</h1>
        <span class="badge">{{ sources.length }} 个源</span>
      </template>
      <span v-else class="muted" style="font-size: 13px">订阅 RSS / Atom，和书源放在一起管理</span>
      <div class="spacer" />
      <input v-model="newUrl" placeholder="订阅地址（RSS / Atom）" style="min-width: 240px" @keyup.enter="addSource" />
      <input v-model="newName" placeholder="名称（可选）" style="max-width: 160px" />
      <button class="primary" @click="addSource">添加</button>
    </div>

    <div v-if="!sources.length" class="empty">还没有订阅源。粘贴一个 RSS/Atom 地址开始。</div>

    <div class="row" style="align-items: flex-start; gap: 20px">
      <div class="list" style="width: 280px; flex: none">
        <div v-for="source in sources" :key="source.sourceUrl" class="list-item" style="cursor: pointer" @click="openSource(source)">
          <div style="flex: 1; min-width: 0">
            <strong :class="{ accent: activeSource === source.sourceUrl }">{{ source.sourceName || '未命名订阅' }}</strong>
            <div class="muted" style="font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
              {{ source.sourceUrl }}
            </div>
          </div>
          <button class="ghost" style="padding: 2px 8px; font-size: 12px" @click.stop="removeSource(source)">删</button>
        </div>
      </div>

      <div style="flex: 1; min-width: 0">
        <div v-if="loading" class="muted">加载中…</div>
        <div v-else-if="!activeSource" class="muted">选择左侧的订阅源查看文章。</div>
        <div v-else-if="!articles.length" class="muted">这个源暂时没有文章。</div>
        <div v-else class="list">
          <div v-for="item in articles" :key="item.link + item.title" class="list-item" style="cursor: pointer" @click="openArticle(item)">
            <div style="flex: 1; min-width: 0">
              <strong>{{ item.title }}</strong>
              <div class="muted" style="font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                {{ item.description }}
              </div>
            </div>
            <span class="badge">{{ item.pubDate }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="article" class="dialog-backdrop" @click.self="article = null">
      <div class="dialog" style="width: min(760px, 100%)">
        <div class="page-head" style="margin-bottom: 12px">
          <h2 style="font-size: 17px; margin: 0">{{ article.title }}</h2>
          <div class="spacer" />
          <button class="ghost" @click="article = null">关闭</button>
        </div>
        <div class="muted" style="font-size: 12.5px; margin-bottom: 12px">{{ article.link }}</div>
        <div style="white-space: pre-wrap; line-height: 1.9">{{ article.content }}</div>
      </div>
    </div>
  </div>
</template>
