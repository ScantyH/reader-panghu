/**
 * 认证 test：单用户模式回退、注册、登录、错误密码、登出、身份识别。
 *
 *   node scripts/test-auth.mjs [baseUrl]
 */

const base = (process.argv[2] || 'http://127.0.0.1:18080').replace(/\/+$/, '')

const call = async (path, { method = 'GET', body, token } = {}) => {
  const init = { method, headers: {} }
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  if (token) init.headers.authorization = `Bearer ${token}`
  const response = await fetch(`${base}${path}`, init)
  const payload = await response.json()
  return { payload, response }
}

// 1. 初始状态：未开启多用户时才允许匿名
const mode = (await call('/reader3/getAuthMode')).payload.data
console.log(`  · 初始多用户状态：${mode.enabled}`)

const info1 = (await call('/reader3/getUserInfo')).payload
if (info1.isSuccess === false && info1.errorMsg !== 'NEED_LOGIN') {
  throw new Error(`getUserInfo 异常：${info1.errorMsg}`)
}
if (!mode.enabled && !info1.isSuccess) throw new Error('单用户模式下不应要求登录')
console.log(`  ✓ 初始身份：${info1.isSuccess ? info1.data.username : '需要登录'}`)

// 2. 注册（已开启多用户时跳过，避免重复用户名）
const username = `tester_${Date.now().toString(36)}`
const registered = await call('/reader3/register', { method: 'POST', body: { username, password: 'secret123' } })
if (registered.payload.isSuccess) {
  const token = registered.payload.data.token
  console.log(`  ✓ 注册成功：${username}`)

  const cookieHeader = registered.response.headers.get('set-cookie') || ''
  if (!cookieHeader.includes('rp_session=')) throw new Error('注册没有下发会话 cookie')
  console.log('  ✓ 下发会话 cookie')

  // 3. 登录（独立 token）
  const login = await call('/reader3/login', { method: 'POST', body: { username, password: 'secret123' } })
  if (!login.payload.isSuccess) throw new Error(`登录失败：${login.payload.errorMsg}`)
  console.log('  ✓ 正确密码可登录')

  // 4. 错误密码
  const bad = await call('/reader3/login', { method: 'POST', body: { username, password: 'wrong-pass' } })
  if (bad.payload.isSuccess !== false) throw new Error('错误密码不应登录成功')
  console.log('  ✓ 错误密码被拒')

  // 5. 带 token 的 getCurrentUser
  const me = await call('/reader3/getUserInfo', { token: login.payload.data.token })
  if (!me.payload.isSuccess || me.payload.data.username !== username) throw new Error('token 身份识别失败')
  console.log(`  ✓ token 识别身份：${me.payload.data.username}`)

  // 6. 无 token 时应要求登录
  const anonymous = await call('/reader3/getUserInfo')
  if (anonymous.payload.isSuccess !== false || anonymous.payload.errorMsg !== 'NEED_LOGIN') {
    throw new Error('开启多用户后匿名请求应被拒绝')
  }
  console.log('  ✓ 匿名请求被要求登录')

  // 7. 登出后 token 失效
  await call('/reader3/logout', { method: 'POST', token: login.payload.data.token })
  const afterLogout = await call('/reader3/getUserInfo', { token: login.payload.data.token })
  if (afterLogout.payload.isSuccess !== false) throw new Error('登出后 token 应失效')
  console.log('  ✓ 登出后 token 失效')

  // 8. 重复用户名
  const dup = await call('/reader3/register', { method: 'POST', body: { username, password: 'secret123' } })
  if (dup.payload.isSuccess !== false) throw new Error('重复用户名应被拒绝')
  console.log('  ✓ 重复用户名被拒')
} else {
  console.log(`  · 注册未执行（${registered.payload.errorMsg}）`)
}

console.log('\n认证 checks passed')
