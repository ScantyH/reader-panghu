/**
 * Legado / 阅读3 book-source generator.
 *
 * The unified server already speaks HTTP; a Legado client only understands
 * rule-based sources (searchUrl + JSONPath rules). This module bridges the two:
 * it emits a normal 阅读3 book source whose rules read the server's own JSON.
 *
 * Shape contract with the server (keep in sync with apps/server/src/index.js):
 *   search   → { books:   [{name, author, kind, intro, coverUrl, bookUrl, tocUrl, wordCount, latestChapterTitle, type}] }
 *   detail   → { name, author, kind, intro, coverUrl, tocUrl, wordCount, latestChapterTitle, type }
 *   toc      → { chapters:[{name, chapterId, index, isVip, isPay, isVolume, tag}] }
 *   content  → { content: "..." }
 */

/**
 * @param {object} options
 * @param {string} options.id            server-side source id
 * @param {string} options.name          display name
 * @param {string} options.baseUrl       public base URL of the server, no trailing slash
 * @param {string} [options.group]
 * @param {string} [options.upstreamNote]
 */
export function generateLegadoSource({ id, name, baseUrl, group = '自建', upstreamNote = '' }) {
  const api = `${String(baseUrl).replace(/\/+$/, '')}/api`
  const sourceId = encodeURIComponent(id)

  return {
    bookSourceName: name,
    bookSourceGroup: group,
    bookSourceType: 0,
    bookSourceUrl: `reader-panghu://${id}`,
    bookSourceComment: upstreamNote,
    enabled: true,
    enabledExplore: false,
    enabledCookieJar: false,
    customOrder: 100,
    searchUrl: `${api}/search?source=${sourceId}&q={{key}}&page={{page}}`,
    ruleSearch: {
      bookList: '$.books',
      name: '$.name',
      author: '$.author',
      kind: '$.kind',
      intro: '$.intro',
      coverUrl: '$.coverUrl',
      bookUrl: '$.bookUrl',
      lastChapter: '$.latestChapterTitle',
      wordCount: '$.wordCount',
    },
    ruleBookInfo: {
      init: '-',
      name: '$.name',
      author: '$.author',
      kind: '$.kind',
      intro: '$.intro',
      coverUrl: '$.coverUrl',
      tocUrl: '$.tocUrl',
      wordCount: '$.wordCount',
      lastChapter: '$.latestChapterTitle',
    },
    ruleToc: {
      chapterList: '$.chapters',
      chapterName: '$.name',
      chapterUrl: '$.chapterId',
      index: '$.index',
      isVip: '$.isVip',
      isPay: '$.isPay',
    },
    ruleContent: {
      content: '$.content',
    },
  }
}

/** Wrap one or more sources as an importable 阅读3 JSON document. */
export function toImportDocument(sources) {
  return JSON.stringify(Array.isArray(sources) ? sources : [sources], null, 2)
}
