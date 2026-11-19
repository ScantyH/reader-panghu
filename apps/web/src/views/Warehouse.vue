<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../api.js'
import { useSortable } from '../use-sortable.js'

const currentPath = ref('')
const data = ref({ categories: [], files: [] })
const loading = ref(false)
const newCategory = ref('')
const fileInput = ref(null)
const breadcrumbs = () => (currentPath.value ? currentPath.value.split('/') : [])

async function load(path = currentPath.value) {
  loading.value = true
  try {
    const result = await api.warehouse(path)
    currentPath.value = result.path || ''
    data.value = result
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

function moveCategory(from, to) {
  const list = [...data.value.categories]
  const [item] = list.splice(from, 1)
  list.splice(to, 0, item)
  data.value = { ...data.value, categories: list }
}

const {
  start: startCategoryDrag,
  cancel: cancelCategoryDrag,
  draggingId: categoryDraggingId,
} = useSortable({
  getIds: () => data.value.categories.map((category) => category.path),
  move: moveCategory,
  onCommit: async () => {
    try {
      await api.warehouseReorder(currentPath.value, data.value.categories.map((category) => category.name))
      window.__toast?.('分类顺序已保存')
    } catch (error) {
      window.__toast?.(error.message)
      await load()
    }
  },
})

async function createCategory() {
  const name = newCategory.value.trim()
  if (!name) return
  try {
    await api.warehouseMkdir(currentPath.value, name)
    newCategory.value = ''
    await load()
    window.__toast?.('分类已创建')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function importBook(file) {
  try {
    const result = await api.warehouseImport(file.path)
    window.__toast?.(`已导入《${result.book.name}》到书架`)
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function uploadFiles(event) {
  const files = [...(event.target.files || [])]
  if (!files.length) return
  try {
    for (const file of files) await api.warehouseUpload(currentPath.value, file)
    window.__toast?.(`已上传 ${files.length} 个文件`)
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    event.target.value = ''
  }
}

async function remove(path) {
  if (!confirm(`删除「${path}」？`)) return
  try {
    await api.warehouseDelete(path)
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

function formatSize(bytes) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

onMounted(() => load(''))
</script>

<template>
  <div>
    <div class="page-head">
      <h1>书仓</h1>
      <span class="badge">{{ data.categories.length }} 个分类 · {{ data.files.length }} 本书</span>
      <div class="spacer" />
      <input ref="fileInput" type="file" multiple hidden @change="uploadFiles" />
      <button class="ghost" @click="fileInput.click()">上传到当前目录</button>
      <button class="primary" @click="load()">刷新</button>
    </div>

    <p class="muted" style="font-size: 13px; margin-top: -6px">
      书仓是服务端的数据目录，文件夹即分类。把 txt / epub / docx / mobi / azw3 / pdf 放进来，点「导入」即可加入书架。
    </p>

    <div class="row" style="margin-bottom: 12px; flex-wrap: wrap">
      <button class="ghost" @click="load('')">根目录</button>
      <template v-for="(part, index) in breadcrumbs()" :key="index">
        <span class="muted">/</span>
        <button class="ghost" @click="load(breadcrumbs().slice(0, index + 1).join('/'))">{{ part }}</button>
      </template>
      <div class="spacer" />
      <input v-model="newCategory" placeholder="新分类名" style="max-width: 160px" @keyup.enter="createCategory" />
      <button @click="createCategory">新建分类</button>
    </div>

    <div v-if="loading" class="muted">加载中…</div>

    <div v-else-if="!data.categories.length && !data.files.length" class="empty">
      这个目录是空的。新建一个分类，或上传几本书进来。
    </div>

    <div v-else class="list">
      <div
        v-for="category in data.categories"
        :key="category.path"
        class="list-item"
        :class="{ dragging: categoryDraggingId === category.path }"
        :data-sort-id="category.path"
      >
        <span>📁</span>
        <button class="ghost" style="flex: 1; text-align: left; border: none" @click="load(category.path)">
          {{ category.name }}
        </button>
        <span class="badge">{{ category.bookCount }} 本</span>
        <button class="ghost" @click="remove(category.path)">删除</button>
        <span
          class="sort-handle"
          title="长按拖动分类排序"
          @pointerdown.prevent="startCategoryDrag($event, category.path)"
          @pointerup="cancelCategoryDrag"
        >≡</span>
      </div>
      <div v-for="file in data.files" :key="file.path" class="list-item">
        <span>📄</span>
        <div style="flex: 1; min-width: 0">
          <strong style="font-size: 14px">{{ file.name }}</strong>
          <div class="muted" style="font-size: 12px">{{ formatSize(file.size) }}</div>
        </div>
        <button class="primary" @click="importBook(file)">导入书架</button>
        <button class="ghost" @click="remove(file.path)">删除</button>
      </div>
    </div>
  </div>
</template>
