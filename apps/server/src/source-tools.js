/**
 * 书源工具：运行时选择 + 探索分类解析。
 */

import { createRuntime } from '@reader-panghu/source-runtime'
import { createRuleRuntime } from './rule-runtime.js'

const SOURCE_TIMEOUT_MS = Number(process.env.SOURCE_TIMEOUT_MS || 30000)

/** 把书源保存的线路地址注入 WebView 脚本，切线路后所有请求都走该地址 */
export function applySourceLine(source) {
  const line = source?._line
  const url = String(line?.url || '').trim().replace(/\/$/, '')
  if (!url || !source?.html) return source
  let html = String(source.html)
  html = html.replace(/var API\s*=\s*"[^"]*"/, `var API = "${url}"`)
  html = html.replace(/var API_DEFAULT\s*=\s*"[^"]*"/, `var API_DEFAULT = "${url}"`)
  return { ...source, html }
}

/** 统一构造运行时：有 html 走 WebView 运行时，否则走规则引擎 */
export function makeRuntime(source) {
  const effective = applySourceLine(source)
  if (effective.html) {
    const config = effective._runtime || {}
    return createRuntime(effective, {
      name: effective.bookSourceName,
      key: config.key || process.env.SOURCE_KEY || '',
      rewrites: config.rewrites || [],
      timeoutMs: config.timeoutMs || SOURCE_TIMEOUT_MS,
      headers: config.headers || {},
      baseUrl: effective.bookSourceUrl,
    })
  }
  return createRuleRuntime(effective, { timeoutMs: SOURCE_TIMEOUT_MS })
}

/**
 * 解析 exploreUrl。
 * Legado 两种写法：[{"title","url"}, …] 或 "标题::地址" 逐行。
 */
export function parseExploreKinds(exploreUrl) {
  const raw = String(exploreUrl || '').trim()
  if (!raw) return []

  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      return (Array.isArray(parsed) ? parsed : [])
        .filter((item) => item && item.title)
        .map((item) => ({ title: String(item.title), url: String(item.url || '') }))
    } catch {
      return []
    }
  }

  return raw
    .split(/[\n;]/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [title, url] = line.split(/::|\|/)
      return { title: (title || line).trim(), url: (url || '').trim() }
    })
    .filter((item) => item.url)
}
