// Isolated browser, only loopback fixture; no existing browser or production fallback.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE||'/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');const out=new URL('../../docs/qa/timetable-presets-20260923/',import.meta.url);
await fs.mkdir(out,{recursive:true});const browser=await chromium.launch({headless:true});const results=[];
try{for(const width of [1440,390])for(const theme of ['light','dark']){
 const context=await browser.newContext({viewport:{width,height:960},locale:'ko-KR',timezoneId:'Asia/Seoul',reducedMotion:'reduce'});
 await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'&&['3260','3262'].includes(u.port)?route.continue():route.abort();});
 // Fixture has no Realtime server; preserve production watcher and verify polling separately.
 await context.routeWebSocket(/.*/,socket=>socket.close());
 const page=await context.newPage();const result={width,theme,errors:[],views:[]};page.on('pageerror',e=>result.errors.push(e.message));
 try{await page.goto(`http://127.0.0.1:3260/__fixture?theme=${theme}`);await page.getByRole('combobox',{name:'시간표',exact:true}).waitFor();await page.getByRole('heading',{name:'김선생',exact:true}).waitFor();await page.screenshot({path:new URL(`operational-${width}-${theme}.png`,out).pathname});await page.getByRole('combobox',{name:'시간표',exact:true}).click();await page.getByRole('option',{name:'2027 1학기 검토안',exact:true}).click();await page.locator('[data-plan-slot]').first().waitFor();
 for(const view of ['선생님 주간','강의실 주간','일별 선생님','일별 강의실']){await page.getByRole('tab',{name:view,exact:true}).filter({visible:true}).click();await page.locator('[data-plan-slot]').first().waitFor();const count=await page.locator('[data-plan-slot]').count();const ids=await page.locator('[data-plan-slot]').evaluateAll(nodes=>nodes.map(n=>n.dataset.planSlot).sort());assert.equal(new Set(ids).size,count);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);result.views.push({view,count,ids,overflow});await page.screenshot({path:new URL(`${width}-${theme}-${['선생님 주간','강의실 주간','일별 선생님','일별 강의실'].indexOf(view)}.png`,out).pathname});}
 assert.equal(result.errors.length,0,JSON.stringify(result.errors));result.passed=true;
 }catch(e){result.failure=e.message;await page.screenshot({path:new URL(`failure-${width}-${theme}.png`,out).pathname});result.body=(await page.locator('body').innerText()).slice(-8000);}
 results.push(result);await context.close();}
}finally{await browser.close();await fs.writeFile(new URL('browser-results.json',out),JSON.stringify(results,null,2));}
console.log(JSON.stringify(results.map(result=>{const row={...result};delete row.body;return row;}),null,2));if(results.some(r=>!r.passed))process.exitCode=1;
