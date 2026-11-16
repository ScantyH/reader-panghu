/**
 * RSS 订阅 test：起一个本地订阅源，保存 → 列表 → 拉文章 → 抓正文 → 删除。
 *
 *   node scripts/test-rss.mjs [baseUrl]
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

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>测试订阅源</title>
  <item>
    <title>第一篇：起风了</title>
    <link>__ARTICLE__</link>
    <description><![CDATA[<p>第一篇的摘要。</p>]]></description>
    <pubDate>Mon, 16 Nov 2026 10:00:00 +0800</pubDate>
  </item>
  <item>
    <title>第二篇：落雨了</title>
    <link>__ARTICLE__</link>
    <description>第二篇的摘要。</description>
    <pubDate>Mon, 16 Nov 2026 11:00:00 +0800</pubDate>
  </item>
</channel></rss>`

const ARTICLE = `<html><body><h1>正文标题</h1><p>这是文章的正文段落。</p><script>bad()</script></body></html>`

const server = createServer((req, res) => {
  if (req.url?.startsWith('/feed.xml')) {
    res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' })
    res.end(FEED.replaceAll('__ARTICLE__', `http://127.0.0.1:${port}/article/1`))
    return
  }
  if (req.url?.startsWith('/article/1')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(ARTICLE)
    return
  }
  res.writeHead(404).end('nope')
})

const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const sourceUrl = `http://127.0.0.1:${port}/feed.xml`
console.log(`本地订阅源: ${sourceUrl}`)

try {
  await call('/reader3/saveRssSource', { method: 'POST', body: { sourceUrl, sourceName: '测试订阅' } })
  const sources = await call('/reader3/getRssSources')
  if (!sources.some((item) => item.sourceUrl === sourceUrl)) throw new Error('订阅源未保存')
  console.log(`  ✓ 保存订阅源（共 ${sources.length} 个）`)

  const feed = await call('/reader3/getRssArticles', { method: 'POST', body: { sourceUrl } })
  if (feed.first.length !== 2) throw new Error(`应解析出 2 篇，实际 ${feed.first.length}`)
  if (feed.first[0].title !== '第一篇：起风了') throw new Error(`标题解析错误：${feed.first[0].title}`)
  if (!feed.first[0].description.includes('第一篇的摘要')) throw new Error('摘要未解析')
  console.log(`  ✓ 拉取文章 → ${feed.title}，${feed.first.length} 篇`)

  const content = await call('/reader3/getRssContent', { method: 'POST', body: { link: feed.first[0].link } })
  if (!content.includes('这是文章的正文段落')) throw new Error(`正文抓取错误：${content.slice(0, 60)}`)
  if (content.includes('bad()')) throw new Error('正文里混入了 script 内容')
  console.log(`  ✓ 抓取正文 → ${content.length} 字，已剔除 script`)

  // 关掉本地订阅源，再次请求应命中缓存（证明定时刷新/缓存生效）
  await new Promise((resolve) => { server.close(resolve) })
  const cached = await call('/reader3/getRssArticles', { method: 'POST', body: { sourceUrl } })
  if (cached.first.length !== 2) throw new Error(`缓存未命中：${cached.first.length} 篇`)
  if (!cached.cached) throw new Error('响应未标记 cached')
  console.log(`  ✓ 缓存命中（源已关闭仍可读，${cached.first.length} 篇）`)

  // refresh:true 强制回源，此时源已关闭应失败
  const forced = await fetch(`${base}/reader3/getRssArticles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceUrl, refresh: true }),
  }).then((response) => response.json())
  if (forced.isSuccess !== false && !forced.data?.stale) throw new Error('强制刷新应回源失败或标记 stale')
  console.log(`  ✓ 强制刷新回源失败时降级（${forced.data?.stale ? 'stale 缓存' : forced.errorMsg}）`)

  await call('/reader3/deleteRssSource', { method: 'POST', body: { sourceUrl } })
  const left = await call('/reader3/getRssSources')
  if (left.some((item) => item.sourceUrl === sourceUrl)) throw new Error('订阅源未删除')
  console.log('  ✓ 删除订阅源')
} finally {
  try { server.close() } catch {}
}

console.log('\nRSS checks passed')
