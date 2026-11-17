/**
 * 会话 TTL：30 天整仍有效，超过 1ms 即过期。
 *
 *   node --test apps/server/test/auth.test.js
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { __test__ } from '../src/auth.js'

const DAY = 24 * 60 * 60 * 1000
const TTL = 30 * DAY

test('恰好 30 天仍有效', () => {
  assert.equal(__test__.isSessionExpired({ createdAt: 1000 }, 1000 + TTL), false)
})

test('超过 30 天 1ms 判定过期', () => {
  assert.equal(__test__.isSessionExpired({ createdAt: 1000 }, 1000 + TTL + 1), true)
})

test('没有会话时视为过期', () => {
  assert.equal(__test__.isSessionExpired(null), true)
})
