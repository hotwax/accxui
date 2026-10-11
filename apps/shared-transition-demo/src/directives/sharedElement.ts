import type { Directive } from "vue"

export type SharedElementKey = {
  scope: string
  id: string
  part: string
  outlet?: string
}

export type SharedElementBinding = SharedElementKey & {
  priority?: number
}

export type SharedElementRecord = SharedElementBinding & {
  el: HTMLElement
}

const elementRecords = new WeakMap<HTMLElement, SharedElementRecord>()
const registry = new Map<string, Set<SharedElementRecord>>()

export function getSharedElementKey(value: SharedElementKey) {
  return [value.outlet || "main", value.scope, value.id, value.part].join(":")
}

function normalizeBinding(value: SharedElementBinding): SharedElementRecord | undefined {
  if(!value?.scope || !value?.id || !value?.part) {
    return undefined
  }

  return {
    ...value,
    outlet: value.outlet || "main",
    priority: value.priority || 0,
    el: undefined as unknown as HTMLElement
  }
}

function unregister(el: HTMLElement) {
  const previous = elementRecords.get(el)
  if(!previous) {
    return
  }

  const key = getSharedElementKey(previous)
  const records = registry.get(key)
  records?.delete(previous)

  if(records && records.size === 0) {
    registry.delete(key)
  }

  elementRecords.delete(el)
}

function register(el: HTMLElement, value: SharedElementBinding) {
  unregister(el)

  const next = normalizeBinding(value)
  if(!next) {
    return
  }

  next.el = el
  const key = getSharedElementKey(next)
  const records = registry.get(key) || new Set<SharedElementRecord>()

  records.add(next)
  registry.set(key, records)
  elementRecords.set(el, next)
}

export function getSharedElement(value: SharedElementKey) {
  const records = [...(registry.get(getSharedElementKey(value)) || [])]
    .filter((record) => record.el.isConnected && record.el.offsetParent !== null)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))

  return records[0]?.el
}

export const sharedElementDirective: Directive<HTMLElement, SharedElementBinding> = {
  mounted(el, binding) {
    register(el, binding.value)
  },
  updated(el, binding) {
    register(el, binding.value)
  },
  unmounted(el) {
    unregister(el)
  }
}
