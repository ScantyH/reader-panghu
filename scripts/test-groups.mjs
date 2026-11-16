/**
 * 分组管理 test：创建 / 改名 / 归书 / 删除。
 *
 *   node scripts/test-groups.mjs [baseUrl]
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
const found = (await call('/reader3/searchBookMulti', { method: 'POST', body: { key: '分组' } }))[0]
const info = await call('/reader3/getBookInfo', { method: 'POST', body: { url: found.bookUrl, bookSourceUrl: found.origin } })
await call('/reader3/saveBook', { method: 'POST', body: info })

const created = await call('/reader3/saveBookGroup', { method: 'POST', body: { groupId: 7, groupName: '玄幻' } })
if (!created) throw new Error('分组创建失败')
let groups = await call('/reader3/getBookGroups')
if (!groups.some((group) => group.groupId === 7 && group.groupName === '玄幻')) throw new Error('新分组不在列表里')
console.log('  ✓ 创建分组「玄幻」')

await call('/reader3/saveBookGroup', { method: 'POST', body: { groupId: 7, groupName: '玄幻小说', orderNo: 3 } })
groups = await call('/reader3/getBookGroups')
if (!groups.some((group) => group.groupId === 7 && group.groupName === '玄幻小说')) throw new Error('改名未生效')
console.log('  ✓ 改名「玄幻」→「玄幻小说」')

await call('/reader3/saveBookGroupId', { method: 'POST', body: { bookUrl: info.bookUrl, groupId: 7 } })
const shelf = await call('/reader3/getBookshelf')
const book = shelf.find((item) => item.bookUrl === info.bookUrl)
if (Number(book.group) !== 7) throw new Error(`归组未生效: ${book.group}`)
console.log('  ✓ 书归入分组 7')

await call('/reader3/deleteBookGroup', { method: 'POST', body: { groupId: 7 } })
groups = await call('/reader3/getBookGroups')
if (groups.some((group) => group.groupId === 7)) throw new Error('分组未删除')
console.log('  ✓ 删除分组')

console.log('\ngroup checks passed')
