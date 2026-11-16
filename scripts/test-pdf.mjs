const base = (process.argv[2] || 'http://127.0.0.1:18080').replace(/\/+$/, '')
const call = async (path, { method = 'GET', body, form } = {}) => {
  const init = { method }
  if (form) init.body = form
  else if (body !== undefined) { init.headers = { 'content-type': 'application/json' }; init.body = JSON.stringify(body) }
  const payload = await (await fetch(`${base}${path}`, init)).json()
  if (payload.isSuccess === false) throw new Error(`${path} -> ${payload.errorMsg}`)
  return payload.data
}
function buildPdf(lines) {
  const content = ['BT', '/F1 12 Tf', '72 720 Td']
  for (const line of lines) content.push(`(${line}) Tj 0 -14 Td`)
  content.push('ET')
  const body = content.join('\n')
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  objs.forEach((o, i) => { pdf += `${i + 1} 0 obj\n${o}\nendobj\n` })
  pdf += 'trailer\n<< /Root 1 0 R >>\n%%EOF\n'
  return pdf
}
console.log('base: ' + base)
const form = new FormData()
form.append('file', new Blob([buildPdf(['Chapter One', 'Body line one.', 'Body line two.'])], { type: 'application/pdf' }), 'novel.pdf')
const book = await call('/reader3/uploadPdfBook', { method: 'POST', form })
console.log('  ok uploadPdfBook -> ' + book.name + ' (' + book.totalChapterNum + ' chapters)')
const chapters = await call('/reader3/getChapterList', { method: 'POST', body: { bookUrl: book.bookUrl } })
if (!chapters.length) throw new Error('no chapters')
const content = await call('/reader3/getBookContent', { method: 'POST', body: { bookUrl: book.bookUrl, index: 0 } })
for (const expected of ['Chapter One', 'Body line one.', 'Body line two.']) {
  if (!content.includes(expected)) throw new Error('missing text: ' + expected + ' in ' + JSON.stringify(content))
}
console.log('  ok extracted: ' + content.replace(/\n/g, ' / '))
const scan = new FormData()
scan.append('file', new Blob([Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')], { type: 'application/pdf' }), 'scan.pdf')
const bad = await (await fetch(`${base}/reader3/uploadPdfBook`, { method: 'POST', body: scan })).json()
if (bad.isSuccess !== false) throw new Error('image-only PDF must fail loudly')
console.log('  ok image-only PDF -> ' + bad.errorMsg)
console.log('\nPDF checks passed')
