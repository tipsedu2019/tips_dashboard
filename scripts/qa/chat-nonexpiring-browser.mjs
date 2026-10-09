import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {createRequire} from 'node:module';
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE||import.meta.url),{chromium}=require('playwright');
const base=process.env.AI_AGENT_BASE_URL||'http://127.0.0.1:3300',out=process.env.AI_CHAT_NONEXPIRING_QA_OUT||'/tmp/tips-chat-nonexpiring-browser/';assert.equal(new URL(base).hostname,'127.0.0.1');assert.ok(out.endsWith('/'));await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})}),results=[];const allowed=new Set([base,...[1,2].map(offset=>'http://127.0.0.1:'+(Number(new URL(base).port)+offset))]);
try{for(const width of [1440,390])for(const theme of ['light','dark']){
 await fetch(base+'/__control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reset:true})});
 const context=await browser.newContext({viewport:{width,height:width===390?844:900},locale:'ko-KR',timezoneId:'Asia/Seoul',reducedMotion:'reduce',serviceWorkers:'block',colorScheme:theme});
 const row={width,theme,writes:[],errors:[],externalBlocked:[],screenshots:[],assertions:[]};results.push(row);let support=false,uncertain=false;const receipts=new Map(),inventory=[];
 await context.routeWebSocket(/.*/,socket=>socket.close());
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(!allowed.has(url.origin)){row.externalBlocked.push(url.origin);return route.abort();}
  const respond=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(url.pathname==='/api/ai-agent/spaces')return respond({data:{items:['경영팀','관리팀','조교팀','영어팀','전체 공지','수학팀','과학팀'].map((label,i)=>({key:`space_${i+1}`,label,configured:true,selectable:true,reason:null,revision:'1'}))},error:null});
  if(url.pathname==='/rest/v1/rpc/ai_agent_credential_api_v1'){
   const {p_action:action,p_input:input}=request.postDataJSON();if(action==='list')return respond({items:inventory,total:inventory.length,supportEnabled:support});
   row.writes.push({action,input});assert.equal(action,'create');if(receipts.has(input.idempotencyKey))return respond({...receipts.get(input.idempotencyKey),token:null});
   const metadata={id:`ab080000-0000-4000-8000-${String(inventory.length+1).padStart(12,'0')}`,label:input.label,scopes:input.scopes,grant:input.grant,expiresAt:input.expiresAt};receipts.set(input.idempotencyKey,metadata);inventory.unshift({...metadata,createdAt:new Date().toISOString(),revokedAt:null,lastUsedAt:null});
   if(uncertain)return respond({code:'XX000',message:'synthetic response loss'},503);
   return respond({...metadata,token:'tips_agent_'+'a'.repeat(64)});
  }
  return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>row.errors.push(e.message));
 const screenshot=async name=>{await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),0,'page overflow');const file=`${name}-${width}-${theme}.png`;await page.screenshot({path:out+file});row.screenshots.push(file);};
 try{
 await page.goto(base+`/__fixture?route=settings&theme=${theme}`);await page.getByRole('button',{name:'연결 키 발급',exact:true}).waitFor();await screenshot('reference-class-key');
 const style=el=>{const c=getComputedStyle(el);return {height:c.height,font:c.fontSize,radius:c.borderRadius,background:c.backgroundColor};};const reference=await page.getByRole('button',{name:'연결 키 발급',exact:true}).evaluate(style);
 await page.getByRole('tab',{name:'AI 요청 키',exact:true}).click();const issuer=page.getByRole('button',{name:'AI 요청 키 발급',exact:true});await page.getByText('발급한 AI 요청 키가 없습니다.',{exact:true}).waitFor();assert.equal(await issuer.isDisabled(),true);assert.equal(row.writes.length,0);row.assertions.push('support off zero issuance');
 support=true;await page.getByRole('button',{name:'AI 요청 키 새로고침',exact:true}).click();await issuer.waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(el=>el.textContent==='AI 요청 키 발급'&&!el.disabled));assert.deepEqual(await issuer.evaluate(style),reference);
 await issuer.click();assert.equal(await page.locator('#ai-credential-preset').inputValue(),'read');assert.equal(await page.getByLabel('유효 기간',{exact:true}).inputValue(),'1');await screenshot('reference-read-default');
 await page.locator('#ai-credential-preset').selectOption('worker');await page.locator('#ai-credential-preset').selectOption('chat_reply');assert.equal(await page.getByRole('checkbox',{name:'Chat 전송 권한',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('checkbox',{name:'기존 대화 답글',exact:true}).isChecked(),true);assert.equal(await page.getByText('완료 알림',{exact:true}).count(),0);
 await page.getByRole('button',{name:'발급',exact:true}).click();await page.getByText('발급하지 못했습니다. 권한과 선택 항목을 확인하세요.',{exact:true}).waitFor();assert.equal(row.writes.length,0);
 await page.getByRole('checkbox',{name:'경영팀',exact:true}).click();await page.getByRole('checkbox',{name:'관리팀',exact:true}).click();assert.equal(await page.getByRole('group',{name:'전송 공간',exact:true}).getByRole('checkbox',{disabled:true}).count(),0);
 await page.getByLabel('고정 Bridge 소스 ID',{exact:true}).fill('a0800000-0000-4000-8000-000000000001');await screenshot('chat-only-two-rooms');
 await page.getByRole('button',{name:'발급',exact:true}).click();await page.getByRole('textbox',{name:'발급된 AI 요청 키',exact:true}).waitFor();const payload=row.writes[0].input;assert.deepEqual(payload.scopes,['chat:outbox:read','chat:send']);assert.deepEqual(payload.grant,{spaceKeys:['space_1','space_2'],purposes:['bridge_reply'],bridgeSourceId:'a0800000-0000-4000-8000-000000000001'});
 await page.keyboard.press('Escape');await page.getByRole('textbox',{name:'발급된 AI 요청 키',exact:true}).waitFor({state:'detached'});await page.waitForFunction(()=>document.activeElement?.textContent==='AI 요청 키 발급');await screenshot('chat-only-inventory');row.assertions.push('explicit two rooms / unavailable rooms disabled / zero request scopes / bridge_reply only / one-day / Escape focus return');
 await issuer.click();await page.getByLabel('권한',{exact:true}).selectOption('chat_reply');await page.getByLabel('유효 기간',{exact:true}).selectOption('never');
 for(const name of ['조교팀','영어팀','전체 공지','수학팀','과학팀'])await page.getByRole('checkbox',{name,exact:true}).check();
 await page.getByLabel('이름',{exact:true}).fill('합성 무기한 일곱 방');await screenshot('nonexpiring-seven-rooms');
 await page.getByRole('button',{name:'발급',exact:true}).click();await page.getByRole('textbox',{name:'발급된 AI 요청 키',exact:true}).waitFor();
 const unlimited=row.writes.at(-1).input;assert.equal(unlimited.nonExpiring,true);assert.equal(unlimited.expiresAt,null);assert.deepEqual(unlimited.scopes,['chat:outbox:read','chat:send']);assert.equal(unlimited.grant.spaceKeys.length,7);assert.deepEqual(unlimited.grant.purposes,['bridge_reply']);
 await page.keyboard.press('Escape');await page.getByText('합성 무기한 일곱 방',{exact:true}).waitFor();const unlimitedRow=page.getByRole('row').filter({hasText:'합성 무기한 일곱 방'});assert.match(await unlimitedRow.innerText(),/무기한/);assert.match(await unlimitedRow.innerText(),/사용 가능/);await screenshot('nonexpiring-inventory');
 await issuer.click();await page.getByLabel('권한',{exact:true}).selectOption('worker');assert.equal(await page.getByLabel('유효 기간',{exact:true}).inputValue(),'1');assert.equal(await page.locator('#ai-credential-days option[value="never"]').count(),0);await page.keyboard.press('Escape');
 row.assertions.push('explicit non-expiring mode / seven explicit rooms / NULL metadata usable / request preset resets finite TTL');
 uncertain=true;await issuer.click();await page.locator('#ai-credential-preset').selectOption('worker');await page.getByLabel('이름',{exact:true}).fill('합성 요청 처리 결과 확인');await page.getByRole('button',{name:'발급',exact:true}).click();await page.getByText('발급 결과를 확인하지 못했습니다. 같은 발급의 결과를 다시 확인하세요.',{exact:true}).waitFor();const original=structuredClone(row.writes.at(-1));await page.keyboard.press('Escape');await page.getByRole('tab',{name:'연결 키',exact:true}).click();await page.getByRole('tab',{name:'AI 요청 키',exact:true}).click();await page.getByRole('button',{name:'발급 결과 확인',exact:true}).click();await page.getByText('요청 처리 · 직원 전체 요청',{exact:true}).waitFor();assert.equal(await page.locator('#ai-credential-preset').count(),0);await screenshot('immutable-worker-recovery');
 uncertain=false;await page.getByRole('button',{name:'발급 결과 확인',exact:true}).last().click();await page.getByText(/발급 기록을 확인했습니다. 원문 키는 다시 표시할 수 없습니다/).waitFor();assert.deepEqual(row.writes.at(-1),original);assert.equal(await page.getByRole('textbox',{name:'발급된 AI 요청 키',exact:true}).count(),0);row.assertions.push('remounted pending worker displays original permissions and recovers exact request without a second secret');
 assert.deepEqual(row.errors,[]);assert.deepEqual(row.externalBlocked,[]);row.passed=true;
 }catch(error){row.passed=false;row.failure=error.stack;row.body=(await page.locator('body').innerText()).slice(-3000);await page.screenshot({path:out+`failure-${width}-${theme}.png`});}
 console.log(width,theme,row.passed?'PASS':row.failure);await context.close();if(!row.passed)throw new Error('browser case failed');
}}finally{await browser.close();await fs.writeFile(out+'results.json',JSON.stringify({synthetic:true,providerCalls:0,results},null,2));}
assert.equal(results.length,4);assert.ok(results.every(r=>r.passed));
