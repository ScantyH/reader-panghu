<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../api.js'

const sources = ref([])
const loading = ref(false)
const testing = ref('')
const fileInput = ref(null)

async function load() {
  loading.value = true
  try {
    sources.value = await api.sources()
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

async function importFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    const parsed = await api.importSourceFile(file)
    if (!parsed.length) throw new Error('文件里没有解析出书源')
    await api.saveSources(parsed)
    window.__toast?.(`已导入 ${parsed.length} 个书源`)
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    event.target.value = ''
  }
}

async function remove(source) {
  if (!confirm(`删除书源「${source.bookSourceName}」？`)) return
  try {
    await api.deleteSource(source.bookSourceUrl)
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function test(source) {
  testing.value = source.bookSourceUrl
  try {
    const report = await api.testSources([source.bookSourceUrl])
    const result = report.results?.[0]
    window.__toast?.(
      result?.valid ? `可用：搜到 ${report.valid ? '结果' : '0 条'}` : `不可用：${result?.searchError || '无结果'}`,
    )
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    testing.value = ''
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <h1>书源</h1>
      <span class="badge">{{ sources.length }}</span>
      <div class="spacer" />
      <input ref="fileInput" type="file" accept=".json" hidden @change="importFile" />
      <button class="primary" @click="fileInput.click()">导入书源</button>
      <button class="ghost" :disabled="loading" @click="load">刷新</button>
    </div>

    <p class="muted" style="font-size: 13px; margin-top: -8px">
      WebView 书源（带 <code>html</code>）由服务端执行；规则型书源由客户端执行，这里只负责保存与同步。
    </p>

    <div v-if="!sources.length" class="empty">还没有书源。导入一个 Legado 包装的 JSON（内含 html 字段）。</div>

    <div class="list">
      <div v-for="source in sources" :key="source.bookSourceUrl" class="list-item">
        <div style="flex: 1; min-width: 0">
          <div class="row" style="gap: 8px">
            <strong>{{ source.bookSourceName }}</strong>
            <span class="badge" :class="{ accent: source.html }">{{ source.html ? 'WebView' : '规则型' }}</span>
            <span v-if="source.bookSourceGroup" class="badge">{{ source.bookSourceGroup }}</span>
          </div>
          <div class="muted" style="font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
            {{ source.bookSourceUrl }}
          </div>
        </div>
        <button class="ghost" :disabled="testing === source.bookSourceUrl || !source.html" @click="test(source)">
          {{ testing === source.bookSourceUrl ? '测试中' : '测试' }}
        </button>
        <button class="ghost" @click="remove(source)">删除</button>
      </div>
    </div>
  </div>
</template>
