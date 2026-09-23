import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {timetablePerformanceFixture} from './timetable-performance-fixture.mjs';

const {chromium}=createRequire('/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')('playwright');
const browser=await chromium.launch({headless:true});
const report={mode:'local Next production webpack',transport:'synthetic reads; all mutations/external requests blocked',results:[]};
const output=process.env.TIMETABLE_CANCEL_OUTPUT || 'docs/qa/timetable-presets-20260923/task8-cancel-lifecycle.json';
try {
 for(const change of ['none','refresh','view','filter','unmount','unrelated-release','new-gesture']) {
  const snapshot=timetablePerformanceFixture(1,1);
  const context=await browser.newContext({viewport:{width:1440,height:1200},locale:'ko-KR',reducedMotion:'reduce'});
  let mutations=0,external=0,reads=0;
  try {
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='127.0.0.1'){external++;return route.abort();}
    if(url.pathname.endsWith('/list_timetable_plans_v1'))return route.fulfill({json:{plans:[snapshot.plan],total:1,page:1,pageSize:50,canManage:true}});
    if(url.pathname.endsWith('/get_timetable_plan_v1')){reads++;return route.fulfill({json:snapshot});}
    if(url.pathname.endsWith('/get_timetable_plan_revision_v1'))return route.fulfill({json:{planId:snapshot.plan.id,metaRevision:0,changeSequence:1,shadowFingerprint:snapshot.shadowFingerprint,complete:true}});
    if(url.pathname.includes('/mutate_')||url.pathname.includes('/commit_')){mutations++;return route.abort();}
    return route.continue();
   });
   await context.routeWebSocket(/.*/,socket=>socket.close());
   await context.addInitScript(()=>{
    // Count only the capture listeners used for post-Escape physical release.
    const pending=new Set(),add=window.addEventListener,remove=window.removeEventListener;
    window.addEventListener=function(type,listener,options){if(['pointerup','pointercancel'].includes(type)&&options===true)pending.add(listener);return add.call(this,type,listener,options);};
    window.removeEventListener=function(type,listener,options){if(['pointerup','pointercancel'].includes(type)&&options===true)pending.delete(listener);return remove.call(this,type,listener,options);};
    window.__cancelPending=()=>pending.size;
   });
   const page=await context.newPage();
   await page.goto('http://127.0.0.1:3260/__fixture');
   const selectPlan=async()=>{await page.getByRole('combobox',{name:'시간표',exact:true}).click();await page.getByRole('option',{name:snapshot.plan.name,exact:true}).last().click();};
   await selectPlan();
   const handle=page.locator(`[data-plan-slot="${snapshot.slots[0].id}"] [data-plan-handle]`).first();
   const begin=async()=>{
    await handle.waitFor();await handle.scrollIntoViewIfNeeded();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const box=await handle.boundingBox();assert.ok(box);
    const point={x:box.x+box.width/2,y:box.y+box.height/2};
    await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+5,point.y+5);
    await page.locator('[data-plan-pointer-preview]').waitFor();
    return point;
   };
   const originalPoint=await begin();await page.keyboard.press('Escape');await page.waitForTimeout(100);
   assert.equal(await page.locator('[data-plan-pointer-preview]').count(),0);
   assert.equal(await page.evaluate(()=>window.__cancelPending()),1);
   const beforeDialogs=await page.getByRole('dialog').count(),beforeReads=reads;
   if(change==='refresh'){
    const fetched=page.waitForResponse(response=>response.url().endsWith('/get_timetable_plan_v1'));
    await page.getByRole('button',{name:'새로고침',exact:true}).press('Enter');await fetched;await page.waitForTimeout(100);assert.ok(reads>beforeReads);
   }
   if(change==='view')await page.getByRole('tab',{name:'강의실 주간',exact:true}).filter({visible:true}).press('Enter');
   if(change==='filter'){await page.locator('#plan-subject').press('Enter');await page.getByRole('option',{name:'영어',exact:true}).press('Enter');}
   if(change==='unmount'){await page.getByRole('combobox',{name:'시간표',exact:true}).press('Enter');await page.getByRole('option',{name:'운영 시간표',exact:true}).press('Enter');}
   if(change==='unrelated-release')await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointerup',{pointerId:999,pointerType:'touch',bubbles:true})));
   if(change==='new-gesture'){
    // Synthetic second-pointer lifecycle only; the old mouse releases outside the handle.
    await handle.dispatchEvent('pointerdown',{pointerId:999,pointerType:'touch',button:0,clientX:originalPoint.x,clientY:originalPoint.y,bubbles:true});
    assert.equal(await page.evaluate(()=>window.__cancelPending()),0,'new gesture removes previous release listener');
    await handle.dispatchEvent('pointercancel',{pointerId:999,pointerType:'touch',bubbles:true});
    await page.mouse.move(1,1);
   }
   await page.waitForTimeout(100);
   const pendingBeforeRelease=await page.evaluate(()=>window.__cancelPending());
   await page.mouse.up();await page.waitForTimeout(100);
   const afterDialogs=await page.getByRole('dialog').count();
   assert.equal(afterDialogs,beforeDialogs,`${change}: late release must not open editor`);
   assert.equal(await page.locator('[data-plan-pointer-preview]').count(),0);
   assert.equal(await page.evaluate(()=>window.__cancelPending()),0,'release/unmount cleans pending listeners');
   assert.equal(pendingBeforeRelease,['unmount','new-gesture'].includes(change)?0:1,'snapshot/view/filter/unrelated pointer cannot clear matching release wait');
   if(change==='unmount')await selectPlan();
   await page.getByRole('tab',{name:'선생님 주간',exact:true}).filter({visible:true}).click();
   await begin();await page.keyboard.press('Escape');await page.mouse.up();await page.waitForTimeout(30);
   assert.equal(await page.locator('[data-plan-pointer-preview]').count(),0);
   assert.equal(await page.getByRole('dialog').count(),0);
   assert.equal(await page.evaluate(()=>window.__cancelPending()),0);
   // Standard keyboard activation still opens the existing editor after release.
   await handle.press('Enter');await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
   assert.equal(mutations,0);assert.equal(external,0);
   report.results.push({change,passed:true,beforeDialogs,afterDialogs,pendingBeforeRelease,nextGesture:true,nextKeyboardOpen:true,secondPointerSynthetic:change==='new-gesture',reads,mutations,external});
  } catch(error) {report.results.push({change,passed:false,error:String(error),reads,mutations,external});process.exitCode=1;}
  finally {console.log(JSON.stringify(report.results.at(-1)));await context.close();}
 }
} finally {await browser.close();await writeFile(output,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
