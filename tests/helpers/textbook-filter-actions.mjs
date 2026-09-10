import assert from "node:assert/strict"

export const openFilter = async (h, label) => {
  const trigger = document.querySelector(`[role="combobox"][aria-label="${label}"]`)
  assert.ok(trigger, label)
  await h.act(() => trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  return [...document.querySelectorAll('[role="option"]')]
}
export const chooseFilter = async (h, label, optionLabel) => {
  const options = await openFilter(h, label)
  const option = options.find(node => node.getAttribute('data-state') !== null && node.textContent.startsWith(optionLabel))
  assert.ok(option, optionLabel)
  await h.act(() => option.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
}
export const closeFilter = async (h) => h.act(() => document.querySelector('[role="listbox"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
