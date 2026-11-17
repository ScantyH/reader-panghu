/**
 * users 表的配额/权限字段与管理员排序。
 *
 *   node --test apps/server/test/users.test.js
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
  const dir = mkdtempSync(join(tmpdir(), 'reader-panghu-users-'))
  dirs.push(dir)
  return join(dir, 'reader.db')
}

process.on('exit', () => {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* Windows 上 WAL 句柄可能短暂占用 */
    }
  }
})

test('管理员排在最前，默认配额与开关齐全', () => {
  const store = openDatabase(tempFile())
  store.createUser('boss', 'x', 'admin')
  store.createUser('sub', 'y')
  const users = store.listUsers()
  assert.equal(users[0].username, 'boss')
  assert.equal(users[0].role, 'admin')
  assert.equal(users[0].bookLimit, 0)
  assert.equal(users[0].sourceLimit, 0)
  assert.equal(users[0].allowWebdav, 1)
  assert.equal(users[0].allowEditSources, 1)
  store.db.close()
})

test('updateUserSettings 写入配额与功能开关', () => {
  const store = openDatabase(tempFile())
  const sub = store.createUser('sub', 'y')
  store.updateUserSettings(sub.id, {
    bookLimit: 12,
    sourceLimit: 3,
    allowWebdav: false,
    allowWarehouse: false,
    allowEditSources: false,
    allowEditRss: true,
  })
  const user = store.getUserById(sub.id)
  assert.equal(user.bookLimit, 12)
  assert.equal(user.sourceLimit, 3)
  assert.equal(user.allowWebdav, 0)
  assert.equal(user.allowWarehouse, 0)
  assert.equal(user.allowEditSources, 0)
  assert.equal(user.allowEditRss, 1)
  store.db.close()
})

test('老库 users 表缺列时自动补列', () => {
  const file = tempFile()
  const raw = new DatabaseSync(file)
  raw.exec(
    'CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT, role TEXT NOT NULL DEFAULT "user", created_at INTEGER NOT NULL)',
  )
  raw.close()

  const store = openDatabase(file)
  const user = store.getUserById(1)
  assert.equal(user.bookLimit, 0)
  assert.equal(user.sourceLimit, 0)
  assert.equal(user.allowWebdav, 1)
  store.updateUserSettings(1, { bookLimit: 5 })
  assert.equal(store.getUserById(1).bookLimit, 5)
  store.db.close()
})
