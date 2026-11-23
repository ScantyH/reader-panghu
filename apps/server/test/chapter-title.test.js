/**
 * 分章标题识别：除了「第X章/序章/楔子」，还要识别「1、异界来客」这类编号标题。
 *
 *   node --test apps/server/test/chapter-title.test.js
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isChapterTitle } from '../src/chapter-title.js'

test('识别常见章节标题', () => {
  for (const title of [
    '第一章 异界来客',
    '第1章 异界来客',
    '序章',
    '楔子 异界来客',
    '1、异界来客',
    '1. 异界来客',
    '１、异界来客',
    '01、异界来客',
    '一、异界来客',
    '十二、异界来客',
    '1、异界来客（上）',
  ]) {
    assert.equal(isChapterTitle(title), true, `应识别：${title}`)
  }
})

test('不把正文列举和句子误判成章节标题', () => {
  for (const line of [
    '1、他说。',
    '1、这是一段很长的正文，明显不是章节标题，只是普通列举。',
    '1.5 倍的灵气',
    '1、',
    '2023年、年度总结',
    '正文第一段',
  ]) {
    assert.equal(isChapterTitle(line), false, `不应识别：${line}`)
  }
})
