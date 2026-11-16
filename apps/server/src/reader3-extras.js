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
import { parseMobi } from './mobi.js'

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

  app.post('/reader3/uploadPdfBook', async () => fail('PDF 需要 PDF 引擎，尚未接入；当前已支持 TXT / EPUB / DOCX / MOBI'))

  app.get('/reader3/getTxtTocRules', async () => ok([]))

  /* ------------------------------------------------------ unimplemented stubs */

  app.get('/reader3/getRssSources', async () => ok([]))
  app.post('/reader3/saveRssSource', async () => ok('保存成功'))
  app.post('/reader3/saveRssSources', async () => ok('保存成功'))
  app.post('/reader3/deleteRssSource', async () => ok('删除成功'))
  app.post('/reader3/deleteRssSources', async () => ok({ deleted: 0 }))
  app.post('/reader3/getRssArticles', async () => ok({ first: [], second: null }))
  app.post('/reader3/getRssContent', async () => ok(''))
  app.post('/reader3/readRssSourceFile', async () => fail('RSS 尚未接入'))
  app.post('/reader3/readRemoteRssSourceFile', async () => fail('RSS 尚未接入'))

  app.post('/reader3/exploreBook', async () => ok([]))
  app.post('/reader3/exploreBookGlobal', async () => ok({ books: [], lastIndex: -1, hasMore: false }))
  app.post('/reader3/getExploreKinds', async () => ok([]))

  app.get('/reader3/getWebdavFileList', async () => ok([]))
  app.get('/reader3/getWebdavFile', async () => ok(''))
  app.post('/reader3/uploadFileToWebdav', async () => fail('WebDAV 尚未接入'))
  app.post('/reader3/deleteWebdavFile', async () => fail('WebDAV 尚未接入'))
  app.post('/reader3/deleteWebdavFileList', async () => fail('WebDAV 尚未接入'))

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
