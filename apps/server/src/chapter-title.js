/**
 * 纯文本分章：识别章节标题，并在完全没有标题时按约 10000 字自动分段。
 *
 * 支持：
 *   第一章 异界来客、第1卷 芥子秘境 第1章 离家、第一集 斗罗世界 第二章 ...
 *   序 / 序章 / 序言 / 引 / 引子 / 引言 / 楔子 / 前言 / 后记 / 尾声 / 番外
 *   1、异界来客、1. 异界来客、1章 赵颜妍的婚礼、1 江湖、001 财富...
 *   001【1993年的夏天】、二：婚礼现场、办公室的情人104
 *   正文 第一章 姬家长空 -> 第一章 姬家长空（正文前缀不显示）
 */

const NUM = '[0-9０-９一二三四五六七八九十百千万两零〇壹贰叁肆伍陆柒捌玖拾佰仟]+'
const UNIT = '[章节回卷篇集部]'
const STRUCT = `第\\s*${NUM}\\s*${UNIT}`
const START_STRUCT = new RegExp(`^\\s*${STRUCT}`)
const START_NUM_UNIT = new RegExp(`^\\s*${NUM}\\s*[章节回卷篇](?=\\s*\\S)`)
const BARE_SEP = new RegExp(`^\\s*${NUM}\\s*[、.．:：]\\s*(?=[^\\s\\d])`)
const BARE_BRACKET = new RegExp(`^\\s*${NUM}\\s*[\\[【（(]\\s*\\S`)
const BARE_SPACE = new RegExp(`^\\s*(?:[0-9０-９]{1,4}|[一二三四五六七八九十百千万两零〇]{1,8})\\s+(?=\\S)`)
const SPECIAL = /^(?:序章?|序言|引子?|引言|楔子|前言|后记|尾声|番外)(?:[\s:：、.．\-—].*)?$/
// 结尾编号型标题，如「办公室的情人104」；要求前面至少有 4 个中文字，降低把正文数字当标题的概率
const TRAILING_NUM = /^[\u4e00-\u9fff][\u4e00-\u9fff0-9A-Za-z·—\-《》“”‘’\s]{3,29}\d{1,4}\s*$/

/** 去掉不可见字符和「正文」前缀，标题只保留真正的章节名。 */
export function normalizeChapterTitle(value) {
  let title = String(value ?? '')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\r/g, '')
    .trim()
  title = title.replace(/^正文\s*[:：]?\s*/, '')
  title = title.replace(new RegExp(`正文(?=\\s*${STRUCT})`, 'g'), '')
  return title.replace(/\s+/g, ' ').trim()
}

export const isChapterTitle = (value) => {
  const title = normalizeChapterTitle(value)
  if (!title || title.length > 80) return false
  // 以句号/问号/感叹号结尾的通常是正文句子，不是目录标题
  if (/[。！？!?]\s*$/.test(title)) return false
  if (SPECIAL.test(title)) return true
  if (START_STRUCT.test(title)) return true
  if (START_NUM_UNIT.test(title)) return true
  if (BARE_SEP.test(title)) return true
  if (BARE_BRACKET.test(title)) return true
  if (BARE_SPACE.test(title)) return true
  if (TRAILING_NUM.test(title)) return true
  return false
}

/** 没有章节标题时，按约 target 字在段落边界切开。 */
function splitByLength(text, target = 10000) {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n').trim()
  if (!normalized) return []
  const blocks = (/\n\s*\n/.test(normalized) ? normalized.split(/\n\s*\n/) : normalized.split('\n'))
    .map((block) => block.trim())
    .filter(Boolean)
  if (!blocks.length) return []

  const chapters = []
  let current = []
  let size = 0
  const flush = () => {
    if (!current.length) return
    chapters.push(current.join('\n\n'))
    current = []
    size = 0
  }

  for (const block of blocks) {
    if (current.length && size + block.length + 2 > target) flush()
    current.push(block)
    size += block.length + 2
    if (size >= target) flush()
  }
  flush()

  return chapters.map((content, index) => ({ title: `第${index + 1}章`, text: content }))
}

/**
 * 把纯文本切成 `{ title, text }[]`。
 * 识别到标题时保留原分章；一个标题都没识别到时按 10000 字自动分段。
 */
export function splitPlainTextChapters(text, { fallbackTitle = '开始', target = 10000 } = {}) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const chapters = []
  let current = { title: normalizeChapterTitle(fallbackTitle) || '开始', lines: [] }
  let detected = 0

  for (const line of lines) {
    if (isChapterTitle(line)) {
      if (current.lines.join('').trim()) chapters.push(current)
      const title = normalizeChapterTitle(line)
      current = { title: title || `第${chapters.length + 1}章`, lines: [] }
      detected += 1
    } else {
      current.lines.push(line)
    }
  }
  if (current.lines.join('').trim()) chapters.push(current)

  if (!detected) return splitByLength(text, target)

  return chapters
    .map((chapter, index) => ({
      title: chapter.title || `第${index + 1}章`,
      text: chapter.lines.join('\n').trim(),
    }))
    .filter((chapter) => chapter.text)
}
