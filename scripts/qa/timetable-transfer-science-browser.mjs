// Synthetic network-none DB only: science metadata correction from preview.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire('/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright'),id=()=>crypto.randomUUID();
const teacher=id(),room=id(),plan=id(),item=id(),slot=id(),name=`과학 전송 QA ${plan.slice(0,6)}`;
let areaKey,areaWasActive=false;
const out=new URL('../../docs/qa/timetable-presets-20260923/',import.meta.url),evidence={plan,checks:[],errors:[]};
function sql(body){const r=spawnSync('/Users/hyunjun/.local/bin/docker',['exec','-i','tips_timetable_20260923','psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:body,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ko-KR',timezoneId:'Asia/Seoul',extraHTTPHeaders:{'x-timetable-fixture-db':'1'}});
await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'&&['3260','3262'].includes(u.port)?route.continue():route.abort();});await context.routeWebSocket(/.*/,socket=>socket.close());
const page=await context.newPage();page.on('pageerror',e=>evidence.errors.push(e.message));
const rpc=async(name,args)=>{const response=await context.request.post(`http://127.0.0.1:3262/rest/v1/rpc/${name}`,{data:args});const data=await response.json();assert.ok(response.ok(),JSON.stringify(data));return data;};
const read=()=>rpc('get_timetable_plan_v1',{p_plan_id:plan});let created=false;
try{
 let catalog=JSON.parse(sql("select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.academic_subject_areas a;"));
 if(!catalog.length){
  const foundation=await fs.readFile(new URL('../../supabase/migrations/20260722090000_academic_subject_foundation.sql',import.meta.url),'utf8');
  const settings=foundation.match(/insert into public\.academic_subject_settings\([\s\S]*?;/)[0].replace(/on conflict[\s\S]*;/, 'on conflict (subject) do nothing;');sql(settings);
  const seed=foundation.match(/insert into public\.academic_subject_areas\([\s\S]*?;/)[0];sql(seed);
  catalog=JSON.parse(sql("select jsonb_agg(to_jsonb(a)) from public.academic_subject_areas a;"));
  // No catalog existed before this dedicated fixture seed. Leave it inactive afterwards.
  sql("update public.academic_subject_areas set is_active=false;");catalog=catalog.map(row=>({...row,is_active:false}));
 }
 areaKey=catalog[0].area_key;areaWasActive=catalog[0].is_active;
 sql(`update public.academic_subject_areas set is_active=true where subject='과학' and area_key='${areaKey}';insert into public.teacher_catalogs(id,name,subjects) values('${teacher}','${name} 교사',array['과학']);insert into public.classroom_catalogs(id,name,subjects) values('${room}','${name} 강의실',array['과학']);`);
 const areas=await rpc('list_active_science_subject_areas_v1',{});assert.ok(areas.length);const area=areas.find(row=>row.area_key===areaKey);assert.ok(area);assert.equal(area.is_active,true);
 await rpc('mutate_timetable_plan_v1',{p_command:{operation:'create',planId:plan,name,requestKey:id()}});created=true;
 const before=await read();await rpc('mutate_timetable_plan_item_v1',{p_command:{operation:'save',planId:plan,expectedMetaRevision:0,expectedShadowFingerprint:before.shadowFingerprint,expectedItemRevision:null,requestKey:id(),item:{id:item,planId:plan,name,subject:'과학',subjectAreaKey:null,grade:'고1',capacity:12,tuition:100000,defaultTeacherId:teacher,defaultClassroomId:room,durationMinutes:30,pendingSlots:[]},slots:[{id:slot,itemId:item,planId:plan,weekday:1,startMinute:1033,endMinute:1063,teacherId:teacher,classroomId:room,sourceSlotId:null}]}});
 await page.goto('http://127.0.0.1:3260/__fixture');await page.getByRole('combobox',{name:'시간표',exact:true}).click();await page.getByRole('option',{name,exact:true}).click();
 await page.getByRole('checkbox',{name:`${name} 선택`,exact:true}).check();await page.getByRole('button',{name:'선택 이동·복사',exact:true}).click();await page.getByRole('button',{name:'선택 수업 다시 검사',exact:true}).click();
 await page.getByText('수업 기본정보 또는 배치 개수를 확인하세요.',{exact:true}).waitFor();evidence.checks.push('new fully placed science/high1 draft with null area is blocked by actual preview');
 await page.getByRole('button',{name:'수업 정보 수정',exact:true}).click();const editor=page.getByRole('dialog',{name:'수업 전체 편집',exact:true});await editor.waitFor();
 await editor.getByRole('combobox',{name:'과학 영역',exact:true}).click();await page.getByRole('option',{name:area.label,exact:true}).click();
 await page.screenshot({path:new URL('transfer-science-correction.png',out).pathname});
 await editor.getByRole('button',{name:'저장',exact:true}).click();await editor.waitFor({state:'hidden'});
 const dialog=page.getByRole('dialog',{name:'선택 수업 이동·복사',exact:true});await dialog.waitFor();assert.equal(await dialog.getByRole('button',{name:'확인한 수업 1개 복사',exact:true}).count(),0);
 const corrected=await read();assert.equal(corrected.items[0].subjectAreaKey,area.area_key);assert.equal(corrected.slots[0].id,slot);assert.equal(corrected.slots[0].startMinute,1033);assert.equal(corrected.slots[0].endMinute,1063);
 evidence.checks.push('affected preview row opens existing editor using active catalog options; ordinary item save preserves placement and resets preview');
 const response=page.waitForResponse(r=>r.url().endsWith('/rpc/preview_timetable_plan_transfer_v1'));await page.getByRole('button',{name:'선택 수업 다시 검사',exact:true}).click();assert.deepEqual((await (await response).json()).blockers,[]);
 const commands=[];let lost=false;await context.route('**/rpc/commit_timetable_plan_transfer_v1',async route=>{commands.push(route.request().postDataJSON());if(!lost){lost=true;await route.fetch();await route.fulfill({status:503,contentType:'application/json',body:'{"message":"synthetic_response_loss"}'});}else await route.continue();});
 await page.getByRole('button',{name:'확인한 수업 1개 복사',exact:true}).click();await page.getByRole('button',{name:'같은 요청으로 결과 확인',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'수업 정보 수정',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'같은 요청으로 결과 확인',exact:true}).click();await page.getByText('반영 완료 · 최신 시간표를 확인했습니다.',{exact:true}).waitFor();assert.deepEqual(commands[1],commands[0]);
 const final=await read();assert.equal(final.items[0].state,'applied');assert.equal(final.items[0].subjectAreaKey,area.area_key);
 const c=JSON.parse(sql(`select to_jsonb(c)::text from public.classes c where id='${final.items[0].appliedClassId}';`));assert.equal(c.subject_area_key,area.area_key);assert.equal(c.status,'수강');assert.equal(sql(`select count(*) from public.classes where name='${name}';`),'1');
 evidence.checks.push('fresh preview promotes science with the chosen DB key; unknown commit disables metadata edits and retries identical command once');
 await page.screenshot({path:new URL('transfer-science-complete.png',out).pathname});assert.deepEqual(evidence.errors,[]);evidence.passed=true;
}finally{
 await fs.writeFile(new URL('transfer-science-results.json',out),JSON.stringify(evidence,null,2));
 if(created){const snap=await read();await rpc('mutate_timetable_plan_v1',{p_command:{operation:'archive',planId:plan,expectedMetaRevision:snap.plan.metaRevision,requestKey:id()}});}
 sql(`begin;select set_config('app.class_close_mutation','v1',true);select set_config('app.class_schedule_mutation','release2-rpc',true);update public.classes set status='종강' where name='${name}';delete from public.teacher_catalogs where id='${teacher}';delete from public.classroom_catalogs where id='${room}';update public.academic_subject_areas set is_active=${areaWasActive} where subject='과학' and area_key='${areaKey}';commit;`);
}
await context.close();await browser.close();
console.log(JSON.stringify(evidence,null,2));
