/**
 * 阅读增强：换源、阅读统计、定时检查、AI 摘要、WebDAV 目录浏览。
 */

import { evaluateRule } from './legado-rule.js'
import { makeRuntime } from './source-tools.js'

const ok = (data) => ({ isSuccess: true, errorMsg: '', data })
const fail = (errorMsg) => ({ isSuccess: false, errorMsg, data: null })

const DAY = 24 * 60 * 60 * 1000

export function registerReadingExtras(app, { store, dataDir, options = {} }) {
  /* ------------------------------------------------------------- 阅读统计 */

  // 统计落在 user_config 里，重启不丢
  const todayKey = () => new Date().toISOString().slice(0, 10)
  const loadStats = () => {
    const config = store.getUserConfig() || {}
    return config.readingDays && typeof config.readingDays === 'object' ? { ...config.readingDays } : {}
  }
  const saveStats = (days) => {
    const config = store.getUserConfig() || {}
    store.saveUserConfig({ ...config, readingDays: days })
  }

  const bumpStats = (bookUrl, seconds, chapters) => {
    const date = todayKey()
    const days = loadStats()
    const entry = days[date] || { seconds: 0, chapters: 0, date }
    entry.seconds += Math.max(0, Math.min(Number(seconds) || 0, 3600))
    entry.chapters += Math.max(0, Math.min(Number(chapters) || 0, 100))
    days[date] = entry
    saveStats(days)
    const book = store.getBook(String(bookUrl || ''))
    if (book) {
      store.saveBook({ ...book, readingSeconds: (Number(book.readingSeconds) || 0) + (Number(seconds) || 0) })
    }
    return entry
  }

  app.post('/reader3/saveReadingTime', async (req) => {
    const entry = bumpStats(req.body?.bookUrl, req.body?.seconds, req.body?.chapters)
    return ok(entry)
  })

  app.get('/reader3/getReadingStats', async () => {
    const days = Object.values(loadStats()).sort((a, b) => a.date.localeCompare(b.date)).slice(-30)
    const totalSeconds = days.reduce((sum, item) => sum + item.seconds, 0)
    const totalChapters = days.reduce((sum, item) => sum + item.chapters, 0)
    const shelf = store.listBooks()
    return ok({
      days,
      totalSeconds,
      totalChapters,
      books: shelf.length,
      finished: shelf.filter((book) => {
        const total = Number(book.totalChapterNum || 0)
        return total > 0 && Number(book.durChapterIndex || 0) >= total - 1
      }).length,
    })
  })

  /* ----------------------------------------------------------------- 换源 */

  /**
   * 为当前书籍找其它可用来源：按书名（可选作者）在其它书源里搜索。
   * 只搜索、不落库，避免污染书架。
   */
  app.post('/reader3/getAvailableBookSource', async (req) => {
    const { name, author, origin, resultLimit = 8 } = req.body || {}
    const title = String(name || '').trim()
    if (!title) return fail('缺少书名')

    const candidates = store
      .listSources()
      .filter((source) => source.enabled !== false && source.bookSourceUrl !== origin)
      .filter((source) => source.html || source.searchUrl)
      .slice(0, 12)

    const books = []
    for (const source of candidates) {
      if (books.length >= resultLimit) break
      try {
        const runtime = makeRuntime(source)
        await runtime.init()
        try {
          const found = await runtime.search(title, 1)
          for (const book of Array.isArray(found) ? found : []) {
            // 同名优先，作者能对上更可信
            if (book.name !== title) continue
            if (author && book.author && !book.author.includes(String(author)) && !String(author).includes(book.author)) continue
            books.push({
              name: book.name,
              author: book.author,
              bookUrl: book.bookUrl,
              origin: source.bookSourceUrl,
              originName: source.bookSourceName,
              coverUrl: book.coverUrl,
            })
            if (books.length >= resultLimit) break
          }
        } finally {
          runtime.dispose()
        }
      } catch {
        // 单个源失败不影响其它源
      }
    }
    return ok({ books })
  })

  /* ------------------------------------------------------- 定时检查章节更新 */

  // 每天跑一次，避免频繁请求书源
  const intervalHours = Number(process.env.CHAPTER_CHECK_INTERVAL_HOURS ?? 24)
  if (intervalHours > 0) {
    const timer = setInterval(async () => {
      try {
        const books = store.listBooks().filter((book) => !/^local:\/\/(txt|epub|docx|mobi|pdf)$/.test(String(book.origin || '')))
        for (const book of books.slice(0, 20)) {
          try {
            const runtime = makeRuntime(store.getSource(book.origin) || {})
            await runtime.init()
            const chapters = await runtime.chapter(book.tocUrl || book.bookUrl)
            runtime.dispose()
            if (Array.isArray(chapters) && chapters.length > Number(book.totalChapterNum || 0)) {
              store.saveBook({ ...book, totalChapterNum: chapters.length, latestChapterTitle: chapters.at(-1)?.title || '' })
            }
          } catch {
            /* 单本失败跳过 */
          }
        }
      } catch (error) {
        app.log.warn(`[chapter-check] ${error.message}`)
      }
    }, intervalHours * 60 * 60 * 1000)
    timer.unref?.()
    app.log.info(`[chapter-check] 每 ${intervalHours} 小时检查一次`)
  }

  /* --------------------------------------------------------------- AI 摘要 */

  const apiKey = process.env.DEEPSEEK_API_KEY || ''
  const apiBase = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'

  app.post('/reader3/getChapterSummary', async (req) => {
    if (!apiKey) return fail('未配置 DEEPSEEK_API_KEY，AI 摘要不可用')
    const text = String(req.body?.text || '').slice(0, 6000)
    if (!text.trim()) return fail('缺少章节正文')
    try {
      const response = await fetch(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_SUMMARY_MODEL || 'deepseek-chat',
          messages: [
            { role: 'system', content: '你是阅读助手。用不超过 150 字概括本章剧情，只讲发生了什么。' },
            { role: 'user', content: text },
          ],
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(60000),
      })
      if (!response.ok) return fail(`模型接口返回 HTTP ${response.status}`)
      const payload = await response.json()
      return ok({ summary: payload.choices?.[0]?.message?.content || '' })
    } catch (error) {
      return fail(`摘要生成失败：${error.message}`)
    }
  })

  /* --------------------------------------------------------- WebDAV 浏览 */

  const davAuth = (username, password) =>
    username ? { authorization: `Basic ${Buffer.from(`${username}:${password || ''}`).toString('base64')}` } : {}

  app.post('/reader3/webdavList', async (req) => {
    const { url, username, password } = req.body || {}
    if (!url) return fail('缺少 WebDAV 地址')
    try {
      const response = await fetch(String(url), {
        method: 'PROPFIND',
        headers: { depth: '1', 'content-type': 'application/xml', ...davAuth(username, password) },
        signal: AbortSignal.timeout(30000),
      })
      if (!response.ok) return fail(`WebDAV 返回 HTTP ${response.status}`)
      const xml = await response.text()
      const entries = [...xml.matchAll(/<[^>]*:response[\s\S]*?<\/[^>]*:response>/gi)].map((match) => {
        const block = match[0]
        const href = /<[^>]*:href[^>]*>([\s\S]*?)<\/[^>]*:href>/i.exec(block)?.[1] || ''
        const isDir = /<[^>]*:collection\s*\/?>/i.test(block)
        const size = Number(/<[^>]*:getcontentlength[^>]*>(\d+)</i.exec(block)?.[1] || 0)
        const modified = /<[^>]*:getlastmodified[^>]*>([\s\S]*?)</i.exec(block)?.[1] || ''
        return { href: decodeURIComponent(href), isDir, size, modified }
      })
      return ok({ entries: entries.filter((entry) => entry.href) })
    } catch (error) {
      return fail(`WebDAV 浏览失败：${error.message}`)
    }
  })
}
