// Actual parent/picker/plan/transfer integration; only synthetic loopback actors and DB.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
const {chromium}=createRequire('/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')('playwright');
const browser=await chromium.launch({headless:true});const results=[];
const reportPath=process.env.TIMETABLE_DIRTY_REPORT ?? 'docs/qa/timetable-presets-20260923/task9-dirty-owner-results.json';
async function rpc(page,name,args){return page.evaluate(async({name,args})=>{const session=JSON.parse(localStorage.getItem('sb-127-auth-token'));const r=await fetch(`http://127.0.0.1:3262/rest/v1/rpc/${name}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${session.access_token}`,'x-timetable-fixture-db':'1'},body:JSON.stringify(args)});return {status:r.status,data:await r.json()};},{name,args});}
try {
 for(const operation of ['create','clone']) for(const finish of ['save','discard']) {
  const context=await browser.newContext({viewport:{width:1440,height:960},locale:'ko-KR',reducedMotion:'reduce'});
  await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'&&['3260','3262'].includes(u.port)?route.continue({headers:{...route.request().headers(),'x-timetable-fixture-db':'1'}}):route.abort();});await context.routeWebSocket(/.*/,socket=>socket.close());
  const page=await context.newPage();const name=`Task9 dirty ${operation} ${finish} ${Date.now()}`;
  try {
   await page.goto('http://127.0.0.1:3260/__fixture');await page.getByRole('combobox',{name:'시간표',exact:true}).waitFor();
   if(operation==='clone'){
    const id=crypto.randomUUID();assert.equal((await rpc(page,'mutate_timetable_plan_v1',{p_command:{operation:'create',planId:id,name:name+' source',requestKey:crypto.randomUUID()}})).status,200);
    await page.reload();await page.getByRole('combobox',{name:'시간표',exact:true}).click();await page.getByRole('option',{name:name+' source',exact:true}).click();await page.getByRole('button',{name:'수업 추가',exact:true}).waitFor();
    await page.getByRole('button',{name:'더보기',exact:true}).click();await page.getByRole('menuitem',{name:'복제',exact:true}).click();
   } else await page.getByRole('button',{name:'프리셋 만들기',exact:true}).click();
   await page.getByLabel('프리셋 이름',{exact:true}).fill(name);
   let original;await page.route('**/mutate_timetable_plan_v1',async route=>{original=route.request().postDataJSON();const r=await route.fetch();assert.ok(r.ok(),await r.text());await route.fulfill({status:503,json:{message:'synthetic committed response lost'}});},{times:1});
   await page.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();await page.getByRole('button',{name:'원래 요청 재시도',exact:true}).waitFor();await page.getByLabel('프리셋 이름',{exact:true}).fill(name+' followup');
   // The submitted command guard also applies before reload. Accept only this requested reload.
   page.once('dialog',dialog=>dialog.accept());await page.reload();await page.getByRole('button',{name:'원래 요청 확인',exact:true}).click();const retry=page.waitForRequest(r=>r.url().endsWith('/mutate_timetable_plan_v1'));await page.getByRole('button',{name:'원래 요청 재시도',exact:true}).click();assert.deepEqual((await retry).postDataJSON(),original);
   await page.getByText('원래 요청의 저장을 확인했습니다.',{exact:false}).waitFor();assert.equal(await page.getByLabel('프리셋 이름',{exact:true}).inputValue(),name+' followup');
   // Plan snapshot and its transfer session have mounted underneath the continuation dialog.
   await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='수업 추가'&&!b.disabled));await page.waitForTimeout(200);
   assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).some(k=>k.endsWith(encodeURIComponent('$metadata')))),false,'completed original receipt must not turn the unsubmitted continuation into autosave');
   const guarded=await page.evaluate(()=>!window.dispatchEvent(new Event('beforeunload',{cancelable:true})));
   assert.equal(guarded,true,'follow-up guard survives resulting plan/transfer mount');
   await page.getByLabel('프리셋 이름',{exact:true}).fill(name+' final');assert.equal(await page.evaluate(()=>!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),true);
   const nativeDialog=page.waitForEvent('dialog',{timeout:3000});await page.close({runBeforeUnload:true});const dialog=await nativeDialog;assert.equal(dialog.type(),'beforeunload');await dialog.dismiss();assert.equal(page.isClosed(),false);
   if(finish==='save') {await page.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});const result=await rpc(page,'get_timetable_plan_v1',{p_plan_id:original.p_command.planId});assert.equal(result.data.plan.name,name+' final');}
   else {await page.getByRole('dialog').getByRole('button',{name:'취소',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});const result=await rpc(page,'get_timetable_plan_v1',{p_plan_id:original.p_command.planId});assert.equal(result.data.plan.name,name);}
   await page.waitForFunction(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true})));assert.equal(await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),true,'save/explicit discard releases only completed form guard');
   results.push({operation,finish,passed:true,planId:original.p_command.planId,requestKey:original.p_command.requestKey});
  } catch(error){results.push({operation,finish,passed:false,error:error.stack});console.error(error);process.exitCode=1;} finally {await context.close();}
 }
} finally {await writeFile(reportPath,JSON.stringify({boundary:'local production Next, actual isolated DB committed-response loss; real parent/picker/transfer mount, native beforeunload close dismissed; no unsubmitted autosave',results},null,2));await browser.close();}
console.log(JSON.stringify(results));
