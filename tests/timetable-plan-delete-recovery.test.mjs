import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const source=await readFile(new URL('../src/features/academic/timetable-plan-recovery-actions.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},fileName:'recovery.tsx'}).outputText;
const runtime={exports:{}};
vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`)(key=>key==='@/components/ui/button'?{Button:({children,...props})=>{delete props.size;delete props.variant;return React.createElement('button',props,children);}}:require(key),runtime,runtime.exports);
for(const failure of ['stale','rejected','uncertain'])test(`optimistically absent deletion renders usable ${failure} controls`,async()=>{
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});const root=createRoot(document.getElementById('root')),calls=[];
 try{await act(async()=>root.render(React.createElement(runtime.exports.TimetablePlanRecoveryActions,{operations:[{itemId:'deleted',operation:'delete',name:'수학',failure}],onResolve:(...args)=>calls.push(args),onDiscard:id=>calls.push(['discard',id]),onRetry:id=>calls.push(['retry',id])})));
 const buttons=[...document.querySelectorAll('button')];
 assert.deepEqual(buttons.map(b=>b.textContent),failure==='stale'?['최신 내용 사용','삭제 다시 적용']:failure==='rejected'?['거절된 요청 버리기']:['원래 요청 재시도']);
 for(const button of buttons)await act(async()=>button.click());
 assert.deepEqual(calls,failure==='stale'?[['deleted','accept_server'],['deleted','reapply_draft']]:failure==='rejected'?[['discard','deleted']]:[['retry','deleted']]);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
