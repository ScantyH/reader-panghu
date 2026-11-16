/**
 * /reader3/* — the contract the reader-next Vue UI speaks.
 *
 * Every response is the envelope `{isSuccess, errorMsg, data}`: the UI's axios
 * interceptor unwraps `data` and reacts to `errorMsg === 'NEED_LOGIN'`.
 * Search additionally streams over SSE (`message` events then an `end` event).
 *
 * Book sources here are Reader-next `BookSource` objects. A WebView source keeps
 * its executable bundle in `html`; rule-based sources are parsed by the client,
 * not by this server (yet), so they only contribute to the source list.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { SourceError, createRuntime } from '@reader-panghu/source-runtime'
import { cleanIntro, cleanText } from './text.js'

const ok = (data) => ({ isSuccess: true, errorMsg: '', data })
const fail = (errorMsg, data = null) => ({ isSuccess: false, errorMsg, data })

const now = () => Date.now()

export function registerReader3(app, { store, dataDir, options = {} }) {
  const coversDir = join(dataDir, 'covers')
  mkdirSync(coversDir, { recursive: true })
  const timeoutMs = Number(options.timeoutMs || process.env.SOURCE_TIMEOUT_MS || 45000)
  const globalRewrites = parseRewrites(process.env.SOURCE_REWRITES)
  const globalKey = process.env.SOURCE_KEY || ''

  /** Build a runtime for one stored source, or throw a readable error. */
  function runtimeFor(bookSourceUrl) {
    const source = store.getSource(bookSourceUrl)
    if (!source) throw new SourceError(`书源不存在：${bookSourceUrl || '(空)'}`, { code: 'SOURCE_NOT_FOUND' })
    if (!source.html) {
      throw new SourceError(`书源「${source.bookSourceName || bookSourceUrl}」是规则型书源，服务端暂不执行`, {
        code: 'SOURCE_RULE_UNSUPPORTED',
      })
    }
    const runtimeConfig = source._runtime || {}
    return createRuntime(source, {
      name: source.bookSourceName,
      key: runtimeConfig.key || globalKey,
      rewrites: [...globalRewrites, ...(runtimeConfig.rewrites || [])],
      timeoutMs: runtimeConfig.timeoutMs || timeoutMs,
      headers: runtimeConfig.headers || {},
      baseUrl: source.bookSourceUrl,
    })
  }

  async function withRuntime(bookSourceUrl, run) {
    const runtime = runtimeFor(bookSourceUrl)
    await runtime.init()
    try {
      return await run(runtime)
    } finally {
      runtime.dispose()
    }
  }

  const enabledSources = () => store.listSources().filter((source) => source.enabled !== false && source.html)

  const toSearchBook = (book, source) => ({
    name: String(book?.name ?? ''),
    author: String(book?.author ?? ''),
    bookUrl: String(book?.bookUrl ?? ''),
    origin: String(source.bookSourceUrl ?? ''),
    originName: String(source.bookSourceName ?? ''),
    originGroup: String(source.bookSourceGroup ?? ''),
    coverUrl: String(book?.coverUrl ?? ''),
    intro: String(book?.intro ?? ''),
    kind: String(book?.kind ?? ''),
    lastChapter: String(book?.latestChapterTitle ?? ''),
    updateTime: String(book?.updateTime ?? ''),
    wordCount: String(book?.wordCount ?? ''),
  })

  const toBook = (book, source, existing = null) => ({
    name: String(book?.name ?? existing?.name ?? ''),
    author: String(book?.author ?? existing?.author ?? ''),
    bookUrl: String(book?.bookUrl ?? existing?.bookUrl ?? ''),
    origin: String(source?.bookSourceUrl ?? existing?.origin ?? ''),
    originName: String(source?.bookSourceName ?? existing?.originName ?? ''),
    coverUrl: String(book?.coverUrl ?? existing?.coverUrl ?? ''),
    tocUrl: String(book?.tocUrl ?? existing?.tocUrl ?? ''),
    intro: cleanIntro(book?.intro ?? existing?.intro ?? ''),
    kind: String(book?.kind ?? existing?.kind ?? ''),
    latestChapterTitle: String(book?.latestChapterTitle ?? existing?.latestChapterTitle ?? ''),
    wordCount: String(book?.wordCount ?? existing?.wordCount ?? ''),
    type: Number(book?.type ?? existing?.type ?? 0),
    charset: existing?.charset ?? '',
    canUpdate: true,
    group: existing?.group ?? 0,
    durChapterIndex: existing?.durChapterIndex ?? 0,
    durChapterPos: existing?.durChapterPos ?? 0,
    durChapterTime: existing?.durChapterTime ?? 0,
    durChapterTitle: existing?.durChapterTitle ?? '',
    totalChapterNum: existing?.totalChapterNum ?? 0,
    customCoverUrl: existing?.customCoverUrl ?? '',
    lastCheckTime: existing?.lastCheckTime ?? 0,
  })

  /* ------------------------------------------------------------------ shelf */

  app.get('/reader3/getBookshelf', async () => ok(store.listBooks()))

  app.get('/reader3/getShelfBookWithCacheInfo', async () => {
    const books = store.listBooks().map((book) => ({
      ...book,
      cachedChapterCount: store.countChapters(book.bookUrl, book.origin),
      browserCachedChapterCount: 0,
    }))
    return ok(books)
  })

  app.post('/reader3/getShelfBook', async (req) => {
    const book = store.getBook(String(req.body?.url ?? ''))
    return book ? ok(book) : fail('书籍不在书架中')
  })

  app.post('/reader3/saveBook', async (req) => {
    const saved = store.saveBook(req.body || {})
    return ok(saved)
  })

  app.post('/reader3/saveBooks', async (req) => {
    const list = Array.isArray(req.body) ? req.body : []
    return ok(store.saveBooks(list))
  })

  app.post('/reader3/deleteBook', async (req) => {
    const url = String(req.body?.bookUrl ?? '')
    return ok(store.deleteBook(url) ? '删除成功' : '书籍不存在')
  })

  app.post('/reader3/deleteBooks', async (req) => {
    const list = Array.isArray(req.body) ? req.body : []
    return ok({ deleted: store.deleteBooks(list.map((book) => String(book?.bookUrl ?? ''))) })
  })

  /** Server-authoritative progress: the stored row always keeps the newest write. */
  app.post('/reader3/saveBookProgress', async (req) => {
    const { bookUrl, index, position, clientUpdatedAt } = req.body || {}
    const updated = store.saveProgress({ bookUrl: String(bookUrl ?? ''), index, position, clientUpdatedAt })
    if (!updated) return fail('书籍不存在')
    // The client adopts this timestamp; a rejected stale write still returns the
    // server's authoritative one, which is what "backend latest wins" means here.
    return ok(String(updated.durChapterTime))
  })

  /* -------------------------------------------------------------- book data */

  app.post('/reader3/getBookInfo', async (req) => {
    const url = String(req.body?.url ?? '')
    const bookSourceUrl = String(req.body?.bookSourceUrl ?? '')
    const existing = store.getBook(url) || null
    const info = await withRuntime(bookSourceUrl, (runtime) => runtime.info(url))
    const source = store.getSource(bookSourceUrl)
    return ok(toBook(info, source, existing))
  })

  app.post('/reader3/getChapterList', async (req) => {
    const { bookUrl, tocUrl, bookSourceUrl, refresh } = req.body || {}
    const book = bookUrl ? store.getBook(String(bookUrl)) : null
    const target = String(tocUrl || book?.tocUrl || bookUrl || '')
    const origin = String(bookSourceUrl || book?.origin || '')
    if (!target) return fail('缺少目录地址')
    if (!refresh && book) {
      const cached = store.getChapters(book.bookUrl, book.origin)
      if (cached?.length) return ok(cached)
    }
    const chapters = await withRuntime(origin, (runtime) => runtime.chapter(target))
    const list = (Array.isArray(chapters) ? chapters : []).map((chapter, index) => ({
      title: String(chapter?.name ?? `第${index + 1}章`),
      url: String(chapter?.chapterId ?? ''),
      index: Number(chapter?.index ?? index),
    }))
    if (book && list.length) {
      store.saveChapters(book.bookUrl, book.origin, list)
      store.saveBook({ ...book, totalChapterNum: list.length })
    }
    return ok(list)
  })

  app.post('/reader3/getBookContent', async (req) => {
    const { bookUrl, chapterUrl, bookSourceUrl, index } = req.body || {}
    const book = bookUrl ? store.getBook(String(bookUrl)) : null
    // Local books (TXT / EPUB) carry their text in the chapter table. Detect them
    // by the presence of that table rather than by URL scheme: a WebView source
    // may legitimately use a local:// book URL of its own.
    if (book) {
      const stored = store.getChapters(`${book.bookUrl}#content`, book.origin)
      if (Array.isArray(stored) && stored.length) {
        const chapter = stored.find((item) => item.index === Number(index))
        return chapter ? ok(cleanText(chapter.content)) : fail('本地章节不存在')
      }
    }
    const origin = String(bookSourceUrl || book?.origin || '')
    let target = String(chapterUrl || '')
    if (!target && book) {
      const cached = store.getChapters(book.bookUrl, book.origin)
      const chapter = cached?.find((item) => item.index === Number(index))
      target = chapter?.url || ''
    }
    if (!target) return fail('缺少章节地址')
    const content = await withRuntime(origin, (runtime) => runtime.content(target))
    return ok(cleanText(content))
  })

  app.post('/reader3/deleteBookCache', async (req) => {
    store.deleteChapters(String(req.body?.bookUrl ?? ''))
    return ok('已清除缓存')
  })

  /** Switch the source a shelf book reads from, keeping its progress. */
  app.post('/reader3/setBookSource', async (req) => {
    const { bookUrl, newUrl, bookSourceUrl } = req.body || {}
    const existing = store.getBook(String(bookUrl ?? ''))
    const info = await withRuntime(String(bookSourceUrl ?? ''), (runtime) => runtime.info(String(newUrl ?? bookUrl)))
    const source = store.getSource(String(bookSourceUrl ?? ''))
    const next = toBook({ ...info, bookUrl: String(newUrl ?? bookUrl) }, source, existing)
    store.deleteChapters(String(bookUrl ?? ''))
    return ok(store.saveBook(next))
  })

  /* ---------------------------------------------------------------- sources */

  app.get('/reader3/getBookSources', async () => ok(store.listSources()))

  app.post('/reader3/getBookSource', async (req) => {
    const source = store.getSource(String(req.body?.bookSourceUrl ?? ''))
    return source ? ok(source) : fail('书源不存在')
  })

  app.post('/reader3/saveBookSource', async (req) => {
    store.saveSource(req.body || {})
    return ok({ saved: true })
  })

  app.post('/reader3/saveBookSources', async (req) => {
    const list = Array.isArray(req.body) ? req.body : []
    return ok({ saved: true, count: store.saveSources(list) })
  })

  app.post('/reader3/deleteBookSource', async (req) => {
    return ok({ deleted: store.deleteSource(String(req.body?.bookSourceUrl ?? '')) })
  })

  app.post('/reader3/deleteBookSources', async (req) => {
    const list = Array.isArray(req.body) ? req.body : []
    const deleted = store.deleteSources(list.map((item) => String(item?.bookSourceUrl ?? '')))
    return ok({ deleted: deleted > 0 })
  })

  app.post('/reader3/deleteAllBookSources', async () => ok({ deleted: store.deleteAllSources() > 0 }))

  app.get('/reader3/getDefaultBookSourceOwner', async () => ok({ username: null }))

  /* ----------------------------------------------------------------- groups */

  app.get('/reader3/getBookGroups', async () => ok(store.listGroups()))

  app.post('/reader3/saveBookGroup', async (req) => {
    const group = store.saveGroup(req.body || {})
    return ok(String(group.groupId))
  })

  app.post('/reader3/deleteBookGroup', async (req) => {
    store.deleteGroup(req.body?.groupId)
    return ok('删除成功')
  })

  app.post('/reader3/saveBookGroupId', async (req) => {
    const { bookUrl, groupId } = req.body || {}
    const book = store.getBook(String(bookUrl ?? ''))
    if (!book) return fail('书籍不存在')
    store.saveBook({ ...book, group: Number(groupId) || 0 })
    return ok('保存成功')
  })

  /* ----------------------------------------------------------------- search */

  const searchAll = async (keyword, { group, sourceUrl, limit = 0 } = {}) => {
    const sources = enabledSources().filter((source) => {
      if (sourceUrl) return source.bookSourceUrl === sourceUrl
      if (group) return source.bookSourceGroup === group
      return true
    })
    const results = []
    for (const source of sources) {
      try {
        const books = await withRuntime(source.bookSourceUrl, (runtime) => runtime.search(keyword, 1))
        const mapped = (Array.isArray(books) ? books : []).map((book) => toSearchBook(book, source))
        results.push(...mapped)
      } catch (error) {
        app.log.warn(`[search] ${source.bookSourceName}: ${error.message}`)
      }
      if (limit && results.length >= limit) break
    }
    return results
  }

  app.post('/reader3/searchBookMulti', async (req) => {
    const { key, bookSourceGroup, bookSourceUrl } = req.body || {}
    const keyword = String(key ?? '').trim()
    if (!keyword) return fail('请输入搜索关键词')
    const books = await searchAll(keyword, { group: bookSourceGroup, sourceUrl: bookSourceUrl })
    return ok(books)
  })

  app.get('/reader3/searchBookMultiSSE', async (req, reply) => {
    const keyword = String(req.query?.key ?? '').trim()
    const group = req.query?.bookSourceGroup ? String(req.query.bookSourceGroup) : ''
    const sourceUrl = req.query?.bookSourceUrl ? String(req.query.bookSourceUrl) : ''

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    const send = (payload, event) => {
      if (event) reply.raw.write(`event: ${event}\n`)
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
    }

    try {
      if (!keyword) {
        send(fail('请输入搜索关键词'))
      } else {
        const sources = enabledSources().filter((source) => {
          if (sourceUrl) return source.bookSourceUrl === sourceUrl
          if (group) return source.bookSourceGroup === group
          return true
        })
        for (const source of sources) {
          try {
            const books = await withRuntime(source.bookSourceUrl, (runtime) => runtime.search(keyword, 1))
            const mapped = (Array.isArray(books) ? books : []).map((book) => toSearchBook(book, source))
            if (mapped.length) send(ok(mapped))
          } catch (error) {
            send(fail(`${source.bookSourceName}: ${error.message}`))
          }
        }
      }
    } finally {
      send({}, 'end')
      reply.raw.end()
    }
  })

  /* ------------------------------------------------------------ user config */

  app.get('/reader3/getUserInfo', async () => {
    const user = store.getUser()
    return ok({ username: user?.username ?? 'reader', secure: false, isSecure: false })
  })

  app.post('/reader3/login', async () => ok({ username: 'reader', token: '' }))
  app.post('/reader3/logout', async () => ok(null))
  app.post('/reader3/changePassword', async () => fail('当前部署未启用密码登录'))

  app.get('/reader3/getUserConfig', async () => ok(store.getUserConfig()))
  app.post('/reader3/saveUserConfig', async (req) => ok(store.saveUserConfig(req.body || {})))

  /* ------------------------------------------------------------------ cover */

  app.get('/reader3/cover', async (req, reply) => {
    const path = String(req.query?.path ?? '')
    if (!path) return reply.code(400).send('path is required')
    try {
      const upstream = await fetch(path, { headers: { 'user-agent': 'reader-panghu' } })
      if (!upstream.ok) return reply.code(502).send('封面获取失败')
      reply.header('cache-control', 'public, max-age=86400')
      reply.header('content-type', upstream.headers.get('content-type') || 'image/jpeg')
      return reply.send(Buffer.from(await upstream.arrayBuffer()))
    } catch (error) {
      return reply.code(502).send(`封面获取失败: ${error.message}`)
    }
  })

  app.get('/reader3/bookCover/:id', async (req, reply) => {
    const id = String(req.params.id || '')
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(400).send('bad id')
    for (const ext of ['.jpg', '.png', '.webp', '.gif']) {
      try {
        const { createReadStream, existsSync } = await import('node:fs')
        const file = join(coversDir, id + ext)
        if (existsSync(file)) {
          reply.header('content-type', ext === '.jpg' ? 'image/jpeg' : `image/${ext.slice(1)}`)
          return reply.send(createReadStream(file))
        }
      } catch {
        /* try next extension */
      }
    }
    return reply.code(404).send('not found')
  })

  app.post('/reader3/uploadBookCover', async (req, reply) => {
    const bookUrl = String(req.query?.bookUrl ?? '')
    const book = store.getBook(bookUrl)
    if (!book) return fail('书籍不存在')
    const part = await req.file?.()
    if (!part) return fail('缺少图片文件')
    const id = randomUUID()
    const ext = extname(part.filename || '') || '.jpg'
    writeFileSync(join(coversDir, id + ext), await part.toBuffer())
    const saved = store.saveBook({ ...book, customCoverUrl: `/reader3/bookCover/${id}` })
    return ok(saved)
  })

  app.post('/reader3/resetBookCover', async (req) => {
    const bookUrl = String(req.body?.bookUrl ?? '')
    const book = store.getBook(bookUrl)
    if (!book) return fail('书籍不存在')
    return ok(store.saveBook({ ...book, customCoverUrl: '' }))
  })

  /* -------------------------------------------------- chapter update checks */

  app.get('/reader3/getChapterUpdateStatus', async () =>
    ok({ running: false, lastCheckTime: 0, checkedBooks: 0, updatedBooks: [], pendingBooks: [], failedBooks: [], report: null }),
  )
  app.post('/reader3/checkChapterUpdates', async () => ok({ started: false }))

  app.log.info(`[reader3] registered · sources=${store.listSources().length} books=${store.listBooks().length}`)
}

function parseRewrites(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.from && item.to) : []
  } catch {
    return []
  }
}
