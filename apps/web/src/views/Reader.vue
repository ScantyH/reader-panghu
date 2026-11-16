<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api.js'

const props = defineProps({ bookUrl: { type: String, required: true } })
const router = useRouter()

const book = ref(null)
const chapters = ref([])
const current = ref(0)
const content = ref('')
const loading = ref(false)
const showCatalog = ref(false)
const showBookmarks = ref(false)
const bookmarks = ref([])
const showSettings = ref(false)
const prefs = ref({ fontSize: 17, lineHeight: 1.95, theme: 'dark' })
const THEMES = {
  dark: { bg: '#14161a', text: '#d7dae1' },
  sepia: { bg: '#f4ecd8', text: '#3b3226' },
  light: { bg: '#ffffff', text: '#22252b' },
}

let saveTimer = 0
function persistPrefs() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      const config = await api.getUserConfig()
      await api.saveUserConfig({ ...config, reading: { ...prefs.value } })
    } catch {
      /* 偏好保存失败不阻塞阅读 */
    }
  }, 400)
}

async function loadPrefs() {
  try {
    const config = await api.getUserConfig()
    if (config?.reading) prefs.value = { ...prefs.value, ...config.reading }
  } catch {
    /* 用默认值 */
  }
}
const readingEl = ref(null)

const title = computed(() => book.value?.name || '加载中')
const chapterTitle = computed(() => chapters.value[current.value]?.title || '')
const hasPrev = computed(() => current.value > 0)
const hasNext = computed(() => current.value < chapters.value.length - 1)

async function loadChapter(index) {
  if (!chapters.value.length) return
  const target = Math.max(0, Math.min(chapters.value.length - 1, index))
  loading.value = true
  try {
    content.value = await api.content({ bookUrl: props.bookUrl, index: target })
    current.value = target
    if (book.value) {
      book.value.durChapterIndex = target
      book.value.durChapterTitle = chapters.value[target]?.title || ''
    }
    await api.saveProgress(props.bookUrl, target, 0).catch(() => {})
    showCatalog.value = false
    readingEl.value?.scrollTo({ top: 0 })
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

async function loadBookmarks() {
  try {
    const all = await api.bookmarks()
    bookmarks.value = all.filter((item) => item.bookUrl === props.bookUrl)
  } catch {
    /* 书签是辅助功能，读不到不影响阅读 */
  }
}

async function addBookmark() {
  const chapter = chapters.value[current.value]
  if (!chapter) return
  try {
    await api.saveBookmark({ bookUrl: props.bookUrl, chapterIndex: current.value, chapterTitle: chapter.title })
    await loadPrefs()
    await loadBookmarks()
    window.__toast?.('已加入书签')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function removeBookmark(bookmark) {
  try {
    await api.deleteBookmark(bookmark)
    await loadBookmarks()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

onMounted(async () => {
  try {
    const shelf = await api.bookshelf()
    book.value = shelf.find((item) => item.bookUrl === props.bookUrl) || null
    if (!book.value) {
      window.__toast?.('这本书不在书架中')
      router.replace('/bookshelf')
      return
    }
    chapters.value = await api.chapterList({
      bookUrl: book.value.bookUrl,
      tocUrl: book.value.tocUrl,
      bookSourceUrl: book.value.origin,
    })
    await loadBookmarks()
    await loadChapter(Number(book.value.durChapterIndex || 0))
  } catch (error) {
    window.__toast?.(error.message)
  }
})
</script>

<template>
  <div class="reader">
    <div class="reader-bar">
      <button class="ghost" @click="router.back()">返回</button>
      <button class="ghost" @click="showCatalog = !showCatalog">目录</button>
      <button class="ghost" @click="showBookmarks = !showBookmarks">书签</button>
      <button class="ghost" @click="addBookmark">加书签</button>
      <button class="ghost" @click="showSettings = !showSettings">设置</button>
      <div class="reader-title">
        {{ title }}<span v-if="chapterTitle" class="muted"> · {{ chapterTitle }}</span>
      </div>
      <div class="spacer" />
      <span class="badge">{{ chapters.length ? `${current + 1}/${chapters.length}` : '—' }}</span>
    </div>

    <div class="reader-body">
      <aside v-if="showCatalog" class="catalog">
        <button
          v-for="chapter in chapters"
          :key="chapter.index"
          :class="{ current: chapter.index === current }"
          @click="loadChapter(chapter.index)"
        >
          {{ chapter.title }}
        </button>
      </aside>

      <aside v-if="showBookmarks" class="catalog">
        <div class="muted" style="padding: 6px 10px; font-size: 12px">本书书签 · {{ bookmarks.length }}</div>
        <div v-if="!bookmarks.length" class="muted" style="padding: 10px; font-size: 13px">还没有书签</div>
        <div v-for="bookmark in bookmarks" :key="bookmark.id" class="row" style="gap: 4px">
          <button style="flex: 1" :class="{ current: bookmark.chapterIndex === current }" @click="loadChapter(bookmark.chapterIndex)">
            {{ bookmark.chapterTitle || ('第 ' + (bookmark.chapterIndex + 1) + ' 章') }}
          </button>
          <button class="ghost" style="padding: 2px 6px; font-size: 12px" @click="removeBookmark(bookmark)">删</button>
        </div>
      </aside>

      <aside v-if="showSettings" class="catalog">
        <div class="muted" style="padding: 6px 10px; font-size: 12px">阅读设置</div>
        <div class="field" style="padding: 0 10px">
          <label>字号 {{ prefs.fontSize }}px</label>
          <input v-model.number="prefs.fontSize" type="range" min="14" max="26" step="1" @input="persistPrefs" />
        </div>
        <div class="field" style="padding: 0 10px">
          <label>行距 {{ prefs.lineHeight }}</label>
          <input v-model.number="prefs.lineHeight" type="range" min="1.4" max="2.6" step="0.05" @input="persistPrefs" />
        </div>
        <div class="field" style="padding: 0 10px">
          <label>背景</label>
          <div class="row" style="gap: 6px">
            <button v-for="(value, name) in THEMES" :key="name" :class="{ primary: prefs.theme === name }" class="ghost"
              @click="prefs.theme = name; persistPrefs()">{{ name }}</button>
          </div>
        </div>
      </aside>

      <div ref="readingEl" class="reading" :style="{ background: THEMES[prefs.theme]?.bg, color: THEMES[prefs.theme]?.text }">
        <h2 v-if="chapterTitle">{{ chapterTitle }}</h2>
        <div v-if="loading" class="muted">加载中…</div>
        <div v-else class="text" :style="{ fontSize: prefs.fontSize + 'px', lineHeight: prefs.lineHeight, color: THEMES[prefs.theme]?.text }">{{ content || '（本章暂无正文）' }}</div>
        <div class="reader-foot">
          <button :disabled="!hasPrev" @click="loadChapter(current - 1)">上一章</button>
          <button :disabled="!hasNext" @click="loadChapter(current + 1)">下一章</button>
        </div>
      </div>
    </div>
  </div>
</template>
