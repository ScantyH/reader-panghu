/**
 * 书源封面地址补全。
 *
 *   node --test apps/server/test/cover-url.test.js
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveCoverUrl } from '../src/cover-url.js'

test('相对封面地址按书籍地址补全', () => {
  assert.equal(
    resolveCoverUrl('/covers/1.jpg', 'https://example.com/book/1'),
    'https://example.com/covers/1.jpg',
  )
  assert.equal(
    resolveCoverUrl('images/1.jpg', 'https://example.com/book/1'),
    'https://example.com/book/images/1.jpg',
  )
})

test('协议相对、绝对、data 地址保持可用', () => {
  assert.equal(resolveCoverUrl('//cdn.example.com/1.jpg'), 'https://cdn.example.com/1.jpg')
  assert.equal(resolveCoverUrl('http://cdn.example.com/1.jpg', 'https://example.com'), 'http://cdn.example.com/1.jpg')
  assert.equal(resolveCoverUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
  assert.equal(resolveCoverUrl('', 'https://example.com'), '')
})

test('HTML 实体与无法补全的地址', () => {
  assert.equal(resolveCoverUrl('https://example.com/a.jpg?x=1&amp;y=2'), 'https://example.com/a.jpg?x=1&y=2')
  assert.equal(resolveCoverUrl('/cover.jpg', 'local://epub/book'), '/cover.jpg')
})
