/**
 * 本地书籍的统一解析入口。
 *
 * 各个上传接口原本各写一份解析，书仓导入也需要同样的能力，这里收成一份：
 * 按扩展名选择 txt / epub / docx / mobi / pdf 的解析器，统一返回
 * `{ name, author, intro, cover, coverType, chapters:[{title,text}] }`。
 */

import { parseDocx } from './docx.js'
import { parseEpub } from './epub.js'
import { parseMobi } from './mobi.js'
import { extractPdfText } from './pdf.js'
import { isChapterTitle } from './chapter-title.js'

export function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('gbk').decode(buffer)
  }
}

/** 纯文本分章 */
export function splitTextChapters(text, fallbackTitle = '正文') {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  const chapters = []
  let current = { title: fallbackTitle, lines: [] }
  for (const line of lines) {
    if (isChapterTitle(line)) {
      if (current.lines.join('').trim()) chapters.push(current)
      current = { title: line.trim(), lines: [] }
    } else {
      current.lines.push(line)
    }
  }
  if (current.lines.join('').trim()) chapters.push(current)
  return chapters.map((chapter, index) => ({
    title: chapter.title || `第${index + 1}章`,
    text: chapter.lines.join('\n').trim(),
  }))
}

/**
 * 从 TXT/PDF 文件名和开头几行里识别书名、作者。
 * 支持：
 *   《黄金瞳》作者：打眼
 *   黄金瞳 作者：打眼
 *   书名：黄金瞳  作者：打眼
 *   黄金瞳.txt（只有书名）
 */
export function extractTextMetadata(filename, text) {
  const base = String(filename || '').replace(/\.[^.]+$/, '').trim()
  const head = String(text || '').slice(0, 8192)
  const candidates = [base, ...head.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 6)]

  const clean = (value) => String(value || '').replace(/^[《<【\s]+|[》>】\s]+$/g, '').trim()
  let name = clean(base)
  let author = ''

  for (const line of candidates) {
    let match = /^[《<【](.+?)[》>】]\s*(?:作者|著)\s*[:：]?\s*(.+)$/.exec(line)
    if (!match) match = /^书名\s*[:：]\s*(.+?)\s+作者\s*[:：]\s*(.+)$/.exec(line)
    if (!match) match = /^(.+?)\s+作者\s*[:：]\s*(.+)$/.exec(line)
    if (!match) match = /^[《<【](.+?)[》>】]\s*$/.exec(line)
    if (match) {
      name = clean(match[1])
      author = clean(match[2] || '').replace(/^作者\s*[:：]?/, '').replace(/\s*著$/, '')
      break
    }
  }

  return { name: name || clean(base) || '本地书籍', author }
}

/**
 * 按扩展名解析一个本地书籍文件。
 * @param {Buffer|Uint8Array} buffer
 * @param {string} filename
 */
export function parseLocalBook(buffer, filename) {
  const name = String(filename || '本地书籍')
  const ext = (name.split('.').pop() || '').toLowerCase()
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)

  if (ext === 'epub') {
    const parsed = parseEpub(bytes)
    return {
      name: parsed.title || name.replace(/\.epub$/i, ''),
      author: parsed.author || '',
      intro: parsed.intro || '',
      cover: parsed.cover,
      coverType: parsed.coverType,
      chapters: parsed.chapters,
      origin: 'local://epub',
    }
  }

  if (ext === 'docx') {
    const parsed = parseDocx(bytes)
    return {
      name: parsed.title || name.replace(/\.docx$/i, ''),
      author: '',
      intro: '',
      cover: parsed.cover,
      coverType: parsed.coverType,
      chapters: parsed.chapters,
      origin: 'local://docx',
    }
  }

  if (ext === 'mobi' || ext === 'azw' || ext === 'azw3') {
    const parsed = parseMobi(bytes)
    return {
      name: parsed.title || name.replace(/\.(mobi|azw3?)$/i, ''),
      author: parsed.author || '',
      intro: parsed.intro || '',
      cover: parsed.cover,
      coverType: parsed.coverType,
      chapters: parsed.chapters,
      origin: 'local://mobi',
    }
  }

  if (ext === 'pdf') {
    const text = extractPdfText(bytes)
    const meta = extractTextMetadata(name, text)
    return {
      name: meta.name,
      author: meta.author,
      intro: '',
      chapters: splitTextChapters(text, '正文'),
      origin: 'local://pdf',
    }
  }

  // 默认按纯文本处理（txt 或未知扩展名）
  const text = decodeText(bytes)
  const meta = extractTextMetadata(name, text)
  return {
    name: meta.name,
    author: meta.author,
    intro: '',
    chapters: splitTextChapters(text, '正文'),
    origin: 'local://txt',
  }
}
