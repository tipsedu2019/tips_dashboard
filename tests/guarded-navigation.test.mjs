import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { APP_NAVIGATION_REQUEST, requestAppNavigation } from "../src/lib/guarded-navigation.ts";
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs";

for (const cleanFirst of [true, false]) test(`clean mounted guards do not bypass the dirty editor (${cleanFirst})`, async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://test.invalid/edit" });
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.CustomEvent = dom.window.CustomEvent; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.navigation = Object.assign(new window.EventTarget(), { traverseTo() {} });
  const { createRoot } = await import("react-dom/client");
  const { useUnsavedNavigationGuard } = loadNotificationComponent("src/hooks/use-unsaved-navigation-guard.ts");
  let dirtyGuard, confirmations = 0; const calls = [];
  const request = () => { confirmations++; };
  const navigate = () => {};
  function Guard({ dirty }) {
    const guard = useUnsavedNavigationGuard({ enabled: dirty, onConfirmRequest: request, navigate });
    React.useLayoutEffect(() => { if (dirty) dirtyGuard = guard; }, [dirty, guard]);
    return null;
  }
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close(); });
  await React.act(async () => root.render(React.createElement(React.Fragment, null,
    ...[!cleanFirst, cleanFirst].map((dirty, index) => React.createElement(Guard, { key: index, dirty })))));
  await React.act(async () => requestAppNavigation(() => calls.push("cancelled")));
  assert.equal(confirmations, 1); assert.deepEqual(calls, []);
  dirtyGuard.cancelNavigation();
  await React.act(async () => { requestAppNavigation(() => calls.push("approved")); requestAppNavigation(() => calls.push("repeat")); });
  assert.equal(confirmations, 2); assert.deepEqual(calls, []);
  dirtyGuard.confirmNavigation(); dirtyGuard.confirmNavigation();
  assert.deepEqual(calls, ["approved"]);
});

test("legacy cleanup registered after the dirty listener runs only after approval", () => {
  const dom = new JSDOM("", { url: "https://test.invalid/edit" });
  globalThis.window = dom.window; globalThis.CustomEvent = dom.window.CustomEvent;
  let pending, release; const calls = [];
  window.addEventListener(APP_NAVIGATION_REQUEST, event => { event.preventDefault(); pending = event.detail.intent; });
  window.addEventListener(APP_NAVIGATION_REQUEST, event => event.detail.beforeNavigate.push(resume => { calls.push("cleanup"); release = resume; }));
  requestAppNavigation(() => calls.push("route"));
  assert.deepEqual(calls, []);
  pending(); assert.deepEqual(calls, ["cleanup"]);
  release(); assert.deepEqual(calls, ["cleanup", "route"]);
  dom.window.close();
});

test("a local partial discard keeps legacy Back protection for remaining drafts", async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.invalid/list' });
  globalThis.window=dom.window;globalThis.document=dom.window.document;
  globalThis.CustomEvent=dom.window.CustomEvent;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  window.history.pushState({__NA:true},'', '/edit');
  const {createRoot}=await import('react-dom/client');
  const {useUnsavedNavigationGuard}=loadNotificationComponent('src/hooks/use-unsaved-navigation-guard.ts');
  let guard, confirmations=0, localActions=0;
  const onConfirmRequest=()=>{confirmations++;};const navigate=()=>{};
  function Editor(){const current=useUnsavedNavigationGuard({enabled:true,onConfirmRequest,navigate});React.useLayoutEffect(()=>{guard=current;},[current]);return null;}
  const root=createRoot(document.getElementById('root'));
  const settle=()=>React.act(async()=>{await new Promise(resolve=>setTimeout(resolve,40));});
  t.after(async()=>{await React.act(async()=>root.unmount());await settle();dom.window.close();});
  await React.act(async()=>root.render(React.createElement(Editor)));
  const token=window.history.state.__tipsUnsavedHistory.token;
  guard.requestNavigation(()=>{localActions++;},{preserveHistory:true});
  assert.equal(confirmations,1);guard.confirmNavigation();await settle();
  assert.equal(localActions,1);
  assert.equal(window.history.state?.__tipsUnsavedHistory?.role,'sentinel');
  assert.equal(window.history.state.__tipsUnsavedHistory.token,token);
  await React.act(async()=>window.history.back());await settle();
  assert.equal(confirmations,2,'remaining draft still intercepts Back after local confirmation');
  assert.equal(window.location.pathname,'/edit');guard.cancelNavigation();
});

test('a clean local action waits for the retiring legacy sentinel before pushing its URL', async t => {
  const dom=new JSDOM('<div id="root"></div>',{url:'https://test.invalid/list'});
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.CustomEvent=dom.window.CustomEvent;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  window.history.pushState({__NA:true},'','/edit');
  const {createRoot}=await import('react-dom/client');const {useUnsavedNavigationGuard}=loadNotificationComponent('src/hooks/use-unsaved-navigation-guard.ts');
  let guard, calls=0;const navigate=()=>{},onConfirmRequest=()=>assert.fail('clean action must not ask');
  function Editor({dirty}){const value=useUnsavedNavigationGuard({enabled:dirty,onConfirmRequest,navigate});React.useLayoutEffect(()=>{guard=value;},[value]);return null;}
  const root=createRoot(document.getElementById('root'));const settle=()=>React.act(async()=>{await new Promise(resolve=>setTimeout(resolve,40));});
  t.after(async()=>{await React.act(async()=>root.unmount());await settle();dom.window.close();});
  await React.act(async()=>root.render(React.createElement(Editor,{dirty:true})));
  const {flushSync}=await import('react-dom');
  await React.act(async()=>{
    flushSync(()=>root.render(React.createElement(Editor,{dirty:false})));
    guard.requestNavigation(()=>{calls++;window.history.pushState(null,'','/edit?tab=next');},{preserveHistory:true});
    assert.equal(calls,0,'cleanup must finish before the clean local action runs');
  });
  await settle();assert.equal(calls,1);assert.equal(window.location.search,'?tab=next');
  assert.equal(window.history.state?.__tipsUnsavedHistory,undefined);
});
