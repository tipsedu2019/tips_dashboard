import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';
import { clickTab, pressTabKey } from './helpers/tab-interactions.mjs';

async function setup(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid' });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  for (const key of ['HTMLElement', 'Element', 'MutationObserver', 'CustomEvent', 'Event', 'Node', 'HTMLInputElement']) globalThis[key] = dom.window[key];
  globalThis.getComputedStyle = window.getComputedStyle;
  globalThis.requestAnimationFrame = window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame = window.clearTimeout;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const { WorkspaceTabs, WorkspaceTabsList, WorkspaceTabsTrigger, WorkspaceTabsPanel } = loadNotificationComponent('src/components/ui/workspace-tabs.tsx');
  const changes = [], root = createRoot(document.getElementById('root'));
  let mounts = 0, unmounts = 0, accept;
  const h = React.createElement;
  function Draft() {
    React.useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
    return h('input', { 'aria-label': '보존할 메모', defaultValue: '작성 중' });
  }
  function Probe() {
    const [value, setValue] = React.useState('pending');
    React.useEffect(() => { accept = setValue; }, []);
    return h(WorkspaceTabs, { value, onValueChange: (next) => changes.push(next) },
      h(WorkspaceTabsList, { 'aria-label': '업무 흐름' },
        h(WorkspaceTabsTrigger, { value: 'pending' }, '대기'),
        h(WorkspaceTabsTrigger, { value: 'disabled', disabled: true }, '사용 불가'),
        h(WorkspaceTabsTrigger, { value: 'closed' }, '완료'),
        h(WorkspaceTabsTrigger, { value: 'mine' }, '내 신청')),
      h(WorkspaceTabsPanel, null, h(Draft)));
  }
  await React.act(async () => root.render(h(Probe)));
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close(); });
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  return { tabs, changes, accept: (value) => React.act(async () => accept(value)), get mounts() { return mounts; }, get unmounts() { return unmounts; } };
}

test('manual tabs move focus with arrows, Home and End without selecting, and skip disabled tabs', async (t) => {
  const p = await setup(t), [pending, disabled, closed, mine] = p.tabs;
  await React.act(async () => pending.focus());
  await React.act(async () => pressTabKey(pending, 'ArrowRight'));
  assert.equal(document.activeElement, closed);
  assert.equal(pending.getAttribute('aria-selected'), 'true');
  assert.deepEqual(p.changes, []);
  assert.equal(disabled.disabled, true);
  await React.act(async () => pressTabKey(closed, 'End'));
  assert.equal(document.activeElement, mine);
  await React.act(async () => pressTabKey(mine, 'Home'));
  assert.equal(document.activeElement, pending);
  await React.act(async () => pressTabKey(pending, 'ArrowLeft'));
  assert.equal(document.activeElement, mine);
  assert.deepEqual(p.changes, [], 'focus movement never asks a remote workspace to navigate');
  await React.act(async () => pressTabKey(mine, 'Enter'));
  assert.deepEqual(p.changes, ['mine']);
  assert.equal(pending.getAttribute('aria-selected'), 'true', 'pending or failed requests retain accepted selection');
  await p.accept('mine');
  assert.equal(mine.getAttribute('aria-selected'), 'true');
  await React.act(async () => pressTabKey(mine, 'ArrowLeft'));
  await React.act(async () => pressTabKey(closed, ' '));
  assert.deepEqual(p.changes, ['mine', 'closed']);
});

test('all triggers control one stable labelled panel, preserving child DOM and draft across accepted views', async (t) => {
  const p = await setup(t), [pending, , closed] = p.tabs;
  const panel = document.querySelector('[role="tabpanel"]'), draft = panel.querySelector('input');
  const initialId = panel.id;
  assert.ok(initialId);
  for (const tab of p.tabs) assert.equal(tab.getAttribute('aria-controls'), initialId);
  assert.equal(panel.getAttribute('aria-labelledby'), pending.id);
  draft.value = '저장되지 않은 메모';
  await React.act(async () => clickTab(closed));
  assert.deepEqual(p.changes, ['closed']);
  assert.equal(document.activeElement, closed);
  assert.equal(document.querySelector('[role="tabpanel"]'), panel);
  assert.equal(panel.getAttribute('aria-labelledby'), pending.id);
  await p.accept('closed');
  assert.equal(document.querySelectorAll('[role="tabpanel"]').length, 1);
  assert.equal(document.querySelector('[role="tabpanel"]'), panel);
  assert.equal(panel.querySelector('input'), draft);
  assert.equal(draft.value, '저장되지 않은 메모');
  assert.equal(panel.getAttribute('aria-labelledby'), closed.id);
  assert.equal(panel.hidden, false);
  assert.equal(p.mounts, 1);
  assert.equal(p.unmounts, 0);
});
