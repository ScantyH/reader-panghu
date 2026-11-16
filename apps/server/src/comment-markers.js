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
 */

/**
 * 解析正文里的段评标记。
 * 标记里的 JSON 会带引号，属性边界不可靠，所以按 "dp:数字," 起、到标签结束止来切。
 */
export function extractDpMarkers(html) {
  const text = String(html || '')
  const markers = []
  const re = /dp:([0-9]+[+]?),([\s\S]{0,600}?)(?:\/>|>)/g
  let cursor = 0
  let paragraph = 0
  let match
  while ((match = re.exec(text))) {
    const between = text.slice(cursor, match.index)
    paragraph += (between.match(/\n/g) || []).length
    cursor = match.index + match[0].length
    const countText = String(match[1]).replace('+', '')
    const payload = match[2] || ''
    const urlMatch =
      /showCmt\(\s*'([^']+)'/.exec(payload) ||
      /showCmt\(\s*"([^"]+)"/.exec(payload) ||
      /(https?:\/\/[^\s"'\\]+)/.exec(payload)
    markers.push({
      paragraph,
      count: Number(countText) || 0,
      url: urlMatch ? urlMatch[1] : '',
      raw: match[0].slice(0, 240),
    })
  }
  return markers
}

/**
 * 提取评论卡片：起点源把「本章说 / 神评论 / 作者说」做成服务端图片，
 * 正文里就是普通 <img src="http…">，这里按出现顺序收集。
 */
export function extractCards(html) {
  const text = String(html || '')
  const cards = []
  const re = /<img[^>]*src="(https?:\/\/[^"]+)"[^>]*>/gi
  let cursor = 0
  let paragraph = 0
  let match
  while ((match = re.exec(text))) {
    paragraph += (text.slice(cursor, match.index).match(/\n/g) || []).length
    cursor = match.index + match[0].length
    const alt = /alt="([^"]*)"/i.exec(match[0])?.[1] || ''
    cards.push({ paragraph, src: match[1], alt })
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
