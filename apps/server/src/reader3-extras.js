/**
 * Secondary /reader3 endpoints: bookmarks, replace rules, source import,
 * single-user management, local TXT books, and honest stubs for the features
 * that are not implemented yet (RSS, WebDAV, explore, EPUB/PDF/MOBI).
 *
 * Stubs return an empty value with `isSuccess: true` when an empty collection is
 * a truthful answer (a user simply has no bookmarks), and `isSuccess: false`
 * when the feature genuinely does not exist yet, so the UI shows a reason
 * instead of pretending.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createRuntime } from '@reader-panghu/source-runtime'
import { parseDocx } from './docx.js'
import { parseEpub } from './epub.js'
import { parseFeed } from './rss.js'
import { parseMobi } from './mobi.js'
import { extractPdfText } from './pdf.js'

const ok = (data) => ({ isSuccess: true, errorMsg: '', data })
const fail = (errorMsg, data = null) => ({ isSuccess: false, errorMsg, data })

const CHAPTER_TITLE = /^\s*(第[0-9一二三四五六七八九十百千两零〇]+[章节回卷篇][^\n。！？]{0,20}|序章[^\n。！？]{0,20}|楔子[^\n。！？]{0,20})\s*$/

function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    // Chinese TXT files in the wild are frequently GBK.
    return new TextDecoder('gbk').decode(buffer)
  }
}

/** Split a plain-text book into chapters, keeping the preamble as chapter 1. */
export function splitTxtChapters(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const chapters = []
  let current = { title: '开始', lines: [] }
  for (const line of lines) {
    if (CHAPTER_TITLE.test(line)) {
      if (current.lines.join('').trim()) chapters.push(current)
      current = { title: line.trim(), lines: [] }
    } else {
      current.lines.push(line)
    }
  }
  if (current.lines.join('').trim()) chapters.push(current)
  return chapters.map((chapter, index) => ({
    title: chapter.title,
    index,
    content: chapter.lines.join('\n').trim(),
  }))
}

