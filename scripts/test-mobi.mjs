/**
 * MOBI upload test: build a PalmDB/MOBI container in memory, upload, read back.
 *
 *   node scripts/test-mobi.mjs [baseUrl]
 */

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

const encoder = new TextEncoder()

function buildMobi({ title, author, text }) {
  const titleBytes = encoder.encode(title)
  const authorBytes = encoder.encode(author)
  const textBytes = encoder.encode(text)

  // EXTH block: header (12) + two records
  const exthRecords = [
    { type: 503, data: titleBytes },
    { type: 100, data: authorBytes },
  ]
  const exthLength = 12 + exthRecords.reduce((sum, record) => sum + 8 + record.data.length, 0)
  const exth = new Uint8Array(exthLength)
  const exthView = new DataView(exth.buffer)
  exth.set(encoder.encode('EXTH'), 0)
  exthView.setUint32(4, exthLength)
  exthView.setUint32(8, exthRecords.length)
  let cursor = 12
  for (const record of exthRecords) {
    exthView.setUint32(cursor, record.type)
    exthView.setUint32(cursor + 4, 8 + record.data.length)
    exth.set(record.data, cursor + 8)
    cursor += 8 + record.data.length
  }

  const MOBI_HEADER = 232
  const rec0Length = 16 + MOBI_HEADER + exthLength + titleBytes.length
  const rec0 = new Uint8Array(rec0Length)
  const d0 = new DataView(rec0.buffer)
  d0.setUint16(0, 1) // compression = none
  d0.setUint32(4, textBytes.length)
  d0.setUint16(8, 1) // one text record
  d0.setUint16(10, 4096)
  d0.setUint16(12, 0) // no encryption
  rec0.set(encoder.encode('MOBI'), 16)
  d0.setUint32(20, MOBI_HEADER)
  d0.setUint32(28, 65001) // UTF-8
  d0.setUint32(84, 16 + MOBI_HEADER + exthLength) // fullNameOffset
  d0.setUint32(88, titleBytes.length)
  d0.setUint32(128, 0x40) // EXTH present
  rec0.set(exth, 16 + MOBI_HEADER)
  rec0.set(titleBytes, 16 + MOBI_HEADER + exthLength)

  const numRecords = 2
  const headerSize = 78 + numRecords * 8
  const total = headerSize + rec0Length + textBytes.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint16(76, numRecords)
  view.setUint32(78, headerSize) // record 0 offset
  view.setUint32(86, headerSize + rec0Length) // record 1 offset
  out.set(rec0, headerSize)
  out.set(textBytes, headerSize + rec0Length)
  return out
}

console.log(`base: ${base}`)

const mobi = buildMobi({
  title: '测试 MOBI 小说',
  author: '测试作者乙',
  text: '第一章 山门\n这是第一章的正文。\n第二章 落雨\n这是第二章的正文。',
})
const form = new FormData()
form.append('file', new Blob([mobi], { type: 'application/x-mobipocket-ebook' }), '测试.mobi')
const book = await call('/reader3/uploadMobiBook', { method: 'POST', form })
if (book.name !== '测试 MOBI 小说') throw new Error(`书名错误: ${book.name}`)
if (book.author !== '测试作者乙') throw new Error(`作者错误: ${book.author}`)
console.log(`  ✓ uploadMobiBook → ${book.name} / ${book.author}`)

const chapters = await call('/reader3/getChapterList', { method: 'POST', body: { bookUrl: book.bookUrl } })
if (chapters.length !== 2) throw new Error(`应拆出 2 章，实际 ${chapters.length}: ${chapters.map((c) => c.title)}`)
console.log(`  ✓ 自动分章 → ${chapters.map((c) => c.title).join(' / ')}`)

const content = await call('/reader3/getBookContent', { method: 'POST', body: { bookUrl: book.bookUrl, index: 1 } })
if (!content.includes('第二章的正文')) throw new Error(`正文错误: ${content}`)
console.log(`  ✓ 正文 → ${content.replace(/\n/g, ' / ')}`)

const pdf = new FormData()
pdf.append('file', new Blob([encoder.encode('%PDF-1.4')], { type: 'application/pdf' }), 'x.pdf')
const pdfPayload = await (await fetch(`${base}/reader3/uploadPdfBook`, { method: 'POST', body: pdf })).json()
if (pdfPayload.isSuccess !== false) throw new Error('PDF 应明确报未接入')
console.log(`  ✓ uploadPdfBook → ${pdfPayload.errorMsg}`)

console.log('\nMOBI checks passed')
