/**
 * Minimal EPUB reader.
 *
 * An EPUB is a ZIP with an OPF package document: metadata (title/author/intro),
 * a manifest of resources, and a spine that fixes reading order. We only need
 * the spine documents as chapters plus a cover image, so this avoids a full
 * EPUB engine while staying correct for ordinary books.
 */

import { strFromU8, unzipSync } from 'fflate'

const escapeHtml = (text) => text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/** HTML fragment → plain text with paragraph breaks preserved. */
export function htmlToText(html) {
  const body = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(body)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, '')).trim()
}

function resolvePath(base, href) {
  if (!href) return ''
  if (href.startsWith('/')) return href.slice(1)
  const parts = `${base}${href}`.split('/')
  const out = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

/**
 * @param {Uint8Array} bytes
 * @returns {{title: string, author: string, intro: string, cover: Uint8Array|null, coverType: string|null, chapters: {title: string, text: string}[]}}
 */
export function parseEpub(bytes) {
  const files = unzipSync(bytes)
  const readText = (path) => {
    const file = files[path]
    return file ? strFromU8(file) : null
  }

  const container = readText('META-INF/container.xml') || ''
  const opfPath = /full-path="([^"]+)"/i.exec(container)?.[1]
  if (!opfPath) throw new Error('EPUB 缺少 META-INF/container.xml 或 OPF 路径')
  const opf = readText(opfPath)
  if (!opf) throw new Error(`EPUB 缺少 OPF：${opfPath}`)
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''

  /** @type {Record<string, {href: string, type: string}>} */
  const manifest = {}
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = /\bid="([^"]+)"/i.exec(match[0])?.[1]
    const href = /\bhref="([^"]+)"/i.exec(match[0])?.[1]
    const type = /\bmedia-type="([^"]+)"/i.exec(match[0])?.[1] || ''
    if (id && href) manifest[id] = { href: resolvePath(base, decodeURIComponent(href)), type }
  }

  const spine = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/gi)].map((match) => match[1])

  const metaTag = (name) => {
    const match = new RegExp(`<dc:${name}[^>]*>([\\s\\S]*?)</dc:${name}>`, 'i').exec(opf)
    return match ? stripTags(match[1]) : ''
  }
  const title = metaTag('title')
  const author = metaTag('creator')
  const intro = htmlToText(metaTag('description'))

  let cover = null
  let coverType = null
  const coverId = /<meta\b[^>]*\bname="cover"[^>]*\bcontent="([^"]+)"/i.exec(opf)?.[1]
  const coverItem = (coverId && manifest[coverId]) || Object.values(manifest).find((item) => /cover/i.test(item.href) && item.type.startsWith('image/'))
  if (coverItem && files[coverItem.href]) {
    cover = files[coverItem.href]
    coverType = coverItem.type || 'image/jpeg'
  }

  const chapters = []
  for (const idref of spine) {
    const item = manifest[idref]
    if (!item) continue
    const html = readText(item.href)
    if (!html) continue
    const text = htmlToText(html)
    if (text.length < 2) continue
    const heading = /<h[1-2][^>]*>([\s\S]*?)<\/h[1-2]>/i.exec(html)?.[1]
    chapters.push({
      title: stripTags(heading || '') || `第${chapters.length + 1}节`,
      text,
    })
  }

  return { title: title || '未命名', author, intro, cover, coverType, chapters }
}

export { escapeHtml }
