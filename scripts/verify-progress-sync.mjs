/**
 * 双向进度同步契约验证（模拟网页端与 App 端两个客户端）。
 *
 *   node scripts/verify-progress-sync.mjs [baseUrl]
 *
 * 1. 订阅 /reader3/progressSSE
 * 2. 网页端写入 → 必须收到 SSE 推送
 * 3. App 端带过期 clientUpdatedAt 写入 → 必须被拒绝且不广播
 * 4. App 端新写入 → 必须收到推送，且 getBookProgress 返回最新值
 *
 * 用空数据库的单用户实例跑最省事：
 *   DATA_DIR=/tmp/sync-check PORT=18082 node apps/server/src/index.js
 */

import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const base = (process.argv[2] || 'http://127.0.0.1:18082').replace(/\/+$/, '')

const call = async (path, { method = 'GET', body } = {}) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json()
  if (payload.isSuccess === false) throw new Error(`${path} → ${payload.errorMsg}`)
  return payload.data
}

const fixture = JSON.parse(readFileSync('scripts/fixtures/synthetic-source.json', 'utf8'))
await call('/reader3/saveBookSources', { method: 'POST', body: [fixture] })
const found = (await call('/reader3/searchBookMulti', { method: 'POST', body: { key: '同步' } }))[0]
if (!found) throw new Error('合成书源没有返回结果')
const info = await call('/reader3/getBookInfo', {
  method: 'POST',
  body: { url: found.bookUrl, bookSourceUrl: found.origin },
})
await call('/reader3/saveBook', { method: 'POST', body: info })

// 订阅 SSE，把收到的 data 帧收集起来
const events = []
const controller = new AbortController()
const sseTask = fetch(`${base}/reader3/progressSSE`, {
  signal: controller.signal,
  headers: { accept: 'text/event-stream' },
})
  .then(async (response) => {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue
          try {
            events.push(JSON.parse(line.slice(5).trim()))
          } catch {
            /* 忽略坏帧 */
          }
        }
      }
    }
  })
  .catch(() => {})

await sleep(400)

// 1. 网页端写入 → 推送
const webWrite = await call('/reader3/saveBookProgress', {
  method: 'POST',
  body: { bookUrl: info.bookUrl, index: 3, position: 120, device: 'web', clientUpdatedAt: Date.now() },
})
if (!webWrite.accepted) throw new Error('网页端写入没有被接受')
await sleep(400)
if (!events.some((event) => event.device === 'web' && event.index === 3)) {
  throw new Error('网页端写入没有通过 SSE 推送给其它设备')
}

// 2. 过期写入 → 拒绝且不广播
const stale = await call('/reader3/saveBookProgress', {
  method: 'POST',
  body: { bookUrl: info.bookUrl, index: 1, position: 0, device: 'app:ios', clientUpdatedAt: 1 },
})
if (stale.accepted !== false) throw new Error('过期的 App 写入应被拒绝')
await sleep(400)
if (events.some((event) => event.index === 1)) throw new Error('被拒绝的写入不应广播')

// 3. App 端新写入 → 推送并成为权威
const appWrite = await call('/reader3/saveBookProgress', {
  method: 'POST',
  body: {
    bookUrl: info.bookUrl,
    index: 5,
    position: 300,
    device: 'app:ios',
    clientUpdatedAt: Date.now() + 1000,
  },
})
if (!appWrite.accepted) throw new Error('App 端新写入没有被接受')
await sleep(400)
if (!events.some((event) => event.device === 'app:ios' && event.index === 5)) {
  throw new Error('App 端写入没有通过 SSE 推送给网页端')
}

const progress = await call(`/reader3/getBookProgress?bookUrl=${encodeURIComponent(info.bookUrl)}`)
if (progress.index !== 5 || progress.position !== 300) {
  throw new Error(`权威进度不对：index=${progress.index} position=${progress.position}`)
}

controller.abort()
void sseTask
console.log('✓ 网页 → SSE 推送')
console.log('✓ 过期写入被拒绝且不广播')
console.log('✓ App → SSE 推送，getBookProgress 返回权威进度')
console.log('\n双向进度同步契约验证通过')
