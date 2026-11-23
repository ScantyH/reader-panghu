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

function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function attrValue(tag, name) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return match ? (match[2] ?? match[3] ?? '') : ''
}

function dirOf(path) {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
}

function mimeFromPath(path) {
  const ext = String(path).split('.').pop().toLowerCase()
  return (
    {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
    }[ext] || 'image/jpeg'
  )
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
  const opfPathRaw = /full-path\s*=\s*("([^"]+)"|'([^']+)')/i.exec(container)
  const opfPath = safeDecode(opfPathRaw?.[2] ?? opfPathRaw?.[3] ?? '')
  if (!opfPath) throw new Error('EPUB 缺少 META-INF/container.xml 或 OPF 路径')
  const opf = readText(opfPath)
  if (!opf) throw new Error(`EPUB 缺少 OPF：${opfPath}`)
  const base = dirOf(opfPath)

  /** @type {Record<string, {id: string, href: string, type: string, properties: string}>} */
  const manifest = {}
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = match[0]
    const id = attrValue(tag, 'id')
    const href = attrValue(tag, 'href')
    const type = attrValue(tag, 'media-type')
    const properties = attrValue(tag, 'properties')
    if (id && href) manifest[id] = { id, href: resolvePath(base, safeDecode(href)), type, properties }
  }

  const spine = [...opf.matchAll(/<itemref\b[^>]*>/gi)]
    .map((match) => attrValue(match[0], 'idref'))
    .filter(Boolean)
  const spineTocId = (() => {
    const spineTag = /<spine\b[^>]*>/i.exec(opf)?.[0]
    return spineTag ? attrValue(spineTag, 'toc') : ''
  })()

  const metaTag = (name) => {
    const match = new RegExp(`<dc:${name}[^>]*>([\\s\\S]*?)</dc:${name}>`, 'i').exec(opf)
    return match ? stripTags(match[1]) : ''
  }
  const title = metaTag('title')
  const author = metaTag('creator')
  const intro = htmlToText(metaTag('description'))

  // EPUB3 nav / EPUB2 NCX → document href -> chapter title
  const tocTitles = new Map()
  const addTocTitle = (rawHref, rawTitle, basePath) => {
    const href = resolvePath(basePath, safeDecode(String(rawHref || '')))
    const label = stripTags(rawTitle || '')
    if (!href || !label) return
    const key = href.split('#')[0]
    if (!tocTitles.has(key)) tocTitles.set(key, label)
  }

  const navItem = Object.values(manifest).find((item) => /(^|\s)nav(\s|$)/i.test(item.properties))
  const navHtml = navItem ? readText(navItem.href) : null
  if (navHtml) {
    const navBlock =
      /<nav\b[^>]*(?:epub:type|role)\s*=\s*["'][^"']*toc[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i.exec(navHtml)?.[1] ||
      /<nav\b[^>]*>([\s\S]*?)<\/nav>/i.exec(navHtml)?.[1] ||
      navHtml
    for (const match of navBlock.matchAll(/<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)) {
      addTocTitle(match[2] ?? match[3] ?? '', match[4], dirOf(navItem.href))
    }
  }

  const ncxItem = (spineTocId && manifest[spineTocId]) || Object.values(manifest).find((item) => /x-dtbncx/i.test(item.type))
  const ncx = ncxItem ? readText(ncxItem.href) : null
  if (ncx) {
    for (const match of ncx.matchAll(/<navPoint\b[\s\S]*?<\/navPoint>/gi)) {
      const block = match[0]
      const src = /<content\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(block)
      const label = /<text\b[^>]*>([\s\S]*?)<\/text>/i.exec(block)
      if (src) addTocTitle(src[2] ?? src[3] ?? '', label?.[1] || '', dirOf(ncxItem.href))
    }
  }

  // Cover: EPUB3 cover-image, EPUB2 meta name=cover, guide reference, then filename fallback.
  let coverItem = Object.values(manifest).find(
    (item) => /(^|\s)cover-image(\s|$)/i.test(item.properties) && /^image\//i.test(item.type),
  )
  if (!coverItem) {
    const coverId = (() => {
      for (const meta of opf.matchAll(/<meta\b[^>]*>/gi)) {
        if (/\bname\s*=\s*["']cover["']/i.test(meta[0])) return attrValue(meta[0], 'content')
      }
      return ''
    })()
    if (coverId && manifest[coverId]) coverItem = manifest[coverId]
  }
  if (!coverItem) {
    let guideHref = ''
    for (const ref of opf.matchAll(/<reference\b[^>]*>/gi)) {
      if (/\btype\s*=\s*["']cover["']/i.test(ref[0])) {
        guideHref = attrValue(ref[0], 'href')
        break
      }
    }
    if (guideHref) {
      const guidePath = resolvePath(base, safeDecode(guideHref))
      const guideHtml = readText(guidePath)
      if (guideHtml) {
        const img = /<img\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(guideHtml)
        const src = img?.[2] ?? img?.[3] ?? ''
        if (src) {
          const imagePath = resolvePath(dirOf(guidePath), safeDecode(src))
          coverItem = { id: '', href: imagePath, type: mimeFromPath(imagePath), properties: '' }
        }
      } else if (files[guidePath]) {
        coverItem = { id: '', href: guidePath, type: mimeFromPath(guidePath), properties: '' }
      }
    }
  }
  if (!coverItem) {
    coverItem = Object.values(manifest).find(
      (item) => /^image\//i.test(item.type) && (/cover/i.test(item.id) || /cover/i.test(item.href)),
    )
  }

  let cover = null
  let coverType = null
  if (coverItem) {
    if (files[coverItem.href]) {
      cover = files[coverItem.href]
      coverType = coverItem.type || mimeFromPath(coverItem.href)
    } else {
      const page = readText(coverItem.href)
      const img = page ? /<img\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(page) : null
      const src = img?.[2] ?? img?.[3] ?? ''
      if (src) {
        const imagePath = resolvePath(dirOf(coverItem.href), safeDecode(src))
        if (files[imagePath]) {
          cover = files[imagePath]
          coverType = mimeFromPath(imagePath)
        }
      }
    }
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
      title: tocTitles.get(item.href.split('#')[0]) || stripTags(heading || '') || `第${chapters.length + 1}章`,
      text,
    })
  }

  return { title: title || '未命名', author, intro, cover, coverType, chapters }
}

export { escapeHtml }
