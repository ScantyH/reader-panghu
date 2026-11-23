/**
 * 账号头像、管理员不可降级、用户置顶、书仓分类排序 test。
 *
 *   node scripts/test-account.mjs
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 18350 + Math.floor(Math.random() * 90)
const dataDir = mkdtempSync(join(tmpdir(), 'reader-panghu-account-'))
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
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('服务没有起来')
}
const stop = async () => {
  if (!server || server.exitCode !== null) return
  await new Promise((resolve) => { server.once('exit', resolve); server.kill() })
}
const call = async (path, { method = 'GET', body, token } = {}) => {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers['x-auth-token'] = token
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return response.json()
}
process.on('exit', () => { try { server?.kill() } catch {} ; try { rmSync(dataDir, { recursive: true, force: true }) } catch {} })

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

try {
  await start()
  const token = (await call('/reader3/login', { method: 'POST', body: { username: 'admin', password: 'secret123' } })).data.token
  const avatar = await call('/reader3/setAvatar', { method: 'POST', token, body: { avatar: png } })
  check('设置头像成功', avatar.isSuccess === true, avatar.errorMsg)
  const info = (await call('/reader3/getUserInfo', { token })).data
  check('用户信息返回头像', info.avatar === png, String(info.avatar).slice(0, 20))
  const bad = await call('/reader3/setAvatar', { method: 'POST', token, body: { avatar: 'not-an-image' } })
  check('拒绝非法头像', bad.isSuccess === false, bad.errorMsg)

  const demote = await call('/reader3/setUserRole', { method: 'POST', token, body: { username: 'admin', role: 'user' } })
  check('管理员不能被降为普通用户', demote.isSuccess === false && /管理员/.test(demote.errorMsg), demote.errorMsg)

  const user = await call('/reader3/register', { method: 'POST', body: { username: 'tester', password: 'secret123' } })
  check('创建测试用户', user.isSuccess === true, user.errorMsg)
  await call('/reader3/reorderUsers', { method: 'POST', token, body: { usernames: ['tester'] } })
  const list = (await call('/reader3/getUserList', { token })).data
  check('管理员固定排在最前', list[0]?.role === 'admin', JSON.stringify(list.map((item) => `${item.username}:${item.role}`)))
  check('用户列表返回头像字段', Array.isArray(list) && 'avatar' in list[0])

  const catA = await call('/reader3/warehouse/mkdir', { method: 'POST', token, body: { path: '', name: '分类A' } })
  const catB = await call('/reader3/warehouse/mkdir', { method: 'POST', token, body: { path: '', name: '分类B' } })
  check('创建书仓分类', catA.isSuccess === true && catB.isSuccess === true, `${catA.errorMsg}/${catB.errorMsg}`)
  await call('/reader3/warehouse/reorder', { method: 'POST', token, body: { path: '', names: ['分类B', '分类A'] } })
  const warehouse = (await call('/reader3/warehouse?path=', { token })).data
  check('书仓分类按自定义顺序显示', warehouse.categories.map((item) => item.name).join(',') === '分类B,分类A', JSON.stringify(warehouse.categories.map((item) => item.name)))

  const createMember = await call('/reader3/createUser', {
    method: 'POST',
    token,
    body: {
      username: 'member',
      password: 'secret123',
      note: '家人',
      bookLimit: 2,
      sourceLimit: 1,
      allowWebdav: false,
      allowWarehouse: false,
      allowEditSources: false,
      allowEditRss: true,
    },
  })
  check('管理员可新建用户并配置权限', createMember.isSuccess === true, createMember.errorMsg)
  const member = (await call('/reader3/login', { method: 'POST', body: { username: 'member', password: 'secret123' } })).data
  const memberInfo = (await call('/reader3/getUserInfo', { token: member?.token })).data
  check(
    '新用户权限已生效',
    memberInfo?.bookLimit === 2 &&
      memberInfo?.sourceLimit === 1 &&
      memberInfo?.allowWebdav === false &&
      memberInfo?.allowWarehouse === false &&
      memberInfo?.allowEditSources === false &&
      memberInfo?.allowEditRss === true,
    JSON.stringify(memberInfo),
  )
  const memberCreate = await call('/reader3/createUser', {
    method: 'POST',
    token: member?.token,
    body: { username: 'nobody', password: 'secret123' },
  })
  check('普通用户不能新建用户', memberCreate.isSuccess === false && /管理员/.test(memberCreate.errorMsg), memberCreate.errorMsg)
  const duplicate = await call('/reader3/createUser', {
    method: 'POST',
    token,
    body: { username: 'member', password: 'secret123' },
  })
  check('不能创建重名用户', duplicate.isSuccess === false && /已存在/.test(duplicate.errorMsg), duplicate.errorMsg)
  const shortPassword = await call('/reader3/createUser', {
    method: 'POST',
    token,
    body: { username: 'shortpass', password: '123' },
  })
  check('新用户密码至少 6 位', shortPassword.isSuccess === false && /6 位/.test(shortPassword.errorMsg), shortPassword.errorMsg)

  const removeDefault = await call('/reader3/deleteUser', { method: 'POST', token, body: { username: 'reader' } })
  check('默认普通账号可以删除', removeDefault.isSuccess === true, removeDefault.errorMsg)
  const afterRemove = (await call('/reader3/getUserList', { token })).data
  check('删除后用户列表不再出现 reader', !afterRemove.some((item) => item.username === 'reader'), JSON.stringify(afterRemove.map((item) => item.username)))

  await stop()
  await start()
  const token2 = (await call('/reader3/login', { method: 'POST', body: { username: 'admin', password: 'secret123' } })).data.token
  const afterRestart = (await call('/reader3/getUserList', { token: token2 })).data
  check('重启后默认账号不会被重新种回', !afterRestart.some((item) => item.username === 'reader'), JSON.stringify(afterRestart.map((item) => item.username)))

  await stop()
  console.log(failures ? `\n账号/书仓 ${failures} 项失败` : '\n账号/书仓 checks passed')
  process.exit(failures ? 1 : 0)
} catch (error) {
  console.error(`\n✗ ${error.message}`)
  await stop()
  process.exit(1)
}
