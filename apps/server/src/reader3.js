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
import { extractCards, extractDpMarkers } from './comment-markers.js'
import { applySourceLine } from './source-tools.js'
import { cleanIntro, cleanText } from './text.js'
import { bookQuotaError, permissionsFor, sourceQuotaError } from './user-perms.js'

const ok = (data) => ({ isSuccess: true, errorMsg: '', data })
const fail = (errorMsg, data = null) => ({ isSuccess: false, errorMsg, data })

/** 书源批次默认上限 100，可用 SOURCE_BUNDLE_LIMIT 调整 */
const SOURCE_BUNDLE_LIMIT = (() => {
  const value = Math.floor(Number(process.env.SOURCE_BUNDLE_LIMIT || 100))
  return Number.isFinite(value) && value > 0 ? value : 100
})()

const now = () => Date.now()

export function registerReader3(app, { store, dataDir, options = {} }) {
  const coversDir = join(dataDir, 'covers')
  mkdirSync(coversDir, { recursive: true })
  const timeoutMs = Number(options.timeoutMs || process.env.SOURCE_TIMEOUT_MS || 45000)
  const globalRewrites = parseRewrites(process.env.SOURCE_REWRITES)
  const globalKey = process.env.SOURCE_KEY || ''
  // 段评地址只在服务端短期缓存：前端只拿段落序号/条数，不接触带 key 的地址
  const dpMarkerCache = new Map()
  const dpCacheKey = (bookUrl, chapterUrl, paragraph) => `${bookUrl}|${chapterUrl}|${paragraph}`
  const cacheDpMarkers = (bookUrl, chapterUrl, markers) => {
    const now = Date.now()
    for (const marker of markers) {
      if (!marker.url) continue
      dpMarkerCache.set(dpCacheKey(bookUrl, chapterUrl, marker.paragraph), { url: marker.url, at: now })
    }
    if (dpMarkerCache.size > 800) {
      for (const [key, value] of dpMarkerCache) {
        if (now - value.at > 15 * 60 * 1000) dpMarkerCache.delete(key)
      }
    }
  }

  // 正文卡片图（神评论 / 本章说 / 插图）短期缓存，前端只拿 id，不接触原地址和 headers
  const cardImageCache = new Map()
  const cacheCardImage = (card) => {
    const src = String(card?.src || '')
    const paragraph = Number.isFinite(Number(card?.paragraph)) ? Number(card.paragraph) : 0
    if (/^data:image\//i.test(src)) {
      if (src.length > 2 * 1024 * 1024) return null
      return { paragraph, src, alt: String(card?.alt || '') }
    }
    if (!/^https?:\/\//i.test(src)) return null
    const id = randomUUID()
    cardImageCache.set(id, { url: src, headers: card?.headers || {}, at: Date.now() })
    if (cardImageCache.size > 400) {
      const now = Date.now()
      for (const [key, value] of cardImageCache) {
        if (now - value.at > 15 * 60 * 1000) cardImageCache.delete(key)
      }
    }
    return { paragraph, src: `/reader3/contentImage?id=${id}`, alt: String(card?.alt || '') }
  }

  /** 返回给前端的书源不能包含密钥：只告诉「是否已设置」和末四位 */
  const sanitizeSource = (source) => {
    if (!source || typeof source !== 'object') return source
    const runtime = { ...(source._runtime || {}) }
    const key = String(runtime.key || '')
    delete runtime.key
    return { ...source, _runtime: runtime, hasKey: Boolean(key), keyHint: key ? key.slice(-4) : '', keyCheck: source._keyCheck || null }
  }
  // 网页与 App 订阅同一条 SSE 流：任一设备写入进度，其它在线设备立刻收到，
  // 不必等轮询；断线时客户端自己降级为定时查询。
  const progressClients = new Set()

  const progressPayload = (book) => ({
    bookUrl: book.bookUrl,
    index: Number(book.durChapterIndex || 0),
    position: Number(book.durChapterPos || 0),
    chapterTitle: book.durChapterTitle || '',
    updatedAt: Number(book.durChapterTime || 0),
    device: book.lastDevice || '',
  })

  const broadcastProgress = (userId, payload) => {
    const frame = `data: ${JSON.stringify(payload)}\n\n`
    for (const client of progressClients) {
      if (client.userId !== userId) continue
      try {
        client.res.write(frame)
      } catch {
        progressClients.delete(client)
      }
    }
  }

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
    return createRuntime(applySourceLine(source), {
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
    hasUpdate: Boolean(existing?.hasUpdate),
    newChapterCount: Number(existing?.newChapterCount || 0),
  })

  /* ------------------------------------------------------------------ shelf */

  /** 老书没存过已读章节名时，从缓存的目录里补一次，保证书架能显示章节名称 */
  const withReadTitle = (book) => {
    if (String(book.durChapterTitle || '').trim()) return book
    const chapters = store.getChapters(book.bookUrl, book.origin)
    const title = Array.isArray(chapters) ? chapters[Math.max(0, Number(book.durChapterIndex) || 0)]?.title : ''
    return title ? { ...book, durChapterTitle: title } : book
  }

  app.get('/reader3/getBookshelf', async () => ok(store.listBooks().map(withReadTitle)))

  app.get('/reader3/getShelfBookWithCacheInfo', async () => {
    const books = store.listBooks().map(withReadTitle).map((book) => ({
      ...book,
      // 缓存管理要显示「正文已缓存」的真实章数；countChapters 是目录条数，
      // 会把整本目录都算成已缓存。
      cachedChapterCount: store.countChapterTexts(cacheKey(book)),
      browserCachedChapterCount: 0,
    }))
    return ok(books)
  })

  app.post('/reader3/getShelfBook', async (req) => {
    const book = store.getBook(String(req.body?.url ?? ''))
    return book ? ok(book) : fail('书籍不在书架中')
  })

/** 已加入书架但还没抓过目录的书：后台补目录 + 首章 + 末章 */
const priming = new Set()

async function primeBook(book) {
  if (!book?.bookUrl || priming.has(book.bookUrl)) return
  const origin = String(book.origin || '')
  if (!origin || /^local:\/\//i.test(origin)) return
  if ((store.getChapters(book.bookUrl, origin) || []).length) return

  priming.add(book.bookUrl)
  try {
    const fetched = await withRuntime(origin, (runtime) => runtime.chapter(book.tocUrl || book.bookUrl))
    const chapters = (Array.isArray(fetched) ? fetched : []).map((chapter, index) => ({
      title: String(chapter?.name ?? `第${index + 1}章`),
      url: String(chapter?.chapterId ?? ''),
      index: Number(chapter?.index ?? index),
    }))
    if (!chapters.length) return

    store.saveChapters(book.bookUrl, origin, chapters)
    store.saveBook({
      ...book,
      totalChapterNum: chapters.length,
      latestChapterTitle: chapters[chapters.length - 1].title,
    })

    // 预热首章与末章正文，打开书时不用等
    for (const index of [0, chapters.length - 1]) {
      const chapter = chapters[index]
      if (!chapter?.url) continue
      try {
        const raw = await withRuntime(origin, (runtime) => runtime.content(chapter.url))
        const text = applyReplaceRules(cleanText(raw, { dropImages: true }), store.listReplaceRules())
        if (text) store.saveChapterText(cacheKey(book), origin, chapter.url, text)
      } catch {
        /* 单章失败不影响其它 */
      }
    }
  } catch (error) {
    app.log.warn(`[prime] ${book.bookUrl}: ${error.message}`)
  } finally {
    priming.delete(book.bookUrl)
  }
}

  /** 子账号被管理员关闭「编辑书源」时，所有写书源接口统一拒绝 */
  const editSourcesBlocked = (req) =>
    permissionsFor(store, req).allowEditSources ? '' : '当前账号没有编辑书源的权限，请联系管理员'

  app.post('/reader3/saveBook', async (req) => {
    const book = req.body || {}
    const url = String(book.bookUrl || '')
    if (url && !store.getBook(url)) {
      const quota = bookQuotaError(store, req, 1)
      if (quota) return fail(quota)
    }
    const saved = store.saveBook(book)
    primeBook(saved).catch(() => {})
    return ok(saved)
  })

  app.post('/reader3/saveBooks', async (req) => {
    const list = Array.isArray(req.body) ? req.body : []
    const newCount = list.filter((book) => book?.bookUrl && !store.getBook(String(book.bookUrl))).length
    if (newCount) {
      const quota = bookQuotaError(store, req, newCount)
      if (quota) return fail(quota)
    }
    const saved = store.saveBooks(list)
    for (const book of list) primeBook(store.getBook(String(book?.bookUrl ?? '')) || book).catch(() => {})
    return ok(saved)
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
    const { bookUrl, index, position, clientUpdatedAt, chapterTitle, device, clientId } = req.body || {}
    const updated = store.saveProgress({
      bookUrl: String(bookUrl ?? ''),
      index,
      position,
      clientUpdatedAt,
      chapterTitle,
      device,
    })
    if (!updated) return fail('书籍不存在')
    // 被拒的旧写入也要返回服务端权威值，客户端据此直接纠正本地位置。
    const accepted = updated.progressAccepted !== false
    const payload = progressPayload(updated)
    // clientId 只用于让写入方忽略自己的回声，不落库。
    if (accepted) broadcastProgress(req.userId ?? 1, { ...payload, clientId: String(clientId || '') })
    return ok({ accepted, ...payload })
  })

  /** 轻量读取单本进度：App 前台回来、切书时只拉这一条。 */
  app.get('/reader3/getBookProgress', async (req) => {
    const bookUrl = String(req.query?.bookUrl || '')
    if (!bookUrl) return fail('缺少 bookUrl')
    const book = store.getBook(bookUrl)
    if (!book) return fail('书籍不存在')
    return ok(progressPayload(book))
  })

  /** 进度推送流（SSE）：客户端断线会自动重连，心跳保持连接不被代理掐断。 */
  app.get('/reader3/progressSSE', (req, reply) => {
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write(': connected\n\n')
    const client = { res, userId: req.userId ?? 1 }
    progressClients.add(client)
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch {
        clearInterval(heartbeat)
        progressClients.delete(client)
      }
    }, 25000)
    heartbeat.unref?.()
    req.raw.on('close', () => {
      clearInterval(heartbeat)
      progressClients.delete(client)
    })
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
      if (cached?.length) {
        const latest = cached.at(-1)?.title || ''
        if (Number(book.totalChapterNum || 0) !== cached.length || (latest && book.latestChapterTitle !== latest)) {
          store.saveBook({ ...book, totalChapterNum: cached.length, latestChapterTitle: latest })
        }
        return ok(cached)
      }
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
      store.saveBook({ ...book, totalChapterNum: list.length, latestChapterTitle: list.at(-1)?.title || book.latestChapterTitle || '' })
    }
    return ok(list)
  })

  /** 段评 / 本章说：只返回段落序号和条数，评论地址留在服务端 */
  app.post('/reader3/getParagraphComments', async (req) => {
    const book = store.getBook(String(req.body?.bookUrl ?? ''))
    if (!book) return fail('书籍不存在')
    const origin = String(req.body?.bookSourceUrl || book.origin || '')
    const chapters = store.getChapters(book.bookUrl, book.origin)
    const target = String(req.body?.chapterUrl || chapters[Number(req.body?.index) || 0]?.url || '')
    if (!target) return fail('缺少章节地址')
    try {
      const raw = await withRuntime(origin, (runtime) => runtime.content(target))
      const parsed = extractDpMarkers(raw, {
        transform: (text) => applyReplaceRules(text, store.listReplaceRules()),
      })
      cacheDpMarkers(book.bookUrl, target, parsed)
      const markers = parsed.map(({ paragraph, count }) => ({ paragraph, count }))
      const cards = extractCards(raw).map(cacheCardImage).filter(Boolean)
      return ok({ markers, cards })
    } catch (error) {
      return fail(error.message)
    }
  })

  /** 取某一段的段评面板；由服务端代理评论地址，不把带 key 的地址发给前端 */
  app.post('/reader3/getParagraphCommentPanel', async (req) => {
    const book = store.getBook(String(req.body?.bookUrl ?? ''))
    if (!book) return fail('书籍不存在')
    const origin = String(req.body?.bookSourceUrl || book.origin || '')
    const chapters = store.getChapters(book.bookUrl, book.origin)

    const commentUrl = (...values) => {
      for (const value of values) {
        const candidate = typeof value === 'string' ? value : value?.Url || value?.url || value?.Src || value?.src
        if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) return candidate
      }
      return ''
    }
    const commentImages = (item) => {
      const out = []
      const add = (value) => {
        if (!value) return
        if (Array.isArray(value)) return value.forEach(add)
        if (typeof value === 'object') {
          const url = commentUrl(value)
          if (url) out.push(url)
          return
        }
        const text = String(value)
        const src = /<img[^>]+src=["']([^"']+)["']/gi
        let match
        while ((match = src.exec(text))) out.push(match[1])
        if (/^https?:\/\//i.test(text)) out.push(text)
      }
      add(item.Images)
      add(item.ImageList)
      add(item.PicList)
      add(item.PicUrls)
      add(item.ImageUrls)
      add(item.Pictures)
      add(item.Attachments)
      add(item.PicUrl)
      add(item.ImageUrl)
      add(item.PictureUrl)
      add(item.Content)
      return [...new Set(out)].slice(0, 6)
    }
    const mapComment = (item) => {
      const content = String(item.Content || item.content || '')
      return {
        id: String(item.Id || item.id || ''),
        user: String(item.UserName || item.userName || '书友'),
        avatar: commentUrl(item.UserHeadIcon, item.HeadIcon, item.Avatar, item.UserAvatar),
        content: content.replace(/<img[^>]*>/gi, '').trim(),
        quote: String(item.RefferContent || item.quote || ''),
        agree: Number(item.AgreeAmount || item.agree || 0),
        disagree: Number(item.OpposeAmount || item.disagree || 0),
        ip: String(item.IpLocation || ''),
        time: Number(item.CreateTime || 0),
        images: commentImages(item),
        audio: commentUrl(item.AudioUrl, item.VoiceUrl, item.SoundUrl, item.MediaUrl, item.Audio, item.Voice),
        audioTime: Number(item.AudioTime || item.AudioDuration || item.VoiceTime || item.SoundTime || 0),
        floor: Number(item.Floor || 0),
        replyCount: Number(item.ReviewCount || 0),
        titles: Array.isArray(item.TitleInfoList)
          ? item.TitleInfoList.map((title) => String(title.TitleName || '')).filter(Boolean).slice(0, 3)
          : [],
      }
    }
    const target = String(req.body?.chapterUrl || chapters[Number(req.body?.index) || 0]?.url || '')
    if (!target) return fail('缺少章节地址')
    let markerHost = ''
    try {
      const paragraph = Number(req.body?.paragraph)
      let markerUrl = dpMarkerCache.get(dpCacheKey(book.bookUrl, target, paragraph))?.url || ''
      if (!markerUrl) {
        const raw = await withRuntime(origin, (runtime) => runtime.content(target))
        const parsed = extractDpMarkers(raw, {
          transform: (text) => applyReplaceRules(text, store.listReplaceRules()),
        })
        cacheDpMarkers(book.bookUrl, target, parsed)
        markerUrl = parsed.find((item) => Number(item.paragraph) === paragraph)?.url || ''
      }
      if (!markerUrl) return fail('这一段没有段评')
      try {
        markerHost = new URL(markerUrl).host
      } catch {
        /* ignore */
      }
      const source = store.getSource(origin)
      const lineUrl = String(source?._line?.url || '').trim()
      let panelUrl = ''
      try {
        const pageUrl = new URL(markerUrl)
        if (lineUrl) {
          const line = new URL(lineUrl)
          pageUrl.protocol = line.protocol
          pageUrl.host = line.host
        }
        const key = String(source?._runtime?.key || process.env.SOURCE_KEY || '')
        if (key) pageUrl.searchParams.set('k', key)
        panelUrl = pageUrl.toString()
      } catch {
        panelUrl = ''
      }
      const apiUrl = new URL(markerUrl)
      apiUrl.pathname = apiUrl.pathname.replace(/\/qddp\/?$/, '/qddp/api')
      const offset = Math.max(0, Number(req.body?.offset) || 0)
      const limit = Math.max(1, Math.min(20, Number(req.body?.limit) || 10))
      const tab = ['all', 'img', 'audio'].includes(String(req.body?.tab)) ? String(req.body.tab) : 'all'
      apiUrl.searchParams.set('tab', tab)
      apiUrl.searchParams.set('pg', String(Math.floor(offset / limit) + 1))
      apiUrl.searchParams.set('pz', String(limit))
      apiUrl.searchParams.set('offset', String(offset))
      if (req.body?.sort === 'new') apiUrl.searchParams.set('sort', '0')
      else if (req.body?.sort === 'hot') apiUrl.searchParams.set('sort', '1')
      // 起点类书源的 /qddp/api 需要 k/did/ts/sign 签名；直接 fetch 会 401。
      // 优先调用书源自己的 qget()，由书源运行时带上密钥、设备指纹、Cookie 和签名。
      let payload = null
      let qgetError = ''
      try {
        const signed = await withRuntime(origin, async (runtime) => {
          if (typeof runtime.window?.qget !== 'function') return null
          const request = () => runtime.window.qget(apiUrl.toString())
          const finish = (result) => {
            if (result?.statusCode && Number(result.statusCode) >= 400) {
              throw new Error(`HTTP ${result.statusCode}`)
            }
            return result?.data ?? null
          }
          try {
            return finish(await request())
          } catch {
            // 仅首次失败时再初始化一次正文会话，避免每次段评都多等一次正文请求
            try {
              await runtime.content(target)
            } catch {
              /* 正文失败不阻塞评论重试 */
            }
            return finish(await request())
          }
        })
        if (signed) payload = JSON.parse(String(signed))
      } catch (error) {
        qgetError = error.message
      }
      if (!payload) {
        try {
          const response = await fetch(apiUrl, {
            headers: {
              'user-agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
              referer: `${origin}/`,
              accept: 'application/json, text/plain, */*',
            },
            signal: AbortSignal.timeout(20000),
          })
          if (response.ok) payload = await response.json()
        } catch {
          /* 下面统一走 HTML 面板兜底 */
        }
      }
      if (!payload) {
        // 有些段落的 /qddp/api 仍会 401，但书源自己的面板 HTML 能正常出数据。
        // 用书源的 qdPanelHtml() 取整页面板，前端用 iframe 显示，保证评论可见。
        try {
          const panelHtml = await withRuntime(origin, async (runtime) => {
            if (typeof runtime.window?.qdPanelHtml !== 'function') return ''
            return String((await runtime.window.qdPanelHtml(markerUrl)) || '')
          })
          if (panelHtml && panelHtml.includes('__QD_BOOT__')) {
            try {
              const bootStart = panelHtml.indexOf('window.__QD_BOOT__=')
              const bootEnd = bootStart >= 0 ? panelHtml.indexOf(';window.', bootStart) : -1
              const bootText = bootStart >= 0 && bootEnd > bootStart ? panelHtml.slice(bootStart + 'window.__QD_BOOT__='.length, bootEnd) : ''
              const boot = bootText ? JSON.parse(bootText) : null
              const raw = boot?.page?.Data?.DataList || boot?.page?.data || []
              const total = Number(boot?.counts?.all || boot?.page?.total || raw.length || 0)
              const comments = raw.slice(0, limit).map(mapComment)
              if (comments.length) return ok({ comments, total, offset: 0, limit, hasMore: false, panelUrl, counts: { all: total, img: 0, audio: 0 } })
            } catch {
              /* 解析失败再退回 HTML */
            }
            return ok({ html: panelHtml.slice(0, 1024 * 1024), comments: [], total: 0, offset: 0, limit, hasMore: false, panelUrl })
          }
        } catch {
          /* ignore */
        }
        return fail(`段评接口返回 401（${markerHost}）${qgetError ? `：${qgetError}` : ''}`)
      }
      const data = payload?.Data || payload?.data || {}
      const list = data.DataList || data.data || data.list || []
      const total = Number(data.TotalCount || data.total || list.length)
      const comments = list.slice(0, limit).map(mapComment)
      return ok({
        comments,
        total,
        offset,
        limit,
        hasMore: offset + comments.length < total,
        panelUrl,
        counts: data.Counts || data.counts || payload.Counts || payload.counts || { all: total, img: 0, audio: 0 },
      })
    } catch (error) {
      return fail(`段评接口请求失败：${error.message}${error.cause?.code ? `（${error.cause.code}）` : ''}${markerHost ? ` ${markerHost}` : ''}`)
    }
  })

  app.post('/reader3/getCommentReplies', async (req) => {
    const book = store.getBook(String(req.body?.bookUrl ?? ''))
    if (!book) return fail('书籍不存在')
    const origin = String(req.body?.bookSourceUrl || book.origin || '')
    const target = String(req.body?.chapterUrl || store.getChapters(book.bookUrl, book.origin)[Number(req.body?.index) || 0]?.url || '')
    const paragraph = Number(req.body?.paragraph)
    const rootReviewId = String(req.body?.rootReviewId || '')
    if (!target || !rootReviewId) return fail('缺少回复参数')
    try {
      let markerUrl = dpMarkerCache.get(dpCacheKey(book.bookUrl, target, paragraph))?.url || ''
      if (!markerUrl) {
        const raw = await withRuntime(origin, (runtime) => runtime.content(target))
        const parsed = extractDpMarkers(raw, { transform: (text) => applyReplaceRules(text, store.listReplaceRules()) })
        cacheDpMarkers(book.bookUrl, target, parsed)
        markerUrl = parsed.find((item) => Number(item.paragraph) === paragraph)?.url || ''
      }
      if (!markerUrl) return fail('这一段没有段评')
      const page = new URL(markerUrl)
      const bookId = page.searchParams.get('bookId')
      const chapterId = page.searchParams.get('chapterId')
      if (!bookId || !chapterId) return fail('缺少章节标识')
      const url = new URL(`/book/${bookId}/chapter/${chapterId}/comments/review`, page.origin)
      url.searchParams.set('paragraphId', String(paragraph + 1))
      url.searchParams.set('rootReviewId', rootReviewId)
      url.searchParams.set('pg', String(Math.max(1, Number(req.body?.page) || 1)))
      url.searchParams.set('pz', String(Math.max(1, Math.min(20, Number(req.body?.limit) || 6))))
      const source = store.getSource(origin)
      const key = page.searchParams.get('k') || String(source?._runtime?.key || '')
      if (key) url.searchParams.set('k', key)
      const signed = await withRuntime(origin, (runtime) => runtime.window.qget(url.toString()))
      if (signed?.statusCode >= 400) throw new Error(`HTTP ${signed.statusCode}`)
      const payload = JSON.parse(String(signed?.data || '{}'))
      const data = payload?.Data || payload?.data || {}
      const list = data.DataList || data.data || []
      const total = Number(data.TotalCount || data.total || list.length)
      const replies = list.map((item) => ({
        id: String(item.Id || item.id || ''),
        user: String(item.UserName || '书友'),
        avatar: String(item.UserHeadIcon || item.HeadIcon || ''),
        content: String(item.Content || ''),
        quote: String(item.RefferContent || ''),
        agree: Number(item.AgreeAmount || 0),
        time: Number(item.CreateTime || 0),
        floor: Number(item.Floor || 0),
        titles: Array.isArray(item.TitleInfoList) ? item.TitleInfoList.map((title) => String(title.TitleName || '')).filter(Boolean).slice(0, 2) : [],
      }))
      return ok({ replies, total, hasMore: Number(req.body?.page || 1) * Number(req.body?.limit || 6) < total })
    } catch (error) {
      return fail(`回复加载失败：${error.message}`)
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
        return chapter ? ok(applyReplaceRules(cleanText(chapter.content, { dropImages: true }), store.listReplaceRules())) : fail('本地章节不存在')
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
      if (cached) return ok(applyReplaceRules(cleanText(cached, { dropImages: true }), store.listReplaceRules()))
    }
    const content = await withRuntime(origin, (runtime) => runtime.content(target))
    const text = applyReplaceRules(cleanText(content, { dropImages: true }), store.listReplaceRules())
    if (book && text) store.saveChapterText(cacheKey(book), book.origin, target, text)
    return ok(text)
  })

  /** Pre-cache the first N chapters so the book can be read offline. */
  app.post('/reader3/cacheBook', async (req) => {
    const { bookUrl, count = 20, refresh, start = 0 } = req.body || {}
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
    const from = Math.max(0, Math.min(Number(start) || 0, Math.max(0, chapters.length - 1)))
    const limit = Math.max(1, Number(count) || 20)
    const to = Math.min(from + limit, chapters.length)
    let cached = 0
    for (let index = from; index < to; index += 1) {
      const chapter = chapters[index]
      if (!chapter?.url) continue
      if (!refresh && store.getChapterText(cacheKey(book), chapter.url)) continue
      try {
        const text = cleanText(await withRuntime(book.origin, (runtime) => runtime.content(chapter.url)), { dropImages: true })
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
    const bookUrl = String(req.body?.bookUrl ?? '')
    // 正文缓存按 `origin|bookUrl` 存，直接拿 bookUrl 删不掉；旧实现因此清不干净。
    const book = store.getBook(bookUrl)
    store.clearChapterTexts(book ? cacheKey(book) : bookUrl)
    store.deleteChapters(bookUrl)
    return ok('已清除缓存')
  })

  const isLocalOrigin = (origin) => /^local:\/\//i.test(String(origin || ''))

  const looksLikeSourceError = (text) =>
    /(加载失败|获取失败|请求失败|密钥|设备数已满|书源不存在|章节不存在|找不到章节|HTTP\s*(4\d\d|5\d\d)|超时|timeout)/i.test(String(text || ''))

  const mapChapters = (chapters) =>
    (Array.isArray(chapters) ? chapters : []).map((chapter, index) => ({
      title: String(chapter?.name ?? `第${index + 1}章`),
      url: String(chapter?.chapterId ?? ''),
      index: Number(chapter?.index ?? index),
      isVolume: Boolean(chapter?.isVolume),
      tag: String(chapter?.tag ?? ''),
    }))

  /** Switch the source a shelf book reads from, keeping its progress. */
  app.post('/reader3/setBookSource', async (req) => {
    const { bookUrl, newUrl, bookSourceUrl } = req.body || {}
    const existing = store.getBook(String(bookUrl ?? ''))
    if (existing && isLocalOrigin(existing.origin)) return fail('本地书籍不需要换源')
    const sourceUrl = String(bookSourceUrl ?? '')
    const oldChapters = existing ? store.getChapters(existing.bookUrl, existing.origin) || [] : []
    const oldIndex = Number(existing?.durChapterIndex || 0)
    const oldTitle = oldChapters[oldIndex]?.title || String(existing?.durChapterTitle || '')
    const { info, chapters } = await withRuntime(sourceUrl, async (runtime) => {
      const nextInfo = await runtime.info(String(newUrl ?? bookUrl))
      let nextChapters = []
      try {
        nextChapters = mapChapters(await runtime.chapter(nextInfo.tocUrl || nextInfo.bookUrl || newUrl))
      } catch {
        /* 目录失败不阻塞换源，继续用原进度 */
      }
      return { info: nextInfo, chapters: nextChapters }
    })
    const source = store.getSource(sourceUrl)
    const stableBookUrl = existing?.bookUrl || String(newUrl ?? bookUrl)
    const next = toBook({ ...info, bookUrl: stableBookUrl }, source, existing)
    if (chapters.length) {
      const matched = oldTitle ? chapters.findIndex((chapter) => chapter.title === oldTitle) : -1
      const target = matched >= 0 ? matched : Math.min(Math.max(0, oldIndex), chapters.length - 1)
      next.durChapterIndex = target
      next.durChapterTitle = chapters[target]?.title || next.durChapterTitle
      next.totalChapterNum = chapters.length
      next.latestChapterTitle = chapters.at(-1)?.title || next.latestChapterTitle
      store.saveChapters(next.bookUrl, next.origin, chapters)
    }
    store.deleteChapters(String(bookUrl ?? ''))
    return ok(store.saveBook(next))
  })

  /* ---------------------------------------------------------------- sources */

  app.get('/reader3/getBookSources', async () => ok(store.listSources().map(sanitizeSource)))

  /** 解析书源内置线路表（如胖虎的 QD_FIXED），并测速 */
  const sourceLinesOf = (source) => {
    const html = String(source?.html || '')
    const lines = []
    const fixed = /QD_FIXED\s*=\s*\[([\s\S]*?)\]\s*\.filter/.exec(html)?.[1] || ''
    for (const match of fixed.matchAll(/\{\s*name:\s*["']([^"']+)["']\s*,\s*url:\s*["']([^"']+)["']\s*\}/g)) {
      const name = match[1].trim()
      const url = match[2].trim().replace(/\/$/, '')
      if (/^https?:\/\//i.test(url) && !lines.some((line) => line.url === url)) lines.push({ name, url })
    }
    if (!lines.length) {
      const main = /var\s+API\s*=\s*["']([^"']+)["']/.exec(html)?.[1]
      if (main) lines.push({ name: '主线路', url: main.replace(/\/$/, '') })
    }
    return lines
  }

  app.get('/reader3/getSourceLines', async (req) => {
    const source = store.getSource(String(req.query?.bookSourceUrl || ''))
    if (!source) return fail('书源不存在')
    const lines = sourceLinesOf(source)
    if (!lines.length) return ok({ sourceName: source.bookSourceName, current: source.bookSourceUrl, lines: [] })
    const measured = await Promise.all(
      lines.map(async (line) => {
        const started = Date.now()
        try {
          const response = await fetch(`${line.url}/ping`, { signal: AbortSignal.timeout(1800) })
          return { ...line, latency: response.ok ? Date.now() - started : -1, ok: response.ok }
        } catch {
          return { ...line, latency: -1, ok: false }
        }
      }),
    )
    const current = source._line?.url || measured[0]?.url || ''
    return ok({ sourceName: source.bookSourceName, current, lines: measured })
  })

  app.post('/reader3/setSourceLine', async (req) => {
    const source = store.getSource(String(req.body?.bookSourceUrl || ''))
    if (!source) return fail('书源不存在')
    const lines = sourceLinesOf(source)
    const wanted = String(req.body?.url || '')
    const line = lines.find((item) => item.url === wanted) || lines.find((item) => item.name === String(req.body?.name || ''))
    if (!line) return fail('线路不存在')
    store.saveSource({ ...source, _line: { name: line.name, url: line.url } })
    return ok({ current: line.url, name: line.name })
  })

  /** 轻量书源列表：不带 html / 规则正文，手机端列表专用。 */
  app.get('/reader3/getBookSourceList', async () =>
    ok(
      store.listSources().map((source) => ({
        bookSourceUrl: String(source.bookSourceUrl || ''),
        bookSourceName: String(source.bookSourceName || '未命名书源'),
        bookSourceGroup: String(source.bookSourceGroup || ''),
        bundle: String(source._bundle || ''),
        enabled: source.enabled !== false,
        type: source.html ? 'webview' : 'rule',
        invalid: Boolean(source.invalid),
        hasKey: Boolean(source._runtime?.key),
      })),
    ),
  )

  app.post('/reader3/getBookSource', async (req) => {
    const source = store.getSource(String(req.body?.bookSourceUrl ?? ''))
    return source ? ok(sanitizeSource(source)) : fail('书源不存在')
  })

  /** 保存编辑时保留服务端已有的书源密钥（前端不会拿到明文） */
  const preserveSourceKey = (source, existing) => {
    const incoming = source?._runtime || {}
    const runtime = { ...(existing?._runtime || {}), ...incoming }
    if (!Object.prototype.hasOwnProperty.call(incoming, 'key') && existing?._runtime?.key !== undefined) {
      runtime.key = existing._runtime.key
    }
    return { ...source, _runtime: runtime }
  }

  app.post('/reader3/saveBookSource', async (req) => {
    const blocked = editSourcesBlocked(req)
    if (blocked) return fail(blocked)
    const source = req.body || {}
    const url = String(source.bookSourceUrl || '')
    const existing = url ? store.getSource(url) : null
    if (url && !existing) {
      const quota = sourceQuotaError(store, req, 1)
      if (quota) return fail(quota)
    }
    store.saveSource(preserveSourceKey(source, existing))
    return ok({ saved: true })
  })

  /** 单独设置 WebView 书源的密钥；只存服务端，不回传明文 */
  app.post('/reader3/setSourceKey', async (req) => {
    const blocked = editSourcesBlocked(req)
    if (blocked) return fail(blocked)
    const url = String(req.body?.bookSourceUrl ?? '')
    const source = store.getSource(url)
    if (!source) return fail('书源不存在')
    const key = String(req.body?.key ?? '').trim()
    const runtime = { ...(source._runtime || {}) }
    if (key) runtime.key = key
    else delete runtime.key
    store.saveSource({ ...source, _runtime: runtime })
    return ok({ hasKey: Boolean(key), keyHint: key ? key.slice(-4) : '' })
  })

  /** 书源批次的汇总统计：搜索页只需要这些数字，不用把上千个书源发给前端 */
  app.get('/reader3/getSourceBundles', async () => {
    const rows = new Map()
    for (const source of store.listSources()) {
      const name = String(source._bundle || '未归类')
      if (!rows.has(name)) rows.set(name, { name, count: 0, enabledCount: 0, searchableCount: 0 })
      const row = rows.get(name)
      row.count += 1
      if (source.enabled !== false) {
        row.enabledCount += 1
        if (source.html || source.searchUrl) row.searchableCount += 1
      }
    }
    return ok(
      [...rows.values()],
    )
  })

  app.get('/reader3/getSourceBundleLimit', async () => ok({ limit: SOURCE_BUNDLE_LIMIT }))

  /** 每小时检测一次设置了密钥的书源是否仍然有效 */
  app.post('/reader3/checkSourceKeys', async () => {
    const interval = 60 * 60 * 1000
    const now = Date.now()
    const sources = store.listSources().filter((source) => source._runtime?.key)
    const results = []
    let checked = 0
    for (const source of sources) {
      const checkedAt = Number(source._keyCheck?.checkedAt || 0)
      if (now - checkedAt < interval) {
        results.push({ bookSourceUrl: source.bookSourceUrl, ...source._keyCheck })
        continue
      }
      let valid = false
      let message = ''
      try {
        const books = await Promise.race([
          withRuntime(source.bookSourceUrl, (runtime) => runtime.search('斗罗大陆', 1)),
          new Promise((_, reject) => setTimeout(() => reject(new Error('检测超时')), 12000)),
        ])
        valid = true
        message = `可用（${Array.isArray(books) ? books.length : 0} 个结果）`
      } catch (error) {
        valid = false
        message = error.message || '检测失败'
      }
      source._keyCheck = { valid, message, checkedAt: Date.now() }
      store.saveSource(source)
      checked += 1
      results.push({ bookSourceUrl: source.bookSourceUrl, ...source._keyCheck })
    }
    return ok({ checked, results })
  })

  /** 导入书源：每次都必须新建一个批次，同名自动加序号，不覆盖已有批次 */
  app.post('/reader3/importBookSources', async (req) => {
    const blocked = editSourcesBlocked(req)
    if (blocked) return fail(blocked)
    const list = Array.isArray(req.body?.sources) ? req.body.sources : []
    const prepared = list
      .filter((source) => source && source.bookSourceUrl)
      .map((source) => ({ ...source }))
    if (!prepared.length) return fail('没有解析出书源')
    const newCount = prepared.filter((source) => !store.getSource(String(source.bookSourceUrl))).length
    if (newCount) {
      const quota = sourceQuotaError(store, req, newCount)
      if (quota) return fail(quota)
    }
    const names = new Set(store.listSources().map((source) => String(source._bundle || '未归类')))
    if (names.size >= SOURCE_BUNDLE_LIMIT) {
      return fail(`书源批次已达上限 ${SOURCE_BUNDLE_LIMIT} 个，请先汇总或删除旧批次`)
    }
    const requested =
      String(req.body?.name || '').trim() ||
      `导入 ${new Date().toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
    let bundle = requested
    for (let index = 2; names.has(bundle); index += 1) bundle = `${requested} (${index})`
    store.saveSources(prepared.map((source) => ({ ...source, _bundle: bundle })))
    return ok({ bundle, count: prepared.length, bundles: names.size + 1 })
  })

  app.post('/reader3/renameBundle', async (req) => {
    const blocked = editSourcesBlocked(req)
    if (blocked) return fail(blocked)
    const from = String(req.body?.from || '')
    const to = String(req.body?.to || '').trim()
    if (!from || !to) return fail('缺少原名称或新名称')
    if (from === to) return ok({ renamed: 0 })
    const targets = store.listSources().filter((source) => String(source._bundle || '未归类') === from)
    for (const source of targets) store.saveSource({ ...source, _bundle: to })
    return ok({ renamed: targets.length, from, to })
  })

  /** 把若干批次合并到一个目标批次 */
  app.post('/reader3/mergeBundles', async (req) => {
    const blocked = editSourcesBlocked(req)
    if (blocked) return fail(blocked)
    const into = String(req.body?.into || '').trim()
    const names = Array.isArray(req.body?.names) ? req.body.names.map((name) => String(name)) : []
    if (!into) return fail('缺少目标批次')
    const from = names.filter((name) => name && name !== into)
    if (!from.length) return fail('请至少选择两个批次')
    let merged = 0
    for (const source of store.listSources()) {
      if (from.includes(String(source._bundle || '未归类'))) {
        store.saveSource({ ...source, _bundle: into })
        merged += 1
      }
    }
    return ok({ merged, into, from })
  })

  /** 按导入批次（bundle）批量启用/停用 */
  app.post('/reader3/setBundleEnabled', async (req) => {
    const blocked = editSourcesBlocked(req)
    if (blocked) return fail(blocked)
    const bundle = String(req.body?.bundle || '')
    const enabled = Boolean(req.body?.enabled)
    if (!bundle) return fail('缺少分组名')
    const targets = store.listSources().filter((source) => String(source._bundle || '未归类') === bundle)
    for (const source of targets) store.saveSource({ ...source, enabled })
    return ok({ bundle, enabled, count: targets.length })
  })

  app.post('/reader3/saveBookSources', async (req) => {
    const blocked = editSourcesBlocked(req)
    if (blocked) return fail(blocked)
    const body = req.body || {}
    const list = Array.isArray(body) ? body : Array.isArray(body.sources) ? body.sources : []
    const bundle = Array.isArray(body) ? '' : String(body.bundle || '').trim()
    const withKeys = list.map((source) => preserveSourceKey(source, store.getSource(String(source?.bookSourceUrl ?? ''))))
    const prepared = bundle ? withKeys.map((source) => ({ ...source, _bundle: bundle })) : withKeys
    const newCount = prepared.filter((source) => source?.bookSourceUrl && !store.getSource(String(source.bookSourceUrl))).length
    if (newCount) {
      const quota = sourceQuotaError(store, req, newCount)
      if (quota) return fail(quota)
    }
    return ok({ saved: true, count: store.saveSources(prepared), bundle: bundle || null })
  })

  app.post('/reader3/reorderBookSources', async (req) => {
    const blocked = editSourcesBlocked(req)
    if (blocked) return fail(blocked)
    const urls = Array.isArray(req.body?.urls) ? req.body.urls.map((url) => String(url)) : []
    if (!urls.length) return fail('缺少排序列表')
    const known = new Set(store.listSources().map((source) => source.bookSourceUrl))
    store.saveSourceOrder(urls.filter((url) => known.has(url)))
    return ok({ reordered: urls.length })
  })

  app.post('/reader3/deleteBookSource', async (req) => {
    const blocked = editSourcesBlocked(req)
    if (blocked) return fail(blocked)
    return ok({ deleted: store.deleteSource(String(req.body?.bookSourceUrl ?? '')) })
  })

  app.post('/reader3/deleteBookSources', async (req) => {
    const blocked = editSourcesBlocked(req)
    if (blocked) return fail(blocked)
    const list = Array.isArray(req.body) ? req.body : []
    const deleted = store.deleteSources(list.map((item) => String(item?.bookSourceUrl ?? '')))
    return ok({ deleted: deleted > 0 })
  })

  app.post('/reader3/deleteAllBookSources', async (req) => {
    const blocked = editSourcesBlocked(req)
    if (blocked) return fail(blocked)
    return ok({ deleted: store.deleteAllSources() > 0 })
  })

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

  /** 书架分组手动排序（设置 → 书架 → 分组管理里拖拽后提交） */
  app.post('/reader3/reorderBookGroups', async (req) => {
    const groupIds = Array.isArray(req.body?.groupIds) ? req.body.groupIds : []
    return ok({ reordered: store.reorderGroups(groupIds) })
  })

  app.post('/reader3/saveBookGroupId', async (req) => {
    const { bookUrl, groupId } = req.body || {}
    const book = store.getBook(String(bookUrl ?? ''))
    if (!book) return fail('书籍不存在')
    store.saveBook({ ...book, group: Number(groupId) || 0 })
    return ok('保存成功')
  })

  /* ----------------------------------------------------------------- search */

  const searchAll = async (keyword, { group, sourceUrl, bundle, limit = 0 } = {}) => {
    const sources = enabledSources().filter((source) => {
      if (sourceUrl) return source.bookSourceUrl === sourceUrl
      if (bundle) return String(source._bundle || '未归类') === bundle
      if (group) return source.bookSourceGroup === group
      return true
    })
    if (!sources.length) return []

    // 默认只搜前 N 个源：1694 个源全量跑会让接口超时，也没有实际价值
    const maxSources = Math.max(1, Number(process.env.SEARCH_MAX_SOURCES || 200))

    // 串行跑 2000+ 个源要一小时，这里改成有限并发；NAS 是弱机器，默认 6 路
    const SEARCH_CONCURRENCY = Math.max(1, Number(process.env.SEARCH_CONCURRENCY || 6))
    const SEARCH_TIMEOUT_MS = Math.max(2000, Number(process.env.SEARCH_TIMEOUT_MS || 8000))
    // 搜索顺序与书源列表一致：手动排序 > WebView 优先 > 导入顺序
    const targets = sources.slice(0, maxSources)
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
    const { key, bookSourceGroup, bookSourceUrl, bookSourceBundle } = req.body || {}
    const keyword = String(key ?? '').trim()
    if (!keyword) return fail('请输入搜索关键词')
    const books = await searchAll(keyword, { group: bookSourceGroup, sourceUrl: bookSourceUrl, bundle: bookSourceBundle })
    return ok(books)
  })

  app.get('/reader3/searchBookMultiSSE', async (req, reply) => {
    const keyword = String(req.query?.key ?? '').trim()
    const group = req.query?.bookSourceGroup ? String(req.query.bookSourceGroup) : ''
    const sourceUrl = req.query?.bookSourceUrl ? String(req.query.bookSourceUrl) : ''
    const bundle = req.query?.bookSourceBundle ? String(req.query.bookSourceBundle) : ''
    const bundleList = String(req.query?.bookSourceBundles || '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
    const bundleSet = new Set(bundleList)

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
          if (bundleSet.size) return bundleSet.has(String(source._bundle || '未归类'))
          if (bundle) return String(source._bundle || '未归类') === bundle
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

  /** 当前用户头像：data URL，限制大小，避免把大图塞进数据库 */
  app.post('/reader3/setAvatar', async (req) => {
    const avatar = String(req.body?.avatar || '')
    if (avatar && !/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(avatar)) return fail('头像格式不支持')
    if (avatar.length > 600 * 1024) return fail('头像太大，请换一张小图')
    if (!req.userId) return fail('NEED_LOGIN')
    store.setUserAvatar(req.userId, avatar)
    return ok({ avatar })
  })

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

  /** 正文卡片图代理：神评论/本章说卡片可能带防盗链 headers，由服务端代取 */
  app.get('/reader3/contentImage', async (req, reply) => {
    const id = String(req.query?.id ?? '')
    const entry = cardImageCache.get(id)
    if (!entry) return reply.code(404).send('图片不存在或已过期')
    try {
      const headers = { 'user-agent': 'reader-panghu' }
      for (const [key, value] of Object.entries(entry.headers || {})) {
        if (typeof value === 'string' || typeof value === 'number') headers[key] = String(value)
      }
      const upstream = await fetch(entry.url, { headers, signal: AbortSignal.timeout(20000) })
      if (!upstream.ok) return reply.code(502).send('图片获取失败')
      const type = upstream.headers.get('content-type') || 'image/png'
      if (!/^image\//i.test(type)) return reply.code(502).send('返回的不是图片')
      reply.header('cache-control', 'private, max-age=3600')
      reply.header('content-type', type)
      return reply.send(Buffer.from(await upstream.arrayBuffer()))
    } catch (error) {
      return reply.code(502).send(`图片获取失败: ${error.message}`)
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
        hasUpdate: true,
        newChapterCount: chapters.length - before,
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

  /** 进入阅读后清掉“有更新”角标 */
  app.post('/reader3/clearBookUpdate', async (req) => {
    const bookUrl = String(req.body?.bookUrl || '')
    const book = store.getBook(bookUrl)
    if (!book) return fail('书籍不存在')
    return ok(store.saveBook({ ...book, hasUpdate: false, newChapterCount: 0 }))
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


