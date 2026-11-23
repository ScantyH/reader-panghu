/**
 * 书源返回的封面地址可能是相对路径、协议相对地址或带 HTML 实体的地址。
 * 浏览器只接受绝对地址，统一在这里补全；data:/blob: 原样保留。
 */
export function resolveCoverUrl(value, ...bases) {
  let raw = String(value ?? '').trim()
  if (!raw) return ''
  raw = raw.replace(/&amp;/gi, '&')
  if (/^(data:|blob:)/i.test(raw)) return raw
  if (raw.startsWith('//')) return `https:${raw}`
  if (/^https?:\/\//i.test(raw)) return raw
  for (const base of bases) {
    const candidate = String(base ?? '').trim()
    if (!/^https?:\/\//i.test(candidate)) continue
    try {
      return new URL(raw, candidate).href
    } catch {
      /* try next base */
    }
  }
  return raw
}
