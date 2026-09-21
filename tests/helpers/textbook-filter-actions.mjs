import assert from "node:assert/strict"
import { waitForFocus } from "./dom-focus.mjs"

export const openFilter = async (h, label) => {
  const trigger = document.querySelector(`[role="combobox"][aria-label="${label}"]`)
  assert.ok(trigger, label)
  await h.act(() => trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  return [...document.querySelectorAll('[role="option"]')]
}
export const chooseFilter = async (h, label, optionLabel) => {
  const trigger = document.querySelector(`[role="combobox"][aria-label="${label}"]`)
  const options = await openFilter(h, label)
  const option = options.find(node => node.getAttribute('data-state') !== null && node.textContent.startsWith(optionLabel))
  assert.ok(option, optionLabel)
  await h.act(() => option.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await waitForFocus(h, trigger)
}
export const closeFilter = async (h) => {
  const listbox = document.querySelector('[role="listbox"]')
  assert.ok(listbox, 'filter must be open before closing')
  const trigger = [...document.querySelectorAll('[role="combobox"]')]
    .find(node => node.getAttribute('aria-controls') === listbox.id)
  await h.act(() => listbox.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await waitForFocus(h, trigger)
}
