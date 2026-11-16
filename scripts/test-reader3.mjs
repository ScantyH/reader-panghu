/**
 * End-to-end smoke test for the /reader3 contract.
 *
 *   node scripts/test-reader3.mjs [baseUrl] [keyword]
 *
 * Exercises the same calls the reader-next UI makes, in order, and fails loudly
 * on the first broken step.
 */

const base = (process.argv[2] || 'http://127.0.0.1:18086').replace(/\/+$/, '')
const keyword = process.argv[3] || '大奉打更人'

const call = async (path, { method = 'GET', body } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`${path} → non-JSON response (${response.status}): ${text.slice(0, 120)}`)
  }
  if (payload && payload.isSuccess === false) throw new Error(`${path} → ${payload.errorMsg}`)
  return payload?.data !== undefined ? payload.data : payload
}

const step = async (label, run) => {
  const started = Date.now()
  const value = await run()
  const summary = Array.isArray(value) ? `${value.length} item(s)` : typeof value === 'string' ? `${value.length} chars` : 'ok'
  console.log(`  ✓ ${label} (${Date.now() - started}ms, ${summary})`)
  return value
}

console.log(`base: ${base}`)

const sources = await step('getBookSources', () => call('/reader3/getBookSources'))
const source = sources.find((item) => item.html)
if (!source) throw new Error('没有可执行的 WebView 书源，先导入一个（POST /reader3/saveBookSources）')
console.log(`  source: ${source.bookSourceName} (${source.bookSourceUrl})`)

await step('getBookshelf', () => call('/reader3/getBookshelf'))

const results = await step('searchBookMulti', () =>
  call('/reader3/searchBookMulti', { method: 'POST', body: { key: keyword } }),
)
if (!results.length) throw new Error('搜索没有结果')
const found = results[0]
console.log(`  first: ${found.name} / ${found.author} (${found.originName})`)

const info = await step('getBookInfo', () =>
  call('/reader3/getBookInfo', { method: 'POST', body: { url: found.bookUrl, bookSourceUrl: found.origin } }),
)

const shelf = await step('saveBook', () => call('/reader3/saveBook', { method: 'POST', body: info }))
console.log(`  shelf: ${shelf.name}`)

const chapters = await step('getChapterList', () =>
  call('/reader3/getChapterList', { method: 'POST', body: { bookUrl: shelf.bookUrl, tocUrl: shelf.tocUrl, bookSourceUrl: shelf.origin } }),
)
if (!chapters.length) throw new Error('目录为空')

const content = await step('getBookContent', () =>
  call('/reader3/getBookContent', { method: 'POST', body: { bookUrl: shelf.bookUrl, index: 0, bookSourceUrl: shelf.origin } }),
)
console.log(`  content: ${content.slice(0, 40).replace(/\n/g, ' ')}…`)

const savedAt = await step('saveBookProgress', () =>
  call('/reader3/saveBookProgress', { method: 'POST', body: { bookUrl: shelf.bookUrl, index: 7, position: 120 } }),
)
console.log(`  progress timestamp: ${savedAt}`)

const refreshed = await step('getBookshelf (after progress)', () => call('/reader3/getBookshelf'))
const target = refreshed.find((book) => book.bookUrl === shelf.bookUrl)
if (target?.durChapterIndex !== 7) throw new Error(`进度未落库: ${JSON.stringify(target?.durChapterIndex)}`)
console.log(`  durChapterIndex=${target.durChapterIndex} durChapterPos=${target.durChapterPos}`)

const groups = await step('getBookGroups', () => call('/reader3/getBookGroups'))
console.log(`  groups: ${groups.map((group) => group.groupName).join(', ')}`)

// SSE: collect message events until `end`
const sseBooks = await new Promise((resolve, reject) => {
  const collected = []
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
    reject(new Error('SSE timeout'))
  }, 120000)
  fetch(`${base}/reader3/searchBookMultiSSE?key=${encodeURIComponent(keyword)}`, { signal: controller.signal })
    .then(async (response) => {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''
        for (const block of blocks) {
          if (block.includes('event: end')) {
            clearTimeout(timer)
            controller.abort()
            resolve(collected)
            return
          }
          const dataLine = block.split('\n').find((line) => line.startsWith('data: '))
          if (!dataLine) continue
          try {
            const payload = JSON.parse(dataLine.slice(6))
            if (Array.isArray(payload?.data)) collected.push(...payload.data)
          } catch {
            /* ignore malformed frame */
          }
        }
      }
      clearTimeout(timer)
      resolve(collected)
    })
    .catch((error) => {
      if (error.name === 'AbortError') return
      clearTimeout(timer)
      reject(error)
    })
})
console.log(`  ✓ searchBookMultiSSE (${sseBooks.length} book(s))`)
if (!sseBooks.length) throw new Error('SSE 没有返回任何书')

console.log('\nall /reader3 checks passed')
