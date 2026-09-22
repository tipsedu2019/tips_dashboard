// Isolated synthetic transport for the real dashboard. Never forwards data calls.
import http from "node:http"
import { buildTimetableWorkspaceModel } from "../../src/features/academic/records.js"
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
let mode = "normal";
const calls = [];
function json(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://127.0.0.1:3250",
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
  if (path.endsWith("/profiles")) return json(res, {...user,role:"admin",name:"합성 관리자"});
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
  return json(res, { message: `Unmocked route ${path}` }, 501)
}
http
  .createServer((req, res) => {
    void api(req, res)
  })
  .listen(3252, "127.0.0.1")
http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1")
    if (url.pathname === "/__fixture") {
      res.writeHead(200, { "Content-Type": "text/html" })
      return res.end(
        `<script>localStorage.setItem('sb-127-auth-token',${JSON.stringify(JSON.stringify(session))});localStorage.setItem('tips-dashboard-v2-theme',${JSON.stringify(url.searchParams.get("theme") === "dark" ? "dark" : "light")});location.replace('/admin/timetable')</script>`,
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
        port: 3251,
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
      res.end("Start Next on 3251")
    })
    req.pipe(proxy)
  })
  .listen(3250, "127.0.0.1", () =>
    console.log("Synthetic timetable: http://127.0.0.1:3250/__fixture"),
  )
