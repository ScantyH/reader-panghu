/**
 * 书架新增时间：新书排在最前依赖 addedAt，更新旧书时不能把它重置。
 *
 *   node --test apps/server/test/books.test.js
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openDatabase } from '../src/db.js'

const dirs = []
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'reader-panghu-books-'))
  dirs.push(dir)
  return join(dir, 'reader.db')
}

process.on('exit', () => {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* Windows 下 WAL 句柄可能短暂占用 */
    }
  }
})

test('新书写入 addedAt，后续更新保留原值', () => {
  const store = openDatabase(tempFile())
  const first = store.saveBook({ bookUrl: 'local://first', origin: 'local://txt', name: '第一本' })
  const second = store.saveBook({ bookUrl: 'local://second', origin: 'local://txt', name: '第二本' })
  assert.ok(Number(first.addedAt) > 0)
  assert.ok(Number(second.addedAt) >= Number(first.addedAt))

  const updated = store.saveBook({ ...first, name: '第一本改名' })
  assert.equal(updated.name, '第一本改名')
  assert.equal(updated.addedAt, first.addedAt)
  store.db.close()
})
