import { createRouter, createWebHistory } from 'vue-router'
import Bookshelf from './views/Bookshelf.vue'
import Reader from './views/Reader.vue'
import Search from './views/Search.vue'
import Sources from './views/Sources.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/bookshelf' },
    { path: '/bookshelf', name: 'bookshelf', component: Bookshelf },
    { path: '/recent', name: 'recent', component: Bookshelf, props: { recentOnly: true } },
    { path: '/search', name: 'search', component: Search },
    { path: '/sources', name: 'sources', component: Sources },
    { path: '/read', name: 'reader', component: Reader, props: (route) => ({ bookUrl: String(route.query.book || '') }) },
  ],
})
