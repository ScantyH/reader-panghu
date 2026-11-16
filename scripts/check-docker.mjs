/**
 * Static validation of the Docker deployment, for environments without Docker.
 *
 * This cannot prove the image builds. It proves the build inputs the Dockerfile
 * depends on all exist and agree with each other, which is where Dockerfile
 * deployments usually break (missing COPY source, lockfile drift, wrong port).
 *
 *   node scripts/check-docker.mjs
 */

import { existsSync, readFileSync } from 'node:fs'

const checks = []
const check = (name, condition, detail = '') => checks.push({ name, ok: Boolean(condition), detail })

const dockerfile = readFileSync('docker/Dockerfile', 'utf8')
const compose = readFileSync('docker/compose.yml', 'utf8')

// 1. every COPY source in the Dockerfile exists in the repo
const copySources = [...dockerfile.matchAll(/^\s*COPY\s+(.+)$/gm)]
  .map((match) => match[1].trim())
  .filter((line) => !line.startsWith('--from'))
  .flatMap((line) => line.split(/\s+/).filter((part) => !part.startsWith('--')))
  .filter((part) => part && !part.startsWith('/') && part !== ';')
for (const source of copySources) {
  check(`COPY source exists: ${source}`, existsSync(source), source)
}

// 2. the workspace manifests the image installs from exist and are consistent
const rootPkg = JSON.parse(readFileSync('package.json', 'utf8'))
const webPkg = JSON.parse(readFileSync('apps/web/package.json', 'utf8'))
const lock = readFileSync('pnpm-lock.yaml', 'utf8')
check('root package name', rootPkg.name === 'reader-panghu', rootPkg.name)
check('workspace lists apps/web', readFileSync('pnpm-workspace.yaml', 'utf8').includes('apps/web'))
check('web build script exists', Boolean(webPkg.scripts?.build), webPkg.scripts?.build)
check('lockfile mentions apps/web', lock.includes('apps/web'), 'pnpm-lock.yaml')
check('lockfile mentions apps/server', lock.includes('apps/server'), 'pnpm-lock.yaml')

// 3. runtime assumptions the server makes
const serverPkg = JSON.parse(readFileSync('apps/server/package.json', 'utf8'))
check('server has no native deps (alpine-safe)', !JSON.stringify(serverPkg.dependencies).match(/sqlite3|better-sqlite|sharp|canvas/), Object.keys(serverPkg.dependencies).join(','))
check('server uses node:sqlite (needs node >= 22.5)', existsSync('apps/server/src/db.js') && readFileSync('apps/server/src/db.js', 'utf8').includes("from 'node:sqlite'"))
const nodeImage = /FROM\s+node:(\d+)/.exec(dockerfile)?.[1]
check('base image is node >= 22', Number(nodeImage) >= 22, `node:${nodeImage}`)

// 4. ports and data volume agree across Dockerfile, compose and the server defaults
const expose = /EXPOSE\s+(\d+)/.exec(dockerfile)?.[1]
check('Dockerfile EXPOSE 18080', expose === '18080', expose)
check('Dockerfile sets DATA_DIR=/app/data', /DATA_DIR=\/app\/data/.test(dockerfile))
check('Dockerfile declares /app/data volume', /VOLUME\s+\["\/app\/data"\]/.test(dockerfile))
check('compose publishes 18080', compose.includes('18080:18080'))
check('compose mounts /app/data', compose.includes('/app/data'))
check('server default DATA_DIR is repo/data', readFileSync('apps/server/src/index.js', 'utf8').includes("join(repoRoot, 'data')"))
check('server binds HOST from env', readFileSync('apps/server/src/index.js', 'utf8').includes('process.env.HOST'))

// 5. build context must not ship local data or build output
const dockerignore = existsSync('.dockerignore') ? readFileSync('.dockerignore', 'utf8') : ''
check('.dockerignore excludes node_modules', /node_modules/.test(dockerignore) || !existsSync('.dockerignore'), dockerignore ? 'present' : 'missing')
check('.dockerignore excludes data/', /^data\/?$/m.test(dockerignore), dockerignore ? 'present' : 'missing')
check('.dockerignore excludes web dist', /dist/.test(dockerignore), dockerignore ? 'present' : 'missing')

let failed = 0
for (const item of checks) {
  if (!item.ok) failed += 1
  console.log(`${item.ok ? '✓' : '✗'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`)
}
console.log(`\n${checks.length - failed}/${checks.length} static checks passed`)
if (failed) {
  console.log('\n这些检查只能证明构建输入齐全，不能证明镜像可构建。')
  process.exit(1)
}
