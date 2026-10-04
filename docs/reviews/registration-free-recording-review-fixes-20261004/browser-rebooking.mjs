import assert from 'node:assert/strict';
import { chromium } from '/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {writeFile} from 'node:fs/promises';
const out=new URL('../../../output/playwright/',import.meta.url).pathname;
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const results=[];
try{
 for(const [role,state,width,fail] of [['staff','attended_feedback_pending',1440,false],['admin','completed',390,true],['staff','no_show',390,false],['teacher','completed',390,false],['assistant','completed',1440,false]]){
  const context=await browser.newContext({viewport:{width,height:900}});let external=0;const errors=[];
  await context.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();external++;return route.abort()});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:3193/registration-review-qa?fixture=registration-subject-tracks&role=${role}&state=${state}${fail?'&failOnce=1':''}`);
  await page.getByRole('heading',{name:'합성 재예약 검증 · '+role,exact:true}).waitFor({timeout:10000}).catch(async e=>{await writeFile(out+'review-error.txt',JSON.stringify({errors,body:await page.locator('body').innerText()},null,2));throw e});
  assert.equal(await page.getByRole('button',{name:'참석 확인',exact:true}).count(),0);
  if(role==='teacher'||role==='assistant'){
   assert.equal(await page.getByRole('combobox',{name:'영어 진행상태',exact:true}).isDisabled(),true);
   assert.equal(await page.getByRole('combobox',{name:'청강 반',exact:true}).count(),0);
  }else{
   await page.getByRole('combobox',{name:'청강 반',exact:true}).click({timeout:10000}).catch(async e=>{await writeFile(out+'review-error.txt',JSON.stringify({errors,body:await page.locator('body').innerText()},null,2));throw e});await page.getByRole('option').first().click();
   await page.getByRole('combobox',{name:'청강 회차',exact:true}).click();await page.getByRole('option').first().click();
   const region=page.getByRole('region',{name:/^청강 신청:/});
   await region.screenshot({path:out+`review-${role}-${state}-before.png`,animations:'disabled'});
   await region.getByRole('button',{name:'청강 예약 저장',exact:true}).click();
   await page.getByRole('dialog',{name:'청강 예약을 저장할까요?'}).getByRole('button',{name:'청강 예약 저장',exact:true}).click();
   if(fail){
    await page.getByRole('dialog',{name:'청강 예약을 저장할까요?'}).getByRole('alert').filter({hasText:'요청 시간이 초과되었습니다.'}).waitFor();
    await page.getByRole('dialog',{name:'청강 예약을 저장할까요?'}).getByRole('button',{name:'청강 예약 저장',exact:true}).click();
   }
   await region.getByText('예약 저장됨',{exact:true}).waitFor();
   const snapshot=await page.evaluate(()=>window.__REVIEW_QA__.snapshot());
   assert.equal(snapshot.current.status,'scheduled');assert.equal(snapshot.attempts.length,snapshot.original.length+1);
   for(const old of snapshot.original)assert.deepEqual(snapshot.attempts.find(row=>row.observationId===old.observationId),old);
   assert.equal(snapshot.bookingCalls,fail?2:1);
   await region.screenshot({path:out+`review-${role}-${state}-after.png`,animations:'disabled'});
  }
  const snapshot=await page.evaluate(()=>window.__REVIEW_QA__.snapshot());const documentWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
  assert.equal(documentWidth,width);assert.equal(external,0);assert.deepEqual(errors,[]);
  results.push({role,state,width,documentWidth,external,errors,bookingCalls:snapshot.bookingCalls,attempts:snapshot.attempts.length,oldAttempts:snapshot.original.length,counts:snapshot.counts});
  await context.close();
 }
}finally{await writeFile(out+'review-rebooking-browser.json',JSON.stringify(results,null,2));await browser.close()}
