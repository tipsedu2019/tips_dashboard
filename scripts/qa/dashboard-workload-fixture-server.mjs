// Isolated synthetic transport for the real dashboard. Never forwards data calls.
import http from "node:http"
import { buildWorkloadTeams } from "../../src/features/dashboard/workload-contract.ts"
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
const specifications = [
  [
    "영어팀",
    "teacher-a",
    "합성 영어선생님",
    "registration",
    "consultation_completed",
    "상담 완료 후속 처리",
    8,
    12,
  ],
  [
    "영어팀",
    "teacher-b",
    "합성 긴이름선생님가나다라마바사",
    "makeup",
    "approval_pending",
    "결재 승인",
    3,
    9,
  ],
  [
    "수학팀",
    "teacher-c",
    "합성 수학선생님",
    "transfer",
    "requested",
    "요청 확인",
    4,
    5,
  ],
  [
    "수학팀",
    "teacher-c",
    "합성 수학선생님",
    "withdrawal",
    "in_progress",
    "처리 진행",
    2,
    10,
  ],
  [
    "관리팀",
    "team",
    "팀 공통",
    "registration",
    "enrollment_requested",
    "등록 신청 처리",
    5,
    8,
  ],
  [
    "관리팀",
    "team",
    "팀 공통",
    "registration",
    "waiting_current_class",
    "현재반 대기",
    2,
    15,
  ],
  [
    "관리팀",
    "unassigned",
    "담당 미지정",
    "withdrawal",
    "in_progress",
    "처리 진행",
    1,
    3,
  ],
]
const rows = specifications.flatMap(
  (
    [team, ownerKey, ownerLabel, workflow, stage, stageLabel, total, days],
    index,
  ) =>
    Array.from({ length: total }, (_, i) => ({
      key: `${workflow}:${index}-${i}`,
      team,
      ownerKey,
      ownerLabel,
      workflow,
      stage,
      stageLabel,
      title: `합성 학생 ${index + 1}-${i + 1} · ${i === 0 ? "긴수업명확인용가나다라마바사아자차카타파하" : "확인 수업"}`,
      enteredAt: ago(days),
      requestedAt: ago(days + 4),
      href:
        workflow === "makeup"
          ? "/admin/makeup-requests?requestId=00000000-0000-4000-8000-000000000001"
          : `/admin/${workflow}?taskId=00000000-0000-4000-8000-000000000001`,
    })),
)
let mode = "normal"
const calls = []
function summary() {
  return {
    generatedAt: new Date().toISOString(),
    groups:
      mode === "empty"
        ? []
        : specifications.map(
            ([
              team,
              ownerKey,
              ownerLabel,
              workflow,
              stage,
              stageLabel,
              total,
              days,
            ]) => ({
              team,
              ownerKey,
              ownerLabel,
              workflow,
              stage,
              stageLabel,
              total,
              aged: days + 4 >= 7 ? total : 0,
              oldestAt: ago(days),
              oldestRequestedAt: ago(days + 4),
              elapsedSeconds: (days + 4) * 86400 * total,
            }),
          ),
  }
}
function json(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://127.0.0.1:3230",
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
  if (path === "/__evidence")
    return json(res, {
      mode,
      calls,
      teams: buildWorkloadTeams(summary().groups),
    })
  if (path.endsWith("/user")) return json(res, user)
  if (path.endsWith("/profiles"))
    return json(res, { ...user, role: "admin", name: "합성 관리자" })
  if (path.includes("dashboard_workload")) {
    if (mode === "error")
      return json(res, { message: "Synthetic unavailable" }, 503)
    if (mode === "loading")
      await new Promise((resolve) => setTimeout(resolve, 2500))
    if (path.endsWith("/get_dashboard_workload_v1")) return json(res, summary())
    const selected =
      mode === "empty"
        ? []
        : rows
            .filter(
              (row) =>
                (!args.p_team || row.team === args.p_team) &&
                (!args.p_owner_key || row.ownerKey === args.p_owner_key) &&
                (!args.p_workflow || row.workflow === args.p_workflow) &&
                (!args.p_stage || row.stage === args.p_stage) &&
                (!args.p_aged_only ||
                  Date.parse(row.requestedAt) <= Date.now() - 7 * 86400000),
            )
            .sort(
              (a, b) =>
                a.requestedAt.localeCompare(b.requestedAt) ||
                a.key.localeCompare(b.key),
            )
    return json(res, {
      generatedAt: new Date().toISOString(),
      totalCount: selected.length,
      page: args.p_page,
      pageSize: args.p_page_size,
      rows: selected.slice(
        (args.p_page - 1) * args.p_page_size,
        args.p_page * args.p_page_size,
      ),
    })
  }
  if (path.endsWith("/get_dashboard_daily_brief_v1"))
    return json(res, {
      localDate: new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
      generatedAt: now,
      counts: {
        levelTests: 0,
        visitConsultations: 0,
        observationClasses: 0,
        openTasks: 0,
      },
      upcoming: [],
    })
  return json(res, { message: `Unmocked route ${path}` }, 501)
}
http
  .createServer((req, res) => {
    void api(req, res)
  })
  .listen(3232, "127.0.0.1")
http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1")
    if (url.pathname === "/__fixture") {
      res.writeHead(200, { "Content-Type": "text/html" })
      return res.end(
        `<script>localStorage.setItem('sb-127-auth-token',${JSON.stringify(JSON.stringify(session))});localStorage.setItem('tips-dashboard-v2-theme',${JSON.stringify(url.searchParams.get("theme") === "dark" ? "dark" : "light")});location.replace('/admin/dashboard')</script>`,
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
        port: 3231,
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
      res.end("Start Next on 3231")
    })
    req.pipe(proxy)
  })
  .listen(3230, "127.0.0.1", () =>
    console.log("Synthetic dashboard: http://127.0.0.1:3230/__fixture"),
  )
