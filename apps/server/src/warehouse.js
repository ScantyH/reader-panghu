/**
 * 书仓：服务端的本地书文件库。
 *
 * 目录结构就是分类：书仓根目录下的每个子目录是一个分类，
 * 用户可以在界面里新建分类、把书放进去，再一键导入书架。
 */

import { mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync, existsSync } from 'node:fs'
import { basename, join, normalize, relative, resolve } from 'node:path'
import { parseLocalBook } from './local-book.js'
import { bookQuotaError, permissionsFor } from './user-perms.js'

const ok = (data) => ({ isSuccess: true, errorMsg: '', data })
const fail = (errorMsg) => ({ isSuccess: false, errorMsg, data: null })

const BOOK_EXT = /\.(txt|epub|docx|mobi|azw3?|pdf)$/i

export function registerWarehouse(app, { store, dataDir }) {
  const root = resolve(process.env.LIBRARY_DIR || join(dataDir, 'library'))
  mkdirSync(root, { recursive: true })

  const warehouseBlocked = (req) =>
    permissionsFor(store, req).allowWarehouse ? '' : '当前账号没有使用书仓的权限，请联系管理员'

  /** 把用户传的相对路径限制在书仓根目录内 */
  const safePath = (input) => {
    const target = resolve(root, normalize(String(input || '.')))
    const rel = relative(root, target)
    if (rel.startsWith('..') || rel.includes(':')) throw new Error('路径越界')
    return { target, rel: rel.split('\\').join('/') }
  }

  const listDir = (relPath) => {
    const { target, rel } = safePath(relPath)
    if (!existsSync(target)) throw new Error('目录不存在')
    const entries = readdirSync(target, { withFileTypes: true })
    const books = store.listBooks()
    const importedPaths = new Set(books.map((book) => String(book.warehousePath || '')).filter(Boolean))
    const importedNames = new Set(books.filter((book) => book.originName === '书仓').map((book) => String(book.name || '')))
    const categories = []
    const files = []
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        // 书仓只允许一层分类：分类文件夹内不再展示/创建子分类
        if (rel) continue
        const count = readdirSync(join(target, entry.name)).filter((name) => BOOK_EXT.test(name)).length
        categories.push({ name: entry.name, path: childRel, bookCount: count })
      } else if (BOOK_EXT.test(entry.name)) {
        const baseName = entry.name.replace(/\.[^.]+$/, '')
        files.push({
          name: entry.name,
          path: childRel,
          size: statSync(join(target, entry.name)).size,
          imported: importedPaths.has(childRel) || importedNames.has(baseName),
        })
      }
    }
    categories.sort((a, b) => {
      const order = store.getWarehouseOrder()[rel] || []
      const ai = order.indexOf(a.path)
      const bi = order.indexOf(b.path)
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi)
      return a.name.localeCompare(b.name)
    })
    files.sort((a, b) => a.name.localeCompare(b.name))
    return { path: rel, categories, files, canCreateCategory: !rel }
  }

  /** 把解析结果写成书架里的一本书 */
  const saveParsedBook = (parsed, filename, options = {}) => {
    const uuid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const bookUrl = `local://${(parsed.origin || 'local://txt').split('://')[1]}/${uuid}`
    const chapters = (parsed.chapters || []).map((chapter, index) => ({
      title: chapter.title,
      url: `${bookUrl}#${index}`,
      index,
      content: chapter.text,
    }))
    if (!chapters.length) throw new Error('没有解析出章节')
    const meta = options.meta || {}

    const book = store.saveBook({
      name: String(meta.name || parsed.name || filename),
      author: String(meta.author || parsed.author || ''),
      bookUrl,
      origin: parsed.origin || 'local://txt',
      originName: '书仓',
      coverUrl: '',
      tocUrl: '',
      intro: String(meta.intro || parsed.intro || ''),
      kind: String(meta.kind || ''),
      latestChapterTitle: chapters[chapters.length - 1].title,
      wordCount: String(chapters.reduce((sum, chapter) => sum + chapter.content.length, 0)),
      type: 0,
      canUpdate: false,
      group: Number(meta.group || 0),
      totalChapterNum: chapters.length,
      warehousePath: String(options.filePath || ''),
    })
    store.saveChapters(bookUrl, book.origin, chapters.map(({ content, ...rest }) => rest))
    store.saveChapters(`${bookUrl}#content`, book.origin, chapters)
    return book
  }

  const parseWarehouseFile = (filePath) => {
    const { target, rel } = safePath(filePath)
    if (!existsSync(target)) throw new Error('文件不存在')
    if (!BOOK_EXT.test(target)) throw new Error('不支持的文件类型')
    const parsed = parseLocalBook(new Uint8Array(readFileSync(target)), basename(target))
    return { target, rel, parsed }
  }

  const existingBookFor = (filePath) => store.listBooks().find((book) => String(book.warehousePath || '') === filePath) || null

  app.get('/reader3/warehouse', async (req) => {
    const blocked = warehouseBlocked(req)
    if (blocked) return fail(blocked)
    try {
      return ok({ ...listDir(String(req.query?.path || '')), root })
    } catch (error) {
      return fail(error.message)
    }
  })

  app.post('/reader3/warehouse/reorder', async (req) => {
    const blocked = warehouseBlocked(req)
    if (blocked) return fail(blocked)
    const { target, rel } = safePath(String(req.body?.path || ''))
    if (!existsSync(target)) return fail('目录不存在')
    const names = Array.isArray(req.body?.names) ? req.body.names.map((name) => String(name)) : []
    if (!names.length) return fail('缺少排序列表')
    const order = store.getWarehouseOrder()
    order[rel] = names
    store.saveWarehouseOrder(order)
    return ok({ path: rel, names })
  })

  app.post('/reader3/warehouse/mkdir', async (req) => {
    const blocked = warehouseBlocked(req)
    if (blocked) return fail(blocked)
    const parent = String(req.body?.path || '')
    const name = String(req.body?.name || '').trim()
    if (!name) return fail('分类名不能为空')
    if (/[\\/:*?"<>|]/.test(name)) return fail('分类名不能包含特殊字符')
    const { target, rel } = safePath(parent)
    if (rel) return fail('分类文件夹内不能再新建分类')
    mkdirSync(join(target, name), { recursive: true })
    return ok({ created: name })
  })

  /** 导入前预览：解析书名、作者、简介、章节数，供编辑弹窗自动填充 */
  app.post('/reader3/warehouse/preview', async (req) => {
    const blocked = warehouseBlocked(req)
    if (blocked) return fail(blocked)
    try {
      const filePath = String(req.body?.path || '')
      if (!filePath) return fail('缺少文件路径')
      const { rel, parsed, target } = parseWarehouseFile(filePath)
      return ok({
        path: rel,
        name: parsed.name || basename(target),
        author: parsed.author || '',
        intro: parsed.intro || '',
        kind: '',
        chapterCount: Array.isArray(parsed.chapters) ? parsed.chapters.length : 0,
        size: statSync(target).size,
        imported: Boolean(existingBookFor(rel)),
      })
    } catch (error) {
      return fail(`读取失败：${error.message}`)
    }
  })

  app.post('/reader3/warehouse/import', async (req) => {
    const blocked = warehouseBlocked(req)
    if (blocked) return fail(blocked)
    const quota = bookQuotaError(store, req, 1)
    if (quota) return fail(quota)
    const filePath = String(req.body?.path || '')
    if (!filePath) return fail('缺少文件路径')
    const existing = existingBookFor(filePath)
    if (existing) return ok({ book: existing, already: true })
    try {
      const { rel, parsed } = parseWarehouseFile(filePath)
      const meta = req.body?.meta || req.body || {}
      const book = saveParsedBook(parsed, basename(filePath), { filePath: rel, meta })
      return ok({ book })
    } catch (error) {
      return fail(`导入失败：${error.message}`)
    }
  })

  /** 批量导入选中的书仓文件到同一个书架分组 */
  app.post('/reader3/warehouse/importBatch', async (req) => {
    const blocked = warehouseBlocked(req)
    if (blocked) return fail(blocked)
    const paths = Array.isArray(req.body?.paths) ? [...new Set(req.body.paths.map((path) => String(path)).filter(Boolean))] : []
    if (!paths.length) return fail('请先选择要导入的书籍')
    const group = Number(req.body?.group || 0)
    const quota = bookQuotaError(store, req, paths.length)
    if (quota) return fail(quota)
    const imported = []
    const failed = []
    const skipped = []
    for (const filePath of paths) {
      try {
        if (existingBookFor(filePath)) {
          skipped.push(filePath)
          continue
        }
        const { rel, parsed } = parseWarehouseFile(filePath)
        const book = saveParsedBook(parsed, basename(filePath), { filePath: rel, meta: { group } })
        imported.push({ path: filePath, bookUrl: book.bookUrl, name: book.name })
      } catch (error) {
        failed.push({ path: filePath, error: error.message })
      }
    }
    return ok({ imported, failed, skipped, total: paths.length })
  })

  /** 把已导入的书从书架移除，但保留书仓文件 */
  app.post('/reader3/warehouse/removeFromShelf', async (req) => {
    const blocked = warehouseBlocked(req)
    if (blocked) return fail(blocked)
    const filePath = String(req.body?.path || '')
    const book = existingBookFor(filePath)
    if (!book) return fail('这本书不在书架里')
    store.deleteBook(book.bookUrl)
    return ok({ removed: true, bookUrl: book.bookUrl, name: book.name })
  })

  app.post('/reader3/warehouse/upload', async (req) => {
    const blocked = warehouseBlocked(req)
    if (blocked) return fail(blocked)
    const part = await req.file?.()
    if (!part) return fail('缺少文件')
    const dirPath = String(req.query?.path || '')
    const { target } = safePath(dirPath)
    mkdirSync(target, { recursive: true })
    const filename = basename(part.filename || 'book.txt')
    const buffer = Buffer.from(await part.toBuffer())
    writeFileSync(join(target, filename), buffer)
    return ok({ uploaded: filename, size: buffer.length })
  })

  app.post('/reader3/warehouse/delete', async (req) => {
    const blocked = warehouseBlocked(req)
    if (blocked) return fail(blocked)
    try {
    const filePath = String(req.body?.path || '')
    if (!filePath) return fail('缺少路径')
    const { target } = safePath(filePath)
    if (!existsSync(target)) return fail('不存在')
    const stat = statSync(target)
    if (stat.isDirectory()) {
      // 只允许删除空目录，避免误删整仓
      if (readdirSync(target).length) return fail('目录不为空，请先清空里面的书')
      rmdirSync(target)
    } else {
      unlinkSync(target)
    }
    return ok({ deleted: filePath })
    } catch (error) {
      return fail(error.message)
    }
  })

  app.log.info(`[warehouse] root=${root}`)
}
