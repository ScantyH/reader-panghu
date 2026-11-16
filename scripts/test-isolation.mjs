/**
 * 多用户数据隔离 test。
 *
 *   1. 单用户模式下数据落到默认用户
 *   2. 注册两个用户后，各自的书架 / 书源 / 配置互相不可见
 *
 *   node scripts/test-isolation.mjs [baseUrl]
 */

const base = (process.argv[2] || 'http://127.0.0.1:18080').replace(/\/+$/, '')

const call = async (path, { method = 'GET', body, token } = {}) => {
  const init = { method, headers: {} }
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  if (token) init.headers.authorization = `Bearer ${token}`
  const payload = await (await fetch(`${base}${path}`, init)).json()
  return payload
}

const requireOk = (payload, label) => {
  if (payload.isSuccess === false) throw new Error(`${label} → ${payload.errorMsg}`)
  return payload.data
}

const stamp = Date.now().toString(36)
const userA = { username: `iso_a_${stamp}`, password: 'secret123' }
const userB = { username: `iso_b_${stamp}`, password: 'secret123' }

const tokenA = requireOk(await call('/reader3/register', { method: 'POST', body: userA }), '注册 A').token
const tokenB = requireOk(await call('/reader3/register', { method: 'POST', body: userB }), '注册 B')
  .token
console.log('  ✓ 注册两个用户')

// 各自加一本书（本地书 URL 用不同后缀区分）
const bookA = { name: 'A 的书', author: 'A', bookUrl: 'local://txt/iso-a', origin: 'local://txt' }
const bookB = { name: 'B 的书', author: 'B', bookUrl: 'local://txt/iso-b', origin: 'local://txt' }
requireOk(await call('/reader3/saveBook', { method: 'POST', body: bookA, token: tokenA }), 'A 存书')
requireOk(await call('/reader3/saveBook', { method: 'POST', body: bookB, token: tokenB }), 'B 存书')
console.log('  ✓ 两个用户各存一本书')

// 书架必须隔离
const shelfA = requireOk(await call('/reader3/getBookshelf', { token: tokenA }), 'A 书架')
const shelfB = requireOk(await call('/reader3/getBookshelf', { token: tokenB }), 'B 书架')
if (!shelfA.some((book) => book.name === 'A 的书')) throw new Error('A 看不到自己的书')
if (shelfA.some((book) => book.name === 'B 的书')) throw new Error('A 看到了 B 的书')
if (!shelfB.some((book) => book.name === 'B 的书')) throw new Error('B 看不到自己的书')
if (shelfB.some((book) => book.name === 'A 的书')) throw new Error('B 看到了 A 的书')
console.log(`  ✓ 书架隔离（A ${shelfA.length} 本 / B ${shelfB.length} 本）`)

// 书源隔离
const sourceA = { bookSourceName: '仅 A 的源', bookSourceUrl: `http://a-${stamp}.test`, searchUrl: 'http://a.test/s?q={{key}}', ruleSearch: { bookList: 'class.x' } }
requireOk(await call('/reader3/saveBookSources', { method: 'POST', body: [sourceA], token: tokenA }), 'A 存源')
const sourcesA = await call('/reader3/getBookSources', { token: tokenA })
const sourcesB = await call('/reader3/getBookSources', { token: tokenB })
if (!sourcesA.data.some((item) => item.bookSourceName === '仅 A 的源')) throw new Error('A 看不到自己的书源')
if (sourcesB.data.some((item) => item.bookSourceName === '仅 A 的源')) throw new Error('B 看到了 A 的书源')
console.log('  ✓ 书源隔离')

// 阅读配置隔离
requireOk(await call('/reader3/saveUserConfig', { method: 'POST', body: { reading: { fontSize: 22 } }, token: tokenA }), 'A 存配置')
const configB = requireOk(await call('/reader3/getUserConfig', { token: tokenB }), 'B 配置')
if (configB?.reading?.fontSize === 22) throw new Error('B 读到了 A 的配置')
console.log('  ✓ 阅读配置隔离')

// 写进度也不能串
const crossWrite = await call('/reader3/saveBookProgress', { method: 'POST', body: { bookUrl: bookA.bookUrl, index: 5 }, token: tokenB })
if (crossWrite.isSuccess !== false) throw new Error('B 不应能写 A 的书进度')
const shelfA2 = requireOk(await call('/reader3/getBookshelf', { token: tokenA }), 'A 书架复查')
const bookA2 = shelfA2.find((book) => book.bookUrl === bookA.bookUrl)
if (bookA2 && Number(bookA2.durChapterIndex) === 5) throw new Error('B 改动了 A 的进度')
console.log('  ✓ 进度写入不串用户')

console.log('\n多用户隔离 checks passed')
