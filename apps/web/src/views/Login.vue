<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api.js'

const router = useRouter()
const mode = ref('login')
const username = ref('')
const password = ref('')
const busy = ref(false)
const authEnabled = ref(false)

async function submit() {
  const name = username.value.trim()
  if (!name || !password.value) {
    window.__toast?.('用户名和密码都要填')
    return
  }
  busy.value = true
  try {
    if (mode.value === 'login') await api.login(name, password.value)
    else await api.register(name, password.value)
    window.__toast?.(mode.value === 'login' ? '登录成功' : '注册成功')
    router.replace('/bookshelf')
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  try {
    const info = await api.getAuthMode()
    authEnabled.value = Boolean(info?.enabled)
    // 已经登录过就直接进书架
    if (authEnabled.value) {
      const me = await api.getUserInfo().catch(() => null)
      if (me?.username) router.replace('/bookshelf')
    }
  } catch {
    /* 忽略 */
  }
})
</script>

<template>
  <div style="min-height: 100vh; display: grid; place-items: center; padding: 24px">
    <div style="width: min(420px, 100%)">
      <h1 style="text-align: center; margin: 0 0 8px">胖虎<span style="color: var(--color-primary)">阅读</span></h1>
      <p class="muted" style="text-align: center; font-size: 13px; margin-bottom: 24px">
        {{ authEnabled ? '这个实例已启用多用户，请登录' : '这个实例未启用多用户，可直接使用' }}
      </p>

      <div class="group-tabs" style="justify-content: center">
        <button class="group-tab" :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</button>
        <button class="group-tab" :class="{ active: mode === 'register' }" @click="mode = 'register'">注册</button>
      </div>

      <div class="field">
        <label>用户名</label>
        <input v-model="username" autocomplete="username" @keyup.enter="submit" />
      </div>
      <div class="field">
        <label>密码（至少 6 位）</label>
        <input v-model="password" type="password" autocomplete="current-password" @keyup.enter="submit" />
      </div>

      <button class="primary" style="width: 100%; margin-top: 8px" :disabled="busy" @click="submit">
        {{ busy ? '处理中…' : mode === 'login' ? '登录' : '注册并登录' }}
      </button>

      <p class="muted" style="font-size: 12px; margin-top: 20px; text-align: center">
        第一个注册的账号会创建用户体系；未注册任何账号时实例保持单用户模式。
      </p>
      <div style="text-align: center; margin-top: 16px">
        <router-link class="ghost" to="/bookshelf" style="font-size: 13px; color: var(--color-primary)">先随便看看 →</router-link>
      </div>
    </div>
  </div>
</template>
