import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { act, createElement as h, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const require = createRequire(import.meta.url);
const rootPath = path.resolve(import.meta.dirname, '..');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function modules() {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const runtime = { exports: {} }; cache.set(file, runtime);
    const source = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const resolve = specifier => {
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return require(specifier);
      const base = specifier.startsWith('@/') ? path.join(rootPath, 'src', specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
      assert.ok(target, specifier); return load(target);
    };
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file })(resolve, runtime, runtime.exports);
    return runtime.exports;
  }
  return load;
}
async function withDom(run) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://fixture.invalid' });
  const keys = ['window','document','navigator','HTMLElement','Element','MutationObserver','CustomEvent','Event','Node','NodeFilter','HTMLInputElement','DocumentFragment','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','ResizeObserver'];
  const saved = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis,key)]));
  for (const key of keys.slice(0,13)) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:dom.window[key]});
  dom.window.HTMLElement.prototype.attachEvent = () => {};
  dom.window.HTMLElement.prototype.detachEvent = () => {};
  globalThis.getComputedStyle = dom.window.getComputedStyle;
  globalThis.requestAnimationFrame = cb => setTimeout(cb,0); globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const root = createRoot(document.getElementById('root'));
  try { await run(root); } finally {
    await act(async()=>root.unmount()); dom.window.close();
    for(const [key,descriptor] of saved) { if(descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key]; }
  }
}
const click = async element => { assert.ok(element); await act(async()=>element.click()); };

test('selection changes preserve the actual search node, typed query, focus and table siblings', async()=>withDom(async root=>{
  const load=modules();
  const {DataTableCommandRow}=load(path.join(rootPath,'src/components/data-table/data-table-surface.tsx'));
  const {DataTableSelectionActions}=load(path.join(rootPath,'src/components/data-table/data-table-selection.tsx'));
  const render=count=>h('div',null,h(DataTableCommandRow,{search:h('input',{type:'search',defaultValue:'중3 영어'}),actions:count?h(DataTableSelectionActions,{count,label:'선택 작업',onClear:()=>{}},h('button',null,'수정')):h('button',null,'추가')}),h('table',null,h('tbody',null,h('tr',null,h('td',null,'학생')))));
  await act(async()=>root.render(render(0)));
  const search=document.querySelector('input');search.focus();const table=document.querySelector('table');
  for(const count of [1,10,0]) {
    await act(async()=>root.render(render(count)));
    assert.equal(document.querySelector('input'),search);assert.equal(search.value,'중3 영어');assert.equal(document.activeElement,search);
    assert.equal(document.querySelector('table'),table);assert.equal(document.getElementById('root').firstChild.children.length,2);
  }
}));

test('bulk edit opens on demand, keeps a failed draft, prevents repeat submission and restores search after success',async()=>withDom(async root=>{
  const load=modules();const {ManagementBulkActionBar}=load(path.join(rootPath,'src/features/management/management-bulk-actions.tsx'));
  let complete,attempts=0;
  function Harness(){const [count,setCount]=useState(2),[value,setValue]=useState('중2'),[pending,setPending]=useState(false);const region=useRef(null);
    return h('div',{ref:region},h('input',{type:'search','aria-label':'학생 검색'}),h(ManagementBulkActionBar,{selectedCount:count,fields:[{id:'grade',label:'학년',placeholder:'학년'}],field:'grade',value,pending,onFieldChange:()=>{},onValueChange:setValue,onClear:()=>setCount(0),returnFocusRef:region,onApply:async()=>{attempts++;setPending(true);const success=await new Promise(resolve=>{complete=resolve});setPending(false);if(success)setCount(0);return success;}}));}
  await act(async()=>root.render(h(Harness)));
  assert.equal(document.querySelector('[role=dialog]'),null);
  const trigger=document.querySelector('[aria-label="선택 항목 일괄 수정"]');trigger.focus();await click(trigger);
  assert.ok(document.querySelector('[role=dialog]'));
  assert.equal(document.querySelector('#management-bulk-value').value,'중2');
  const submit=document.querySelector('[type=submit]');await click(submit);assert.equal(attempts,1);assert.equal(submit.disabled,true);await click(submit);assert.equal(attempts,1);
  await act(async()=>complete(false));assert.ok(document.querySelector('[role=dialog]'));assert.match(document.querySelector('[role=alert]').textContent,/다시 시도/);assert.equal(document.querySelector('#management-bulk-value').value,'중2');
  await click(submit);assert.equal(attempts,2);await act(async()=>complete(true));await act(async()=>new Promise(r=>setTimeout(r,20)));
  assert.equal(document.querySelector('[role=dialog]'),null);assert.equal(document.activeElement?.getAttribute('aria-label'),'학생 검색');
}));

test('cancel returns focus to the edit trigger and preserves the selection',async()=>withDom(async root=>{
  const load=modules();const {ManagementBulkActionBar}=load(path.join(rootPath,'src/features/management/management-bulk-actions.tsx'));
  await act(async()=>root.render(h(ManagementBulkActionBar,{selectedCount:1,fields:[{id:'grade',label:'학년',placeholder:'학년'}],field:'grade',value:'중2',pending:false,onFieldChange:()=>{},onValueChange:()=>{},onApply:async()=>true,onClear:()=>{},returnFocusRef:{current:null}})));
  const trigger=document.querySelector('[aria-label="선택 항목 일괄 수정"]');trigger.focus();await click(trigger);await click(document.querySelector('[aria-label="일괄 수정 취소"]'));
  await act(async()=>new Promise(r=>setTimeout(r,20)));
  assert.equal(document.activeElement,trigger);assert.match(document.body.textContent,/1건 선택/);
}));

test('read-only lists omit unused command space and cannot expose bulk edit',async()=>withDom(async root=>{
  const load=modules();const {DataTableCommandRow}=load(path.join(rootPath,'src/components/data-table/data-table-surface.tsx'));
  const {ManagementBulkActionBar}=load(path.join(rootPath,'src/features/management/management-bulk-actions.tsx'));
  await act(async()=>root.render(h('div',null,h(DataTableCommandRow,{search:h('input',{type:'search'}),reserveActions:false}),h(ManagementBulkActionBar,{selectedCount:1,canEdit:false,fields:[{id:'grade',label:'학년',placeholder:'학년'}],field:'grade',value:'',pending:false,onFieldChange:()=>{},onValueChange:()=>{},onApply:async()=>{assert.fail('read-only mutation')},onClear:()=>{},returnFocusRef:{current:null}}))));
  assert.equal(document.querySelector('[data-slot=data-table-actions]'),null);
  assert.equal(document.querySelector('[aria-label="선택 항목 일괄 수정"]'),null);
  assert.ok(document.querySelector('[aria-label="선택 해제"]'));
}));
