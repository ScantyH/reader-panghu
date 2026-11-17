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
import { createRuleRuntime } from './rule-runtime.js'
import { convertText } from './text-convert.js'
import { extractContentImages, sourceTextToPlain } from './source-text.js'
import { extractCards, extractDpMarkers, fetchComments } from './comment-markers.js'
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
    const runtimeConfig = source._runtime || {}
    // 规则型书源（有 searchUrl / ruleSearch、没有 html）走规则引擎
    if (!source.html) {
      if (!source.searchUrl && !source.ruleSearch) {
        throw new SourceError(`书源「${source.bookSourceName || bookSourceUrl}」既没有 html 也没有搜索规则`, {
          code: 'SOURCE_INVALID',
        })
      }
      return createRuleRuntime(source, {
        timeoutMs: runtimeConfig.timeoutMs || timeoutMs,
        userAgent: runtimeConfig.userAgent,
      })
    }
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

  const enabledSources = () =>
    store.listSources().filter((source) => source.enabled !== false && (source.html || source.searchUrl || source.ruleSearch))

  const toSearchBook = (book, source) => ({
    name: String(book?.name ?? ''),
    author: String(book?.author ?? ''),
    bookUrl: String(book?.bookUrl ?? ''),
    origin: String(source.bookSourceUrl ?? ''),
    originName: String(source.bookSourceName ?? ''),
    originGroup: String(source.bookSourceGroup ?? ''),
    coverUrl: String(book?.coverUrl ?? ''),
    intro: sourceTextToPlain(book?.intro),
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
    intro: sourceTextToPlain(cleanIntro(book?.intro ?? existing?.intro ?? '')),
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
    // 卷名/分组信息一并返回，前端据此做缩进
    const list = (Array.isArray(chapters) ? chapters : []).map((chapter, index) => ({
      title: String(chapter?.name ?? `第${index + 1}章`),
      url: String(chapter?.chapterId ?? ''),
      index: Number(chapter?.index ?? index),
      isVolume: Boolean(chapter?.isVolume),
      tag: String(chapter?.tag ?? ''),
    }))
    if (book && list.length) {
      store.saveChapters(book.bookUrl, book.origin, list)
      store.saveBook({ ...book, totalChapterNum: list.length })
    }
    return ok(list)
  })

  /** 段评 / 本章说：解析正文里的 dp 标记，可选拉取评论内容 */
  app.post('/reader3/getParagraphComments', async (req) => {
    const book = store.getBook(String(req.body?.bookUrl ?? ''))
    if (!book) return fail('书籍不存在')
    const origin = String(req.body?.bookSourceUrl || book.origin || '')
    const chapters = store.getChapters(book.bookUrl, book.origin)
    const target = String(req.body?.chapterUrl || chapters[Number(req.body?.index) || 0]?.url || '')
    if (!target) return fail('缺少章节地址')
    try {
      const raw = await withRuntime(origin, (runtime) => runtime.content(target))
      const markers = extractDpMarkers(raw)
      const comments = []
      if (req.body?.withComments) {
        for (const marker of markers.slice(0, 5)) {
          if (!marker.url) continue
          comments.push({ paragraph: marker.paragraph, count: marker.count, ...(await fetchComments(marker.url)) })
        }
      }
      return ok({ markers, comments, cards: extractCards(raw) })
    } catch (error) {
      return fail(error.message)
    }
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
        return chapter ? ok(applyReplaceRules(cleanText(chapter.content), store.listReplaceRules())) : fail('本地章节不存在')
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
    // Cached text is served as-is: caching exists so a book stays readable offline.
    if (!req.body?.refresh && book) {
      const cached = store.getChapterText(cacheKey(book), target)
      if (cached) return ok(applyReplaceRules(cached, store.listReplaceRules()))
    }
    const content = await withRuntime(origin, (runtime) => runtime.content(target))
    const text = applyReplaceRules(cleanText(content), store.listReplaceRules())
    if (book && text) store.saveChapterText(cacheKey(book), book.origin, target, text)
    return ok(text)
  })

  /** Pre-cache the first N chapters so the book can be read offline. */
  app.post('/reader3/cacheBook', async (req) => {
    const { bookUrl, count = 20, refresh } = req.body || {}
    const book = store.getBook(String(bookUrl ?? ''))
    if (!book) return fail('书籍不存在')
    let chapters = store.getChapters(book.bookUrl, book.origin) || []
    if (!chapters.length) {
      // 缓存被清空过：重新抓一次目录，再继续缓存
      const fetched = await withRuntime(book.origin, (runtime) => runtime.chapter(book.tocUrl || book.bookUrl))
      chapters = (Array.isArray(fetched) ? fetched : []).map((chapter, index) => ({
        title: String(chapter?.name ?? `第${index + 1}章`),
        url: String(chapter?.chapterId ?? ''),
        index: Number(chapter?.index ?? index),
      }))
      if (!chapters.length) return fail('取不到目录')
      store.saveChapters(book.bookUrl, book.origin, chapters)
    }
    const limit = Math.min(Number(count) || 20, chapters.length)
    let cached = 0
    for (let index = 0; index < limit; index += 1) {
      const chapter = chapters[index]
      if (!chapter?.url) continue
      if (!refresh && store.getChapterText(cacheKey(book), chapter.url)) continue
      try {
        const text = cleanText(await withRuntime(book.origin, (runtime) => runtime.content(chapter.url)))
        if (text) {
          store.saveChapterText(cacheKey(book), book.origin, chapter.url, text)
          cached += 1
        }
      } catch {
        /* skip a failing chapter, keep caching the rest */
      }
    }
    return ok({ cached, requested: limit, totalCached: store.countChapterTexts(cacheKey(book)) })
  })

  app.post('/reader3/deleteBookCache', async (req) => {
    store.clearChapterTexts(String(req.body?.bookUrl ?? ''))
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
    if (!sources.length) return []

    // 默认只搜前 N 个源：1694 个源全量跑会让接口超时，也没有实际价值
    const maxSources = Math.max(1, Number(process.env.SEARCH_MAX_SOURCES || 200))

    // 串行跑 2000+ 个源要一小时，这里改成有限并发；NAS 是弱机器，默认 6 路
    const SEARCH_CONCURRENCY = Math.max(1, Number(process.env.SEARCH_CONCURRENCY || 6))
    const SEARCH_TIMEOUT_MS = Math.max(2000, Number(process.env.SEARCH_TIMEOUT_MS || 8000))
    // 按历史成功率排序：成功的排前面，从未成功的排后面
    const sourceScore = (source) => {
      const stats = source._stats || {}
      const ok = Number(stats.ok || 0)
      const fail = Number(stats.fail || 0)
      const total = ok + fail
      const rate = total ? ok / total : 0.5
      return rate * 1000 + Math.min(ok, 200) + (stats.lastOk ? 1 : 0)
    }
    const ranked = [...sources].sort((a, b) => sourceScore(b) - sourceScore(a))
    const targets = ranked.slice(0, maxSources)
    const results = []
    let cursor = 0
    let aborted = false

    const runOne = async (source) => {
      if (aborted) return
      try {
        const books = await Promise.race([
          withRuntime(source.bookSourceUrl, (runtime) => runtime.search(keyword, 1)),
          new Promise((_, reject) => setTimeout(() => reject(new Error('搜索超时')), SEARCH_TIMEOUT_MS)),
        ])
        const mapped = (Array.isArray(books) ? books : []).map((book) => toSearchBook(book, source))
        if (mapped.length) results.push(...mapped)
      } catch (error) {
        app.log.warn(`[search] ${source.bookSourceName}: ${error.message}`)
      }
    }

    const worker = async () => {
      while (!aborted) {
        const index = cursor++
        if (index >= targets.length) return
        await runOne(targets[index])
        if (limit && results.length >= limit) aborted = true
      }
    }

    await Promise.all(Array.from({ length: Math.min(SEARCH_CONCURRENCY, targets.length) }, worker))

    // 落库搜索统计，供下次排序使用
    try {
      for (const source of targets) {
        const stats = source._stats || {}
        const hit = results.some((book) => book.origin === source.bookSourceUrl)
        const next = {
          ok: Number(stats.ok || 0) + (hit ? 1 : 0),
          fail: Number(stats.fail || 0) + (hit ? 0 : 1),
          lastOk: hit ? Date.now() : stats.lastOk || 0,
        }
        if (next.ok !== Number(stats.ok || 0) || next.fail !== Number(stats.fail || 0)) {
          store.saveSource({ ...source, _stats: next })
        }
      }
    } catch (error) {
      app.log.warn(`[search] 统计写入失败: ${error.message}`)
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

  app.post('/reader3/resetPassword', async () => fail('请用 /reader3/changePassword'))

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

/** 应用用户的替换规则：默认按正则，isRegex 显式 false 时按纯文本。 */
const applyReplaceRules = (text, rules = []) => {
  let result = String(text ?? '')
  for (const rule of rules) {
    const pattern = rule.pattern ?? rule.find ?? rule.regex ?? ''
    if (!pattern) continue
    const replacement = rule.replacement ?? rule.replace ?? ''
    try {
      result =
        rule.isRegex === false
          ? result.split(pattern).join(replacement)
          : result.replace(new RegExp(pattern, 'g'), replacement)
    } catch {
      // 规则写坏了就跳过，不影响阅读
    }
  }
  return result
}

/** 正文缓存的键：书源 + 书籍地址，避免同一 URL 被不同书源复用时串内容。 */
const cacheKey = (book) => `${book.origin || ''}|${book.bookUrl}`

/** 本地文件书的 origin 只可能是这几个；其他 local:// 是书源自己的 URL 方案。 */
  const isLocalBook = (book) => /^local:\/\/(txt|epub|docx|mobi|pdf)$/.test(String(book?.origin || ''))

  /** 最近一次新章节检查的进度与结果（进程内，重启清空）。 */
  let updateJob = {
    running: false,
    total: 0,
    checked: 0,
    lastCheckTime: 0,
    updatedBooks: [],
    failedBooks: [],
  }

  const toChapterList = (fetched) =>
    (Array.isArray(fetched) ? fetched : []).map((chapter, index) => ({
      title: String(chapter?.name ?? ('第' + (index + 1) + '章')),
      url: String(chapter?.chapterId ?? ''),
      index: Number(chapter?.index ?? index),
    }))

  /** 检查单本书；返回新章节信息或 null。 */
  async function checkOneBook(book) {
    const fetched = await withRuntime(book.origin, (runtime) => runtime.chapter(book.tocUrl || book.bookUrl))
    const chapters = toChapterList(fetched)
    if (!chapters.length) throw new Error('目录为空')

    const before = Number(book.totalChapterNum || 0)
    if (chapters.length > before) {
      store.saveChapters(book.bookUrl, book.origin, chapters)
      store.saveBook({
        ...book,
        totalChapterNum: chapters.length,
        latestChapterTitle: chapters[chapters.length - 1].title,
        lastCheckTime: Date.now(),
      })
      return { bookUrl: book.bookUrl, name: book.name, before, after: chapters.length }
    }
    store.saveBook({ ...book, lastCheckTime: Date.now() })
    return null
  }

  /**
   * 后台跑完整个书架：请求立即返回，界面轮询 getChapterUpdateStatus 看进度。
   * 串行执行，避免同时打爆书源。
   */
  async function runUpdateCheck(books) {
    updateJob = { running: true, total: books.length, checked: 0, lastCheckTime: updateJob.lastCheckTime, updatedBooks: [], failedBooks: [] }
    for (const book of books) {
      try {
        const updated = await checkOneBook(book)
        if (updated) updateJob.updatedBooks.push(updated)
      } catch (error) {
        updateJob.failedBooks.push({ bookUrl: book.bookUrl, name: book.name, error: error.message })
      }
      updateJob.checked += 1
    }
    updateJob.running = false
    updateJob.lastCheckTime = Date.now()
  }

  app.get('/reader3/getChapterUpdateStatus', async () => {
    const localBooks = store.listBooks().filter(isLocalBook).length
    return ok({
      running: updateJob.running,
      total: updateJob.total,
      checked: updateJob.checked,
      lastCheckTime: updateJob.lastCheckTime,
      checkedBooks: updateJob.total,
      updatedBooks: updateJob.updatedBooks,
      pendingBooks: [],
      failedBooks: updateJob.failedBooks,
      report: null,
      localBooks,
    })
  })

  /**
   * 检查书架上的连载书有没有新章节：重新抓目录，与已知章节数比较。
   * 只处理非本地书；单次最多 30 本。
   */
  app.post('/reader3/checkChapterUpdates', async (req) => {
    if (updateJob.running) return ok({ started: false, reason: 'already-running', total: updateJob.total })
    const limit = Math.min(Number(req.body?.limit) || 30, 30)
    const books = store
      .listBooks()
      .filter((book) => !isLocalBook(book))
      .slice(0, limit)
    if (!books.length) return ok({ started: false, reason: 'no-books', total: 0 })

    void runUpdateCheck(books)
    return ok({ started: true, total: books.length })
  })

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
