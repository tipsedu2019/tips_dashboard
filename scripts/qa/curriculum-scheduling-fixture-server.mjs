// Local-only transport for the actual Next UI. No upstream API or write is forwarded.
// Run Next on 3241 with NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3242,
// NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-only, then open http://127.0.0.1:3240/__fixture.
import http from 'node:http';
import { buildSchedulePlanForSave } from '../../src/lib/class-schedule-planner.js';
import { pathToFileURL } from 'node:url';
import { FIXED_NOW, numberedPage, resolveFixtureRequest, studentsFor } from '../../tests/fixtures/premium-dashboard.mjs';

const user = { id: '00000000-0000-4000-8000-000000000099', email: 'fixture@example.invalid', user_metadata: { name: '합성 관리자' }, app_metadata: {}, aud: 'authenticated', created_at: FIXED_NOW };
const token = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: user.id, exp: 2000000000, role: 'authenticated' })).toString('base64url') + '.fixture';
const session = { access_token: token, refresh_token: 'fixture-only', token_type: 'bearer', expires_in: 3600, expires_at: 2000000000, user };
const students = studentsFor('D').map((row, i) => ({ ...row, status: i < 12 ? '재원' : i < 17 ? '대기' : '퇴원', registeredCount: i < 12 ? (i === 0 ? 35 : 2) : 0, waitlistCount: i < 17 ? 1 : 0 }));
const createRecords = () => Array.from({ length: 24 }, (_, i) => ({ kind: 'classes', id: `00000000-0000-4000-8000-${String(i + 201).padStart(12, '0')}`, name: i === 0 ? '고2 영어 심화 독해와 내신 대비' : `합성 수업 ${String(i + 1).padStart(2, '0')}`, sortKey: String(i).padStart(2, '0'), status: '수강', subject: '영어', grade: '중3', teacher: '월담당, 수담당', teacherName: '월담당, 수담당', classroom: '본관 1강, 별관 2강', schedule: '월 19:30-21:30 (월담당, 본관 1강)\n수 18:00-20:00 (수담당, 별관 2강)', capacity: 20, fee: 100000, weeklyMinutes: 240, studentCount: 10, waitlistCount: 2, updatedAt: FIXED_NOW }));
const bookId='00000000-0000-4000-8000-000000000701';
const missingBookId='00000000-0000-4000-8000-000000000702';
const books=[{id:bookId,title:'합성 영어 독해 기본서',subject:'영어',publisher:'합성출판사',category:'독해',subSubject:'독해',status:'active',schoolLevels:['중등'],gradeLevels:['중3']}];
const plan = buildSchedulePlanForSave({className:'고2 영어 심화 독해와 내신 대비',subject:'영어',selectedDays:[1,3],billingPeriods:[{id:'september',month:9,startDate:'2026-09-01',endDate:'2026-09-30',totalSessions:8},{id:'october',month:10,startDate:'2026-10-01',endDate:'2026-10-31',totalSessions:8}],textbooks:[{textbookId:bookId,alias:'보존 교재'}]}, {subject:'영어'});
plan.sessions[0].teacherNote='일정 편집 시 보존할 기존 기록';
const decorate=(row,i)=>({...row,textbookIds:[bookId,missingBookId],textbookUsage:{[bookId]:{title:books[0].title,startDate:'2026-09-01',endDate:'2026-12-31'},[missingBookId]:{title:'목록에서 삭제된 기존 교재',startDate:'2026-09-01',endDate:''}},schedulePlan:i===1?{}:structuredClone(plan)});
let records = createRecords().map(decorate);
const log = [];
let saveAttempts = 0;
let mode = 'normal';
const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'http://127.0.0.1:3240', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS' }); res.end(JSON.stringify(data)); };
export async function api(req, res) {
  if (req.method === 'OPTIONS') return json(res, {});
  const url = new URL(req.url, 'http://127.0.0.1');
  let body = ''; for await (const chunk of req) body += chunk;
  const args = body ? JSON.parse(body) : {};
  log.push({ method: req.method, path: url.pathname, args });
  const path = url.pathname;
  if (path === '/__control') { mode = args.mode || 'normal'; saveAttempts = 0; records = createRecords().map(decorate); return json(res, { mode }); }
  if (path === '/__evidence') return json(res, { mode, saveAttempts, log });
  if (path.endsWith('/user')) return json(res, user);
  if (path.endsWith('/profiles')) return json(res, { ...user, role: mode === 'viewer' ? 'viewer' : 'admin', name: '합성 관리자' });
  if (mode === 'loading' && /list_management_numbered_page_v1/.test(path)) await new Promise(resolve => setTimeout(resolve, 2500));
  if(path.endsWith('/get_academic_curriculum_numbered_page_v2')) {
    if(mode==='read-error') return json(res,{code:'fixture_read_error',message:'합성 조회 실패'},500);
    if(mode==='loading') await new Promise(resolve=>setTimeout(resolve,2500));
    let all=mode==='empty'?[]:records.filter(row=>row.name.includes(args.p_filters.search||''));
    const rows=all.map((row,i)=>({id:row.id,title:row.name,fullTitle:row.name,subject:row.subject,subjectAreaKey:'',grade:row.grade,term:'',teacherNames:['월담당','수담당'],teacherSummary:row.teacher,classroomNames:['본관 1강','별관 2강'],classroomSummary:row.classroom,schedule:row.schedule,status:'수강',statusFilter:'수강',classGroupIds:[],classGroupNames:[],classGroupLabel:'',textbookCount:0,textbookCatalog:[],textbookTitles:[],textbookSummary:'',textbookOverflowCount:0,textbookScopeLabels:[],totalSessions:i===1?0:16,completedSessions:0,updatedSessions:0,delayedSessions:0,plannedSessions:0,progressTargetSessions:0,delayedProgressSessions:0,plannedProgressSessions:0,progressPercent:0,progressTargetPercent:0,lastUpdatedAt:'',stateLabel:i===1?'회차 미생성':i===2?'일정 연장 필요':'일정 편성',latestNoteSummary:'',latestNoteSessionLabel:'',pendingSessionLabels:[],nextSession:i===1||i===2?null:{sessionId:'legacy:future',sessionKey:'legacy:future',sessionOrder:0,label:'2026-09-23',progressStatus:'pending',hasActualContent:false,updatedAt:'',noteSummary:'',dateValue:'2026-09-23',dateLabel:'2026-09-23',periodLabel:'19:30-21:30',scheduleState:'active',scheduleMemo:'',makeupMemo:'',makeupDate:'',hasPlanContent:false,planSummary:'',textbookEntryCount:0,textbookEntries:[]},sessionSummaries:[],searchText:row.name}));
    const counts={all:rows.length,unlinked:0,unscheduled:rows.filter(r=>r.totalSessions===0).length,update:rows.filter(r=>r.stateLabel==='일정 연장 필요').length,done:rows.filter(r=>r.stateLabel==='일정 편성').length};
    const labels={unscheduled:'회차 미생성',update:'일정 연장 필요',done:'일정 편성'};
    const matched=labels[args.p_filters.viewMode]?rows.filter(r=>r.stateLabel===labels[args.p_filters.viewMode]):rows;
    return json(res,{...numberedPage(matched,args),resolvedPeriodId:null,stats:{total:matched.length,managedClassCount:matched.length,totalSessions:matched.reduce((n,r)=>n+r.totalSessions,0),completedSessions:0,pendingSessions:0,linkedTextbooks:0,unlinkedClassCount:0,noScheduleClassCount:counts.unscheduled,updateNeededClassCount:counts.update,completedClassCount:counts.done,viewModeCounts:counts},filterOptions:{periods:[],statuses:['수강','개강 준비','종강'],subjects:['영어'],grades:['중3'],teachers:['월담당','수담당'],classrooms:['본관 1강','별관 2강']}});
  }
  if(path.endsWith('/get_operations_class_lesson_design_detail_v1')) {
    const row=records.find(r=>r.id===args.p_class_id);
    return json(res,{classItem:{...row,className:row.name,teacher:row.teacher,room:row.classroom,scheduleStorageMode:'legacy',scheduleRevision:0,startDate:'2026-09-01',endDate:'2026-10-31',schedulePlan:row.schedulePlan},textbooks:[],teacherCatalogs:[],classroomCatalogs:[]});
  }
  if(path.endsWith('/continuous_class_schedule_runtime_version')) return json(res,1);
  if(path.endsWith('/get_class_schedule_v1')) return json(res,{authoritativeSource:'legacy',runtimeVersion:1,scheduleRevision:0,sessions:[],storageMode:'legacy'});
  if(path.endsWith('/classes') && req.method==='PATCH') {
    saveAttempts++;
    if(mode==='save-error' && saveAttempts===1) return json(res,{code:'fixture_save_error',message:'합성 저장 실패'},500);
    const row=records.find(r=>r.id===url.searchParams.get('id')?.replace('eq.',''));
    if(!row) return json(res,{message:'Unknown synthetic class'},400);
    row.schedulePlan=args.schedule_plan;return json(res,[{id:row.id}]);
  }
  if (path.endsWith('/list_management_numbered_page_v1')) {
    if (mode === 'read-error') return json(res, { code: 'fixture_read_error', message: '합성 조회 실패' }, 500);
    const rows = args.p_kind === 'students' ? students : records;
    const query = args.p_filters?.search || '';
    let matched = mode === 'empty' ? [] : rows.filter(row => row.name.includes(query) && (!args.p_filters?.status || row.status === args.p_filters.status));
    if (args.p_sort?.[0]?.desc) matched = [...matched].reverse();
    return json(res, numberedPage(matched, args));
  }
  if (path.endsWith('/get_management_detail_v1')) {
    if (args.p_kind === 'students') return json(res, { kind: 'students', record: students.find(row => row.id === args.p_id), enrollments: { rows: [], hasMore: false, nextCursor: null }, textbooks: [] });
    return json(res, { kind: 'classes', record: records.find(row => row.id === args.p_id), registeredStudents: { rows: students.slice(0, mode === 'partial' ? 2 : 10), hasMore: mode === 'partial', nextCursor: mode === 'partial' ? { sortValue: students[1].name, id: students[1].id } : null }, waitlistedStudents: { rows: students.slice(10, 12), hasMore: false, nextCursor: null }, textbooks: books, groups: [], schedule: { plan: records.find(row=>row.id===args.p_id)?.schedulePlan, slots: [] }, formReferences: { teacherCatalogs: [], classroomCatalogs: [], scienceSubjectAreas: [] } });
  }
  if (path.endsWith('/list_management_detail_relation_page_v1') && args.p_kind === 'students') {
    const student = students.find(row => row.id === args.p_id);
    const count = student.registeredCount + student.waitlistCount;
    const offset = args.p_cursor_id ? 30 : 0;
    const rows = Array.from({ length: count }, (_, i) => ({ classId: `00000000-0000-4000-8000-${String(i + 201).padStart(12, '0')}`, className: `합성 수업 ${i + 1}`, subject: '영어', teacher: '합성 선생님', schedule: '월 18:00-20:00', status: i < student.registeredCount ? 'enrolled' : 'waitlisted' }));
    return json(res, { page: { rows: rows.slice(offset, offset + 30), hasMore: offset + 30 < count, nextCursor: offset + 30 < count ? { sortValue: FIXED_NOW, id: rows[offset + 29].classId } : null } });
  }
  if (path.endsWith('/list_management_detail_relation_page_v1')) return json(res, { page: { rows: students.slice(2, 10), hasMore: false, nextCursor: null } });
  if (path.endsWith('/students') && req.method === 'GET') {
    const query = (url.searchParams.get('name') || '').replace(/^ilike\.[*%]/, '').replace(/[*%]$/, '');
    return json(res, students.slice(12).filter(row => row.name.includes(query)));
  }
  if (path.endsWith('/list_management_relation_picker_v1')) return json(res, students.slice(12));
  if (path.endsWith('/list_management_class_textbook_candidates_v1')) return json(res, books);
  if (path.endsWith('/registration_runtime_version')) return json(res, 1);
  if (path.endsWith('/classes') && req.method === 'POST') {
    saveAttempts += 1;
    await new Promise(resolve => setTimeout(resolve, 800));
    if (mode === 'save-error' && saveAttempts === 1) return json(res, { code: 'fixture_save_error', message: '저장하지 못했습니다. 다시 시도해 주세요.' }, 500);
    const patch = Array.isArray(args) ? args[0] : args;
    const record = records.find(row => row.id === patch.id);
    if (!record) return json(res, { message: 'Unknown fixture class' }, 400);
    Object.assign(record, patch, {textbookIds:patch.textbook_ids ?? record.textbookIds,textbookUsage:patch.textbook_usage ?? record.textbookUsage});
    return json(res, [record]);
  }
  if (path === '/api/public-classes/cache/invalidate') return json(res, { ok: true });
  if (path.endsWith('/get_management_stats_v1') && args.p_kind === 'students') return json(res, { total: students.filter(row => !args.p_filters?.status || row.status === args.p_filters.status).length });
  if (path.endsWith('/list_management_filter_options_v1')) return json(res, { subjects: ['영어'], grades: ['중3', '고1'], teachers: ['월담당', '수담당'], classrooms: ['본관 1강', '별관 2강'], schools: ['합성중고등학교'] });
  const data = resolveFixtureRequest(path, args, 'D');
  if (data !== undefined) return json(res, data);
  console.error('UNHANDLED', req.method, path);
  return json(res, { code: 'fixture_unhandled', message: `Undefined synthetic transport: ${path}` }, 501);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  http.createServer((req, res) => { void api(req, res); }).listen(3242, '127.0.0.1');
  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/__fixture') {
      const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';
      const target = url.searchParams.get('route') === 'classes' ? '/admin/classes' : '/admin/curriculum';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<script>${url.searchParams.get('fresh') === '1' ? `localStorage.removeItem('tips-management-table:students:v14');` : ''}localStorage.setItem('sb-127-auth-token',${JSON.stringify(JSON.stringify(session))});localStorage.setItem('tips-dashboard-v2-theme',${JSON.stringify(theme)});location.replace(${JSON.stringify(target)})</script>`);
    }
    if (url.pathname.startsWith('/api/') || ['/__control', '/__evidence'].includes(url.pathname)) return void api(req, res);
    if (!['GET', 'HEAD'].includes(req.method) && url.pathname !== '/__nextjs_original-stack-frames') return json(res, { message: 'Unmocked writes blocked' }, 405);
    const proxy = http.request({ hostname: '127.0.0.1', port: 3241, path: req.url, method: req.method, headers: req.headers }, upstream => { res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res); });
    proxy.on('error', () => { res.writeHead(502); res.end('Start local Next on 3241'); }); req.pipe(proxy);
  }).listen(3240, '127.0.0.1', () => console.log('Synthetic UI: http://127.0.0.1:3240/__fixture'));
}
