// Isolated synthetic transport for the real dashboard. Never forwards data calls.
import http from "node:http"
import { buildTimetableWorkspaceModel } from "../../src/features/academic/records.js"
import { buildAcademicAnnualBoardModel } from "../../src/features/operations/academic-calendar-models.js"
const now = new Date().toISOString(),
  ago = (days) => new Date(Date.now() - days * 86400000).toISOString()
const user = {
  id: "00000000-0000-4000-8000-000000000099",
  email: "fixture@example.invalid",
  user_metadata: { name: "합성 관리자" },
  app_metadata: {},
  aud: "authenticated",
  created_at: now,
}
const token =
  Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url") +
  "." +
  Buffer.from(
    JSON.stringify({ sub: user.id, exp: 2000000000, role: "authenticated" }),
  ).toString("base64url") +
  ".fixture"
const session = {
  access_token: token,
  refresh_token: "fixture-only",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 2000000000,
  user,
}
const classes = [
  {id:"a",name:"고2 심화수학",subject:"수학",teacher:"김선생",classroom:"본관 1강",schedule:"월수금 15:00-17:00",status:"수강"},
  {id:"b",name:"고1 영어 독해와 문법",subject:"영어",teacher:"이선생",classroom:"별관 2강",schedule:"화목 16:00-18:00",status:"수강"},
  {id:"c",name:"중3 수학",subject:"수학",teacher:"김선생",classroom:"본관 1강",schedule:"화목 18:00-20:00",status:"수강"},
  {id:"d",name:"고2 영어 심화 긴 수업명 확인",subject:"영어",teacher:"이선생",classroom:"별관 2강",schedule:"월수 19:00-21:00",status:"수강"},
  {id:"e",name:"개강 준비 수업",subject:"과학",teacher:"박선생",classroom:"본관 3강",schedule:"토 13:00-15:00",status:"개강 준비"},
  {id:"f",name:"종강 수업",subject:"영어",teacher:"이선생",classroom:"별관 2강",schedule:"금 14:00-16:00",status:"종강"},
];
const teacherCatalogs = [
 {name:"김선생",subjects:"수학팀",sort_order:1},
 {name:"이선생",subjects:"영어팀",sort_order:2},
 {name:"박선생",subjects:"과학팀",sort_order:3},
];
const classroomCatalogs = [];
const schools = [
 {id:"00000000-0000-4000-8000-000000000001",name:"가온고등학교",category:"high"},
 {id:"00000000-0000-4000-8000-000000000002",name:"나래국제융합고등학교",category:"high"},
 {id:"00000000-0000-4000-8000-000000000003",name:"다온중학교",category:"middle"},
];
const events = schools.flatMap((school,si) => [1,2,3].flatMap((grade,gi) => [
 {id:`00000000-0000-4000-8000-${String(si*100+gi*10+10).padStart(12,"0")}`,school_id:school.id,school:school.name,grade:`${school.category==="high"?"고":"중"}${grade}`,type:"시험기간",title:"1학기 중간고사",start:"2026-04-27",end:"2026-04-30",note:'[[TIPS_META]] {"examTerm":"1학기 중간"}'},
 {id:`00000000-0000-4000-8000-${String(si*100+gi*10+11).padStart(12,"0")}`,school_id:school.id,school:school.name,grade:`${school.category==="high"?"고":"중"}${grade}`,type:"영어시험일",title:"영어 시험",start:"2026-04-28",note:'[[TIPS_META]] {"examTerm":"1학기 중간","textbookScopes":[{"name":"영어 독해와 문법","publisher":"합성 출판","scope":"1~3과"}],"subtextbookScopes":[{"name":"학교 프린트","scope":"1~8쪽"}]}'},
 {id:`00000000-0000-4000-8000-${String(si*100+gi*10+12).padStart(12,"0")}`,school_id:school.id,school:school.name,grade:`${school.category==="high"?"고":"중"}${grade}`,type:"수학시험일",title:"수학 시험",start:"2026-04-29",note:'[[TIPS_META]] {"examTerm":"1학기 중간"}'},
 {id:`00000000-0000-4000-8000-${String(si*100+gi*10+13).padStart(12,"0")}`,school_id:school.id,school:school.name,grade:`${school.category==="high"?"고":"중"}${grade}`,type:"체험학습",title:"제주 문화 탐방 및 진로 체험학습",start:"2026-05-11",end:"2026-05-13"},
 {id:`00000000-0000-4000-8000-${String(si*100+gi*10+14).padStart(12,"0")}`,school_id:school.id,school:school.name,grade:`${school.category==="high"?"고":"중"}${grade}`,type:"방학·휴일·기타",title:"여름방학",start:"2026-07-21",end:"2026-08-17"},
]));
const calendarRows = events.map((event,index) => ({
 id:event.id,sourceId:event.id,title:index===0?'가온고등학교 2학기 중간고사 긴 일정 제목과 시험 범위 확인':event.title,
 schoolId:event.school_id,schoolName:event.school,category:schools.find(s=>s.id===event.school_id).category,
 grade:event.grade,typeLabel:event.type,eventType:'event',color:['bg-blue-500','bg-rose-500','bg-amber-500'][index%3],
 startsAt:`2026-09-${String(21+index%5).padStart(2,'0')}`,endsAt:`2026-09-${String(21+index%5+(index%5===0?2:0)).padStart(2,'0')}`,
 notePreview:event.note||'',examTerm:'2학기 중간',
}));
const id = (n) => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n, patch = {}) => ({
  id: id(n), title: `업무 ${n}`, type: 'general', status: 'requested', priority: 'normal', requestedById: null,
  requestedByLabel: '', requestedTeam: '', assigneeId: null, assigneeLabel: '', assigneeTeam: '', secondaryAssigneeId: null,
  secondaryAssigneeLabel: '', studentId: null, studentName: '', classId: null, className: '', textbookId: null, textbookTitle: '',
  campus: '', subject: '', startAt: null, dueAt: null, completedAt: null, completedById: null, completedByLabel: '', memo: '',
  createdAt: '2026-08-31T00:00:00+00:00', updatedAt: '2026-08-31T00:00:00+00:00', summaryFlags: [], ...patch,
});
const strings = (names) => Object.fromEntries(names.split(' ').map((name) => [name, '']));
function operationPatch(type, studentName = '서버 학생') {
  if (type === 'word_retest') return { type, status: 'in_progress', studentName, inlineState: {
    retryOfTaskId: null, retryTaskId: null, teacherId: null, branch: '본관', teacherName: '담당', className: '수업', studentName,
    textbookName: '교재', unit: '1', requestNote: '', testAt: null, expectedRetestAt: null,
    totalQuestionCount: 30, cutoffQuestionCount: 25, firstScore: null, secondScore: null, thirdScore: null, retestStatus: 'in_progress',
  }, displayValues: strings('status testAt expectedRetestAt teacher class student textbook unit note total cutoff score result') };
  if (type === 'withdrawal') return { type, studentName, inlineState: {
    ...strings('teacherName withdrawalSession customerReason teacherOpinion undistributedTextbooks'), withdrawalDate: null,
    completedLessonHours: null, fourWeekLessonHours: null, makeeduWithdrawalDone: false, feeProcessed: false, textbookFeeProcessed: false,
  }, displayValues: strings('status subject teacher className student withdrawalDate withdrawalSession completedLessonHours fourWeekLessonHours progress customerReason teacherOpinion undistributedTextbooks operationsChecklist') };
  return { type, studentName, inlineState: {
    fromClassId: null, toClassId: null, fromClassEndDate: null, toClassStartDate: null,
    ...strings('fromTeacherName toTeacherName fromClassName toClassName fromClassEndSession toClassStartSession transferReason fromUndistributedTextbooks toUndistributedTextbooks'),
    makeeduTransferDone: false, feeProcessed: false, textbookFeeProcessed: false,
  }, displayValues: strings('status subject fromTeacher fromClassName student transferReason fromUndistributedTextbooks fromClassEndDate fromClassEndSession toTeacher toClassName toClassStartDate toClassStartSession toUndistributedTextbooks operationsChecklist') };
}

