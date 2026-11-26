/**
 * 书架后台修复：升级后自动扫描一次本地书和网络书。
 *
 * - 本地书：从书仓原文件 / 上传的 TXT 重新分章，修正旧版目录。
 * - 网络书：同步书源改名后的 originName，并在目录缺失/明显变多时刷新目录。
 * - 只做低风险修正：不覆盖用户自己填写的书名、分组和已有分类。
 *
 * 通过 dataDir/.shelf-repair.json 记录版本，同一个版本只跑一次。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { normalizeChapterTitle } from './chapter-title.js'
import { parseLocalBook } from './local-book.js'

export const SHELF_REPAIR_VERSION = '2.0.4'

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

const isWithin = (root, target) => {
  const rel = relative(root, target)
  return rel && !rel.startsWith('..') && !rel.includes(':')
}

const localSourcePath = (book, dataDir) => {
  if (book.warehousePath) {
    const root = resolve(process.env.LIBRARY_DIR || join(dataDir, 'library'))
    const target = resolve(root, String(book.warehousePath))
    if (isWithin(root, target) && existsSync(target)) return target
  }
  if (/^local:\/\/txt\//i.test(String(book.bookUrl || ''))) {
    const uuid = String(book.bookUrl).split('/').pop()
    const target = join(dataDir, 'books', `${uuid}.txt`)
    if (existsSync(target)) return target
  }
  return ''
}

const titlesEqual = (oldChapters, newChapters) =>
  oldChapters.length === newChapters.length &&
  oldChapters.every((chapter, index) => normalizeChapterTitle(chapter.title) === normalizeChapterTitle(newChapters[index].title))

/** 章节边界变化后，优先按当前章标题找新位置；找不到再按比例估算。 */
const remapProgress = (book, oldChapters, newChapters) => {
  if (!newChapters.length) return 0
  const oldIndex = Math.max(0, Math.min(Number(book.durChapterIndex) || 0, Math.max(0, oldChapters.length - 1)))
  const oldTitle = normalizeChapterTitle(oldChapters[oldIndex]?.title || book.durChapterTitle)
  if (oldTitle) {
    const found = newChapters.findIndex((chapter) => normalizeChapterTitle(chapter.title) === oldTitle)
    if (found >= 0) return found
  }
  if (Number(book.durChapterTime) > 0 && oldChapters.length > 1) {
    return Math.min(newChapters.length - 1, Math.floor((oldIndex / oldChapters.length) * newChapters.length))
  }
  return Math.min(oldIndex, newChapters.length - 1)
}

const saveChapters = (store, book, chapters, userId) => {
  const entries = chapters.map((chapter, index) => ({
    title: normalizeChapterTitle(chapter.title) || `第${index + 1}章`,
    url: `${book.bookUrl}#${index}`,
    index,
    content: chapter.text || '',
  }))
  store.saveChapters(book.bookUrl, book.origin, entries.map(({ content, ...rest }) => rest))
  store.saveChapters(`${book.bookUrl}#content`, book.origin, entries)
  return entries
}

async function repairLocalBook({ store, dataDir, book, userId }) {
  const source = localSourcePath(book, dataDir)
  if (!source) return false
  let parsed
  try {
    parsed = parseLocalBook(new Uint8Array(readFileSync(source)), source.split(/[\\/]/).pop())
  } catch {
    return false
  }
  const next = (parsed.chapters || []).filter((chapter) => String(chapter.text || '').trim())
  if (!next.length) return false
  const old = store.getChapters(book.bookUrl, book.origin) || []
  if (titlesEqual(old, next)) {
    // 目录没变，只同步书仓分类等元数据
    const patch = {}
    const category = String(book.warehousePath || '').split('/')[0]
    if (category && book.kind !== category) patch.kind = category
    if (Object.keys(patch).length) store.saveBook({ ...book, ...patch }, userId)
    return false
  }
  // 新规则一般会识别出更多章节；如果反而更少，保守跳过，避免把正确目录改坏
  if (old.length && next.length < old.length) return false

  const entries = saveChapters(store, book, next, userId)
  const index = remapProgress(book, old, entries)
  const patch = {
    totalChapterNum: entries.length,
    latestChapterTitle: entries.at(-1)?.title || '',
    wordCount: String(entries.reduce((sum, chapter) => sum + chapter.title.length + chapter.content.length, 0)),
    durChapterIndex: index,
  }
  if (Number(book.durChapterTime) > 0) patch.durChapterTitle = entries[index]?.title || book.durChapterTitle || ''
  const category = String(book.warehousePath || '').split('/')[0]
  if (category && book.kind !== category) patch.kind = category
  store.saveBook({ ...book, ...patch }, userId)
  return true
}

