/**
 * Legado（阅读 3.0）规则解析与求值。
 *
 * 规则形如 `class.bd@tag.tr!0`：`@` 左边是选择器链，右边是取值方式，
 * 末尾可接 `##正则` 做替换；多条规则用 `||` 兜底、`&&` 拼接。
 *
 * 支持的取值：text / textNodes / ownText / html / outerHtml / href / src /
 * content / 任意属性名。以 `$.` 或 `$[` 开头按 JSONPath 处理。
 *
 * 不支持：`@js:`（需要 JS 沙箱与 java.* API）、`@put:`/`@get:` 变量、
 * `<js>` 块。遇到时抛出明确错误，不猜测。
 */

import xpath from 'xpath'
import { hasJs, runSourceJs } from './js-sandbox.js'

/** 书源常用 (?i)(?m) 内联标志，JS 正则不支持，转成 flags。 */
function buildRegex(pattern) {
  let flags = 'g'
  let source = String(pattern ?? '')
  const inline = /^\(\?([imsu]+)\)/.exec(source)
  if (inline) {
    for (const ch of inline[1]) if (!flags.includes(ch)) flags += ch
    source = source.slice(inline[0].length)
  }
  try {
    return new RegExp(source, flags)
  } catch {
    return null
  }
}

function extractJs(text) {
  const block = /<js>([\s\S]*?)<\/js>/.exec(text)
  if (block) return block[1]
  const marker = text.indexOf('@js:')
  return marker >= 0 ? text.slice(marker + 4) : ''
}

function stripJs(text) {
  return text.replace(/<js>[\s\S]*?<\/js>/g, '').replace(/@js:[\s\S]*$/, '')
}

const INDEX = /([.!])(\d+)$/

/** 把 `class.bd` / `tag.tr!0` / `a.1` 拆成 {selector, index, exclude} */
function parseStep(step) {
  const raw = String(step).trim()
  if (!raw) return null
  const match = INDEX.exec(raw)
  const base = match ? raw.slice(0, match.index) : raw
  const index = match ? Number(match[2]) : null
  const exclude = match ? match[1] === '!' : false

  let selector
  if (base.startsWith('class.')) selector = '.' + base.slice(6).replace(/\s+/g, '.')
  else if (base.startsWith('id.')) selector = '#' + base.slice(3).trim()
  else if (base.startsWith('tag.')) selector = base.slice(4).trim()
  else selector = base

  return { selector, index, exclude }
}

/**
 * @param {string} rule
 * @returns {{kind: 'css'|'json'|'unsupported', steps?: any[], extract?: string, regex?: RegExp, replacement?: string, jsonPath?: string}}
 */
export function parseRule(rule) {
  const text = String(rule ?? '').trim()
  // 空规则是合法的：书源里封面/简介等可选字段常常留空
  if (!text) return { kind: 'empty' }
  if (hasJs(text)) return { kind: 'js', code: extractJs(text), prefix: stripJs(text) }
  if (text.startsWith('@put:')) return { kind: 'put', raw: text.slice(5) }
  if (text.startsWith('@get:')) return { kind: 'get', raw: text.slice(5) }
  if (text.startsWith('@js:')) return { kind: 'js', code: text.slice(4), prefix: '' }

  // XPath：@XPath://div… 或直接 //div…
  const xpathMatch = /^@XPath:(.*)$/s.exec(text) || (/^\/(\/)?/.test(text) ? [text, text] : null)
  if (xpathMatch) {
    let expr = xpathMatch[1].trim()
    let extract = 'text'
    let regex = null
    let replacement = ''
    const hashIndex = expr.indexOf('##')
    if (hashIndex >= 0) {
      const [pattern, replaceWith = ''] = expr.slice(hashIndex + 2).split('###')
      regex = buildRegex(pattern); replacement = replaceWith
      expr = expr.slice(0, hashIndex)
    }
    const tail = /@(text|href|src|html|content|attr\.[\w-]+)$/.exec(expr)
    if (tail) {
      extract = tail[1].startsWith('attr.') ? tail[1].slice(5) : tail[1]
      expr = expr.slice(0, tail.index)
    } else if (/\/text\(\)\s*$/.test(expr)) {
      extract = 'text'
      expr = expr.replace(/\/text\(\)\s*$/, '')
    }
    return { kind: 'xpath', expr: expr.trim().replace(/\/+$/, ''), extract, regex, replacement }
  }
  if (text.startsWith('$.') || text.startsWith('$[')) {
    return { kind: 'json', jsonPath: preprocessJsonPath(text) }
  }

  // ## 正则替换（### 之后是替换文本，默认空串）
  let body = text
  let regex = null
  let replacement = ''
  const hashIndex = body.indexOf('##')
  if (hashIndex >= 0) {
    const rest = body.slice(hashIndex + 2)
    const parts = rest.split('###')
    regex = buildRegex(parts[0])
    replacement = parts[1] ?? ''
    body = body.slice(0, hashIndex)
  }

  const segments = body.split('@').map((part) => part.trim()).filter(Boolean)
  if (!segments.length) {
    // 纯正则规则：整个规则只有 ##正则，作用于节点自身文本
    if (regex) return { kind: 'css', steps: [], extract: 'text', regex, replacement }
    return { kind: 'unsupported', reason: 'empty selector chain' }
  }

  let extract = 'text'
  const last = segments[segments.length - 1]
  // 最后一段若是取值关键字，则它是提取器
  if (/^(text|textNodes?|ownText|html|outerHtml|href|src|content|all)$/i.test(last)) {
    extract = last
    segments.pop()
  } else if (/^attr\.[\w-]+$/i.test(last)) {
    extract = last.slice(5)
    segments.pop()
  }

  const steps = segments.map(parseStep).filter(Boolean)
  if (!steps.length && extract === 'text') {
    // 纯取值规则（如 `text`）
    return { kind: 'css', steps: [], extract, regex, replacement }
  }
  return { kind: 'css', steps, extract, regex, replacement }
}

