/**
 * 会话持久化 test：真实重启进程后，已登录的 token / cookie 仍然有效。
 *
 *   node scripts/test-auth-persist.mjs
 *
 * 用独立临时 DATA_DIR 起两次服务（同端口、同库），中间 kill 进程，
 * 模拟 docker restart。不依赖 run-all-tests 的共享实例。
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 18500 + Math.floor(Math.random() * 300)
const dataDir = mkdtempSync(join(tmpdir(), 'reader-panghu-persist-'))
const base = `http://127.0.0.1:${port}`
let server = null

const start = async () => {
  // 子进程日志直接继承到父进程 stdout：受限沙箱里无法给子进程建管道，
  // 而失败时上面的服务日志仍然完整可见。
  const child = spawn(process.execPath, ['apps/server/src/index.js'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, LOG_LEVEL: 'warn' },
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
  // 给端口释放留一点时间
  await new Promise((resolve) => setTimeout(resolve, 300))
}

const call = async (path, { method = 'GET', body, token, cookie } = {}) => {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers['x-auth-token'] = token
  if (cookie) headers.cookie = cookie
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { response, payload: await response.json() }
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
    /* Windows 上 WAL 句柄可能短暂占用，忽略 */
  }
}
process.on('exit', cleanup)

try {
  await start()

  // 0. 未注册任何密码账号时是单用户模式，匿名可用
  const anon = await call('/reader3/getUserInfo')
  if (!anon.payload.isSuccess) throw new Error('单用户模式下匿名 getUserInfo 不应被拒绝')
  console.log('  ✓ 初始为单用户模式')

  // 1. 注册拿 token A
  const username = `persist_${Date.now().toString(36)}`
  const registered = await call('/reader3/register', { method: 'POST', body: { username, password: 'secret123' } })
  if (!registered.payload.isSuccess) throw new Error(`注册失败：${registered.payload.errorMsg}`)
  const tokenA = registered.payload.data.token
  const setCookie = registered.response.headers.get('set-cookie') || ''
  if (!setCookie.includes('rp_session=')) throw new Error('注册没有下发会话 cookie')
  console.log('  ✓ 注册并拿到 token A')

  // 2. 同一账号再登录拿 token B，并在重启前登出 B
  const loginB = await call('/reader3/login', { method: 'POST', body: { username, password: 'secret123' } })
  if (!loginB.payload.isSuccess) throw new Error(`登录失败：${loginB.payload.errorMsg}`)
  const tokenB = loginB.payload.data.token
  const logoutB = await call('/reader3/logout', { method: 'POST', token: tokenB })
  if (!logoutB.payload.isSuccess) throw new Error('登出 token B 失败')
  console.log('  ✓ 重启前已登出 token B')

  // 3. 杀进程，同 DATA_DIR、同端口重启
  await stop()
  console.log('  · 进程已停止，准备用同一 DATA_DIR 重启')
  await start()

  // 4. 重启后 token A 仍有效
  const meA = await call('/reader3/getUserInfo', { token: tokenA })
  if (!meA.payload.isSuccess || meA.payload.data.username !== username) {
    throw new Error(`重启后 token A 失效：${meA.payload.errorMsg || JSON.stringify(meA.payload.data)}`)
  }
  console.log('  ✓ 重启后 token A 仍有效')

  // 5. 重启后浏览器 cookie 仍有效
  const viaCookie = await call('/reader3/getUserInfo', { cookie: String(setCookie).split(';')[0] })
  if (!viaCookie.payload.isSuccess || viaCookie.payload.data.username !== username) {
    throw new Error('重启后 session cookie 失效')
  }
  console.log('  ✓ 重启后 session cookie 仍有效')

  // 6. 重启前登出的 token B 不能复活
  const meB = await call('/reader3/getUserInfo', { token: tokenB })
  if (meB.payload.isSuccess) throw new Error('重启前登出的 token 在重启后复活了')
  console.log('  ✓ 重启前登出的 token 仍失效')

  // 7. 重启后登出，token A 立即失效
  const logoutA = await call('/reader3/logout', { method: 'POST', token: tokenA })
  if (!logoutA.payload.isSuccess) throw new Error('重启后登出失败')
  const meAAfter = await call('/reader3/getUserInfo', { token: tokenA })
  if (meAAfter.payload.isSuccess) throw new Error('登出后 token A 仍有效')
  console.log('  ✓ 重启后登出即时失效')

  await stop()
  console.log('\n会话持久化 checks passed')
  process.exit(0)
} catch (error) {
  console.error(`\n✗ ${error.message}`)
  await stop()
  cleanup()
  process.exit(1)
}
