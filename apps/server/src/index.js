/**
 * reader-panghu server entry point.
 *
 * Two surfaces over one store:
 *  - /reader3/*  the reader-next Vue UI contract (bookshelf, sources, search SSE)
 *  - /api/*      a small source-oriented API and the 阅读3 source generator
 *
 * Book sources are stored as documents in SQLite; a WebView source keeps its
 * executable `html` bundle and is executed by @reader-panghu/source-runtime.
 */

import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import multipart from '@fastify/multipart'
import Fastify from 'fastify'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateLegadoSource } from '@reader-panghu/legado-source'
import { SourceError, createRuntime } from '@reader-panghu/source-runtime'
import { createRuleRuntime } from './rule-runtime.js'
import { defaultDatabaseFile, openDatabase } from './db.js'
import { resolveCoverUrl } from './cover-url.js'
import { registerReader3 } from './reader3.js'
import { registerReader3Extras } from './reader3-extras.js'
import { registerAuth } from './auth.js'
import { registerReadingExtras } from './reading-extras.js'
import { registerPortability } from './portability.js'
import { registerConvertHook, registerNotes } from './text-convert.js'
import { registerWarehouse } from './warehouse.js'
import { cleanIntro, cleanText } from './text.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const DATA_DIR = process.env.DATA_DIR || join(repoRoot, 'data')
const SOURCES_SEED_DIR = join(DATA_DIR, 'sources')
const WEB_DIST = process.env.WEB_ROOT || join(repoRoot, 'apps', 'web', 'dist')
const PORT = Number(process.env.PORT || 18080)
const HOST = process.env.HOST || '0.0.0.0'
const SOURCE_TIMEOUT_MS = Number(process.env.SOURCE_TIMEOUT_MS || 45000)

mkdirSync(DATA_DIR, { recursive: true })
mkdirSync(SOURCES_SEED_DIR, { recursive: true })

const store = openDatabase(process.env.DATABASE_FILE || defaultDatabaseFile(DATA_DIR))

/* Seed the source table from data/sources/*.json the first time only: after that
   the UI and the API own the table. */
function seedSources() {
  if (store.listSources().length > 0) return
  let seeded = 0
  for (const file of readdirSync(SOURCES_SEED_DIR).filter((name) => name.endsWith('.json'))) {
    try {
      const parsed = JSON.parse(readFileSync(join(SOURCES_SEED_DIR, file), 'utf8'))
      for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
        if (!entry?.bookSourceUrl) continue
        store.saveSource(entry)
        seeded += 1
      }
    } catch (error) {
      console.warn(`[seed] skipped ${file}: ${error.message}`)
    }
  }
  if (seeded) console.log(`[seed] imported ${seeded} book source(s) from data/sources`)
}
seedSources()

const slug = (input) =>
  String(input || 'source')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'source'

const sourceId = (source) => slug(source.id || source.bookSourceName || source.bookSourceUrl)

/** 可执行的书源：WebView（html）或规则型（searchUrl / ruleSearch）。 */
const executableSources = () =>
  store.listSources().filter((source) => source.enabled !== false && (source.html || source.searchUrl || source.ruleSearch))

function pickSource(id) {
  const all = executableSources()
  if (id) {
    const found = all.find((source) => sourceId(source) === String(id))
    if (found) return found
    throw new SourceError(`unknown source "${id}"`, { code: 'SOURCE_NOT_FOUND' })
  }
  if (!all.length) throw new SourceError('no WebView book source is configured', { code: 'SOURCE_NOT_FOUND' })
  return all[0]
}

/* ---------------------------------------------------------------- normalize */

