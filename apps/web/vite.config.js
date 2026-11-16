import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const backend = `http://127.0.0.1:${process.env.SERVER_PORT ?? '18080'}`

export default defineConfig({
  plugins: [vue()],
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
