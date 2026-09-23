// Synthetic loopback + the named network-none DB only. Own isolated browser.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require=createRequire('/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const out=new URL('../../docs/qa/timetable-presets-20260923/',import.meta.url);
const uid=()=>crypto.randomUUID();
const teacher=uid(),room=uid();
function sql(body){const r=spawnSync('/Users/hyunjun/.local/bin/docker',['exec','-i','tips_timetable_20260923','psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:body,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;}
sql(`insert into public.teacher_catalogs(id,name,subjects) values('${teacher}','전송 검증 교사',array['영어']);insert into public.classroom_catalogs(id,name,subjects) values('${room}','전송 검증실',array['영어']);`);
const browser=await chromium.launch({headless:true}),results=[];const plans=[];
try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:1000},locale:'ko-KR',timezoneId:'Asia/Seoul',reducedMotion:'reduce',extraHTTPHeaders:{'x-timetable-fixture-db':'1'}});
 await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'&&['3260','3262'].includes(u.port)?route.continue():route.abort();});
 await context.routeWebSocket(/.*/,socket=>socket.close());
 const page=await context.newPage();const row={width,errors:[],checks:[]};page.on('pageerror',e=>row.errors.push(e.message));
 const rpc=async(name,args)=>{const res=await context.request.post(`http://127.0.0.1:3262/rest/v1/rpc/${name}`,{data:args});const data=await res.json();assert.ok(res.ok(),JSON.stringify(data));return data;};
 const read=id=>rpc('get_timetable_plan_v1',{p_plan_id:id});
 const source=uid(),target=uid(),copyTarget=uid();plans.push(source,target,copyTarget);const title=`전송 QA ${width} ${source.slice(0,4)}`;
 const create=async(id,name)=>rpc('mutate_timetable_plan_v1',{p_command:{operation:'create',planId:id,name,requestKey:uid()}});
 await create(source,title);await create(target,`${title} 목적지`);await create(copyTarget,`${title} 대안`);
 const ids=[];
 for(let n=0;n<4;n++){
   const id=uid();ids.push(id);const current=await read(source);const start=width===1440?600+n*60:900+n*60;
   const item={id,planId:source,name:`${title} 수업 ${n+1}`,subject:'영어',subjectAreaKey:null,grade:'중2',capacity:12,tuition:100000,defaultTeacherId:teacher,defaultClassroomId:room,durationMinutes:30,pendingSlots:[]};
   const slots=n===3?[]:[{id:uid(),itemId:id,planId:source,weekday:0,startMinute:start,endMinute:start+30,teacherId:teacher,classroomId:room,sourceSlotId:null}];
   await rpc('mutate_timetable_plan_item_v1',{p_command:{operation:'save',planId:source,expectedMetaRevision:current.plan.metaRevision,expectedShadowFingerprint:current.shadowFingerprint,expectedItemRevision:null,item,slots,requestKey:uid()}});
 }
 try{
  await page.goto('http://127.0.0.1:3260/__fixture');await page.getByRole('combobox',{name:'시간표',exact:true}).waitFor();
  await page.getByRole('combobox',{name:'시간표',exact:true}).click();await page.getByRole('option',{name:title,exact:true}).click();
  if(width===390)await page.getByRole('button',{name:'수업 목록',exact:true}).filter({visible:true}).click();
  await page.getByLabel(/이 프리셋 전체 4개/).filter({visible:true}).check();
  if(width===390)await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'선택 이동·복사',exact:true}).click();
  await page.getByRole('button',{name:'선택 수업 다시 검사',exact:true}).click();
  await page.getByText('미배치 슬롯을 모두 해결하세요.',{exact:true}).waitFor();row.checks.push('whole selection blocks zero-slot item');
  await page.getByRole('checkbox',{name:`${title} 수업 4 전송 선택`,exact:true}).click();
  await page.getByRole('button',{name:'선택 수업 다시 검사',exact:true}).click();
  await page.getByRole('button',{name:'확인한 수업 3개 복사',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:new URL(`transfer-${width}-preview.png`,out).pathname});
  // Persisted response loss: real RPC commits, then transport withholds receipt.
  let lost=false;const commands=[];
  await page.route('**/rest/v1/rpc/commit_timetable_plan_transfer_v1',async route=>{
    commands.push(route.request().postDataJSON().p_command);
    const response=await route.fetch();assert.equal(response.status(),200,await response.text());
    if(!lost){lost=true;await route.fulfill({status:503,json:{message:'fixture_response_lost_after_commit'}});}else await route.fulfill({response});
  });
  await page.getByRole('button',{name:'확인한 수업 3개 복사',exact:true}).click();
  await page.getByRole('button',{name:'같은 요청으로 결과 확인',exact:true}).waitFor();
  const persisted=await read(source);assert.equal(persisted.items.filter(i=>i.state==='applied').length,3);
  await page.getByRole('button',{name:'나중에 계속',exact:true}).click();
  await page.getByRole('button',{name:'전송 결과 확인',exact:true}).click();
  // Dirty navigation may confirm continuation while retaining immutable intent.
  const continuation=page.getByRole('button',{name:/계속 이동|계속하기|이동하기/}).filter({visible:true});
  if(await continuation.count())await continuation.first().click();
  await page.getByRole('button',{name:'같은 요청으로 결과 확인',exact:true}).click();
  await page.getByText('반영 완료 · 최신 시간표를 확인했습니다.',{exact:true}).waitFor();
  assert.deepEqual(commands[1],commands[0]);assert.equal(commands.length,2);
  const reread=await read(source);assert.equal(reread.items.filter(i=>i.state==='applied').length,3);assert.equal(reread.slots.length,0);row.checks.push('persisted loss + close/reopen retries exact body/key with three total classes');
  await page.screenshot({path:new URL(`transfer-${width}-complete.png`,out).pathname});
  await page.getByRole('button',{name:'닫기',exact:true}).filter({visible:true}).click();
  await page.getByRole('combobox',{name:'시간표',exact:true}).click();await page.getByRole('option',{name:'운영 시간표',exact:true}).click();
  await page.getByText(`${title} 수업 1`,{exact:true}).filter({visible:true}).first().waitFor();row.checks.push('new active class visible in refreshed actual DB-backed operational reader');
  await page.screenshot({path:new URL(`transfer-${width}-operating.png`,out).pathname});
  // Another preset sees the new operating shadow.
  await page.getByRole('combobox',{name:'시간표',exact:true}).click();await page.getByRole('option',{name:`${title} 대안`,exact:true}).click();
  await page.getByText(`${title} 수업 1`,{exact:true}).filter({visible:true}).first().waitFor();row.checks.push('other preset sees labeled operating shadow');
  assert.equal(row.errors.length,0,JSON.stringify(row.errors));row.passed=true;
 }catch(error){row.failure=error.stack;row.body=(await page.locator('body').innerText()).slice(-12000);await page.screenshot({path:new URL(`transfer-${width}-failure.png`,out).pathname});}
 results.push(row);await context.close();if(!row.passed)break;
}}finally{await browser.close();
 await fs.writeFile(new URL('transfer-browser-results.json',out),JSON.stringify({teacher,room,plans,results},null,2));
 sql(`begin;select set_config('app.class_schedule_mutation','release2-rpc',true);select set_config('app.class_close_mutation','v1',true);update public.classes set status='종강' where id in(select class_id from public.class_schedule_slots where teacher_catalog_id='${teacher}');update public.timetable_plans set state='archived',meta_revision=meta_revision+1,change_sequence=change_sequence+1 where id=any(array[${plans.map(id=>`'${id}'::uuid`).join(',')}]);delete from public.teacher_catalogs where id='${teacher}';delete from public.classroom_catalogs where id='${room}';commit;`);
await fs.writeFile(new URL('transfer-browser-results.json',out),JSON.stringify({teacher,room,plans,results},null,2));}
console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.passed))process.exitCode=1;
