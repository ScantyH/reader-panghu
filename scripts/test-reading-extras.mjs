/**
 * 阅读统计 + WebDAV 浏览 test。
 *
 *   node scripts/test-reading-extras.mjs [baseUrl]
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

// 极简 WebDAV：PROPFIND 返回一条目录 + 一条文件
const DAV_XML = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/books/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/books/backup.json</d:href>
    <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>2048</d:getcontentlength><d:getlastmodified>Mon, 16 Nov 2026 10:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`

const server = createServer((req, res) => {
  if (req.method === 'PROPFIND') {
    res.writeHead(207, { 'content-type': 'application/xml; charset=utf-8' })
    res.end(DAV_XML)
    return
  }
  res.writeHead(404).end()
})
const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))

try {
  const before = await call('/reader3/getReadingStats')
  if (typeof before.totalSeconds !== 'number') throw new Error('统计接口结构不对')

  await call('/reader3/saveReadingTime', { method: 'POST', body: { bookUrl: 'local://txt/x', seconds: 120, chapters: 3 } })
  await call('/reader3/saveReadingTime', { method: 'POST', body: { bookUrl: 'local://txt/x', seconds: 60, chapters: 1 } })
  const after = await call('/reader3/getReadingStats')
  if (after.totalSeconds < 180) throw new Error(`时长未累计：${after.totalSeconds}`)
  if (after.totalChapters < 4) throw new Error(`章节数未累计：${after.totalChapters}`)
  console.log(`  ✓ 阅读统计 → ${after.totalSeconds}s / ${after.totalChapters} 章，近 ${after.days.length} 天有记录`)

  // 越界时长要被夹住
  await call('/reader3/saveReadingTime', { method: 'POST', body: { seconds: 999999 } })
  const clamped = await call('/reader3/getReadingStats')
  const today = clamped.days.at(-1)
  if (today.seconds > 5000) throw new Error(`时长没有被上限夹住：${today.seconds}`)
  console.log('  ✓ 异常时长被限制')

  const dav = await call('/reader3/webdavList', {
    method: 'POST',
    body: { url: `http://127.0.0.1:${port}/books/` },
  })
  if (!dav.entries.length) throw new Error('WebDAV 没有解析出条目')
  const file = dav.entries.find((entry) => entry.href.includes('backup.json'))
  if (!file || file.size !== 2048) throw new Error(`文件条目解析错误：${JSON.stringify(dav.entries)}`)
  if (!dav.entries.some((entry) => entry.isDir)) throw new Error('目录条目未识别')
  console.log(`  ✓ WebDAV 浏览 → ${dav.entries.length} 条（含目录与 ${file.size} 字节文件）`)
} finally {
  server.close()
}

console.log('\n阅读增强 checks passed')