function selfUrl(req, path, params) {
  const base = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.headers.host}`).replace(/\/+$/, '')
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '') search.set(key, String(value))
  return `${base}${path}?${search.toString()}`
}

function normalizeBook(book, req, source) {
  return {
    name: String(book?.name ?? ''),
    author: String(book?.author ?? ''),
    kind: String(book?.kind ?? ''),
    intro: cleanIntro(book?.intro),
    coverUrl: resolveCoverUrl(book?.coverUrl ?? book?.cover ?? book?.pic ?? book?.imageUrl ?? book?.image, book?.bookUrl, source?.bookSourceUrl),
    bookUrl: selfUrl(req, '/api/book', { source: sourceId(source), url: book?.bookUrl }),
    tocUrl: selfUrl(req, '/api/toc', { source: sourceId(source), url: book?.tocUrl || book?.bookUrl }),
    wordCount: String(book?.wordCount ?? ''),
    latestChapterTitle: String(book?.latestChapterTitle ?? ''),
    type: Number(book?.type ?? 0),
    upstreamUrl: String(book?.bookUrl ?? ''),
  }
}

function normalizeChapter(chapter, req, source, index) {
  return {
    name: String(chapter?.name ?? `第${index + 1}章`),
    index: Number(chapter?.index ?? index),
    chapterId: selfUrl(req, '/api/content', { source: sourceId(source), url: chapter?.chapterId }),
    isVip: Boolean(chapter?.isVip),
    isPay: Boolean(chapter?.isPay),
    isVolume: Boolean(chapter?.isVolume),
    tag: String(chapter?.tag ?? ''),
    upstreamUrl: String(chapter?.chapterId ?? ''),
  }
}

async function withRuntime(source, run) {
  const runtimeConfig = source._runtime || {}
  if (!source.html) {
    const runtime = createRuleRuntime(source, { timeoutMs: SOURCE_TIMEOUT_MS })
    await runtime.init()
    try {
      return await run(runtime)
    } finally {
      runtime.dispose()
    }
  }
  const runtime = createRuntime(source, {
    name: source.bookSourceName,
    key: (source._runtime || {}).key || process.env.SOURCE_KEY || '',
    rewrites: parseRewrites(process.env.SOURCE_REWRITES).concat((source._runtime || {}).rewrites || []),
    timeoutMs: (source._runtime || {}).timeoutMs || SOURCE_TIMEOUT_MS,
    headers: (source._runtime || {}).headers || {},
    baseUrl: source.bookSourceUrl,
  })
  await runtime.init()
  try {
    return await run(runtime)
  } finally {
    runtime.dispose()
  }
}

function parseRewrites(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item) => item?.from && item?.to) : []
  } catch {
    return []
  }
}

/* --------------------------------------------------------------------- app */

const app = Fastify({
  bodyLimit: 64 * 1024 * 1024, logger: { level: process.env.LOG_LEVEL || 'info' } })
await app.register(cors, { origin: true })
await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } })

app.setErrorHandler((error, _request, reply) => {
  const status = error instanceof SourceError ? 502 : error.statusCode || 500
  // 前端统一按 /reader3 契约处理：即使 HTTP 状态非 200 也必须有 isSuccess/errorMsg，
  // 否则 api.request 会把错误对象当成成功数据返回。
  reply.code(status).send({
    isSuccess: false,
    errorMsg: error.message || '服务内部错误',
    error: error.message || '服务内部错误',
    code: error.code || 'ERROR',
  })
})

registerReader3(app, { store, dataDir: DATA_DIR, options: { timeoutMs: SOURCE_TIMEOUT_MS } })
registerReader3Extras(app, { store, dataDir: DATA_DIR, options: { timeoutMs: SOURCE_TIMEOUT_MS } })
registerAuth(app, { store })
registerPortability(app, { store })
registerNotes(app, { store })
registerConvertHook(app)
registerWarehouse(app, { store, dataDir: DATA_DIR })
registerReadingExtras(app, { store, dataDir: DATA_DIR })

app.get('/api/health', async () => ({
  ok: true,
  sources: store.listSources().length,
  webviewSources: executableSources().length,
  books: store.listBooks().length,
  uptime: Math.round(process.uptime()),
}))

app.get('/api/sources', async (req) => {
  const base = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.headers.host}`).replace(/\/+$/, '')
  return store.listSources().map((source) => ({
    id: sourceId(source),
    name: source.bookSourceName,
    group: source.bookSourceGroup || '',
    type: source.html ? 'webview' : 'rule',
    legadoSource: `${base}/api/legado-source/${encodeURIComponent(sourceId(source))}`,
  }))
})

