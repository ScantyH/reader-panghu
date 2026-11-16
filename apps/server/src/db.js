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
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS book_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  book_source_url TEXT NOT NULL,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, book_source_url)
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

CREATE INDEX IF NOT EXISTS idx_books_user ON books (user_id);
CREATE INDEX IF NOT EXISTS idx_sources_user ON book_sources (user_id);
`

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA)
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
    return rows.map((row) => JSON.parse(row.json))
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
  saveProgress({ bookUrl, index, position, clientUpdatedAt }, userId = currentUserId()) {
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
    this.db
      .prepare(
        `INSERT INTO book_groups (user_id, group_id, group_name, order_no) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, group_id) DO UPDATE SET group_name = excluded.group_name, order_no = excluded.order_no`,
      )
      .run(userId, Number(groupId) || 0, String(groupName || '未命名'), Number(orderNo) || 0)
    return { groupId: Number(groupId) || 0, groupName: String(groupName || '未命名'), orderNo: Number(orderNo) || 0 }
  }

  deleteGroup(groupId, userId = currentUserId()) {
    return this.db.prepare('DELETE FROM book_groups WHERE user_id = ? AND group_id = ?').run(userId, Number(groupId)).changes > 0
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
    return this.db.prepare('SELECT id, username, password, created_at FROM users ORDER BY id').all()
  }

  findUserByName(username) {
    return this.db.prepare('SELECT id, username, password FROM users WHERE username = ?').get(String(username))
  }

  getUserById(userId) {
    return this.db.prepare('SELECT id, username FROM users WHERE id = ?').get(Number(userId))
  }

  createUser(username, password) {
    const result = this.db
      .prepare('INSERT INTO users (username, password, created_at) VALUES (?, ?, ?)')
      .run(String(username), password, Date.now())
    return { id: Number(result.lastInsertRowid), username }
  }

  getUser(userId = currentUserId()) {
    return this.db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId)
  }
}

export const defaultDatabaseFile = (dataDir) => join(dataDir, 'reader.db')
