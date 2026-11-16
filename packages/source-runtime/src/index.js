/**
 * Server-side runtime for "WebView book sources".
 *
 * A WebView book source is distributed as a Legado-style JSON entry whose `html`
 * field carries a whole HTML document. Inside that document the source script
 * implements `search / info / chapter / content / getfinds / find` on top of a
 * browser bridge named `flutter_inappwebview.callHandler`. Clients that embed a
 * real WebView (轻悦时光 / qysg, Flutter Legado forks) can run it; a plain HTTP
 * server cannot — there is no `window`, no DOM, no bridge.
 *
 * This module supplies all three: a jsdom document, jQuery, and a Node
 * implementation of the bridge (`http`, `cookie.*`, `cache.*`, `log`, ...), so an
 * unchanged source bundle can be executed on the server and answer
 * search/detail/toc/content requests over plain HTTP.
 *
 * The book-source API surface (methods, arguments, return shapes) follows the
 * contract documented by the 轻悦时光 / qysg project.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { JSDOM, VirtualConsole } from 'jsdom'

const require = createRequire(import.meta.url)
const JQUERY_SOURCE = readFileSync(require.resolve('jquery'), 'utf8')
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Bridge call names this runtime can serve without a human in front of it. */
const INTERACTIVE_CALLS = new Set([
  'startBrowser',
  'startBrowserWithShouldOverrideUrlLoading',
  'startBrowserDp',
  'startBrowserDpwithHtml',
  'webview',
  'getVerificationCode',
  'back',
])

export class SourceError extends Error {
  constructor(message, { code = 'SOURCE_ERROR', cause } = {}) {
    super(message, { cause })
    this.name = 'SourceError'
    this.code = code
  }
}

function toBase64(buffer) {
  return Buffer.from(buffer).toString('base64')
}

function decodeBody(buffer, contentType) {
  const match = /charset=([\w-]+)/i.exec(contentType || '')
  const charset = (match?.[1] || 'utf-8').toLowerCase()
  try {
    return new TextDecoder(charset).decode(buffer)
  } catch {
    return new TextDecoder('utf-8').decode(buffer)
  }
}

/**
 * Sources return `JSON.stringify(payload)` for the structured functions. Parse
 * that back into real values, leaving plain text (content) untouched.
 */
function parseJsonish(value) {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!text) return value
  const first = text[0]
  if (first !== '[' && first !== '{' && first !== '"') return value
  try {
    return JSON.parse(text)
  } catch {
    return value
  }
}

function withTimeout(promise, ms, label) {  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new SourceError(`${label} timed out after ${ms}ms`, { code: 'SOURCE_TIMEOUT' })), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** In-memory cookie jar, keyed by origin, mirroring the client bridge semantics. */
class CookieJar {
  constructor() {
    /** @type {Map<string, Map<string, string>>} */
    this.jars = new Map()
  }

