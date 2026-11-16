/**
 * 书源订阅 test: the subscription URL must return an importable 阅读3 document.
 *
 *   node scripts/test-subscribe.mjs [baseUrl]
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
  if (payload?.isSuccess === false) throw new Error(`${path} → ${payload.errorMsg}`)
  return payload
}

const fixture = JSON.parse(readFileSync('scripts/fixtures/synthetic-source.json', 'utf8'))
await call('/reader3/saveBookSources', { method: 'POST', body: [fixture] })

const list = await call('/api/subscribe')
if (!Array.isArray(list) || !list.length) throw new Error('订阅地址没有返回书源数组')
const source = list[0]
console.log(`  ✓ /api/subscribe → ${list.length} 个书源`)

for (const field of ['bookSourceName', 'bookSourceUrl', 'searchUrl', 'ruleSearch', 'ruleBookInfo', 'ruleToc', 'ruleContent']) {
  if (!source[field]) throw new Error(`生成的阅读3 书源缺少字段: ${field}`)
}
if (source.ruleSearch.bookList !== '$.books') throw new Error('ruleSearch.bookList 不符')
if (!String(source.searchUrl).includes('{{key}}')) throw new Error('searchUrl 缺少 {{key}} 占位符')
if (!String(source.searchUrl).startsWith(base)) throw new Error(`searchUrl 未指向本服务: ${source.searchUrl}`)
console.log(`  ✓ 规则完整：bookList=${source.ruleSearch.bookList}，searchUrl 指向本服务`)

const single = await call(`/api/subscribe/${encodeURIComponent(source.bookSourceUrl.replace('reader-panghu://', ''))}`)
if (!Array.isArray(single) || single.length !== 1) throw new Error('按 id 订阅应只返回一个书源')
console.log(`  ✓ /api/subscribe/<id> → ${single[0].bookSourceName}`)

// the subscription must actually resolve through the generated rules
const searchPayload = await call(`/api/search?q=${encodeURIComponent('订阅')}&source=${encodeURIComponent(source.bookSourceUrl.replace('reader-panghu://', ''))}`)
if (!searchPayload.books?.length) throw new Error('订阅书源指向的搜索接口没有结果')
console.log(`  ✓ 订阅书源可用：搜到 ${searchPayload.books.length} 本`)

console.log('\nsubscription checks passed')