const makeupRow = (n, patch = {}) => ({ id: id(n), status: 'approval_pending', subject: '영어', approvalGroup: 'english', requesterId: id(801), requesterLabel: '신청자', teacherCatalogId: '', teacherProfileId: id(801), teacherLabel: '교사', classId: '', className: `수업 ${n}`, requestKind: 'makeup_only', reason: '사유', cancelDate: '', makeupStartAt: now, makeupEndAt: '2026-08-31T01:00:00+00:00', makeupClassroom: 'A', makeupSlots: [], approverTeacherCatalogId: '', approverProfileId: id(804), approverLabel: '결재자', returnedReason: '', rejectedReason: '', finalNote: '', approvedBy: '', approvedByLabel: '', approvedAt: '', completedBy: '', completedByLabel: '', completedAt: '', canceledBy: '', canceledByLabel: '', canceledAt: '', schedulePlanBefore: {}, schedulePlanAfter: {}, cancelAcademicEventId: '', makeupAcademicEventId: '', makeupAcademicEventIds: [], createdAt: now, updatedAt: now, events: [], ...patch });
const counts = { mine: 1, approvalPending: 112, makeupPending: 2, refundPending: 1, closed: 3 };
const facets = { subjectOptions: ['영어', '수학', '과학'].map((value, i) => ({ value, label: value, count: i ? 0 : 112 })), teacherOptions: [{ value: 'name:교사', label: '교사', count: 112 }] };

