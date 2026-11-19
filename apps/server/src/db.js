/**
 * Persistence layer.
 *
 * Uses the SQLite implementation built into Node (`node:sqlite`), so the image
 * needs no native build step. Books and book sources are stored as JSON
 * documents keyed by (user, url), which mirrors the Legado data model: readers
 * and the UI exchange whole objects, not column sets.
 */

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { DatabaseSync } from 'node:sqlite'

export const DEFAULT_USER_ID = 1

/**
 * 当前请求的用户。由 auth 在 onRequest 钩子里注入，
 * 单用户模式下始终回落到 DEFAULT_USER_ID，行为与改造前一致。
 */
const userContext = new AsyncLocalStorage()

export function runWithUser(userId, fn) {
  return userContext.run({ userId: Number(userId) || DEFAULT_USER_ID }, fn)
}

export function currentUserId() {
  return userContext.getStore()?.userId ?? DEFAULT_USER_ID
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL,
  book_limit INTEGER NOT NULL DEFAULT 0,
  source_limit INTEGER NOT NULL DEFAULT 0,
  allow_webdav INTEGER NOT NULL DEFAULT 1,
  allow_warehouse INTEGER NOT NULL DEFAULT 1,
  allow_edit_sources INTEGER NOT NULL DEFAULT 1,
  allow_edit_rss INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  avatar TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS book_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  book_source_url TEXT NOT NULL,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, book_source_url)
);

CREATE TABLE IF NOT EXISTS source_order (
  user_id INTEGER PRIMARY KEY,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS warehouse_order (
  user_id INTEGER PRIMARY KEY,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  book_url TEXT NOT NULL,
  origin TEXT NOT NULL,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, book_url)
);

CREATE TABLE IF NOT EXISTS chapters (
  book_url TEXT NOT NULL,
  origin TEXT NOT NULL,
  json TEXT NOT NULL,
  cached_at INTEGER NOT NULL,
  PRIMARY KEY (book_url, origin)
);

CREATE TABLE IF NOT EXISTS chapter_text (
  book_url TEXT NOT NULL,
  origin TEXT NOT NULL,
  chapter_url TEXT NOT NULL,
  content TEXT NOT NULL,
  cached_at INTEGER NOT NULL,
  PRIMARY KEY (book_url, chapter_url)
);

CREATE TABLE IF NOT EXISTS rss_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  json TEXT NOT NULL,
  UNIQUE (user_id, source_url)
);

CREATE TABLE IF NOT EXISTS rss_articles (
  source_url TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS book_groups (
  user_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  group_name TEXT NOT NULL,
  order_no INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, group_id)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  book_url TEXT NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS replace_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  json TEXT NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS user_config (
  user_id INTEGER PRIMARY KEY,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_books_user ON books (user_id);
CREATE INDEX IF NOT EXISTS idx_sources_user ON book_sources (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions (created_at);
`

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA)
  // 老库补 role 列（多用户之前建的库没有这一列）
  try {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
  } catch {
    /* 已存在 */
  }
  // 老库补齐子账号配额与权限列；0 表示不限，1 表示允许
  for (const [column, ddl] of [
    ['book_limit', 'INTEGER NOT NULL DEFAULT 0'],
    ['source_limit', 'INTEGER NOT NULL DEFAULT 0'],
    ['allow_webdav', 'INTEGER NOT NULL DEFAULT 1'],
    ['allow_warehouse', 'INTEGER NOT NULL DEFAULT 1'],
    ['allow_edit_sources', 'INTEGER NOT NULL DEFAULT 1'],
    ['allow_edit_rss', 'INTEGER NOT NULL DEFAULT 1'],
    ['note', "TEXT NOT NULL DEFAULT ''"],
    ['sort_order', 'INTEGER NOT NULL DEFAULT 0'],
    ['avatar', "TEXT NOT NULL DEFAULT ''"],
  ]) {
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ${column} ${ddl}`)
    } catch {
      /* 已存在 */
    }
  }
  db.prepare('INSERT OR IGNORE INTO users (id, username, password, created_at) VALUES (?, ?, ?, ?)').run(
    DEFAULT_USER_ID,
    'reader',
    null,
    Date.now(),
  )
  db.prepare('INSERT OR IGNORE INTO book_groups (user_id, group_id, group_name, order_no) VALUES (?, ?, ?, ?)').run(
    DEFAULT_USER_ID,
    0,
    '全部',
    0,
  )
  return new Store(db)
}

