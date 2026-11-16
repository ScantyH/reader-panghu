<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../api.js'

const rules = ref([])
const loading = ref(false)
const draft = ref({ name: '', pattern: '', replacement: '', isRegex: true })

async function load() {
  loading.value = true
  try {
    rules.value = await api.replaceRules()
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

async function save() {
  const rule = { ...draft.value }
  if (!rule.name.trim() || !rule.pattern.trim()) {
    window.__toast?.('名称和匹配内容都要填')
    return
  }
  try {
    await api.saveReplaceRule(rule)
    draft.value = { name: '', pattern: '', replacement: '', isRegex: true }
    await load()
    window.__toast?.('规则已保存')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function remove(rule) {
  if (!confirm(`删除规则「${rule.name}」？`)) return
  try {
    await api.deleteReplaceRule(rule.name)
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <h1>替换规则</h1>
      <span class="badge">{{ rules.length }} 条</span>
      <div class="spacer" />
      <button class="ghost" @click="load">刷新</button>
    </div>

    <p class="muted" style="font-size: 13px; margin-top: -6px">
      规则在返回正文时生效：默认按正则替换，取消勾选后按纯文本替换。可用于去掉广告、错字、水印等。
    </p>

    <div class="list" style="margin-bottom: 24px">
      <div class="row" style="flex-wrap: wrap">
        <input v-model="draft.name" placeholder="规则名（唯一）" style="max-width: 160px" />
        <input v-model="draft.pattern" placeholder="匹配内容（正则或纯文本）" style="flex: 1; min-width: 200px" />
        <input v-model="draft.replacement" placeholder="替换为（可空）" style="max-width: 180px" />
        <label class="row" style="gap: 6px; font-size: 13px">
          <input v-model="draft.isRegex" type="checkbox" style="width: auto" /> 正则
        </label>
        <button class="primary" @click="save">添加</button>
      </div>
    </div>

    <div v-if="loading" class="muted">加载中…</div>
    <div v-else-if="!rules.length" class="empty">还没有替换规则。</div>
    <div v-else class="list">
      <div v-for="rule in rules" :key="rule.name" class="list-item">
        <div style="flex: 1; min-width: 0">
          <strong style="font-size: 14px">{{ rule.name }}</strong>
          <div class="muted" style="font-size: 12px; word-break: break-all">
            /{{ rule.pattern }}/ → {{ rule.replacement || '(空)' }}
            <span class="badge" style="margin-left: 6px">{{ rule.isRegex === false ? '纯文本' : '正则' }}</span>
          </div>
        </div>
        <button class="ghost" @click="remove(rule)">删除</button>
      </div>
    </div>
  </div>
</template>
