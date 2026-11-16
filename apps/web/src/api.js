/**
 * Thin client for the server's /reader3 contract.
 *
 * The server always answers `{isSuccess, errorMsg, data}`; unwrap it here so
 * views deal in plain values and catch real error messages.
 */

const BASE = '/reader3'

async function request(path, { method = 'GET', body, form } = {}) {
  const init = { method }
  if (form) {
    init.body = form
  } else if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const response = await fetch(`${BASE}${path}`, init)
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`${path} → HTTP ${response.status} ${text.slice(0, 80)}`)
  }
  if (payload.isSuccess === false) throw new Error(payload.errorMsg || '请求失败')
  return payload.data !== undefined ? payload.data : payload
}

export const api = {
  // shelf
  bookshelf: () => request('/getBookshelf'),
  saveBook: (book) => request('/saveBook', { method: 'POST', body: book }),
  deleteBooks: (books) => request('/deleteBooks', { method: 'POST', body: books }),
  saveProgress: (bookUrl, index, position = 0) =>
    request('/saveBookProgress', { method: 'POST', body: { bookUrl, index, position } }),
  groups: () => request('/getBookGroups'),
  saveGroup: (group) => request('/saveBookGroup', { method: 'POST', body: group }),
  deleteGroup: (groupId) => request('/deleteBookGroup', { method: 'POST', body: { groupId } }),

  // content
  bookInfo: (url, bookSourceUrl) => request('/getBookInfo', { method: 'POST', body: { url, bookSourceUrl } }),
  chapterList: (params) => request('/getChapterList', { method: 'POST', body: params }),
  content: (params) => request('/getBookContent', { method: 'POST', body: params }),

  // sources
  sources: () => request('/getBookSources'),
  saveSources: (sources) => request('/saveBookSources', { method: 'POST', body: sources }),
  deleteSource: (bookSourceUrl) => request('/deleteBookSource', { method: 'POST', body: { bookSourceUrl } }),
  testSources: (bookSourceUrls) => request('/testBookSources', { method: 'POST', body: { bookSourceUrls } }),
  importSourceFile: (file) => {
    const form = new FormData()
    form.append('file', file)
    return request('/readSourceFile', { method: 'POST', form })
  },

  // local books
  uploadLocal: (file) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    const routes = { epub: '/uploadEpubBook', docx: '/uploadDocxBook', mobi: '/uploadMobiBook', azw3: '/uploadMobiBook', azw: '/uploadMobiBook', pdf: '/uploadPdfBook' }
    const route = routes[ext] || '/uploadTxtBook'
    const form = new FormData()
    form.append('file', file)
    return request(route, { method: 'POST', form })
  },
  uploadCover: (bookUrl, file) => {
    const form = new FormData()
    form.append('file', file)
    return request(`/uploadBookCover?bookUrl=${encodeURIComponent(bookUrl)}`, { method: 'POST', form })
  },

  // bookmarks
  bookmarks: () => request('/getBookmarks'),
  saveBookmark: (bookmark) => request('/saveBookmark', { method: 'POST', body: bookmark }),
}

/** SSE multi-source search: onBooks per source batch, resolves when the stream ends. */
export function searchStream({ key, bookSourceUrl, bookSourceGroup }, onBooks) {
  const query = new URLSearchParams({ key })
  if (bookSourceUrl) query.set('bookSourceUrl', bookSourceUrl)
  if (bookSourceGroup) query.set('bookSourceGroup', bookSourceGroup)
  const source = new EventSource(`${BASE}/searchBookMultiSSE?${query}`)
  return new Promise((resolve, reject) => {
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (Array.isArray(payload?.data)) onBooks(payload.data)
      } catch {
        /* ignore malformed frame */
      }
    }
    source.addEventListener('end', () => {
      source.close()
      resolve()
    })
    source.onerror = () => {
      source.close()
      reject(new Error('搜索连接中断'))
    }
  })
}

export const coverOf = (book) => {
  if (!book) return ''
  if (book.customCoverUrl) return book.customCoverUrl
  const url = book.coverUrl || ''
  if (!url) return ''
  return `${BASE}/cover?path=${encodeURIComponent(url)}`
}
