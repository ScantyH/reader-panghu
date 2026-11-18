/**
 * 换源 test：手动换源保留章节进度、本地书不换源。
 *
 *   node scripts/test-switch.mjs
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 18650 + Math.floor(Math.random() * 90)
const dataDir = mkdtempSync(join(tmpdir(), 'reader-panghu-switch-'))
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
      if ((await fetch(`${base}/api/health`)).ok) return
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

const sourceB = {
  bookSourceUrl: 'https://switch-b.example',
  bookSourceName: '源B可用',
  enabled: true,
  html: `<script>
async function search(key){ return JSON.stringify([{bookUrl:'https://b.example/book/9',name:'换源测试书',author:'QA',tocUrl:'https://b.example/book/9/toc',type:0}]) }
async function info(url){ return JSON.stringify({bookUrl:url,name:'换源测试书',author:'QA',tocUrl:'https://b.example/book/9/toc',type:0}) }
async function chapter(toc){ return JSON.stringify(['序章','第一章','第二章','第三章'].map((title,index)=>({name:title,chapterId:'https://b.example/ch/'+index,index}))) }
async function content(url){ return 'B 源正文，换源后应该看到这一段。'+url }
</script>`,
}

const bookA = {
  name: '换源测试书',
  author: 'QA',
  bookUrl: 'https://a.example/book/1',
  origin: 'https://switch-a.example',
  originName: '源A已失效',
  tocUrl: 'https://a.example/book/1/toc',
  totalChapterNum: 3,
  durChapterIndex: 1,
  durChapterTitle: '第二章',
  durChapterPos: 50,
  canUpdate: true,
}

try {
  await start()
  const token = (await call('/reader3/login', { method: 'POST', body: { username: 'admin', password: 'secret123' } })).data.token
  await call('/reader3/importBookSources', { method: 'POST', token, body: { name: '换源批次', sources: [sourceB] } })
  await call('/reader3/saveBook', { method: 'POST', token, body: bookA })

  const available = await call('/reader3/getAvailableBookSource', {
    method: 'POST',
    token,
    body: { name: '换源测试书', author: 'QA', origin: bookA.origin },
  })
  check('手动换源能找到其它来源', available.isSuccess === true && available.data.books.some((book) => book.origin === sourceB.bookSourceUrl), JSON.stringify(available.data))

  await call('/reader3/saveBook', { method: 'POST', token, body: bookA })
  const manual = await call('/reader3/setBookSource', {
    method: 'POST',
    token,
    body: { bookUrl: bookA.bookUrl, newUrl: 'https://b.example/book/9', bookSourceUrl: sourceB.bookSourceUrl },
  })
  check('手动换源成功', manual.isSuccess === true && manual.data?.origin === sourceB.bookSourceUrl, manual.errorMsg)
  check('手动换源按章节名定位', manual.data?.durChapterIndex === 2 && manual.data?.durChapterTitle === '第二章', JSON.stringify(manual.data))
  check('手动换源保留阅读位置', manual.data?.durChapterPos === 50, String(manual.data?.durChapterPos))

  const localBook = { ...bookA, bookUrl: 'local://switch-local', origin: 'local://txt', originName: '本地', name: '本地书' }
  await call('/reader3/saveBook', { method: 'POST', token, body: localBook })
  const localManual = await call('/reader3/setBookSource', {
    method: 'POST',
    token,
    body: { bookUrl: localBook.bookUrl, newUrl: 'https://b.example/book/9', bookSourceUrl: sourceB.bookSourceUrl },
  })
  check('本地书不手动换源', localManual.isSuccess === false && /本地/.test(localManual.errorMsg), localManual.errorMsg)

  await stop()
  console.log(failures ? `\n换源 ${failures} 项失败` : '\n换源 checks passed')
  process.exit(failures ? 1 : 0)
} catch (error) {
  console.error(`\n✗ ${error.message}`)
  await stop()
  cleanup()
  process.exit(1)
}
