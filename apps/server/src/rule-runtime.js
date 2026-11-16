/**
 * 规则型（阅读 3.0）书源的运行时。
 *
 * 对外暴露与 WebView 运行时一致的接口（search / info / chapter / content），
 * 这样 /reader3 与 /api 两条链路都不用关心书源是哪一种。
 *
 * 覆盖：CSS 选择器链、JSONPath、`||` 兜底、`&&` 拼接、`##正则` 替换、
 * searchUrl 的 `{{key}}`/`{{page}}` 占位与 `,{json}` 选项（charset / method / body / headers）。
 * 不覆盖：`@js:` 等 JS 规则、登录态与验证码（遇到会明确报错）。
 */

import { JSDOM, VirtualConsole } from 'jsdom'
import { evaluateRule, queryNodes } from './legado-rule.js'

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function decodeBody(buffer, charset) {
  const label = String(charset || 'utf-8').toLowerCase()
  const normalized = label === 'gbk' || label === 'gb2312' ? 'gbk' : label
  try {
    return new TextDecoder(normalized).decode(buffer)
  } catch {
    return new TextDecoder('utf-8').decode(buffer)
  }
}

/** 拆开 `url,{options}` 形式的 searchUrl */
function splitUrlOptions(raw) {
  const text = String(raw ?? '').trim()
  const index = text.search(/,\s*\{/)
  if (index < 0) return { url: text, options: {} }
  const url = text.slice(0, index).trim()
  try {
    return { url, options: JSON.parse(text.slice(index + 1)) }
  } catch {
    return { url, options: {} }
  }
}

export class RuleSourceRuntime {
  constructor(source, { timeoutMs = 30000, userAgent = DEFAULT_UA } = {}) {
    if (!source?.bookSourceUrl) throw new Error('规则型书源缺少 bookSourceUrl')
    this.source = source
    this.name = source.bookSourceName || source.bookSourceUrl
    this.baseUrl = String(source.bookSourceUrl).replace(/\/+$/, '')
    this.timeoutMs = timeoutMs
    this.userAgent = userAgent
    this.origin = ''
  }

  /** 与 WebView 运行时保持同名接口 */
  async init() {
    return this
  }

  dispose() {}

  async #fetch(url, options = {}) {
    const headers = { 'user-agent': this.userAgent }
    if (options.headers) {
      try {
        Object.assign(headers, typeof options.headers === 'string' ? JSON.parse(options.headers) : options.headers)
      } catch {
        /* 忽略坏 header */
      }
    }
    const init = { method: options.method || 'GET', headers, redirect: 'follow' }
    if (options.body) {
      init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
      headers['content-type'] = headers['content-type'] || 'application/x-www-form-urlencoded'
    }
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) })
    if (!response.ok) throw new Error(`HTTP ${response.status}：${url}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    this.origin = new URL(url).origin
    return decodeBody(buffer, options.charset)
  }

  #absolute(url) {
    const value = String(url ?? '').trim()
    if (!value) return ''
    if (/^https?:\/\//i.test(value)) return value
    try {
      return new URL(value, this.origin || this.baseUrl).toString()
    } catch {
      return value
    }
  }

  #dom(html) {
    const virtualConsole = new VirtualConsole()
    return new JSDOM(html, { url: this.origin || this.baseUrl, virtualConsole }).window.document
  }

  #evaluate({ doc, json, rule, label }) {
    try {
      return evaluateRule({ doc, json, rule })
    } catch (error) {
      throw new Error(`${this.name} 的${label}规则不可用：${error.message}`)
    }
  }

  async search(keyword, page = 1) {
    const { url, options } = splitUrlOptions(this.source.searchUrl)
    if (!url) throw new Error(`${this.name} 没有 searchUrl`)
    const target = url.split('{{key}}').join(encodeURIComponent(keyword)).split('{{page}}').join(String(page))
    const html = await this.#fetch(this.#absolute(target), options)
    const doc = this.#dom(html)

    const nodes = queryNodes({ doc, rule: this.source.ruleSearch?.bookList })
    if (!nodes.length) return []

    const rule = this.source.ruleSearch || {}
    return nodes
      .map((node) => {
        const book = {
          name: this.#evaluate({ doc: node, rule: rule.name, label: '书名' }),
          author: this.#evaluate({ doc: node, rule: rule.author, label: '作者' }),
          bookUrl: this.#absolute(this.#evaluate({ doc: node, rule: rule.bookUrl, label: '书籍地址' })),
          coverUrl: this.#absolute(this.#evaluate({ doc: node, rule: rule.coverUrl, label: '封面' })),
          intro: this.#evaluate({ doc: node, rule: rule.intro, label: '简介' }),
          kind: this.#evaluate({ doc: node, rule: rule.kind, label: '分类' }),
          latestChapterTitle: this.#evaluate({ doc: node, rule: rule.lastChapter, label: '最新章节' }),
          wordCount: this.#evaluate({ doc: node, rule: rule.wordCount, label: '字数' }),
          tocUrl: '',
          type: 0,
        }
        return book
      })
      .filter((book) => book.name && book.bookUrl)
  }

  async info(bookUrl) {
    const html = await this.#fetch(this.#absolute(bookUrl))
    const doc = this.#dom(html)
    const rule = this.source.ruleBookInfo || {}
    const name = this.#evaluate({ doc, rule: rule.name, label: '书名' })
    const tocUrl = this.#absolute(
      this.#evaluate({ doc, rule: rule.tocUrl, label: '目录地址' }) || bookUrl,
    )
    return {
      name,
      author: this.#evaluate({ doc, rule: rule.author, label: '作者' }),
      kind: this.#evaluate({ doc, rule: rule.kind, label: '分类' }),
      intro: this.#evaluate({ doc, rule: rule.intro, label: '简介' }),
      coverUrl: this.#absolute(this.#evaluate({ doc, rule: rule.coverUrl, label: '封面' })),
      wordCount: this.#evaluate({ doc, rule: rule.wordCount, label: '字数' }),
      latestChapterTitle: this.#evaluate({ doc, rule: rule.lastChapter, label: '最新章节' }),
      bookUrl: this.#absolute(bookUrl),
      tocUrl,
      type: 0,
    }
  }

  async chapter(tocUrl) {
    const html = await this.#fetch(this.#absolute(tocUrl))
    const doc = this.#dom(html)
    const rule = this.source.ruleToc || {}
    const nodes = queryNodes({ doc, rule: rule.chapterList })
    return nodes
      .map((node, index) => ({
        name: this.#evaluate({ doc: node, rule: rule.chapterName, label: '章节名' }),
        chapterId: this.#absolute(this.#evaluate({ doc: node, rule: rule.chapterUrl, label: '章节地址' })),
        index,
        isVip: false,
        isPay: false,
        isVolume: false,
        tag: '',
      }))
      .filter((chapter) => chapter.name && chapter.chapterId)
  }

  async content(chapterUrl) {
    const html = await this.#fetch(this.#absolute(chapterUrl))
    const doc = this.#dom(html)
    const rule = this.source.ruleContent || {}
    const text = this.#evaluate({ doc, rule: rule.content, label: '正文' })
    if (!text) throw new Error(`${this.name} 的正文规则没有取到内容`)
    return text
  }

  finds() {
    return []
  }
}

export function createRuleRuntime(source, options) {
  return new RuleSourceRuntime(source, options)
}
