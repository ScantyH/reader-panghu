/**
 * 分章标题识别：除了「第X章/序章/楔子」，还要识别卷/集前缀、编号标题和裸编号。
 *
 *   node --test apps/server/test/chapter-title.test.js
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isChapterTitle, normalizeChapterTitle, splitPlainTextChapters } from '../src/chapter-title.js'

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

test('识别用户实际遇到的复合章节名', () => {
  for (const title of [
    '第一集 斗罗世界 引子 穿越的唐家三少',
    '第一集 斗罗世界 第二章 废武魂与先天满魂力',
    '第一集 秦羽 第一章 秦羽',
    '第一集：名为生化 第一章：醒来（上）',
    '正文 第一章 姬家长空',
    '1章 赵颜妍的婚礼',
    '1 江湖',
    '001 财富隐藏在报纸里',
    '001【1993年的夏天】',
    '第一部 传国宝玺 第一章　《茅山图志》',
    '第一卷\u200b 芥子秘境 第1章 离家',
    '第一卷 祸水红颜 序章',
    '二：婚礼现场',
    '雍容华贵的野蛮上司1',
    '办公室的情人104',
    '正文 第一章 我是九哥',
    '正文 第一章 简单任务（一）',
    '序',
    '序言',
    '引',
    '引子',
    '楔子',
    '前言',
    '番外 后日谈',
  ]) {
    assert.equal(isChapterTitle(title), true, `应识别：${title}`)
  }
})

test('正文前缀从目录标题中去掉', () => {
  assert.equal(normalizeChapterTitle('正文 第一章 姬家长空'), '第一章 姬家长空')
  assert.equal(normalizeChapterTitle('正文 第一章 我是九哥'), '第一章 我是九哥')
  assert.equal(normalizeChapterTitle('第一集 正文 第一章 醒来'), '第一集 第一章 醒来')
  assert.equal(normalizeChapterTitle('第一卷\u200b 芥子秘境 第1章 离家'), '第一卷 芥子秘境 第1章 离家')
  assert.equal(normalizeChapterTitle('正文'), '')
})

test('不把正文列举和句子误判成章节标题', () => {
  for (const line of [
    '1、他说。',
    '1、这是一段很长的正文，明显不是章节标题，只是普通列举。',
    '1.5 倍的灵气',
    '1、',
    '2023年、年度总结',
    '正文第一段',
    '第一章 这是一段正文，不是目录标题。',
    '这只是一段普通正文，里面提到了第二章。',
  ]) {
    assert.equal(isChapterTitle(line), false, `不应识别：${line}`)
  }
})

test('没有章节标题时按约 10000 字在段落边界自动分章', () => {
  const paragraphs = Array.from({ length: 12 }, (_, index) => `P${index}：${'甲'.repeat(4000)}`)
  const chapters = splitPlainTextChapters(paragraphs.join('\n\n'), { target: 10000 })
  assert.ok(chapters.length >= 2, `应至少分成 2 章，实际 ${chapters.length}`)
  assert.deepEqual(
    chapters.map((chapter) => chapter.title),
    chapters.map((_, index) => `第${index + 1}章`),
  )
  for (const chapter of chapters) {
    for (const block of chapter.text.split('\n\n')) {
      assert.match(block, /^P\d+：甲+$/, '每章都应在完整段落后切开')
    }
  }
  assert.equal(chapters.map((chapter) => chapter.text).join('\n\n'), paragraphs.join('\n\n'))
})
