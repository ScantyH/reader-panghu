/**
 * Thin client for the server's /reader3 contract.
 *
 * The server always answers `{isSuccess, errorMsg, data}`; unwrap it here so
 * views deal in plain values and catch real error messages.
 */

const TOKEN_KEY = 'rp_token'
export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}
export const setToken = (token) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* 忽略 */
  }
}

/** 反向代理会剥掉 Cookie 与 Authorization，用查询参数兜底 */
const withToken = (path) => {
  const token = getToken()
  if (!token) return path
  return path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token)
}

const BASE = '/reader3'

async function request(path, { method = 'GET', body, form } = {}) {
  const init = { method }
  if (form) {
    init.body = form
  } else if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const token = getToken()
  const headers = { ...(init.headers || {}) }
  if (token) headers['x-auth-token'] = token
  const response = await fetch(`${BASE}${withToken(path)}`, { ...init, headers, credentials: 'same-origin' })
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`${path} → HTTP ${response.status} ${text.slice(0, 80)}`)
  }
  if (payload.isSuccess === false) {
    if (payload.errorMsg === 'NEED_LOGIN' && !location.pathname.startsWith('/login')) {
      location.href = '/login'
    }
    throw new Error(payload.errorMsg || '请求失败')
  }
  return payload.data !== undefined ? payload.data : payload
}

