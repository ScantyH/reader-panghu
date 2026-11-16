/**
 * Chapter cache test: pre-cache chapters, read them back, clear them.
 *
 *   node scripts/test-cache.mjs [baseUrl]
 */

import { readFileSync } from 'node:fs'

const base = (process.argv[2] || 'http://127.0.0.1:18080').replace(/\/+$/, '')

const call = async (path, { method = 'GET', body } = {}) => {
  const init = { method }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const payload = await (await fetch(`${base}${path}`, init)).json()
  if (payload.isSuccess === false) throw new Error(`${path} → ${payload.errorMsg}`)
  return payload.data
}

const fixture = JSON.parse(readFileSync('scripts/fixtures/synthetic-source.json', 'utf8'))
await call('/reader3/saveBookSources', { method: 'POST', body: [fixture] })

const found = (await call('/reader3/searchBookMulti', { method: 'POST', body: { key: '缓存' } }))[0]
if (!found) throw new Error('合成书源没有返回结果')
const info = await call('/reader3/getBookInfo', { method: 'POST', body: { url: found.bookUrl, bookSourceUrl: found.origin } })
await call('/reader3/saveBook', { method: 'POST', body: info })
await call('/reader3/getChapterList', { method: 'POST', body: { bookUrl: info.bookUrl, tocUrl: info.tocUrl, bookSourceUrl: info.origin } })

const result = await call('/reader3/cacheBook', { method: 'POST', body: { bookUrl: info.bookUrl, count: 2 } })
if (result.cached !== 2) throw new Error(`应缓存 2 章，实际 ${result.cached}`)
console.log(`  ✓ cacheBook → cached=${result.cached}, totalCached=${result.totalCached}`)

const text = await call('/reader3/getBookContent', { method: 'POST', body: { bookUrl: info.bookUrl, index: 0 } })
if (!text.includes('第一章的正文')) throw new Error(`缓存正文不对: ${text}`)
console.log(`  ✓ 命中缓存 → ${text.replace(/\n/g, ' / ')}`)

// a second run with refresh must not double-count
const again = await call('/reader3/cacheBook', { method: 'POST', body: { bookUrl: info.bookUrl, count: 2 } })
if (again.cached !== 0) throw new Error(`重复缓存应为 0，实际 ${again.cached}`)
console.log(`  ✓ 重复调用不重复缓存（cached=${again.cached}）`)

await call('/reader3/deleteBookCache', { method: 'POST', body: { bookUrl: info.bookUrl } })
const afterClear = await call('/reader3/cacheBook', { method: 'POST', body: { bookUrl: info.bookUrl, count: 2 } })
if (afterClear.totalCached !== 2) throw new Error('清空后应能重新缓存')
console.log(`  ✓ 清空后可重新缓存（totalCached=${afterClear.totalCached}）`)

console.log('\nchapter cache checks passed')
