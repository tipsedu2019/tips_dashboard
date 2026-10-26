import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { setup } from './helpers/textbook-numbered-harness.mjs';

async function searchProbe(t, fieldProps = {}) {
  const h = await setup(t);
  await h.unmount();
  const { DataTableSearchField } = h.load('src/components/data-table/data-table-search-field.tsx');
  const changes = [];
  const changeCalls = [];
  const escaped = [];
  const inputRef = React.createRef();
  function Probe() {
    const [value, setValue] = React.useState('한글 검색');
    return React.createElement('div', { onKeyDown: event => escaped.push(event.key) },
      React.createElement(DataTableSearchField, { ...fieldProps, ref: inputRef, label: '검색', value,
        // Keep a one-argument consumer while observing optional metadata for assertions.
        onValueChange: function (next) {
          changeCalls.push(Array.from(arguments));
          changes.push(next);
          setValue(next);
        } }));
  }
  await h.mountTestComponent(Probe, {});
  const input = document.querySelector('input[aria-label="검색"]');
  input.focus();
  return { h, input, inputRef, changes, changeCalls, escaped };
}

function inputHandlers(input) {
  const key = Object.keys(input).find(key => key.startsWith('__reactProps'));
  assert.ok(key, 'the real rendered search input exposes its React handlers');
  return input[key];
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
  const { h, input, inputRef, changes, changeCalls, escaped } = await searchProbe(t);
  await h.act(() => input.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  })));
  assert.equal(input.value, '');
  assert.deepEqual(changes, ['']);
  assert.deepEqual(changeCalls, [['']], 'explicit clear retains the one-argument callback contract');
  assert.deepEqual(escaped, []);
  assert.equal(inputRef.current, input);
  assert.equal(document.activeElement, input);
  await h.act(() => input.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  })));
  assert.deepEqual(changes, [''], 'empty search is not submitted again');
  assert.deepEqual(escaped, ['Escape'], 'unhandled Escape remains available to the parent');
});

test('input changes forward native composition detail once to a legacy one-value consumer', async t => {
  const { h, input, inputRef, changes, changeCalls } = await searchProbe(t);
  for (const [value, nativeEvent] of [
    ['ㅎ', { isComposing: true }],
    ['한', { isComposing: false }],
    ['한글', {}],
  ]) {
    // This is the actual rendered Input handler, as in the existing numbered-search harness.
    await h.act(() => inputHandlers(input).onChange({ target: { value }, nativeEvent }));
  }
  assert.deepEqual(changes, ['ㅎ', '한', '한글'], 'the existing consumer receives one value update per input change');
  assert.deepEqual(changeCalls, [
    ['ㅎ', { isComposing: true }],
    ['한', { isComposing: false }],
    ['한글', { isComposing: false }],
  ]);
  assert.equal(input.value, '한글');
  assert.equal(inputRef.current, input, 'value updates keep the forwarded input reference stable');
  assert.equal(document.activeElement, input);
});

test('legacy synthetic input without native metadata forwards the value once as non-composing', async t => {
  const { h, input, changes, changeCalls } = await searchProbe(t);
  for (const event of [
    { target: { value: '기존 입력' } },
    { target: { value: '미제공 입력' }, nativeEvent: undefined },
    { target: { value: '빈 이벤트 입력' }, nativeEvent: null },
  ]) {
    await h.act(() => inputHandlers(input).onChange(event));
  }
  assert.deepEqual(changes, ['기존 입력', '미제공 입력', '빈 이벤트 입력']);
  assert.deepEqual(changeCalls, changes.map(value => [value, { isComposing: false }]));
  assert.equal(input.value, '빈 이벤트 입력');
  assert.ok(document.activeElement === input, 'legacy value delivery does not replace or blur the search input');
});

test('composition callbacks forward start and the final value without an implicit change or submit', async t => {
  const events = [];
  const { h, input, changes, changeCalls } = await searchProbe(t, {
    onCompositionStart: () => events.push(['start']),
    onCompositionEnd: value => events.push(['end', value]),
    onSubmit: () => events.push(['submit']),
  });
  assert.equal(typeof inputHandlers(input).onCompositionStart, 'function');
  assert.equal(typeof inputHandlers(input).onCompositionEnd, 'function');
  await h.act(() => inputHandlers(input).onCompositionStart({ currentTarget: input }));
  assert.deepEqual(changes, [], 'composition start does not manufacture an input change');
  await h.act(() => inputHandlers(input).onChange({ target: { value: 'ㅎ' }, nativeEvent: { isComposing: true } }));
  await h.act(() => inputHandlers(input).onCompositionEnd({ currentTarget: { value: '한글' } }));
  assert.deepEqual(events, [['start'], ['end', '한글']]);
  assert.deepEqual(changes, ['ㅎ'], 'the consumer owns the composition-end commit');
  assert.deepEqual(changeCalls, [['ㅎ', { isComposing: true }]]);
  assert.equal(input.value, 'ㅎ', 'the shared field does not commit the final value behind the consumer');
});

test('optional submit handles ordinary Enter once and leaves composing or unrelated keys alone', async t => {
  const submissions = [];
  const { h, input, changes } = await searchProbe(t, { onSubmit: () => submissions.push(input.value) });
  for (const options of [{ isComposing: true }, { keyCode: 229 }]) {
    const event = new window.KeyboardEvent('keydown', { key: 'Enter', ...options, bubbles: true, cancelable: true });
    await h.act(() => input.dispatchEvent(event));
    assert.equal(event.defaultPrevented, false, 'IME Enter remains owned by the input method');
    assert.deepEqual(submissions, []);
  }
  const enter = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await h.act(() => input.dispatchEvent(enter));
  assert.equal(enter.defaultPrevented, true);
  assert.deepEqual(submissions, ['한글 검색']);
  assert.deepEqual(changes, [], 'submit never manufactures a change callback');
  const otherKey = new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
  await h.act(() => input.dispatchEvent(otherKey));
  assert.equal(otherKey.defaultPrevented, false);
  assert.deepEqual(submissions, ['한글 검색']);
});

test('a consumer without optional submit preserves Enter default and parent handling', async t => {
  const { h, input, changes, escaped } = await searchProbe(t);
  const enter = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await h.act(() => input.dispatchEvent(enter));
  assert.equal(enter.defaultPrevented, false);
  assert.deepEqual(changes, []);
  assert.deepEqual(escaped, ['Enter']);
});

test('the explicit clear button keeps one argument, one change and forwarded focus with optional callbacks', async t => {
  const events = [];
  const { h, input, inputRef, changes, changeCalls } = await searchProbe(t, {
    onCompositionStart: () => events.push('start'),
    onCompositionEnd: () => events.push('end'),
    onSubmit: () => events.push('submit'),
  });
  const clear = document.querySelector('button[aria-label="검색 초기화"]');
  assert.ok(clear);
  clear.focus();
  await h.act(() => clear.click());
  assert.deepEqual(changes, ['']);
  assert.deepEqual(changeCalls, [['']]);
  assert.deepEqual(events, [], 'clear does not impersonate composition or submit');
  assert.equal(input.value, '');
  assert.equal(inputRef.current, input);
  assert.equal(document.activeElement, input);
  assert.equal(clear.disabled, true);
  await h.act(() => clear.click());
  assert.deepEqual(changeCalls, [['']], 'the disabled empty clear cannot dispatch a second change');
});