/** JSONPath 预处理：把 `$.a[*].b` 收敛成本项目支持的形式（数组通配 + 点号路径）。 */
function preprocessJsonPath(path) {
  return String(path).trim()
}

function jsonGet(data, path) {
  const clean = path.replace(/^\$\.?/, '')
  if (!clean) return data
  const parts = clean.split('.').filter(Boolean)
  let cursor = data
  for (const part of parts) {
    if (cursor == null) return undefined
    const arrayMatch = /^(\w*)\[(\*|\d+)\]$/.exec(part)
    if (arrayMatch) {
      const [, key, index] = arrayMatch
      const target = key ? cursor[key] : cursor
      if (!Array.isArray(target)) return undefined
      cursor = index === '*' ? target : target[Number(index)]
      continue
    }
    cursor = cursor[part]
  }
  return cursor
}

function elementText(node, mode) {
  if (mode === 'textNodes') {
    // Legado 的 textNodes 取所有后代文本节点（正文常在 <p>/<div> 里），按文档顺序换行拼接
    const out = []
    const walk = (current) => {
      for (const child of current.childNodes || []) {
        if (child.nodeType === 3) {
          const text = child.textContent.trim()
          if (text) out.push(text)
        } else if (child.nodeType === 1) {
          walk(child)
        }
      }
    }
    walk(node)
    return out.join('\n')
  }
  if (mode === 'ownText') {
    return [...node.childNodes]
      .filter((child) => child.nodeType === 3)
      .map((child) => child.textContent)
      .join('')
      .trim()
  }
  if (mode === 'html' || mode === 'outerHtml') return node.innerHTML ?? ''
  if (mode === 'href') return node.getAttribute?.('href') || node.href || ''
  if (mode === 'src') return node.getAttribute?.('src') || ''
  if (mode === 'content') return node.getAttribute?.('content') || ''
  if (mode === 'all') return node.textContent ?? ''
  return (node.textContent ?? '').trim()
}

/**
 * 把 `//div[@class="x"]` 改写成命名空间无关的 `//*[local-name()="div"][@class="x"]`。
 * jsdom 的 HTML 节点在 XHTML 命名空间下，直接写 //div 匹配不到。
 */
function namespaceAgnostic(expr) {
  const out = []
  let index = 0
  let stepStart = true
  while (index < expr.length) {
    const ch = expr[index]
    if (ch === '/' || ch === '|') {
      out.push(ch)
      index += 1
      stepStart = true
      continue
    }
    if (stepStart && /[A-Za-z_]/.test(ch)) {
      let name = ''
      while (index < expr.length && /[A-Za-z0-9_.-]/.test(expr[index])) {
        name += expr[index]
        index += 1
      }
      // 函数调用（text()、local-name() 等）保持原样
      if (expr[index] === '(') {
        out.push(name)
        stepStart = false
        continue
      }
      out.push(`*[local-name()="${name}"]`)
      stepStart = false
      continue
    }
    out.push(ch)
    index += 1
    if (ch === ']') stepStart = false
    if (/s/.test(ch)) stepStart = false
  }
  return out.join('')
}

/** 在节点上执行 XPath 规则 */
function applyXPath(node, parsed) {
  let hits
  try {
    hits = xpath.select(namespaceAgnostic(parsed.expr), node) || []
  } catch {
    return ''
  }
  const values = hits
    .map((hit) => {
      if (hit && typeof hit === 'object' && 'nodeType' in hit) return elementText(hit, parsed.extract)
      return String(hit ?? '').trim()
    })
    .filter(Boolean)
  return parsed.extract === 'text' ? values.join('\n').trim() : (values[0] ?? '').trim()
}

