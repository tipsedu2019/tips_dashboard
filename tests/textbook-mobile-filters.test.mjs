import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers/textbook-numbered-harness.mjs";
// Isolate nested Radix modal/select focus scopes in a fresh DOM process.

test('mobile inventory classification drafts cancel, apply once at page one and reopen from applied values', async (t) => {
  const h = await setup(t, { search: '?textbookTab=master&textbookPage=2' })
  const reads = () => h.requests.filter(r => r.name === 'list_textbook_master_page_v1')
  const initial = reads().length
  const trigger = () => document.querySelector('[aria-label^="교재 분류 필터 "]')
  const chooseDraft = async (label, value) => {
    const control = document.querySelector(`[role="dialog"] [aria-label="${label}"]`)
    await h.act(() => control.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    const option = [...document.querySelectorAll('[role="option"]')].find(node => node.textContent === value)
    assert.ok(option, value)
    await h.act(() => option.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  }
  await h.act(() => trigger().click())
  await chooseDraft('교재 과목 필터', '영어')
  await chooseDraft('교재 학년 필터', '고1')
  assert.equal(reads().length, initial, 'draft selection never queries')
  await h.act(() => document.querySelector('[role="dialog"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(reads().length, initial)
  assert.equal(trigger().textContent, '필터 0')
  assert.equal(document.activeElement, trigger())
  await h.act(() => trigger().click())
  assert.equal(document.querySelector('[role="dialog"] [aria-label="교재 과목 필터"]').textContent, '전체 과목')
  await chooseDraft('교재 과목 필터', '영어')
  await chooseDraft('교재 학년 필터', '고1')
  await h.act(() => document.querySelector('[role="dialog"] form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
  assert.equal(reads().length, initial + 1, 'four fields apply as one page request')
  assert.equal(reads().at(-1).args.p_page, 1)
  assert.equal(reads().at(-1).args.p_filters.subject, 'english')
  assert.equal(reads().at(-1).args.p_filters.gradeLevel, 'h1')
  assert.equal(trigger().textContent, '필터 2')
  assert.equal(document.querySelector('[aria-label="적용된 교재 분류 필터"]').textContent, '영어 · 고1')
  await h.act(() => trigger().click())
  assert.equal(document.querySelector('[role="dialog"] [aria-label="교재 과목 필터"]').textContent, '영어')
  assert.equal(document.querySelector('[role="dialog"] [aria-label="교재 학년 필터"]').textContent, '고1')
  const cancel = [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === '취소')
  await h.act(() => cancel.click())
  assert.equal(reads().length, initial + 1)
  assert.equal(trigger().textContent, '필터 2')
  await h.assertNoLegacyReads()
})
