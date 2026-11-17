/**
 * 子账号配额与权限。
 *
 * 管理员账号永远不受限制；普通账号受 `book_limit` / `source_limit`
 * 与四个功能开关约束（0/1 存库，这里统一转布尔和整数名额）。
 */

export const permissionOf = (user) => {
  const admin = user?.role === 'admin'
  const allow = (value) => admin || Number(value) !== 0
  return {
    admin,
    bookLimit: admin ? 0 : Math.max(0, Number(user?.bookLimit) || 0),
    sourceLimit: admin ? 0 : Math.max(0, Number(user?.sourceLimit) || 0),
    allowWebdav: allow(user?.allowWebdav),
    allowWarehouse: allow(user?.allowWarehouse),
    allowEditSources: allow(user?.allowEditSources),
    allowEditRss: allow(user?.allowEditRss),
  }
}

export const permissionsFor = (store, req) =>
  permissionOf(store.getUserById(Number(req?.userId) || 1) || {})

/** 返回空字符串表示还能加；否则是可直接给前端的错误文案。 */
export const bookQuotaError = (store, req, extra = 1) => {
  const perms = permissionsFor(store, req)
  if (!perms.bookLimit) return ''
  const current = store.countBooks()
  return current + extra > perms.bookLimit
    ? `书架最多 ${perms.bookLimit} 本，当前 ${current} 本，无法再加入 ${extra} 本`
    : ''
}

export const sourceQuotaError = (store, req, extra = 1) => {
  const perms = permissionsFor(store, req)
  if (!perms.sourceLimit) return ''
  const current = store.countSources()
  return current + extra > perms.sourceLimit
    ? `书源最多 ${perms.sourceLimit} 个，当前 ${current} 个，无法再加入 ${extra} 个`
    : ''
}
