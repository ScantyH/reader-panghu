/**
 * 书架分组排序：order_no 决定书架分组 tabs 与设置里的显示顺序。
 *
 *   node --test apps/server/test/groups.test.js
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openDatabase } from '../src/db.js'

const dirs = []
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'reader-panghu-groups-'))
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

test('reorderGroups 按给定顺序写 order_no', () => {
  const store = openDatabase(tempFile())
  store.saveGroup({ groupId: 1, groupName: '玄幻' })
  store.saveGroup({ groupId: 2, groupName: '都市' })
  store.saveGroup({ groupId: 3, groupName: '科幻' })

  assert.equal(store.reorderGroups([3, 1, 2]), 3)
  const custom = store.listGroups().filter((group) => Number(group.groupId) !== 0)
  assert.deepEqual(custom.map((group) => group.groupName), ['科幻', '玄幻', '都市'])
  assert.deepEqual(custom.map((group) => group.orderNo), [1, 2, 3])
  store.db.close()
})