const RULE_REVISION = "9007199254740993"
const TEMPLATE_VERSION = "9007199254740995"
const CONNECTION_REVISION = "9007199254740997"

const VISIT_SCHEDULED_CONTENT_CONTRACT = {
  contractVersion: "1",
  availableVariables: [
    { key: "student_name", token: "학생", piiClass: "student_name" },
    { key: "subjects", token: "과목", piiClass: "none" },
    { key: "after_schedule", token: "새일정", piiClass: "schedule" },
    { key: "after_place", token: "새장소", piiClass: "location" },
    { key: "progress_line", token: "진행정보", piiClass: "none" },
  ],
  requiredTokens: ["학생", "과목", "새일정", "새장소"],
  optionalLineTokens: ["진행정보"],
  mustHaveFacts: ["target", "event", "schedule", "location"],
  supportedPayloadVersions: [2],
  destinationPolicy: {
    allowedConnectionKeys: ["google_chat.management"],
    subjectScoped: false,
  },
  freeTextVisibility: {},
  freeTextPriority: [],
  fieldPresence: {
    student_name: {
      required: true,
      nullBehavior: "reject",
      nullDisplay: null,
      emptyArrayBehavior: "reject",
    },
    subjects: {
      required: true,
      nullBehavior: "reject",
      nullDisplay: null,
      emptyArrayBehavior: "reject",
    },
    after_schedule: {
      required: true,
      nullBehavior: "reject",
      nullDisplay: null,
      emptyArrayBehavior: "reject",
    },
    after_place: {
      required: true,
      nullBehavior: "reject",
      nullDisplay: null,
      emptyArrayBehavior: "reject",
    },
    progress_line: {
      required: false,
      nullBehavior: "omit",
      nullDisplay: null,
      emptyArrayBehavior: "omit",
    },
  },
}

