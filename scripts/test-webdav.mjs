/**
 * WebDAV 备份 test：用本地 HTTP 服务模拟 WebDAV，验证上传与恢复。
 *
 *   node scripts/test-webdav.mjs [baseUrl]
 */

import { createServer } from 'node:http'
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

// 极简 WebDAV：PUT 存，GET 取
let stored = null
const server = createServer((req, res) => {
  if (req.method === 'PUT') {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      stored = body
      res.writeHead(201).end()
    })
    return
  }
  if (req.method === 'GET') {
    if (!stored) return res.writeHead(404).end()
    res.writeHead(200, { 'content-type': 'application/json' }).end(stored)
    return
  }
  res.writeHead(405).end()
})
const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const davUrl = `http://127.0.0.1:${port}/backup.json`
console.log(`模拟 WebDAV: ${davUrl}`)

try {
  // 准备数据：一个书源 + 一本书
  const fixture = JSON.parse(readFileSync('scripts/fixtures/synthetic-source.json', 'utf8'))
  await call('/reader3/saveBookSources', { method: 'POST', body: [fixture] })
  const found = (await call('/reader3/searchBookMulti', { method: 'POST', body: { key: '备份' } }))[0]
  const info = await call('/reader3/getBookInfo', { method: 'POST', body: { url: found.bookUrl, bookSourceUrl: found.origin } })
  await call('/reader3/saveBook', { method: 'POST', body: info })

  const before = await call('/reader3/getBookshelf')
  console.log(`  ✓ 当前书架 ${before.length} 本`)

  const uploaded = await call('/reader3/webdavBackup', { method: 'POST', body: { url: davUrl } })
  if (!uploaded.uploaded || !stored) throw new Error('备份未写入 WebDAV')
  const parsed = JSON.parse(stored)
  if (parsed.format !== 'reader-panghu-backup') throw new Error('备份格式标记缺失')
  if (!parsed.books.length || !parsed.sources.length) throw new Error('备份内容不完整')
  console.log(`  ✓ 备份上传 → ${uploaded.bytes} 字节（书 ${parsed.books.length} / 源 ${parsed.sources.length}）`)

  // 清空书架后恢复
  await call('/reader3/deleteBooks', { method: 'POST', body: before.map((book) => ({ bookUrl: book.bookUrl })) })
  const emptied = await call('/reader3/getBookshelf')
  if (emptied.length !== 0) throw new Error(`清空失败，仍有 ${emptied.length} 本`)

  const restored = await call('/reader3/webdavRestore', { method: 'POST', body: { url: davUrl } })
  const after = await call('/reader3/getBookshelf')
  if (after.length !== before.length) throw new Error(`恢复后数量不符：${after.length} vs ${before.length}`)
  console.log(`  ✓ 恢复完成 → 书 ${restored.restored.books} / 源 ${restored.restored.sources}，书架 ${after.length} 本`)

  // 非本项目的备份应被拒绝
  stored = JSON.stringify({ format: 'something-else' })
  const rejected = await fetch(`${base}/reader3/webdavRestore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: davUrl }),
  }).then((response) => response.json())
  if (rejected.isSuccess !== false) throw new Error('异类备份应被拒绝')
  console.log(`  ✓ 异类备份被拒绝 → ${rejected.errorMsg}`)
} finally {
  server.close()
}

console.log('\nWebDAV checks passed')
