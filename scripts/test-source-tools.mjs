/**
 * 书源管理能力 test：启用/禁用、探索分类、调试阶段、失效标记与清理。
 *
 *   node scripts/test-source-tools.mjs [baseUrl]
 */

import { createServer } from 'node:http'

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

const EXPLORE_HTML = `<html><body>
  <div class="cat"><a href="/list/1">玄幻</a></div>
  <div class="cat"><a href="/list/2">都市</a></div>
</body></html>`

const LIST_HTML = `<html><body>
  <div class="book"><h3><a href="/book/9">探索之书</a></h3><span class="author">探索作者</span></div>
</body></html>`

const INFO_HTML = `<html><body><div class="book_name"><h1>探索之书</h1></div><a class="toc-link" href="/book/9/toc">目录</a></body></html>`
const TOC_HTML = `<html><body><ul class="chapters"><li><a href="/chapter/9">第一章</a></li></ul></body></html>`
const CONTENT_HTML = `<html><body><div class="content"><p>探索正文。</p></div></body></html>`

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  const url = req.url || '/'
  if (url.startsWith('/explore')) return res.end(EXPLORE_HTML)
  if (url.startsWith('/list/')) return res.end(LIST_HTML)
  if (url.startsWith('/book/9/toc')) return res.end(TOC_HTML)
  if (url.startsWith('/book/9')) return res.end(INFO_HTML)
  if (url.startsWith('/chapter/')) return res.end(CONTENT_HTML)
  if (url.startsWith('/search')) return res.end('<div class="book"><h3><a href="/book/9">探索之书</a></h3></div>')
  res.end('<html><body>ok</body></html>')
})

const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const origin = `http://127.0.0.1:${port}`

const source = {
  bookSourceName: '工具测试源',
  bookSourceUrl: origin,
  enabled: true,
  searchUrl: `${origin}/search?q={{key}}`,
  exploreUrl: JSON.stringify([
    { title: '玄幻', url: `${origin}/list/1` },
    { title: '都市', url: `${origin}/list/2` },
  ]),
  ruleSearch: { bookList: 'class.book', name: 'tag.h3@tag.a@text', bookUrl: 'tag.a.0@href' },
  ruleExplore: { bookList: 'class.book', name: 'tag.h3@tag.a@text', author: 'class.author@text', bookUrl: 'tag.a.0@href' },
  ruleBookInfo: { name: 'class.book_name@tag.h1@text', tocUrl: 'class.toc-link@href' },
  ruleToc: { chapterList: 'class.chapters@tag.li', chapterName: 'tag.a@text', chapterUrl: 'tag.a@href' },
  ruleContent: { content: 'class.content@textNodes' },
}

try {
  await call('/reader3/saveBookSources', { method: 'POST', body: [source] })

  // 启用 / 禁用
  await call('/reader3/setSourceEnabled', { method: 'POST', body: { bookSourceUrl: origin, enabled: false } })
  let list = await call('/reader3/getBookSources')
  if (list.find((item) => item.bookSourceUrl === origin)?.enabled !== false) throw new Error('禁用未生效')
  await call('/reader3/setSourceEnabled', { method: 'POST', body: { bookSourceUrl: origin, enabled: true } })
  console.log('  ✓ 启用 / 禁用切换')

  // 探索分类
  const kinds = await call('/reader3/getExploreKinds', { method: 'POST', body: { bookSourceUrl: origin } })
  if (kinds.length !== 2 || kinds[0].title !== '玄幻') throw new Error(`分类解析错误：${JSON.stringify(kinds)}`)
  console.log(`  ✓ 探索分类 → ${kinds.map((kind) => kind.title).join(' / ')}`)

  const books = await call('/reader3/exploreBook', { method: 'POST', body: { bookSourceUrl: origin, url: kinds[0].url } })
  if (books.length !== 1 || books[0].name !== '探索之书') throw new Error(`探索书籍错误：${JSON.stringify(books)}`)
  console.log(`  ✓ 探索列表 → 《${books[0].name}》 / ${books[0].author}`)

  // 调试四个阶段
  const searchDebug = await call('/reader3/debugSource', { method: 'POST', body: { bookSourceUrl: origin, stage: 'search', keyword: '探索' } })
  if (!searchDebug.ok || searchDebug.parsed.bookList !== 1) throw new Error(`搜索调试失败：${JSON.stringify(searchDebug)}`)
  if (!searchDebug.raw.includes('class="book"')) throw new Error('调试没有返回原始响应')
  console.log(`  ✓ 调试搜索 → ${searchDebug.elapsedMs}ms，解析 ${searchDebug.parsed.bookList} 本，含原始 HTML`)

  const infoDebug = await call('/reader3/debugSource', { method: 'POST', body: { bookSourceUrl: origin, stage: 'info', url: `${origin}/book/9` } })
  if (!infoDebug.ok || infoDebug.parsed.name !== '探索之书') throw new Error(`详情调试失败：${JSON.stringify(infoDebug)}`)
  console.log(`  ✓ 调试详情 → ${infoDebug.parsed.name}`)

  const tocDebug = await call('/reader3/debugSource', { method: 'POST', body: { bookSourceUrl: origin, stage: 'toc', url: `${origin}/book/9/toc` } })
  if (!tocDebug.ok || tocDebug.parsed.chapterList !== 1) throw new Error(`目录调试失败：${JSON.stringify(tocDebug)}`)
  console.log(`  ✓ 调试目录 → ${tocDebug.parsed.chapterList} 章`)

  const contentDebug = await call('/reader3/debugSource', { method: 'POST', body: { bookSourceUrl: origin, stage: 'content', url: `${origin}/chapter/9` } })
  if (!contentDebug.ok || !contentDebug.parsed.text.includes('探索正文')) throw new Error(`正文调试失败：${JSON.stringify(contentDebug)}`)
  console.log(`  ✓ 调试正文 → ${contentDebug.parsed.length} 字`)

  // 失效标记与清理
  const report = await call('/reader3/testBookSources', { method: 'POST', body: { bookSourceUrls: [origin], keyword: '探索', markInvalid: true } })
  console.log('    检测明细:', JSON.stringify(report.results?.[0]))
  if (report.results?.[0]?.markedInvalid) throw new Error('可用书源不应被标记失效')
  const invalidList = await call('/reader3/getInvalidBookSources', { method: 'POST', body: {} })
  const selfMarked = invalidList.some((item) => item.bookSourceUrl === origin)
  console.log(`  ✓ 可用书源未被标记失效（失效列表 ${invalidList.length} 条，自身命中：${selfMarked}）`)

  // 人为造一个失效源
  await call('/reader3/saveBookSources', {
    method: 'POST',
    body: [{ bookSourceName: '死链源', bookSourceUrl: 'http://127.0.0.1:1', enabled: true, searchUrl: 'http://127.0.0.1:1/search?q={{key}}', ruleSearch: { bookList: 'class.x' } }],
  })
  await call('/reader3/testBookSources', { method: 'POST', body: { bookSourceUrls: ['http://127.0.0.1:1'], keyword: '无', markInvalid: true } })
  const invalid2 = await call('/reader3/getInvalidBookSources', { method: 'POST', body: {} })
  if (!invalid2.some((item) => item.bookSourceUrl === 'http://127.0.0.1:1')) throw new Error('失效源未被标记')
  const removed = await call('/reader3/deleteInvalidBookSources', { method: 'POST', body: {} })
  if (removed.deleted < 1) throw new Error('失效源未删除')
  console.log(`  ✓ 失效标记与清理 → 删除 ${removed.deleted} 个`)
} finally {
  server.close()
}

console.log('\n书源工具 checks passed')
