/**
 * 导出、用户管理：补齐 hectorqin/reader-next 里"能导出、能管账号"的能力。
 */

const ok = (data) => ({ isSuccess: true, errorMsg: '', data })
const fail = (errorMsg) => ({ isSuccess: false, errorMsg, data: null })

export function registerPortability(app, { store }) {
  /* ------------------------------------------------------------ 书源导出 */

  /** 导出全部（或指定）书源为可直接再导入的 JSON。 */
  app.get('/reader3/exportBookSources', async (req, reply) => {
    const urls = String(req.query?.urls || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const all = store.listSources()
    const selected = urls.length ? all.filter((source) => urls.includes(source.bookSourceUrl)) : all
    // 去掉内部字段，导出的文件要能被原样导入
    const cleaned = selected.map(({ invalid, _runtime, ...rest }) => rest)
    reply.header('content-type', 'application/json; charset=utf-8')
    reply.header('content-disposition', `attachment; filename="book-sources-${Date.now()}.json"`)
    return cleaned
  })

  /* ---------------------------------------------------------- 整包备份下载 */

  /** 导出书架相关数据为一个 JSON 文件（与 WebDAV 备份同构）。 */
  app.get('/reader3/exportBackup', async (req, reply) => {
    const books = store.listBooks()
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      sources: store.listSources().map(({ invalid, _runtime, ...rest }) => rest),
      books: books.map((book) => ({
        name: book.name,
        author: book.author,
        bookUrl: book.bookUrl,
        origin: book.origin,
        originName: book.originName,
        coverUrl: book.coverUrl,
        intro: book.intro,
        kind: book.kind,
        group: book.group,
        durChapterIndex: book.durChapterIndex,
        durChapterPos: book.durChapterPos,
        durChapterTitle: book.durChapterTitle,
        totalChapterNum: book.totalChapterNum,
        canUpdate: book.canUpdate,
      })),
      groups: store.listGroups(),
      bookmarks: store.listBookmarks(),
      replaceRules: store.listReplaceRules(),
      config: store.getUserConfig(),
    }
    reply.header('content-type', 'application/json; charset=utf-8')
    reply.header('content-disposition', `attachment; filename="reader-panghu-backup-${Date.now()}.json"`)
    return payload
  })

  /* ------------------------------------------------------------ 用户管理 */

  app.get('/reader3/getUserList', async (req) => {
    // 单用户模式（没有任何密码账号）允许看列表；多用户下只有管理员能看
    const loginEnabled = store.listUsers().some((user) => Boolean(user.password))
    if (loginEnabled && !requireAdmin(req)) return fail('需要管理员权限')
    const users = store.listUsers().map((user) => ({
      username: user.username,
      hasPassword: Boolean(user.password),
      role: user.role || 'user',
      createdAt: user.created_at,
      current: user.id === req.userId,
      note: user.note || '',
      bookLimit: Number(user.bookLimit) || 0,
      sourceLimit: Number(user.sourceLimit) || 0,
      allowWebdav: Boolean(user.allowWebdav),
      allowWarehouse: Boolean(user.allowWarehouse),
      allowEditSources: Boolean(user.allowEditSources),
      allowEditRss: Boolean(user.allowEditRss),
    }))
    return ok(users)
  })

  app.post('/reader3/changePassword', async (req) => {
    const userId = req.userId
    const user = userId ? store.getUserById(userId) : store.getUser()
    if (!user) return fail('用户不存在')
    const next = String(req.body?.newPassword || '')
    if (next.length < 6) return fail('新密码至少 6 位')
    // 已有密码时必须验证旧密码
    const current = store.findUserByName(user.username)
    if (current?.password) {
      const { verifyPassword, hashPassword } = await import('./auth.js')
      if (!verifyPassword(String(req.body?.oldPassword || ''), current.password)) return fail('原密码不正确')
      store.updateUserPassword(current.id, hashPassword(next))
    } else {
      const { hashPassword } = await import('./auth.js')
      store.updateUserPassword(current?.id ?? userId ?? 1, hashPassword(next))
    }
    return ok({ changed: true })
  })

  app.post('/reader3/renameUser', async (req) => {
    const userId = req.userId
    const name = String(req.body?.username || '').trim()
    if (!name) return fail('用户名不能为空')
    if (store.findUserByName(name)) return fail('用户名已存在')
    store.updateUsername(userId, name)
    return ok({ username: name })
  })

  /* -------------------------------------------------------- 管理员操作 */

  const requireAdmin = (req) => {
    const current = req.userId ? store.getUserById(req.userId) : null
    return current?.role === 'admin'
  }

  /** 调整某个账号的角色（admin / user） */
  app.post('/reader3/setUserRole', async (req) => {
    if (!requireAdmin(req)) return fail('需要管理员权限')
    const username = String(req.body?.username || '').trim()
    const role = req.body?.role === 'admin' ? 'admin' : 'user'
    const user = store.findUserByName(username)
    if (!user) return fail('用户不存在')
    if (user.id === 1) return fail('默认账号不可改角色')
    store.setUserRole(user.id, role)
    return ok({ username, role })
  })

  /** 给子账号分配书籍/书源上限与功能开关（管理员专用） */
  app.post('/reader3/setUserSettings', async (req) => {
    if (!requireAdmin(req)) return fail('需要管理员权限')
    const username = String(req.body?.username || '').trim()
    const user = store.findUserByName(username)
    if (!user) return fail('用户不存在')
    if (user.id === (req.userId ?? 0)) return fail('不能给自己的账号设限')
    if (user.role === 'admin') return fail('管理员账号不受限制，无需分配')
    const updated = store.updateUserSettings(user.id, req.body || {})
    return ok({
      username,
      note: updated.note || '',
      bookLimit: Number(updated.bookLimit) || 0,
      sourceLimit: Number(updated.sourceLimit) || 0,
      allowWebdav: Boolean(updated.allowWebdav),
      allowWarehouse: Boolean(updated.allowWarehouse),
      allowEditSources: Boolean(updated.allowEditSources),
      allowEditRss: Boolean(updated.allowEditRss),
    })
  })

  /** 子账号手动排序（管理员专用，按前端拖拽后的顺序） */
  app.post('/reader3/reorderUsers', async (req) => {
    if (!requireAdmin(req)) return fail('需要管理员权限')
    const usernames = Array.isArray(req.body?.usernames) ? req.body.usernames.map((name) => String(name)) : []
    return ok({ reordered: store.reorderUsers(usernames) })
  })

  /**
   * 把当前管理员的书源与 RSS 订阅复制到某个子账号。
   * 配合「编辑书源 / 编辑RSS源」关闭使用：子账号只能只读使用管理员分配好的内容。
   */
  app.post('/reader3/copyUserLibrary', async (req) => {
    if (!requireAdmin(req)) return fail('需要管理员权限')
    const username = String(req.body?.username || '').trim()
    const target = store.findUserByName(username)
    if (!target) return fail('用户不存在')
    if (target.id === (req.userId ?? 0)) return fail('不需要给自己分配')
    const from = req.userId ?? 1
    let sources = 0
    let rss = 0
    for (const source of store.listSources(from)) {
      store.saveSource(source, target.id)
      sources += 1
    }
    for (const item of store.listRssSources(from)) {
      store.saveRssSource(item, target.id)
      rss += 1
    }
    return ok({ username, sources, rss })
  })

  /** 删除账号（连带清掉它的会话） */
  app.post('/reader3/deleteUser', async (req) => {
    if (!requireAdmin(req)) return fail('需要管理员权限')
    const username = String(req.body?.username || '').trim()
    const user = store.findUserByName(username)
    if (!user) return fail('用户不存在')
    if (user.id === (req.userId ?? 0)) return fail('不能删除自己')
    if (user.id === 1) return fail('默认账号不可删除')
    store.deleteUser(user.id)
    return ok({ deleted: username })
  })
}
