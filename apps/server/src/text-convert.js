/**
 * 简繁转换与段落笔记。
 *
 * 简繁用 opencc-js（纯 JS，无原生依赖），服务端在返回正文时按需转换，
 * 这样缓存里存的是原文，切换语言不污染缓存。
 *
 * 段落笔记是"段评"的本地实现：书源里的段评依赖作者端的 dp 接口，
 * 服务端无法保证可用，所以这里存读者自己划的段落批注。
 */

const ok = (data) => ({ isSuccess: true, errorMsg: '', data })
const fail = (errorMsg) => ({ isSuccess: false, errorMsg, data: null })

let converters = null
async function getConverter(mode) {
  if (!converters) converters = {}
  if (converters[mode] !== undefined) return converters[mode]
  try {
    const opencc = await import('opencc-js')
    const factory = opencc.default ?? opencc
    const map =
      mode === 'tw'
        ? { from: 'cn', to: 'tw' }
        : mode === 'hk'
          ? { from: 'cn', to: 'hk' }
          : { from: 'tw', to: 'cn' }
    converters[mode] = factory.Converter(map)
  } catch {
    converters[mode] = null
  }
  return converters[mode]
}

/** @param {string} text @param {''|'tw'|'hk'|'cn'} mode */
export async function convertText(text, mode) {
  if (!mode || !text) return text
  const converter = await getConverter(mode)
  if (!converter) return text
  try {
    return converter(text)
  } catch {
    return text
  }
}

export function registerConvertHook(app) {
  app.addHook('onSend', async (req, _reply, payload) => {
    const convert = req.body?.convert
    const path = String(req.raw?.url || '').split('?')[0]
    if (!convert || path !== '/reader3/getBookContent') return payload
    if (typeof payload !== 'string') return payload
    try {
      const json = JSON.parse(payload)
      if (json?.isSuccess && typeof json.data === 'string') {
        json.data = await convertText(json.data, String(convert))
      }
      return JSON.stringify(json)
    } catch {
      return payload
    }
  })
}

export function registerNotes(app, { store }) {
  const readNotes = () => {
    const config = store.getUserConfig() || {}
    return config.chapterNotes && typeof config.chapterNotes === 'object' ? config.chapterNotes : {}
  }
  const writeNotes = (notes) => {
    const config = store.getUserConfig() || {}
    store.saveUserConfig({ ...config, chapterNotes: notes })
  }

  app.get('/reader3/getChapterNotes', async (req) => {
    const bookUrl = String(req.query?.bookUrl || '')
    if (!bookUrl) return fail('缺少 bookUrl')
    return ok(readNotes()[bookUrl] || [])
  })

  app.post('/reader3/saveChapterNote', async (req) => {
    const bookUrl = String(req.body?.bookUrl || '')
    const quote = String(req.body?.quote || '').trim()
    if (!bookUrl || !quote) return fail('缺少书籍或原文片段')
    const notes = readNotes()
    const list = notes[bookUrl] || []
    const note = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      chapterIndex: Number(req.body?.chapterIndex) || 0,
      quote: quote.slice(0, 400),
      note: String(req.body?.note || '').slice(0, 1000),
      createdAt: Date.now(),
    }
    list.push(note)
    notes[bookUrl] = list
    writeNotes(notes)
    return ok(note)
  })

  app.post('/reader3/deleteChapterNote', async (req) => {
    const bookUrl = String(req.body?.bookUrl || '')
    const id = String(req.body?.id || '')
    const notes = readNotes()
    const list = (notes[bookUrl] || []).filter((item) => item.id !== id)
    notes[bookUrl] = list
    writeNotes(notes)
    return ok({ deleted: true })
  })
}
