import { createApp } from 'vue'
import App from './App.vue'
import router from './router.js'
import { bootstrapFromURL } from './api.js'
import './styles.css'
import './ui.css'

bootstrapFromURL()

createApp(App).use(router).mount('#app')
