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

  app.get('/reader3/getUserList', async () => {
    const users = store.listUsers().map((user) => ({
      username: user.username,
      hasPassword: Boolean(user.password),
      createdAt: user.created_at,
      current: false,
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
}
