// Actual browser UI, synthetic loopback requests only; never activates any backend.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {createRequire} from 'node:module';
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE||import.meta.url),{chromium}=require('playwright');
const base=process.env.AI_AGENT_BASE_URL||'http://127.0.0.1:3300';assert.equal(new URL(base).hostname,'127.0.0.1');
const out=process.env.AI_AGENT_QA_OUT||'/tmp/tips-ai-agent-requests-20261003/output/playwright/ai-agent-credentials';await fs.mkdir(out,{recursive:true});
const allowed=new Set([base,'http://127.0.0.1:3301','http://127.0.0.1:3302']),results=[];
const browser=await chromium.launch({headless:true});
const control=async input=>{const response=await fetch(base+'/__control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(response.status,200);};
async function switchSession(page,index,event='SIGNED_IN'){const session=await fetch(base+'/__session?index='+index).then(r=>r.json());await page.evaluate(({session,event})=>{localStorage.setItem('sb-127-auth-token',JSON.stringify(session));const channel=new BroadcastChannel('sb-127-auth-token');channel.postMessage({event,session});setTimeout(()=>channel.close(),50);},{session,event});}
matrix: for(const width of [1440,390])for(const theme of ['light','dark']){
 await control({reset:true,mode:'normal'});const context=await browser.newContext({viewport:{width,height:width===390?844:900},locale:'ko-KR',timezoneId:'Asia/Seoul',reducedMotion:'reduce',serviceWorkers:'block',colorScheme:theme});
 const row={width,theme,providerCalls:0,assertions:[],screenshots:[],errors:[],externalBlocked:[],credentialWrites:[]};results.push(row);let support=false,mode='normal',deferred=null;const inventory=[],receipts=new Map();
 context.on('page',page=>page.on('pageerror',error=>row.errors.push(error.message)));
 await context.routeWebSocket(/.*/,socket=>socket.close());
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(!allowed.has(url.origin)){row.externalBlocked.push(url.origin);return route.abort();}
  if(url.pathname==='/rest/v1/rpc/ai_agent_credential_api_v1'){
   const {p_action:action,p_input:input}=request.postDataJSON();const respond=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
   if(action==='list')return respond({items:inventory.slice((input.page-1)*input.pageSize,input.page*input.pageSize),total:inventory.length,supportEnabled:support});
   row.credentialWrites.push({action,input});
   if(action==='create'){
    const prior=receipts.get(input.idempotencyKey);if(prior)return respond({...prior,token:null});
    const metadata={id:`a2500000-0000-4000-8000-${String(inventory.length+1).padStart(12,'0')}`,label:input.label,scopes:input.scopes,grant:input.grant,expiresAt:input.expiresAt};receipts.set(input.idempotencyKey,metadata);inventory.unshift({...metadata,createdAt:new Date().toISOString(),revokedAt:null,lastUsedAt:null});
    if(mode==='uncertain')return respond({code:'XX000',message:'synthetic response lost'},503);
    if(mode==='deferred'){deferred=()=>respond({...metadata,token:'tips_agent_'+'a'.repeat(64)});return;}
    return respond({...metadata,token:'tips_agent_'+'a'.repeat(64)});
   }
   if(action==='revoke'){const item=inventory.find(item=>item.id===input.id);item.revokedAt=new Date().toISOString();return respond({id:item.id,revokedAt:item.revokedAt});}
   return respond({code:'22023'},400);
  }
  return route.continue();
 });
 const page=await context.newPage(),tag=`${width}-${theme}`;
 async function snapshot(name){await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),0,name+' overflow');await page.screenshot({path:`${out}/${name}-${tag}.png`});row.screenshots.push(`${name}-${tag}.png`);}
 async function keyTab(){await page.getByRole('tab',{name:'AI 요청 키',exact:true}).click();await page.getByText('발급한 AI 요청 키가 없습니다.',{exact:true}).waitFor();}
 try{
  await page.goto(base+`/__fixture?route=settings&theme=${theme}`);await page.getByRole('tab',{name:'연결 키',exact:true}).waitFor();await page.getByRole('button',{name:'연결 키 발급',exact:true}).waitFor();await snapshot('reference-class');
  const reference=await page.getByRole('button',{name:'연결 키 발급',exact:true}).evaluate(el=>{const c=getComputedStyle(el);return {height:c.height,font:c.fontSize,radius:c.borderRadius,background:c.backgroundColor};});
  await keyTab();assert.equal(await page.getByRole('button',{name:'AI 요청 키 발급',exact:true}).isDisabled(),true);assert.equal(row.credentialWrites.length,0);await snapshot('support-off');
  support=true;await page.getByRole('button',{name:'AI 요청 키 새로고침',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(el=>el.textContent==='AI 요청 키 발급'&&!el.disabled));
  const current=await page.getByRole('button',{name:'AI 요청 키 발급',exact:true}).evaluate(el=>{const c=getComputedStyle(el);return {height:c.height,font:c.fontSize,radius:c.borderRadius,background:c.backgroundColor};});assert.deepEqual(current,reference);row.assertions.push('matching legacy settings primary control geometry/token colors, off-support zero writes');
  await page.getByRole('button',{name:'AI 요청 키 발급',exact:true}).click();assert.equal(await page.getByLabel('요청 권한',{exact:true}).inputValue(),'read');assert.equal(await page.getByLabel('유효 기간',{exact:true}).inputValue(),'1');assert.equal(await page.getByRole('checkbox',{name:'Chat 전송 권한',exact:true}).isChecked(),false);await snapshot('read-default');
  await page.getByRole('checkbox',{name:'Chat 전송 권한',exact:true}).click();for(const checkbox of await page.getByRole('group',{name:'전송 공간',exact:true}).getByRole('checkbox').all())assert.equal(await checkbox.isDisabled(),true);await snapshot('chat-explicit-no-default');await page.getByRole('checkbox',{name:'Chat 전송 권한',exact:true}).click();await page.getByLabel('요청 권한',{exact:true}).selectOption('worker');await snapshot('worker-explicit');
  await page.getByRole('button',{name:'발급',exact:true}).click();await page.getByRole('textbox',{name:'발급된 AI 요청 키',exact:true}).waitFor();assert.equal(row.credentialWrites[0].input.grant.queues[0],'employee_requests');assert.deepEqual(row.credentialWrites[0].input.grant.actions,['read','claim','renew','progress','question','done']);assert.equal(row.credentialWrites[0].input.grant.spaceKeys,undefined);await snapshot('first-only-synthetic-secret');await page.keyboard.press('Escape');await page.getByRole('textbox',{name:'발급된 AI 요청 키',exact:true}).waitFor({state:'detached'});assert.equal(await page.getByRole('textbox',{name:'발급된 AI 요청 키',exact:true}).count(),0);await snapshot('secret-closed');row.assertions.push('one-day read default, deliberate worker, no Chat/domain/default-seven, one-time secret dismissal');
  mode='uncertain';await page.getByRole('button',{name:'AI 요청 키 발급',exact:true}).click();await page.getByLabel('이름',{exact:true}).fill('불확실한 합성 발급');await page.getByRole('button',{name:'발급',exact:true}).click();await page.getByText('발급 결과를 확인하지 못했습니다. 같은 발급의 결과를 다시 확인하세요.',{exact:true}).waitFor();const original=structuredClone(row.credentialWrites.at(-1));await page.keyboard.press('Escape');await page.getByRole('tab',{name:'연결 키',exact:true}).click();await page.getByRole('tab',{name:'AI 요청 키',exact:true}).click();await page.getByRole('button',{name:'발급 결과 확인',exact:true}).click();await page.getByLabel('이름',{exact:true}).fill('나중에 입력한 다른 발급');mode='normal';await page.getByRole('button',{name:'발급 결과 확인',exact:true}).last().click();await page.getByText(/발급 기록을 확인했습니다. 원문 키는 다시 표시할 수 없습니다/).waitFor();assert.deepEqual(row.credentialWrites.at(-1),original);assert.equal(await page.getByRole('textbox',{name:'발급된 AI 요청 키',exact:true}).count(),0);await snapshot('ambiguous-receipt-recovery');row.assertions.push('same-actor tab remount reuses exact original UUID/payload, metadata-only replay never displays secret');
  const revokeButton=page.getByRole('button',{name:'폐기',exact:true}).first();await revokeButton.click();await page.getByRole('button',{name:'AI 요청 키 폐기 폐기',exact:true}).click();await page.getByText('AI 요청 키를 폐기했습니다.',{exact:true}).waitFor();assert.equal(row.credentialWrites.at(-1).action,'revoke');await snapshot('revoked');
  mode='deferred';await page.getByRole('button',{name:'AI 요청 키 발급',exact:true}).click();await page.getByRole('button',{name:'발급',exact:true}).click();while(!deferred)await new Promise(r=>setTimeout(r,20));await control({role:'viewer'});await switchSession(page,0,'USER_UPDATED');await page.waitForFunction(()=>document.querySelector('input[aria-label="발급된 AI 요청 키"]')===null&&!document.querySelector('#ai-credential-label'));await deferred();assert.equal(await page.getByRole('textbox',{name:'발급된 AI 요청 키',exact:true}).count(),0);await snapshot('role-boundary-late-secret');row.assertions.push('revoke synthetic only; late issuance after role downgrade hidden');
  assert.deepEqual(row.errors,[]);assert.deepEqual(row.externalBlocked,[]);row.passed=true;
 }catch(error){row.passed=false;row.failure=error.stack;row.body=(await page.locator('body').innerText()).slice(-5000);await page.screenshot({path:`${out}/failure-${tag}.png`});}
 console.log(tag,row.passed?'PASS':row.failure);await context.close();if(!row.passed)break matrix;
}
await browser.close();await fs.writeFile(out+'/results.json',JSON.stringify({provenance:{synthetic:true,loopbackOnly:true,providerCalls:0},results},null,2));assert.equal(results.length,4);assert.ok(results.every(row=>row.passed));
