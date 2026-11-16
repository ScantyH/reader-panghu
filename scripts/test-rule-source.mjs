/**
 * 规则型书源 test：用本地站点模拟 Legado 规则，验证 搜索 → 详情 → 目录 → 正文。
 *
 *   node scripts/test-rule-source.mjs [baseUrl]
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

const SEARCH_HTML = `<html><body>
  <div class="result">
    <table><tr class="book">
      <td class="cover"><img src="/covers/1.jpg"></td>
      <td><h4><a href="/book/1">规则之书</a></h4></td>
      <td class="author">测试笔名</td>
    </tr></table>
  </div>
</body></html>`

const INFO_HTML = `<html><body>
  <div class="book_name"><h1>规则之书</h1></div>
  <div class="author">测试笔名</div>
  <div class="intro">这是规则型书源的简介。</div>
  <a class="toc-link" href="/book/1/toc">目录</a>
</body></html>`

const TOC_HTML = `<html><body>
  <ul class="chapters">
    <li><a href="/chapter/1">第一章 规则</a></li>
    <li><a href="/chapter/2">第二章 解析</a></li>
  </ul>
</body></html>`

const CONTENT_HTML = `<html><body>
  <div class="content"><p>第一章的正文。</p><p>第二段。</p></div>
  <div class="ads">广告内容</div>
</body></html>`

const server = createServer((req, res) => {
  const url = (req.url || '/').replace(/^\/xp/, '')
  const send = (html) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
  }
  if (url.startsWith('/search')) return send(SEARCH_HTML)
  if (url.startsWith('/book/1/toc')) return send(TOC_HTML)
  if (url.startsWith('/book/1')) return send(INFO_HTML)
  if (url.startsWith('/chapter/')) return send(CONTENT_HTML)
  res.writeHead(404).end('nope')
})

const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const origin = `http://127.0.0.1:${port}`
console.log(`模拟站点: ${origin}`)

// 用 Legado 的真实规则语法描述这个站点
const source = {
  bookSourceName: '规则测试源',
  bookSourceGroup: '测试',
  bookSourceUrl: origin,
  bookSourceType: 0,
  enabled: true,
  searchUrl: `${origin}/search?q={{key}}&page={{page}}`,
  ruleSearch: {
    bookList: 'class.result@tag.tr',
    name: 'tag.h4@tag.a@text',
    author: 'class.author@text',
    bookUrl: 'tag.a.0@href',
    coverUrl: 'class.cover@tag.img@src',
  },
  ruleBookInfo: {
    name: 'class.book_name@tag.h1@text',
    author: 'class.author@text',
    intro: 'class.intro@text',
    tocUrl: 'class.toc-link@href',
  },
  ruleToc: {
    chapterList: 'class.chapters@tag.li',
    chapterName: 'tag.a@text',
    chapterUrl: 'tag.a@href',
  },
  ruleContent: {
    content: 'class.content@textNodes',
  },
}

try {
  await call('/reader3/saveBookSources', { method: 'POST', body: [source] })
  const sources = await call('/reader3/getBookSources')
  if (!sources.some((item) => item.bookSourceUrl === origin)) throw new Error('书源未保存')
  console.log('  ✓ 规则型书源已保存')

  const books = (await call('/reader3/searchBookMulti', { method: 'POST', body: { key: '规则' } })).filter(
    (book) => book.origin === origin,
  )
  if (books.length !== 1) throw new Error(`搜索应返回 1 本，实际 ${books.length}`)
  if (books[0].name !== '规则之书') throw new Error(`书名解析错误：${books[0].name}`)
  if (books[0].author !== '测试笔名') throw new Error(`作者解析错误：${books[0].author}`)
  if (!books[0].bookUrl.startsWith(origin)) throw new Error(`书籍地址未补全：${books[0].bookUrl}`)
  console.log(`  ✓ 搜索 → 《${books[0].name}》 / ${books[0].author}（相对链接已补全）`)

  const info = await call('/reader3/getBookInfo', { method: 'POST', body: { url: books[0].bookUrl, bookSourceUrl: origin } })
  if (info.name !== '规则之书' || !info.intro.includes('简介')) throw new Error(`详情解析错误：${JSON.stringify(info)}`)
  if (!info.tocUrl.endsWith('/toc')) throw new Error(`目录地址错误：${info.tocUrl}`)
  console.log(`  ✓ 详情 → ${info.name}，目录 ${info.tocUrl}`)

  // 真实流程：先加入书架，后面按 index 读正文
  await call('/reader3/saveBook', { method: 'POST', body: info })

  const chapters = await call('/reader3/getChapterList', {
    method: 'POST',
    body: { bookUrl: books[0].bookUrl, tocUrl: info.tocUrl, bookSourceUrl: origin },
  })
  if (chapters.length !== 2) throw new Error(`目录应有 2 章，实际 ${chapters.length}`)
  console.log(`  ✓ 目录 → ${chapters.map((c) => c.title).join(' / ')}`)

  const text = await call('/reader3/getBookContent', { method: 'POST', body: { bookUrl: books[0].bookUrl, index: 0, bookSourceUrl: origin } })
  if (!text.includes('第一章的正文')) throw new Error(`正文错误：${text}`)
  if (text.includes('广告内容')) throw new Error('正文混入了广告块')
  console.log(`  ✓ 正文 → ${text.replace(/\n/g, ' / ')}`)

  // ── 第二种语法：XPath + JS 规则 ──
  const xpOrigin = origin + '/xp'
  const xpathSource = {
    bookSourceName: 'XPath/JS 源',
    bookSourceUrl: xpOrigin,
    enabled: true,
    searchUrl: `${origin}/xp/search?q={{key}}`,
    ruleSearch: {
      bookList: '@XPath://tr[@class="book"]',
      name: '@XPath://h4/a/text()<js>result.trim()</js>',
      author: 'class.author@text@js:result + "（脚本）"',
      bookUrl: '@XPath://h4/a/@href',
    },
    ruleBookInfo: { name: 'class.book_name@tag.h1@text', tocUrl: 'class.toc-link@href' },
    ruleToc: { chapterList: '@XPath://ul[@class="chapters"]/li', chapterName: 'tag.a@text', chapterUrl: 'tag.a@href' },
    ruleContent: { content: 'class.content@textNodes##第二段。' },
  }
  await call('/reader3/saveBookSources', { method: 'POST', body: [xpathSource] })
  const xpBooks = (await call('/reader3/searchBookMulti', { method: 'POST', body: { key: '规则' } })).filter(
    (book) => book.originName === 'XPath/JS 源',
  )
  if (xpBooks.length !== 1) throw new Error(`XPath 搜索应返回 1 本，实际 ${xpBooks.length}`)
  if (xpBooks[0].name !== '规则之书') throw new Error(`XPath 书名错误：${xpBooks[0].name}`)
  if (!xpBooks[0].author.includes('脚本')) throw new Error(`JS 规则未生效：${xpBooks[0].author}`)
  console.log(`  ✓ XPath + JS 搜索 → 《${xpBooks[0].name}》 / ${xpBooks[0].author}`)

  const xpInfo = await call('/reader3/getBookInfo', { method: 'POST', body: { url: xpBooks[0].bookUrl, bookSourceUrl: xpOrigin } })
  await call('/reader3/saveBook', { method: 'POST', body: xpInfo })
  const xpToc = await call('/reader3/getChapterList', {
    method: 'POST',
    body: { bookUrl: xpInfo.bookUrl, tocUrl: xpInfo.tocUrl, bookSourceUrl: xpOrigin },
  })
  if (xpToc.length !== 2) throw new Error(`XPath 目录应有 2 章，实际 ${xpToc.length}`)
  const xpText = await call('/reader3/getBookContent', { method: 'POST', body: { bookUrl: xpInfo.bookUrl, index: 0, bookSourceUrl: xpOrigin } })
  if (xpText.includes('第二段')) throw new Error('正则替换未生效（第二段应被移除）')
  console.log(`  ✓ XPath 目录 + 正则正文 → ${xpText.replace(/\n/g, ' / ')}`)
} finally {
  server.close()
}

console.log('\n规则型书源 checks passed')
