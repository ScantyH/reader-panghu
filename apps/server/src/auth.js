/**
 * 认证地基。
 *
 * 设计取舍：
 * - 密码用 Node 内置 `scrypt`，不引依赖；
 * - 会话用一个进程内的 token 表（重启失效），cookie 与 `Authorization: Bearer`
 *   都接受，后者给 Legado 这类客户端用；
 * - **未配置任何密码用户时保持"单用户"行为**：所有请求都落到 user 1，
 *   这样既有部署和测试不受影响，打开多用户只是加账号。
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { runWithUser } from './db.js'

export const DEFAULT_USER_ID = 1
const SESSION_COOKIE = 'rp_session'

/** 进程内会话：token → { userId, username, createdAt } */
const sessions = new Map()
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

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
  const tokenOf = (req) =>
    parseCookies(req.headers?.cookie || '')[SESSION_COOKIE] ||
    /^Bearer\s+(.+)$/i.exec(req.headers?.authorization || '')?.[1] ||
    ''

  const resolveUserId = (req) => {
    if (!authEnabled()) return DEFAULT_USER_ID
    const token = tokenOf(req)
    const session = token ? sessions.get(token) : null
    if (!session) return null
    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(token)
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
    '/api/health',
  ])

  app.addHook('onRequest', (req, reply, done) => {
    const userId = resolveUserId(req)
    const required = authEnabled()
    req.userId = userId
    req.authRequired = required

    // 开启多用户后，除公开端点外一律要求已登录
    const path = String(req.raw?.url || '').split('?')[0]
    if (required && !userId && !PUBLIC_PATHS.has(path)) {
      reply.code(401).send({ isSuccess: false, errorMsg: 'NEED_LOGIN', data: null })
      return
    }

    // 让这一请求的全部数据访问自动落到该用户
    runWithUser(userId ?? DEFAULT_USER_ID, done)
  })

  app.get('/reader3/getAuthMode', async () => ok({ enabled: authEnabled(), userCount: userCount() }))

  app.post('/reader3/register', async (req, reply) => {
    const username = String(req.body?.username || '').trim()
    const password = String(req.body?.password || '')
    if (!username || password.length < 6) return fail('用户名必填，密码至少 6 位')
    if (store.findUserByName(username)) return fail('用户名已存在')
    const user = store.createUser(username, hashPassword(password))
    const token = randomBytes(24).toString('hex')
    sessions.set(token, { userId: user.id, username: user.username, createdAt: Date.now() })
    reply.header('set-cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`)
    return ok({ username: user.username, token })
  })

  app.post('/reader3/login', async (req, reply) => {
    const username = String(req.body?.username || '').trim()
    const password = String(req.body?.password || '')
    const user = store.findUserByName(username)
    if (!user || !verifyPassword(password, user.password)) return fail('用户名或密码不正确')
    const token = randomBytes(24).toString('hex')
    sessions.set(token, { userId: user.id, username: user.username, createdAt: Date.now() })
    reply.header('set-cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`)
    return ok({ username: user.username, token })
  })

  app.post('/reader3/logout', async (req, reply) => {
    const token = tokenOf(req)
    if (token) sessions.delete(token)
    reply.header('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`)
    return ok(null)
  })

  app.get('/reader3/getUserInfo', async (req) => {
    if (!authEnabled()) {
      const user = store.getUser()
      return ok({ username: user?.username ?? 'reader', role: user?.role ?? 'admin', secure: false, authEnabled: false })
    }
    if (!req.userId) return fail('NEED_LOGIN')
    const user = store.getUserById(req.userId)
    return ok({ username: user?.username ?? '', role: user?.role ?? 'user', secure: true, authEnabled: true })
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

  app.log.info(`[auth] 多用户 ${authEnabled() ? '已启用' : '未启用（单用户模式）'}`)
}

export const __test__ = { hashPassword, verifyPassword }
