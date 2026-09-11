import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, useState } from 'react'
import { setup, button } from './helpers/textbook-numbered-harness.mjs'

const group = {
  id: 'supplier-one', title: '검수 교육 공급처', subtitle: '본관 · 별관', summary: ['2종', '5권', '45,000원'], totalQuantity: 5,
  message: '수납명: 교재비\n금액: 45,000원\n대상: 합성 원생',
  lines: ['중학 영문법과 독해를 함께 공부하는 긴 교재명', '개념 수학 2'].map((title, i) => ({
    id: `line-${i}`, title, detail: '합성 원생', note: '학생용 · 교사용', quantityLabel: i ? '2권' : '3권', amountLabel: i ? '18,000원' : '27,000원', unitCostLabel: '9,000원',
    locationQuantities: [{ locationLabel: '본관', studentQuantityLabel: i ? '2권' : '3권', teacherQuantityLabel: '0권' }],
  })),
}
async function mountDialog(t, {format = 'purchase-order', groups = [group], loadState = '', onRetry} = {}) {
  const captures = [], downloads = [], revoked = []
  const capture = (element, options) => new Promise((resolve, reject) => captures.push({ element, options, resolve, reject }))
  const h = await setup(t, { overrides: { '@/lib/export-as-image': {
    captureElementAsPngBlob: capture, captureElementAsPdfBlob: capture,
    downloadBlob: (blob, filename) => downloads.push({ blob, filename }),
  } } })
  await h.unmount()
  const Dialog = h.load('src/features/textbooks/textbook-operations-workspace.tsx').__testOnlyHandoffDialog
  const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL
  URL.createObjectURL = () => `blob:test-${downloads.length}`
  URL.revokeObjectURL = value => revoked.push(value)
  t.after(() => { URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke })
  function Wrapper() {
    const [open, setOpen] = useState(true)
    return createElement('div', null, createElement('button', {onClick: () => setOpen(true)}, '문서 다시 열기'), createElement(Dialog, {
      open, onOpenChange: setOpen, title: '검수 문서', description: '합성 자료', groups, emptyLabel: '문서 없음', idPrefix: 'qa-doc', sourceLineCount: 2, format, loadState, onRetry,
    }))
  }
  await h.mountTestComponent(Wrapper, {})
  const selectExport = async (label, kind) => {
    await h.act(() => button(label).dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true})))
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(e => e.textContent === kind)
    assert.ok(item)
    await h.act(() => { item.click(); item.click() })
  }
  return { ...h, captures, downloads, revoked, selectExport }
}

test('document exports isolate capture sizing, retain all line data, exclude controls and block concurrent exports', async t => {
  const h = await mountDialog(t)
  const body = document.querySelector('[data-slot="document-dialog-body"]')
  const live = body.querySelector('[data-handoff-capture-target]')
  Object.defineProperty(live, 'scrollWidth', {value:300})
  const table = live.querySelector('table')
  Object.defineProperty(table, 'scrollWidth', {value:1000})
  Object.defineProperty(table.parentElement, 'clientWidth', {value:200})
  const before = live.outerHTML
  await h.selectExport('전체 문서 저장 메뉴', 'PDF 저장')
  assert.equal(h.captures.length, 1)
  assert.equal(button('전체 문서 저장 메뉴').disabled, true)
  const capture = h.captures[0]
  assert.notEqual(capture.element, live)
  assert.equal(capture.element.querySelectorAll('[data-handoff-toolbar]').length, 0)
  assert.equal(capture.element.querySelectorAll('button').length, 0)
  for (const line of group.lines) assert.ok(capture.element.textContent.includes(line.title))
  assert.ok(capture.element.textContent.includes('27,000원'))
  assert.equal(capture.options.width, 1100, 'export includes columns hidden by the mobile table scroller')
  capture.element.style.width = '900px'
  assert.equal(live.style.width, '')
  assert.equal(live.querySelector('[data-handoff-card]').outerHTML, new window.DOMParser().parseFromString(before, 'text/html').querySelector('[data-handoff-card]').outerHTML)
  await h.act(() => capture.resolve(new Blob(['pdf'], {type:'application/pdf'})))
  assert.equal(capture.element.isConnected, false)
  assert.equal(h.downloads.length, 1)
  assert.equal(h.downloads[0].filename, '검수 문서.pdf')
  assert.equal(document.querySelector('[data-slot="document-dialog-body"]') === body, true)
  assert.equal(button('전체 문서 저장 메뉴').disabled, false)
  assert.equal(document.querySelector('a[download]').download, '검수 문서.pdf')
  await h.act(() => button('닫기').click())
  assert.ok(h.revoked.includes('blob:test-1'))
})

test('failed document generation can retry, and closing cancels late file delivery', async t => {
  const h = await mountDialog(t)
  await h.selectExport('검수 교육 공급처 문서 저장 메뉴', '이미지 저장')
  await h.act(() => h.captures[0].reject(new Error('internal-secret-path')))
  assert.equal(document.body.textContent.includes('internal-secret-path'), false)
  assert.ok(document.body.textContent.includes('저장 메뉴에서 다시 시도하세요'))
  assert.equal(h.captures[0].element.isConnected, false)
  await h.selectExport('검수 교육 공급처 문서 저장 메뉴', '이미지 저장')
  assert.equal(h.captures[1].element.querySelectorAll('[data-handoff-card]').length, 0, 'individual export root is itself the card')
  await h.act(() => button('닫기').click())
  await h.act(() => h.captures[1].resolve(new Blob(['png'])))
  assert.equal(h.downloads.length, 0)
  assert.equal(h.captures[1].element.isConnected, false)
  await h.act(() => button('문서 다시 열기').click())
  assert.equal(document.body.textContent.includes('다시 시도하세요'), false)
  assert.equal(document.querySelector('a[download]'), null)
  assert.equal(button('전체 문서 저장 메뉴').disabled, false)
})

test('billing copy fallback preserves full text, focuses selection, and clears on reopen', async t => {
  const h = await mountDialog(t, {format:'default'})
  navigator.clipboard.writeText = async () => { throw new Error('blocked') }
  document.execCommand = () => false
  await h.act(() => button('전체 복사').click())
  await h.act(() => new Promise(resolve => window.setTimeout(resolve, 10)))
  const textarea = document.querySelector('[aria-label="복사할 청구 메시지"]')
  assert.equal(textarea.value, group.message)
  assert.equal(document.activeElement === textarea, true)
  assert.equal(textarea.selectionEnd, group.message.length)
  await h.act(() => button('닫기').click())
  await h.act(() => button('문서 다시 열기').click())
  assert.equal(document.querySelector('[aria-label="복사할 청구 메시지"]'), null)
  assert.equal(h.downloads.length, 0)
})

test('empty document retains toolbar and close action while exports are unavailable', async t => {
  const h = await mountDialog(t, {groups:[]})
  assert.equal(button('전체 문서 저장 메뉴').disabled, true)
  assert.ok(document.body.textContent.includes('문서 없음'))
  assert.equal(button('닫기').disabled, false)
  assert.equal(h.captures.length, 0)
})


test('failed document read shows its retry state without claiming empty data', async t => {
  let retries = 0
  await mountDialog(t, {groups:[], loadState:'문서를 불러오지 못했습니다.', onRetry:()=>{retries++}})
  assert.equal(document.body.textContent.includes('문서 없음'), false)
  assert.ok(document.body.textContent.includes('문서를 불러오지 못했습니다.'))
  button('다시 불러오기').click()
  assert.equal(retries, 1)
})
