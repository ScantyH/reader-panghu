<script setup>
import { computed } from 'vue'

const props = defineProps({
  title: { type: String, required: true },
  items: { type: Array, default: () => [] },
  centerValue: { type: String, default: '' },
  centerLabel: { type: String, default: '合计' },
  totalLabel: { type: String, default: '' },
})

const radius = 64
const stroke = 26
const circumference = 2 * Math.PI * radius

const total = computed(() => props.items.reduce((sum, item) => sum + (Number(item.value) || 0), 0))

const slices = computed(() => {
  let offset = 0
  return props.items
    .filter((item) => Number(item.value) > 0)
    .map((item) => {
      const length = (Number(item.value) / total.value) * circumference
      const slice = { ...item, length, offset }
      offset += length
      return slice
    })
})

const percentOf = (value) => (total.value ? Math.round((Number(value) / total.value) * 1000) / 10 : 0)
</script>

<template>
  <div class="pie-card">
    <div class="pie-card-head">
      <h3>{{ title }}</h3>
      <span v-if="total" class="muted">{{ totalLabel }}</span>
    </div>

    <div v-if="!total" class="pie-empty">暂无数据</div>
    <div v-else class="pie-body">
      <svg class="pie-svg" viewBox="0 0 180 180" role="img" :aria-label="title">
        <circle cx="90" cy="90" :r="radius" fill="none" stroke="var(--color-bg-sunken)" :stroke-width="stroke" />
        <circle
          v-for="slice in slices"
          :key="slice.label"
          cx="90"
          cy="90"
          :r="radius"
          fill="none"
          :stroke="slice.color"
          :stroke-width="stroke"
          :stroke-dasharray="`${slice.length} ${circumference - slice.length}`"
          :stroke-dashoffset="slice.offset * -1"
          transform="rotate(-90 90 90)"
        />
        <text x="90" y="86" text-anchor="middle" class="pie-total">{{ centerValue || total }}</text>
        <text x="90" y="106" text-anchor="middle" class="pie-sub">{{ centerLabel }}</text>
      </svg>

      <ul class="pie-legend">
        <li v-for="item in items" :key="item.label">
          <i :style="{ background: item.color }" />
          <span class="pie-label">{{ item.label }}</span>
          <span class="pie-value">{{ item.display ?? item.value }}</span>
          <span class="pie-pct">{{ percentOf(item.value) }}%</span>
        </li>
      </ul>
    </div>
  </div>
</template>
