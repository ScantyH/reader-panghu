<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  min: { type: Number, default: -Infinity },
  max: { type: Number, default: Infinity },
  step: { type: Number, default: 1 },
  precision: { type: Number, default: 0 },
  unit: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const minAttr = computed(() => (Number.isFinite(props.min) ? props.min : undefined))
const maxAttr = computed(() => (Number.isFinite(props.max) ? props.max : undefined))

function format(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  return props.precision > 0 ? n.toFixed(props.precision) : String(Math.round(n))
}

const draft = ref(format(props.modelValue))
watch(
  () => props.modelValue,
  (value) => {
    draft.value = format(value)
  },
)

function emitValue(value) {
  if (value === '' || value === null || value === undefined || String(value).trim() === '') {
    draft.value = format(props.modelValue)
    return
  }
  const n = Number(value)
  if (!Number.isFinite(n)) {
    draft.value = format(props.modelValue)
    return
  }
  const next = Number(Math.min(props.max, Math.max(props.min, n)).toFixed(props.precision))
  emit('update:modelValue', next)
  draft.value = format(next)
}

function nudge(direction) {
  emitValue(Number(props.modelValue || 0) + direction * props.step)
}
</script>

<template>
  <div class="number-stepper">
    <button
      type="button"
      class="stepper-btn"
      :disabled="Number.isFinite(min) && modelValue <= min"
      aria-label="减少"
      @click.prevent="nudge(-1)"
    >
      −
    </button>
    <input
      v-model="draft"
      class="stepper-input"
      type="number"
      :min="minAttr"
      :max="maxAttr"
      :step="step"
      @change="emitValue(draft)"
      @blur="emitValue(draft)"
      @keydown.enter.prevent="emitValue(draft)"
    />
    <span v-if="unit" class="stepper-unit">{{ unit }}</span>
    <button
      type="button"
      class="stepper-btn"
      :disabled="Number.isFinite(max) && modelValue >= max"
      aria-label="增加"
      @click.prevent="nudge(1)"
    >
      ＋
    </button>
  </div>
</template>

<style scoped>
.number-stepper {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex: none;
}

.stepper-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid rgba(127, 127, 127, 0.28);
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.07);
  color: inherit;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.stepper-btn:hover:not(:disabled) {
  background: rgba(127, 127, 127, 0.16);
}

.stepper-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.stepper-input {
  width: 66px;
  height: 28px;
  box-sizing: border-box;
  padding: 0 4px;
  border: 1px solid rgba(127, 127, 127, 0.28);
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.06);
  color: inherit;
  text-align: center;
  font: inherit;
  font-size: 13px;
  appearance: textfield;
  -moz-appearance: textfield;
}

.stepper-input::-webkit-outer-spin-button,
.stepper-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.stepper-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 18%, transparent);
}

.stepper-unit {
  min-width: 16px;
  font-size: 11.5px;
  opacity: 0.6;
}
</style>
