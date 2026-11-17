<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../api.js'

const me = ref({ username: '', role: 'user' })
const users = ref([])
const health = ref(null)
const oldPassword = ref('')
const newPassword = ref('')
const loading = ref(false)

const isAdmin = () => me.value.role === 'admin'

async function load() {
  loading.value = true
  try {
    me.value = (await api.getUserInfo()) || { username: '', role: 'user' }
    health.value = await fetch('/api/health').then((r) => r.json()).catch(() => null)
    if (isAdmin()) users.value = await api.userList()
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
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

const TOOLS = [
  { to: '/stats', label: '阅读统计', icon: '📊' },
  { to: '/cache', label: '缓存管理', icon: '⬇️' },
  { to: '/bookmarks', label: '书签', icon: '🔖' },
  { to: '/replace', label: '替换规则', icon: '✏️' },
  { to: '/warehouse', label: '书仓', icon: '🗄️' },
  { to: '/webdav', label: 'WebDAV', icon: '☁️' },
  { to: '/backup', label: '备份恢复', icon: '💾' },
]

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <h1>设置</h1>
      <span class="badge">{{ me.username || '未登录' }} · {{ me.role === 'admin' ? '管理员' : '普通用户' }}</span>
      <div class="spacer" />
      <button class="ghost" :disabled="loading" @click="load">刷新</button>
    </div>

    <h3 class="section-title">账号</h3>
    <div class="list" style="margin-bottom: 22px">
      <div class="row" style="flex-wrap: wrap; padding: 12px">
        <input v-model="oldPassword" type="password" name="rp-old-pass" autocomplete="new-password" placeholder="原密码" style="max-width: 180px" />
        <input v-model="newPassword" type="password" name="rp-new-pass" autocomplete="new-password" placeholder="新密码（≥6 位）" style="max-width: 180px" />
        <button class="primary" @click="changePassword">修改密码</button>
      </div>
    </div>

    <template v-if="isAdmin()">
      <h3 class="section-title">用户与权限（管理员）</h3>
      <div class="list" style="margin-bottom: 22px">
        <div v-for="user in users" :key="user.username" class="list-item">
          <div style="flex: 1; min-width: 0">
            <strong style="font-size: 14px">{{ user.username }}</strong>
            <span class="badge" :class="{ accent: user.role === 'admin' }" style="margin-left: 6px">
              {{ user.role === 'admin' ? '管理员' : '普通用户' }}
            </span>
            <div class="muted" style="font-size: 12px">
              {{ user.hasPassword ? '已设密码' : '无密码' }}
              <span v-if="user.createdAt"> · {{ new Date(user.createdAt).toLocaleDateString() }}</span>
            </div>
          </div>
          <button class="ghost" @click="toggleRole(user)">{{ user.role === 'admin' ? '降为普通' : '设为管理员' }}</button>
          <button class="ghost" @click="removeUser(user)">删除</button>
        </div>
      </div>

      <h3 class="section-title">系统状态</h3>
      <div class="list" style="margin-bottom: 22px">
        <div class="list-item"><span style="flex: 1">书源</span><span class="badge">{{ health?.sources ?? '—' }}</span></div>
        <div class="list-item"><span style="flex: 1">书籍</span><span class="badge">{{ health?.books ?? '—' }}</span></div>
        <div class="list-item"><span style="flex: 1">运行时长</span><span class="badge">{{ Math.round((health?.uptime || 0) / 60) }} 分钟</span></div>
      </div>
    </template>

    <h3 class="section-title">功能</h3>
    <div class="list">
      <router-link v-for="tool in TOOLS" :key="tool.to" :to="tool.to" class="list-item" style="text-decoration: none; color: inherit">
        <span style="width: 24px">{{ tool.icon }}</span>
        <span style="flex: 1">{{ tool.label }}</span>
        <span class="muted">›</span>
      </router-link>
    </div>

    <p class="muted" style="font-size: 12px; margin-top: 24px; text-align: center">
      胖虎阅读 · 自建小说阅读服务
    </p>
  </div>
</template>
