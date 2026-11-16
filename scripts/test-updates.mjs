/**
 * 新章节检查 test：连载书目录变长时应被检出并更新书架记录。
 * 检查现在是后台任务，测试通过轮询 getChapterUpdateStatus 等它结束。
 *
 *   node scripts/test-updates.mjs [baseUrl]
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

const waitIdle = async (timeoutMs = 30000) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const status = await call('/reader3/getChapterUpdateStatus')
    if (!status.running) return status
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error('检查任务超时未结束')
}

const fixture = JSON.parse(readFileSync('scripts/fixtures/synthetic-source.json', 'utf8'))
await call('/reader3/saveBookSources', { method: 'POST', body: [fixture] })
const found = (await call('/reader3/searchBookMulti', { method: 'POST', body: { key: '连载' } }))[0]
const info = await call('/reader3/getBookInfo', { method: 'POST', body: { url: found.bookUrl, bookSourceUrl: found.origin } })

// 模拟「书架记录里只有 1 章、目录也未同步」的旧状态；
// 不调用 getChapterList，因为它本身会把章节数写回书架，就测不出更新了。
await call('/reader3/saveBook', { method: 'POST', body: { ...info, totalChapterNum: 1 } })

const started = await call('/reader3/checkChapterUpdates', { method: 'POST', body: { limit: 5 } })
if (!started.started) throw new Error(`检查未启动：${JSON.stringify(started)}`)
console.log(`  ✓ 后台任务已启动（${started.total} 本）`)

const status = await waitIdle()
if (status.updatedBooks.length < 1) throw new Error(`应检出 1 本更新，实际 ${status.updatedBooks.length}`)
console.log(`  ✓ 检查完成 → 检查 ${status.checked}/${status.total} 本，更新 ${status.updatedBooks.length} 本`)

const shelf = await call('/reader3/getBookshelf')
const book = shelf.find((item) => item.bookUrl === info.bookUrl)
if (Number(book.totalChapterNum) !== 2) throw new Error(`章节数未更新：${book.totalChapterNum}`)
if (!book.latestChapterTitle) throw new Error('最新章节标题未写入')
console.log(`  ✓ 书架已更新 → ${book.totalChapterNum} 章，最新《${book.latestChapterTitle}》`)

// 再次检查：目录已同步，不应再报告更新
await call('/reader3/checkChapterUpdates', { method: 'POST', body: { limit: 5 } })
const again = await waitIdle()
if (again.updatedBooks.length !== 0) throw new Error(`重复检查应为 0，实际 ${again.updatedBooks.length}`)
console.log('  ✓ 再次检查不重复报告')

console.log('\nchapter update checks passed')