async function repairNetworkBook({ store, withRuntime, book, userId }) {
  const patch = {}
  const source = store.getSource(book.origin)
  if (source?.bookSourceName && source.bookSourceName !== book.originName) patch.originName = source.bookSourceName

  const old = store.getChapters(book.bookUrl, book.origin) || []
  try {
    const fetched = await Promise.race([
      withRuntime(book.origin, (runtime) => runtime.chapter(book.tocUrl || book.bookUrl)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('目录获取超时')), 15000)),
    ])
    const next = (Array.isArray(fetched) ? fetched : [])
      .map((chapter, index) => ({
        title: String(chapter?.name ?? `第${index + 1}章`),
        url: String(chapter?.chapterId ?? ''),
        index: Number(chapter?.index ?? index),
        isVolume: Boolean(chapter?.isVolume),
      }))
      .filter((chapter) => chapter.url && !chapter.isVolume)
    const nextTitles = next.map((chapter) => normalizeChapterTitle(chapter.title))
    const titlesChanged =
      next.length !== old.length ||
      nextTitles.some((title, index) => title !== normalizeChapterTitle(old[index]?.title))
    if (next.length && (next.length > old.length || !old.length || (next.length === old.length && titlesChanged))) {
      const entries = next.map((chapter, index) => ({
        ...chapter,
        title: normalizeChapterTitle(chapter.title) || `第${index + 1}章`,
        index,
      }))
      store.saveChapters(book.bookUrl, book.origin, entries)
      patch.totalChapterNum = entries.length
      patch.latestChapterTitle = entries.at(-1)?.title || book.latestChapterTitle || ''
      const index = remapProgress(book, old, entries)
      patch.durChapterIndex = index
      if (Number(book.durChapterTime) > 0) patch.durChapterTitle = entries[index]?.title || book.durChapterTitle || ''
    }
  } catch {
    /* 网络书源暂时不可用，下一次启动会再尝试（版本号未写入前） */
  }

  try {
    const info = await Promise.race([
      withRuntime(book.origin, (runtime) => runtime.info(book.bookUrl)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('信息获取超时')), 15000)),
    ])
    if (info?.kind && String(info.kind) !== book.kind) patch.kind = String(info.kind)
  } catch {
    /* 忽略单本信息失败 */
  }
  if (Object.keys(patch).length) store.saveBook({ ...book, ...patch }, userId)
  return true
}

/**
 * 手动重新识别一本本地书的目录（App「重新识别目录」调用）。
 * 与启动修复不同：这里允许章节数变少，由用户确认后主动覆盖。
 */
export async function reparseBookToc({ store, dataDir, bookUrl }) {
  const url = String(bookUrl || '')
  const book = store.getBook(url)
  if (!book) throw new Error('书籍不在书架中')
  if (!/^local:\/\//i.test(String(book.origin || ''))) {
    throw new Error('只有本地上传的书籍支持重新识别目录')
  }
  const source = localSourcePath(book, dataDir)
  if (!source) throw new Error('找不到这本书的原始文件，请重新上传')
  const parsed = parseLocalBook(new Uint8Array(readFileSync(source)), source.split(/[\\/]/).pop())
  const next = (parsed.chapters || []).filter((chapter) => String(chapter.text || '').trim())
  if (!next.length) throw new Error('没有识别到任何章节')
  const old = store.getChapters(book.bookUrl, book.origin) || []
  const entries = saveChapters(store, book, next)
  const index = remapProgress(book, old, entries)
  const patch = {
    totalChapterNum: entries.length,
    latestChapterTitle: entries.at(-1)?.title || '',
    wordCount: String(entries.reduce((sum, chapter) => sum + chapter.title.length + chapter.content.length, 0)),
    durChapterIndex: index,
  }
  if (Number(book.durChapterTime) > 0) patch.durChapterTitle = entries[index]?.title || book.durChapterTitle || ''
  store.saveBook({ ...book, ...patch })
  return {
    bookUrl: book.bookUrl,
    oldCount: old.length,
    newCount: entries.length,
    progressIndex: index,
    titles: entries.slice(0, 20).map((chapter) => chapter.title),
  }
}

export function scheduleShelfRepair({ app, store, dataDir, withRuntime }) {  if (process.env.DISABLE_SHELF_REPAIR === '1') return
  const markerPath = join(dataDir, '.shelf-repair.json')
  const marker = readJson(markerPath)
  if (marker?.version === SHELF_REPAIR_VERSION) return

  let cancelled = false
  const timer = setTimeout(async () => {
    if (cancelled) return
    const started = Date.now()
    let localFixed = 0
    let networkChecked = 0
    try {
      const users = typeof store.listUsers === 'function' ? store.listUsers() : [{ id: 1 }]
      for (const user of users) {
        const books = store.listBooks(user.id)
        for (const book of books) {
          if (cancelled) return
          try {
            if (/^local:\/\/(txt|epub|docx|mobi|pdf)$/i.test(String(book.origin || ''))) {
              if (await repairLocalBook({ store, dataDir, book, userId: user.id })) localFixed += 1
            } else {
              if (await repairNetworkBook({ store, withRuntime, book, userId: user.id })) networkChecked += 1
            }
          } catch (error) {
            app.log.warn(`[repair] ${book.name || book.bookUrl}: ${error.message}`)
          }
        }
      }
      writeFileSync(
        markerPath,
        JSON.stringify({ version: SHELF_REPAIR_VERSION, at: Date.now(), localFixed, networkChecked, ms: Date.now() - started }, null, 2),
      )
      app.log.info(`[repair] 完成：本地修正 ${localFixed} 本，网络检查 ${networkChecked} 本，用时 ${Date.now() - started}ms`)
    } catch (error) {
      app.log.warn(`[repair] 失败，将下次重试：${error.message}`)
    }
  }, 20000)
  timer.unref?.()
  app.addHook('onClose', () => {
    cancelled = true
    clearTimeout(timer)
  })
}
