/**
 * Smoke test for the secondary /reader3 endpoints: bookmarks, replace rules,
 * book-source import, local TXT books, and the honest "not implemented" answer.
 *
 *   node scripts/test-extras.mjs [baseUrl]
 */

import { readFileSync } from 'node:fs'

const base = (process.argv[2] || 'http://127.0.0.1:18080').replace(/\/+$/, '')

const call = async (path, { method = 'GET', body } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : undefined,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json()
  return payload
}

const expectOk = (label, payload) => {
  if (!payload.isSuccess) throw new Error(`${label}: ${payload.errorMsg}`)
  console.log(`  ✓ ${label}`)
  return payload.data
}

console.log(`base: ${base}`)

// bookmarks
const bookUrl = 'local://txt/test-book'
expectOk('saveBookmark', await call('/reader3/saveBookmark', { method: 'POST', body: { bookUrl, chapterIndex: 2, title: '第二章' } }))
const marks = expectOk('getBookmarks', await call('/reader3/getBookmarks'))
if (marks.length !== 1) throw new Error(`书签数量应为 1，实际 ${marks.length}`)
expectOk('deleteBookmark', await call('/reader3/deleteBookmark', { method: 'POST', body: { bookUrl, chapterIndex: 2 } }))
const marks2 = expectOk('getBookmarks (after delete)', await call('/reader3/getBookmarks'))
if (marks2.length !== 0) throw new Error(`书签应已删除，实际 ${marks2.length}`)

// replace rules
expectOk('saveReplaceRule', await call('/reader3/saveReplaceRule', { method: 'POST', body: { name: '去广告', pattern: '广告', replacement: '' } }))
const rules = expectOk('getReplaceRules', await call('/reader3/getReplaceRules'))
if (rules.length < 1) throw new Error('替换规则未保存')
expectOk('deleteReplaceRule', await call('/reader3/deleteReplaceRule', { method: 'POST', body: { name: '去广告' } }))

// book source import (multipart)
const sourceJson = readFileSync('scripts/fixtures/synthetic-source.json', 'utf8')
const form = new FormData()
form.append('file', new Blob([sourceJson], { type: 'application/json' }), 'source.json')
const imported = expectOk('readSourceFile', await call('/reader3/readSourceFile', { method: 'POST', body: form }))
if (!imported.length) throw new Error('导入没有解析出书源')
console.log(`  imported: ${imported.map((item) => item.bookSourceName).join(', ')}`)

// local TXT book
const txt = [
  '第一章 起风了',
  '这是第一章的正文。',
  '',
  '第二章 落雨了',
  '这是第二章的正文。',
  '',
  '1、异界来客',
  '这是异界来客的正文。',
].join('\n')
const txtForm = new FormData()
txtForm.append('file', new Blob([txt], { type: 'text/plain' }), '测试书.txt')
const book = expectOk('uploadTxtBook', await call('/reader3/uploadTxtBook', { method: 'POST', body: txtForm }))
console.log(`  local book: ${book.name} (${book.bookUrl})`)

const chapters = expectOk('getChapterList (local)', await call('/reader3/getChapterList', { method: 'POST', body: { bookUrl: book.bookUrl } }))
if (chapters.length !== 3) throw new Error(`本地书应有 3 章，实际 ${chapters.length}`)
if (chapters[2].title !== '1、异界来客') throw new Error(`编号标题未识别：${chapters[2].title}`)

const content = expectOk('getBookContent (local)', await call('/reader3/getBookContent', { method: 'POST', body: { bookUrl: book.bookUrl, index: 1 } }))
if (!content.includes('第二章')) throw new Error(`本地正文不对: ${content}`)
const numbered = expectOk('getBookContent (local, 1、)', await call('/reader3/getBookContent', { method: 'POST', body: { bookUrl: book.bookUrl, index: 2 } }))
if (!numbered.includes('异界来客的正文')) throw new Error(`编号标题正文不对: ${numbered}`)
console.log(`  content: ${content.replace(/\n/g, ' / ')} / ${numbered.replace(/\n/g, ' / ')}`)

// unimplemented endpoint answers honestly
const missing = await call('/reader3/somethingNotBuilt')
if (missing.isSuccess !== false) throw new Error('未实现接口应返回 isSuccess:false')
console.log(`  ✓ unknown endpoint → ${missing.errorMsg}`)

console.log('\nall extras checks passed')