function createWireSnapshot(overrides = {}) {
  return {
    scope_key: "global",
    workflow_key: "registration",
    rules: [
      {
        id: "rule-registration-visit-management",
        workflow_key: "registration",
        event_key: "registration.visit_scheduled",
        channel_key: "google_chat",
        audience_key: "management_team",
        rule_variant_key: "immediate",
        delivery_mode: "immediate",
        schedule_key: null,
        schedule_config: null,
        enabled: false,
        configuration_kind: "fixed_policy_editable_template",
        activation_locked: true,
        content_contract: VISIT_SCHEDULED_CONTENT_CONTRACT,
        template_compliance: {
          contract_version: "1",
          compliance: "conformant",
          violations: [],
        },
        active_template_id: "template-registration-visit-management",
        revision: RULE_REVISION,
        template: {
          id: "template-registration-visit-management",
          rule_id: "rule-registration-visit-management",
          version: TEMPLATE_VERSION,
          title_template: "[방문상담] {student_name}",
          body_template: "[학생] {student_name}\n[과목] {subjects}\n[일정] {after_schedule}\n[장소] {after_place}\n{progress_line}",
          allowed_variables: [
            { key: "student_name", token: "학생", pii_class: "student_name" },
          ],
          payload_schema_version: 2,
          content_contract_version: null,
        },
      },
    ],
    connections: [
      {
        connection_key: "google_chat.management",
        connection_state: "encrypted_active",
        revision: CONNECTION_REVISION,
        webhook_url_mask: "chat.googleapis.com/…/management",
        last_verified_at: "2026-07-16T08:00:00.000Z",
        last_error_code: null,
      },
    ],
    delivery_summary: {
      pending_count: 2,
      sent_count: 11,
      failed_count: 1,
      unknown_count: 0,
      latest_delivery_at: "2026-07-16T08:30:00.000Z",
    },
    ...overrides,
  }
}


