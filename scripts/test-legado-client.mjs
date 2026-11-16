/**
 * Legado 客户端模拟器：严格按生成出来的「阅读3 书源」规则走一遍。
 *
 * 目的：在没有真机的情况下，证明 APP 拿到订书源后能真的搜到书、拿到详情、
 * 目录和正文——即验证 ruleSearch / ruleBookInfo / ruleToc / ruleContent 这四条
 * 规则链路本身，而不是只验证接口。
 *
 *   node scripts/test-legado-client.mjs [baseUrl] [keyword]
 */

import { readFileSync } from 'node:fs'

const base = (process.argv[2] || 'http://127.0.0.1:18080').replace(/\/+$/, '')
const keyword = process.argv[3] || '打更人'

const jget = (value, path) => {
  if (!path || path === '-') return value
  if (!path.startsWith('$')) return path
  const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean)
  let cursor = value
  for (const part of parts) {
    if (cursor == null) return undefined
    cursor = cursor[part]
  }
  return cursor
}

const get = async (url) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`)
  return response.json()
}

const fixtured = async () => {
  const fixture = JSON.parse(readFileSync('scripts/fixtures/synthetic-source.json', 'utf8'))
  await get(`${base}/reader3/getBookSources`).then(async (payload) => {
    if (!payload.data.some((item) => item.html)) {
      await fetch(`${base}/reader3/saveBookSources`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([fixture]),
      })
    }
  })
}

await fixtured()
console.log(`base: ${base}`)

// 1. 客户端「订阅」拿到书源
const subscription = await get(`${base}/api/subscribe`)
const source = subscription[0]
if (!source) throw new Error('订阅地址没有返回书源')
console.log(`✓ 订阅书源：${source.bookSourceName}`)

// 2. ruleSearch：客户端把关键词/页码填进 searchUrl 后请求
const searchUrl = source.searchUrl.replace('{{key}}', encodeURIComponent(keyword)).replace('{{page}}', '1')
const searchJson = await get(searchUrl)
const bookList = jget(searchJson, source.ruleSearch.bookList)
if (!Array.isArray(bookList) || !bookList.length) throw new Error('ruleSearch.bookList 没有解析出书籍')
const first = bookList[0]
const clientBook = {
  name: String(jget(first, source.ruleSearch.name) ?? ''),
  author: String(jget(first, source.ruleSearch.author) ?? ''),
  bookUrl: String(jget(first, source.ruleSearch.bookUrl) ?? ''),
  coverUrl: String(jget(first, source.ruleSearch.coverUrl) ?? ''),
  intro: String(jget(first, source.ruleSearch.intro) ?? ''),
}
if (!clientBook.name || !clientBook.bookUrl) throw new Error(`ruleSearch 字段不全：${JSON.stringify(clientBook)}`)
console.log(`✓ ruleSearch → 《${clientBook.name}》 / ${clientBook.author}`)

// 3. ruleBookInfo：客户端请求 bookUrl 后套规则
const infoJson = await get(clientBook.bookUrl)
const tocUrl = String(jget(infoJson, source.ruleBookInfo.tocUrl) ?? '')
const infoName = String(jget(infoJson, source.ruleBookInfo.name) ?? '')
if (!tocUrl || !infoName) throw new Error('ruleBookInfo 没有解析出 tocUrl')
console.log(`✓ ruleBookInfo → ${infoName}，tocUrl 已给出`)

// 4. ruleToc
const tocJson = await get(tocUrl)
const chapterList = jget(tocJson, source.ruleToc.chapterList)
if (!Array.isArray(chapterList) || !chapterList.length) throw new Error('ruleToc.chapterList 为空')
const chapter = {
  title: String(jget(chapterList[0], source.ruleToc.chapterName) ?? ''),
  url: String(jget(chapterList[0], source.ruleToc.chapterUrl) ?? ''),
}
if (!chapter.url) throw new Error('ruleToc 没有解析出章节地址')
console.log(`✓ ruleToc → ${chapterList.length} 章，首章《${chapter.title}》`)

// 5. ruleContent
const contentJson = await get(chapter.url)
const text = jget(contentJson, source.ruleContent.content)
if (!text || !String(text).trim()) throw new Error('ruleContent 没有解析出正文')
console.log(`✓ ruleContent → ${String(text).length} 字：${String(text).slice(0, 30).replace(/\n/g, ' ')}…`)

console.log('\nLegado 客户端链路验证通过（订阅 → 搜索 → 详情 → 目录 → 正文）')
