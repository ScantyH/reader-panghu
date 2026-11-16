/**
 * M4: the server is authoritative for reading progress.
 *
 *   node scripts/test-sync.mjs [baseUrl]
 *
 * Verifies: a fresh write is accepted, a stale write from an old client is
 * rejected (server keeps the newer chapter), and a newer write wins.
 */

import { readFileSync } from 'node:fs'

const base = (process.argv[2] || 'http://127.0.0.1:18080').replace(/\/+$/, '')

const call = async (path, { method = 'GET', body } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json()
  if (payload.isSuccess === false) throw new Error(`${path} → ${payload.errorMsg}`)
  return payload.data
}

const fixture = JSON.parse(readFileSync('scripts/fixtures/synthetic-source.json', 'utf8'))
await call('/reader3/saveBookSources', { method: 'POST', body: [fixture] })

const found = (await call('/reader3/searchBookMulti', { method: 'POST', body: { key: '同步' } }))[0]
if (!found) throw new Error('合成书源没有返回结果')
const info = await call('/reader3/getBookInfo', { method: 'POST', body: { url: found.bookUrl, bookSourceUrl: found.origin } })
await call('/reader3/saveBook', { method: 'POST', body: info })

const shelfBook = async () => (await call('/reader3/getBookshelf')).find((book) => book.bookUrl === info.bookUrl)

// 1. fresh write
const first = await call('/reader3/saveBookProgress', { method: 'POST', body: { bookUrl: info.bookUrl, index: 10 } })
if (!await shelfBook().then((book) => book.durChapterIndex === 10)) throw new Error('首次进度未落库')
console.log(`  ✓ 首次写入接受，index=10 (ts=${first})`)

await new Promise((resolve) => setTimeout(resolve, 50))

// 2. stale write from an old client must not roll the server back
const stale = await call('/reader3/saveBookProgress', {
  method: 'POST',
  body: { bookUrl: info.bookUrl, index: 3, clientUpdatedAt: 1 },
})
const afterStale = await shelfBook()
if (afterStale.durChapterIndex !== 10) throw new Error(`旧客户端把进度回滚了：${afterStale.durChapterIndex}`)
if (String(stale) !== String(afterStale.durChapterTime)) throw new Error('返回值应为服务端权威时间戳')
console.log(`  ✓ 过期写入被拒，服务端仍为 index=10，返回权威 ts`)

await new Promise((resolve) => setTimeout(resolve, 50))

// 3. a genuinely newer write is accepted
await call('/reader3/saveBookProgress', {
  method: 'POST',
  body: { bookUrl: info.bookUrl, index: 12, clientUpdatedAt: Date.now() + 1000 },
})
const afterNew = await shelfBook()
if (afterNew.durChapterIndex !== 12) throw new Error(`新写入未生效：${afterNew.durChapterIndex}`)
console.log(`  ✓ 更新的写入被接受，index=12`)

console.log('\nprogress sync checks passed')
