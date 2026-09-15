import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { FIXED_NOW, resolveFixtureRequest } from '../../tests/fixtures/premium-dashboard.mjs';
const base=process.env.PREMIUM_BASE_URL||'http://127.0.0.1:3215',out='/tmp/tips-premium-dashboard-20260915/settings';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const id='ab000000-0000-4000-8000-000000000001',groupId='ab000000-0000-4000-8000-000000000002';
const academicRow = {
  id, title: '합성 커리큘럼', fullTitle: '합성 커리큘럼', subject: '수학', subjectAreaKey: '', grade: '고1', term: '',
  teacherNames: ['', '교사', '교사'], teacherSummary: '교사', classroomNames: [''], classroomSummary: '', schedule: '',
  status: '수강', statusFilter: '수강', classGroupIds: [groupId], classGroupNames: ['동일', '동일'], classGroupLabel: '동일',
  textbookCount: 0, textbookCatalog: [], textbookTitles: [], textbookSummary: '교재 미연결', textbookOverflowCount: 0, textbookScopeLabels: [],
  totalSessions: 0, completedSessions: 0, updatedSessions: 0, delayedSessions: 0, plannedSessions: 0, progressTargetSessions: 0,
  delayedProgressSessions: 0, plannedProgressSessions: 0, progressPercent: 0, progressTargetPercent: 0,
  lastUpdatedAt: '2026-08-31 10:00:00+09', stateLabel: '교재 미연결', latestNoteSummary: '', latestNoteSessionLabel: '',
  pendingSessionLabels: [], nextSession: null, sessionSummaries: [], searchText: '수업 10',
};
const stats={total:1,managedClassCount:1,totalSessions:0,completedSessions:0,pendingSessions:0,linkedTextbooks:0,unlinkedClassCount:1,noScheduleClassCount:1,updateNeededClassCount:0,completedClassCount:0,viewModeCounts:{all:1,unlinked:1,unscheduled:1,update:0,done:0}};
const options={periods:[],statuses:['수강'],subjects:['수학'],grades:['고1'],teachers:['교사'],classrooms:[]};
function adapter(path,args,url){
 if(path==='/api/admin/google-chat-identities')return {identities:[],directory:{status:'not_configured',configured:false},editable:false};
 if(path.endsWith('/academic_schools'))return [{id,name:'합성학교',category:'중등',color:'#64748b',sort_order:1}];
 if(path.endsWith('/classroom_catalogs'))return [{id,name:'합성강의실',subjects:['영어'],campus:'본관',is_visible:true,sort_order:1}];
 if(path.endsWith('/class_schedule_sync_groups'))return [{id,name:'합성그룹',subject:'영어',sort_order:1,is_default:false}];
 if(path.endsWith('/teacher_catalogs'))return [{id,name:'합성선생님',subjects:['영어'],is_visible:true,sort_order:1,profile_id:null,account_email:null,dashboard_role:'teacher'}];
 if(path.endsWith('/dashboard_audit_logs'))return [];
 if(path.endsWith('/profiles')&&!url.searchParams.has('id'))return [];
 if(path.endsWith('/list_registration_subject_capabilities_v1'))return ['영어','수학','과학'].map((subject,i)=>({subject,is_active:true,registration_create_enabled:true,grade_levels:subject==='과학'?['고1']:['중3','고1'],default_director_profile_id:null,sort_order:i,created_at:FIXED_NOW,updated_at:FIXED_NOW}));
 if(path.endsWith('/list_textbook_publisher_page_v1'))return {rows:[{id,name:'합성출판사',subjects:['영어'],suppliers:[],textbookCount:0,isNew:false}],page:args.p_page,pageSize:args.p_page_size,totalCount:1,baseRevision:'a'.repeat(64),ownerCounts:{publishers:1,suppliers:1}};
 if(path.endsWith('/list_textbook_supplier_page_v1'))return {rows:[{id,name:'합성공급처',contact:'01000000000',memo:'합성 검수용',linkedPublisherCount:0,linkedPublisherNames:[],isNew:false}],page:args.p_page,pageSize:args.p_page_size,totalCount:1,baseRevision:'a'.repeat(64),ownerCounts:{publishers:1,suppliers:1}};
 if(path.endsWith('/get_operations_class_lesson_design_detail_v1'))return {classItem:{id,name:'합성 수업설계',className:'합성 수업설계',subject:'수학',grade:'고1',teacher:'합성선생님',schedule:'월 19:30-21:30',room:'본관1강',status:'수강',termId:null,termName:null,startDate:'2026-09-01',endDate:'2026-09-30',textbookIds:[],schedulePlan:{},scheduleStorageMode:'legacy',scheduleRevision:0},textbooks:[],teacherCatalogs:[],classroomCatalogs:[]};
 if(path.endsWith('/get_operations_lesson_textbook_candidate_page_v1'))return {rows:[],hasMore:false,nextCursor:null};
 if(path.endsWith('/get_notification_runtime_flags_v1'))return {flags:{notification_control_plane_settings_ui_enabled:{enabled:false}}};
 if(path.endsWith('/common_notification_control_plane_runtime_version'))return 1;
 if(path.endsWith('/continuous_class_schedule_runtime_version'))return 1;
 if(path.endsWith('/get_class_schedule_v1'))return {classId:id,sessions:[]};
 if(path.endsWith('/get_academic_curriculum_numbered_page_v1'))return {rows:[academicRow],page:args.p_page,pageSize:args.p_page_size,totalCount:1,stats:args.p_include_scope_metadata?stats:null,filterOptions:args.p_include_scope_metadata?options:null,resolvedPeriodId:null};
 if(path.endsWith('/get_operations_class_schedule_numbered_page_v1'))return {rows:[{id,name:'합성 수업설계',subject:'수학',grade:'고1',schedule:'월 19:30-21:30',termId:null,teacherName:'합성선생님',termName:null,syncGroupId:null,syncGroupName:null,status:'수강',updatedAt:FIXED_NOW}],page:args.p_page,pageSize:args.p_page_size,totalCount:1,stats:{total:1,active:1,draft:0},filterOptions:{terms:[],subjects:['수학'],grades:['고1'],teachers:['합성선생님'],syncGroups:[]},syncGroupCounts:[]};
 return undefined;
}
const routes=[['settings/schools','합성학교','학교 추가'],['settings/classrooms','합성강의실','강의실 추가'],['settings/class-groups','합성그룹','그룹 추가'],['settings/teachers','합성선생님','선생님 추가'],['settings/subjects','영어',''],['settings/textbook-suppliers','합성공급처',''],['settings/notifications','Google Chat 알림 설정이 아직 준비되지 않았습니다',''],['curriculum','합성 커리큘럼',''],['curriculum/lesson-design','합성 수업설계','']];
await fs.mkdir(out,{recursive:true});const browser=await chromium.launch({headless:true}),results=[];
for(const width of [1440,390])for(const [name,expected,action] of routes){
 const context=await browser.newContext({viewport:{width,height:900},locale:'ko-KR',timezoneId:'Asia/Seoul',reducedMotion:'reduce',serviceWorkers:'block'});
 const user={id:'00000000-0000-4000-8000-000000000099',email:'fixture@example.invalid',user_metadata:{name:'합성 관리자'},app_metadata:{},aud:'authenticated',created_at:FIXED_NOW};
 const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,exp:2000000000,role:'authenticated'})).toString('base64url')+'.fixture';
 await context.addInitScript(({user,token})=>{localStorage.setItem('theme','light');localStorage.setItem('sb-tips-internal-fixture-auth-token',JSON.stringify({access_token:token,refresh_token:'fixture-only',token_type:'bearer',expires_in:3600,expires_at:2000000000,user}));},{user,token});
 const row={route:'/admin/'+name,width,errors:[],unhandled:[],requests:[]};await context.routeWebSocket(/.*/,socket=>socket.close());
 await context.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.hostname==='tips-internal-fixture.supabase.co'||u.pathname.startsWith('/api/')){let args={};try{args=q.postDataJSON()||{}}catch{};row.requests.push(u.pathname);let data=adapter(u.pathname,args,u);if(data===undefined)data=u.pathname.endsWith('/profiles')?{id:user.id,role:'admin',name:'합성 관리자',email:user.email}:u.pathname.endsWith('/user')?user:resolveFixtureRequest(u.pathname,args,'A');if(data===undefined){row.unhandled.push(u.pathname);return r.abort()};return r.fulfill({json:data})}if(u.origin!==base)return r.abort();if(!['GET','HEAD'].includes(q.method()))throw Error('Unmocked mutation');return r.continue()});
 const page=await context.newPage();await page.clock.setFixedTime(new Date(FIXED_NOW));page.on('pageerror',e=>row.errors.push(e.message));
 try{await page.goto(base+row.route+(name==='curriculum/lesson-design'?'?classId='+id:''));if(name==='settings/textbook-suppliers'){await page.waitForFunction(()=>[...document.querySelectorAll('input')].some(i=>i.value==='합성출판사')||document.body.innerText.includes('합성출판사'));await page.getByRole('tab',{name:/총판/}).click()}await page.waitForFunction(expected=>document.body.innerText.includes(expected)||[...document.querySelectorAll('input')].some(i=>i.value===expected),expected,{timeout:12000});await page.evaluate(()=>document.fonts.ready);
 row.text=(await page.locator('body').innerText()).slice(-14000);row.inputs=await page.locator('input').evaluateAll(xs=>xs.map(x=>x.value));
 if(action){const button=page.getByRole('button',{name:action,exact:true}).filter({visible:true}).first();assert.ok(await button.isEnabled());await button.focus();row.primaryAction=action;row.focused=await button.evaluate(el=>el===document.activeElement);assert.ok(row.focused)}
 row.overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));assert.equal(row.overflow,0);assert.equal(row.errors.length,0);assert.equal(row.unhandled.length,0,JSON.stringify(row.unhandled));row.passed=true;
 }catch(e){row.failure=e.message;row.text=(await page.locator('body').innerText()).slice(-14000)}
 await page.screenshot({path:out+'/'+name.replaceAll('/','-')+'-'+width+'.png'});results.push(row);console.log(name,width,row.passed?'pass':row.failure);await context.close();
}
await browser.close();await fs.writeFile(out+'/results.json',JSON.stringify(results,null,2));assert.ok(results.every(r=>r.passed));