let mode = "normal";
const calls = [];
function json(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://127.0.0.1:3270",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  })
  res.end(JSON.stringify(data))
}
async function api(req, res) {
  if (req.method === "OPTIONS") return json(res, {})
  const url = new URL(req.url, "http://127.0.0.1")
  let body = ""
  for await (const chunk of req) body += chunk
  const args = body ? JSON.parse(body) : {}
  const path = url.pathname
  calls.push({ path, args })
  if (path === "/__control") {
    mode = args.mode ?? url.searchParams.get("mode") ?? "normal"
    return json(res, { mode })
  }
  if (path === "/__evidence") return json(res, {mode,calls});
  if (path.endsWith("/user")) return json(res, user);
  if (path.endsWith("/profiles")) return json(res, req.headers.accept?.includes("object") ? {...user,role:"admin",name:"합성 관리자"} : [{...user,role:"admin",name:"합성 관리자"}]);
  if (path.endsWith("/get_academic_timetable_range_v1")) {
    if (mode === "error") return json(res,{message:"합성 조회 오류"},503);
    if (mode === "loading") await new Promise(resolve=>setTimeout(resolve,3000));
    const range = {dateFrom:args.p_date_from,dateTo:args.p_date_to};
    if (mode === "dense") return json(res,{ok:false,code:"visible_range_too_dense",range,rows:[],observedRowsAtLeast:2001,suggestedDays:7});
    const selected = mode === "empty" ? [] : classes.filter(c=>(!args.p_status || c.status===args.p_status) && (!args.p_subject || c.subject===args.p_subject));
    return json(res,{ok:true,complete:true,range,
      rows:buildTimetableWorkspaceModel({classes:selected}).rows,
      classSummaries:classes,classTerms:[],classGroups:[{id:"legacy",name:"2026 1학기",is_default:true}],classGroupMembers:[],
      teacherCatalogs,classroomCatalogs,statusOptions:["수강","개강 준비","종강"],subjectOptions:["영어","수학","과학"]});
  }
  if (path.endsWith("/list_operations_catalogs_v1")) return json(res,{academicSchools:schools});
  if (path.endsWith("/list_active_science_subject_areas_v1")) return json(res,[]);
  if (path.endsWith("/get_operations_annual_board_v1")) {
    if (mode === "error") return json(res,{message:"합성 조회 오류"},503);
    if (mode === "loading") await new Promise(resolve=>setTimeout(resolve,3000));
    const model = buildAcademicAnnualBoardModel({selectedYear:String(args.p_academic_year),academicSchools:schools,academicEvents:mode==="empty"?[]:events});
    return json(res,{ok:true,data:{...model,academicYear:args.p_academic_year}});
  }
  if (path.endsWith("/get_operations_calendar_range_v1")) {
    const range={dateFrom:args.p_date_from,dateTo:args.p_date_to};
    if(mode==='error') return json(res,{message:'Synthetic private timeout'},503);
    if(mode==='loading') await new Promise(resolve=>setTimeout(resolve,1200));
    if(mode==='dense' && (new Date(range.dateTo)-new Date(range.dateFrom))/86400000>6)
      return json(res,{ok:false,code:'visible_range_too_dense',range,rows:[],observedRowsAtLeast:2001,suggestedDays:7});
    return json(res,{ok:true,complete:true,range,rows:mode==='empty'?[]:calendarRows.filter(e=>e.startsAt<=range.dateTo&&e.endsAt>=range.dateFrom)});
  }
  if (path.endsWith("/get_academic_event_detail_v1")) {
    const ce=calendarRows.find(e=>e.id===args.p_event_id);
    if(ce) return json(res,{...ce,note:''});
    const e=events.find(e=>e.id===args.p_event_id);
    return json(res,e?{id:e.id,title:e.title,schoolId:e.school_id,schoolName:e.school,category:schools.find(s=>s.id===e.school_id).category,grade:e.grade,typeLabel:e.type,startsAt:e.start,endsAt:e.end||e.start,note:e.note||""}:null);
  }
  if(path.endsWith('/get_makeup_reservation_context_v1')) return json(res,{reservations:[],activeEventRequestIds:[]});
  if (path.endsWith("/list_ops_task_numbered_page_v1")) {
    if(mode==='error') return json(res,{message:'Synthetic read failure'},503);
    const total=mode==='empty'?0:3, type=args.p_type;
    return json(res,{page:args.p_page,pageSize:args.p_page_size,totalCount:total,rows:Array.from({length:Math.min(args.p_page_size,Math.max(0,total-(args.p_page-1)*args.p_page_size))},(_,i)=>{
      const patch=operationPatch(type,`합성 학생 ${i+1}`);
      const display={status:'접수',student:`합성 학생 ${i+1}`,className:'고등학교 2학년 영어 심화 독해와 문법 긴 수업 이름',fromClassName:'고등학교 2학년 영어 심화 독해와 문법 기존 수업',toClassName:'고등학교 2학년 영어 상위권 독해와 문법 다음 수업',teacher:'합성 선생님',withdrawalDate:'2026. 9. 30.',toClassStartDate:'2026. 10. 1.'};
      for(const key of Object.keys(patch.displayValues)) if(key in display) patch.displayValues[key]=display[key];
      if(type==='withdrawal') Object.assign(patch.inlineState,{teacherName:display.teacher,withdrawalDate:'2026-09-30',withdrawalSession:'4회차',customerReason:'일정 변경으로 인한 합성 퇴원 요청',completedLessonHours:4,fourWeekLessonHours:8});
      if(type==='transfer') Object.assign(patch.inlineState,{fromClassName:display.fromClassName,toClassName:display.toClassName,fromTeacherName:display.teacher,toTeacherName:display.teacher,fromClassEndDate:'2026-09-30',toClassStartDate:'2026-10-01',transferReason:'합성 진도 조정 요청'});
      return row(i+1,{...patch,className:display.className,subject:'영어'});
    })});
  }
  if (path.endsWith('/get_ops_task_list_stats_v1')) return json(res,{total:3,byStatus:{requested:3},byView:{requested:3},metrics:{},facets:{}});
  if (path.endsWith('/list_makeup_numbered_page_v1')) {
    if(mode==='error') return json(res,{message:'Synthetic read failure'},503);
    const total=mode==='empty'?0:3;
    return json(res,{page:args.p_page,pageSize:args.p_page_size,totalCount:total,viewCounts:{...counts,approvalPending:3,mine:3},...facets,rows:Array.from({length:Math.min(args.p_page_size,Math.max(0,total-(args.p_page-1)*args.p_page_size))},(_,i)=>makeupRow(i+1,{className:'고등학교 2학년 영어 독해와 문법 심화 긴 수업 이름',teacherLabel:'합성 선생님',makeupStartAt:'2026-09-25T06:00:00Z',makeupEndAt:'2026-09-25T08:00:00Z'}))});
  }
  if (path==='/api/admin/public-content' && req.method==='GET') return json(res,{entries:mode==='empty'?[]:[{id:id(91),kind:url.searchParams.get('kind')||'teacher',version:1,sortOrder:1,isPublished:false,createdAt:now,updatedAt:now,data:{name:'합성 선생님 긴 소개 제목',subject:'영어',description:'학생의 학습 과정을 함께 확인하는 합성 소개',content:'학습 습관과 수업 변화를 담은 합성 후기'},previewUrls:{}}],totalCount:mode==='empty'?0:1});
  if (path==='/api/admin/recruiting/applications' && req.method==='GET') return json(res,{applications:mode==='empty'?[]:Array.from({length:3},(_,i)=>({id:id(80+i),name:`합성 지원자 ${i+1}`,subject:'영어',phone:'010-0000-0000',createdAt:now,expiresAt:'2026-12-22T00:00:00Z'})),totalCount:mode==='empty'?0:3,retentionLastSucceededAt:now});
  if (path.endsWith('/get_notification_runtime_flags_v1')) return mode==='error'?json(res,{message:'Synthetic unavailable channel'},503):json(res,{flags:{notification_control_plane_settings_ui_enabled:{enabled:true}}});
  if (path==='/api/notifications/control-plane' && req.method==='GET') return json(res,createWireSnapshot());
  if (path==='/api/notifications/mention-settings' && req.method==='GET') return json(res,{settings:[]});
  if (path.endsWith('/common_notification_control_plane_runtime_version')) return json(res,1);
  if (req.method==='GET' && ['/teacher_catalogs','/classroom_catalogs','/academic_schools','/class_schedule_plans','/class_lesson_sessions','/academic_events','/classes','/students','/textbooks'].some(name=>path.endsWith(name))) return json(res,path.endsWith('/teacher_catalogs')?teacherCatalogs:path.endsWith('/academic_schools')?schools:[]);
  return json(res, { message: `Unmocked route ${path}` }, 501)
}
http
  .createServer((req, res) => {
    void api(req, res)
  })
  .listen(3272, "127.0.0.1")
