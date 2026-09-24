// Isolated synthetic transport for the real dashboard. Never forwards data calls.
import http from "node:http"
import { isPlanFixtureRpc, planFixtureRpc, fixtureActors } from "./timetable-plan-rpc-bridge.mjs"
import { buildTimetableWorkspaceModel } from "../../src/features/academic/records.js"
import { buildAcademicAnnualBoardModel } from "../../src/features/operations/academic-calendar-models.js"
const now = new Date().toISOString()
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
function fixtureSession(actor) {
 if (!fixtureActors.includes(actor)) throw Error('Unknown fixture actor');
 const actorUser={...user,id:actor,email:actor===user.id?user.email:'task9-teacher@test.invalid'};
 return {...session,user:actorUser,access_token:token.split('.')[0]+'.'+Buffer.from(JSON.stringify({sub:actor,exp:2000000000,role:'authenticated'})).toString('base64url')+'.fixture'};
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
let mode = "normal";
const calls = [];
function json(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://127.0.0.1:3260",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  })
  res.end(JSON.stringify(data))
}
async function api(req, res) {
  const origin=req.headers.origin;
  if (origin && !['http://127.0.0.1:3260','http://127.0.0.1:3261'].includes(origin)) return json(res,{message:'fixture_origin_denied'},403);
  if (req.method === "OPTIONS") return json(res, {})
  const url = new URL(req.url, "http://127.0.0.1")
  let body = ""
  for await (const chunk of req) body += chunk
  const args = body ? JSON.parse(body) : {}
  const path = url.pathname
  let actor = user.id;
  if(req.headers.authorization) {
    try { actor=JSON.parse(Buffer.from(req.headers.authorization.replace(/^Bearer /,'').split('.')[1],'base64url').toString()).sub; }
    catch { return json(res,{message:'fixture_actor_denied'},403); }
    if(!fixtureActors.includes(actor)) return json(res,{message:'fixture_actor_denied'},403);
  }
  const activeUser=fixtureSession(actor).user;
  calls.push({ path, args })
  const rpcName=path.startsWith('/rest/v1/rpc/')?path.slice('/rest/v1/rpc/'.length):'';
  if(isPlanFixtureRpc(rpcName) && (rpcName !== 'get_academic_timetable_range_v1' || req.headers['x-timetable-fixture-db'] === '1')) {
    try { const result=await planFixtureRpc(rpcName,args,actor);return json(res,result.error||result.data,result.error?400:200); }
    catch { return json(res,{message:'fixture_database_unavailable'},503); }
  }
  if (path === "/api/public-classes/cache/invalidate") return json(res,{ok:true,synthetic:true});
  if (path === "/__control") {
    mode = args.mode ?? url.searchParams.get("mode") ?? "normal"
    return json(res, { mode })
  }
  if (path === "/__evidence") return json(res, {mode,calls});
  if (path.endsWith("/logout")) return json(res, {});
  if (path.endsWith("/user")) return json(res, activeUser);
  if (path.endsWith("/profiles")) return json(res, {...activeUser,role:actor===user.id?"admin":"teacher",name:actor===user.id?"합성 관리자":"Task9 교사",teacher_catalog_id:actor===user.id?null:"af249000-0000-4000-8000-000000000101"});
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
  if (path.endsWith("/get_academic_event_detail_v1")) {
    const e=events.find(e=>e.id===args.p_event_id);
    return json(res,e?{id:e.id,title:e.title,schoolId:e.school_id,schoolName:e.school,category:schools.find(s=>s.id===e.school_id).category,grade:e.grade,typeLabel:e.type,startsAt:e.start,endsAt:e.end||e.start,note:e.note||""}:null);
  }
  return json(res, { message: `Unmocked route ${path}` }, 501)
}
http
  .createServer((req, res) => {
    void api(req, res)
  })
  .listen(3262, "127.0.0.1")
http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1")
    if (url.pathname === "/__fixture") {
      res.writeHead(200, { "Content-Type": "text/html" })
      return res.end(
        `<script>localStorage.setItem('sb-127-auth-token',${JSON.stringify(JSON.stringify(fixtureSession(url.searchParams.get('actor')==='teacher'?fixtureActors[1]:fixtureActors[0])))});localStorage.setItem('tips-dashboard-v2-theme',${JSON.stringify(url.searchParams.get("theme") === "dark" ? "dark" : "light")});location.replace(${JSON.stringify(url.searchParams.get('view') === 'annual' ? '/admin/academic-calendar/annual-board' : '/admin/timetable')})</script>`,
      )
    }
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/__"))
      return void api(req, res)
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405)
      return res.end()
    }
    const proxy = http.request(
      {
        hostname: "127.0.0.1",
        port: 3261,
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
      res.end("Start Next on 3261")
    })
    req.pipe(proxy)
  })
  .listen(3260, "127.0.0.1", () =>
    console.log("Synthetic timetable: http://127.0.0.1:3260/__fixture"),
  )
