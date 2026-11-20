import { reactive, watch } from 'vue'

const KEY = 'shelfCornerConfig'
const MODE_KEY = 'shelfCornerDisplayMode'
const DEFAULT = { group: 'tl', source: 'bl', status: 'tr', more: 'br' }
const DEFAULT_MODE = { group: 'always', source: 'always', status: 'always', more: 'always' }
const SLOTS = ['tl', 'tr', 'bl', 'br']
const MODES = ['always', 'hover', 'hidden']

function loadPositions() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}')
    const out = { ...DEFAULT }
    for (const key of Object.keys(DEFAULT)) {
      if (SLOTS.includes(saved[key])) out[key] = saved[key]
    }
    return out
  } catch {
    return { ...DEFAULT }
  }
}

function loadModes() {
  try {
    const saved = JSON.parse(localStorage.getItem(MODE_KEY) || '{}')
    const positions = (() => {
      try {
        return JSON.parse(localStorage.getItem(KEY) || '{}')
      } catch {
        return {}
      }
    })()
    const legacyHover = (() => {
      try {
        return JSON.parse(localStorage.getItem('shelfCornerHover') || '{}')
      } catch {
        return {}
      }
    })()
    const out = { ...DEFAULT_MODE }
    for (const key of Object.keys(DEFAULT_MODE)) {
      if (MODES.includes(saved[key])) out[key] = saved[key]
      else if (positions[key] === 'hidden') out[key] = 'hidden'
      else if (legacyHover[key]) out[key] = 'hover'
    }
    return out
  } catch {
    return { ...DEFAULT_MODE }
  }
}

export const shelfCorners = reactive(loadPositions())
export const shelfCornerModes = reactive(loadModes())

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
]

export const CORNER_MODES = [
  { value: 'always', label: '常显' },
  { value: 'hover', label: '触碰显示' },
  { value: 'hidden', label: '隐藏不显示' },
]

export function setCorner(key, slot) {
  if (!SLOTS.includes(slot) || !(key in DEFAULT)) return
  const previous = shelfCorners[key]
  for (const other of Object.keys(shelfCorners)) {
    if (other !== key && shelfCorners[other] === slot) shelfCorners[other] = previous
  }
  shelfCorners[key] = slot
}

export function setCornerMode(key, mode) {
  if (!MODES.includes(mode) || !(key in DEFAULT_MODE)) return
  shelfCornerModes[key] = mode
}

export function saveCorners() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...shelfCorners }))
    localStorage.setItem(MODE_KEY, JSON.stringify({ ...shelfCornerModes }))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('rp-shelf-corners'))
}

watch(
  () => ({ positions: { ...shelfCorners }, modes: { ...shelfCornerModes } }),
  () => saveCorners(),
  { deep: true },
)
