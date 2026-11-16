import { createRouter, createWebHistory } from 'vue-router'
import Bookshelf from './views/Bookshelf.vue'
import Reader from './views/Reader.vue'
import Search from './views/Search.vue'
import Sources from './views/Sources.vue'
import Rss from './views/Rss.vue'
import Backup from './views/Backup.vue'
import Warehouse from './views/Warehouse.vue'
import Bookmarks from './views/Bookmarks.vue'
import ReplaceRules from './views/ReplaceRules.vue'
import CacheManage from './views/CacheManage.vue'
import Stats from './views/Stats.vue'
import Webdav from './views/Webdav.vue'
import Login from './views/Login.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/bookshelf' },
    { path: '/bookshelf', name: 'bookshelf', component: Bookshelf },
    { path: '/recent', name: 'recent', component: Bookshelf, props: { recentOnly: true } },
    { path: '/search', name: 'search', component: Search },
    { path: '/sources', name: 'sources', component: Sources },
    { path: '/rss', name: 'rss', component: Rss },
    { path: '/backup', name: 'backup', component: Backup },
    { path: '/warehouse', name: 'warehouse', component: Warehouse },
    { path: '/bookmarks', name: 'bookmarks', component: Bookmarks },
    { path: '/replace', name: 'replace', component: ReplaceRules },
    { path: '/cache', name: 'cache', component: CacheManage },
    { path: '/stats', name: 'stats', component: Stats },
    { path: '/webdav', name: 'webdav', component: Webdav },
    { path: '/login', name: 'login', component: Login },
    { path: '/read', name: 'reader', component: Reader, props: (route) => ({ bookUrl: String(route.query.book || '') }) },
  ],
})
