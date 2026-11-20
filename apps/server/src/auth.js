/**
 * 认证地基。
 *
 * 设计取舍：
 * - 密码用 Node 内置 `scrypt`，不引依赖；
 * - 会话落在 SQLite 的 sessions 表（重启后仍有效），cookie 与 `Authorization: Bearer`
 *   都接受，后者给 Legado 这类客户端用；
 * - **未配置任何密码用户时保持"单用户"行为**：所有请求都落到 user 1，
 *   这样既有部署和测试不受影响，打开多用户只是加账号。
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { runWithUser } from './db.js'
import { permissionOf } from './user-perms.js'

export const DEFAULT_USER_ID = 1
const SESSION_COOKIE = 'rp_session'

/** 会话 token 存在 SQLite 里，进程重启后仍然有效；TTL 仍是 30 天。 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const isSessionExpired = (session, now = Date.now()) => !session || now - Number(session.createdAt) > SESSION_TTL_MS

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(String(password), salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':')
  if (!salt || !hash) return false
  try {
    const candidate = scryptSync(String(password), salt, 64)
    const expected = Buffer.from(hash, 'hex')
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  } catch {
    return false
  }
}

const parseCookies = (header = '') => {
  const out = {}
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=')
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return out
}

export function registerAuth(app, { store }) {
  const ok = (data) => ({ isSuccess: true, errorMsg: '', data })
  const fail = (errorMsg) => ({ isSuccess: false, errorMsg, data: null })

  const userCount = () => {
    try {
      return store.listUsers().length
    } catch {
      return 1
    }
  }

  /** 是否开启了多用户（存在带密码的账号） */
  const authEnabled = () => store.listUsers().some((user) => Boolean(user.password))

  /** 从 cookie / Bearer 解析当前用户；未开启多用户时返回默认用户 */
  const tokenOf = (req) => {
    const fromCookie = parseCookies(req.headers?.cookie || '')[SESSION_COOKIE]
    if (fromCookie) return fromCookie
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers?.authorization || '')?.[1]
    if (bearer) return bearer
    const fromHeader = String(req.headers?.['x-auth-token'] || '').trim()
    if (fromHeader) return fromHeader
    // 反向代理可能剥掉所有自定义头，最后兜底读查询参数
    try {
      return new URL(String(req.raw?.url || ''), 'http://local').searchParams.get('token') || ''
    } catch {
      return ''
    }
  }

  const resolveUserId = (req) => {
    if (!authEnabled()) return DEFAULT_USER_ID
    const token = tokenOf(req)
    const session = token ? store.getSession(token) : null
    if (!session) return null
    if (isSessionExpired(session)) {
      store.deleteSession(token)
      return null
    }
    return session.userId
  }

  // 把当前用户挂到请求上，供后续路由读取
  app.decorateRequest('userId', DEFAULT_USER_ID)
  const PUBLIC_PATHS = new Set([
    '/reader3/login',
    '/reader3/register',
    '/reader3/logout',
    '/reader3/getAuthMode',
    '/reader3/getUserInfo',
    '/reader3/debugAuth',
    '/reader3/dpPage',
    '/api/health',
  ])

  app.addHook('onRequest', (req, reply, done) => {
    const userId = resolveUserId(req)
    const required = authEnabled()
    req.userId = userId
    req.authRequired = required

    // 只有接口需要登录；静态资源与 SPA 外壳必须放行，否则连登录页都打不开
    const path = String(req.raw?.url || '').split('?')[0]
    const isApi = path.startsWith('/reader3/') || path.startsWith('/api/')
    if (required && !userId && isApi && !PUBLIC_PATHS.has(path) && !path.startsWith('/reader3/dp/')) {
      reply.code(401).send({ isSuccess: false, errorMsg: 'NEED_LOGIN', data: null })
      return
    }

    // 让这一请求的全部数据访问自动落到该用户
    runWithUser(userId ?? DEFAULT_USER_ID, done)
  })

  app.get('/reader3/getAuthMode', async () => ok({ enabled: authEnabled(), userCount: userCount() }))

  /** 诊断用：确认会话是否真的写进数据库 */
  app.get('/reader3/debugAuth', async (req) =>
    ok({
      enabled: authEnabled(),
      sessions: store.countSessions(),
      hasCookie: Boolean(req.headers?.cookie),
      hasBearer: Boolean(req.headers?.authorization),
      resolvedUserId: req.userId ?? null,
      pid: process.pid,
    }),
  )

  app.post('/reader3/register', async (req, reply) => {
    const username = String(req.body?.username || '').trim()
    const password = String(req.body?.password || '')
    if (!username || password.length < 6) return fail('用户名必填，密码至少 6 位')
    if (store.findUserByName(username)) return fail('用户名已存在')
    const user = store.createUser(username, hashPassword(password))
    const token = randomBytes(24).toString('hex')
    store.createSession(token, { userId: user.id, username: user.username })
    reply.header('set-cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`)
    return ok({ username: user.username, token })
  })

  app.post('/reader3/login', async (req, reply) => {
    const username = String(req.body?.username || '').trim()
    const password = String(req.body?.password || '')
    const user = store.findUserByName(username)
    if (!user || !verifyPassword(password, user.password)) return fail('用户名或密码不正确')
    const token = randomBytes(24).toString('hex')
    store.createSession(token, { userId: user.id, username: user.username })
    app.log.info(`[auth] login pid=${process.pid} sessions=${store.countSessions()}`)
    reply.header('set-cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`)
    return ok({ username: user.username, token })
  })

  app.post('/reader3/logout', async (req, reply) => {
    const token = tokenOf(req)
    if (token) store.deleteSession(token)
    reply.header('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`)
    return ok(null)
  })

  app.get('/reader3/getUserInfo', async (req) => {
    if (!authEnabled()) {
      const user = store.getUser()
      const perms = permissionOf(user)
      return ok({
        username: user?.username ?? 'reader',
        role: user?.role ?? 'admin',
        avatar: user?.avatar ?? '',
        secure: false,
        authEnabled: false,
        ...perms,
      })
    }
    if (!req.userId) return fail('NEED_LOGIN')
    const user = store.getUserById(req.userId)
    const perms = permissionOf(user)
    return ok({
      username: user?.username ?? '',
      role: user?.role ?? 'user',
      avatar: user?.avatar ?? '',
      secure: true,
      authEnabled: true,
      ...perms,
    })
  })

  // 用环境变量种一个管理员账号（已存在则只补角色）
  const seedAdmin = process.env.ADMIN_USERNAME
  const seedPassword = process.env.ADMIN_PASSWORD
  if (seedAdmin && seedPassword) {
    const existing = store.findUserByName(seedAdmin)
    if (!existing) {
      store.createUser(seedAdmin, hashPassword(seedPassword), 'admin')
      app.log.info(`[auth] 已创建管理员 ${seedAdmin}`)
    } else {
      const current = store.getUserById(existing.id)
      if (current?.role !== 'admin') {
        store.setUserRole(existing.id, 'admin')
        app.log.info(`[auth] 已把 ${seedAdmin} 提升为管理员`)
      }
    }
  }

  const pruned = store.deleteExpiredSessions(Date.now() - SESSION_TTL_MS)
  if (pruned > 0) app.log.info(`[auth] 清理过期会话 ${pruned} 个`)
  app.log.info(`[auth] 多用户 ${authEnabled() ? '已启用' : '未启用（单用户模式）'}`)
}

export const __test__ = { hashPassword, verifyPassword, isSessionExpired }
