/**
 * sessions 表与 Store 会话方法：持久化、老库补表、删除与过期清理。
 *
 *   node --test apps/server/test/sessions.test.js
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { openDatabase } from '../src/db.js'

const dirs = []
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'reader-panghu-db-'))
  dirs.push(dir)
  return join(dir, 'reader.db')
}

process.on('exit', () => {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* Windows 上 WAL 句柄可能短暂占用，忽略 */
    }
  }
})

test('createSession + getSession 往返', () => {
  const store = openDatabase(tempFile())
  store.createSession('tok-1', { userId: 7, username: 'alice' })
  const session = store.getSession('tok-1')
  assert.equal(session.token, 'tok-1')
  assert.equal(session.userId, 7)
  assert.equal(session.username, 'alice')
  assert.equal(typeof session.createdAt, 'number')
  store.db.close()
})

test('关库再开后会话仍在（重启持久化）', () => {
  const file = tempFile()
  const first = openDatabase(file)
  first.createSession('tok-restart', { userId: 1, username: 'reader' })
  first.db.close()

  const second = openDatabase(file)
  assert.equal(second.getSession('tok-restart')?.username, 'reader')
  second.db.close()
})

test('老库没有 sessions 表时自动补表', () => {
  const file = tempFile()
  const raw = new DatabaseSync(file)
  raw.exec(
    'CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT, created_at INTEGER NOT NULL)',
  )
  raw.close()

  const store = openDatabase(file)
  store.createSession('tok-old', { userId: 1, username: 'reader' })
  assert.equal(store.getSession('tok-old')?.username, 'reader')
  store.db.close()
})

test('deleteSession 与 countSessions', () => {
  const store = openDatabase(tempFile())
  store.createSession('a', { userId: 1, username: 'reader' })
  store.createSession('b', { userId: 1, username: 'reader' })
  assert.equal(store.countSessions(), 2)
  assert.equal(store.deleteSession('a'), true)
  assert.equal(store.deleteSession('a'), false)
  assert.equal(store.countSessions(), 1)
  store.db.close()
})

test('deleteExpiredSessions 只删更早的行', () => {
  const store = openDatabase(tempFile())
  store.createSession('old', { userId: 1, username: 'reader', createdAt: 1000 })
  store.createSession('new', { userId: 1, username: 'reader', createdAt: 2000 })
  assert.equal(store.deleteExpiredSessions(1500), 1)
  assert.equal(store.getSession('old'), null)
  assert.equal(store.getSession('new')?.createdAt, 2000)
  store.db.close()
})
