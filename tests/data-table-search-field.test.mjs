import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { setup } from './helpers/textbook-numbered-harness.mjs';

async function searchProbe(t) {
  const h = await setup(t);
  await h.unmount();
  const { DataTableSearchField } = h.load('src/components/data-table/data-table-search-field.tsx');
  const changes = [];
  const escaped = [];
  function Probe() {
    const [value, setValue] = React.useState('한글 검색');
    return React.createElement('div', { onKeyDown: event => escaped.push(event.key) },
      React.createElement(DataTableSearchField, { label: '검색', value,
        onValueChange: next => { changes.push(next); setValue(next); } }));
  }
  await h.mountTestComponent(Probe, {});
  const input = document.querySelector('input[aria-label="검색"]');
  input.focus();
  return { h, input, changes, escaped };
}

test('search keeps Korean composition and does not issue a cleared search on IME Escape', async t => {
  const { h, input, changes } = await searchProbe(t);
  await h.act(() => input.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Escape', isComposing: true, bubbles: true, cancelable: true,
  })));
  assert.equal(input.value, '한글 검색');
  assert.deepEqual(changes, []);
  await h.act(() => input.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Escape', keyCode: 229, bubbles: true, cancelable: true,
  })));
  assert.equal(input.value, '한글 검색', 'legacy IME composing key is also preserved');
  assert.deepEqual(changes, []);
});

test('Escape clears once without bubbling into the parent workflow and keeps input focus', async t => {
  const { h, input, changes, escaped } = await searchProbe(t);
  await h.act(() => input.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  })));
  assert.equal(input.value, '');
  assert.deepEqual(changes, ['']);
  assert.deepEqual(escaped, []);
  assert.equal(document.activeElement, input);
  await h.act(() => input.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  })));
  assert.deepEqual(changes, [''], 'empty search is not submitted again');
  assert.deepEqual(escaped, ['Escape'], 'unhandled Escape remains available to the parent');
});
