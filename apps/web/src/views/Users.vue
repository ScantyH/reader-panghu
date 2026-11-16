<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../api.js'

const users = ref([])
const oldPassword = ref('')
const newPassword = ref('')
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    users.value = await api.userList()
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

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <h1>用户管理</h1>
      <span class="badge">{{ users.length }} 个账号</span>
      <div class="spacer" />
      <button class="ghost" @click="load">刷新</button>
    </div>

    <div v-if="loading" class="muted">加载中…</div>
    <div v-else class="list" style="margin-bottom: 24px">
      <div v-for="user in users" :key="user.username" class="list-item">
        <div style="flex: 1">
          <strong style="font-size: 14px">{{ user.username }}</strong>
          <div class="muted" style="font-size: 12px">
            {{ user.hasPassword ? '已设置密码' : '无密码（单用户）' }}
            <span v-if="user.createdAt"> · {{ new Date(user.createdAt).toLocaleDateString() }}</span>
          </div>
        </div>
      </div>
    </div>

    <h3 style="font-size: 14px; margin: 0 0 10px">修改我的密码</h3>
    <div class="row" style="flex-wrap: wrap">
      <input v-model="oldPassword" type="password" placeholder="原密码（首次设置可留空）" style="max-width: 220px" />
      <input v-model="newPassword" type="password" placeholder="新密码（至少 6 位）" style="max-width: 220px" />
      <button class="primary" @click="changePassword">保存</button>
    </div>

    <p class="muted" style="font-size: 12px; margin-top: 16px">
      第一个设置密码的账号会让实例切换到多用户模式；之后每个账号的书架、书源、配置互相隔离。
    </p>
  </div>
</template>