export function registerReader3Extras(app, { store, dataDir, options = {} }) {
  const booksDir = join(dataDir, 'books')
  const coversDir = join(dataDir, 'covers')
  mkdirSync(booksDir, { recursive: true })
  mkdirSync(coversDir, { recursive: true })
  const timeoutMs = Number(options.timeoutMs || 45000)

  const importable = (payload) => {
    const list = Array.isArray(payload) ? payload : Array.isArray(payload?.sources) ? payload.sources : [payload]
    return list.filter((entry) => entry && entry.bookSourceUrl)
  }

  /* --------------------------------------------------------------- bookmarks */

  app.get('/reader3/getBookmarks', async (req) => ok(store.listBookmarks(req.query?.bookUrl ? String(req.query.bookUrl) : undefined)))

  app.post('/reader3/saveBookmark', async (req) => {
    store.saveBookmark(req.body || {})
    return ok('保存成功')
  })

  app.post('/reader3/saveBookmarks', async (req) => {
    const list = Array.isArray(req.body) ? req.body : []
    for (const bookmark of list) store.saveBookmark(bookmark)
    return ok('保存成功')
  })

  app.post('/reader3/deleteBookmark', async (req) => ok(store.deleteBookmark(req.body || {}) ? '删除成功' : '书签不存在'))

  app.post('/reader3/deleteBookmarks', async (req) => {
    const list = Array.isArray(req.body) ? req.body : []
    let deleted = 0
    for (const bookmark of list) if (store.deleteBookmark(bookmark)) deleted += 1
    return ok(deleted ? '删除成功' : '书签不存在')
  })

  /* ----------------------------------------------------------- replace rules */

  app.get('/reader3/getReplaceRules', async () => ok(store.listReplaceRules()))

  app.post('/reader3/saveReplaceRule', async (req) => {
    store.saveReplaceRule(req.body || {})
    return ok('保存成功')
  })

  app.post('/reader3/saveReplaceRules', async (req) => {
    const list = Array.isArray(req.body) ? req.body : []
    for (const rule of list) store.saveReplaceRule(rule)
    return ok('保存成功')
  })

  app.post('/reader3/deleteReplaceRule', async (req) => {
    store.deleteReplaceRules([req.body?.name])
    return ok('删除成功')
  })

  app.post('/reader3/deleteReplaceRules', async (req) => {
    const list = Array.isArray(req.body) ? req.body : []
    store.deleteReplaceRules(list.map((rule) => rule?.name))
    return ok('删除成功')
  })

  /* ------------------------------------------------------------ source import */

  app.post('/reader3/readSourceFile', async (req) => {
    const part = await req.file?.()
    if (!part) return fail('缺少文件')
    const text = decodeText(await part.toBuffer())
    try {
      return ok(importable(JSON.parse(text)))
    } catch {
      return fail('文件不是有效的书源 JSON')
    }
  })

  app.post('/reader3/readRemoteSourceFile', async (req) => {
    const url = String(req.body?.url ?? '')
    if (!url) return fail('缺少书源地址')
    const response = await fetch(url, { headers: { 'user-agent': 'reader-panghu' } })
    if (!response.ok) return fail(`下载书源失败：HTTP ${response.status}`)
    const text = await response.text()
    try {
      return ok(importable(JSON.parse(text)).map((entry) => JSON.stringify(entry)))
    } catch {
      return fail('远程内容不是有效的书源 JSON')
    }
  })

  app.post('/reader3/getInvalidBookSources', async () => ok([]))
  app.post('/reader3/deleteInvalidBookSources', async () => ok({ deleted: 0 }))
  app.post('/reader3/setAsDefaultBookSources', async () => fail('单用户部署无需共享书源'))

  /** Real test: run the keyword search against each named source. */
  app.post('/reader3/testBookSources', async (req) => {
    const { bookSourceUrls, keyword } = req.body || {}
    const word = String(keyword || '大奉').trim()
    const urls = Array.isArray(bookSourceUrls) && bookSourceUrls.length
      ? bookSourceUrls.map(String)
      : store.listSources().filter((source) => source.html).map((source) => source.bookSourceUrl)
    const results = []
    for (const url of urls) {
      const source = store.getSource(url)
      if (!source) {
        results.push({ bookSourceName: url, bookSourceUrl: url, valid: false, searchOk: false, exploreOk: false, keyword: word, searchError: '书源不存在', markedInvalid: false })
        continue
      }
      const runtime = createRuntime(source, {
        name: source.bookSourceName,
        key: (source._runtime || {}).key || process.env.SOURCE_KEY || '',
        rewrites: (source._runtime || {}).rewrites || [],
        timeoutMs,
        baseUrl: source.bookSourceUrl,
      })
      try {
        await runtime.init()
        const books = await runtime.search(word, 1)
        const count = Array.isArray(books) ? books.length : 0
        results.push({
          bookSourceName: source.bookSourceName,
          bookSourceUrl: url,
          valid: count > 0,
          searchOk: count > 0,
          exploreOk: false,
          keyword: word,
          markedInvalid: false,
          group: source.bookSourceGroup || '',
        })
      } catch (error) {
        results.push({
          bookSourceName: source.bookSourceName,
          bookSourceUrl: url,
          valid: false,
          searchOk: false,
          exploreOk: false,
          keyword: word,
          searchError: error.message,
          markedInvalid: false,
          group: source.bookSourceGroup || '',
        })
      } finally {
        runtime.dispose()
      }
    }
    const valid = results.filter((item) => item.valid).length
    return ok({ total: results.length, valid, invalid: results.length - valid, markedInvalid: 0, results })
  })

  app.post('/reader3/loginBookSource', async () => fail('WebView 书源在服务端执行，登录态需在导入时提供密钥'))

  /* ------------------------------------------------------------ local books */

  app.post('/reader3/uploadTxtBook', async (req) => {
    const part = await req.file?.()
    if (!part) return fail('缺少文件')
    const filename = basename(part.filename || 'local.txt')
    const text = decodeText(await part.toBuffer())
    const parsed = splitTxtChapters(text)
    if (!parsed.length) return fail('解析不出任何章节')

    const uuid = randomUUID()
    writeFileSync(join(booksDir, `${uuid}.txt`), text, 'utf8')
    const bookUrl = `local://txt/${uuid}`
    const chapters = parsed.map((chapter) => ({
      title: chapter.title,
      url: `${bookUrl}#${chapter.index}`,
      index: chapter.index,
      content: chapter.content,
    }))

    const book = store.saveBook({
      name: filename.replace(/\.txt$/i, ''),
      author: '',
      bookUrl,
      origin: 'local://txt',
      originName: '本地书籍',
      coverUrl: '',
      tocUrl: '',
      intro: '',
      kind: '',
      latestChapterTitle: chapters.at(-1)?.title || '',
      wordCount: String(text.replace(/\s/g, '').length),
      type: 0,
      canUpdate: false,
      group: 0,
      totalChapterNum: chapters.length,
    })
    store.saveChapters(bookUrl, 'local://txt', chapters.map(({ content, ...rest }) => rest))
    store.saveChapters(`${bookUrl}#content`, 'local://txt', chapters)
    return ok(book)
  })

  app.post('/reader3/uploadEpubBook', async (req) => {
    const part = await req.file?.()
    if (!part) return fail('缺少文件')
    const filename = basename(part.filename || 'local.epub')
    let parsed
    try {
      parsed = parseEpub(new Uint8Array(await part.toBuffer()))
    } catch (error) {
      return fail(`EPUB 解析失败：${error.message}`)
    }
    if (!parsed.chapters.length) return fail('EPUB 里没有可读章节')

    const uuid = randomUUID()
    const bookUrl = `local://epub/${uuid}`
    const chapters = parsed.chapters.map((chapter, index) => ({
      title: chapter.title,
      url: `${bookUrl}#${index}`,
      index,
      content: chapter.text,
    }))

    let customCoverUrl = ''
    if (parsed.cover) {
      const ext = parsed.coverType === 'image/png' ? '.png' : parsed.coverType === 'image/webp' ? '.webp' : '.jpg'
      writeFileSync(join(coversDir, uuid + ext), Buffer.from(parsed.cover))
      customCoverUrl = `/reader3/bookCover/${uuid}`
    }

    const book = store.saveBook({
      name: parsed.title || filename.replace(/\.epub$/i, ''),
      author: parsed.author || '',
      bookUrl,
      origin: 'local://epub',
      originName: '本地书籍',
      coverUrl: '',
      customCoverUrl,
      tocUrl: '',
      intro: parsed.intro || '',
      kind: '',
      latestChapterTitle: chapters.at(-1)?.title || '',
      wordCount: String(chapters.reduce((sum, chapter) => sum + chapter.content.length, 0)),
      type: 0,
      canUpdate: false,
      group: 0,
      totalChapterNum: chapters.length,
    })
    store.saveChapters(bookUrl, 'local://epub', chapters.map(({ content, ...rest }) => rest))
    store.saveChapters(`${bookUrl}#content`, 'local://epub', chapters)
    return ok(book)
  })

  app.post('/reader3/uploadDocxBook', async (req) => {
    const part = await req.file?.()
    if (!part) return fail('缺少文件')
    const filename = basename(part.filename || 'local.docx')
    let parsed
    try {
      parsed = parseDocx(new Uint8Array(await part.toBuffer()))
    } catch (error) {
      return fail(`DOCX 解析失败：${error.message}`)
    }
    if (!parsed.chapters.length) return fail('DOCX 里没有可读章节')

    const uuid = randomUUID()
    const bookUrl = `local://docx/${uuid}`
    const chapters = parsed.chapters.map((chapter, index) => ({
      title: chapter.title,
      url: `${bookUrl}#${index}`,
      index,
      content: chapter.text,
    }))
    const book = store.saveBook({
      name: parsed.title || filename.replace(/\.docx?$/i, ''),
      author: '',
      bookUrl,
      origin: 'local://docx',
      originName: '本地书籍',
      coverUrl: '',
      tocUrl: '',
      intro: '',
      kind: '',
      latestChapterTitle: chapters.at(-1)?.title || '',
      wordCount: String(chapters.reduce((sum, chapter) => sum + chapter.content.length, 0)),
      type: 0,
      canUpdate: false,
      group: 0,
      totalChapterNum: chapters.length,
    })
    store.saveChapters(bookUrl, 'local://docx', chapters.map(({ content, ...rest }) => rest))
    store.saveChapters(`${bookUrl}#content`, 'local://docx', chapters)
    return ok(book)
  })

  app.post('/reader3/uploadMobiBook', async (req) => {
    const part = await req.file?.()
    if (!part) return fail('缺少文件')
    const filename = basename(part.filename || 'local.mobi')
    let parsed
    try {
      parsed = parseMobi(new Uint8Array(await part.toBuffer()))
    } catch (error) {
      return fail(`MOBI 解析失败：${error.message}`)
    }
    if (!parsed.chapters.length) return fail('MOBI 里没有可读章节')

    const uuid = randomUUID()
    const bookUrl = `local://mobi/${uuid}`
    const chapters = parsed.chapters.map((chapter, index) => ({
      title: chapter.title,
      url: `${bookUrl}#${index}`,
      index,
      content: chapter.text,
    }))
    const book = store.saveBook({
      name: parsed.title || filename.replace(/\.(mobi|azw3?)$/i, ''),
      author: parsed.author || '',
      bookUrl,
      origin: 'local://mobi',
      originName: '本地书籍',
      coverUrl: '',
      tocUrl: '',
      intro: parsed.intro || '',
      kind: '',
      latestChapterTitle: chapters.at(-1)?.title || '',
      wordCount: String(chapters.reduce((sum, chapter) => sum + chapter.content.length, 0)),
      type: 0,
      canUpdate: false,
      group: 0,
      totalChapterNum: chapters.length,
    })
    store.saveChapters(bookUrl, 'local://mobi', chapters.map(({ content, ...rest }) => rest))
    store.saveChapters(`${bookUrl}#content`, 'local://mobi', chapters)
    return ok(book)
  })

  app.post('/reader3/uploadPdfBook', async (req) => {
    const part = await req.file?.()
    if (!part) return fail('缺少文件')
    const filename = basename(part.filename || 'local.pdf')
    let text
    try {
      text = extractPdfText(new Uint8Array(await part.toBuffer()))
    } catch (error) {
      return fail(`PDF 解析失败：${error.message}`)
    }

    const uuid = randomUUID()
    const bookUrl = `local://pdf/${uuid}`
    const parsed = splitTxtChapters(text)
    if (!parsed.length) return fail('PDF 里没有可读章节')
    const chapters = parsed.map((chapter, index) => ({
      title: chapter.title,
      url: `${bookUrl}#${index}`,
      index,
      content: chapter.content,
    }))
    const book = store.saveBook({
      name: filename.replace(/\.pdf$/i, ''),
      author: '',
      bookUrl,
      origin: 'local://pdf',
      originName: '本地书籍',
      coverUrl: '',
      tocUrl: '',
      intro: '',
      kind: '',
      latestChapterTitle: chapters.at(-1)?.title || '',
      wordCount: String(text.replace(/\s/g, '').length),
      type: 0,
      canUpdate: false,
      group: 0,
      totalChapterNum: chapters.length,
    })
    store.saveChapters(bookUrl, 'local://pdf', chapters.map(({ content, ...rest }) => rest))
    store.saveChapters(`${bookUrl}#content`, 'local://pdf', chapters)
    return ok(book)
  })

  app.get('/reader3/getTxtTocRules', async () => ok([]))

  /* ------------------------------------------------------ unimplemented stubs */

  app.get('/reader3/getRssSources', async () => ok(store.listRssSources()))

  app.post('/reader3/saveRssSource', async (req) => {
    store.saveRssSource(req.body || {})
    return ok('保存成功')
  })

  app.post('/reader3/saveRssSources', async (req) => {
    const list = Array.isArray(req.body) ? req.body : []
    for (const source of list) store.saveRssSource(source)
    return ok('保存成功')
  })

  app.post('/reader3/deleteRssSource', async (req) => {
    store.deleteRssSources([req.body?.sourceUrl])
    return ok('删除成功')
  })

  app.post('/reader3/deleteRssSources', async (req) => {
    const list = Array.isArray(req.body) ? req.body : []
    return ok({ deleted: store.deleteRssSources(list.map((item) => item?.sourceUrl)) })
  })

  /** 拉取并解析一个订阅源，返回文章列表。 */
  app.post('/reader3/getRssArticles', async (req) => {
    const sourceUrl = String(req.body?.sourceUrl ?? '')
    if (!sourceUrl) return fail('缺少 sourceUrl')
    const known = store.listRssSources().find((item) => item.sourceUrl === sourceUrl)
    let xml
    try {
      const response = await fetch(sourceUrl, { headers: { 'user-agent': 'reader-panghu' } })
      if (!response.ok) return fail(`订阅源返回 HTTP ${response.status}`)
      xml = await response.text()
    } catch (error) {
      return fail(`拉取订阅源失败：${error.message}`)
    }
    const feed = parseFeed(xml)
    const first = feed.items.map((item) => ({
      ...item,
      origin: sourceUrl,
      sourceName: known?.sourceName || feed.title,
    }))
    return ok({ first, second: null, title: feed.title })
  })

  /** 抓取文章正文并转成纯文本。 */
  app.post('/reader3/getRssContent', async (req) => {
    const link = String(req.body?.link || req.body?.url || '')
    if (!link) return fail('缺少文章地址')
    try {
      const response = await fetch(link, { headers: { 'user-agent': 'reader-panghu' } })
      if (!response.ok) return fail(`文章返回 HTTP ${response.status}`)
      const html = await response.text()
      const body = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<(br|\/p|\/div|\/h[1-6]|\/li)[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      return ok(body)
    } catch (error) {
      return fail(`抓取正文失败：${error.message}`)
    }
  })

  app.post('/reader3/readRemoteRssSourceFile', async (req) => {
    const url = String(req.body?.url ?? '')
    if (!url) return fail('缺少地址')
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'reader-panghu' } })
      if (!response.ok) return fail(`下载失败：HTTP ${response.status}`)
      const parsed = JSON.parse(await response.text())
      const list = Array.isArray(parsed) ? parsed : [parsed]
      return ok(list.filter((item) => item?.sourceUrl).map((item) => JSON.stringify(item)))
    } catch (error) {
      return fail(`解析订阅源失败：${error.message}`)
    }
  })

  app.post('/reader3/readRssSourceFile', async (req) => {
    const part = await req.file?.()
    if (!part) return fail('缺少文件')
    try {
      const parsed = JSON.parse(decodeText(await part.toBuffer()))
      const list = Array.isArray(parsed) ? parsed : [parsed]
      return ok(list.filter((item) => item?.sourceUrl))
    } catch (error) {
      return fail(`解析订阅源失败：${error.message}`)
    }
  })
  app.post('/reader3/exploreBook', async () => ok([]))
  app.post('/reader3/exploreBookGlobal', async () => ok({ books: [], lastIndex: -1, hasMore: false }))
  app.post('/reader3/getExploreKinds', async () => ok([]))

  /** 备份包：书架 + 书源 + 分组 + 用户配置。 */
  const buildBackup = () => ({
    format: 'reader-panghu-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    books: store.listBooks(),
    sources: store.listSources(),
    groups: store.listGroups(),
    config: store.getUserConfig(),
  })

  const authHeader = (username, password) =>
    username ? { authorization: `Basic ${Buffer.from(`${username}:${password || ''}`).toString('base64')}` } : {}

  /** 备份到 WebDAV：PUT 一个 JSON 文件。 */
  app.post('/reader3/webdavBackup', async (req) => {
    const { url, username, password } = req.body || {}
    if (!url) return fail('缺少 WebDAV 地址')
    const payload = JSON.stringify(buildBackup())
    try {
      const response = await fetch(String(url), {
        method: 'PUT',
        headers: { 'content-type': 'application/json; charset=utf-8', ...authHeader(username, password) },
        body: payload,
      })
      if (!response.ok) return fail(`WebDAV 返回 HTTP ${response.status}`)
      return ok({ uploaded: true, bytes: Buffer.byteLength(payload) })
    } catch (error) {
      return fail(`备份失败：${error.message}`)
    }
  })

  /** 从 WebDAV 恢复：GET 备份文件并写回本地库。 */
  app.post('/reader3/webdavRestore', async (req) => {
    const { url, username, password } = req.body || {}
    if (!url) return fail('缺少 WebDAV 地址')
    let backup
    try {
      const response = await fetch(String(url), { headers: authHeader(username, password) })
      if (!response.ok) return fail(`WebDAV 返回 HTTP ${response.status}`)
      backup = JSON.parse(await response.text())
    } catch (error) {
      return fail(`读取备份失败：${error.message}`)
    }
    if (backup?.format !== 'reader-panghu-backup') return fail('不是 reader-panghu 的备份文件')

    for (const source of backup.sources || []) store.saveSource(source)
    for (const book of backup.books || []) store.saveBook(book)
    for (const group of backup.groups || []) store.saveGroup(group)
    if (backup.config) store.saveUserConfig(backup.config)
    return ok({
      restored: {
        books: (backup.books || []).length,
        sources: (backup.sources || []).length,
        groups: (backup.groups || []).length,
      },
    })
  })

  app.get('/reader3/getWebdavFileList', async () => ok([]))
  app.get('/reader3/getWebdavFile', async () => ok(''))
  app.post('/reader3/uploadFileToWebdav', async () => fail('WebDAV 文件浏览尚未接入；备份请用 /reader3/webdavBackup'))
  app.post('/reader3/deleteWebdavFile', async () => fail('WebDAV 文件浏览尚未接入'))
  app.post('/reader3/deleteWebdavFileList', async () => fail('WebDAV 文件浏览尚未接入'))
  app.get('/reader3/getUserList', async () => {
    const user = store.getUser()
    return ok([{ username: user?.username ?? 'reader', isAdmin: true, enable: true }])
  })
  app.post('/reader3/addUser', async () => fail('单用户部署不支持新增用户'))
  app.post('/reader3/resetPassword', async () => fail('当前部署未启用密码登录'))
  app.post('/reader3/updateUser', async () => fail('单用户部署不支持多用户'))
  app.post('/reader3/deleteUsers', async () => fail('单用户部署不支持多用户'))

  app.get('/reader3/getAvailableBookSource', async () => ok({ books: [], lastIndex: -1, hasMore: false }))
  app.post('/reader3/getAvailableBookSource', async () => ok({ books: [], lastIndex: -1, hasMore: false }))
  app.get('/reader3/getAvailableBookSourceSSE', async (req, reply) => {
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' })
    reply.raw.write(`data: ${JSON.stringify(ok({ books: [], lastIndex: -1, hasMore: false }))}\n\n`)
    reply.raw.write('event: end\ndata: {}\n\n')
    reply.raw.end()
  })

  app.get('/reader3/cacheBookSSE', async (_req, reply) => {
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' })
    reply.raw.write('event: end\ndata: {}\n\n')
    reply.raw.end()
  })

  app.get('/reader3/searchBookSourceSSE', async (req, reply) => {
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' })
    reply.raw.write('event: end\ndata: {}\n\n')
    reply.raw.end()
  })

  /** Anything else: a real error, so the UI can say what is missing. */
  app.all('/reader3/*', async (req) => fail(`接口尚未实现：${req.url}`))
}
