/**
 * 书籍目录/换源/多书源搜索 test：
 *  - 拉目录后书架章节数更新
 *  - 换源只搜索选中的书源汇总
 *  - 搜索 SSE 支持多个汇总过滤
 *
 *   node scripts/test-books.mjs
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 18450 + Math.floor(Math.random() * 90)
const dataDir = mkdtempSync(join(tmpdir(), 'reader-panghu-books-'))
const base = `http://127.0.0.1:${port}`
let server = null
let failures = 0

const check = (label, condition, detail = '') => {
  if (!condition) failures += 1
  console.log(`  ${condition ? '✓' : '✗'} ${label}${condition ? '' : ` -> ${detail}`}`)
}

const start = async () => {
  server = spawn(process.execPath, ['apps/server/src/index.js'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, LOG_LEVEL: 'warn', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'secret123' },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return
    } catch {
      /* waiting */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('服务没有起来')
}

const stop = async () => {
  if (!server || server.exitCode !== null) return
  await new Promise((resolve) => {
    server.once('exit', resolve)
    server.kill()
  })
}

const call = async (path, { method = 'GET', body, token } = {}) => {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers['x-auth-token'] = token
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return response.json()
}

const cleanup = () => {
  try {
    server?.kill()
  } catch {
    /* ignore */
  }
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    /* Windows */
  }
}
process.on('exit', cleanup)

const webview = (url, name, bookId) => ({
  bookSourceUrl: url,
  bookSourceName: name,
  enabled: true,
  html: `<script>
async function search(key){ return JSON.stringify([{bookUrl:'${url}/book/${bookId}',name:'多源测试书',author:'QA',tocUrl:'${url}/book/${bookId}/toc',type:0}]) }
async function info(url){ return JSON.stringify({bookUrl:url,name:'多源测试书',author:'QA',tocUrl:'${url}/book/${bookId}/toc',type:0}) }
async function chapter(toc){ return JSON.stringify([{name:'第一章',chapterId:'${url}/ch/0',index:0},{name:'第二章',chapterId:'${url}/ch/1',index:1}]) }
async function content(url){ return '正文内容，测试章节拉取。' }
</script>`,
})

try {
  await start()
  const token = (await call('/reader3/login', { method: 'POST', body: { username: 'admin', password: 'secret123' } })).data.token
  await call('/reader3/importBookSources', { method: 'POST', token, body: { name: '汇总A', sources: [webview('https://books-a.example', '源A', 1)] } })
  await call('/reader3/importBookSources', { method: 'POST', token, body: { name: '汇总B', sources: [webview('https://books-b.example', '源B', 2)] } })

  const book = {
    name: '多源测试书', author: 'QA', bookUrl: 'https://books-a.example/book/1', origin: 'https://books-a.example',
    originName: '源A', tocUrl: 'https://books-a.example/book/1/toc', totalChapterNum: 0, canUpdate: true,
  }
  await call('/reader3/saveBook', { method: 'POST', token, body: book })
  const chapters = await call('/reader3/getChapterList', { method: 'POST', token, body: { bookUrl: book.bookUrl, tocUrl: book.tocUrl, bookSourceUrl: book.origin } })
  check('拉取目录成功', chapters.isSuccess === true && chapters.data?.length === 2, chapters.errorMsg)
  const saved = (await call('/reader3/getBookshelf', { token })).data.find((item) => item.bookUrl === book.bookUrl)
  check('书架章节数更新为真实数量', saved?.totalChapterNum === 2, String(saved?.totalChapterNum))
  check('书架最新章节名更新', saved?.latestChapterTitle === '第二章', saved?.latestChapterTitle)

  const sourceA = (await call('/reader3/getAvailableBookSource', { method: 'POST', token, body: { name: book.name, author: book.author, origin: book.origin, bundles: ['汇总B'] } })).data.books
  check('换源只搜索选中的汇总B', sourceA.length === 1 && sourceA[0].origin === 'https://books-b.example', JSON.stringify(sourceA))
  const sourceB = (await call('/reader3/getAvailableBookSource', { method: 'POST', token, body: { name: book.name, author: book.author, origin: book.origin, bundles: ['汇总A'] } })).data.books
  check('换源可切换到汇总A里的其它书源', sourceB.length === 0 || sourceB.every((candidate) => candidate.origin !== 'https://books-b.example'), JSON.stringify(sourceB))

  const sseUrl = `${base}/reader3/searchBookMultiSSE?key=${encodeURIComponent('多源测试书')}&bookSourceBundles=${encodeURIComponent('汇总B')}&token=${token}`
  const sse = await fetch(sseUrl, { headers: { 'x-auth-token': token } }).then((response) => response.text())
  check('多汇总搜索只出现选中的源', sse.includes('源B') && !sse.includes('源A'), sse.slice(0, 160))

  const cleared = await call('/reader3/deleteBookCache', { method: 'POST', token, body: { bookUrl: book.bookUrl } })
  check('手动清理缓存成功', cleared.isSuccess === true, cleared.errorMsg)
  const afterClear = await call('/reader3/getChapterList', { method: 'POST', token, body: { bookUrl: book.bookUrl, tocUrl: book.tocUrl, bookSourceUrl: book.origin } })
  check('清理后能重新拉目录', afterClear.isSuccess === true && afterClear.data?.length === 2, afterClear.errorMsg)

  await stop()
  console.log(failures ? `\n书籍功能 ${failures} 项失败` : '\n书籍功能 checks passed')
  process.exit(failures ? 1 : 0)
} catch (error) {
  console.error(`\n✗ ${error.message}`)
  await stop()
  cleanup()
  process.exit(1)
}
