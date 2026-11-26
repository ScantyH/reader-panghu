/**
 * MOBI / AZW3 reader (PalmDB container).
 *
 * Layout we need:
 *   record 0 : PalmDOC header (compression, text length, record count)
 *              + MOBI header (encoding, full name) + optional EXTH (title/author)
 *   record 1..N : text chunks, PalmDOC-LZ77 compressed when compression === 2
 *
 * Unsupported: HUFF/CDIC compression (compression === 17480) and DRM
 * (encryption !== 0). Both throw a readable error instead of producing garbage.
 */

import { splitPlainTextChapters } from './chapter-title.js'

function palmDocDecompress(bytes) {
  const out = []
  let i = 0
  while (i < bytes.length) {
    const c = bytes[i++]
    if (c === 0) {
      out.push(0)
      continue
    }
    if (c <= 8) {
      for (let k = 0; k < c && i < bytes.length; k++) out.push(bytes[i++])
      continue
    }
    if (c <= 0x7f) {
      out.push(c)
      continue
    }
    if (c <= 0xbf) {
      const next = bytes[i++]
      const pair = (c << 8) | next
      const distance = (pair >> 3) & 0x7ff
      const length = (pair & 0x07) + 3
      let start = out.length - distance
      for (let k = 0; k < length; k++, start++) out.push(out[start] ?? 0)
      continue
    }
    out.push(0x20)
    out.push(c ^ 0x80)
  }
  return Uint8Array.from(out)
}

function decode(bytes, encoding) {
  const label = encoding === 65001 ? 'utf-8' : 'windows-1252'
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function readExth(rec0, offset, end, encoding) {
  const meta = {}
  if (offset + 12 > end) return meta
  const magic = String.fromCharCode(...rec0.subarray(offset, offset + 4))
  if (magic !== 'EXTH') return meta
  const dv = new DataView(rec0.buffer, rec0.byteOffset, rec0.byteLength)
  const count = dv.getUint32(offset + 8)
  let cursor = offset + 12
  for (let index = 0; index < count; index++) {
    if (cursor + 8 > end) break
    const type = dv.getUint32(cursor)
    const length = dv.getUint32(cursor + 4)
    if (length < 8 || cursor + length > end) break
    const value = rec0.subarray(cursor + 8, cursor + length)
    if (type === 503) meta.title = decode(value, encoding)
    if (type === 100) meta.author = decode(value, encoding)
    if (type === 524) meta.intro = decode(value, encoding)
    if ((type === 201 || type === 202) && value.length >= 4) {
      const offset = new DataView(value.buffer, value.byteOffset, value.byteLength).getUint32(0)
      if (offset !== 0xffffffff) meta[type === 201 ? 'coverOffset' : 'thumbOffset'] = offset
    }
    cursor += length
  }
  return meta
}

function imageTypeOf(bytes) {
  if (!bytes || bytes.length < 12) return ''
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    return 'image/webp'
  }
  return ''
}

export function splitChapters(text, fallbackTitle = '开始') {
  return splitPlainTextChapters(text, { fallbackTitle })
}

/** @param {Uint8Array} bytes */
export function parseMobi(bytes) {
  if (bytes.length < 78) throw new Error('文件太小，不是 MOBI/AZW3')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const numRecords = dv.getUint16(76)
  if (!numRecords) throw new Error('PalmDB 记录数为 0')

  const offsets = []
  for (let index = 0; index < numRecords; index++) offsets.push(dv.getUint32(78 + index * 8))
  const record = (index) => {
    const start = offsets[index]
    const end = index + 1 < numRecords ? offsets[index + 1] : bytes.length
    return bytes.subarray(start, end)
  }

  const rec0 = record(0)
  const d0 = new DataView(rec0.buffer, rec0.byteOffset, rec0.byteLength)
  const compression = d0.getUint16(0)
  const textLength = d0.getUint32(4)
  const textRecordCount = d0.getUint16(8)
  const encryption = d0.getUint16(12)
  if (encryption !== 0) throw new Error('MOBI 带 DRM 保护，无法解析')
  if (compression === 17480) throw new Error('MOBI 使用 HUFF/CDIC 压缩，暂不支持（请转换为 EPUB 或 TXT）')
  if (compression !== 1 && compression !== 2) throw new Error(`未知的 MOBI 压缩格式：${compression}`)

  let encoding = 1252
  let fullNameOffset = 0
  let fullNameLength = 0
  let meta = {}
  const magic = String.fromCharCode(...rec0.subarray(16, 20))
  if (magic === 'MOBI') {
    encoding = d0.getUint32(28)
    fullNameOffset = d0.getUint32(84)
    fullNameLength = d0.getUint32(88)
    const mobiHeaderLength = d0.getUint32(20)
    const exthFlags = d0.getUint32(128)
    if (exthFlags & 0x40) meta = readExth(rec0, 16 + mobiHeaderLength, rec0.length, encoding)
  }

  let text = ''
  for (let index = 1; index <= textRecordCount; index++) {
    const chunk = record(index)
    if (!chunk) break
    const bytesOut = compression === 2 ? palmDocDecompress(chunk) : chunk
    text += decode(bytesOut, encoding)
  }
  text = text.slice(0, textLength)

  let title = meta.title || ''
  if (!title && fullNameLength) title = decode(rec0.subarray(fullNameOffset, fullNameOffset + fullNameLength), encoding)

  const chapters = splitChapters(text, title || '正文')
  if (!chapters.length) throw new Error('MOBI 里没有可读文字')

  const images = []
  for (let index = textRecordCount + 1; index < numRecords; index++) {
    const chunk = record(index)
    const type = imageTypeOf(chunk)
    if (type) images.push({ bytes: chunk, type })
  }
  const cover = images[Number.isInteger(meta.coverOffset) ? meta.coverOffset : 0] || images[0] || null

  return {
    title: (title || '未命名').trim(),
    author: (meta.author || '').trim(),
    intro: (meta.intro || '').trim(),
    cover: cover ? Uint8Array.from(cover.bytes) : null,
    coverType: cover?.type || null,
    chapters,
  }
}