class Store {
  constructor(db) {
    this.db = db
  }

  /* ------------------------------------------------------------- book sources */

  listSources(userId = currentUserId()) {
    const rows = this.db
      .prepare('SELECT json FROM book_sources WHERE user_id = ? ORDER BY id')
      .all(userId)
    const sources = rows.map((row) => JSON.parse(row.json))
    const order = this.getSourceOrder(userId)
    const rank = new Map(order.map((url, index) => [url, index]))
    return sources.sort((a, b) => {
      const ai = rank.get(a.bookSourceUrl)
      const bi = rank.get(b.bookSourceUrl)
      // 手动排序优先；没排过的 WebView 书源排前面，再按导入顺序
      if (ai !== undefined || bi !== undefined) return (ai ?? Number.MAX_SAFE_INTEGER) - (bi ?? Number.MAX_SAFE_INTEGER)
      return Number(Boolean(b.html)) - Number(Boolean(a.html))
    })
  }

  getSourceOrder(userId = currentUserId()) {
    const row = this.db.prepare('SELECT json FROM source_order WHERE user_id = ?').get(userId)
    if (!row) return []
    try {
      const value = JSON.parse(row.json)
      return Array.isArray(value) ? value.map((item) => String(item)) : []
    } catch {
      return []
    }
  }

  getWarehouseOrder(userId = currentUserId()) {
    const row = this.db.prepare('SELECT json FROM warehouse_order WHERE user_id = ?').get(userId)
    if (!row) return {}
    try {
      const value = JSON.parse(row.json)
      return value && typeof value === 'object' ? value : {}
    } catch {
      return {}
    }
  }

