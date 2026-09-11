import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { setup } from './helpers/textbook-numbered-harness.mjs';

test('shared row actions retain native disabled behavior and execute only the chosen menu action', async t => {
  const h = await setup(t);
  const { DataTableRowActions } = h.load('src/components/data-table/data-table-row-actions.tsx');
  const { DropdownMenuItem } = h.load('src/components/ui/dropdown-menu.tsx');
  const { Button } = h.load('src/components/ui/button.tsx');
  let count = 0;
  const active = await h.mountTestComponent(DataTableRowActions, { label: '검수 행 더보기', children: createElement(DropdownMenuItem, {onSelect:()=>count++}, '검수 동작') });
  const disabled = await h.mountTestComponent(Button, { disabled:true, variant:'destructive-outline', onClick:()=>count++, children:'실행 불가' });
  await h.act(()=>disabled.node.querySelector('button').click());
  assert.equal(count,0);
  assert.equal(disabled.node.querySelector('button').dataset.variant,'destructive-outline');
  await h.act(()=>active.node.querySelector('button').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  assert.equal(count,0,'opening the menu does not execute a domain action');
  assert.ok(document.querySelector('[role="menu"]'));
  await h.act(()=>document.querySelector('[role="menuitem"]').click());
  assert.equal(count,1);
  assert.equal(document.querySelector('[role="menu"]'),null);
});
