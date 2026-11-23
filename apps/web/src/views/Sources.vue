<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from '../api.js'
import { useSortable } from '../use-sortable.js'
import Rss from './Rss.vue'

const TAB = { manage: '管理', explore: '探索', rss: 'RSS', check: '检测', debug: '调试' }
const tab = ref('manage')
const sources = ref([])
const loading = ref(false)
const keywordFilter = ref('')
const groupFilter = ref('')
const fileInput = ref(null)
const remoteUrl = ref('')
const editing = ref(null)

// 检测
const checkKeyword = ref('斗罗')
const checking = ref(false)
const checkResults = ref([])
const checkProgress = ref('')
const markInvalid = ref(true)

// 探索
const exploreSource = ref('')
const exploreKinds = ref([])
const exploreBooks = ref([])
const exploreLoading = ref(false)

// 调试
const debugSource = ref('')
const debugKeyword = ref('斗罗')
const debugStage = ref('search')
const debugUrl = ref('')
const debugResult = ref(null)
const debugLoading = ref(false)

// 线路切换
const linesSource = ref(null)
const sourceLines = ref([])
const lineCurrent = ref('')
const lineLoading = ref(false)
const lineBusy = ref(false)

async function openSourceLines(source) {
  linesSource.value = source
  sourceLines.value = []
  lineCurrent.value = ''
  lineLoading.value = true
  try {
    const result = await api.sourceLines(source.bookSourceUrl)
    sourceLines.value = result?.lines || []
    lineCurrent.value = result?.current || ''
    if (!sourceLines.value.length) window.__toast?.('该书源没有可切换的线路')
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    lineLoading.value = false
  }
}

async function measureSourceLines() {
  if (!linesSource.value) return
  lineLoading.value = true
  try {
    const result = await api.sourceLines(linesSource.value.bookSourceUrl)
    sourceLines.value = result?.lines || []
    lineCurrent.value = result?.current || ''
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    lineLoading.value = false
  }
}

async function switchSourceLine(line) {
  if (!linesSource.value || lineBusy.value) return
  lineBusy.value = true
  try {
    await api.setSourceLine(linesSource.value.bookSourceUrl, line)
    lineCurrent.value = line.url
    window.__toast?.(`已切换到「${line.name}」`)
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    lineBusy.value = false
  }
}

async function useFastestLine() {
  const fastest = [...sourceLines.value].filter((line) => line.ok && line.latency >= 0).sort((a, b) => a.latency - b.latency)[0]
  if (!fastest) {
    window.__toast?.('暂时没有可用线路')
    return
  }
  await switchSourceLine(fastest)
}

function lineLatencyClass(line) {
  if (!line.ok || line.latency < 0) return 'bad'
  if (line.latency < 300) return 'good'
  if (line.latency < 900) return 'mid'
  return 'slow'
}

const expanded = ref('')
const bundleLimit = ref(100)
const keyChecking = ref(false)
let keyCheckRunning = false

/** 按导入批次汇总 */
const bundles = computed(() => {
  const map = new Map()
  for (const source of sources.value) {
    const name = String(source._bundle || '未归类')
    if (!map.has(name)) map.set(name, { name, count: 0, enabledCount: 0 })
    const row = map.get(name)
    row.count += 1
    if (source.enabled !== false) row.enabledCount += 1
  }
  return [...map.values()]
})

