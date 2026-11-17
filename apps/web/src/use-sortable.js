import { onBeforeUnmount, ref } from 'vue'

/**
 * 长按拖动排序（鼠标 / 触屏通用）。
 *
 * - getIds(): 当前顺序的 id 数组
 * - move(from, to): 调用方就地调整本地数组
 * - onCommit(): 拖拽结束后保存
 *
 * 用法：拖拽手柄 @pointerdown="start($event, id)"，行元素 data-sort-id="id"。
 */
export function useSortable({ getIds, move, onCommit, delay = 240 }) {
  const draggingId = ref('')
  const activeId = ref('')
  let timer = 0
  let armed = false
  let startX = 0
  let startY = 0

  const detach = () => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', finish)
  }

  const finish = async () => {
    clearTimeout(timer)
    const id = draggingId.value
    const wasDragging = armed
    armed = false
    draggingId.value = ''
    activeId.value = ''
    detach()
    if (wasDragging && id) await onCommit?.()
  }

  const onPointerMove = (event) => {
    if (!armed) return
    if (Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY) < 3) return
    const element = document.elementFromPoint(event.clientX, event.clientY)
    const row = element?.closest?.('[data-sort-id]')
    const targetId = row?.getAttribute('data-sort-id')
    if (!targetId) return
    const ids = getIds()
    const from = ids.indexOf(draggingId.value)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0 || from === to) return
    move(from, to)
  }

  const start = (event, id) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    clearTimeout(timer)
    activeId.value = id
    startX = event.clientX
    startY = event.clientY
    timer = setTimeout(() => {
      armed = true
      draggingId.value = id
      window.addEventListener('pointermove', onPointerMove, { passive: true })
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
    }, delay)
  }

  /** 手柄上松开但还没进入拖动时，取消长按计时 */
  const cancel = () => {
    clearTimeout(timer)
    if (!armed) activeId.value = ''
  }

  onBeforeUnmount(() => {
    clearTimeout(timer)
    detach()
  })

  return { start, cancel, draggingId, activeId }
}
