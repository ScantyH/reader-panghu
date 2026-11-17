/* 临时诊断：把运行时报错显示到页面上，便于定位空白页 */
function __errorOverlay(message, stack) {
  try {
    const box = document.createElement('pre')
    box.style.cssText = 'position:fixed;inset:0;z-index:99999;margin:0;padding:20px;background:#1b1b1b;color:#ff9b8a;font:12px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow:auto'
    box.textContent = '页面出错（请把这段发给我）\n\n' + message + '\n\n' + (stack || '')
    document.body.appendChild(box)
  } catch {
    /* 忽略 */
  }
}
window.addEventListener('error', (event) => __errorOverlay(event.message, event.error && event.error.stack))
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason || {}
  __errorOverlay(String(reason.message || reason), reason.stack)
})

import { createApp } from 'vue'
import App from './App.vue'
import router from './router.js'
import './styles.css'
import './ui.css'

createApp(App).use(router).mount('#app')
