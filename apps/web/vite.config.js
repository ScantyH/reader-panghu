import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const backend = `http://127.0.0.1:${process.env.SERVER_PORT ?? '18080'}`
const rootPackage = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [vue()],
  define: {
    // 顶栏「系统版本号」在构建时写入，避免运行时再请求一次
    __APP_VERSION__: JSON.stringify(`v${rootPackage.version}`),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/reader3': { target: backend, changeOrigin: true },
      '/api': { target: backend, changeOrigin: true },
    },
  },
  build: { outDir: 'dist' },
})
