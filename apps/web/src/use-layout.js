import { ref } from 'vue'

const LAYOUT_KEY = 'desktopNavLayout'
const EXPANDED_KEY = 'desktopSidebarExpanded'

const read = (key, fallback) => {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

/** 桌面导航布局：bottom（底部胶囊） / left（左侧导航） */
export const desktopNavLayout = ref(read(LAYOUT_KEY, 'bottom'))
/** 左侧导航是否展开详细内容 */
export const sidebarExpanded = ref(read(EXPANDED_KEY, '1') !== '0')

export function setDesktopNavLayout(value) {
  desktopNavLayout.value = value === 'left' ? 'left' : 'bottom'
  try {
    localStorage.setItem(LAYOUT_KEY, desktopNavLayout.value)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('rp-layout-updated'))
}

export function toggleSidebarExpanded() {
  sidebarExpanded.value = !sidebarExpanded.value
  try {
    localStorage.setItem(EXPANDED_KEY, sidebarExpanded.value ? '1' : '0')
  } catch {
    /* ignore */
  }
}