http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1")
    if (url.pathname === "/__fixture") {
      res.writeHead(200, { "Content-Type": "text/html" })
      return res.end(
        `<script>localStorage.setItem('sb-127-auth-token',${JSON.stringify(JSON.stringify(session))});localStorage.setItem('tips-dashboard-v2-theme',${JSON.stringify(url.searchParams.get("theme") === "dark" ? "dark" : "light")});location.replace(${JSON.stringify(url.searchParams.get('view') === 'annual' ? '/admin/academic-calendar/annual-board' : url.searchParams.get('view') === 'timetable' ? '/admin/timetable' : '/admin/academic-calendar?date=2026-09-22')})</script>`,
      )
    }
    if (url.pathname.startsWith("/api/") || ["/__control", "/__evidence"].includes(url.pathname))
      return void api(req, res)
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405)
      return res.end()
    }
    const proxy = http.request(
      {
        hostname: "127.0.0.1",
        port: 3271,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (upstream) => {
        res.writeHead(upstream.statusCode, upstream.headers)
        upstream.pipe(res)
      },
    )
    proxy.on("error", () => {
      res.writeHead(502)
      res.end("Start Next on 3271")
    })
    req.pipe(proxy)
  })
  .listen(3270, "127.0.0.1", () =>
    console.log("Synthetic timetable: http://127.0.0.1:3270/__fixture"),
  )
