/**
 * 一键验证：起一个临时实例，跑完所有套件，再清理。
 *
 *   node scripts/run-all-tests.mjs [--keep]
 *
 * 退出码即结论：0 全绿，1 有失败。适合放进 CI 或交付前自检。
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SUITES = [
  'test-reader3',
  'test-comments',
  'test-extras',
  'test-cache',
  'test-sync',
  'test-subscribe',
  'test-epub',
  'test-docx',
  'test-mobi',
  'test-groups',
  'test-updates',
  'test-rss',
  'test-webdav',
  'test-rule-source',
  'test-source-tools',
  'test-bundles',
  'test-cards',
  'test-order',
  'test-switch',
  'test-warehouse',
  'test-reading-extras',
  'test-legado-client',
  'test-auth',
  'test-auth-persist',
  'test-permissions',
  'test-isolation',
]

const keep = process.argv.includes('--keep')
const port = 18200 + Math.floor(Math.random() * 300)
const dataDir = mkdtempSync(join(tmpdir(), 'reader-panghu-verify-'))

console.log(`临时实例：port=${port} data=${dataDir}`)

const server = spawn(process.execPath, ['apps/server/src/index.js'], {
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, LOG_LEVEL: 'warn' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverLog = ''
server.stdout.on('data', (chunk) => (serverLog += chunk))
server.stderr.on('data', (chunk) => (serverLog += chunk))

const base = `http://127.0.0.1:${port}`
const waitForHealth = async (attempts = 60) => {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`${base}/api/health`)
      if (response.ok) return true
    } catch {
      /* 还没起来 */
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

const cleanup = () => {
  try {
    server.kill()
  } catch {
    /* ignore */
  }
  if (!keep) {
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      /* Windows 上偶发占用，忽略 */
    }
  }
}

const healthy = await waitForHealth()
if (!healthy) {
  console.error('服务没有起来，日志：\n' + serverLog.slice(-2000))
  cleanup()
  process.exit(1)
}
console.log('服务就绪，开始跑套件\n')

const failures = []
for (const suite of SUITES) {
  const script = `scripts/${suite}.mjs`
  if (!existsSync(script)) {
    failures.push(`${suite} (文件缺失)`)
    continue
  }
  const result = spawnSync(process.execPath, [script, base], { encoding: 'utf8' })
  const ok = result.status === 0
  if (!ok) failures.push(suite)
  const summary = (result.stdout || '').trim().split('\n').filter(Boolean).slice(-1)[0] || ''
  console.log(`${ok ? '✓' : '✗'} ${suite.padEnd(20)} ${ok ? '' : summary.slice(0, 120)}`)
}

cleanup()

console.log(`\n${SUITES.length - failures.length}/${SUITES.length} 套件通过`)
if (failures.length) {
  console.error(`失败：${failures.join(', ')}`)
  process.exit(1)
}
