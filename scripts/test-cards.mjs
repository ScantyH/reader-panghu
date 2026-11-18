/**
 * 正文卡片（神评论/本章说）与书源密钥 test。
 *
 *   node scripts/test-cards.mjs
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 18850 + Math.floor(Math.random() * 90)
const dataDir = mkdtempSync(join(tmpdir(), 'reader-panghu-cards-'))
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
      const response = await fetch(`${base}/api/health`)
      if (response.ok) return
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

const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><rect width="300" height="80" fill="#8b3a3a"/><text x="16" y="48" font-size="28" fill="white">神评论</text></svg>',
).toString('base64')
const dataUri = `data:image/svg+xml;base64,${svg}`

const html = `<script>
async function search(key){ return JSON.stringify([{bookUrl:'local://card/book/1',name:'卡片测试书',author:'QA',tocUrl:'local://card/book/1/catalog',type:0}]) }
async function info(url){ return JSON.stringify({bookUrl:url,name:'卡片测试书',author:'QA',tocUrl:'local://card/book/1/catalog',type:0}) }
async function chapter(toc){ return JSON.stringify([{name:'第一章 卡片',chapterId:'local://card/chapter/1',index:0}]) }
async function content(url){
  return '<p>第一段正文。</p>' +
    '<img src="${dataUri}" />' +
    '<p>第二段正文，段评在这里<img src="dp:8,{\\'js\\':\\'showCmt(\\"https://example.com/comment\\")\\'}" /></p>' +
    '<img src="${base}/brand/logo-128.png,{\\'headers\\':{\\'x-test\\':\\'1\\'}}" />'
}
</script>`

try {
  await start()
  const admin = (await call('/reader3/login', { method: 'POST', body: { username: 'admin', password: 'secret123' } })).data
  const token = admin.token
  const imported = await call('/reader3/importBookSources', {
    method: 'POST',
    token,
    body: { name: '卡片测试批次', sources: [{ bookSourceUrl: 'local://card', bookSourceName: '卡片测试源', enabled: true, html }] },
  })
  check('导入卡片书源', imported.isSuccess === true, imported.errorMsg)
  const source = imported.data.bundle
  const info = (await call('/reader3/searchBookMulti', { method: 'POST', token, body: { key: '卡片', bookSourceBundle: source } })).data[0]
  await call('/reader3/saveBook', { method: 'POST', token, body: info })
  await call('/reader3/getChapterList', { method: 'POST', token, body: { bookUrl: info.bookUrl, tocUrl: info.tocUrl, bookSourceUrl: info.origin } })

  const content = (await call('/reader3/getBookContent', { method: 'POST', token, body: { bookUrl: info.bookUrl, index: 0 } })).data
  check('正文不再出现 [图片] 占位', !String(content).includes('[图片]'), content.slice(0, 80))
  check('正文保留两段文字', String(content).includes('第一段正文') && String(content).includes('第二段正文'), content)

  const comments = (await call('/reader3/getParagraphComments', { method: 'POST', token, body: { bookUrl: info.bookUrl, index: 0 } })).data
  check('段评标记正确', comments.markers?.some((m) => Number(m.paragraph) === 1 && m.count === 8), JSON.stringify(comments.markers))
  check('解析出两张卡片', comments.cards?.length === 2, JSON.stringify(comments.cards))
  check('SVG 卡片保留 data URI', comments.cards?.[0]?.src?.startsWith('data:image/svg+xml'), comments.cards?.[0]?.src?.slice(0, 30))
  const proxied = comments.cards?.[1]?.src || ''
  check('HTTP 卡片走服务端代理', proxied.startsWith('/reader3/contentImage?id='), proxied)

  const imageResponse = await fetch(`${base}${proxied}${proxied.includes('?') ? '&' : '?'}token=${token}`)
  check('代理图片可访问', imageResponse.ok && String(imageResponse.headers.get('content-type')).startsWith('image/'), `${imageResponse.status} ${imageResponse.headers.get('content-type')}`)

  const set = await call('/reader3/setSourceKey', { method: 'POST', token, body: { bookSourceUrl: 'local://card', key: 'secret-key-1234' } })
  check('设置书源密钥', set.isSuccess === true && set.data?.hasKey === true, JSON.stringify(set.data || set.errorMsg))
  const list = (await call('/reader3/getBookSources', { token })).data
  const row = list.find((item) => item.bookSourceUrl === 'local://card')
  check('接口不回传密钥明文', row?.hasKey === true && row?.keyHint === '1234' && !JSON.stringify(row).includes('secret-key-1234'), JSON.stringify(row?._runtime))
  await call('/reader3/saveBookSource', { method: 'POST', token, body: { ...row, bookSourceName: '卡片测试源改名' } })
  const afterSave = (await call('/reader3/getBookSources', { token })).data.find((item) => item.bookSourceUrl === 'local://card')
  check('编辑书源不会丢密钥', afterSave?.hasKey === true, JSON.stringify(afterSave?._runtime))
  const cleared = await call('/reader3/setSourceKey', { method: 'POST', token, body: { bookSourceUrl: 'local://card', key: '' } })
  check('可以清除密钥', cleared.data?.hasKey === false, JSON.stringify(cleared.data))

  await stop()
  console.log(failures ? `\n正文卡片 ${failures} 项失败` : '\n正文卡片 checks passed')
  process.exit(failures ? 1 : 0)
} catch (error) {
  console.error(`\n✗ ${error.message}`)
  await stop()
  cleanup()
  process.exit(1)
}
