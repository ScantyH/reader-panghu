/**
 * DOCX upload test: build a real .docx in memory, upload it, read it back.
 *
 *   node scripts/test-docx.mjs [baseUrl]
 */

import { strToU8, zipSync } from 'fflate'

const base = (process.argv[2] || 'http://127.0.0.1:18080').replace(/\/+$/, '')

const call = async (path, { method = 'GET', body, form } = {}) => {
  const init = { method }
  if (form) init.body = form
  else if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const payload = await (await fetch(`${base}${path}`, init)).json()
  if (payload.isSuccess === false) throw new Error(`${path} → ${payload.errorMsg}`)
  return payload.data
}

const para = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`

function buildDocx() {
  const files = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    'docProps/core.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>测试 DOCX 小说</dc:title></cp:coreProperties>',
    ),
    'word/document.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${para(
        '第一章 山门',
      )}${para('这是第一章的正文。')}${para('第一章第二段。')}${para('第二章 落雨')}${para('这是第二章的正文。')}</w:body></w:document>`,
    ),
  }
  return zipSync(files, { level: 6 })
}

console.log(`base: ${base}`)

const form = new FormData()
form.append('file', new Blob([buildDocx()], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), '测试小说.docx')
const book = await call('/reader3/uploadDocxBook', { method: 'POST', form })
if (book.name !== '测试 DOCX 小说') throw new Error(`书名错误: ${book.name}`)
console.log(`  ✓ uploadDocxBook → ${book.name}`)

const chapters = await call('/reader3/getChapterList', { method: 'POST', body: { bookUrl: book.bookUrl } })
if (chapters.length !== 2) throw new Error(`应拆出 2 章，实际 ${chapters.length}: ${chapters.map((c) => c.title)}`)
console.log(`  ✓ 自动分章 → ${chapters.map((c) => c.title).join(' / ')}`)

const content = await call('/reader3/getBookContent', { method: 'POST', body: { bookUrl: book.bookUrl, index: 0 } })
if (!content.includes('第一章的正文') || !content.includes('第一章第二段')) throw new Error(`正文错误: ${content}`)
console.log(`  ✓ 正文 → ${content.replace(/\n/g, ' / ')}`)

const mobi = new FormData()
mobi.append('file', new Blob([strToU8('fake')], { type: 'application/x-mobipocket-ebook' }), 'x.mobi')
const mobiPayload = await (await fetch(`${base}/reader3/uploadMobiBook`, { method: 'POST', body: mobi })).json()
if (mobiPayload.isSuccess !== false) throw new Error('MOBI 应明确报未接入')
console.log(`  ✓ uploadMobiBook → ${mobiPayload.errorMsg}`)

console.log('\nDOCX checks passed')
