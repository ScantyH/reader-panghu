/**
 * RSS / Atom 解析。
 *
 * 不引依赖：订阅源的两种主流格式用正则取字段足够，且能容忍命名空间前缀。
 * 解析失败宁可返回空列表，也不要把半截 XML 当成文章标题。
 */

const decodeEntities = (text) =>
  String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

const stripTags = (html) =>
  decodeEntities(String(html).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

const pick = (block, names) => {
  for (const name of names) {
    const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block)
    if (match) return match[1]
  }
  return ''
}

const pickAttr = (block, tag, attr) => {
  const match = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`, 'i').exec(block)
  return match ? match[1] : ''
}

/**
 * @param {string} xml
 * @returns {{title: string, items: {title: string, link: string, description: string, pubDate: string}[]}}
 */
export function parseFeed(xml) {
  const text = String(xml || '')
  const channelTitle = stripTags(pick(text, ['title'])) || '未命名订阅'

  // RSS: <item>；Atom: <entry>
  const blocks = [...text.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((match) => match[0])
  const items = blocks.map((block) => {
    let link = stripTags(pick(block, ['link']))
    if (!link) link = pickAttr(block, 'link', 'href')
    const description = pick(block, ['description', 'summary', 'content'])
    return {
      title: stripTags(pick(block, ['title'])) || '(无标题)',
      link,
      description: stripTags(description),
      pubDate: stripTags(pick(block, ['pubDate', 'updated', 'published'])),
    }
  })

  return { title: channelTitle, items }
}
