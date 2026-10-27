import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const require = createRequire(import.meta.url);
const file = new URL('../src/features/operations/use-class-schedule-month-summary.ts', import.meta.url);
const code = ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiled = { exports: {} };
vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(require, compiled, compiled.exports);
const { useClassScheduleMonthSummary } = compiled.exports;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('summary hook isolates class, year, role loader, refresh and logout before accepting late replies', async t => {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const container = document.getElementById('root');
  const root = createRoot(container);
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); });
  const calls = [];
  const loader = actor => input => {
    const deferred = Promise.withResolvers();
    calls.push({ actor, input, ...deferred });
    return deferred.promise;
  };
  const teacher = loader('teacher'), staff = loader('staff');
  function Probe({ load, input, refresh }) {
    const state = useClassScheduleMonthSummary(load, input, refresh);
    return createElement('pre', null, JSON.stringify(state));
  }
  const state = () => JSON.parse(container.textContent);
  const render = (load, input, refresh = '0') => act(async () => root.render(createElement(Probe, { load, input, refresh })));
  const settle = callback => act(async () => { callback(); });
  const value = (classId, year, count) => ({ classId, year, authoritativeSource: 'normalized', months: [{ month: 1, count }] });
  await render(teacher, { classId: 'A', year: 2026 });
  const old = calls.at(-1);
  await render(teacher, { classId: 'B', year: 2026 });
  assert.equal(state().status, 'loading');
  await settle(() => old.resolve(value('A', 2026, 99)));
  assert.equal(state().status, 'loading');
  await settle(() => calls.at(-1).resolve(value('B', 2026, 2)));
  assert.equal(state().value.classId, 'B');
  await render(teacher, { classId: 'B', year: 2027 });
  assert.equal(state().status, 'loading');
  const oldYear = calls.at(-1);
  await render(staff, { classId: 'B', year: 2027 });
  assert.equal(state().status, 'loading');
  await settle(() => oldYear.resolve(value('B', 2027, 99)));
  assert.equal(state().status, 'loading');
  await settle(() => calls.at(-1).resolve(value('B', 2027, 3)));
  assert.equal(state().value.months[0].count, 3);
  await render(staff, { classId: 'B', year: 2027 }, '1');
  assert.equal(state().status, 'loading');
  await settle(() => calls.at(-1).reject(Error('synthetic')));
  assert.equal(state().status, 'error');
  await render(staff, { classId: 'B', year: 2027 }, '2');
  assert.equal(state().status, 'loading');
  const retry = calls.at(-1);
  await render(staff, null, '2');
  assert.equal(state().status, 'idle');
  await settle(() => retry.resolve(value('B', 2027, 99)));
  assert.equal(state().status, 'idle');
  assert.equal(calls.length, 6);
  await render(staff, { classId: 'B', year: 2027 }, '2');
  await settle(() => calls.at(-1).resolve(value('B', 2027, 4)));
  assert.equal(state().value.months[0].count, 4);
  await render(staff, { classId: 'C', year: 2027 }, '2');
  const abandoned = calls.at(-1);
  await render(staff, { classId: 'B', year: 2027 }, '2');
  assert.equal(state().status, 'loading', 'returning to a previously ready scope starts fresh');
  await settle(() => abandoned.resolve(value('C', 2027, 99)));
  assert.equal(state().status, 'loading');
  await settle(() => calls.at(-1).resolve(value('B', 2027, 5)));
  assert.equal(state().value.months[0].count, 5);
  await render(staff, null, '2');
  await render(staff, { classId: 'B', year: 2027 }, '2');
  assert.equal(state().status, 'loading', 'leaving and re-entering invalidates a ready snapshot');
  await settle(() => calls.at(-1).resolve(value('B', 2027, 6)));
  assert.equal(state().value.months[0].count, 6);
  assert.equal(calls.length, 10);
});