  saveWarehouseOrder(order, userId = currentUserId()) {
    this.db
      .prepare(
        `INSERT INTO warehouse_order (user_id, json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      )
      .run(userId, JSON.stringify(order || {}), Date.now())
    return order
  }

  saveSourceOrder(urls, userId = currentUserId()) {
    const list = Array.isArray(urls) ? [...new Set(urls.map((url) => String(url)))] : []
    this.db
      .prepare(
        `INSERT INTO source_order (user_id, json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      )
      .run(userId, JSON.stringify(list), Date.now())
    return list
  }

  getSource(bookSourceUrl, userId = currentUserId()) {
    const row = this.db
      .prepare('SELECT json FROM book_sources WHERE user_id = ? AND book_source_url = ?')
      .get(userId, bookSourceUrl)
    return row ? JSON.parse(row.json) : null
  }

  saveSource(source, userId = currentUserId()) {
    const url = String(source.bookSourceUrl || '')
    if (!url) throw new Error('bookSourceUrl is required')
    this.db
      .prepare(
        `INSERT INTO book_sources (user_id, book_source_url, json, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, book_source_url) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      )
      .run(userId, url, JSON.stringify(source), Date.now())
    return source
  }

  saveSources(sources, userId = currentUserId()) {
    for (const source of sources) this.saveSource(source, userId)
    return sources.length
  }

  deleteSource(bookSourceUrl, userId = currentUserId()) {
    const result = this.db
      .prepare('DELETE FROM book_sources WHERE user_id = ? AND book_source_url = ?')
      .run(userId, bookSourceUrl)
    return result.changes > 0
  }

  deleteSources(urls, userId = currentUserId()) {
    let deleted = 0
    for (const url of urls) if (this.deleteSource(url, userId)) deleted += 1
    return deleted
  }

  deleteAllSources(userId = currentUserId()) {
    const result = this.db.prepare('DELETE FROM book_sources WHERE user_id = ?').run(userId)
    return result.changes
  }

  /* -------------------------------------------------------------------- books */

  listBooks(userId = currentUserId()) {
    const rows = this.db
      .prepare(`SELECT json FROM books WHERE user_id = ? ORDER BY json_extract(json, '$.durChapterTime') DESC`)
      .all(userId)
    return rows.map((row) => JSON.parse(row.json))
  }

  getBook(bookUrl, userId = currentUserId()) {
    const row = this.db.prepare('SELECT json FROM books WHERE user_id = ? AND book_url = ?').get(userId, bookUrl)
    return row ? JSON.parse(row.json) : null
  }

  saveBook(book, userId = currentUserId()) {
    const url = String(book.bookUrl || '')
    if (!url) throw new Error('bookUrl is required')
    const origin = String(book.origin || '')
    const existing = this.getBook(url, userId)
    const merged = { ...existing, ...book, bookUrl: url, origin: origin || existing?.origin || '' }
    this.db
      .prepare(
        `INSERT INTO books (user_id, book_url, origin, json, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, book_url) DO UPDATE SET origin = excluded.origin, json = excluded.json, updated_at = excluded.updated_at`,
      )
      .run(userId, url, merged.origin, JSON.stringify(merged), Date.now())
    return merged
  }

  saveBooks(books, userId = currentUserId()) {
    return books.map((book) => this.saveBook(book, userId))
  }

  /**
   * Progress is the multi-device sync primitive, and the server is authoritative:
   * a write that carries a clientUpdatedAt older than what we already stored is
   * rejected so a stale web/APP client cannot roll back newer progress. The
   * returned book always holds the value the client should adopt.
   */
  saveProgress({ bookUrl, index, position, clientUpdatedAt, chapterTitle }, userId = currentUserId()) {
    const book = this.getBook(bookUrl, userId)
    if (!book) return null
    const storedAt = Number(book.durChapterTime || 0)
    if (clientUpdatedAt !== undefined && Number(clientUpdatedAt) <= storedAt) {
      return { ...book, progressAccepted: false }
    }
    const updated = {
      ...book,
      durChapterIndex: Number(index) || 0,
      durChapterPos: Number(position) || 0,
      durChapterTime: Date.now(),
      durChapterTitle: String(chapterTitle || '').trim() || book.durChapterTitle || '',
    }
    this.saveBook(updated, userId)
    return { ...updated, progressAccepted: true }
  }

  deleteBook(bookUrl, userId = currentUserId()) {
    const result = this.db.prepare('DELETE FROM books WHERE user_id = ? AND book_url = ?').run(userId, bookUrl)
    this.db.prepare('DELETE FROM chapters WHERE book_url = ?').run(bookUrl)
    return result.changes > 0
  }

  deleteBooks(urls, userId = currentUserId()) {
    let deleted = 0
    for (const url of urls) if (this.deleteBook(url, userId)) deleted += 1
    return deleted
  }

  /* ----------------------------------------------------------------- chapters */

  getChapters(bookUrl, origin) {
    const row = this.db.prepare('SELECT json FROM chapters WHERE book_url = ? AND origin = ?').get(bookUrl, origin)
    return row ? JSON.parse(row.json) : null
  }

  saveChapters(bookUrl, origin, chapters) {
    this.db
      .prepare(
        `INSERT INTO chapters (book_url, origin, json, cached_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (book_url, origin) DO UPDATE SET json = excluded.json, cached_at = excluded.cached_at`,
      )
      .run(bookUrl, origin, JSON.stringify(chapters), Date.now())
    return chapters
  }

  deleteChapters(bookUrl) {
    return this.db.prepare('DELETE FROM chapters WHERE book_url = ?').run(bookUrl).changes
  }

  countChapters(bookUrl, origin) {
    const chapters = this.getChapters(bookUrl, origin)
    return Array.isArray(chapters) ? chapters.length : 0
  }

  /* -------------------------------------------------------------- rss sources */

  listRssSources(userId = currentUserId()) {
    return this.db.prepare('SELECT json FROM rss_sources WHERE user_id = ? ORDER BY id').all(userId).map((row) => JSON.parse(row.json))
  }

  saveRssSource(source, userId = currentUserId()) {
    const url = String(source?.sourceUrl || '')
    if (!url) throw new Error('sourceUrl is required')
    this.db
      .prepare(
        `INSERT INTO rss_sources (user_id, source_url, json) VALUES (?, ?, ?)
         ON CONFLICT (user_id, source_url) DO UPDATE SET json = excluded.json`,
      )
      .run(userId, url, JSON.stringify({ ...source, sourceUrl: url }))
    return source
  }

  deleteRssSources(urls, userId = currentUserId()) {
    let deleted = 0
    for (const url of urls) {
      deleted += this.db.prepare('DELETE FROM rss_sources WHERE user_id = ? AND source_url = ?').run(userId, String(url)).changes
    }
    return deleted
  }

  getCachedRss(sourceUrl) {
    const row = this.db.prepare('SELECT json, fetched_at FROM rss_articles WHERE source_url = ?').get(String(sourceUrl))
    return row ? { articles: JSON.parse(row.json), fetchedAt: row.fetched_at } : null
  }

  saveCachedRss(sourceUrl, articles) {
    this.db
      .prepare(
        `INSERT INTO rss_articles (source_url, json, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT (source_url) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at`,
      )
      .run(String(sourceUrl), JSON.stringify(articles), Date.now())
    return articles
  }

  /* -------------------------------------------------------- chapter caching */

  getChapterText(bookUrl, chapterUrl) {
    const row = this.db
      .prepare('SELECT content FROM chapter_text WHERE book_url = ? AND chapter_url = ?')
      .get(bookUrl, chapterUrl)
    return row ? row.content : null
  }

  saveChapterText(bookUrl, origin, chapterUrl, content) {
    this.db
      .prepare(
        `INSERT INTO chapter_text (book_url, origin, chapter_url, content, cached_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (book_url, chapter_url) DO UPDATE SET content = excluded.content, cached_at = excluded.cached_at`,
      )
      .run(bookUrl, origin, chapterUrl, content, Date.now())
    return content
  }

  countChapterTexts(bookUrl) {
    return this.db.prepare('SELECT COUNT(*) AS n FROM chapter_text WHERE book_url = ?').get(bookUrl).n
  }

  clearChapterTexts(bookUrl) {
    return this.db.prepare('DELETE FROM chapter_text WHERE book_url = ?').run(bookUrl).changes
  }

  /* ------------------------------------------------------------------- groups */

  listGroups(userId = currentUserId()) {
    return this.db
      .prepare('SELECT group_id AS groupId, group_name AS groupName, order_no AS orderNo FROM book_groups WHERE user_id = ? ORDER BY order_no, group_id')
      .all(userId)
  }

  saveGroup({ groupId, groupName, orderNo }, userId = currentUserId()) {
    const nextOrder =
      orderNo === undefined || orderNo === null
        ? this.db.prepare('SELECT COALESCE(MAX(order_no), 0) + 1 AS n FROM book_groups WHERE user_id = ?').get(userId).n
        : Number(orderNo) || 0
    this.db
      .prepare(
        `INSERT INTO book_groups (user_id, group_id, group_name, order_no) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, group_id) DO UPDATE SET group_name = excluded.group_name, order_no = excluded.order_no`,
      )
      .run(userId, Number(groupId) || 0, String(groupName || '未命名'), nextOrder)
    return { groupId: Number(groupId) || 0, groupName: String(groupName || '未命名'), orderNo: nextOrder }
  }

  deleteGroup(groupId, userId = currentUserId()) {
    return this.db.prepare('DELETE FROM book_groups WHERE user_id = ? AND group_id = ?').run(userId, Number(groupId)).changes > 0
  }

  /** 书架分组手动排序：按给定 groupId 顺序写 order_no。 */
  reorderGroups(groupIds = [], userId = currentUserId()) {
    let order = 1
    for (const groupId of groupIds) {
      const id = Number(groupId)
      if (!id) continue
      this.db.prepare('UPDATE book_groups SET order_no = ? WHERE user_id = ? AND group_id = ?').run(order, userId, id)
      order += 1
    }
    return order - 1
  }

  /* --------------------------------------------------------------- bookmarks */

  listBookmarks(bookUrl, userId = currentUserId()) {
    const rows = bookUrl
      ? this.db.prepare('SELECT id, json FROM bookmarks WHERE user_id = ? AND book_url = ? ORDER BY id').all(userId, bookUrl)
      : this.db.prepare('SELECT id, json FROM bookmarks WHERE user_id = ? ORDER BY id').all(userId)
    return rows.map((row) => ({ ...JSON.parse(row.json), id: row.id }))
  }

  saveBookmark(bookmark, userId = currentUserId()) {
    const result = this.db
      .prepare('INSERT INTO bookmarks (user_id, book_url, json) VALUES (?, ?, ?)')
      .run(userId, String(bookmark?.bookUrl ?? ''), JSON.stringify(bookmark || {}))
    return Number(result.lastInsertRowid)
  }

  deleteBookmark(bookmark, userId = currentUserId()) {
    if (bookmark?.id) {
      return this.db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND id = ?').run(userId, Number(bookmark.id)).changes > 0
    }
    return (
      this.db
        .prepare(`DELETE FROM bookmarks WHERE user_id = ? AND book_url = ? AND json_extract(json, '$.chapterIndex') = ?`)
        .run(userId, String(bookmark?.bookUrl ?? ''), Number(bookmark?.chapterIndex ?? -1)).changes > 0
    )
  }

  /* ---------------------------------------------------------- replace rules */

  listReplaceRules(userId = currentUserId()) {
    return this.db.prepare('SELECT json FROM replace_rules WHERE user_id = ? ORDER BY id').all(userId).map((row) => JSON.parse(row.json))
  }

  saveReplaceRule(rule, userId = currentUserId()) {
    const name = String(rule?.name ?? '')
    if (!name) throw new Error('name is required')
    this.db
      .prepare(
        `INSERT INTO replace_rules (user_id, name, json) VALUES (?, ?, ?)
         ON CONFLICT (user_id, name) DO UPDATE SET json = excluded.json`,
      )
      .run(userId, name, JSON.stringify(rule))
    return rule
  }

  deleteReplaceRules(names, userId = currentUserId()) {
    let deleted = 0
    for (const name of names) {
      deleted += this.db.prepare('DELETE FROM replace_rules WHERE user_id = ? AND name = ?').run(userId, String(name)).changes
    }
    return deleted
  }

  /* -------------------------------------------------------------- user config */

  getUserConfig(userId = currentUserId()) {
    const row = this.db.prepare('SELECT json FROM user_config WHERE user_id = ?').get(userId)
    return row ? JSON.parse(row.json) : {}
  }

  saveUserConfig(config, userId = currentUserId()) {
    this.db
      .prepare(
        `INSERT INTO user_config (user_id, json) VALUES (?, ?)
         ON CONFLICT (user_id) DO UPDATE SET json = excluded.json`,
      )
      .run(userId, JSON.stringify(config || {}))
    return config
  }

  listUsers() {
    return this.db
      .prepare(
        `SELECT id, username, password, role, created_at, note, sort_order, avatar,
                book_limit AS bookLimit, source_limit AS sourceLimit,
                allow_webdav AS allowWebdav, allow_warehouse AS allowWarehouse,
                allow_edit_sources AS allowEditSources, allow_edit_rss AS allowEditRss
           FROM users
          ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, sort_order, id`,
      )
      .all()
  }

  findUserByName(username) {
    return this.db.prepare('SELECT id, username, password FROM users WHERE username = ?').get(String(username))
  }

  getUserById(userId) {
    return this.db
      .prepare(
        `SELECT id, username, role, created_at, note, sort_order, avatar,
                book_limit AS bookLimit, source_limit AS sourceLimit,
                allow_webdav AS allowWebdav, allow_warehouse AS allowWarehouse,
                allow_edit_sources AS allowEditSources, allow_edit_rss AS allowEditRss
           FROM users WHERE id = ?`,
      )
      .get(Number(userId))
  }

  createUser(username, password, role = 'user') {
    const nextOrder = this.db
      .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM users WHERE role != 'admin'")
      .get().n
    const result = this.db
      .prepare('INSERT INTO users (username, password, role, created_at, sort_order) VALUES (?, ?, ?, ?, ?)')
      .run(String(username), password, String(role), Date.now(), Number(nextOrder) || 0)
    return { id: Number(result.lastInsertRowid), username, role }
  }

  setUserRole(userId, role) {
    return this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(String(role), Number(userId)).changes > 0
  }

  setUserAvatar(userId, avatar) {
    return this.db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(String(avatar || ''), Number(userId)).changes > 0
  }

  /** 管理员给子账号分配配额与功能开关；0 表示不限，布尔转 0/1。 */
  updateUserSettings(userId, settings = {}) {
    const count = (value) => Math.max(0, Math.floor(Number(value) || 0))
    const flag = (value) => (value ? 1 : 0)
    const note = String(settings.note ?? this.getUserById(userId)?.note ?? '').slice(0, 60)
    this.db
      .prepare(
        `UPDATE users
            SET book_limit = ?, source_limit = ?,
                allow_webdav = ?, allow_warehouse = ?,
                allow_edit_sources = ?, allow_edit_rss = ?,
                note = ?
          WHERE id = ?`,
      )
      .run(
        count(settings.bookLimit),
        count(settings.sourceLimit),
        flag(settings.allowWebdav),
        flag(settings.allowWarehouse),
        flag(settings.allowEditSources),
        flag(settings.allowEditRss),
        note,
        Number(userId),
      )
    return this.getUserById(userId)
  }

  /** 子账号手动排序：按给定顺序写入 sort_order（管理员不参与）。 */
  reorderUsers(usernames = []) {
    let order = 0
    for (const username of usernames) {
      const user = this.findUserByName(String(username))
      if (!user) continue
      const current = this.getUserById(user.id)
      if (current?.role === 'admin') continue
      this.db.prepare('UPDATE users SET sort_order = ? WHERE id = ?').run(order, user.id)
      order += 1
    }
    return order
  }

  /**
   * 删除子账号及其全部数据（书、书源、RSS、分组、书签、替换规则、配置、会话）。
   * 默认账号永远保留；返回是否真的删掉了。
   */
  deleteUser(userId) {
    const id = Number(userId)
    if (!id || id === DEFAULT_USER_ID) return false
    if (!this.getUserById(id)) return false
    const books = this.db.prepare('SELECT book_url FROM books WHERE user_id = ?').all(id)
    this.db.exec('BEGIN')
    try {
      for (const row of books) {
        this.db.prepare('DELETE FROM chapters WHERE book_url = ?').run(row.book_url)
        this.db.prepare('DELETE FROM chapter_text WHERE book_url = ?').run(row.book_url)
      }
      for (const table of [
        'books',
        'book_sources',
        'rss_sources',
        'book_groups',
        'bookmarks',
        'replace_rules',
        'user_config',
        'sessions',
      ]) {
        this.db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(id)
      }
      const result = this.db.prepare('DELETE FROM users WHERE id = ?').run(id)
      this.db.exec('COMMIT')
      return result.changes > 0
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getUser(userId = currentUserId()) {
    return this.db
      .prepare(
        `SELECT id, username, role, created_at, avatar,
                book_limit AS bookLimit, source_limit AS sourceLimit,
                allow_webdav AS allowWebdav, allow_warehouse AS allowWarehouse,
                allow_edit_sources AS allowEditSources, allow_edit_rss AS allowEditRss
           FROM users WHERE id = ?`,
      )
      .get(userId)
  }

  countBooks(userId = currentUserId()) {
    return this.db.prepare('SELECT COUNT(*) AS n FROM books WHERE user_id = ?').get(userId).n
  }

  countSources(userId = currentUserId()) {
    return this.db.prepare('SELECT COUNT(*) AS n FROM book_sources WHERE user_id = ?').get(userId).n
  }

  /* ---------------------------------------------------------------- sessions */

  /** 会话是全局的（token 唯一），不按用户隔离；放在库里才能在重启后继续有效。 */
  createSession(token, { userId, username, createdAt }) {
    const value = String(token || '')
    if (!value) throw new Error('token is required')
    const owner = Number(userId) || DEFAULT_USER_ID
    const at = createdAt === undefined ? Date.now() : Number(createdAt)
    this.db
      .prepare('INSERT INTO sessions (token, user_id, username, created_at) VALUES (?, ?, ?, ?)')
      .run(value, owner, String(username || ''), at)
  }

  getSession(token) {
    const row = this.db
      .prepare('SELECT token, user_id, username, created_at FROM sessions WHERE token = ?')
      .get(String(token || ''))
    if (!row) return null
    return { token: row.token, userId: row.user_id, username: row.username, createdAt: row.created_at }
  }

  deleteSession(token) {
    return this.db.prepare('DELETE FROM sessions WHERE token = ?').run(String(token || '')).changes > 0
  }

  deleteExpiredSessions(beforeTs) {
    return this.db.prepare('DELETE FROM sessions WHERE created_at < ?').run(Number(beforeTs)).changes
  }

  countSessions() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n
  }
}

export const defaultDatabaseFile = (dataDir) => join(dataDir, 'reader.db')
