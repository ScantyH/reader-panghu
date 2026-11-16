/**
 * Probe a WebView book source end-to-end through the server runtime.
 *
 *   node scripts/probe-source.js "<path-to-legado-source.json>" [keyword]
 *
 * Prints the functions the source exposes, then runs search → info → chapter →
 * content against the real upstream and reports what each step returned.
 */

import { readFileSync } from 'node:fs'
import { createRuntime } from '../packages/source-runtime/src/index.js'

const file = process.argv[2] || process.env.SOURCE_FILE
const keyword = process.argv[3] || '大奉打更人'
if (!file) {
  console.error('usage: node scripts/probe-source.js <source.json> [keyword]')
  process.exit(2)
}

const parsed = JSON.parse(readFileSync(file, 'utf8'))
const source = Array.isArray(parsed) ? parsed[0] : parsed

const rewrites = []
if (process.env.SOURCE_REWRITE_FROM && process.env.SOURCE_REWRITE_TO) {
  rewrites.push({ from: process.env.SOURCE_REWRITE_FROM, to: process.env.SOURCE_REWRITE_TO })
}

const runtime = createRuntime(source, {
  rewrites,
  timeoutMs: Number(process.env.SOURCE_TIMEOUT_MS || 45000),
  key: process.env.SOURCE_KEY || '',
})

const step = async (label, fn) => {
  const started = Date.now()
  try {
    const value = await fn()
    console.log(`\n=== ${label} OK (${Date.now() - started}ms) ===`)
    return value
  } catch (error) {
    console.log(`\n=== ${label} FAILED (${Date.now() - started}ms) ===`)
    console.log(`  ${error.code || error.name}: ${error.message}`)
    return null
  }
}

const preview = (value, max = 700) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

await runtime.init()
console.log(`source: ${source.bookSourceName || '(unnamed)'}  ${source.bookSourceUrl || ''}`)
const exposed = runtime.exposed
console.log(`exposed functions: ${exposed.join(', ') || '(none)'}`)

const books = await step(`search("${keyword}")`, () => runtime.search(keyword, 1))
if (books) console.log(preview(books))

const first = Array.isArray(books) ? books[0] : null
if (first) {
  const info = await step('info(bookUrl)', () => runtime.info(first.bookUrl || first.url))
  if (info) console.log(preview(info))

  const tocUrl = (info && (info.tocUrl || info.bookUrl)) || first.tocUrl || first.bookUrl
  const chapters = await step('chapter(tocUrl)', () => runtime.chapter(tocUrl))
  if (chapters) {
    console.log(`chapters: ${Array.isArray(chapters) ? chapters.length : 'not an array'}`)
    console.log(preview(Array.isArray(chapters) ? chapters.slice(0, 3) : chapters))
    const chapter = Array.isArray(chapters) ? chapters[0] : null
    const chapterUrl = chapter && (chapter.chapterId || chapter.url)
    if (chapterUrl) {
      const body = await step('content(chapterUrl)', () => runtime.content(chapterUrl))
      if (body) {
        console.log(`content chars: ${String(body).length}`)
        console.log(preview(body, 400))
      }
    }
  }
}

if (runtime.logs.length) {
  console.log('\n=== source logs ===')
  for (const line of runtime.logs.slice(0, 30)) console.log(`  ${line}`)
}
if (runtime.unsupported.length) {
  console.log(`\nunsupported bridge calls: ${[...new Set(runtime.unsupported)].join(', ')}`)
}
runtime.dispose()
