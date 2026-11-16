/**
 * Text normalization shared by the /api and /reader3 surfaces.
 *
 * WebView sources embed client-side UI into the content: paragraph-comment
 * markers (`dp:*` images carrying a JS handler) and similar decorations. A
 * server-rendered reading experience needs the prose, not those widgets.
 */

const DP_IMG = /<img[^>]*src="\s*dp:[^"]*"[^>]*>/gi

export function cleanText(value) {
  return String(value ?? '')
    .replace(DP_IMG, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Book intros: same rules, plus no leading/trailing blank lines. */
export const cleanIntro = cleanText
