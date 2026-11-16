<script setup>
import { ref } from 'vue'
import { api } from '../api.js'

const url = ref('')
const username = ref('')
const password = ref('')
const busy = ref('')
const lastResult = ref('')

const SUGGESTED = '/reader-panghu-backup.json'

/** 直接下载整包备份 JSON */
async function downloadBackup() {
  const blob = await api.exportBackup()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'reader-panghu-backup.json'
  link.click()
  URL.revokeObjectURL(url)
}

async function backup() {
  if (!url.value.trim()) {
    window.__toast?.('先填 WebDAV 文件地址')
    return
  }
  busy.value = 'backup'
  try {
    const result = await api.webdavBackup({ url: url.value.trim(), username: username.value, password: password.value })
    lastResult.value = `备份成功，已上传 ${result.bytes} 字节`
    window.__toast?.(lastResult.value)
  } catch (error) {
    lastResult.value = error.message
    window.__toast?.(error.message)
  } finally {
    busy.value = ''
  }
}

async function restore() {
  if (!url.value.trim()) {
    window.__toast?.('先填 WebDAV 文件地址')
    return
  }
  if (!confirm('从备份恢复会覆盖同名书籍、书源与分组，继续？')) return
  busy.value = 'restore'
  try {
    const result = await api.webdavRestore({ url: url.value.trim(), username: username.value, password: password.value })
    const { books, sources, groups } = result.restored
    lastResult.value = `恢复完成：书 ${books} / 源 ${sources} / 分组 ${groups}`
    window.__toast?.(lastResult.value)
  } catch (error) {
    lastResult.value = error.message
    window.__toast?.(error.message)
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <div>
    <div class="page-head">
      <h1>WebDAV 备份</h1>
    </div>

    <p class="muted" style="font-size: 13px; max-width: 720px">
      备份内容包含书架、书源、分组和阅读偏好，序列化为一个 JSON 文件直接 PUT 到你的 WebDAV。
      恢复时会覆盖同名条目，不会删除备份里没有的书。
    </p>

    <div style="max-width: 620px">
      <div class="field">
        <label>WebDAV 文件地址</label>
        <input v-model="url" :placeholder="'https://dav.example.com/books' + SUGGESTED" />
      </div>
      <div class="row" style="gap: 12px">
        <div class="field" style="flex: 1">
          <label>用户名（可选）</label>
          <input v-model="username" autocomplete="off" />
        </div>
        <div class="field" style="flex: 1">
          <label>密码（可选，仅本次使用，不落库）</label>
          <input v-model="password" type="password" autocomplete="off" />
        </div>
      </div>

      <div class="row" style="margin-top: 8px">
        <button class="primary" :disabled="busy !== ''" @click="backup">{{ busy === 'backup' ? '备份中…' : '立即备份' }}</button>
        <button :disabled="busy !== ''" @click="restore">{{ busy === 'restore' ? '恢复中…' : '从备份恢复' }}</button>
      </div>

      <p v-if="lastResult" class="muted" style="margin-top: 16px">{{ lastResult }}</p>
    </div>

    <p class="muted" style="font-size: 12.5px; margin-top: 28px">
      命令行等价操作：
      <code>curl -X POST /reader3/webdavBackup -d '{"url":"…"}'</code>
    </p>
  </div>
</template>
