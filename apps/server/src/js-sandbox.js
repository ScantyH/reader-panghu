/**
 * Legado 规则里的 JS 沙箱。
 *
 * 支持 `@js:` 与 `<js>…</js>` 两种写法，暴露 Legado 常用的 `java.*` API 子集。
 * 用 node:vm 隔离执行，并限制超时，避免书源里的死循环拖住服务。
 *
 * 明确不支持（会抛错而不是静默）：需要同步网络的 `java.ajax`、`java.webView`、
 * 依赖登录态/CookieJar 的调用。这类规则往往同时需要书源登录，服务端无法可靠模拟。
 */

import { createHash } from 'node:crypto'
import vm from 'node:vm'

const DEFAULT_TIMEOUT_MS = 3000

function buildJava(vars) {
  return {
    ajax: () => {
      throw new Error('java.ajax 需要同步网络请求，服务端暂不支持')
    },
    get: (key) => vars?.[key] ?? '',
    put: (key, value) => {
      if (vars) vars[key] = value
      return value
    },
    log: () => '',
    base64Encode: (text) => Buffer.from(String(text), 'utf8').toString('base64'),
    base64Decode: (text) => Buffer.from(String(text), 'base64').toString('utf8'),
    md5Encode: (text) => createHash('md5').update(String(text), 'utf8').digest('hex'),
    md5Encode16: (text) => createHash('md5').update(String(text), 'utf8').digest('hex').slice(8, 24),
    encodeURI: (text) => encodeURIComponent(String(text)),
    timeFormat: (time) => new Date(Number(time) || Date.now()).toISOString(),
    randomUUID: () => crypto.randomUUID(),
  }
}

/**
 * 执行一段书源 JS。
 * @param {string} code       脚本源码
 * @param {object} options
 * @param {unknown} options.result  上一步的取值（Legado 的 result）
 * @param {string} [options.baseUrl]
 * @param {Record<string, string>} [options.vars]
 * @returns {string}
 */
export function runSourceJs(code, { result, baseUrl = '', vars = {}, book = null } = {}) {
  const sandbox = {
    result,
    baseUrl,
    book,
    source: null,
    cookie: { getCookie: () => '', setCookie: () => '' },
    java: buildJava(vars),
    console: { log: () => {} },
    JSON,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Math,
    Date,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    decodeURIComponent,
    encodeURIComponent,
  }
  const context = vm.createContext(sandbox)
  try {
    const value = vm.runInContext(String(code), context, { timeout: DEFAULT_TIMEOUT_MS, displayErrors: true })
    const output = value !== undefined ? value : sandbox.result
    if (output == null) return ''
    if (Array.isArray(output)) return output.join('\n')
    if (typeof output === 'object') return JSON.stringify(output)
    return String(output)
  } catch (error) {
    throw new Error(`JS 规则执行失败：${error.message}`)
  }
}

/** 判断规则是否含 JS 段 */
export const hasJs = (rule) => /@js:|<js>/.test(String(rule ?? ''))
