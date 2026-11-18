/**
 * 书源批次（bundle）行为 test：
 *  - 每次导入都新建批次，同名自动加序号，不覆盖/不追加到已有批次
 *  - 批次数量默认上限可配置，超过后拒绝导入
 *  - 多批次可汇总成一个批次
 *  - 搜索可按批次过滤
 *
 *   node scripts/test-bundles.mjs
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 18900 + Math.floor(Math.random() * 90)
const dataDir = mkdtempSync(join(tmpdir(), 'reader-panghu-bundles-'))
const base = `http://127.0.0.1:${port}`
let server = null
let failures = 0

const check = (label, condition, detail = '') => {
  if (!condition) failures += 1
  console.log(`  ${condition ? '✓' : '✗'} ${label}${condition ? '' : ` -> ${detail}`}`)
}

const start = async () => {
  const child = spawn(process.execPath, ['apps/server/src/index.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      LOG_LEVEL: 'warn',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'secret123',
      SOURCE_BUNDLE_LIMIT: '5',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  server = child
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`)
      if (response.ok) return
    } catch {
      /* 还没起来 */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('服务没有起来')
}

const stop = async () => {
  const child = server
  server = null
  if (!child || child.exitCode !== null) return
  await new Promise((resolve) => {
    child.once('exit', resolve)
    child.kill()
  })
  await new Promise((resolve) => setTimeout(resolve, 300))
}

const call = async (path, { method = 'GET', body, token } = {}) => {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers['x-auth-token'] = token
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
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
    /* Windows 占用 */
  }
}
process.on('exit', cleanup)

const source = (url, name = url) => ({ bookSourceUrl: url, bookSourceName: name, enabled: true })
const importSources = (sources, name, token) =>
  call('/reader3/importBookSources', { method: 'POST', token, body: { sources, name } })
const bundlesOf = async (token) => (await call('/reader3/getSourceBundles', { token })).data || []

try {
  await start()
  const admin = (await call('/reader3/login', { method: 'POST', body: { username: 'admin', password: 'secret123' } })).data
  const token = admin.token
  check('管理员登录', Boolean(token))

  const first = await importSources([source('https://a.example', 'A')], '测试批次', token)
  check('首次导入创建批次', first.isSuccess === true && first.data?.bundle === '测试批次', JSON.stringify(first.data || first.errorMsg))

  const second = await importSources([source('https://b.example', 'B')], '测试批次', token)
  check(
    '同名再次导入自动新建批次',
    second.isSuccess === true && second.data?.bundle === '测试批次 (2)' && second.data.bundle !== first.data.bundle,
    JSON.stringify(second.data || second.errorMsg),
  )

  const bundles = await bundlesOf(token)
  check('批次汇总数与计数', bundles.length >= 2 && bundles.every((b) => b.count >= 1 && 'enabledCount' in b), JSON.stringify(bundles))

  // 可搜索的 WebView 书源单独一个批次
  const fixture = JSON.parse(readFileSync('scripts/fixtures/synthetic-source.json', 'utf8'))
  const searchable = await importSources([fixture], '可搜索批次', token)
  check('导入可搜索批次', searchable.isSuccess === true, searchable.errorMsg)

  const d = await importSources([source('https://d.example')], '批次D', token)
  const e = await importSources([source('https://e.example')], '批次E', token)
  check('上限前可继续新建', d.isSuccess === true && e.isSuccess === true, `${d.errorMsg} / ${e.errorMsg}`)

  const over = await importSources([source('https://f.example')], '批次F', token)
  check('超过批次上限被拒绝', over.isSuccess === false && /上限/.test(over.errorMsg), over.errorMsg)

  const merged = await call('/reader3/mergeBundles', { method: 'POST', token, body: { names: ['测试批次', '测试批次 (2)'], into: '汇总批次' } })
  check('汇总选中批次', merged.isSuccess === true && merged.data?.merged === 2, JSON.stringify(merged.data || merged.errorMsg))
  const afterMerge = await bundlesOf(token)
  check(
    '汇总后只剩一个汇总批次',
    afterMerge.some((b) => b.name === '汇总批次' && b.count === 2) && !afterMerge.some((b) => b.name === '测试批次'),
    JSON.stringify(afterMerge.map((b) => `${b.name}:${b.count}`)),
  )

  const searched = await call('/reader3/searchBookMulti', {
    method: 'POST',
    token,
    body: { key: '缓存', bookSourceBundle: '可搜索批次' },
  })
  check('搜索可按批次过滤出结果', searched.isSuccess === true && (searched.data || []).length > 0, JSON.stringify(searched.data?.length))
  const other = await call('/reader3/searchBookMulti', {
    method: 'POST',
    token,
    body: { key: '缓存', bookSourceBundle: '汇总批次' },
  })
  check('别的批次不会串结果', other.isSuccess === true && (other.data || []).length === 0, JSON.stringify(other.data))

  await stop()
  console.log(failures ? `\n书源批次 ${failures} 项失败` : '\n书源批次 checks passed')
  process.exit(failures ? 1 : 0)
} catch (error) {
  console.error(`\n✗ ${error.message}`)
  await stop()
  cleanup()
  process.exit(1)
}