export const api = {
  // auth
  getAuthMode: () => request('/getAuthMode'),
  getUserInfo: () => request('/getUserInfo'),
  login: (username, password) => request('/login', { method: 'POST', body: { username, password } }),
  register: (username, password) => request('/register', { method: 'POST', body: { username, password } }),
  logout: () => request('/logout', { method: 'POST', body: {} }),

  // shelf
  bookshelf: () => request('/getBookshelf'),
  shelfWithCache: () => request('/getShelfBookWithCacheInfo'),
  deleteBookCache: (bookUrl) => request('/deleteBookCache', { method: 'POST', body: { bookUrl } }),
  saveBook: (book) => request('/saveBook', { method: 'POST', body: book }),
  deleteBooks: (books) => request('/deleteBooks', { method: 'POST', body: books }),
  saveProgress: (bookUrl, index, position = 0, chapterTitle = '') =>
    request('/saveBookProgress', { method: 'POST', body: { bookUrl, index, position, chapterTitle } }),
  cacheBook: (bookUrl, count = 20, refresh = false, start = 0) =>
    request('/cacheBook', { method: 'POST', body: { bookUrl, count, refresh, start } }),
  checkChapterUpdates: () => request('/checkChapterUpdates', { method: 'POST', body: { limit: 30 } }),
  chapterUpdateStatus: () => request('/getChapterUpdateStatus'),
  groups: () => request('/getBookGroups'),
  saveBookGroup: (group) => request('/saveBookGroup', { method: 'POST', body: group }),
  deleteBookGroup: (groupId) => request('/deleteBookGroup', { method: 'POST', body: { groupId } }),
  reorderBookGroups: (groupIds) => request('/reorderBookGroups', { method: 'POST', body: { groupIds } }),
  saveBookGroupId: (bookUrl, groupId) => request('/saveBookGroupId', { method: 'POST', body: { bookUrl, groupId } }),
  saveGroup: (group) => request('/saveBookGroup', { method: 'POST', body: group }),
  deleteGroup: (groupId) => request('/deleteBookGroup', { method: 'POST', body: { groupId } }),

  // content
  bookInfo: (url, bookSourceUrl) => request('/getBookInfo', { method: 'POST', body: { url, bookSourceUrl } }),
  chapterList: (params) => request('/getChapterList', { method: 'POST', body: params }),
  content: (params) => request('/getBookContent', { method: 'POST', body: params }),

  // sources
  sources: () => request('/getBookSources'),
  sourceBundles: () => request('/getSourceBundles'),
  sourceBundleLimit: () => request('/getSourceBundleLimit'),
  importSources: (sources, name) => request('/importBookSources', { method: 'POST', body: { sources, name } }),
  saveSources: (sources, bundle) => request('/saveBookSources', { method: 'POST', body: bundle ? { sources, bundle } : sources }),
  renameBundle: (from, to) => request('/renameBundle', { method: 'POST', body: { from, to } }),
  mergeBundles: (names, into) => request('/mergeBundles', { method: 'POST', body: { names, into } }),
  setBundleEnabled: (bundle, enabled) => request('/setBundleEnabled', { method: 'POST', body: { bundle, enabled } }),
  deleteSource: (bookSourceUrl) => request('/deleteBookSource', { method: 'POST', body: { bookSourceUrl } }),
  testSources: (bookSourceUrls, options = {}) =>
    request('/testBookSources', { method: 'POST', body: { bookSourceUrls, ...options } }),
  setSourceEnabled: (bookSourceUrl, enabled) =>
    request('/setSourceEnabled', { method: 'POST', body: { bookSourceUrl, enabled } }),
  invalidSources: () => request('/getInvalidBookSources', { method: 'POST', body: {} }),
  deleteInvalidSources: () => request('/deleteInvalidBookSources', { method: 'POST', body: {} }),
  exploreKinds: (bookSourceUrl) => request('/getExploreKinds', { method: 'POST', body: { bookSourceUrl } }),
  exploreBook: (bookSourceUrl, url, page = 1) =>
    request('/exploreBook', { method: 'POST', body: { bookSourceUrl, url, page } }),
  debugSource: (payload) => request('/debugSource', { method: 'POST', body: payload }),
  setBookSource: (payload) => request('/setBookSource', { method: 'POST', body: payload }),
  availableSources: (payload) => request('/getAvailableBookSource', { method: 'POST', body: payload }),
  saveReadingTime: (payload) => request('/saveReadingTime', { method: 'POST', body: payload }),
  readingStats: () => request('/getReadingStats'),
  webdavList: (payload) => request('/webdavList', { method: 'POST', body: payload }),
  exportBookSources: () => fetch('/reader3/exportBookSources').then((r) => r.blob()),
  exportBackup: () => fetch('/reader3/exportBackup').then((r) => r.blob()),
  userList: () => request('/getUserList'),
  setUserRole: (payload) => request('/setUserRole', { method: 'POST', body: payload }),
  setUserSettings: (payload) => request('/setUserSettings', { method: 'POST', body: payload }),
  reorderUsers: (usernames) => request('/reorderUsers', { method: 'POST', body: { usernames } }),
  copyUserLibrary: (payload) => request('/copyUserLibrary', { method: 'POST', body: payload }),
  deleteUser: (payload) => request('/deleteUser', { method: 'POST', body: payload }),
  changePassword: (payload) => request('/changePassword', { method: 'POST', body: payload }),
  chapterNotes: (bookUrl) => request('/getChapterNotes?bookUrl=' + encodeURIComponent(bookUrl)),
  paragraphComments: (payload) => request('/getParagraphComments', { method: 'POST', body: payload }),
  paragraphCommentPanel: (payload) => request('/getParagraphCommentPanel', { method: 'POST', body: payload }),
  saveChapterNote: (payload) => request('/saveChapterNote', { method: 'POST', body: payload }),
  deleteChapterNote: (payload) => request('/deleteChapterNote', { method: 'POST', body: payload }),
  readRemoteSourceFile: (url) => request('/readSourceFile?url=' + encodeURIComponent(url)),
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
  getUserConfig: () => request('/getUserConfig'),
  saveUserConfig: (config) => request('/saveUserConfig', { method: 'POST', body: config }),

  rssSources: () => request('/getRssSources'),
  saveRssSource: (source) => request('/saveRssSource', { method: 'POST', body: source }),
  deleteRssSource: (sourceUrl) => request('/deleteRssSource', { method: 'POST', body: { sourceUrl } }),
  rssArticles: (sourceUrl) => request('/getRssArticles', { method: 'POST', body: { sourceUrl } }),
  rssContent: (link) => request('/getRssContent', { method: 'POST', body: { link } }),

  webdavBackup: (payload) => request('/webdavBackup', { method: 'POST', body: payload }),
  webdavRestore: (payload) => request('/webdavRestore', { method: 'POST', body: payload }),

  warehouse: (path = '') => request('/warehouse' + (path ? '?path=' + encodeURIComponent(path) : '')),
  warehouseMkdir: (path, name) => request('/warehouse/mkdir', { method: 'POST', body: { path, name } }),
  warehouseImport: (path) => request('/warehouse/import', { method: 'POST', body: { path } }),
  warehouseDelete: (path) => request('/warehouse/delete', { method: 'POST', body: { path } }),
  warehouseUpload: (path, file) => {
    const form = new FormData()
    form.append('file', file)
    return request('/warehouse/upload' + (path ? '?path=' + encodeURIComponent(path) : ''), { method: 'POST', form })
  },

  replaceRules: () => request('/getReplaceRules'),
  saveReplaceRule: (rule) => request('/saveReplaceRule', { method: 'POST', body: rule }),
  deleteReplaceRule: (name) => request('/deleteReplaceRule', { method: 'POST', body: { name } }),

  bookmarks: () => request('/getBookmarks'),
  saveBookmark: (bookmark) => request('/saveBookmark', { method: 'POST', body: bookmark }),
  deleteBookmark: (bookmark) => request('/deleteBookmark', { method: 'POST', body: bookmark }),
}

/** SSE multi-source search: onBooks per source batch, resolves when the stream ends. */
export function searchStream({ key, bookSourceUrl, bookSourceGroup, bookSourceBundle }, onBooks) {
  const query = new URLSearchParams({ key })
  if (bookSourceUrl) query.set('bookSourceUrl', bookSourceUrl)
  if (bookSourceGroup) query.set('bookSourceGroup', bookSourceGroup)
  if (bookSourceBundle) query.set('bookSourceBundle', bookSourceBundle)
  const source = new EventSource(`${BASE}${withToken(`/searchBookMultiSSE?${query}`)}`)
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
  // <img> 不带 x-auth-token 请求头，必须把 token 放进 query，否则只靠 Cookie 时容易 401。
  const token = getToken()
  const suffix = token ? `&token=${encodeURIComponent(token)}` : ''
  return `${BASE}/cover?path=${encodeURIComponent(url)}${suffix}`
}
