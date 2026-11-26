<script setup>
import { computed, onMounted, ref } from 'vue'
import { api, coverOf, downloadBook } from '../api.js'

const books = ref([])
const loading = ref(false)
const downloading = ref('')

const networkBooks = computed(() => books.value.filter((book) => !/^local:\/\//i.test(String(book.origin || ''))))

async function load() {
  loading.value = true
  try {
    books.value = await api.bookshelf()
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

async function exportBook(book, format) {
  if (downloading.value) return
  downloading.value = `${book.bookUrl}:${format}`
  try {
    const { blob, filename } = await downloadBook(book.bookUrl, format)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename || `${book.name || 'book'}.${format}`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    window.__toast?.(`已开始下载《${book.name}》`)
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    downloading.value = ''
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <h1>网络书籍管理</h1>
      <span class="badge">{{ networkBooks.length }} 本</span>
      <div class="spacer" />
      <button class="ghost" :disabled="loading" @click="load">{{ loading ? '刷新中…' : '刷新' }}</button>
    </div>

    <p class="muted network-hint">
      这里只显示从书源加入书架的网络书。导出时会抓取全部章节，章节较多的书需要等待一段时间；导出完成后浏览器会直接下载文件。
    </p>

    <div v-if="loading" class="empty">正在加载书架…</div>
    <div v-else-if="!networkBooks.length" class="empty">书架里还没有网络书籍。</div>

    <div v-else class="network-books">
      <article v-for="book in networkBooks" :key="book.bookUrl" class="network-book">
        <div class="network-cover">
          <img v-if="coverOf(book)" :src="coverOf(book)" :alt="book.name" loading="lazy" />
          <div v-else class="placeholder">{{ book.name }}</div>
        </div>
        <div class="network-info">
          <h3>{{ book.name }}</h3>
          <p>{{ book.author || '未知作者' }} · 共 {{ book.totalChapterNum || 0 }} 章</p>
          <p class="muted">{{ book.originName || book.origin }}</p>
        </div>
        <div class="network-actions">
          <button
            class="ghost"
            :disabled="Boolean(downloading)"
            @click="exportBook(book, 'txt')"
          >
            {{ downloading === `${book.bookUrl}:txt` ? '正在导出…' : '下载 TXT' }}
          </button>
          <button
            class="primary"
            :disabled="Boolean(downloading)"
            @click="exportBook(book, 'epub')"
          >
            {{ downloading === `${book.bookUrl}:epub` ? '正在导出…' : '下载 EPUB' }}
          </button>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.network-hint {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.7;
}

.network-books {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.network-book {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 14px;
  border: 1px solid var(--color-border-light);
  border-radius: 14px;
  background: var(--color-bg-elevated);
}

.network-cover {
  width: 54px;
  aspect-ratio: 3 / 4;
  flex: none;
  border-radius: 6px;
  overflow: hidden;
  background: var(--color-bg-sunken);
  box-shadow: var(--shadow-sm);
}

.network-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.network-cover .placeholder {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  padding: 4px;
  font-size: 10px;
  color: var(--color-text-secondary);
  text-align: center;
}

.network-info {
  flex: 1;
  min-width: 0;
}

.network-info h3 {
  margin: 0 0 5px;
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.network-info p {
  margin: 0 0 3px;
  font-size: 12.5px;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.network-actions {
  flex: none;
  display: flex;
  gap: 8px;
}

@media (max-width: 640px) {
  .network-book {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .network-actions {
    width: 100%;
    padding-left: 70px;
  }
}
</style>
