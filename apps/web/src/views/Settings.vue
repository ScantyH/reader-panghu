<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, setToken } from '../api.js'
import { useSortable } from '../use-sortable.js'

const route = useRoute()
const router = useRouter()

const SECTIONS = [
  { id: 'account', label: '账号', icon: '👤', desc: '账号信息、密码与用户' },
  { id: 'shelf', label: '书架', icon: '📚', desc: '导入、分组、缓存与工具' },
  { id: 'data', label: '数据', icon: '📈', desc: '阅读统计、备份与 WebDAV' },
  { id: 'system', label: '系统', icon: '⚙️', desc: '运行状态与关于' },
]

const section = computed(() => {
  const wanted = String(route.params.section || '')
  return SECTIONS.some((item) => item.id === wanted) ? wanted : 'account'
})
const current = computed(() => SECTIONS.find((item) => item.id === section.value) || SECTIONS[0])
const adminUsers = computed(() => users.value.filter((user) => user.role === 'admin'))
const orderedUsers = computed(() => [...adminUsers.value, ...subUsers.value])

const me = ref({ username: '', role: 'user', authEnabled: false, allowWebdav: true, allowWarehouse: true })
const users = ref([])
const subUsers = ref([])
const health = ref(null)
const groupList = ref([])
const oldPassword = ref('')
const newPassword = ref('')
const newGroupName = ref('')
const editingUser = ref('')
const userDraft = ref({})
const loading = ref(false)
const importInput = ref(null)
const importBusy = ref(false)
const updateBusy = ref(false)
const cacheBusy = ref(false)
const shelfStatus = ref('')

const {
  start: startUserDrag,
  cancel: cancelUserDrag,
  draggingId: userDraggingId,
} = useSortable({
  getIds: () => subUsers.value.map((user) => user.username),
  move: (from, to) => {
    const list = [...subUsers.value]
    const [item] = list.splice(from, 1)
    list.splice(to, 0, item)
    subUsers.value = list
  },
  onCommit: saveUserOrder,
})

const {
  start: startGroupDrag,
  cancel: cancelGroupDrag,
  draggingId: groupDraggingId,
} = useSortable({
  getIds: () => groupList.value.map((group) => String(group.groupId)),
  move: (from, to) => {
    const list = [...groupList.value]
    const [item] = list.splice(from, 1)
    list.splice(to, 0, item)
    groupList.value = list
  },
  onCommit: saveGroupOrder,
})

const isAdmin = () => me.value.role === 'admin'
const appVersion = __APP_VERSION__

const uptimeText = computed(() => {
  const minutes = Math.round((Number(health.value?.uptime) || 0) / 60)
  if (!minutes) return '不到 1 分钟'
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
})

