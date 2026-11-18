/**
 * 段评标记对齐 test：段落序号必须和阅读器渲染出的段落一致，
 * 章节名前的标记要归到「章节名」（-1），不能落到第 1 段。
 *
 *   node scripts/test-comments.mjs
 */

import { extractDpMarkers } from '../apps/server/src/comment-markers.js'

const html = `
<img src="dp:99+,{&quot;js&quot;:&quot;showCmt('https://example.com/comments/title')&quot;}"/>
<p>第一段正文。</p>

<p>第二段正文，带段评<img src="dp:5,{&quot;js&quot;:&quot;showCmt('https://example.com/comments/p2')&quot;}"/></p>

<p>第三段正文，也带段评<img src="dp:7,{&quot;js&quot;:&quot;showCmt('https://example.com/comments/p3')&quot;}"/></p>
`

const markers = extractDpMarkers(html)
const byParagraph = new Map(markers.map((marker) => [marker.paragraph, marker]))

const title = byParagraph.get(-1)
if (!title || title.count !== 99) {
  throw new Error(`章节名段评应标记为 -1/99 条，实际 ${JSON.stringify(markers)}`)
}
if (!title.url.includes('/comments/title')) throw new Error(`章节名段评地址不对：${title.url}`)
console.log(`  ✓ 章节名段评归位 → paragraph=-1, count=${title.count}`)

const first = markers.find((marker) => marker.paragraph === 0)
if (first) throw new Error('第一段没有段评标记，不应该出现 paragraph=0')

const second = byParagraph.get(1)
if (!second || second.count !== 5) {
  throw new Error(`第二段段评应标记为 1/5 条，实际 ${JSON.stringify(markers)}`)
}
const third = byParagraph.get(2)
if (!third || third.count !== 7) {
  throw new Error(`第三段段评应标记为 2/7 条，实际 ${JSON.stringify(markers)}`)
}
console.log(`  ✓ 段落序号与渲染文本对齐 → ${markers.map((marker) => marker.paragraph).join(',')}`)

console.log('\n段评标记 checks passed')
