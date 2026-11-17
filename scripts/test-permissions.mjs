/**
 * 子账号配额与权限 test：管理员排序、书籍/书源上限、功能开关、书源分配。
 *
 *   node scripts/test-permissions.mjs
 *
 * 自带临时服务与管理员账号，不依赖 run-all-tests 的共享实例。
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 18800 + Math.floor(Math.random() * 180)
const dataDir = mkdtempSync(join(tmpdir(), 'reader-panghu-perm-'))
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
  throw new Error('服务没有起来（见上面的服务日志）')
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
    /* Windows 上可能短暂占用 */
  }
}
process.on('exit', cleanup)

try {
  await start()

  const admin = (await call('/reader3/login', { method: 'POST', body: { username: 'admin', password: 'secret123' } })).data
  const sub = (await call('/reader3/register', { method: 'POST', body: { username: 'sub1', password: 'secret123' } })).data
  check('管理员登录 / 子账号注册', Boolean(admin?.token) && Boolean(sub?.token))

  const users = (await call('/reader3/getUserList', { token: admin.token })).data || []
  check('管理员排在第一位', users[0]?.username === 'admin' && users[0]?.role === 'admin', users.map((user) => user.username).join(','))

  const restricted = await call('/reader3/setUserSettings', {
    method: 'POST',
    token: admin.token,
    body: {
      username: 'sub1',
      bookLimit: 1,
      sourceLimit: 1,
      allowWebdav: false,
      allowWarehouse: false,
      allowEditSources: false,
      allowEditRss: false,
    },
  })
  check('管理员分配配额与开关', restricted.isSuccess === true, restricted.errorMsg)

  const me = (await call('/reader3/getUserInfo', { token: sub.token })).data
  check('子账号读到自己的权限', me?.bookLimit === 1 && me?.allowWebdav === false, JSON.stringify(me))

  const first = await call('/reader3/saveBook', { method: 'POST', token: sub.token, body: { name: 'a', bookUrl: 'local://a', origin: 'local' } })
  const second = await call('/reader3/saveBook', { method: 'POST', token: sub.token, body: { name: 'b', bookUrl: 'local://b', origin: 'local' } })
  check('书籍上限生效', first.isSuccess === true && second.isSuccess === false && /书架最多 1 本/.test(second.errorMsg), second.errorMsg)

  const blockedSource = await call('/reader3/saveBookSources', {
    method: 'POST',
    token: sub.token,
    body: { sources: [{ bookSourceUrl: 'https://a.example', bookSourceName: 'A' }] },
  })
  check('关闭编辑书源后不能导入', blockedSource.isSuccess === false && /编辑书源/.test(blockedSource.errorMsg), blockedSource.errorMsg)

  const webdav = await call('/reader3/webdavBackup', { method: 'POST', token: sub.token, body: { url: 'https://dav.example/x' } })
  check('关闭 WebDAV 后被拒', webdav.isSuccess === false && /WebDAV/.test(webdav.errorMsg), webdav.errorMsg)

  const warehouse = await call('/reader3/warehouse', { token: sub.token })
  check('关闭书仓后被拒', warehouse.isSuccess === false && /书仓/.test(warehouse.errorMsg), warehouse.errorMsg)

  await call('/reader3/setUserSettings', {
    method: 'POST',
    token: admin.token,
    body: {
      username: 'sub1',
      bookLimit: 1,
      sourceLimit: 1,
      allowWebdav: false,
      allowWarehouse: false,
      allowEditSources: true,
      allowEditRss: true,
    },
  })
  const sourceFirst = await call('/reader3/saveBookSources', {
    method: 'POST',
    token: sub.token,
    body: { sources: [{ bookSourceUrl: 'https://a.example', bookSourceName: 'A' }] },
  })
  const sourceSecond = await call('/reader3/saveBookSource', {
    method: 'POST',
    token: sub.token,
    body: { bookSourceUrl: 'https://b.example', bookSourceName: 'B' },
  })
  check('书源上限生效', sourceFirst.isSuccess === true && sourceSecond.isSuccess === false && /书源最多 1 个/.test(sourceSecond.errorMsg), sourceSecond.errorMsg)

  const rss = await call('/reader3/saveRssSource', { method: 'POST', token: sub.token, body: { sourceUrl: 'https://rss.example/feed', sourceName: 'R' } })
  check('打开编辑 RSS 后可保存', rss.isSuccess === true, rss.errorMsg)

  const selfRestrict = await call('/reader3/setUserSettings', { method: 'POST', token: admin.token, body: { username: 'admin', bookLimit: 1 } })
  check('管理员不能给自己设限', selfRestrict.isSuccess === false, selfRestrict.errorMsg)

  for (let index = 0; index < 3; index += 1) {
    await call('/reader3/saveBook', { method: 'POST', token: admin.token, body: { name: `admin-${index}`, bookUrl: `local://admin-${index}`, origin: 'local' } })
  }
  const adminShelf = (await call('/reader3/getBookshelf', { token: admin.token })).data || []
  check('管理员不受限', adminShelf.length === 3, String(adminShelf.length))

  await call('/reader3/saveBookSources', {
    method: 'POST',
    token: admin.token,
    body: { sources: [{ bookSourceUrl: 'https://admin.example', bookSourceName: '管理员源' }] },
  })
  const copied = await call('/reader3/copyUserLibrary', { method: 'POST', token: admin.token, body: { username: 'sub1' } })
  check('管理员可分配书源 / RSS', copied.isSuccess === true && copied.data?.sources >= 1, JSON.stringify(copied))
  const subSources = (await call('/reader3/getBookSources', { token: sub.token })).data || []
  check('子账号能看到管理员分配的源', subSources.some((source) => source.bookSourceUrl === 'https://admin.example'))

  await stop()
  console.log(failures ? `\n子账号权限 ${failures} 项失败` : '\n子账号权限 checks passed')
  process.exit(failures ? 1 : 0)
} catch (error) {
  console.error(`\n✗ ${error.message}`)
  await stop()
  cleanup()
  process.exit(1)
}
