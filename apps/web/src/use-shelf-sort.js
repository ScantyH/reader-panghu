import { ref } from 'vue'

const KEY = 'shelfSort'

export const SHELF_SORT_OPTIONS = [
  { value: 'latest', label: '最近变动', desc: '新加入或最近阅读的书排在最前' },
  { value: 'added', label: '最近加入', desc: '按加入书架的时间排序' },
  { value: 'read', label: '最近阅读', desc: '按最后一次阅读时间排序' },
  { value: 'title', label: '书名 A-Z', desc: '按书名拼音排序' },
  { value: 'author', label: '作者 A-Z', desc: '按作者拼音排序，同作者再按书名' },
]

const VALUES = new Set(SHELF_SORT_OPTIONS.map((option) => option.value))

const read = () => {
  try {
    const value = localStorage.getItem(KEY) || 'latest'
    return VALUES.has(value) ? value : 'latest'
  } catch {
    return 'latest'
  }
}

export const shelfSort = ref(read())

export function setShelfSort(value) {
  shelfSort.value = VALUES.has(value) ? value : 'latest'
  try {
    localStorage.setItem(KEY, shelfSort.value)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('rp-shelf-sort-updated'))
}

const timestamp = (book) => Math.max(Number(book?.addedAt || 0), Number(book?.durChapterTime || 0))

const text = (value) => String(value || '').trim()

const byTitle = (a, b) => text(a.name).localeCompare(text(b.name), 'zh-Hans-CN')

/**
 * 书架排序。
 * 注意：发现新章节只显示角标，不参与排序，不会把书顶到最前。
 */
export function sortBooks(books, mode = shelfSort.value) {
  return [...books].sort((a, b) => {
    if (mode === 'added') {
      const byAdded = Number(b.addedAt || 0) - Number(a.addedAt || 0)
      if (byAdded) return byAdded
      const byRead = Number(b.durChapterTime || 0) - Number(a.durChapterTime || 0)
      return byRead || byTitle(a, b)
    }
    if (mode === 'read') {
      const byRead = Number(b.durChapterTime || 0) - Number(a.durChapterTime || 0)
      return byRead || byTitle(a, b)
    }
    if (mode === 'title') return byTitle(a, b)
    if (mode === 'author') {
      const byAuthor = text(a.author).localeCompare(text(b.author), 'zh-Hans-CN')
      return byAuthor || byTitle(a, b)
    }
    const byActivity = timestamp(b) - timestamp(a)
    return byActivity || byTitle(a, b)
  })
}
