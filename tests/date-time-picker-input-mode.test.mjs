import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';

test('default and combined time controls remain choice-only while exact entry requires opt-in', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1/', pretendToBeVisual: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  for (const key of ['HTMLElement', 'Element', 'MutationObserver', 'CustomEvent', 'Event', 'Node', 'NodeFilter', 'DocumentFragment', 'HTMLInputElement', 'KeyboardEvent']) globalThis[key] = dom.window[key];
  globalThis.getComputedStyle = window.getComputedStyle;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const { TimePickerControl, DateTimePickerControl } = loadNotificationComponent('src/components/ui/date-time-picker.tsx');
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close(); });
  const changes = [];
  await React.act(async () => root.render(React.createElement(TimePickerControl, {
    value: '', onChange: value => changes.push(value), ariaLabel: '보강 시작시각',
  })));
  assert.equal(document.querySelectorAll('input').length, 0, 'default control has no free-text input');
  const trigger = document.querySelector('button[aria-haspopup="dialog"]');
  assert.ok(trigger);
  await React.act(async () => trigger.click());
  const choices = [...document.querySelectorAll('[role="option"]')];
  assert.equal(choices.length, 88);
  assert.equal(choices[0].textContent, '오전 09:00');
  assert.equal(choices.at(-1).textContent, '오후 11:30');
  assert.equal(document.querySelectorAll('input').length, 0, 'opening choices must not expose exact-entry input');
  assert.ok(choices.every(choice => !/오전 06:00|24:00/.test(choice.textContent)));
  await React.act(async () => choices.find(choice => choice.textContent === '오후 05:10').click());
  assert.deepEqual(changes, ['17:10']);

  await React.act(async () => root.render(React.createElement(DateTimePickerControl, {
    value: '2026-10-20T17:13', onChange() {},
  })));
  assert.equal(document.querySelectorAll('input').length, 0, 'combined datetime consumer remains choice-only');
  assert.match(document.body.textContent, /05:13/);

  await React.act(async () => root.render(React.createElement(TimePickerControl, {
    value: '24:00', onChange() {}, ariaLabel: '수업 종료시각',
    allowDirectInput: true, allowEndOfDay: true,
  })));
  const exactInput = document.querySelector('input[aria-label="수업 종료시각"]');
  assert.ok(exactInput, 'class-form opt-in exposes the editable exact time');
  assert.equal(exactInput.value, '24:00');
  assert.equal(exactInput.disabled, false);
  await React.act(async () => root.render(React.createElement(TimePickerControl, {
    value: '17:13', onChange() {}, ariaLabel: '수업 시작시각', allowDirectInput: true,
  })));
  assert.equal(document.querySelector('input[aria-label="수업 시작시각"]').value, '17:13');
});
