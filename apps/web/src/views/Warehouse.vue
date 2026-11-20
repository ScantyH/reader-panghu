<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from '../api.js'
import { useSortable } from '../use-sortable.js'

const currentPath = ref('')
const data = ref({ categories: [], files: [] })
const loading = ref(false)
const newCategory = ref('')
const fileInput = ref(null)
const groups = ref([])
const rootCategories = ref([])
const uploadTarget = ref('')
const uploadBusy = ref(false)
const uploadProgress = ref({ done: 0, total: 0 })
const selected = ref([])
const batchGroup = ref(0)
const batchBusy = ref(false)
const importForm = ref(null)
const importBusy = ref(false)
const previewBusy = ref(false)
const breadcrumbs = () => (currentPath.value ? currentPath.value.split('/') : [])

const unimportedFiles = computed(() => data.value.files.filter((file) => !file.imported))
const allSelected = computed(
  () => unimportedFiles.value.length > 0 && selected.value.length === unimportedFiles.value.length,
)
const groupOptions = computed(() => {
  const list = groups.value.map((group) => ({ id: Number(group.groupId || 0), name: group.groupName || '未分组' }))
  if (!list.some((group) => group.id === 0)) list.unshift({ id: 0, name: '未分组' })
  return list
})

async function load(path = currentPath.value) {
  loading.value = true
  try {
    const result = await api.warehouse(path)
    currentPath.value = result.path || ''
    data.value = result
    selected.value = []
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

async function loadGroups() {
  try {
    groups.value = (await api.groups()) || []
  } catch {
    groups.value = []
  }
}

async function loadRootCategories() {
  try {
    const result = await api.warehouse('')
    rootCategories.value = result.categories || []
  } catch {
    rootCategories.value = []
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
  if (currentPath.value) return
  const name = newCategory.value.trim()
  if (!name) return
  try {
    await api.warehouseMkdir('', name)
    newCategory.value = ''
    await load('')
    await loadRootCategories()
    window.__toast?.('分类已创建')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

function toggleFile(file) {
  if (file.imported) return
  const index = selected.value.indexOf(file.path)
  if (index >= 0) selected.value.splice(index, 1)
  else selected.value.push(file.path)
}

function toggleAll() {
  selected.value = allSelected.value ? [] : unimportedFiles.value.map((file) => file.path)
}

async function openImport(file) {
  if (file.imported) return
  previewBusy.value = true
  try {
    const preview = await api.warehousePreview(file.path)
    importForm.value = {
      ...preview,
      path: file.path,
      group: Number(batchGroup.value || 0),
      kind: preview.kind || '',
    }
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    previewBusy.value = false
  }
}

function closeImport() {
  if (importBusy.value) return
  importForm.value = null
}

async function submitImport() {
  const form = importForm.value
  if (!form || importBusy.value) return
  importBusy.value = true
  try {
    const result = await api.warehouseImport({
      path: form.path,
      name: String(form.name || '').trim(),
      author: String(form.author || '').trim(),
      intro: String(form.intro || '').trim(),
      kind: String(form.kind || '').trim(),
      group: Number(form.group || 0),
    })
    window.__toast?.(`已导入《${result.book.name}》到书架`)
    importForm.value = null
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    importBusy.value = false
  }
}

async function importBatch() {
  if (!selected.value.length || batchBusy.value) return
  batchBusy.value = true
  try {
    const result = await api.warehouseImportBatch(selected.value, Number(batchGroup.value || 0))
    const count = result.imported?.length || 0
    const failed = result.failed?.length || 0
    window.__toast?.(`已导入 ${count} 本${failed ? `，失败 ${failed} 本` : ''}`)
    selected.value = []
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    batchBusy.value = false
  }
}

async function uploadFiles(event) {
  const files = [...(event.target.files || [])]
  event.target.value = ''
  if (!files.length) return
  if (files.length > 100) {
    window.__toast?.('一次最多导入 100 本')
    return
  }
  uploadBusy.value = true
  uploadProgress.value = { done: 0, total: files.length }
  try {
    for (const file of files) {
      await api.warehouseUpload(uploadTarget.value, file)
      uploadProgress.value = { ...uploadProgress.value, done: uploadProgress.value.done + 1 }
    }
    await load(uploadTarget.value)
    await loadRootCategories()
    window.__toast?.(`已导入 ${files.length} 本到${uploadTarget.value ? '分类' : '书仓根目录'}`)
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    uploadBusy.value = false
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

onMounted(async () => {
  await Promise.all([load(''), loadGroups(), loadRootCategories()])
})
</script>

<template>
  <div>
    <div class="page-head">
      <h1>书仓</h1>
      <span class="badge">{{ data.categories.length }} 个分类 · {{ data.files.length }} 本书</span>
      <div class="spacer" />
      <label class="warehouse-upload-target">
        <span>导入到</span>
        <select v-model="uploadTarget" :disabled="uploadBusy">
          <option value="">书仓根目录</option>
          <option v-for="category in rootCategories" :key="category.path" :value="category.path">{{ category.name }}</option>
        </select>
      </label>
      <input
        ref="fileInput"
        type="file"
        multiple
        hidden
        accept=".txt,.epub,.docx,.mobi,.azw,.azw3,.pdf"
        @change="uploadFiles"
      />
      <button class="ghost" :disabled="uploadBusy" @click="fileInput.click()">
        {{ uploadBusy ? `导入中 ${uploadProgress.done}/${uploadProgress.total}` : '批量导入书籍' }}
      </button>
      <button class="primary" @click="load()">刷新</button>
    </div>

    <p class="muted" style="font-size: 13px; margin-top: -6px">
      书仓是服务端的数据目录，文件夹即分类。把 txt / epub / docx / mobi / azw3 / pdf 放进来，可单本或批量导入书架。批量导入本地书籍一次最多 100 本。
    </p>

    <div class="row" style="margin-bottom: 12px; flex-wrap: wrap">
      <button class="ghost" @click="load('')">根目录</button>
      <template v-for="(part, index) in breadcrumbs()" :key="index">
        <span class="muted">/</span>
        <button class="ghost" @click="load(breadcrumbs().slice(0, index + 1).join('/'))">{{ part }}</button>
      </template>
      <div class="spacer" />
      <template v-if="!currentPath">
        <input v-model="newCategory" placeholder="新分类名" style="max-width: 160px" @keyup.enter="createCategory" />
        <button @click="createCategory">新建分类</button>
      </template>
      <span v-else class="muted" style="font-size: 12.5px">分类文件夹内不能新建分类</span>
    </div>

    <div v-if="loading" class="muted">加载中…</div>

    <div v-else-if="!data.categories.length && !data.files.length" class="empty">
      这个目录是空的。新建一个分类，或上传几本书进来。
    </div>

    <template v-else>
      <div v-if="data.files.length" class="warehouse-batch">
        <label class="warehouse-check">
          <input type="checkbox" :checked="allSelected" :disabled="!unimportedFiles.length" @change="toggleAll" />
          <span>全选</span>
        </label>
        <span class="muted" style="font-size: 12.5px">已选 {{ selected.length }} 本</span>
        <div class="spacer" />
        <select v-model.number="batchGroup" aria-label="导入到书架分组">
          <option v-for="group in groupOptions" :key="group.id" :value="group.id">导入到：{{ group.name }}</option>
        </select>
        <button class="primary" :disabled="!selected.length || batchBusy" @click="importBatch">
          {{ batchBusy ? '导入中…' : '批量导入书架' }}
        </button>
      </div>

      <div class="list">
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

        <div
          v-for="file in data.files"
          :key="file.path"
          class="list-item warehouse-file"
          :class="{ 'is-imported': file.imported, 'is-new': !file.imported }"
        >
          <input
            v-if="!file.imported"
            class="warehouse-file-check"
            type="checkbox"
            :checked="selected.includes(file.path)"
            :aria-label="`选择 ${file.name}`"
            @change="toggleFile(file)"
          />
          <span v-else class="warehouse-checked">✓</span>
          <span>📖</span>
          <div style="flex: 1; min-width: 0">
            <strong style="font-size: 14px">{{ file.name }}</strong>
            <div class="muted" style="font-size: 12px">{{ formatSize(file.size) }}</div>
          </div>
          <span v-if="file.imported" class="badge imported-badge">已导入书架</span>
          <button v-else class="primary" :disabled="previewBusy" @click="openImport(file)">导入书架</button>
          <button class="ghost" @click="remove(file.path)">删除</button>
        </div>
      </div>
    </template>

    <div v-if="importForm" class="dialog-backdrop" @click.self="closeImport">
      <div class="dialog">
        <div class="page-head" style="margin-bottom: 16px">
          <h1 style="font-size: 16px">书籍信息</h1>
          <div class="spacer" />
          <button class="ghost" :disabled="importBusy" @click="closeImport">关闭</button>
        </div>

        <div class="row" style="align-items: flex-start; gap: 16px; margin-bottom: 16px">
          <div class="cover" style="width: 108px; flex: none">
            <div class="placeholder">无封面</div>
          </div>
          <div style="flex: 1; min-width: 0">
            <div class="field">
              <label>书名</label>
              <input v-model="importForm.name" />
            </div>
            <div class="field">
              <label>作者</label>
              <input v-model="importForm.author" />
            </div>
          </div>
        </div>

        <div class="field">
          <label>分类</label>
          <input v-model="importForm.kind" placeholder="例如：玄幻、都市" />
        </div>

        <div class="field">
          <label>分组</label>
          <select v-model.number="importForm.group">
            <option v-for="group in groupOptions" :key="group.id" :value="group.id">{{ group.name }}</option>
          </select>
        </div>

        <div class="field">
          <label>简介</label>
          <textarea v-model="importForm.intro" rows="4" />
        </div>

        <p class="muted" style="font-size: 12.5px; margin: 0 0 8px">
          共 {{ importForm.chapterCount || 0 }} 章 · {{ formatSize(importForm.size || 0) }} · {{ importForm.path }}
        </p>

        <div class="row" style="justify-content: flex-end; margin-top: 18px">
          <button class="ghost" :disabled="importBusy" @click="closeImport">取消</button>
          <button class="primary" :disabled="importBusy" @click="submitImport">{{ importBusy ? '导入中…' : '保存' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
