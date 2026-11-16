/**
 * Minimal PDF text extractor for text-based PDFs.
 *
 * Scope and honesty: PDF has no mandated text encoding. This reader decodes
 * literal strings written with the standard `Tj` / `TJ` operators, inflating
 * FlateDecode streams when needed. It therefore works for PDFs that embed text
 * directly (the common "exported/saved as PDF" novel) and does NOT recover:
 *   - scanned page images (they contain no text at all),
 *   - text drawn through custom CID fonts without a ToUnicode map (common for
 *     Chinese typesetting, where codes must be mapped through the font).
 * Both cases return what bytes say rather than inventing characters.
 */

import { inflateSync } from 'node:zlib'

function decodeLiteral(raw) {
  return raw
    .replace(/\\([nrtbf])/g, (_, ch) => ({ n: '\n', r: '\n', t: '\t', b: '', f: '' })[ch])
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\(.)/g, '$1')
}

/** Pull readable strings out of one content stream. */
function stringsFromStream(content) {
  const lines = []
  let buffer = ''
  let depth = 0
  let inString = false

  const flushLine = () => {
    if (buffer.trim()) lines.push(buffer.trim())
    buffer = ''
  }

  for (let index = 0; index < content.length; index++) {
    const ch = content[index]
    if (inString) {
      if (ch === '\\') {
        buffer += ch + (content[index + 1] ?? '')
        index += 1
        continue
      }
      if (ch === ')') {
        inString = false
        continue
      }
      buffer += ch
      continue
    }
    if (ch === '(') {
      if (depth === 0) buffer += ''
      inString = true
      continue
    }
    if (ch === '[') {
      depth += 1
      continue
    }
    if (ch === ']') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (ch === 'T' && (content[index + 1] === 'j' || content[index + 1] === 'J')) {
      flushLine()
      index += 1
      continue
    }
    if (ch === 'T' && (content[index + 1] === 'd' || content[index + 1] === 'D' || content[index + 1] === '*')) {
      flushLine()
      index += 1
      continue
    }
    if (ch === 'E' && content.startsWith('ET', index)) {
      flushLine()
      index += 1
    }
  }
  flushLine()
  return lines.map((line) => decodeLiteral(line)).join('\n')
}

/** @param {Uint8Array} bytes */
export function extractPdfText(bytes) {
  const latin = Buffer.from(bytes).toString('latin1')
  const chunks = []

  let cursor = 0
  while (true) {
    const start = latin.indexOf('stream', cursor)
    if (start < 0) break
    let dataStart = start + 'stream'.length
    if (latin[dataStart] === '\r') dataStart += 1
    if (latin[dataStart] === '\n') dataStart += 1
    const end = latin.indexOf('endstream', dataStart)
    if (end < 0) break
    const raw = Buffer.from(latin.slice(dataStart, end), 'latin1')
    cursor = end + 'endstream'.length

    let content = null
    try {
      content = inflateSync(raw).toString('latin1')
    } catch {
      // Uncompressed stream (or an image/binary stream we cannot read).
      const head = raw.subarray(0, 8).toString('latin1')
      if (!head.startsWith('%PDF') && /BT|Tj|TJ/.test(raw.toString('latin1').slice(0, 2048))) {
        content = raw.toString('latin1')
      }
    }
    if (!content) continue
    const text = stringsFromStream(content)
    if (text.trim()) chunks.push(text)
  }

  const plain = chunks
    .join('\n')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!plain) throw new Error('这个 PDF 没有可提取的文字（可能是扫描版或嵌入字体无 ToUnicode 映射）')
  return plain
}