/** 在 document 上执行一条 css 规则 */
function applyCss(doc, parsed) {
  let candidates = [doc]
  for (const step of parsed.steps) {
    const next = []
    for (const node of candidates) {
      let found
      try {
        found = [...(node.querySelectorAll ? node.querySelectorAll(step.selector) : [])]
      } catch {
        found = []
      }
      if (step.index !== null) {
        if (step.exclude) found = found.filter((_, index) => index !== step.index)
        else found = found.slice(step.index, step.index + 1)
      }
      next.push(...found)
    }
    candidates = next
    if (!candidates.length) break
  }
  const values = candidates.map((node) => elementText(node, parsed.extract)).filter((value) => value !== '')
  return parsed.extract === 'text' || parsed.extract === 'textNodes' ? values.join('\n').trim() : (values[0] ?? '').trim()
}

/**
 * 执行完整规则（含 `||` 兜底与 `&&` 拼接）。
 * @param {object} options
 * @param {Document} [options.doc]  HTML 文档
 * @param {unknown}  [options.json] JSON 数据
 * @param {string}   options.rule   规则文本
 * @returns {string}
 */
export function evaluateRule({ doc, json, rule, context }) {
  const alternatives = String(rule ?? '').split('||')
  for (const alternative of alternatives) {
    const parts = alternative.split('&&')
    const values = []
    for (const part of parts) {
      const parsed = parseRule(part)
      let value = ''
      if (parsed.kind === 'js') {
        const base = parsed.prefix ? evaluateRule({ doc, json, rule: parsed.prefix, context }) : (context?.lastValue ?? '')
        value = runSourceJs(parsed.code, {
          result: base,
          baseUrl: context?.baseUrl || '',
          vars: context?.vars || {},
          book: context?.book || null,
        })
        values.push(String(value).trim())
        continue
      }
      if (parsed.kind === 'get') {
        value = (context?.vars || {})[parsed.raw.replace(/[{}]/g, '').trim()] ?? ''
        values.push(String(value).trim())
        continue
      }
      if (parsed.kind === 'put') {
        const body = parsed.raw.trim()
        const match = /^\{([^:}]+):([\s\S]*)\}$/.exec(body)
        if (match && context?.vars) {
          const inner = evaluateRule({ doc, json, rule: match[2], context })
          context.vars[match[1].trim()] = inner
        }
        values.push('')
        continue
      }
      if (parsed.kind === 'empty') {
        values.push('')
        continue
      }
      if (parsed.kind === 'json') {
        value = jsonGet(json, parsed.jsonPath)
      } else if (parsed.kind === 'xpath') {
        value = doc ? applyXPath(doc, parsed) : ''
      } else if (parsed.kind === 'css') {
        value = doc ? applyCss(doc, parsed) : ''
      } else {
        throw new Error(parsed.reason)
      }
      if (value == null) value = ''
      if (parsed.regex) value = String(value).replace(parsed.regex, parsed.replacement)
      values.push(String(value).trim())
    }
    const joined = values.join('').trim()
    if (joined) return joined
  }
  return ''
}

/**
 * 返回规则命中的节点数组（用于 bookList / chapterList 这类"列表"规则）。
 * JSON 规则返回数组元素；CSS 规则返回 DOM 节点。
 */
export function queryNodes({ doc, json, rule }) {
  const alternatives = String(rule ?? '').split('||')
  for (const alternative of alternatives) {
    const first = alternative.split('&&')[0]
    const parsed = parseRule(first)
    if (parsed.kind === 'empty') continue
    if (parsed.kind === 'xpath') {
      try {
        const hits = (xpath.select(namespaceAgnostic(parsed.expr), doc) || []).filter((hit) => hit && 'nodeType' in hit)
        if (hits.length) return hits
      } catch {
        /* 落到下一条 */
      }
      continue
    }
    if (parsed.kind === 'json') {
      const value = jsonGet(json, parsed.jsonPath)
      if (Array.isArray(value)) return value
      if (value && typeof value === 'object') return [value]
      continue
    }
    if (parsed.kind !== 'css' || !doc) continue

    let candidates = [doc]
    for (const step of parsed.steps) {
      const next = []
      for (const node of candidates) {
        let found = []
        try {
          found = [...(node.querySelectorAll ? node.querySelectorAll(step.selector) : [])]
        } catch {
          found = []
        }
        if (step.index !== null) {
          found = step.exclude ? found.filter((_, index) => index !== step.index) : found.slice(step.index, step.index + 1)
        }
        next.push(...found)
      }
      candidates = next
    }
    if (candidates.length) return candidates
  }
  return []
}

export const __test__ = { parseStep, jsonGet, elementText }
