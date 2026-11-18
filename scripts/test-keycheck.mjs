/**
 * 书源密钥检测 test：设置密钥后每小时检测一次，状态写回书源。
 *
 *   node scripts/test-keycheck.mjs
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 18550 + Math.floor(Math.random() * 90)
const dataDir = mkdtempSync(join(tmpdir(), 'reader-panghu-key-'))
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
const bad = {
  bookSourceUrl: 'local://key-bad',
  bookSourceName: '坏密钥源',
  enabled: true,
  html: "<script>async function search(key){ throw new Error('当前密钥的设备数已满') }</script>",
}

try {
  await start()
  const token = (await call('/reader3/login', { method: 'POST', body: { username: 'admin', password: 'secret123' } })).data.token
  await call('/reader3/importBookSources', { method: 'POST', token, body: { name: '密钥批次', sources: [fixture, bad] } })
  await call('/reader3/setSourceKey', { method: 'POST', token, body: { bookSourceUrl: fixture.bookSourceUrl, key: 'good-key' } })
  await call('/reader3/setSourceKey', { method: 'POST', token, body: { bookSourceUrl: bad.bookSourceUrl, key: 'bad-key' } })

  const first = await call('/reader3/checkSourceKeys', { method: 'POST', token })
  check('首次检测会检查所有设密钥的书源', first.isSuccess === true && first.data?.checked === 2, JSON.stringify(first.data))
  const good = first.data?.results?.find((item) => item.bookSourceUrl === fixture.bookSourceUrl)
  const invalid = first.data?.results?.find((item) => item.bookSourceUrl === bad.bookSourceUrl)
  check('有效密钥标记为有效', good?.valid === true, JSON.stringify(good))
  check('失效密钥标记为失效', invalid?.valid === false && /设备数已满/.test(invalid.message), JSON.stringify(invalid))

  const list = (await call('/reader3/getBookSources', { token })).data
  const goodSource = list.find((item) => item.bookSourceUrl === fixture.bookSourceUrl)
  const badSource = list.find((item) => item.bookSourceUrl === bad.bookSourceUrl)
  check('接口返回密钥状态', goodSource?.keyCheck?.valid === true && badSource?.keyCheck?.valid === false, JSON.stringify(goodSource?.keyCheck))
  check('仍不回传密钥明文', goodSource?.hasKey === true && !JSON.stringify(goodSource).includes('good-key'), JSON.stringify(goodSource?._runtime))

  const checkedAt = goodSource?.keyCheck?.checkedAt
  const second = await call('/reader3/checkSourceKeys', { method: 'POST', token })
  check('一小时内不重复检测', second.isSuccess === true && second.data?.checked === 0, JSON.stringify(second.data))
  check('缓存状态不变', second.data?.results?.find((item) => item.bookSourceUrl === fixture.bookSourceUrl)?.checkedAt === checkedAt)

  await stop()
  console.log(failures ? `\n密钥检测 ${failures} 项失败` : '\n密钥检测 checks passed')
  process.exit(failures ? 1 : 0)
} catch (error) {
  console.error(`\n✗ ${error.message}`)
  await stop()
  cleanup()
  process.exit(1)
}