app.get('/api/search', async (req) => {
  const keyword = String(req.query.q ?? '').trim()
  if (!keyword) throw new SourceError('q is required', { code: 'BAD_REQUEST' })
  const page = Number(req.query.page || 1)
  const source = pickSource(req.query.source)
  const books = await withRuntime(source, (runtime) => runtime.search(keyword, page))
  return { source: sourceId(source), page, books: (Array.isArray(books) ? books : []).map((book) => normalizeBook(book, req, source)) }
})

app.get('/api/book', async (req) => {
  const url = String(req.query.url ?? '')
  if (!url) throw new SourceError('url is required', { code: 'BAD_REQUEST' })
  const source = pickSource(req.query.source)
  const book = await withRuntime(source, (runtime) => runtime.info(url))
  return normalizeBook(book, req, source)
})

app.get('/api/toc', async (req) => {
  const url = String(req.query.url ?? '')
  if (!url) throw new SourceError('url is required', { code: 'BAD_REQUEST' })
  const source = pickSource(req.query.source)
  const chapters = await withRuntime(source, (runtime) => runtime.chapter(url))
  const list = Array.isArray(chapters) ? chapters : []
  return { source: sourceId(source), count: list.length, chapters: list.map((chapter, index) => normalizeChapter(chapter, req, source, index)) }
})

app.get('/api/content', async (req) => {
  const url = String(req.query.url ?? '')
  if (!url) throw new SourceError('url is required', { code: 'BAD_REQUEST' })
  const source = pickSource(req.query.source)
  const text = await withRuntime(source, (runtime) => runtime.content(url))
  return { content: cleanText(text) }
})

/** Subscription document: every WebView source as a 阅读3 book source. */
function legadoSources(req, onlyId) {
  const base = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.headers.host}`).replace(/\/+$/, '')
  const list = executableSources().filter((source) => !onlyId || sourceId(source) === onlyId)
  return list.map((source) =>
    generateLegadoSource({
      id: sourceId(source),
      name: `${source.bookSourceName}（服务端）`,
      baseUrl: base,
      group: source.bookSourceGroup || '自建',
      upstreamNote: 'Subscribed from reader-panghu; rules read the server JSON API.',
    }),
  )
}

/** 书源订阅入口：Legado 客户端可直接填这个地址自动拉取/更新书源。 */
app.get('/api/subscribe', async (req, reply) => {
  reply.header('content-type', 'application/json; charset=utf-8')
  return legadoSources(req)
})

app.get('/api/subscribe/:id', async (req, reply) => {
  reply.header('content-type', 'application/json; charset=utf-8')
  return legadoSources(req, String(req.params.id))
})

app.get('/api/legado-source/:id', async (req, reply) => {
  const source = pickSource(req.params.id)
  const base = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.headers.host}`).replace(/\/+$/, '')
  const document = generateLegadoSource({
    id: sourceId(source),
    name: `${source.bookSourceName}（服务端）`,
    baseUrl: base,
    group: source.bookSourceGroup || '自建',
    upstreamNote: 'Generated by reader-panghu: rules read the server JSON API.',
  })
  if (req.query.download) {
    reply.header('content-disposition', `attachment; filename="${encodeURIComponent(sourceId(source))}.json"`)
  }
  return document
})

if (existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST })
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api') || req.raw.url?.startsWith('/reader3')) {
      return reply.code(404).send({ error: 'not found' })
    }
    return reply.sendFile('index.html')
  })
  console.log(`[web] serving UI from ${WEB_DIST}`)
}

// RSS 定时刷新：默认 30 分钟一次，0 关闭
const rssIntervalMinutes = Number(process.env.RSS_REFRESH_MINUTES ?? 30)
if (rssIntervalMinutes > 0) {
  const timer = setInterval(async () => {
    try {
      const result = await app.readerPanghuRefreshRss()
      if (result.refreshed || result.failed.length) {
        app.log.info(`[rss] refreshed=${result.refreshed} failed=${result.failed.length}`)
      }
    } catch (error) {
      app.log.warn(`[rss] 定时刷新失败: ${error.message}`)
    }
  }, rssIntervalMinutes * 60 * 1000)
  timer.unref?.()
}

await app.listen({ port: PORT, host: HOST })
console.log(`reader-panghu listening on http://${HOST}:${PORT}`)
