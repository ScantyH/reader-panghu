/**
 * Text normalization shared by the /api and /reader3 surfaces.
 *
 * WebView sources embed client-side UI into the content: paragraph-comment
 * markers (`dp:*` images carrying a JS handler) and similar decorations. A
 * server-rendered reading experience needs the prose, not those widgets.
 */

const DP_IMG = /<img[^>]*src="\s*dp:[^"]*"[^>]*>/gi

import { extractContentImages } from './source-text.js'

export function cleanText(value, { dropImages = false } = {}) {
  return (
    String(value ?? '')
      // 有的书源把卡片图转义成文本，连同带 key 的地址一起丢掉
      .replace(/&lt;img[\s\S]*?&gt;/gi, '')
      .replace(/&lt;\/?(div|p|br|span|a|font|h[1-6]|li|ul|table|tr|td)[^&]*?&gt;/gi, '\n')
      .replace(/&nbsp;/gi, ' ')
      .replace(DP_IMG, '')
      // 保留非段评图片的占位，其余 <img> 去掉；dropImages 用于把卡片图单独抽出来渲染
      .replace(/<img[^>]*>/gi, dropImages ? '' : '\n[图片]\n')
      .replace(/<\/?(div|p|br|span|a|font|h[1-6]|li|ul|table|tr|td)[^>]*>/gi, '\n')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/** Book intros: same rules, plus no leading/trailing blank lines. */
export const cleanIntro = cleanText
