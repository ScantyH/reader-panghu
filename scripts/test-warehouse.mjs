/**
 * 书仓 test：建分类 → 放书 → 浏览 → 导入书架。
 *
 *   node scripts/test-warehouse.mjs [baseUrl]
 */

import { createServer } from 'node:http'

const base = (process.argv[2] || 'http://127.0.0.1:18080').replace(/\/+$/, '')

const call = async (path, { method = 'GET', body, form } = {}) => {
  const init = { method }
  if (form) init.body = form
  else if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const payload = await (await fetch(`${base}${path}`, init)).json()
  if (payload.isSuccess === false) throw new Error(`${path} → ${payload.errorMsg}`)
  return payload.data
}

const fileOf = async (name) => {
  const form = new FormData()
  form.append('file', new Blob([`第一章 书仓\n这是书仓里的第一本书。\n第二章 继续\n第二段正文。\n1、异界来客\n第三段正文。`], { type: 'text/plain' }), name)
  return form
}

try {
  const root = await call('/reader3/warehouse')
  if (!Array.isArray(root.categories)) throw new Error('书仓接口返回结构不对')
  console.log(`  ✓ 书仓根目录可访问（分类 ${root.categories.length} 个）`)

  await call('/reader3/warehouse/mkdir', { method: 'POST', body: { path: '', name: '玄幻' } })
  const afterMkdir = await call('/reader3/warehouse')
  if (!afterMkdir.categories.some((item) => item.name === '玄幻')) throw new Error('分类未创建')
  console.log('  ✓ 新建分类「玄幻」')

  await call('/reader3/warehouse/upload?path=玄幻', { method: 'POST', form: await fileOf('书仓测试书.txt') })
  const listing = await call('/reader3/warehouse?path=玄幻')
  if (!listing.files.some((item) => item.name === '书仓测试书.txt')) throw new Error('上传未出现在书仓里')
  console.log(`  ✓ 上传到分类，书仓内 ${listing.files.length} 个文件`)

  const imported = await call('/reader3/warehouse/import', { method: 'POST', body: { path: '玄幻/书仓测试书.txt' } })
  if (!imported.book?.name) throw new Error('导入没有返回书')
  if (!imported.book.customCoverUrl) throw new Error('书仓导入未生成封面')
  if (Number(imported.book.totalChapterNum) !== 3) throw new Error(`书仓本地书应有 3 章，实际 ${imported.book.totalChapterNum}`)
  console.log(`  ✓ 导入书架 → 《${imported.book.name}》，${imported.book.totalChapterNum} 章，封面 ${imported.book.customCoverUrl}`)

  const shelf = await call('/reader3/getBookshelf')
  if (!shelf.some((book) => book.bookUrl === imported.book.bookUrl)) throw new Error('书不在书架里')
  const content = await call('/reader3/getBookContent', {
    method: 'POST',
    body: { bookUrl: imported.book.bookUrl, index: 0 },
  })
  if (!content.includes('书仓里的第一本书')) throw new Error(`正文读取失败：${content}`)
  console.log('  ✓ 书架可见且正文可读')

  // 路径越界必须被拒
  const escaped = await fetch(`${base}/reader3/warehouse?path=../../etc`).then((response) => response.json())
  if (escaped.isSuccess !== false) throw new Error('越界路径应被拒绝')
  console.log(`  ✓ 越界路径被拒 → ${escaped.errorMsg}`)

  // 非空分类不能删
  const blocked = await fetch(`${base}/reader3/warehouse/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: '玄幻' }),
  }).then((response) => response.json())
  if (blocked.isSuccess !== false) throw new Error('非空分类应拒绝删除')
  console.log(`  ✓ 非空分类拒绝删除 → ${blocked.errorMsg}`)

  await call('/reader3/warehouse/delete', { method: 'POST', body: { path: '玄幻/书仓测试书.txt' } })
  await call('/reader3/warehouse/delete', { method: 'POST', body: { path: '玄幻' } })
  console.log('  ✓ 清理文件与空分类')
} finally {
  // 无外部服务需要关闭
}

console.log('\n书仓 checks passed')
