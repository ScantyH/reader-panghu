/**
 * Unified reading server.
 *
 * Responsibilities in this milestone:
 *  - keep a registry of WebView book sources (data/sources/*.json)
 *  - execute them through @reader-panghu/source-runtime on demand
 *  - expose a small JSON API (search / detail / toc / content)
 *  - generate a standard 阅读3 rule-based source that points back at this API,
 *    so Legado clients (iOS/Android) consume the same content without changes
 *
 * The /reader3 surface (bookshelf, progress, local books, cover editing) is the
 * next milestone and is intentionally not faked here.
 */

import cors from '@fastify/cors'
import Fastify from 'fastify'
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateLegadoSource } from '@reader-panghu/legado-source'
import { SourceError, createRuntime } from '@reader-panghu/source-runtime'

const here = dirname(fileURLToPath(import.meta.url))
// src → server → apps → repo root
const repoRoot = join(here, '..', '..', '..')
const DATA_DIR = process.env.DATA_DIR || join(repoRoot, 'data')
const SOURCES_DIR = join(DATA_DIR, 'sources')
const PORT = Number(process.env.PORT || 18080)
const HOST = process.env.HOST || '0.0.0.0'
const SOURCE_TIMEOUT_MS = Number(process.env.SOURCE_TIMEOUT_MS || 45000)

mkdirSync(SOURCES_DIR, { recursive: true })

/** @type {Map<string, {id: string, name: string, entry: any, runtime: any}>} */
const registry = new Map()

const slug = (input) =>
  String(input || 'source')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'source'

function loadSources() {
  registry.clear()
  for (const file of readdirSync(SOURCES_DIR).filter((name) => name.endsWith('.json'))) {
    const path = join(SOURCES_DIR, file)
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      const list = Array.isArray(parsed) ? parsed : [parsed]
      for (const entry of list) {
        if (!entry?.html) continue
        const id = slug(entry.id || entry.bookSourceName || file.replace(/\.json$/, ''))
        registry.set(id, {
          id,
          name: entry.bookSourceName || id,
          entry,
          runtime: entry._runtime || {},
        })
      }
    } catch (error) {
      console.warn(`[sources] skipped ${file}: ${error.message}`)
    }
  }
  console.log(`[sources] loaded ${registry.size}: ${[...registry.keys()].join(', ') || '(none)'}`)
}

function getSource(id) {
  if (id && registry.has(id)) return registry.get(id)
  if (id) throw new SourceError(`unknown source "${id}"`, { code: 'SOURCE_NOT_FOUND' })
  const first = registry.values().next().value
  if (!first) throw new SourceError('no book source is configured', { code: 'SOURCE_NOT_FOUND' })
  return first
}

async function withRuntime(id, run) {
  const source = getSource(id)
  const runtime = createRuntime(source.entry, {
    name: source.name,
    key: source.runtime.key,
    rewrites: source.runtime.rewrites || [],
    timeoutMs: source.runtime.timeoutMs || SOURCE_TIMEOUT_MS,
    headers: source.runtime.headers || {},
    baseUrl: source.entry.bookSourceUrl,
  })
  await runtime.init()
  try {
    return await run(runtime)
  } finally {
    runtime.dispose()
  }
}

/* ---------------------------------------------------------------- normalize */

/** Paragraph-comment markers (`dp:*`) are client UI, not text. */
const DP_IMG = /<img[^>]*src="\s*dp:[^"]*"[^>]*>/gi

function cleanText(value) {
  return String(value ?? '')
    .replace(DP_IMG, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function selfUrl(req, path, params) {
  const base = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.headers.host}`).replace(/\/+$/, '')
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '') search.set(key, String(value))
  return `${base}${path}?${search.toString()}`
}

function normalizeBook(book, req, sourceId) {
  return {
    name: String(book?.name ?? ''),
    author: String(book?.author ?? ''),
    kind: String(book?.kind ?? ''),
    intro: cleanText(book?.intro),
    coverUrl: String(book?.coverUrl ?? ''),
    bookUrl: selfUrl(req, '/api/book', { source: sourceId, url: book?.bookUrl }),
    tocUrl: selfUrl(req, '/api/toc', { source: sourceId, url: book?.tocUrl || book?.bookUrl }),
    wordCount: String(book?.wordCount ?? ''),
    latestChapterTitle: String(book?.latestChapterTitle ?? ''),
    type: Number(book?.type ?? 0),
    upstreamUrl: String(book?.bookUrl ?? ''),
  }
}

function normalizeChapter(chapter, req, sourceId, index) {
  return {
    name: String(chapter?.name ?? `第${index + 1}章`),
    index: Number(chapter?.index ?? index),
    chapterId: selfUrl(req, '/api/content', { source: sourceId, url: chapter?.chapterId }),
    isVip: Boolean(chapter?.isVip),
    isPay: Boolean(chapter?.isPay),
    isVolume: Boolean(chapter?.isVolume),
    tag: String(chapter?.tag ?? ''),
    upstreamUrl: String(chapter?.chapterId ?? ''),
  }
}

/* --------------------------------------------------------------------- app */

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } })
await app.register(cors, { origin: true })

app.setErrorHandler((error, _request, reply) => {
  const status = error instanceof SourceError ? 502 : error.statusCode || 500
  reply.code(status).send({ error: error.message, code: error.code || 'ERROR' })
})

app.get('/api/health', async () => ({ ok: true, sources: registry.size, uptime: Math.round(process.uptime()) }))

app.get('/api/sources', async (req) => {
  const base = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.headers.host}`).replace(/\/+$/, '')
  return [...registry.values()].map((source) => ({
    id: source.id,
    name: source.name,
    group: source.entry.bookSourceGroup || '',
    type: source.entry.html ? 'webview' : 'rule',
    legadoSource: `${base}/api/legado-source/${encodeURIComponent(source.id)}`,
  }))
})

