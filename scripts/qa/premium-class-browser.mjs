// Actual local management UI; synthetic transport only. Every unknown API or external request is aborted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE || import.meta.url);
const { chromium } = require('playwright');
import { FIXED_NOW, resolveFixtureRequest } from '../../tests/fixtures/premium-dashboard.mjs';
const base='http://127.0.0.1:3216',out='/tmp/tips-premium-dashboard-20260915/classes';
const className='합성긴수업명'.repeat(10),classId='00000000-0000-4000-8000-000000000201';
const student={id:'00000000-0000-4000-8000-000000000001',name:'합성학생01',school:'합성중고등학교',grade:'중3',contact:'01012345678',parentContact:null};
const classRecord={kind:'classes',sortKey:'01',weeklyMinutes:240,fee:100000,teacherName:'월담당, 수담당',id:classId,name:className,status:'수강',subject:'영어',grade:'중3',teacher:'월담당, 수담당',classroom:'본관 1강, 별관 2강',schedule:'월 19:30-21:30 (월담당, 본관 1강)\n수 18:00-20:00 (수담당, 별관 2강)',capacity:20,studentCount:1,updatedAt:FIXED_NOW};
const classDetail={kind:'classes',record:classRecord,registeredStudents:{rows:[student],hasMore:false,nextCursor:null},waitlistedStudents:{rows:[],hasMore:false,nextCursor:null},textbooks:[],groups:[],schedule:{plan:null,slots:[]},formReferences:{teacherCatalogs:[],classroomCatalogs:[],scienceSubjectAreas:[]}};
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),results=[];
for(const width of [1440,390]) for(const theme of ['light']) {
 const context=await browser.newContext({viewport:{width,height:900},locale:'ko-KR',timezoneId:'Asia/Seoul',reducedMotion:'reduce',serviceWorkers:'block'});
 const user={id:'00000000-0000-4000-8000-000000000099',email:'fixture@example.invalid',user_metadata:{name:'합성 관리자'},app_metadata:{},aud:'authenticated',created_at:FIXED_NOW};
 const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,exp:2000000000,role:'authenticated'})).toString('base64url')+'.fixture';
 await context.addInitScript(({user,token,theme})=>{localStorage.setItem('theme',theme);localStorage.setItem('sb-tips-internal-fixture-auth-token',JSON.stringify({access_token:token,refresh_token:'fixture-only',token_type:'bearer',expires_in:3600,expires_at:2000000000,user}));},{user,token,theme});
 const row={width,theme,errors:[],unhandled:[]};
 await context.routeWebSocket(/.*/,socket=>socket.close());
 await context.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.hostname==='tips-internal-fixture.supabase.co'||u.pathname.startsWith('/api/')){let args={};try{args=q.postDataJSON()||{}}catch{};const data=u.pathname.endsWith('/list_management_class_textbook_candidates_v1')?[]:u.pathname.endsWith('/list_management_numbered_page_v1')?{rows:[classRecord],page:1,pageSize:10,totalCount:1}:u.pathname.endsWith('/get_management_detail_v1')?classDetail:u.pathname.endsWith('/profiles')?{id:user.id,role:'admin',name:'합성 관리자',email:user.email}:u.pathname.endsWith('/user')?user:resolveFixtureRequest(u.pathname,args,'A');if(data===undefined){row.unhandled.push(u.pathname);return r.abort()};return r.fulfill({json:data})}if(u.origin!==base)return r.abort();if(!['GET','HEAD'].includes(q.method()))throw Error('Unmocked mutation');return r.continue()});
 const page=await context.newPage();await page.clock.setFixedTime(new Date(FIXED_NOW));page.on('pageerror',e=>row.errors.push(e.message));
 try{
 await page.goto(base+'/admin/classes');const first=page.getByText(className,{exact:true}).filter({visible:true}).first();await first.waitFor({timeout:20000});
 assert.equal(className.length,60);await page.getByText('월 19:30–21:30 (월담당, 본관 1강)',{exact:true}).filter({visible:true}).first().waitFor();await page.getByText('수 18:00–20:00 (수담당, 별관 2강)',{exact:true}).filter({visible:true}).first().waitFor();
 await page.screenshot({path:`${out}/class-list-${width}.png`});await first.click();const dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:/^수업명/}).waitFor();await page.evaluate(()=>document.fonts.ready);
 assert.equal(await dialog.getByRole('textbox',{name:/^수업명/}).inputValue(),className);await page.screenshot({path:`${out}/class-detail-${width}.png`});row.detailOverflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.equal(row.detailOverflow,0);
 const summary=dialog.getByTestId('class-official-summary-bar');assert.ok((await summary.innerText()).includes('월담당'));assert.ok((await summary.innerText()).includes('수담당'));assert.ok((await summary.innerText()).includes('19:30–21:30'));assert.ok((await summary.innerText()).includes('18:00–20:00'));
 const roster=dialog.getByTestId('class-roster-student-row');await roster.scrollIntoViewIfNeeded();await roster.getByText('합성학생01',{exact:true}).waitFor();assert.ok((await roster.innerText()).includes('010-1234-5678'));await page.screenshot({path:`${out}/class-roster-${width}.png`});
 await roster.getByTestId('class-roster-student-name-link').click();await page.getByRole('button',{name:'취소',exact:true}).click();await dialog.getByRole('textbox',{name:/^수업명/}).scrollIntoViewIfNeeded();await dialog.getByRole('textbox',{name:/^수업명/}).waitFor();
 await dialog.getByRole('textbox',{name:/^수업명/}).fill('수정한 합성 수업명');await page.getByRole('button',{name:'수업 상세 닫기',exact:true}).click();await page.getByRole('button',{name:'계속 편집',exact:true}).click();assert.equal(await dialog.getByRole('textbox',{name:/^수업명/}).inputValue(),'수정한 합성 수업명');
 await page.getByRole('button',{name:'수업 상세 닫기',exact:true}).click();await page.getByRole('button',{name:'변경사항 버리기',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.ok(await first.isVisible());
 assert.equal(row.unhandled.length,0,JSON.stringify(row.unhandled));assert.equal(row.errors.length,0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);row.passed=true;
 }catch(e){row.failure=e.message;row.text=(await page.locator('body').innerText()).slice(-18000);await page.screenshot({path:`${out}/failure-${width}.png`})}
 results.push(row);await context.close();console.log(width,theme,row.passed?'pass':row.failure);
}
await browser.close();await fs.writeFile(out+'/results.json',JSON.stringify(results,null,2));assert.ok(results.every(r=>r.passed));
