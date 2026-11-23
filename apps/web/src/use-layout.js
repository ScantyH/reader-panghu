import { ref } from 'vue'

const LAYOUT_KEY = 'desktopNavLayout'

const read = (key, fallback) => {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

/** 桌面导航布局：bottom（底部胶囊） / left（左侧导航） */
export const desktopNavLayout = ref(read(LAYOUT_KEY, 'bottom'))

export function setDesktopNavLayout(value) {
  desktopNavLayout.value = value === 'left' ? 'left' : 'bottom'
  try {
    localStorage.setItem(LAYOUT_KEY, desktopNavLayout.value)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('rp-layout-updated'))
}
