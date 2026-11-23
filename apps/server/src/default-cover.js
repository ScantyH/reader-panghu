/**
 * 没有内嵌封面的本地书（TXT/PDF，或没有图片的 DOCX/MOBI/EPUB）生成一张
 * 简单的 SVG 封面，保证书架上永远不会是空白破图。
 */

import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const escapeXml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

function wrapTitle(title) {
  const text = String(title || '未命名').trim()
  if (text.length <= 12) return [text]
  return [text.slice(0, 12), text.slice(12, 24)]
}

export function writeDefaultCover(coversDir, title, author = '') {
  const id = randomUUID()
  const lines = wrapTitle(title)
  const titleSvg = lines
    .map((line, index) => {
      const size = lines.length > 1 ? 34 : 42
      const y = 300 + index * 48
      return `<text x="240" y="${y}" font-size="${size}" font-weight="700" fill="#3b2f24" text-anchor="middle">${escapeXml(line)}</text>`
    })
    .join('')
  const authorSvg = author
    ? `<text x="240" y="390" font-size="20" fill="#6b5a44" text-anchor="middle">${escapeXml(String(author).slice(0, 20))}</text>`
    : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640" viewBox="0 0 480 640">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#efe3cc"/>
      <stop offset="1" stop-color="#d8c5a4"/>
    </linearGradient>
  </defs>
  <rect width="480" height="640" fill="url(#g)"/>
  <rect x="28" y="28" width="424" height="584" rx="18" fill="none" stroke="#8c7657" stroke-width="2" opacity="0.45"/>
  <text x="240" y="190" font-size="18" fill="#7a6449" text-anchor="middle" letter-spacing="4">胖虎阅读</text>
  ${titleSvg}
  ${authorSvg}
  <text x="240" y="560" font-size="16" fill="#7a6449" text-anchor="middle" opacity="0.65">本地书籍</text>
</svg>`
  writeFileSync(join(coversDir, `${id}.svg`), svg, 'utf8')
  return `/reader3/bookCover/${id}`
}
