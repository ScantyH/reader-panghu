/**
 * 轻悦 / 时光 规则里的"展示层"语法处理。
 *
 * 规格摘录（docs/qingyue-source-rules.md）：
 * - `@html:` 前缀表示简介是 HTML，需要按 HTML 渲染
 * - `<button>按钮名 @onclick:要执行的js</button>` 表示可点击按钮
 * - 正文里 `<img src="...">` 是图片，与文字同行的图片是段评
 *
 * 服务端没有 WebView 渲染能力，所以这里把 HTML 收敛成可读纯文本：
 * 保留文字、按钮标题、图片占位，丢掉样式与交互。
 */

const ENTITIES = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

const decodeEntities = (text) =>
  String(text).replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (match) => ENTITIES[match] ?? match)

/** 把带 @onclick 的按钮降级成纯文字标签 */
const flattenButtons = (html) =>
  String(html).replace(/<button[^>]*>([\s\S]*?)<\/button>/gi, (_match, inner) =>
    String(inner).replace(/@onclick:[\s\S]*$/i, '').trim(),
  )

/** HTML 片段 → 纯文本（保留换行语义） */
export function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/\r\n?/g, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<img[^>]*>/gi, '')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 书源返回的简介/正文片段 → 可读文本。
 * 同时处理 `@html:` 前缀与内嵌按钮。
 */
export function sourceTextToPlain(value) {
  let text = String(value ?? '')
  if (!text) return ''
  if (/^@html:/i.test(text)) text = text.replace(/^@html:\s*/i, '')
  text = flattenButtons(text)
  // 只有确实含标签时才走 HTML 收敛，避免把普通文本里的 < > 吃掉
  if (/<[a-z][\s\S]*>/i.test(text)) text = htmlToText(text)
  return decodeEntities(text).trim()
}

/** 正文里的非段评图片：取出地址并留下占位，交给前端决定怎么展示 */
export function extractContentImages(html) {
  const images = []
  const cleaned = String(html ?? '').replace(/<img[^>]*src="([^"]+)"[^>]*>/gi, (match, src) => {
    if (/^dp:/i.test(src)) return match // 段评图片由 dp 解析负责
    const url = src.split(',{')[0].trim()
    if (!/^https?:\/\//i.test(url) && !/^data:image\//i.test(url)) return match
    images.push(url)
    return '\n[图片]\n'
  })
  return { text: cleaned, images }
}
