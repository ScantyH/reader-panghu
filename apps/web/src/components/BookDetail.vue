<script setup>
import { computed, ref, watch } from 'vue'
import { api, coverOf } from '../api.js'

const props = defineProps({
  book: { type: Object, required: true },
  groups: { type: Array, default: () => [] },
  mode: { type: String, default: 'shelf' }, // 'shelf' | 'search'
})
const emit = defineEmits(['close', 'save'])

const draft = ref({ ...props.book })
const coverInput = ref(null)
const busy = ref(false)
const coverFailed = ref(false)

const coverUrl = computed(() => coverOf(draft.value))

async function pickCover(event) {
  const file = event.target.files?.[0]
  if (!file || props.mode !== 'shelf') return
  busy.value = true
  try {
    const saved = await api.uploadCover(draft.value.bookUrl, file)
    draft.value = { ...draft.value, ...saved }
    window.__toast?.('封面已更新')
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    busy.value = false
    event.target.value = ''
  }
}

function submit() {
  emit('save', { ...draft.value })
}
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('close')">
    <div class="dialog">
      <div class="page-head" style="margin-bottom: 16px">
        <h1 style="font-size: 16px">{{ mode === 'shelf' ? '书籍信息' : '加入书架' }}</h1>
        <div class="spacer" />
        <button class="ghost" @click="emit('close')">关闭</button>
      </div>

      <div class="row" style="align-items: flex-start; gap: 16px; margin-bottom: 16px">
        <div class="cover" style="width: 108px; flex: none">
          <img v-if="coverUrl && !coverFailed" :src="coverUrl" :alt="draft.name" @error="coverFailed = true" />
          <div v-else class="placeholder">无封面</div>
        </div>
        <div style="flex: 1">
          <div class="field">
            <label>书名</label>
            <input v-model="draft.name" />
          </div>
          <div class="field">
            <label>作者</label>
            <input v-model="draft.author" />
          </div>
        </div>
      </div>

      <div class="field">
        <label>分类</label>
        <input v-model="draft.kind" />
      </div>

      <div v-if="mode === 'shelf'" class="field">
        <label>分组</label>
        <select v-model.number="draft.group" style="width: 100%; background: var(--bg-soft); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px">
          <option v-for="group in groups" :key="group.groupId" :value="group.groupId">{{ group.groupName }}</option>
        </select>
      </div>

      <div class="field">
        <label>简介</label>
        <textarea v-model="draft.intro" rows="5" />
      </div>

      <div v-if="mode === 'shelf'" class="row" style="margin-bottom: 8px">
        <input ref="coverInput" type="file" accept="image/*" hidden @change="pickCover" />
        <button :disabled="busy" @click="coverInput.click()">更换封面</button>
        <span class="muted" style="font-size: 12.5px">支持 jpg / png / webp</span>
      </div>

      <div class="row" style="justify-content: flex-end; margin-top: 18px">
        <button class="ghost" @click="emit('close')">取消</button>
        <button class="primary" @click="submit">{{ mode === 'shelf' ? '保存' : '加入书架' }}</button>
      </div>
    </div>
  </div>
</template>