/** 给批次改名（备注） */
async function renameBundle(bundle) {
  const next = prompt('这一批书源的名称', bundle.name)
  if (!next || !next.trim() || next.trim() === bundle.name) return
  try {
    const result = await api.renameBundle(bundle.name, next.trim())
    expanded.value = result.renamed ? next.trim() : expanded.value
    await load()
    window.__toast?.('已重命名为「' + next.trim() + '」')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/** 勾选批次用于合并 */
const picked = ref([])

function togglePicked(name) {
  picked.value = picked.value.includes(name)
    ? picked.value.filter((item) => item !== name)
    : [...picked.value, name]
}

/** 合并选中批次 */
async function mergePicked() {
  if (picked.value.length < 2) {
    window.__toast?.('至少选择两个批次')
    return
  }
  const defaultName = `汇总 ${new Date().toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
  const target = prompt('汇总后的批次名称', defaultName)
  if (target === null) return
  const into = (target || defaultName).trim()
  if (!confirm(`把 ${picked.value.length} 个批次汇总为「${into}」？`)) return
  try {
    const result = await api.mergeBundles(picked.value, into)
    picked.value = []
    await load()
    window.__toast?.(`已汇总 ${result.merged} 个书源到「${into}」`)
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/** 整批启用 / 停用 */
async function toggleBundle(bundle, enabled) {
  try {
    await api.setBundleEnabled(bundle.name, enabled)
    await load()
    window.__toast?.(enabled ? '已启用「' + bundle.name + '」' : '已关闭「' + bundle.name + '」')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/** 整批上移 / 下移：按批次块重排，搜索顺序也跟着变 */
async function moveBundle(bundle, delta) {
  const names = bundles.value.map((item) => item.name)
  const index = names.indexOf(bundle.name)
  const target = index + delta
  if (index < 0 || target < 0 || target >= names.length) return
  ;[names[index], names[target]] = [names[target], names[index]]
  const urls = []
  for (const name of names) {
    for (const source of sources.value) {
      if (String(source._bundle || '未归类') === name) urls.push(source.bookSourceUrl)
    }
  }
  try {
    await api.reorderSources(urls)
    await load()
    window.__toast?.('批次顺序已保存')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

const groups = computed(() => [...new Set(sources.value.map((item) => item.bookSourceGroup || ''))].filter(Boolean))
const filtered = computed(() =>
  sources.value.filter((source) => {
    if (expanded.value && String(source._bundle || '未归类') !== expanded.value) return false
    if (groupFilter.value && (source.bookSourceGroup || '') !== groupFilter.value) return false
    const q = keywordFilter.value.trim()
    if (!q) return true
    return (source.bookSourceName || '').includes(q) || (source.bookSourceUrl || '').includes(q)
  }),
)
const exploreable = computed(() => sources.value.filter((item) => item.exploreUrl || item.ruleExplore?.findUrl))
const invalidCount = computed(() => sources.value.filter((item) => item.invalid === true).length)
const webviewCount = computed(() => sources.value.filter((item) => item.html).length)

async function load() {
  loading.value = true
  try {
    const [list, limit] = await Promise.all([api.sources(), api.sourceBundleLimit().catch(() => ({ limit: 100 }))])
    sources.value = list
    bundleLimit.value = Number(limit?.limit) || 100
    void maybeCheckKeys(list)
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

/** 打开书源页时，若密钥状态超过 1 小时就自动检测一次 */
async function maybeCheckKeys(list) {
  if (keyCheckRunning) return
  const stale = list.some((source) => source.hasKey && Date.now() - Number(source.keyCheck?.checkedAt || 0) >= 60 * 60 * 1000)
  if (!stale) return
  keyCheckRunning = true
  keyChecking.value = true
  try {
    await api.checkSourceKeys()
    sources.value = await api.sources()
  } catch {
    /* 检测失败下次再试 */
  } finally {
    keyCheckRunning = false
    keyChecking.value = false
  }
}

function keyBadgeText(source) {
  if (!source.hasKey) return '未设密钥'
  if (!source.keyCheck) return '密钥待检测'
  return source.keyCheck.valid ? '密钥有效' : '密钥失效'
}

function keyBadgeClass(source) {
  if (!source.hasKey) return ''
  if (!source.keyCheck) return ''
  return source.keyCheck.valid ? 'accent' : ''
}

function keyBadgeTitle(source) {
  if (!source.hasKey) return '点「密钥」填写'
  const check = source.keyCheck
  if (!check) return '等待自动检测'
  const time = check.checkedAt ? new Date(check.checkedAt).toLocaleString('zh-CN', { hour12: false }) : ''
  return `${check.message || ''} ${time}`.trim()
}

async function importFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    const parsed = await api.importSourceFile(file)
    if (!parsed.length) throw new Error('文件里没有解析出书源')
    const result = await api.importSources(parsed, file.name.replace(/\.json$/i, ''))
    window.__toast?.(`已导入 ${parsed.length} 个书源，新批次「${result.bundle}」`)
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    event.target.value = ''
  }
}

async function exportSources() {
  const blob = await api.exportBookSources()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'book-sources.json'
  link.click()
  URL.revokeObjectURL(url)
  window.__toast?.('已导出 ' + sources.value.length + ' 个书源')
}

async function importRemote() {
  const url = remoteUrl.value.trim()
  if (!url) return
  try {
    const list = await api.readRemoteSourceFile(url)
    const parsed = list.map((item) => (typeof item === 'string' ? JSON.parse(item) : item))
    const result = await api.importSources(parsed, '远程订阅')
    window.__toast?.(`已从远程导入 ${parsed.length} 个书源，新批次「${result.bundle}」`)
    remoteUrl.value = ''
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/** 设置 WebView 书源的密钥：只在服务端保存，界面不显示明文 */
async function editSourceKey(source) {
  const current = source.hasKey ? `当前已设置（末四位 ${source.keyHint || '****'}），留空则清除` : '当前尚未设置'
  const input = prompt(`输入「${source.bookSourceName}」的书源密钥\n${current}`, '')
  if (input === null) return
  try {
    const result = await api.setSourceKey(source.bookSourceUrl, input.trim())
    await load()
    window.__toast?.(result.hasKey ? '书源密钥已保存' : '已清除书源密钥')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function removeSource(source) {
  if (!confirm(`删除书源「${source.bookSourceName}」？`)) return
  try {
    await api.deleteSource(source.bookSourceUrl)
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function toggle(source) {
  try {
    const next = source.enabled === false
    await api.setSourceEnabled(source.bookSourceUrl, next)
    source.enabled = next
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/** 保存书源顺序：搜索“全部书源”时也按这个顺序跑 */
async function saveSourceOrder() {
  await api.reorderSources(sources.value.map((item) => item.bookSourceUrl))
}

const bundleNameOf = (source) => String(source._bundle || '未归类')
const bundleIds = computed(() => bundles.value.map((bundle) => bundle.name))
const expandedSourceIds = computed(() =>
  sources.value.filter((source) => bundleNameOf(source) === expanded.value).map((source) => source.bookSourceUrl),
)

function rebuildByBundleOrder(names) {
  const list = []
  for (const name of names) {
    for (const source of sources.value) {
      if (bundleNameOf(source) === name) list.push(source)
    }
  }
  sources.value = list
}

function moveBundleBlock(from, to) {
  const names = [...bundleIds.value]
  const [name] = names.splice(from, 1)
  names.splice(to, 0, name)
  rebuildByBundleOrder(names)
}

const {
  start: startBundleDrag,
  cancel: cancelBundleDrag,
  draggingId: bundleDraggingId,
} = useSortable({
  getIds: () => bundleIds.value,
  move: moveBundleBlock,
  onCommit: async () => {
    try {
      await saveSourceOrder()
      window.__toast?.('批次顺序已保存')
    } catch (error) {
      window.__toast?.(error.message)
    }
  },
})

function moveSourceBlock(from, to) {
  const ids = expandedSourceIds.value
  const fromUrl = ids[from]
  const toUrl = ids[to]
  const list = [...sources.value]
  const fromIndex = list.findIndex((source) => source.bookSourceUrl === fromUrl)
  if (fromIndex < 0) return
  const [item] = list.splice(fromIndex, 1)
  const toIndex = list.findIndex((source) => source.bookSourceUrl === toUrl)
  list.splice(toIndex < 0 ? fromIndex : toIndex, 0, item)
  sources.value = list
}

const {
  start: startSourceDrag,
  cancel: cancelSourceDrag,
  draggingId: sourceDraggingId,
} = useSortable({
  getIds: () => expandedSourceIds.value,
  move: moveSourceBlock,
  onCommit: async () => {
    try {
      await saveSourceOrder()
      window.__toast?.('书源顺序已保存')
    } catch (error) {
      window.__toast?.(error.message)
    }
  },
})

async function pinBundle(bundle) {
  const names = bundleIds.value.filter((name) => name !== bundle.name)
  names.unshift(bundle.name)
  rebuildByBundleOrder(names)
  try {
    await saveSourceOrder()
    window.__toast?.(`已把「${bundle.name}」固定在顶部`)
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function pinSource(source) {
  const list = [...sources.value]
  const index = list.findIndex((item) => item.bookSourceUrl === source.bookSourceUrl)
  if (index <= 0) return
  const [item] = list.splice(index, 1)
  list.unshift(item)
  sources.value = list
  try {
    await saveSourceOrder()
    window.__toast?.(`已把「${source.bookSourceName}」固定在顶部，全部书源搜索会先搜它`)
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function saveEdited(json) {
  try {
    const parsed = JSON.parse(json)
    await api.saveSources([parsed])
    editing.value = null
    await load()
    window.__toast?.('书源已保存')
  } catch (error) {
    window.__toast?.(`保存失败：${error.message}`)
  }
}

async function runCheck() {
  const targets = filtered.value.map((item) => item.bookSourceUrl)
  if (!targets.length) return
  checking.value = true
  checkResults.value = []
  const total = targets.length
  let done = 0
  const concurrency = 5
  let cursor = 0
  const worker = async () => {
    while (cursor < targets.length) {
      const bookSourceUrl = targets[cursor++]
      try {
        const report = await api.testSources([bookSourceUrl], {
          keyword: checkKeyword.value.trim() || '斗罗',
          markInvalid: markInvalid.value,
        })
        const item = report.results?.[0]
        checkResults.value = [...checkResults.value, item ?? { bookSourceUrl, valid: false, searchError: '无返回' }]
      } catch (error) {
        checkResults.value = [...checkResults.value, { bookSourceUrl, valid: false, searchError: error.message }]
      }
      done += 1
      checkProgress.value = `${done}/${total}`
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  checking.value = false
  await load()
  const okCount = checkResults.value.filter((item) => item.valid).length
  window.__toast?.(`检测完成：可用 ${okCount} / ${total}`)
}

async function purgeInvalid() {
  const list = await api.invalidSources()
  if (!list.length) {
    window.__toast?.('没有标记为失效的书源')
    return
  }
  if (!confirm(`删除 ${list.length} 个已标记失效的书源？`)) return
  try {
    const result = await api.deleteInvalidSources()
    window.__toast?.(`已删除 ${result.deleted} 个`)
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function loadKinds() {
  if (!exploreSource.value) return
  exploreLoading.value = true
  exploreBooks.value = []
  try {
    exploreKinds.value = await api.exploreKinds(exploreSource.value)
    if (!exploreKinds.value.length) window.__toast?.('这个书源没有探索分类')
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    exploreLoading.value = false
  }
}

async function openKind(kind) {
  exploreLoading.value = true
  try {
    exploreBooks.value = await api.exploreBook(exploreSource.value, kind.url, 1)
    if (!exploreBooks.value.length) window.__toast?.('该分类没有取到书籍')
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    exploreLoading.value = false
  }
}

async function runDebug() {
  if (!debugSource.value) {
    window.__toast?.('先选一个书源')
    return
  }
  debugLoading.value = true
  debugResult.value = null
  try {
    debugResult.value = await api.debugSource({
      bookSourceUrl: debugSource.value,
      stage: debugStage.value,
      keyword: debugKeyword.value,
      url: debugUrl.value,
    })
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    debugLoading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <h1>书源</h1>
      <span class="badge">{{ sources.length }} 个 · WebView {{ webviewCount }} · 失效 {{ invalidCount }}</span>
      <div class="spacer" />
      <button class="ghost" :disabled="loading" @click="load">刷新</button>
    </div>

    <div class="group-tabs">
      <button v-for="(label, key) in TAB" :key="key" class="group-tab" :class="{ active: tab === key }" @click="tab = key">
        {{ label }}
      </button>
    </div>

    <!-- 管理 -->
    <section v-if="tab === 'manage'">
      <p class="muted" style="font-size: 13px; margin: 0 0 10px">
        按导入批次汇总，共 {{ bundles.length }}/{{ bundleLimit }} 个批次。可长按 ≡ 拖动排序，或点「固定」置顶；「全部书源」搜索会按这个顺序优先搜索。设置了密钥的 WebView 书源每小时自动检测一次，状态显示在书源行里；点「密钥」可填写或更新。
      </p>

      <!-- 导入汇总：按批次展示，iOS 风格开关 -->
      <div v-if="picked.length" class="row merge-bar">
        <span class="badge">已选 {{ picked.length }} 个批次</span>
        <div class="spacer" />
        <button class="ghost" @click="picked = []">取消</button>
        <button class="primary" @click="mergePicked">汇总选中批次</button>
      </div>

      <div class="bundle-list">
        <div
          v-for="bundle in bundles"
          :key="bundle.name"
          class="bundle-card"
          :class="{ active: expanded === bundle.name, picked: picked.includes(bundle.name), dragging: bundleDraggingId === bundle.name }"
          :data-sort-id="bundle.name"
        >
          <span class="sort-handle" title="长按拖动排序" @pointerdown.prevent="startBundleDrag($event, bundle.name)" @pointerup="cancelBundleDrag">≡</span>
          <input class="bundle-pick" type="checkbox" :checked="picked.includes(bundle.name)" title="选中用于汇总" @click.stop="togglePicked(bundle.name)" />
          <div class="bundle-info" @click="expanded = expanded === bundle.name ? '' : bundle.name">
            <div class="bundle-name">{{ bundle.name }}</div>
            <div class="bundle-sub">{{ bundle.count }} 个书源 · 已启用 {{ bundle.enabledCount }}</div>
          </div>
          <label class="switch" :title="bundle.enabledCount ? '关闭该批书源' : '启用该批书源'">
            <input
              type="checkbox"
              :checked="bundle.enabledCount > 0"
              @change="toggleBundle(bundle, $event.target.checked)"
            />
            <span class="switch-track"><span class="switch-thumb" /></span>
          </label>
          <button class="ghost" title="固定到顶部" @click="pinBundle(bundle)">固定</button>
          <button class="ghost" title="重命名" @click="renameBundle(bundle)">备注</button>
          <button class="ghost bundle-toggle" @click="expanded = expanded === bundle.name ? '' : bundle.name">
            {{ expanded === bundle.name ? '收起' : '详情' }}
          </button>
        </div>
      </div>

      <template v-if="expanded">
        <div class="row" style="margin: 14px 0 10px; flex-wrap: wrap">
          <span class="badge">{{ expanded }} · {{ filtered.length }} 个</span>
          <div class="spacer" />
          <input v-model="keywordFilter" placeholder="搜索名称或地址" style="min-width: 180px" />
        </div>

        <div v-if="!filtered.length" class="empty">没有匹配的书源</div>
        <div v-else class="list">
          <div
            v-for="source in filtered"
            :key="source.bookSourceUrl"
            class="list-item"
            :class="{ dragging: sourceDraggingId === source.bookSourceUrl }"
            :data-sort-id="source.bookSourceUrl"
          >
            <span class="sort-handle" title="长按拖动排序" @pointerdown.prevent="startSourceDrag($event, source.bookSourceUrl)" @pointerup="cancelSourceDrag">≡</span>
            <div style="flex: 1; min-width: 0">
              <div class="row" style="gap: 6px; flex-wrap: wrap">
                <strong>{{ source.bookSourceName }}</strong>
                <span class="badge" :class="{ accent: source.html }">{{ source.html ? 'WebView' : '规则' }}</span>
                <span v-if="source.bookSourceGroup" class="badge">{{ source.bookSourceGroup }}</span>
                <span
                  v-if="source.html"
                  class="badge"
                  :class="keyBadgeClass(source)"
                  :title="keyBadgeTitle(source)"
                  :style="source.hasKey && source.keyCheck && !source.keyCheck.valid ? 'color: var(--color-danger)' : ''"
                >
                  {{ keyBadgeText(source) }}
                </span>
                <span v-if="source.invalid" class="badge" style="color: var(--color-danger)">失效</span>
                <span v-if="source.enabled === false" class="badge">已禁用</span>
              </div>
              <div class="muted" style="font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                {{ source.bookSourceUrl }}
              </div>
            </div>
            <button class="ghost" title="固定到顶部，全部书源搜索时最先搜它" @click="pinSource(source)">固定</button>
            <button v-if="source.html" class="ghost" @click="openSourceLines(source)">线路</button>
            <button v-if="source.html" class="ghost" @click="editSourceKey(source)">密钥</button>
            <button class="ghost" @click="toggle(source)">{{ source.enabled === false ? '启用' : '禁用' }}</button>
            <button class="ghost" @click="editing = JSON.stringify(source, null, 2)">编辑</button>
            <button class="ghost" @click="removeSource(source)">删除</button>
          </div>
        </div>
      </template>

      <div class="row" style="margin: 16px 0 12px; flex-wrap: wrap">
        <input ref="fileInput" type="file" accept=".json" hidden @change="importFile" />
        <button class="primary" @click="fileInput.click()">导入文件</button>
        <button @click="exportSources">导出</button>
        <input v-model="remoteUrl" placeholder="远程书源地址（订阅链接）" style="flex: 1; min-width: 200px" @keyup.enter="importRemote" />
        <button @click="importRemote">从 URL 导入</button>
      </div>
    </section>

    <!-- 探索 -->
    <section v-if="tab === 'explore'">
      <div class="row" style="margin-bottom: 16px; flex-wrap: wrap">
        <select v-model="exploreSource" style="flex: 1; max-width: 420px" @change="loadKinds">
          <option value="">选择带探索规则的书源（{{ exploreable.length }} 个可用）</option>
          <option v-for="source in exploreable" :key="source.bookSourceUrl" :value="source.bookSourceUrl">
            {{ source.bookSourceName }}
          </option>
        </select>
        <button :disabled="exploreLoading || !exploreSource" @click="loadKinds">
          {{ exploreLoading ? '加载中…' : '加载分类' }}
        </button>
      </div>

      <div v-if="exploreKinds.length" class="group-tabs">
        <button v-for="kind in exploreKinds" :key="kind.title" class="group-tab" @click="openKind(kind)">{{ kind.title }}</button>
      </div>

      <div v-if="exploreBooks.length" class="grid">
        <div v-for="book in exploreBooks" :key="book.bookUrl" class="card">
          <div class="cover">
            <img v-if="book.coverUrl" :src="book.coverUrl" :alt="book.name" loading="lazy" />
            <div v-else class="placeholder">{{ book.name }}</div>
          </div>
          <h3>{{ book.name }}</h3>
          <p>{{ book.author }}</p>
        </div>
      </div>
      <div v-else-if="!exploreLoading" class="empty">选一个书源和分类，这里会显示书籍。</div>
    </section>

    <!-- RSS 订阅（并入书源功能区） -->
    <section v-if="tab === 'rss'">
      <Rss embedded />
    </section>

    <!-- 检测 -->
    <section v-if="tab === 'check'">
      <div class="row" style="margin-bottom: 12px; flex-wrap: wrap">
        <input v-model="checkKeyword" placeholder="测试关键词" style="max-width: 200px" />
        <label class="row" style="gap: 6px; font-size: 13px">
          <input v-model="markInvalid" type="checkbox" style="width: auto" /> 标记失效
        </label>
        <div class="spacer" />
        <span v-if="checkProgress" class="badge">{{ checkProgress }}</span>
        <button class="primary" :disabled="checking" @click="runCheck">
          {{ checking ? '检测中…' : `检测 ${filtered.length} 个书源` }}
        </button>
        <button class="ghost" @click="purgeInvalid">删除已标记失效</button>
      </div>

      <div v-if="!checkResults.length" class="empty">用关键词跑一遍，能搜到书的算可用。</div>
      <div v-else class="list">
        <div v-for="item in checkResults" :key="item.bookSourceUrl" class="list-item">
          <span class="badge" :class="{ accent: item.valid }">{{ item.valid ? '可用' : '失效' }}</span>
          <div style="flex: 1; min-width: 0">
            <strong>{{ item.bookSourceName || item.bookSourceUrl }}</strong>
            <div class="muted" style="font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
              {{ item.valid ? '搜索正常' : (item.searchError || '没有结果') }}
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 调试 -->
    <section v-if="tab === 'debug'">
      <div class="row" style="margin-bottom: 12px; flex-wrap: wrap">
        <select v-model="debugSource" style="flex: 1; max-width: 420px">
          <option value="">选择书源</option>
          <option v-for="source in sources" :key="source.bookSourceUrl" :value="source.bookSourceUrl">
            {{ source.bookSourceName }}
          </option>
        </select>
        <select v-model="debugStage" style="max-width: 140px">
          <option value="search">搜索</option>
          <option value="info">详情</option>
          <option value="toc">目录</option>
          <option value="content">正文</option>
        </select>
      </div>
      <div class="row" style="margin-bottom: 12px; flex-wrap: wrap">
        <input v-if="debugStage === 'search'" v-model="debugKeyword" placeholder="关键词" style="max-width: 240px" />
        <input v-else v-model="debugUrl" placeholder="页面地址（书籍/目录/章节）" style="flex: 1" />
        <button class="primary" :disabled="debugLoading" @click="runDebug">{{ debugLoading ? '执行中…' : '执行' }}</button>
      </div>

      <div v-if="debugResult">
        <div class="row" style="margin-bottom: 8px; flex-wrap: wrap">
          <span class="badge" :class="{ accent: debugResult.ok }">{{ debugResult.ok ? '成功' : '失败' }}</span>
          <span class="badge">{{ debugResult.elapsedMs }}ms</span>
          <span class="muted" style="font-size: 12px; word-break: break-all">{{ debugResult.request }}</span>
        </div>
        <div v-if="debugResult.error" class="list-item" style="border-color: var(--color-danger)">
          <span style="color: var(--color-danger)">{{ debugResult.error }}</span>
        </div>

        <h3 style="font-size: 14px; margin: 16px 0 8px">解析结果</h3>
        <pre class="debug-pre">{{ JSON.stringify(debugResult.parsed, null, 2) }}</pre>

        <h3 style="font-size: 14px; margin: 16px 0 8px">原始响应（前 4000 字符）</h3>
        <pre class="debug-pre">{{ debugResult.raw || '(WebView 书源没有原始 HTML)' }}</pre>
      </div>
      <div v-else-if="!debugLoading" class="empty">选书源和阶段，点执行查看每一步的原始响应与解析结果。</div>
    </section>

    <!-- 线路切换 -->
    <div v-if="linesSource" class="dialog-backdrop" @click.self="linesSource = null">
      <div class="dialog" style="max-width: 520px">
        <div class="page-head" style="margin-bottom: 12px">
          <h1 style="font-size: 16px">线路选择</h1>
          <div class="spacer" />
          <button class="ghost" @click="linesSource = null">关闭</button>
        </div>
        <p class="muted" style="font-size: 12.5px; margin: 0 0 10px">
          {{ linesSource.bookSourceName }} · 点击线路切换，测速结果仅供参考
        </p>
        <div v-if="lineLoading" class="muted" style="padding: 18px 0">正在测速…</div>
        <div v-else-if="!sourceLines.length" class="empty">该书源没有可切换的线路。</div>
        <div v-else class="line-list">
          <button
            v-for="line in sourceLines"
            :key="line.url"
            class="line-item"
            :class="{ active: line.url === lineCurrent }"
            :disabled="lineBusy"
            @click="switchSourceLine(line)"
          >
            <span class="line-dot" :class="lineLatencyClass(line)" />
            <span class="line-name">{{ line.name }}</span>
            <span class="line-latency" :class="lineLatencyClass(line)">
              {{ line.ok && line.latency >= 0 ? line.latency + 'ms' : '超时' }}
            </span>
            <span v-if="line.url === lineCurrent" class="badge accent">当前</span>
          </button>
        </div>
        <div class="row" style="justify-content: flex-end; margin-top: 14px">
          <button class="ghost" :disabled="lineLoading || lineBusy" @click="measureSourceLines">重新测速</button>
          <button class="ghost" :disabled="lineLoading || lineBusy || !sourceLines.length" @click="useFastestLine">使用最快线路</button>
          <button class="primary" @click="linesSource = null">完成</button>
        </div>
      </div>
    </div>

    <!-- 编辑抽屉 -->
    <div v-if="editing" class="sheet-backdrop" @click.self="editing = null">
      <div class="sheet" style="width: min(760px, 100%)">
        <div class="sheet-handle" />
        <h2>编辑书源</h2>
        <textarea v-model="editing" rows="18" style="font-family: ui-monospace, monospace; font-size: 12.5px" />
        <div class="row" style="justify-content: flex-end; margin-top: 12px">
          <button class="ghost" @click="editing = null">取消</button>
          <button class="primary" @click="saveEdited(editing)">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>
