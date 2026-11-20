import { reactive, watch } from 'vue'

const KEY = 'shelfCornerConfig'
const DEFAULT = { group: 'tl', source: 'bl', status: 'tr', more: 'br' }
const SLOTS = ['tl', 'tr', 'bl', 'br', 'hidden']

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { ...DEFAULT, ...saved }
  } catch {
    return { ...DEFAULT }
  }
}

export const shelfCorners = reactive(load())

export const CORNER_ITEMS = [
  { key: 'group', label: '分组角标', desc: '显示书籍所属分组，未分组显示「未分组」' },
  { key: 'source', label: '来源角标', desc: '显示书源或「本地导入」' },
  { key: 'status', label: '更新/未读', desc: '有更新时显示「有更新」，否则显示未读章节数' },
  { key: 'more', label: '更多操作', desc: '右下角三个点菜单' },
]

export const CORNER_SLOTS = [
  { value: 'tl', label: '左上角' },
  { value: 'tr', label: '右上角' },
  { value: 'bl', label: '左下角' },
  { value: 'br', label: '右下角' },
  { value: 'hidden', label: '隐藏' },
]

export function setCorner(key, slot) {
  if (!SLOTS.includes(slot) || !(key in DEFAULT)) return
  const previous = shelfCorners[key]
  if (slot !== 'hidden') {
    for (const other of Object.keys(shelfCorners)) {
      if (other !== key && shelfCorners[other] === slot) shelfCorners[other] = previous === 'hidden' ? 'hidden' : previous
    }
  }
  shelfCorners[key] = slot
}

export function saveCorners() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...shelfCorners }))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('rp-shelf-corners'))
}

watch(
  () => ({ ...shelfCorners }),
  () => saveCorners(),
  { deep: true },
)
