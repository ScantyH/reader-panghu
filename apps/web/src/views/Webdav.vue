<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../api.js'

const url = ref('')
const username = ref('')
const password = ref('')
const currentPath = ref('')
const entries = ref([])
const loading = ref(false)

function targetUrl() {
  const base = url.value.trim()
  if (!base) return ''
  if (!currentPath.value) return base
  const separator = base.endsWith('/') ? '' : '/'
  return `${base}${separator}${currentPath.value.replace(/^\/+/, '')}`
}

async function list(path = currentPath.value) {
  if (!url.value.trim()) {
    window.__toast?.('先填 WebDAV 地址')
    return
  }
  currentPath.value = path.replace(/^\/+/, '')
  loading.value = true
  try {
    const result = await api.webdavList({ url: targetUrl(), username: username.value, password: password.value })
    entries.value = (result.entries || []).filter((entry) => entry.href !== targetUrl() && entry.href !== targetUrl() + '/')
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

function open(entry) {
  const href = entry.href
  if (entry.isDir) {
    const base = url.value.trim()
    const path = href.startsWith(base) ? href.slice(base.length) : href
    list(path)
    return
  }
  window.open(href, '_blank')
}

function fmtSize(bytes) {
  if (!bytes) return '—'
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

onMounted(() => {
  /* 等用户填地址 */
})
</script>

<template>
  <div>
    <div class="page-head">
      <h1>WebDAV 浏览</h1>
      <div class="spacer" />
      <button class="ghost" :disabled="loading" @click="list()">{{ loading ? '读取中…' : '刷新' }}</button>
    </div>

    <div class="row" style="margin-bottom: 12px; flex-wrap: wrap">
      <input v-model="url" placeholder="WebDAV 根地址，例如 https://dav.example.com/books/" style="flex: 1; min-width: 240px" />
      <input v-model="username" placeholder="用户名（可选）" style="max-width: 140px" />
      <input v-model="password" type="password" placeholder="密码（可选）" style="max-width: 140px" />
      <button class="primary" @click="list('')">连接</button>
    </div>

    <div class="row" style="margin-bottom: 12px">
      <button class="ghost" @click="list('')">根目录</button>
      <span class="muted" style="font-size: 12px">/{{ currentPath }}</span>
    </div>

    <div v-if="loading" class="muted">读取中…</div>
    <div v-else-if="!entries.length" class="empty">填地址后点「连接」列出目录。</div>
    <div v-else class="list">
      <div v-for="entry in entries" :key="entry.href" class="list-item" style="cursor: pointer" @click="open(entry)">
        <span>{{ entry.isDir ? '📁' : '📄' }}</span>
        <div style="flex: 1; min-width: 0">
          <strong style="font-size: 14px">{{ decodeURIComponent(entry.href.split('/').filter(Boolean).pop() || entry.href) }}</strong>
          <div class="muted" style="font-size: 12px">{{ entry.isDir ? '目录' : fmtSize(entry.size) }} · {{ entry.modified }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
