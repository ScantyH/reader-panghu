/**
 * 书源排序 test：默认 WebView 优先、手动排序持久化、批次顺序跟随。
 *
 *   node scripts/test-order.mjs
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 18750 + Math.floor(Math.random() * 90)
const dataDir = mkdtempSync(join(tmpdir(), 'reader-panghu-order-'))
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

const fixture = JSON.parse(readFileSync('scripts/fixtures/synthetic-source.json', 'utf8'))
const rule = { bookSourceUrl: 'local://order-rule', bookSourceName: 'A 规则源', enabled: true, searchUrl: 'https://example.com/search?q={{key}}' }
const importSources = (sources, name, token) => call('/reader3/importBookSources', { method: 'POST', token, body: { sources, name } })

try {
  await start()
  const token = (await call('/reader3/login', { method: 'POST', body: { username: 'admin', password: 'secret123' } })).data.token
  await importSources([rule], '排序批次A', token)
  await importSources([fixture], '排序批次B', token)

  const urls = async () => (await call('/reader3/getBookSources', { token })).data.map((source) => source.bookSourceUrl)
  const initial = await urls()
  check('默认 WebView 书源排前面', initial[0] === fixture.bookSourceUrl, initial.join(' | '))

  const reordered = [rule.bookSourceUrl, fixture.bookSourceUrl]
  const saved = await call('/reader3/reorderBookSources', { method: 'POST', token, body: { urls: reordered } })
  check('保存排序', saved.isSuccess === true, saved.errorMsg)
  const after = await urls()
  check('手动排序生效', after[0] === rule.bookSourceUrl && after[1] === fixture.bookSourceUrl, after.join(' | '))

  const bundles = (await call('/reader3/getSourceBundles', { token })).data.map((item) => item.name)
  check('批次顺序跟随书源顺序', bundles[0] === '排序批次A' && bundles[1] === '排序批次B', bundles.join(' | '))

  // 新用户 / 新数据没有排序记录时仍按 WebView 优先
  const search = await call('/reader3/searchBookMulti', { method: 'POST', token, body: { key: '缓存' } })
  check('全部书源搜索能搜到 WebView 源', search.isSuccess === true && search.data?.some((book) => book.origin === fixture.bookSourceUrl), JSON.stringify(search.data?.length))

  await stop()
  console.log(failures ? `\n书源排序 ${failures} 项失败` : '\n书源排序 checks passed')
  process.exit(failures ? 1 : 0)
} catch (error) {
  console.error(`\n✗ ${error.message}`)
  await stop()
  cleanup()
  process.exit(1)
}