async function load() {
  loading.value = true
  try {
    const info = await api.getUserInfo()
    if (info) me.value = { ...me.value, ...info }
    health.value = await fetch('/api/health').then((response) => response.json()).catch(() => null)
    const groupRows = await api.groups()
    groupList.value = groupRows.filter((group) => Number(group.groupId) !== 0)
    if (isAdmin()) {
      users.value = await api.userList().catch(() => [])
      subUsers.value = users.value.filter((user) => user.role !== 'admin')
    }
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

async function loadGroups() {
  const groupRows = await api.groups().catch(() => null)
  if (groupRows) groupList.value = groupRows.filter((group) => Number(group.groupId) !== 0)
}

async function saveUserOrder() {
  try {
    await api.reorderUsers(subUsers.value.map((user) => user.username))
    window.__toast?.('账号顺序已保存')
  } catch (error) {
    window.__toast?.(error.message)
    await load()
  }
}

async function saveGroupOrder() {
  try {
    await api.reorderBookGroups(groupList.value.map((group) => group.groupId))
    window.__toast?.('分组顺序已保存')
  } catch (error) {
    window.__toast?.(error.message)
    await loadGroups()
  }
}

async function changePassword() {
  if (newPassword.value.length < 6) {
    window.__toast?.('新密码至少 6 位')
    return
  }
  try {
    await api.changePassword({ oldPassword: oldPassword.value, newPassword: newPassword.value })
    oldPassword.value = ''
    newPassword.value = ''
    window.__toast?.('密码已修改')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function toggleRole(user) {
  const next = user.role === 'admin' ? 'user' : 'admin'
  if (!confirm(`把「${user.username}」设为${next === 'admin' ? '管理员' : '普通用户'}？`)) return
  try {
    await api.setUserRole({ username: user.username, role: next })
    await load()
    window.__toast?.('角色已更新')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function removeUser(user) {
  if (!confirm(`删除账号「${user.username}」？它的书架与书源会一并删除。`)) return
  try {
    await api.deleteUser({ username: user.username })
    await load()
    window.__toast?.('已删除')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/** 打开子账号的配额与功能开关 */
function editUser(user) {
  if (editingUser.value === user.username) {
    editingUser.value = ''
    return
  }
  editingUser.value = user.username
  userDraft.value = {
    note: user.note || '',
    bookLimit: Number(user.bookLimit) || 0,
    sourceLimit: Number(user.sourceLimit) || 0,
    allowWebdav: Boolean(user.allowWebdav),
    allowWarehouse: Boolean(user.allowWarehouse),
    allowEditSources: Boolean(user.allowEditSources),
    allowEditRss: Boolean(user.allowEditRss),
  }
}

async function saveUserSettings(user) {
  try {
    await api.setUserSettings({ username: user.username, ...userDraft.value })
    await load()
    editingUser.value = ''
    window.__toast?.('权限已保存')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/** 把管理员自己的书源/RSS 复制给子账号，供只读使用 */
async function copyUserLibrary(user) {
  if (!confirm(`把当前管理员的书源和 RSS 订阅复制给「${user.username}」？`)) return
  try {
    const result = await api.copyUserLibrary({ username: user.username })
    window.__toast?.(`已分配书源 ${result.sources} 个、RSS ${result.rss} 个`)
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

function openImport() {
  importInput.value?.click()
}

async function importBook(event) {
  const file = event.target.files?.[0]
  if (!file) return
  importBusy.value = true
  shelfStatus.value = `正在导入《${file.name}》…`
  try {
    const book = await api.uploadLocal(file)
    shelfStatus.value = `已加入《${book?.name || file.name}》`
    window.__toast?.(shelfStatus.value)
    await loadGroups()
  } catch (error) {
    shelfStatus.value = error.message
    window.__toast?.(error.message)
  } finally {
    importBusy.value = false
    event.target.value = ''
  }
}

function goBatch() {
  router.push({ path: '/bookshelf', query: { manage: '1' } })
}

async function addGroup() {
  const name = newGroupName.value.trim()
  if (!name) return
  try {
    await api.saveBookGroup({ groupId: Date.now() % 100000, groupName: name })
    newGroupName.value = ''
    await loadGroups()
    window.__toast?.('分组已创建')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function renameGroup(group) {
  const name = prompt('新的分组名', group.groupName)
  if (!name || name === group.groupName) return
  try {
    await api.saveBookGroup({ groupId: group.groupId, groupName: name, orderNo: group.orderNo || 0 })
    await loadGroups()
    window.__toast?.('已改名')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function removeGroup(group) {
  if (!confirm(`删除分组「${group.groupName}」？组内书籍会回到「全部」，不会被删除。`)) return
  try {
    await api.deleteBookGroup(group.groupId)
    await loadGroups()
    window.__toast?.('已删除')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function checkUpdates() {
  if (updateBusy.value) return
  updateBusy.value = true
  shelfStatus.value = '正在检查更新…'
  try {
    const started = await api.checkChapterUpdates()
    if (!started?.started) {
      shelfStatus.value = started?.reason === 'already-running' ? '已有检查在进行中' : '书架里还没有连载书'
      return
    }
    shelfStatus.value = `正在检查 ${started.total} 本…`
    for (let round = 0; round < 160; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const status = await api.chapterUpdateStatus()
      if (status.running) continue
      const count = status.updatedBooks?.length || 0
      shelfStatus.value = count ? `${count} 本有新章节` : '暂无更新'
      window.__toast?.(shelfStatus.value)
      return
    }
  } catch (error) {
    shelfStatus.value = error.message
    window.__toast?.(error.message)
  } finally {
    updateBusy.value = false
  }
}

async function refreshCache() {
  if (cacheBusy.value) return
  cacheBusy.value = true
  try {
    const shelf = await api.bookshelf()
    const targets = [...shelf]
      .sort((a, b) => Number(b.durChapterTime || 0) - Number(a.durChapterTime || 0))
      .slice(0, 5)
    if (!targets.length) {
      shelfStatus.value = '书架还是空的'
      return
    }
    shelfStatus.value = `正在刷新前 ${targets.length} 本的缓存…`
    for (const book of targets) await api.cacheBook(book.bookUrl, 20, true).catch(() => {})
    shelfStatus.value = '缓存已刷新'
    window.__toast?.('缓存已刷新')
  } catch (error) {
    shelfStatus.value = error.message
    window.__toast?.(error.message)
  } finally {
    cacheBusy.value = false
  }
}

async function logout() {
  await api.logout().catch(() => {})
  setToken('')
  location.href = '/login'
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <h1>设置</h1>
      <span class="badge">{{ me.username || '未登录' }} · {{ isAdmin() ? '管理员' : '普通用户' }}</span>
      <div class="spacer" />
      <button class="ghost" :disabled="loading" @click="load">刷新</button>
    </div>

    <div class="settings-layout">
      <nav class="settings-nav" aria-label="设置分类">
        <router-link
          v-for="item in SECTIONS"
          :key="item.id"
          :to="'/settings/' + item.id"
          class="settings-nav-item"
          :class="{ active: section === item.id }"
        >
          <span class="settings-nav-icon">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </router-link>
      </nav>

      <section class="settings-panel">
        <header class="settings-panel-head">
          <h2>{{ current.label }}</h2>
          <p>{{ current.desc }}</p>
        </header>

        <!-- 账号 -->
        <template v-if="section === 'account'">
          <div class="settings-card">
            <div class="settings-card-title">账号信息</div>
            <div class="settings-kv"><span>用户名</span><b>{{ me.username || '—' }}</b></div>
            <div class="settings-kv"><span>角色</span><span class="badge accent">{{ isAdmin() ? '管理员' : '普通用户' }}</span></div>
            <div class="settings-kv">
              <span>登录模式</span>
              <span>{{ me.authEnabled ? '多用户（已开启登录）' : '单用户（无需登录）' }}</span>
            </div>
          </div>

          <div class="settings-card">
            <div class="settings-card-title">修改密码</div>
            <div class="settings-inline-form">
              <input v-model="oldPassword" type="password" name="rp-old-pass" autocomplete="new-password" placeholder="原密码" style="max-width: 200px" />
              <input v-model="newPassword" type="password" name="rp-new-pass" autocomplete="new-password" placeholder="新密码（≥6 位）" style="max-width: 200px" />
              <button class="primary" @click="changePassword">保存</button>
            </div>
          </div>

          <div v-if="isAdmin()" class="settings-card">
            <div class="settings-card-title">用户管理</div>
            <template v-for="user in orderedUsers" :key="user.username">
              <div
                class="settings-row"
                :data-sort-id="user.role === 'admin' ? undefined : user.username"
                :class="{ dragging: user.role !== 'admin' && userDraggingId === user.username }"
              >
                <span
                  v-if="user.role !== 'admin'"
                  class="sort-handle"
                  title="长按拖动排序"
                  @pointerdown.prevent="startUserDrag($event, user.username)"
                  @pointerup="cancelUserDrag"
                >≡</span>
                <div class="settings-row-icon">👤</div>
                <div class="settings-row-main">
                  <div class="settings-row-title">
                    {{ user.username }}
                    <span class="badge" :class="{ accent: user.role === 'admin' }" style="margin-left: 6px">
                      {{ user.role === 'admin' ? '管理员' : '普通用户' }}
                    </span>
                    <span v-if="user.current" class="badge" style="margin-left: 6px">当前</span>
                  </div>
                  <div class="settings-row-desc">
                    <template v-if="user.role === 'admin'">不受配额与功能开关限制</template>
                    <template v-else>
                      <span v-if="user.note" class="settings-user-note">备注：{{ user.note }} · </span>
                      书籍上限 {{ user.bookLimit || '不限' }} · 书源上限 {{ user.sourceLimit || '不限' }} ·
                      {{ user.hasPassword ? '已设密码' : '无密码' }}
                    </template>
                  </div>
                </div>
                <button v-if="user.role !== 'admin'" class="ghost" @click="editUser(user)">
                  {{ editingUser === user.username ? '收起' : '权限' }}
                </button>
                <button class="ghost" @click="toggleRole(user)">{{ user.role === 'admin' ? '降为普通' : '设为管理员' }}</button>
                <button class="ghost" @click="removeUser(user)">删除</button>
              </div>

              <div v-if="editingUser === user.username" class="settings-user-editor">
                <div class="row" style="padding-top: 10px">
                  <button class="page-back-btn" @click="editingUser = ''"><span aria-hidden="true">←</span> 返回 用户管理</button>
                </div>
                <div class="settings-inline-form" style="padding: 12px 0 10px">
                  <label class="settings-field">
                    备注
                    <input v-model="userDraft.note" type="text" maxlength="60" placeholder="例如：家人 / 手机端" style="width: 180px" />
                  </label>
                  <label class="settings-field">
                    书籍上限
                    <input v-model.number="userDraft.bookLimit" type="number" min="0" step="1" placeholder="0 = 不限" />
                  </label>
                  <label class="settings-field">
                    书源上限
                    <input v-model.number="userDraft.sourceLimit" type="number" min="0" step="1" placeholder="0 = 不限" />
                  </label>
                </div>
                <div class="settings-perms">
                  <label><input v-model="userDraft.allowWebdav" type="checkbox" /> 启用 WebDAV</label>
                  <label><input v-model="userDraft.allowWarehouse" type="checkbox" /> 启用书仓</label>
                  <label><input v-model="userDraft.allowEditSources" type="checkbox" /> 编辑书源</label>
                  <label><input v-model="userDraft.allowEditRss" type="checkbox" /> 编辑 RSS 源</label>
                </div>
                <div class="row" style="gap: 8px; flex-wrap: wrap">
                  <button class="primary" @click="saveUserSettings(user)">保存权限</button>
                  <button class="ghost" @click="copyUserLibrary(user)">分配我的书源 / RSS</button>
                  <button class="ghost" @click="editingUser = ''">取消</button>
                </div>
                <div class="settings-row-desc" style="margin-top: 8px">
                  关闭「编辑书源 / 编辑 RSS 源」后，该账号不能自行增删改，只能使用你分配的源；之后改完书源再点一次「分配我的书源 / RSS」同步。
                </div>
              </div>
            </template>
            <div v-if="!orderedUsers.length" class="settings-kv"><span>还没有其他账号</span></div>
          </div>

          <div v-if="me.authEnabled" class="settings-card">
            <button class="settings-row danger" @click="logout">
              <div class="settings-row-icon">🚪</div>
              <div class="settings-row-main"><div class="settings-row-title">退出登录</div></div>
            </button>
          </div>
        </template>

        <!-- 书架 -->
        <template v-else-if="section === 'shelf'">
          <div class="settings-card">
            <div class="settings-card-title">导入与管理</div>
            <input
              ref="importInput"
              type="file"
              accept=".txt,.epub,.docx,.mobi,.azw3,.azw,.pdf"
              hidden
              @change="importBook"
            />
            <button class="settings-row" :disabled="importBusy" @click="openImport">
              <div class="settings-row-icon">＋</div>
              <div class="settings-row-main">
                <div class="settings-row-title">导入本地书</div>
                <div class="settings-row-desc">TXT / EPUB / DOCX / MOBI / AZW3 / PDF</div>
              </div>
              <span class="settings-row-meta">{{ importBusy ? '导入中…' : '选择文件' }}</span>
            </button>
            <button class="settings-row" @click="goBatch">
              <div class="settings-row-icon">☑️</div>
              <div class="settings-row-main">
                <div class="settings-row-title">批量管理书架</div>
                <div class="settings-row-desc">多选书籍，批量移动分组或删除</div>
              </div>
              <span class="settings-row-meta">前往</span>
            </button>
            <div class="settings-row" style="align-items: flex-start">
              <div class="settings-row-icon">🗂️</div>
              <div class="settings-row-main">
                <div class="settings-row-title">分组管理</div>
                <div class="settings-row-desc">新建、改名或删除书架分组</div>
                <div class="settings-inline-form" style="padding: 8px 0 0">
                  <input v-model="newGroupName" placeholder="新分组名称" @keyup.enter="addGroup" />
                  <button class="primary" @click="addGroup">新建</button>
                </div>
                <div
                  v-for="group in groupList"
                  :key="group.groupId"
                  class="settings-group-row"
                  :data-sort-id="String(group.groupId)"
                  :class="{ dragging: groupDraggingId === String(group.groupId) }"
                >
                  <span
                    class="sort-handle"
                    title="长按拖动排序"
                    @pointerdown.prevent="startGroupDrag($event, String(group.groupId))"
                    @pointerup="cancelGroupDrag"
                  >≡</span>
                  <span>{{ group.groupName }}</span>
                  <button class="ghost" @click="renameGroup(group)">改名</button>
                  <button class="ghost" @click="removeGroup(group)">删除</button>
                </div>
                <div v-if="!groupList.length" class="settings-row-desc">还没有分组</div>
              </div>
            </div>
          </div>

          <div class="settings-card">
            <div class="settings-card-title">阅读工具</div>
            <router-link v-if="me.allowWarehouse" class="settings-row link" to="/warehouse">
              <div class="settings-row-icon">🗄️</div>
              <div class="settings-row-main">
                <div class="settings-row-title">书仓</div>
                <div class="settings-row-desc">服务端目录即分类，可上传、导入书架</div>
              </div>
            </router-link>
            <router-link class="settings-row link" to="/bookmarks">
              <div class="settings-row-icon">🔖</div>
              <div class="settings-row-main">
                <div class="settings-row-title">书签</div>
                <div class="settings-row-desc">按书查看已保存的阅读位置</div>
              </div>
            </router-link>
            <router-link class="settings-row link" to="/cache">
              <div class="settings-row-icon">⬇️</div>
              <div class="settings-row-main">
                <div class="settings-row-title">缓存管理</div>
                <div class="settings-row-desc">查看与清理已缓存的章节</div>
              </div>
            </router-link>
            <router-link class="settings-row link" to="/replace">
              <div class="settings-row-icon">✏️</div>
              <div class="settings-row-main">
                <div class="settings-row-title">替换规则</div>
                <div class="settings-row-desc">正文清洗与错字替换</div>
              </div>
            </router-link>
          </div>

          <div class="settings-card">
            <div class="settings-card-title">缓存与更新</div>
            <button class="settings-row" :disabled="updateBusy" @click="checkUpdates">
              <div class="settings-row-icon">🔄</div>
              <div class="settings-row-main">
                <div class="settings-row-title">检查更新</div>
                <div class="settings-row-desc">检查书架中连载书的新章节</div>
              </div>
              <span class="settings-row-meta">{{ updateBusy ? '检查中…' : '执行' }}</span>
            </button>
            <button class="settings-row" :disabled="cacheBusy" @click="refreshCache">
              <div class="settings-row-icon">⚡</div>
              <div class="settings-row-main">
                <div class="settings-row-title">刷新缓存</div>
                <div class="settings-row-desc">重新缓存最近阅读的前 5 本</div>
              </div>
              <span class="settings-row-meta">{{ cacheBusy ? '刷新中…' : '执行' }}</span>
            </button>
          </div>

          <p v-if="shelfStatus" class="settings-status">{{ shelfStatus }}</p>
        </template>

        <!-- 数据 -->
        <template v-else-if="section === 'data'">
          <div class="settings-card">
            <div class="settings-card-title">阅读数据</div>
            <router-link class="settings-row link" to="/stats">
              <div class="settings-row-icon">📊</div>
              <div class="settings-row-main">
                <div class="settings-row-title">阅读统计</div>
                <div class="settings-row-desc">阅读时长、章节与趋势</div>
              </div>
            </router-link>
            <router-link class="settings-row link" to="/backup">
              <div class="settings-row-icon">💾</div>
              <div class="settings-row-main">
                <div class="settings-row-title">备份与恢复</div>
                <div class="settings-row-desc">导出书架与书源，或从备份恢复</div>
              </div>
            </router-link>
            <router-link v-if="me.allowWebdav" class="settings-row link" to="/webdav">
              <div class="settings-row-icon">☁️</div>
              <div class="settings-row-main">
                <div class="settings-row-title">WebDAV</div>
                <div class="settings-row-desc">浏览远端目录并做备份</div>
              </div>
            </router-link>
          </div>
        </template>

        <!-- 系统 -->
        <template v-else>
          <div class="settings-card">
            <div class="settings-card-title">运行状态</div>
            <div class="settings-kv"><span>书源</span><b>{{ health?.sources ?? '—' }}</b></div>
            <div class="settings-kv"><span>书籍</span><b>{{ health?.books ?? '—' }}</b></div>
            <div class="settings-kv"><span>运行时长</span><b>{{ uptimeText }}</b></div>
          </div>

          <div class="settings-card">
            <div class="settings-card-title">关于</div>
            <div class="settings-kv"><span>应用</span><b>胖虎阅读</b></div>
            <div class="settings-kv"><span>版本</span><b>{{ appVersion }}</b></div>
            <div class="settings-kv"><span>说明</span><span>自建小说阅读服务 · 阅读 3 书源 · 本地书籍</span></div>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>
