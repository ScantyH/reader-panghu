/**
 * 起点书源的段评 / 本章说 / 神评论。
 *
 * 起点的正文用「图片占位」承载段评，形如：
 *   <img src="dp:69,{"js":"showCmt('https://…/comments/summary?god=1')"}"/>
 * 数字是段评条数，js 里带的是评论接口地址。
 *
 * 这里做两件事：
 *   1. 解析成结构化数据（段落序号、条数、接口地址），正文清洗时再丢掉图片
 *   2. 按接口地址拉评论内容；接口通常要起点登录态，拿不到时如实返回错误
 *
 * 段落序号必须和前端渲染的段落一致：不能按原始 HTML 的换行数数，
 * 因为原始 HTML 里 <p>、空行、段评图片都会各占一行。做法是先把段评图片
 * 换成哨兵标记，再用和正文相同的 cleanText 流程清洗，最后按清洗后的
 * 非空行定位；出现在第一行正文之前的标记归到「章节名」（-1）。
 */

import { cleanText } from './text.js'

const SENTINEL_RE = /\u0001DP(\d+)\u0001/g
const sentinel = (index) => `\u0001DP${index}\u0001`
const IMAGE_TAG_RE = /<img\b[^>]*>/gi

/**
 * 解析正文里的段评标记。
 * 标记里的 JSON 会带引号，属性边界不可靠，所以按 "dp:数字," 起、到标签结束止来切。
 */
export function extractDpMarkers(html, { transform } = {}) {
  const text = String(html || '')
  const rawMarkers = []
  const dpTags = []
  let match
  IMAGE_TAG_RE.lastIndex = 0
  while ((match = IMAGE_TAG_RE.exec(text))) {
    const tag = match[0]
    const srcMatch = /src\s*=\s*"\s*(dp:[^"]*)/i.exec(tag) || /src\s*=\s*'\s*(dp:[^']*)/i.exec(tag)
    if (!srcMatch) continue
    const countText = String(/^dp:([0-9]+[+]?),/.exec(srcMatch[1])?.[1] || '').replace('+', '')
    const urlMatch =
      /showCmt\(\s*'([^']+)'/.exec(tag) ||
      /showCmt\(\s*"([^"]+)"/.exec(tag) ||
      /(https?:\/\/[^\s"'\\]+)/.exec(tag)
    dpTags.push({ index: match.index, length: tag.length })
    rawMarkers.push({
      count: Number(countText) || 0,
      url: urlMatch ? urlMatch[1] : '',
      raw: tag.slice(0, 240),
    })
  }
  if (!rawMarkers.length) return []

  // 用哨兵替换段评图片，再走和正文一样的清洗流程，保证行结构与正文一致。
  let marked = ''
  let cursor = 0
  let seq = 0
  for (const tag of dpTags) {
    marked += text.slice(cursor, tag.index) + sentinel(seq++)
    cursor = tag.index + tag.length
  }
  marked += text.slice(cursor)

  let cleaned = cleanText(marked, { dropImages: true })
  if (typeof transform === 'function') cleaned = String(transform(cleaned))

  const lines = cleaned
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)

  const markers = []
  let paragraph = -1
  for (const line of lines) {
    const ids = [...line.matchAll(SENTINEL_RE)].map((item) => Number(item[1]))
    if (!ids.length) {
      paragraph += 1
      continue
    }
    const textOnly = line.replace(SENTINEL_RE, '').trim()
    if (textOnly) paragraph += 1
    // 只有标记、没有正文的行：开头的归章节名，夹在中间的归上一段。
    const target = paragraph < 0 ? -1 : paragraph
    for (const id of ids) {
      const marker = rawMarkers[id]
      if (marker) markers.push({ ...marker, paragraph: target })
    }
  }
  return markers
}

const CARD_SENTINEL_RE = /\u0002CARD(\d+)\u0002/g

const parseLooseJson = (raw) => {
  try {
    return JSON.parse(raw)
  } catch {
    /* 书源里的 json 常用单引号，继续尝试 */
  }
  try {
    return JSON.parse(String(raw).replace(/'/g, '"'))
  } catch {
    return null
  }
}

/**
 * 提取正文里的普通图片（神评论 / 本章说 / 插图等卡片）。
 * 段落序号按清洗后的正文行对齐；行内图片跟随所在段落，独占一行的图片归到上一段。
 */
export function extractCards(html) {
  const text = String(html || '')
  const entries = []
  IMAGE_TAG_RE.lastIndex = 0
  let match
  while ((match = IMAGE_TAG_RE.exec(text))) {
    const tag = match[0]
    const srcMatch = /src\s*=\s*"([\s\S]*?)"/i.exec(tag) || /src\s*=\s*'([\s\S]*?)'/i.exec(tag)
    if (!srcMatch) continue
    let src = srcMatch[1].trim()
    if (!src || /^dp:/i.test(src)) continue
    let headers = {}
    const jsonMatch = /^(.*),\s*(\{[\s\S]*\})\s*$/.exec(src)
    if (jsonMatch) {
      src = jsonMatch[1].trim()
      const meta = parseLooseJson(jsonMatch[2])
      if (meta && meta.headers && typeof meta.headers === 'object') headers = meta.headers
    }
    if (!src) continue
    const alt = /alt\s*=\s*"([^"]*)"/i.exec(tag)?.[1] || ''
    entries.push({ index: match.index, length: tag.length, src, alt, headers })
  }
  if (!entries.length) return []

  let marked = ''
  let cursor = 0
  let seq = 0
  for (const entry of entries) {
    marked += text.slice(cursor, entry.index) + `\u0002CARD${seq++}\u0002`
    cursor = entry.index + entry.length
  }
  marked += text.slice(cursor)

  const cleaned = cleanText(marked, { dropImages: true })
  const lines = cleaned
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)

  const cards = []
  let paragraph = -1
  for (const line of lines) {
    const ids = [...line.matchAll(CARD_SENTINEL_RE)].map((item) => Number(item[1]))
    if (!ids.length) {
      paragraph += 1
      continue
    }
    const textOnly = line.replace(CARD_SENTINEL_RE, '').trim()
    if (textOnly) paragraph += 1
    const target = paragraph < 0 ? -1 : paragraph
    for (const id of ids) {
      const entry = entries[id]
      if (entry) cards.push({ paragraph: target, src: entry.src, alt: entry.alt, headers: entry.headers })
    }
  }
  return cards
}

/** 去掉正文里的段评图片占位 */
export function stripDpMarkers(html) {
  return String(html || '').replace(/<img[^>]*src="\s*dp:[^>]*>/gi, '')
}

/** 抓取一个段评接口（需要起点登录态时通常拿不到） */
export async function fetchComments(url, { timeoutMs = 15000 } = {}) {
  if (!url) return { ok: false, error: '没有评论地址' }
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        accept: 'application/json, text/plain, */*',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return { ok: false, error: `接口返回 HTTP ${response.status}` }
    const text = await response.text()
    try {
      return { ok: true, data: JSON.parse(text) }
    } catch {
      return { ok: false, error: '返回的不是 JSON（多半需要登录态）', preview: text.slice(0, 300) }
    }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}