app.post('/api/sources', async (req, reply) => {
  const body = req.body
  const incoming = Array.isArray(body) ? body : Array.isArray(body?.sources) ? body.sources : [body?.source ?? body]
  const saved = []
  for (const entry of incoming) {
    if (!entry?.html) return reply.code(400).send({ error: 'a WebView source needs an html field' })
    const id = slug(req.body?.id || entry.id || entry.bookSourceName)
    const file = join(SOURCES_DIR, `${id}.json`)
    writeFileSync(file, JSON.stringify({ ...entry, id }, null, 2), 'utf8')
    saved.push(id)
  }
  loadSources()
  return { saved }
})

app.delete('/api/sources/:id', async (req, reply) => {
  const id = slug(req.params.id)
  const file = join(SOURCES_DIR, `${id}.json`)
  if (!existsSync(file)) return reply.code(404).send({ error: `no source ${id}` })
  unlinkSync(file)
  loadSources()
  return { deleted: id }
})

app.get('/api/search', async (req) => {
  const keyword = String(req.query.q ?? '').trim()
  if (!keyword) throw new SourceError('q is required', { code: 'BAD_REQUEST' })
  const page = Number(req.query.page || 1)
  const sourceId = req.query.source ? String(req.query.source) : undefined
  const books = await withRuntime(sourceId, (runtime) => runtime.search(keyword, page))
  const source = getSource(sourceId)
  const list = Array.isArray(books) ? books : []
  return { source: source.id, page, books: list.map((book) => normalizeBook(book, req, source.id)) }
})

app.get('/api/book', async (req) => {
  const url = String(req.query.url ?? '')
  if (!url) throw new SourceError('url is required', { code: 'BAD_REQUEST' })
  const sourceId = req.query.source ? String(req.query.source) : undefined
  const book = await withRuntime(sourceId, (runtime) => runtime.info(url))
  return normalizeBook(book, req, getSource(sourceId).id)
})

app.get('/api/toc', async (req) => {
  const url = String(req.query.url ?? '')
  if (!url) throw new SourceError('url is required', { code: 'BAD_REQUEST' })
  const sourceId = req.query.source ? String(req.query.source) : undefined
  const chapters = await withRuntime(sourceId, (runtime) => runtime.chapter(url))
  const source = getSource(sourceId)
  const list = Array.isArray(chapters) ? chapters : []
  return {
    source: source.id,
    count: list.length,
    chapters: list.map((chapter, index) => normalizeChapter(chapter, req, source.id, index)),
  }
})

app.get('/api/content', async (req) => {
  const url = String(req.query.url ?? '')
  if (!url) throw new SourceError('url is required', { code: 'BAD_REQUEST' })
  const sourceId = req.query.source ? String(req.query.source) : undefined
  const text = await withRuntime(sourceId, (runtime) => runtime.content(url))
  return { content: cleanText(text) }
})

app.get('/api/legado-source/:id', async (req, reply) => {
  const source = getSource(String(req.params.id))
  const base = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.headers.host}`).replace(/\/+$/, '')
  const document = generateLegadoSource({
    id: source.id,
    name: `${source.name}（服务端）`,
    baseUrl: base,
    group: source.entry.bookSourceGroup || '自建',
    upstreamNote: 'Generated by reader-panghu: rules read the server JSON API.',
  })
  if (req.query.download) {
    reply.header('content-disposition', `attachment; filename="${encodeURIComponent(source.id)}.json"`)
  }
  return document
})

app.get('/', async () => ({
  name: 'reader-panghu',
  sources: [...registry.keys()],
  endpoints: ['/api/health', '/api/sources', '/api/search?q=', '/api/book?url=', '/api/toc?url=', '/api/content?url=', '/api/legado-source/:id'],
}))

loadSources()
await app.listen({ port: PORT, host: HOST })
console.log(`reader-panghu listening on http://${HOST}:${PORT}`)
