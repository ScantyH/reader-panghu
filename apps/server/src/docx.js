/**
 * DOCX reader: enough to turn a Word novel into chapters.
 *
 * A .docx is a ZIP whose `word/document.xml` holds the body. Paragraphs become
 * lines; a paragraph that looks like a chapter heading (the same rule the TXT
 * path uses) starts a new chapter, otherwise it joins the current one.
 */

import { strFromU8, unzipSync } from 'fflate'
import { isChapterTitle, normalizeChapterTitle } from './chapter-title.js'

function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** @param {Uint8Array} bytes */
export function parseDocx(bytes) {
  const files = unzipSync(bytes)
  const documentXml = files['word/document.xml']
  if (!documentXml) throw new Error('不是有效的 DOCX（缺少 word/document.xml）')
  const xml = strFromU8(documentXml)

  const imageExt = (path) => String(path).split('.').pop().toLowerCase()
  const imageType = (path) =>
    ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' })[imageExt(path)] || 'image/jpeg'
  const coverPath =
    Object.keys(files).find((path) => /^word\/media\/.+\.(jpe?g|png|gif|webp|svg)$/i.test(path)) ||
    Object.keys(files).find((path) => /^docProps\/thumbnail\.(jpe?g|png|gif|webp)$/i.test(path))
  const cover = coverPath ? files[coverPath] : null

  const paragraphs = []
  for (const match of xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const text = [...match[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((item) => decodeEntities(item[1]))
      .join('')
      .trim()
    if (text) paragraphs.push(text)
  }
  if (!paragraphs.length) throw new Error('DOCX 里没有可读文字')

  let title = ''
  const core = files['docProps/core.xml']
  if (core) {
    const raw = strFromU8(core)
    title = decodeEntities(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(raw)?.[1] || '').trim()
  }

  const chapters = []
  let current = { title: title || '开始', lines: [] }
  for (const paragraph of paragraphs) {
    if (isChapterTitle(paragraph)) {
      if (current.lines.length) chapters.push(current)
      current = { title: normalizeChapterTitle(paragraph) || paragraph, lines: [] }
    } else {
      current.lines.push(paragraph)
    }
  }
  if (current.lines.length) chapters.push(current)

  return {
    title,
    cover,
    coverType: coverPath ? imageType(coverPath) : null,
    chapters: chapters.map((chapter, index) => ({
      title: chapter.title || `第${index + 1}章`,
      text: chapter.lines.join('\n'),
    })),
  }
}
