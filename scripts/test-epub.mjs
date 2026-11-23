/**
 * EPUB upload test: build a real EPUB in memory, upload it, then read it back
 * through the same endpoints the UI uses.
 *
 *   node scripts/test-epub.mjs [baseUrl]
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
  const response = await fetch(`${base}${path}`, init)
  const payload = await response.json()
  if (payload.isSuccess === false) throw new Error(`${path} → ${payload.errorMsg}`)
  return payload.data
}

function buildEpub() {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>测试 EPUB 之书</dc:title>
    <dc:creator>测试作者甲</dc:creator>
    <dc:description>这是一本用于验证解析的 EPUB 电子书。</dc:description>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="cover-img" href="cover.jpg" media-type="image/jpeg"/>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`

  const chapter = (title, body) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h1>${title}</h1><p>${body}</p><p>第二段内容。</p></body></html>`

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

  // A 1x1 JPEG is enough: the server stores bytes, it does not re-encode.
  const jpeg = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ])

  return zipSync(
    {
      'mimetype': [strToU8('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': strToU8(container),
      'OEBPS/content.opf': strToU8(opf),
      'OEBPS/chapter1.xhtml': strToU8(chapter('第一章 起风了', '第一章的正文段落。')),
      'OEBPS/chapter2.xhtml': strToU8(chapter('第二章 落雨了', '第二章的正文段落。')),
      'OEBPS/cover.jpg': jpeg,
    },
    { level: 6 },
  )
}

function buildNavEpub() {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>导航封面测试</dc:title>
    <dc:creator>测试作者乙</dc:creator>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="toc"><ol>
  <li><a href="text/ch1.xhtml">异界来客</a></li>
  <li><a href="text/ch2.xhtml">旧城</a></li>
</ol></nav></body></html>`

  const chapter = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>${body}</p></body></html>`

  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ])

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

  return zipSync(
    {
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': strToU8(container),
      'OEBPS/content.opf': strToU8(opf),
      'OEBPS/nav.xhtml': strToU8(nav),
      'OEBPS/text/ch1.xhtml': strToU8(chapter('异界来客的正文。')),
      'OEBPS/text/ch2.xhtml': strToU8(chapter('旧城的正文。')),
      'OEBPS/images/cover.png': png,
    },
    { level: 6 },
  )
}

console.log(`base: ${base}`)

const form = new FormData()
form.append('file', new Blob([buildEpub()], { type: 'application/epub+zip' }), '测试EPUB.epub')
const book = await call('/reader3/uploadEpubBook', { method: 'POST', form })
console.log(`  ✓ uploadEpubBook → ${book.name} / ${book.author}`)
if (book.name !== '测试 EPUB 之书') throw new Error(`书名解析错误: ${book.name}`)
if (book.author !== '测试作者甲') throw new Error(`作者解析错误: ${book.author}`)
if (!book.intro.includes('验证解析')) throw new Error(`简介解析错误: ${book.intro}`)
if (!book.customCoverUrl) throw new Error('封面未解析')
console.log(`  cover: ${book.customCoverUrl}`)

const chapters = await call('/reader3/getChapterList', { method: 'POST', body: { bookUrl: book.bookUrl } })
if (chapters.length !== 2) throw new Error(`章节数应为 2，实际 ${chapters.length}`)
console.log(`  ✓ getChapterList → ${chapters.map((c) => c.title).join(' / ')}`)

const first = await call('/reader3/getBookContent', { method: 'POST', body: { bookUrl: book.bookUrl, index: 0 } })
if (!first.includes('第一章的正文段落')) throw new Error(`正文错误: ${first}`)
console.log(`  ✓ getBookContent → ${first.replace(/\n/g, ' / ').slice(0, 60)}`)

const coverResponse = await fetch(`${base}${book.customCoverUrl}`)
if (!coverResponse.ok) throw new Error(`封面取不到: HTTP ${coverResponse.status}`)
console.log(`  ✓ cover served (${coverResponse.headers.get('content-type')}, ${(await coverResponse.arrayBuffer()).byteLength}B)`)

const shelf = await call('/reader3/getBookshelf')
const onShelf = shelf.find((item) => item.bookUrl === book.bookUrl)
if (!onShelf) throw new Error('EPUB 未进入书架')
console.log(`  ✓ 书架可见，共 ${shelf.length} 本`)

// EPUB3 nav + cover-image: no <h1>, titles must come from nav; cover must resolve.
const navForm = new FormData()
navForm.append('file', new Blob([buildNavEpub()], { type: 'application/epub+zip' }), '导航封面测试.epub')
const navBook = await call('/reader3/uploadEpubBook', { method: 'POST', form: navForm })
if (navBook.name !== '导航封面测试') throw new Error(`导航书书名错误: ${navBook.name}`)
if (!navBook.customCoverUrl) throw new Error('EPUB3 cover-image 未解析')
console.log(`  ✓ EPUB3 封面 → ${navBook.customCoverUrl}`)
const navChapters = await call('/reader3/getChapterList', { method: 'POST', body: { bookUrl: navBook.bookUrl } })
if (navChapters.length !== 2) throw new Error(`导航书章节数错误: ${navChapters.length}`)
if (navChapters[0].title !== '异界来客' || navChapters[1].title !== '旧城') {
  throw new Error(`EPUB3 导航目录未识别: ${navChapters.map((c) => c.title).join(' / ')}`)
}
console.log(`  ✓ EPUB3 导航目录 → ${navChapters.map((c) => c.title).join(' / ')}`)
const navContent = await call('/reader3/getBookContent', { method: 'POST', body: { bookUrl: navBook.bookUrl, index: 1 } })
if (!navContent.includes('旧城的正文')) throw new Error(`EPUB3 正文错误: ${navContent}`)
const navCover = await fetch(`${base}${navBook.customCoverUrl}`)
if (!navCover.ok || !/^image\//i.test(navCover.headers.get('content-type') || '')) {
  throw new Error(`EPUB3 封面取不到: HTTP ${navCover.status}`)
}
console.log(`  ✓ EPUB3 封面可取 (${navCover.headers.get('content-type')})`)

// Warehouse import in a category must keep the same cover and TOC.
const warehouseForm = new FormData()
warehouseForm.append('file', new Blob([buildNavEpub()], { type: 'application/epub+zip' }), '导航封面测试.epub')
const warehouseUpload = await fetch(`${base}/reader3/warehouse/upload?path=分类测试`, { method: 'POST', body: warehouseForm }).then((response) => response.json())
if (warehouseUpload.isSuccess === false) throw new Error(`书仓上传失败: ${warehouseUpload.errorMsg}`)
const imported = await call('/reader3/warehouse/import', { method: 'POST', body: { path: '分类测试/导航封面测试.epub' } })
if (!imported.book?.bookUrl) throw new Error('书仓导入没有返回书')
if (!imported.book.customCoverUrl) throw new Error('书仓分类导入未保存封面')
const importedChapters = await call('/reader3/getChapterList', { method: 'POST', body: { bookUrl: imported.book.bookUrl } })
if (importedChapters[0]?.title !== '异界来客' || importedChapters[1]?.title !== '旧城') {
  throw new Error(`书仓分类导入目录错误: ${importedChapters.map((c) => c.title).join(' / ')}`)
}
const importedCover = await fetch(`${base}${imported.book.customCoverUrl}`)
if (!importedCover.ok) throw new Error(`书仓分类封面取不到: HTTP ${importedCover.status}`)
console.log(`  ✓ 书仓分类导入保留封面与目录 → ${imported.book.name}`)

// PDF/MOBI must answer honestly rather than pretend
const pdf = new FormData()
pdf.append('file', new Blob([strToU8('%PDF-1.4 fake')], { type: 'application/pdf' }), 'x.pdf')
const pdfResponse = await fetch(`${base}/reader3/uploadPdfBook`, { method: 'POST', body: pdf })
const pdfPayload = await pdfResponse.json()
if (pdfPayload.isSuccess !== false) throw new Error('PDF 应当明确报未接入')
console.log(`  ✓ uploadPdfBook → ${pdfPayload.errorMsg}`)

console.log('\nEPUB checks passed')