  #bucket(url) {
    let origin = ''
    try {
      origin = new URL(url).origin
    } catch {
      origin = String(url)
    }
    if (!this.jars.has(origin)) this.jars.set(origin, new Map())
    return this.jars.get(origin)
  }

  get(url) {
    const bucket = this.#bucket(url)
    return [...bucket.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  set(url, value) {
    const bucket = this.#bucket(url)
    for (const part of String(value || '').split(';')) {
      const index = part.indexOf('=')
      if (index <= 0) continue
      bucket.set(part.slice(0, index).trim(), part.slice(index + 1).trim())
    }
  }

  setCookie(url, key, value) {
    this.#bucket(url).set(String(key), String(value))
  }

  getCookie(url, key) {
    return this.#bucket(url).get(String(key)) ?? ''
  }

  remove(url) {
    this.jars.delete(this.#bucket(url))
  }

  toJSON() {
    return Object.fromEntries([...this.jars].map(([origin, bucket]) => [origin, Object.fromEntries(bucket)]))
  }
}

export class WebviewSourceRuntime {
  /**
   * @param {object} options
   * @param {string} options.html        the source bundle's HTML document
   * @param {string} [options.name]      display name, used in errors only
   * @param {string} [options.baseUrl]   document origin for relative URLs
   * @param {number} [options.timeoutMs] per-call budget
   * @param {string} [options.userAgent]
   * @param {string} [options.deviceId]  reported to the source as `did`
   * @param {string} [options.key]       书源密钥, seeded into the source cache
   * @param {Array<{from: string, to: string}>} [options.rewrites] plain-text rewrites applied before parsing
   * @param {Record<string, string>} [options.headers] extra headers for every bridge HTTP call
   */
  constructor(options) {
    if (!options?.html) throw new SourceError('html is required', { code: 'SOURCE_INVALID' })
    this.name = options.name || 'unnamed source'
    this.html = options.html
    this.baseUrl = options.baseUrl || 'http://localhost'
    this.timeoutMs = options.timeoutMs ?? 30000
    this.userAgent = options.userAgent || DEFAULT_USER_AGENT
    this.deviceId = options.deviceId || 'server-0001'
    this.key = options.key || ''
    this.rewrites = options.rewrites || []
    this.extraHeaders = options.headers || {}
    this.cookies = new CookieJar()
    /** @type {Map<string, string>} */
    this.cache = new Map()
    /** @type {string[]} */
    this.logs = []
    /** @type {string[]} */
    this.unsupported = []
    this.dom = null
    this.window = null
  }

  async init() {
    let html = this.html
    for (const { from, to } of this.rewrites) {
      if (from) html = html.split(from).join(to)
    }

    const virtualConsole = new VirtualConsole()
    virtualConsole.on('jsdomError', (error) => {
      this.#log(`jsdom: ${error.message}`)
    })

    this.dom = new JSDOM(html, {
      url: this.baseUrl,
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      virtualConsole,
    })
    this.window = this.dom.window

    this.window.flutter_inappwebview = { callHandler: (name, ...args) => this.#handleBridgeCall(name, args) }
    this.window.flutterBridge = undefined

    // jQuery first: sources assume `$` from their <script src> tag, which the
    // server never fetches.
    this.window.eval(JQUERY_SOURCE)

    if (this.key) {
      this.cache.set('pyqdKey', this.key)
      this.cache.set('LoginInfo', JSON.stringify({ 书源密钥: this.key, key: this.key }))
    }

    // All inline scripts must run as ONE unit: sources declare helper classes
    // (`class FlutterJSBridge`) in one <script> and instantiate them in the next,
    // and class bindings do not survive from one eval scope to the next.
    const scripts = [...this.window.document.querySelectorAll('script')].filter((el) => !el.getAttribute('src'))
    const bundle = scripts.map((el) => el.textContent || '').join('\n;\n')
    const exportShim = `;window.__sourceRuntime = (function () {
      var names = ['search', 'info', 'chapter', 'content', 'getfinds', 'find', 'pay', 'getloginurl', 'login', 'imagedecrypt', 'shouldOverrideUrlLoading'];
      var out = {};
      for (var i = 0; i < names.length; i++) {
        var n = names[i];
        try { out[n] = (typeof eval(n) === 'function') ? eval(n) : null; } catch (e) { out[n] = null; }
      }
      return out;
    })();`

    try {
      this.window.eval(bundle + exportShim)
    } catch (error) {
      throw new SourceError(`[${this.name}] source bundle failed to evaluate: ${error.message}`, {
        code: 'SOURCE_SCRIPT_ERROR',
        cause: error,
      })
    }

    /** @type {Record<string, Function|null>} */
    this.exports = this.window.__sourceRuntime || {}
    this.exposed = Object.entries(this.exports)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)

    const missing = ['search', 'info', 'chapter', 'content'].filter((fn) => !this.exposed.includes(fn))
    if (missing.length === 4) {
      throw new SourceError(`[${this.name}] source defines no book-source functions`, { code: 'SOURCE_INVALID' })
    }
    this.missingFunctions = missing
    return this
  }

  #log(line) {
    if (this.logs.length < 200) this.logs.push(String(line))
  }

  async #handleBridgeCall(name, args) {
    if (process.env.SOURCE_DEBUG_BRIDGE) {
      const head = args.map((value) => (typeof value === 'string' ? value.slice(0, 120) : value)).slice(0, 2)
      console.error(`[bridge] ${name} ${JSON.stringify(head)}`)
    }
    switch (name) {
      case 'log':
        this.#log(args[0])
        return true
      case 'text':
        this.#log(`[text:${args[0]}] ${args[1]}`)
        return true
      case 'showToast':
        this.#log(`[toast] ${args[0]}`)
        return true
      case 'http':
        return this.#http(args)
      case 'cookie.get':
        return this.cookies.get(args[0])
      case 'cookie.set':
        this.cookies.set(args[0], args[1])
        return null
      case 'cookie.setcookie':
        this.cookies.setCookie(args[0], args[1], args[2])
        return null
      case 'cookie.getCookie':
        return this.cookies.getCookie(args[0], args[1])
      case 'cookie.remove':
        this.cookies.remove(args[0])
        return null
      case 'cache.get':
        return this.cache.get(String(args[0])) ?? null
      case 'cache.set':
        this.cache.set(String(args[0]), String(args[1] ?? ''))
        return null
      case 'cache.remove':
        this.cache.delete(String(args[0]))
        return null
      case 'CookieJar':
        return true
      case 'getWebViewUA':
        return this.userAgent
      case 'id':
        return this.deviceId
      case 'device':
        return 'server'
      case 'version':
        return '0.1.0'
      case 'buildNumber':
        return '0'
      case 'toTraditional':
      case 'toSimplified':
        return String(args[0] ?? '')
      case 'base64encode':
        return Buffer.from(String(args[0] ?? ''), 'utf8').toString('base64')
      case 'base64decode':
        return Buffer.from(String(args[0] ?? ''), 'base64').toString('utf8')
      case 'addbook':
        this.#log(`[addbook] ${args[0]}`)
        return ''
      default:
        if (INTERACTIVE_CALLS.has(name)) {
          this.unsupported.push(name)
          this.#log(`[unsupported] ${name} needs an interactive client`)
          return ''
        }
        this.unsupported.push(name)
        this.#log(`[unsupported] ${name}`)
        throw new SourceError(`bridge call "${name}" is not implemented on the server`, { code: 'SOURCE_BRIDGE_UNSUPPORTED' })
    }
  }

  /**
   * @param {any[]} args [method, url, body, headersJson, followRedirects, contentType]
   */
  async #http(args) {
    const [rawMethod, rawUrl, rawBody, rawHeaders, rawFollow, rawContentType] = args
    const method = String(rawMethod || 'get').toUpperCase()
    const url = String(rawUrl || '')
    if (!/^https?:\/\//i.test(url)) throw new SourceError(`bridge http got a non-http url: ${url}`, { code: 'SOURCE_HTTP' })

    /** @type {Record<string, string>} */
    const headers = { 'user-agent': this.userAgent, ...this.extraHeaders }
    if (rawHeaders) {
      try {
        const parsed = typeof rawHeaders === 'string' ? JSON.parse(rawHeaders || '{}') : rawHeaders
        for (const [key, value] of Object.entries(parsed || {})) headers[key.toLowerCase()] = String(value)
      } catch {
        /* a malformed header string is tolerated, as the client bridge does */
      }
    }
    const cookie = this.cookies.get(url)
    if (cookie) headers.cookie = cookie
    if (rawContentType) headers['content-type'] = String(rawContentType)
    if (rawBody && !headers['content-type']) headers['content-type'] = 'application/json'

    const followRedirects = rawFollow === undefined ? true : Boolean(rawFollow)
    const init = { method, headers, redirect: followRedirects ? 'follow' : 'manual' }
    if (rawBody !== undefined && rawBody !== null && rawBody !== '' && method !== 'GET' && method !== 'HEAD') {
      init.body = String(rawBody)
    }

    let response
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) })
    } catch (error) {
      throw new SourceError(`bridge http failed: ${method} ${url}: ${error.message}`, { code: 'SOURCE_HTTP', cause: error })
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    const setCookie = response.headers.getSetCookie?.() ?? []
    for (const line of setCookie) {
      const pair = line.split(';')[0]
      const index = pair.indexOf('=')
      if (index > 0) this.cookies.setCookie(url, pair.slice(0, index).trim(), pair.slice(index + 1).trim())
    }

    const contentType = response.headers.get('content-type') || ''
    /** @type {Record<string, string[]>} */
    const headerMap = {}
    for (const [key, value] of response.headers.entries()) headerMap[key] = [value]

    return {
      method: method.toLowerCase(),
      url: response.url || url,
      body: toBase64(buffer),
      headers: headerMap,
      statusCode: response.status,
      statusMessage: response.statusText,
      data: decodeBody(buffer, contentType),
    }
  }

  /**
   * Invoke a source function and normalize the result to a plain JS value.
   * Sources answer with JSON text (`JSON.stringify([...])`) for the structured
   * functions and with plain text for content, so JSON is parsed when it parses.
   */
  async call(fn, ...args) {
    if (!this.window) throw new SourceError('runtime not initialised; call init() first', { code: 'SOURCE_STATE' })
    const target = this.exports?.[fn]
    if (typeof target !== 'function') {
      throw new SourceError(`[${this.name}] source has no function "${fn}"`, { code: 'SOURCE_NO_FUNCTION' })
    }
    const value = await withTimeout(
      Promise.resolve(target.apply(this.window, args)),
      this.timeoutMs,
      `${this.name}.${fn}`,
    )
    return value === undefined ? null : parseJsonish(value)
  }

  search(keyword, page = 1) {
    return this.call('search', String(keyword), Number(page) || 1)
  }

  info(bookUrl) {
    return this.call('info', String(bookUrl))
  }

  chapter(tocUrl) {
    return this.call('chapter', String(tocUrl))
  }

  /** Content is plain text: JSON-shaped text is deliberately left untouched. */
  async content(chapterUrl) {
    const value = await this.callRaw('content', String(chapterUrl))
    return value == null ? '' : String(value)
  }

  finds() {
    return this.call('getfinds')
  }

  find(url, page = 1) {
    return this.call('find', String(url), Number(page) || 1)
  }

  /** Invoke a function verbatim, without JSON normalization. */
  async callRaw(fn, ...args) {
    if (!this.window) throw new SourceError('runtime not initialised; call init() first', { code: 'SOURCE_STATE' })
    const target = this.exports?.[fn]
    if (typeof target !== 'function') {
      throw new SourceError(`[${this.name}] source has no function "${fn}"`, { code: 'SOURCE_NO_FUNCTION' })
    }
    const value = await withTimeout(
      Promise.resolve(target.apply(this.window, args)),
      this.timeoutMs,
      `${this.name}.${fn}`,
    )
    return value === undefined ? null : value
  }

  dispose() {
    try {
      this.window?.close()
    } catch {
      /* ignore */
    }
    this.dom = null
    this.window = null
  }
}

/**
 * Build a runtime from a Legado-style book source entry (`{bookSourceName, bookSourceUrl, html}`).
 * A plain HTML string is also accepted.
 *
 * @param {string | {bookSourceName?: string, bookSourceUrl?: string, html: string}} source
 * @param {Partial<ConstructorParameters<typeof WebviewSourceRuntime>[0]>} [options]
 */
export function createRuntime(source, options = {}) {
  const isObject = source && typeof source === 'object'
  const html = isObject ? source.html : String(source)
  return new WebviewSourceRuntime({
    ...options,
    html,
    name: options.name || (isObject ? source.bookSourceName : undefined),
    baseUrl: options.baseUrl || (isObject ? source.bookSourceUrl : undefined) || 'http://localhost',
  })
}

export default WebviewSourceRuntime
