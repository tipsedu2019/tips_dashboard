import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const ENABLED = process.env.OPS_BROWSER_WORKFLOW === "1"
const DEFAULT_BASE_URL = "http://localhost:3000"
const DEFAULT_LOGIN_EMAIL_DOMAIN = "tipsedu.co.kr"
const SAMPLE_TAG = "codex-sample-workflow:"
const UI_SAMPLE_PREFIX = "Codex UI 점검"
const UI_COMPLETION_PREFIX = "Codex 완료검증"
const UI_REGISTRATION_PREFIX = "Codex 등록검증"
const TEMP_USER_PREFIX = "codex-browser-verifier"
const DEFAULT_QUICK_ADD_SAMPLE_COUNT = 1
const DEFAULT_OPERATION_SAMPLE_COUNT = 1
const MAX_INITIAL_TEMPLATE_CONTROLS = 22
const MAX_INITIAL_SELECT_OPTIONS = 16
const SIGN_IN_EXPECTED_TEXTS = ["TIPS 로그인", "아이디", "비밀번호"]
const SUBJECT_TRACK_SAMPLES = [
  {
    name: "same-day dual level test",
    tracks: [
      { id: "english", subject: "영어", status: "level_test_scheduled" },
      { id: "math", subject: "수학", status: "level_test_scheduled" },
    ],
    appointments: [{ id: "level-test-1", trackIds: ["english", "math"], startsAt: "2026-07-14T10:00:00+09:00" }],
  },
  {
    name: "split visit and phone consultation",
    tracks: [
      { id: "english", subject: "영어", status: "visit_consultation_scheduled" },
      { id: "math", subject: "수학", status: "consultation_waiting" },
    ],
  },
  {
    name: "partial registration with later batch",
    tracks: [
      { id: "english", subject: "영어", status: "registered" },
      { id: "math", subject: "수학", status: "enrollment_processing" },
    ],
    batches: [
      { id: "batch-1", revision: 1, status: "completed", trackIds: ["english"] },
      { id: "batch-2", revision: 2, status: "open", trackIds: ["math"] },
    ],
  },
  {
    name: "multiple English classes",
    tracks: [{ id: "english", subject: "영어", status: "enrollment_processing" }],
    enrollments: [
      { trackId: "english", classId: "eng-a" },
      { trackId: "english", classId: "eng-special" },
    ],
  },
]

function getSubjectTrackTabCounts(tracks) {
  const counts = { inquiry: 0, level_test: 0, consulting: 0, waiting: 0, enrollment: 0, closed: 0 }
  for (const track of tracks) {
    const status = String(track.status || "")
    const tab = status === "inquiry" || status === "migration_review"
      ? "inquiry"
      : status.startsWith("level_test_")
        ? "level_test"
        : status.startsWith("consultation_") || status.startsWith("visit_consultation_")
          ? "consulting"
          : status === "waiting"
            ? "waiting"
            : status === "enrollment_decided" || status === "enrollment_processing"
              ? "enrollment"
              : "closed"
    counts[tab] += 1
  }
  return counts
}

function verifySubjectTrackSamples() {
  const byName = Object.fromEntries(SUBJECT_TRACK_SAMPLES.map((sample) => [sample.name, sample]))
  const dual = byName["same-day dual level test"]
  const split = byName["split visit and phone consultation"]
  const partial = byName["partial registration with later batch"]
  const multiple = byName["multiple English classes"]
  const transitioned = dual.tracks.map((track) => track.id === "english" ? { ...track, status: "consultation_waiting" } : track)
  const tabCounts = getSubjectTrackTabCounts(dual.tracks)

  if (tabCounts.level_test !== 2) throw new Error("dual level-test tabs were not counted per subject")
  if (dual.appointments[0].trackIds.join(",") !== "english,math") throw new Error("dual level-test fixture is not shared")
  if (transitioned[0].status !== "consultation_waiting" || transitioned[1].status !== "level_test_scheduled") {
    throw new Error("subject transition leaked to a sibling")
  }
  if (split.tracks.map((track) => track.status).join(",") !== "visit_consultation_scheduled,consultation_waiting") {
    throw new Error("split consultation fixture changed modes")
  }
  if (partial.batches.map((batch) => batch.revision).join(",") !== "1,2") throw new Error("batch revisions are not fresh")
  if (multiple.enrollments.length !== 2) throw new Error("multiple English enrollment rows are missing")

  const result = { subjectTrackSamples: SUBJECT_TRACK_SAMPLES.length, network: false }
  console.log(JSON.stringify(result))
  return result
}
function buildAdminPublicSmokeRoute(path, name, expectedSearchIncludes) {
  return {
    path,
    name,
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes,
  }
}

const CORE_ADMIN_PUBLIC_SMOKE_ROUTES = [
  {
    path: "/admin/dashboard",
    name: "protected-dashboard-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Fdashboard",
  },
  {
    path: "/admin/tasks?taskId=missing-task-for-smoke",
    name: "protected-tasks-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Ftasks%3FtaskId%3Dmissing-task-for-smoke",
  },
  {
    path: "/admin/approvals",
    name: "protected-approvals-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Fapprovals",
  },
  {
    path: "/admin/registration",
    name: "protected-registration-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Fregistration",
  },
  {
    path: "/admin/transfer",
    name: "protected-transfer-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Ftransfer",
  },
  {
    path: "/admin/withdrawal",
    name: "protected-withdrawal-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Fwithdrawal",
  },
  {
    path: "/admin/students",
    name: "protected-students-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Fstudents",
  },
  {
    path: "/admin/classes",
    name: "protected-classes-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Fclasses",
  },
  {
    path: "/admin/textbooks",
    name: "protected-textbooks-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Ftextbooks",
  },
  {
    path: "/admin/curriculum",
    name: "protected-curriculum-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Fcurriculum",
  },
  {
    path: "/admin/class-schedule/lesson-design",
    name: "protected-lesson-design-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Fclass-schedule%2Flesson-design",
  },
  {
    path: "/admin/timetable",
    name: "protected-timetable-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Ftimetable",
  },
  {
    path: "/admin/academic-calendar",
    name: "protected-academic-calendar-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Facademic-calendar",
  },
  {
    path: "/admin/academic-calendar/annual-board",
    name: "protected-annual-board-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Facademic-calendar%2Fannual-board",
  },
  {
    path: "/admin/settings/schools",
    name: "protected-settings-schools-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Fsettings%2Fschools",
  },
]

const ADMIN_ALIAS_PUBLIC_SMOKE_ROUTES = [
  buildAdminPublicSmokeRoute("/admin", "admin-root-redirect", "next=%2Fadmin"),
  buildAdminPublicSmokeRoute("/admin/calendar", "admin-calendar-alias-redirect", "next=%2Fadmin%2Fcalendar"),
  buildAdminPublicSmokeRoute("/admin/manual", "admin-manual-alias-redirect", "next=%2Fadmin%2Fmanual"),
  buildAdminPublicSmokeRoute("/admin/schools", "admin-schools-alias-redirect", "next=%2Fadmin%2Fschools"),
  buildAdminPublicSmokeRoute("/admin/teachers", "admin-teachers-alias-redirect", "next=%2Fadmin%2Fteachers"),
  buildAdminPublicSmokeRoute("/admin/classrooms", "admin-classrooms-alias-redirect", "next=%2Fadmin%2Fclassrooms"),
  buildAdminPublicSmokeRoute("/admin/terms", "admin-terms-alias-redirect", "next=%2Fadmin%2Fterms"),
  buildAdminPublicSmokeRoute("/admin/settings", "admin-settings-root-redirect", "next=%2Fadmin%2Fsettings"),
  buildAdminPublicSmokeRoute("/admin/settings/account", "admin-settings-account-redirect", "next=%2Fadmin%2Fsettings%2Faccount"),
  buildAdminPublicSmokeRoute("/admin/settings/appearance", "admin-settings-appearance-redirect", "next=%2Fadmin%2Fsettings%2Fappearance"),
  buildAdminPublicSmokeRoute("/admin/settings/connections", "admin-settings-connections-redirect", "next=%2Fadmin%2Fsettings%2Fconnections"),
  buildAdminPublicSmokeRoute("/admin/settings/notifications", "admin-settings-notifications-redirect", "next=%2Fadmin%2Fsettings%2Fnotifications"),
  buildAdminPublicSmokeRoute("/admin/settings/terms", "admin-settings-terms-redirect", "next=%2Fadmin%2Fsettings%2Fterms"),
  buildAdminPublicSmokeRoute("/admin/settings/user", "admin-settings-user-redirect", "next=%2Fadmin%2Fsettings%2Fuser"),
]

const LEGACY_AUTH_PUBLIC_SMOKE_ROUTES = [
  {
    path: "/sign-in-2",
    name: "legacy-sign-in-2",
    expectedTexts: [...SIGN_IN_EXPECTED_TEXTS, "로그인"],
    expectedPath: "/sign-in",
  },
  {
    path: "/sign-in-3",
    name: "legacy-sign-in-3",
    expectedTexts: [...SIGN_IN_EXPECTED_TEXTS, "로그인"],
    expectedPath: "/sign-in",
  },
  {
    path: "/sign-up-2",
    name: "legacy-sign-up-2",
    expectedTexts: ["회원가입"],
    expectedPath: "/sign-up",
  },
  {
    path: "/sign-up-3",
    name: "legacy-sign-up-3",
    expectedTexts: ["회원가입"],
    expectedPath: "/sign-up",
  },
  {
    path: "/forgot-password-2",
    name: "legacy-forgot-password-2",
    expectedTexts: ["비밀번호"],
    expectedPath: "/forgot-password",
  },
  {
    path: "/forgot-password-3",
    name: "legacy-forgot-password-3",
    expectedTexts: ["비밀번호"],
    expectedPath: "/forgot-password",
  },
]
const LEGACY_ADMIN_PUBLIC_SMOKE_ROUTES = [
  {
    path: "/admin/chat",
    name: "legacy-admin-chat-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Fchat",
  },
  {
    path: "/admin/mail",
    name: "legacy-admin-mail-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Fmail",
  },
  {
    path: "/admin/pricing",
    name: "legacy-admin-pricing-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Fpricing",
  },
  {
    path: "/admin/faqs",
    name: "legacy-admin-faqs-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Ffaqs",
  },
  {
    path: "/admin/dashboard-2",
    name: "legacy-admin-dashboard-2-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Fdashboard-2",
  },
  {
    path: "/admin/users",
    name: "legacy-admin-users-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Fusers",
  },
  {
    path: "/admin/settings/billing",
    name: "legacy-admin-settings-billing-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Fsettings%2Fbilling",
  },
]
const PUBLIC_SMOKE_ROUTES = [
  {
    path: "/landing",
    name: "landing-alias-redirect",
    expectedTexts: SIGN_IN_EXPECTED_TEXTS,
    expectedPath: "/sign-in",
    expectedSearchIncludes: "next=%2Fadmin%2Fdashboard",
  },
  {
    path: "/sign-in",
    name: "sign-in",
    expectedTexts: ["TIPS 로그인", "아이디", "비밀번호", "로그인"],
    expectedPath: "/sign-in",
  },
  ...LEGACY_AUTH_PUBLIC_SMOKE_ROUTES,
  ...CORE_ADMIN_PUBLIC_SMOKE_ROUTES,
  ...ADMIN_ALIAS_PUBLIC_SMOKE_ROUTES,
  ...LEGACY_ADMIN_PUBLIC_SMOKE_ROUTES,
]

const AUTHENTICATED_CORE_SMOKE_ROUTES = [
  {
    path: "/admin/dashboard",
    name: "dashboard",
    expectedTexts: ["대시보드"],
  },
  {
    path: "/admin/students",
    name: "management-students",
    expectedTexts: ["학생관리"],
  },
  {
    path: "/admin/classes",
    name: "management-classes",
    expectedTexts: ["수업관리"],
  },
  {
    path: "/admin/textbooks",
    name: "management-textbooks",
    expectedTexts: ["교재관리"],
  },
  {
    path: "/admin/curriculum",
    name: "curriculum-planning",
    expectedTexts: ["수업계획"],
  },
  {
    path: "/admin/class-schedule",
    name: "class-schedule",
    expectedTexts: ["수업일정"],
  },
  {
    path: "/admin/class-schedule/lesson-design",
    name: "lesson-design",
    expectedTexts: [],
  },
  {
    path: "/admin/timetable",
    name: "timetable",
    expectedTexts: ["시간표"],
  },
  {
    path: "/admin/academic-calendar",
    name: "academic-calendar",
    expectedTexts: ["캘린더"],
  },
  {
    path: "/admin/academic-calendar/annual-board",
    name: "academic-annual-board",
    expectedTexts: ["학교 연간 일정표"],
  },
  {
    path: "/admin/settings/schools",
    name: "settings-schools",
    expectedTexts: ["학교 설정"],
  },
  {
    path: "/admin/settings/teachers",
    name: "settings-teachers",
    expectedTexts: ["선생님 설정"],
  },
  {
    path: "/admin/settings/classrooms",
    name: "settings-classrooms",
    expectedTexts: ["강의실 설정"],
  },
  {
    path: "/admin/settings/class-groups",
    name: "settings-class-groups",
    expectedTexts: ["기간 설정"],
  },
  {
    path: "/admin/settings/textbook-suppliers",
    name: "settings-textbook-suppliers",
    expectedTexts: ["교재 설정"],
  },
]

const ROUTES = [
  { path: "/admin/tasks?list=inbox", name: "todo-inbox", expectedTexts: ["할 일", "받은함", "추가"], interaction: "quick-add" },
  { path: "/admin/tasks?list=sent", name: "todo-sent", expectedTexts: ["할 일", "보낸함"] },
  { path: "/admin/tasks?list=completed", name: "todo-completed", expectedTexts: ["할 일", "완료"] },
  { path: "/admin/registration", name: "registration", expectedTexts: ["등록", "등록 추가"], interaction: "open-create" },
  { path: "/admin/registration?fixture=registration-subject-tracks&fixtureRole=english_admin", name: "registration-subject-track-fixture", expectedTexts: ["등록", "윤지호"], interaction: "registration-subject-track-fixture" },
  { path: "/admin/transfer", name: "transfer", expectedTexts: ["전반", "전반 신청"], interaction: "open-create" },
  { path: "/admin/withdrawal", name: "withdrawal", expectedTexts: ["퇴원", "퇴원 신청"], interaction: "open-create" },
  { path: "/admin/word-retests", name: "word-retests", expectedTexts: ["영어 단어 재시험", "추가"], interaction: "open-create" },
  { path: "/admin/makeup-requests", name: "makeup-requests", expectedTexts: ["휴보강", "신청"], interaction: "makeup-request" },
  { path: "/admin/approvals", name: "approvals", expectedTexts: ["전자결재", "영어", "수학", "자유"], interaction: "approval-draft" },
  ...AUTHENTICATED_CORE_SMOKE_ROUTES,
]

function getAuthenticatedRoutes() {
  const filter = env("OPS_BROWSER_ROUTE_FILTER")
  if (!filter) return ROUTES

  const terms = filter.split(",").map((term) => term.trim()).filter(Boolean)
  if (terms.length === 0) return ROUTES

  const routes = ROUTES.filter((route) =>
    terms.some((term) => route.name.includes(term) || route.path.includes(term)),
  )
  if (routes.length === 0) throw new Error(`OPS_BROWSER_ROUTE_FILTER matched no routes: ${filter}`)
  return routes
}

const VIEWPORTS = [
  { name: "desktop", width: 1349, height: 987 },
  { name: "mobile", width: 390, height: 844 },
]

function loadEnvFile(pathname) {
  try {
    const source = readFileSync(pathname, "utf8")
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match || process.env[match[1]]) continue
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "")
    }
  } catch {
    // Local env files are optional for CI.
  }
}

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim()
}

function positiveIntegerEnv(name, fallback = 1) {
  const parsed = Number.parseInt(env(name, String(fallback)), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeLoginLocalPart(value) {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) return ""

  const digits = normalized.replace(/\D/g, "")
  const isPhoneLike = /^[\d\s()+-]+$/.test(normalized)
  if (isPhoneLike && digits.length >= 8) return digits

  return normalized
}

function normalizeLoginIdentifier(value, defaultDomain = DEFAULT_LOGIN_EMAIL_DOMAIN) {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) return ""

  if (normalized.includes("@")) {
    const atIndex = normalized.lastIndexOf("@")
    const localPart = normalized.slice(0, atIndex)
    const domainPart = normalized.slice(atIndex + 1) || defaultDomain
    return `${normalizeLoginLocalPart(localPart)}@${domainPart}`
  }

  return `${normalizeLoginLocalPart(normalized)}@${defaultDomain}`
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
}

function loginCandidates(loginId) {
  const normalized = normalizeLoginIdentifier(loginId)
  const localPart = String(loginId || "").includes("@")
    ? String(loginId || "").slice(0, String(loginId || "").lastIndexOf("@"))
    : ""
  const localPartCandidate = normalizeLoginLocalPart(localPart)
  return unique([loginId, normalized, localPartCandidate])
}

function isEnabledEnv(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase())
}

function listMissingEnv(requirements) {
  return requirements.filter((requirement) => !requirement.value).map((requirement) => requirement.name)
}

function buildOpsBrowserAuthPreflight() {
  const loginId = env("OPS_BROWSER_LOGIN_ID", env("OPS_BROWSER_EMAIL"))
  const password = env("OPS_BROWSER_PASSWORD")
  const storageStatePath = env("OPS_BROWSER_STORAGE_STATE")
  const useSupabaseStorage = env("OPS_BROWSER_SUPABASE_STORAGE", "1") !== "0"
  const useTemporaryUser = isEnabledEnv(env("OPS_BROWSER_TEMP_USER"))
  const supabaseUrl = env("SUPABASE_URL", env("NEXT_PUBLIC_SUPABASE_URL", env("VITE_SUPABASE_URL")))
  const supabaseAnonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY", env("VITE_SUPABASE_ANON_KEY"))
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY", env("SUPABASE_SERVICE_KEY"))
  const rosterLoginId = env("OPS_BROWSER_ROSTER_LOGIN_ID", loginId)
  const rosterPassword = env("OPS_BROWSER_ROSTER_PASSWORD", password)
  const fixtureScope = env("OPS_FIXTURE_DATABASE_SCOPE").toLowerCase()
  const disposableFixtureDatabase = isEnabledEnv(env("OPS_FIXTURE_DISPOSABLE")) && fixtureScope === "local" && Boolean(env("OPS_SAMPLE_DB_URL"))
  const storageStateFileExists = Boolean(storageStatePath && existsSync(storageStatePath))
  const storageStateMissing = storageStatePath
    ? storageStateFileExists
      ? []
      : ["OPS_BROWSER_STORAGE_STATE file"]
    : ["OPS_BROWSER_STORAGE_STATE"]
  const uiLoginMissing = listMissingEnv([
    { name: "OPS_BROWSER_LOGIN_ID/OPS_BROWSER_EMAIL", value: loginId },
    { name: "OPS_BROWSER_PASSWORD", value: password },
  ])
  const supabaseStorageMissing = useSupabaseStorage
    ? listMissingEnv([
        { name: "SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL/VITE_SUPABASE_URL", value: supabaseUrl },
        { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY", value: supabaseAnonKey },
        { name: "OPS_BROWSER_LOGIN_ID/OPS_BROWSER_EMAIL", value: loginId },
        { name: "OPS_BROWSER_PASSWORD", value: password },
      ])
    : ["OPS_BROWSER_SUPABASE_STORAGE=1"]
  const tempUserMissing = useTemporaryUser
    ? listMissingEnv([
        { name: "SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL/VITE_SUPABASE_URL", value: supabaseUrl },
        { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY", value: supabaseAnonKey },
        { name: "SUPABASE_SERVICE_ROLE_KEY", value: serviceRoleKey },
      ])
    : ["OPS_BROWSER_TEMP_USER=1"]

  const authModes = {
    "storage-state-file": {
      configured: Boolean(storageStatePath),
      ready: storageStateFileExists,
      missing: storageStateMissing,
    },
    "ui-login": {
      configured: Boolean(loginId || password),
      ready: uiLoginMissing.length === 0,
      missing: uiLoginMissing,
    },
    "supabase-storage": {
      configured: useSupabaseStorage,
      ready: useSupabaseStorage && supabaseStorageMissing.length === 0,
      missing: supabaseStorageMissing,
    },
    "temp-user-storage": {
      configured: useTemporaryUser,
      ready: useTemporaryUser && tempUserMissing.length === 0,
      missing: tempUserMissing,
    },
  }
  const canRunAuthenticatedWorkflow = Object.values(authModes).some((mode) => mode.ready)
  const canCreateCompletionFixtures = Boolean(
    supabaseUrl &&
    supabaseAnonKey &&
    rosterLoginId &&
    rosterPassword &&
    disposableFixtureDatabase &&
    (serviceRoleKey || (loginId && password)),
  )

  return {
    canRunAuthenticatedWorkflow,
    canCreateCompletionFixtures,
    authModes,
    hint: "Set OPS_BROWSER_STORAGE_STATE, OPS_BROWSER_TEMP_USER=1, or OPS_BROWSER_LOGIN_ID/OPS_BROWSER_PASSWORD in .env.ops-browser.local. Database-backed roster fixtures additionally require an authenticated admin/staff roster login plus OPS_FIXTURE_DISPOSABLE=1, OPS_FIXTURE_DATABASE_SCOPE=local, and an explicit localhost OPS_SAMPLE_DB_URL.",
  }
}

function requireEnabled() {
  if (ENABLED || isEnabledEnv(env("OPS_BROWSER_WORKFLOW"))) return true
  console.log("Skipped. Set OPS_BROWSER_WORKFLOW=1 and add OPS_BROWSER_LOGIN_ID/OPS_BROWSER_PASSWORD, OPS_BROWSER_STORAGE_STATE, or OPS_BROWSER_TEMP_USER=1 to verify authenticated ops screens. Set OPS_BROWSER_PUBLIC_SMOKE=1 to verify public sign-in and protected-route redirects. Set OPS_BROWSER_PREFLIGHT=1 to check authenticated workflow prerequisites.")
  return false
}

function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/$/, "")}${path}`
}

async function importPlaywright() {
  try {
    return await import("playwright")
  } catch {
    throw new Error("Playwright is required for OPS_BROWSER_WORKFLOW=1. Run this from the local dev workspace where Playwright is installed.")
  }
}

async function importSupabaseClient() {
  try {
    return await import("@supabase/supabase-js")
  } catch {
    throw new Error("@supabase/supabase-js is required to create an authenticated browser state.")
  }
}

function getSupabaseStorageKey(supabaseUrl) {
  const hostname = new URL(supabaseUrl).hostname
  const projectRef = hostname.split(".")[0]
  if (!projectRef) throw new Error(`Could not derive Supabase project ref from ${supabaseUrl}.`)
  return `sb-${projectRef}-auth-token`
}

async function createStorageStateFromSupabase(baseUrl, loginId, password) {
  const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL", env("VITE_SUPABASE_URL"))
  const supabaseAnonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY", env("VITE_SUPABASE_ANON_KEY"))
  if (!supabaseUrl || !supabaseAnonKey || !loginId || !password) return null

  const { createClient } = await importSupabaseClient()
  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  const email = normalizeLoginIdentifier(loginId)
  const { data, error } = await authClient.auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    throw new Error(`Supabase session login failed before browser checks: ${error?.message || "missing session"}`)
  }

  const origin = new URL(baseUrl).origin
  return {
    cookies: [],
    origins: [
      {
        origin,
        localStorage: [
          {
            name: getSupabaseStorageKey(supabaseUrl),
            value: JSON.stringify(data.session),
          },
        ],
      },
    ],
  }
}

async function countRemainingUiSamples(loginId, password) {
  const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL", env("VITE_SUPABASE_URL"))
  const supabaseAnonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY", env("VITE_SUPABASE_ANON_KEY"))
  if (!supabaseUrl || !supabaseAnonKey || !loginId || !password) return null

  const { createClient } = await importSupabaseClient()
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  const email = normalizeLoginIdentifier(loginId)
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.session) return null

  let remaining = 0
  for (const prefix of [UI_SAMPLE_PREFIX, UI_COMPLETION_PREFIX, UI_REGISTRATION_PREFIX]) {
    const { count, error: countError } = await client
      .from("ops_tasks")
      .select("id", { count: "exact", head: true })
      .ilike("title", `%${prefix}%`)

    if (countError) throw countError
    remaining += count || 0
  }
  return remaining
}

function assertAuthorizedLocalFixtureDatabase(url) {
  const scope = env("OPS_FIXTURE_DATABASE_SCOPE").toLowerCase()
  const disposable = isEnabledEnv(env("OPS_FIXTURE_DISPOSABLE"))
  if (!disposable || scope !== "local") {
    throw new Error("Roster verification is audit-bearing and may run only on an explicitly authorized localhost database. Set OPS_FIXTURE_DISPOSABLE=1 and OPS_FIXTURE_DATABASE_SCOPE=local.")
  }
  const localDatabaseUrl = env("OPS_SAMPLE_DB_URL")
  if (!localDatabaseUrl) {
    throw new Error("Roster verification requires OPS_SAMPLE_DB_URL for the exact disposable localhost database.")
  }
  const allowedHosts = new Set(["127.0.0.1", "localhost", "::1"])
  const target = new URL(url)
  const database = new URL(localDatabaseUrl)
  if (!allowedHosts.has(target.hostname) || !allowedHosts.has(database.hostname)) {
    throw new Error("Remote and production targets are denied; both the Supabase URL and OPS_SAMPLE_DB_URL must use localhost.")
  }
  if (!/^postgres(?:ql)?:$/.test(database.protocol)) {
    throw new Error("OPS_SAMPLE_DB_URL must be a PostgreSQL URL.")
  }
  return "local"
}

async function createFixtureClients(loginId, password) {
  const supabaseUrl = env("SUPABASE_URL", env("NEXT_PUBLIC_SUPABASE_URL", env("VITE_SUPABASE_URL")))
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY", env("SUPABASE_SERVICE_KEY"))
  const supabaseAnonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY", env("VITE_SUPABASE_ANON_KEY"))
  if (!supabaseUrl) throw new Error("OPS_BROWSER_OPERATION_COMPLETE_SAMPLE=1 requires SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL.")
  const databaseScope = assertAuthorizedLocalFixtureDatabase(supabaseUrl)
  const rosterLoginId = env("OPS_BROWSER_ROSTER_LOGIN_ID", loginId)
  const rosterPassword = env("OPS_BROWSER_ROSTER_PASSWORD", password)
  if (!supabaseAnonKey || !rosterLoginId || !rosterPassword) {
    throw new Error("Ready-mode roster fixtures require OPS_BROWSER_ROSTER_LOGIN_ID/OPS_BROWSER_ROSTER_PASSWORD (or the browser login) for an independent authenticated admin/staff client.")
  }

  const { createClient } = await importSupabaseClient()
  const authenticatedRosterClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  const { error } = await authenticatedRosterClient.auth.signInWithPassword({
    email: normalizeLoginIdentifier(rosterLoginId),
    password: rosterPassword,
  })
  if (error) throw new Error(`Operation fixture login failed: ${error.message}`)
  const setupClient = serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    : createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  if (!serviceRoleKey) {
    const setupAuth = await setupClient.auth.signInWithPassword({
      email: normalizeLoginIdentifier(rosterLoginId),
      password: rosterPassword,
    })
    if (setupAuth.error) throw new Error(`Operation setup login failed: ${setupAuth.error.message}`)
  }
  return { setupClient, authenticatedRosterClient, databaseScope }
}

function compactUuid() {
  return randomUUID().slice(0, 8)
}

function todayDateValue() {
  return new Date().toISOString().slice(0, 10)
}

function nowIsoValue() {
  return new Date().toISOString()
}

function ensureQueryOk(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

function normalizeIdListValue(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "")).filter(Boolean)
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map((item) => String(item || "")).filter(Boolean)
    } catch {
      return [trimmed]
    }
  }
  return []
}

function normalizeRosterIds(value) {
  return [...new Set(normalizeIdListValue(value))].sort()
}

function sortRosterPairs(pairs) {
  return [...pairs].sort((left, right) =>
    `${left.studentId}:${left.classId}`.localeCompare(`${right.studentId}:${right.classId}`),
  )
}

function assertCommittedRosterResponse(committed, { studentId, classId, expectedMode, nextMode }) {
  if (!committed || typeof committed !== "object" || Array.isArray(committed)) {
    throw new Error("Roster RPC did not return a committed object.")
  }
  if (
    String(committed.studentId || "") !== studentId ||
    String(committed.classId || "") !== classId ||
    committed.previousMode !== expectedMode ||
    committed.nextMode !== nextMode ||
    committed.changed !== (expectedMode !== nextMode)
  ) {
    throw new Error(`Roster RPC response mismatch: ${JSON.stringify(committed)}`)
  }
  for (const field of ["studentClassIds", "studentWaitlistClassIds", "classStudentIds", "classWaitlistIds"]) {
    if (!Array.isArray(committed[field]) || JSON.stringify(committed[field]) !== JSON.stringify(normalizeRosterIds(committed[field]))) {
      throw new Error(`Roster RPC ${field} projection is not a sorted array.`)
    }
  }
  return committed
}

async function readRosterProjection(client, studentId, classId) {
  const [studentResult, classResult] = await Promise.all([
    client.from("students").select("id,class_ids,waitlist_class_ids").eq("id", studentId).maybeSingle(),
    client.from("classes").select("id,student_ids,waitlist_ids").eq("id", classId).maybeSingle(),
  ])
  if (studentResult.error) throw new Error(`student roster read failed: ${studentResult.error.message}`)
  if (classResult.error) throw new Error(`class roster read failed: ${classResult.error.message}`)
  if (!studentResult.data || !classResult.data) throw new Error("Roster fixture pair was not found.")
  return {
    studentClassIds: normalizeRosterIds(studentResult.data.class_ids),
    studentWaitlistClassIds: normalizeRosterIds(studentResult.data.waitlist_class_ids),
    classStudentIds: normalizeRosterIds(classResult.data.student_ids),
    classWaitlistIds: normalizeRosterIds(classResult.data.waitlist_ids),
  }
}

function rosterModeFromProjection(projection, studentId, classId) {
  const enrolled = projection.studentClassIds.includes(classId) && projection.classStudentIds.includes(studentId)
  const waitlisted = projection.studentWaitlistClassIds.includes(classId) && projection.classWaitlistIds.includes(studentId)
  const asymmetric =
    projection.studentClassIds.includes(classId) !== projection.classStudentIds.includes(studentId) ||
    projection.studentWaitlistClassIds.includes(classId) !== projection.classWaitlistIds.includes(studentId)
  if (asymmetric || (enrolled && waitlisted)) throw new Error("Roster fixture projection is asymmetric.")
  return enrolled ? "enrolled" : waitlisted ? "waitlist" : "removed"
}

async function verifyRosterProjection(client, { studentId, classId, nextMode }, committed) {
  const projection = await readRosterProjection(client, studentId, classId)
  if (rosterModeFromProjection(projection, studentId, classId) !== nextMode) {
    throw new Error(`Roster projection did not commit ${nextMode}.`)
  }
  for (const field of ["studentClassIds", "studentWaitlistClassIds", "classStudentIds", "classWaitlistIds"]) {
    if (JSON.stringify(projection[field]) !== JSON.stringify(normalizeRosterIds(committed[field]))) {
      throw new Error(`Roster ${field} did not match the committed RPC response.`)
    }
  }
  return projection
}

async function setRosterMode(authenticatedRosterClient, { studentId, classId, expectedMode, nextMode, memo }) {
  const result = await authenticatedRosterClient.rpc("set_student_class_roster_mode", {
    p_student_id: studentId,
    p_class_id: classId,
    p_expected_mode: expectedMode,
    p_next_mode: nextMode,
    p_memo: memo,
  })
  if (result.error) throw new Error(`set_student_class_roster_mode failed: ${result.error.message}`)
  const committed = assertCommittedRosterResponse(result.data, { studentId, classId, expectedMode, nextMode })
  await verifyRosterProjection(authenticatedRosterClient, { studentId, classId, nextMode }, committed)
  return committed
}

async function removeRosterPairs(authenticatedRosterClient, pairs, memo, { allowMissing = false } = {}) {
  for (const pair of sortRosterPairs(pairs)) {
    let projection
    try {
      projection = await readRosterProjection(authenticatedRosterClient, pair.studentId, pair.classId)
    } catch (error) {
      if (allowMissing && error instanceof Error && error.message === "Roster fixture pair was not found.") continue
      throw error
    }
    const expectedMode = rosterModeFromProjection(projection, pair.studentId, pair.classId)
    await setRosterMode(authenticatedRosterClient, { ...pair, expectedMode, nextMode: "removed", memo })
  }
}

async function captureBrowserFixtureCleanup(cleanupErrors, label, operation) {
  try {
    return await operation()
  } catch (error) {
    cleanupErrors.push(new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }))
    return null
  }
}

async function archiveAuditFixtures(setupClient, { taskIds = [], studentIds, classIds, textbookIds = [], teacherIds = [], prefix }) {
  const archivedName = `[ARCHIVED] ${prefix}`
  const writes = [
    setupClient.from("students").update({ name: `${archivedName} student`, status: "퇴원" }).in("id", studentIds),
    setupClient.from("classes").update({ name: `${archivedName} class`, status: "종강" }).in("id", classIds),
  ]
  if (textbookIds.length > 0) writes.push(setupClient.from("textbooks").update({ name: `${archivedName} textbook`, title: `${archivedName} textbook`, status: "inactive" }).in("id", textbookIds))
  if (teacherIds.length > 0) writes.push(setupClient.from("teacher_catalogs").update({ name: `${archivedName} teacher`, is_visible: false }).in("id", teacherIds))
  for (const result of await Promise.all(writes)) {
    if (result.error) throw new Error(`audit fixture archive failed: ${result.error.message}`)
  }
  const zeroCount = Promise.resolve({ count: 0, error: null })
  const [activeTasks, activeStudents, activeClasses, activeTextbooks, activeTeachers, history] = await Promise.all([
    taskIds.length > 0 ? setupClient.from("ops_tasks").select("id", { count: "exact", head: true }).in("id", taskIds) : zeroCount,
    setupClient.from("students").select("id", { count: "exact", head: true }).ilike("name", `${prefix}%`),
    setupClient.from("classes").select("id", { count: "exact", head: true }).ilike("name", `${prefix}%`),
    textbookIds.length > 0 ? setupClient.from("textbooks").select("id", { count: "exact", head: true }).ilike("name", `${prefix}%`) : zeroCount,
    teacherIds.length > 0 ? setupClient.from("teacher_catalogs").select("id", { count: "exact", head: true }).ilike("name", `${prefix}%`) : zeroCount,
    setupClient.from("student_class_enrollment_history").select("id", { count: "exact", head: true }).in("student_id", studentIds),
  ])
  for (const result of [activeTasks, activeStudents, activeClasses, activeTextbooks, activeTeachers, history]) {
    if (result.error) throw new Error(`audit fixture verification failed: ${result.error.message}`)
  }
  const activeCounts = [activeTasks, activeStudents, activeClasses, activeTextbooks, activeTeachers]
    .map((result) => Number(result.count || 0))
  return {
    activeFixtureRows: activeCounts.reduce((sum, count) => sum + count, 0),
    auditHistoryRetained: Number(history.count || 0),
  }
}

function printAuditFixtureResetInstruction(scope) {
  console.log(`Audit-bearing roster fixtures were archived on the disposable localhost database (${scope}). Cleanup: pnpm dlx supabase@2.109.1 db reset.`)
}

function includesId(value, id) {
  return normalizeIdListValue(value).includes(String(id || ""))
}

async function deleteByIds(client, table, column, ids) {
  const safeIds = ids.filter(Boolean)
  if (safeIds.length === 0) return
  const result = await client.from(table).delete().in(column, safeIds)
  if (result.error) throw new Error(`${table} cleanup failed: ${result.error.message}`)
}

function buildOperationCompletionFixtureIds() {
  return {
    teacher: randomUUID(),
    students: {
      registration: randomUUID(),
      withdrawal: randomUUID(),
      transfer: randomUUID(),
      wordRetest: randomUUID(),
    },
    classes: {
      registration: randomUUID(),
      withdrawal: randomUUID(),
      transferFrom: randomUUID(),
      transferTo: randomUUID(),
      wordRetest: randomUUID(),
    },
    textbooks: {
      registration: randomUUID(),
      wordRetest: randomUUID(),
    },
    tasks: {
      registration: randomUUID(),
      withdrawal: randomUUID(),
      transfer: randomUUID(),
      wordRetest: randomUUID(),
    },
  }
}

async function createOperationCompletionFixtures(viewportName, loginId, password) {
  const { setupClient: client, authenticatedRosterClient, databaseScope } = await createFixtureClients(loginId, password)
  const token = `${viewportName}-${Date.now()}-${compactUuid()}`
  const prefix = `${UI_COMPLETION_PREFIX} ${token}`
  const ids = buildOperationCompletionFixtureIds()
  const today = todayDateValue()
  const now = nowIsoValue()
  const teacherName = `${prefix} 선생님`

  try {
    ensureQueryOk(await client.from("teacher_catalogs").insert({
      id: ids.teacher,
      name: teacherName,
      subjects: ["영어"],
      is_visible: true,
      sort_order: 9900,
      dashboard_role: "teacher",
    }), "teacher fixture insert")

    ensureQueryOk(await client.from("textbooks").insert([
      {
        id: ids.textbooks.registration,
        title: `${prefix} 등록 교재`,
        name: `${prefix} 등록 교재`,
        subject: "영어",
        category: "검증",
        publisher: "검증 출판사",
        price: 10000,
        list_price: 10000,
        sale_price: 10000,
        status: "active",
        is_returnable: false,
        lessons: [],
        school_level: "고등",
        grade_level: "고1",
        sub_subject: "영어",
      },
      {
        id: ids.textbooks.wordRetest,
        title: `${prefix} 재시험 교재`,
        name: `${prefix} 재시험 교재`,
        subject: "영어",
        category: "검증",
        publisher: "검증 출판사",
        price: 12000,
        list_price: 12000,
        sale_price: 12000,
        status: "active",
        is_returnable: false,
        lessons: [],
        school_level: "고등",
        grade_level: "고1",
        sub_subject: "영어",
      },
    ]), "textbook fixture insert")

    ensureQueryOk(await client.from("students").insert([
      {
        id: ids.students.registration,
        name: `${prefix} 등록학생`,
        grade: "고1",
        enroll_date: today,
        class_ids: [],
        waitlist_class_ids: [],
        school: "검증고",
        contact: "010-0000-0001",
        parent_contact: "010-1000-0001",
        status: "재원",
      },
      {
        id: ids.students.withdrawal,
        name: `${prefix} 퇴원학생`,
        grade: "고1",
        enroll_date: today,
        class_ids: [],
        waitlist_class_ids: [],
        school: "검증고",
        contact: "010-0000-0002",
        parent_contact: "010-1000-0002",
        status: "재원",
      },
      {
        id: ids.students.transfer,
        name: `${prefix} 전반학생`,
        grade: "고1",
        enroll_date: today,
        class_ids: [],
        waitlist_class_ids: [],
        school: "검증고",
        contact: "010-0000-0003",
        parent_contact: "010-1000-0003",
        status: "재원",
      },
      {
        id: ids.students.wordRetest,
        name: `${prefix} 재시험학생`,
        grade: "고1",
        enroll_date: today,
        class_ids: [],
        waitlist_class_ids: [],
        school: "검증고",
        contact: "010-0000-0004",
        parent_contact: "010-1000-0004",
        status: "재원",
      },
    ]), "student fixture insert")

    ensureQueryOk(await client.from("classes").insert([
      {
        id: ids.classes.registration,
        name: `${prefix} 등록반`,
        teacher: teacherName,
        schedule: "",
        student_ids: [],
        waitlist_ids: [],
        textbook_ids: [],
        room: "본관 1강",
        subject: "영어",
        grade: "고1",
        capacity: 12,
        fee: 0,
        status: "수강",
      },
      {
        id: ids.classes.withdrawal,
        name: `${prefix} 퇴원반`,
        teacher: teacherName,
        schedule: "",
        student_ids: [],
        waitlist_ids: [],
        textbook_ids: [],
        room: "본관 2강",
        subject: "영어",
        grade: "고1",
        capacity: 12,
        fee: 0,
        status: "수강",
      },
      {
        id: ids.classes.transferFrom,
        name: `${prefix} 전반 전반`,
        teacher: teacherName,
        schedule: "",
        student_ids: [],
        waitlist_ids: [],
        textbook_ids: [],
        room: "별관 1강",
        subject: "영어",
        grade: "고1",
        capacity: 12,
        fee: 0,
        status: "수강",
      },
      {
        id: ids.classes.transferTo,
        name: `${prefix} 전반 후반`,
        teacher: teacherName,
        schedule: "",
        student_ids: [],
        waitlist_ids: [],
        textbook_ids: [],
        room: "별관 2강",
        subject: "영어",
        grade: "고1",
        capacity: 12,
        fee: 0,
        status: "수강",
      },
      {
        id: ids.classes.wordRetest,
        name: `${prefix} 재시험반`,
        teacher: teacherName,
        schedule: "",
        student_ids: [],
        waitlist_ids: [],
        textbook_ids: [ids.textbooks.wordRetest],
        room: "본관 3강",
        subject: "영어",
        grade: "고1",
        capacity: 12,
        fee: 0,
        status: "수강",
      },
    ]), "class fixture insert")

    for (const pair of sortRosterPairs([
      { studentId: ids.students.withdrawal, classId: ids.classes.withdrawal },
      { studentId: ids.students.transfer, classId: ids.classes.transferFrom },
      { studentId: ids.students.wordRetest, classId: ids.classes.wordRetest },
    ])) {
      await setRosterMode(authenticatedRosterClient, {
        ...pair,
        expectedMode: "removed",
        nextMode: "enrolled",
        memo: `${UI_COMPLETION_PREFIX} roster seed`,
      })
    }

    const tasks = [
      {
        key: "registration",
        routePath: "/admin/registration?flow=enrollment",
        routeExpectedTexts: ["등록", "등록 추가"],
        title: `${prefix} 등록 완료`,
        id: ids.tasks.registration,
      },
      {
        key: "withdrawal",
        routePath: "/admin/withdrawal",
        routeExpectedTexts: ["퇴원", "퇴원 신청"],
        title: `${prefix} 퇴원 완료`,
        id: ids.tasks.withdrawal,
      },
      {
        key: "transfer",
        routePath: "/admin/transfer",
        routeExpectedTexts: ["전반", "전반 신청"],
        title: `${prefix} 전반 완료`,
        id: ids.tasks.transfer,
      },
      {
        key: "wordRetest",
        routePath: "/admin/word-retests",
        routeExpectedTexts: ["영어 단어 재시험", "추가"],
        title: `${prefix} 단어 재시험 완료`,
        id: ids.tasks.wordRetest,
      },
    ]

    ensureQueryOk(await client.from("ops_tasks").insert([
      {
        id: ids.tasks.registration,
        title: tasks[0].title,
        type: "registration",
        status: "in_progress",
        priority: "normal",
        student_id: ids.students.registration,
        class_id: ids.classes.registration,
        textbook_id: ids.textbooks.registration,
        student_name: `${prefix} 등록학생`,
        class_name: `${prefix} 등록반`,
        textbook_title: `${prefix} 등록 교재`,
        campus: "본관",
        subject: "영어",
        due_at: now,
        memo: `${UI_COMPLETION_PREFIX} fixture registration`,
      },
      {
        id: ids.tasks.withdrawal,
        title: tasks[1].title,
        type: "withdrawal",
        status: "in_progress",
        priority: "normal",
        student_id: ids.students.withdrawal,
        class_id: ids.classes.withdrawal,
        student_name: `${prefix} 퇴원학생`,
        class_name: `${prefix} 퇴원반`,
        campus: "본관",
        subject: "영어",
        due_at: now,
        memo: `${UI_COMPLETION_PREFIX} fixture withdrawal`,
      },
      {
        id: ids.tasks.transfer,
        title: tasks[2].title,
        type: "transfer",
        status: "in_progress",
        priority: "normal",
        student_id: ids.students.transfer,
        class_id: ids.classes.transferTo,
        student_name: `${prefix} 전반학생`,
        class_name: `${prefix} 전반 후반`,
        campus: "별관",
        subject: "영어",
        due_at: now,
        memo: `${UI_COMPLETION_PREFIX} fixture transfer`,
      },
      {
        id: ids.tasks.wordRetest,
        title: tasks[3].title,
        type: "word_retest",
        status: "in_progress",
        priority: "normal",
        student_id: ids.students.wordRetest,
        class_id: ids.classes.wordRetest,
        textbook_id: ids.textbooks.wordRetest,
        student_name: `${prefix} 재시험학생`,
        class_name: `${prefix} 재시험반`,
        textbook_title: `${prefix} 재시험 교재`,
        campus: "본관",
        subject: "영어",
        due_at: now,
        memo: `${UI_COMPLETION_PREFIX} fixture word_retest`,
      },
    ]), "operation task fixture insert")

    ensureQueryOk(await client.from("ops_registration_details").insert({
      task_id: ids.tasks.registration,
      inquiry_at: now,
      school_grade: "고1",
      school_name: "검증고",
      parent_phone: "010-1000-0001",
      student_phone: "010-0000-0001",
      level_test_at: now,
      level_test_place: "본관",
      counselor: teacherName,
      consultation_at: now,
      class_start_date: today,
      class_start_session: "1회차",
      textbook_ready: false,
      admission_notice_sent: true,
      payment_checked: true,
      makeedu_registered: true,
      makeedu_invoice_sent: true,
      textbook_billing_issued: true,
      pipeline_status: "6. 수납 확인",
      request_note: UI_COMPLETION_PREFIX,
    }), "registration detail fixture insert")

    ensureQueryOk(await client.from("ops_withdrawal_details").insert({
      task_id: ids.tasks.withdrawal,
      school_grade: "고1",
      teacher_name: teacherName,
      withdrawal_date: today,
      withdrawal_session: "마지막 회차",
      customer_reason: "검증",
      teacher_opinion: UI_COMPLETION_PREFIX,
      makeedu_withdrawal_done: true,
      fee_processed: true,
      textbook_fee_processed: true,
    }), "withdrawal detail fixture insert")

    ensureQueryOk(await client.from("ops_transfer_details").insert({
      task_id: ids.tasks.transfer,
      transfer_reason: "검증",
      from_class_id: ids.classes.transferFrom,
      to_class_id: ids.classes.transferTo,
      from_teacher_name: teacherName,
      to_teacher_name: teacherName,
      from_class_name: `${prefix} 전반 전반`,
      to_class_name: `${prefix} 전반 후반`,
      from_class_end_date: today,
      from_class_end_session: "종료 회차",
      to_class_start_date: today,
      to_class_start_session: "시작 회차",
      makeedu_transfer_done: true,
      fee_processed: true,
      textbook_fee_processed: true,
    }), "transfer detail fixture insert")

    ensureQueryOk(await client.from("ops_word_retests").insert({
      task_id: ids.tasks.wordRetest,
      branch: "본관",
      teacher_catalog_id: ids.teacher,
      teacher_name: teacherName,
      class_name: `${prefix} 재시험반`,
      student_name: `${prefix} 재시험학생`,
      test_at: now,
      textbook_name: `${prefix} 재시험 교재`,
      unit: "1단원",
      request_note: UI_COMPLETION_PREFIX,
      first_score: 100,
      retest_status: "in_progress",
    }), "word retest detail fixture insert")

    return { client, authenticatedRosterClient, databaseScope, prefix, ids, tasks }
  } catch (error) {
    try {
      await cleanupOperationCompletionFixtures(
        { client, authenticatedRosterClient, databaseScope, prefix, ids },
        { allowPartial: true },
      )
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Operation fixture creation and cleanup failed.")
    }
    throw error
  }
}

async function cleanupOperationCompletionFixtures(fixtureSet, { allowPartial = false } = {}) {
  const client = fixtureSet?.client
  const authenticatedRosterClient = fixtureSet?.authenticatedRosterClient
  const ids = fixtureSet?.ids
  if (!client || !authenticatedRosterClient || !ids) return
  const taskIds = Object.values(ids.tasks || {})
  const studentIds = Object.values(ids.students || {})
  const classIds = Object.values(ids.classes || {})
  const textbookIds = Object.values(ids.textbooks || {})
  const teacherIds = [ids.teacher].filter(Boolean)
  const cleanupErrors = []

  await captureBrowserFixtureCleanup(cleanupErrors, "roster cleanup", () =>
    removeRosterPairs(authenticatedRosterClient, [
      { studentId: ids.students.registration, classId: ids.classes.registration },
      { studentId: ids.students.withdrawal, classId: ids.classes.withdrawal },
      { studentId: ids.students.transfer, classId: ids.classes.transferFrom },
      { studentId: ids.students.transfer, classId: ids.classes.transferTo },
      { studentId: ids.students.wordRetest, classId: ids.classes.wordRetest },
    ], `${UI_COMPLETION_PREFIX} roster cleanup`, { allowMissing: allowPartial }),
  )

  for (const table of [
    "ops_task_comments",
    "ops_task_events",
    "ops_task_attachments",
    "ops_registration_details",
    "ops_withdrawal_details",
    "ops_transfer_details",
    "ops_word_retests",
  ]) {
    await captureBrowserFixtureCleanup(cleanupErrors, `${table} cleanup`, () =>
      deleteByIds(client, table, "task_id", taskIds),
    )
  }
  await captureBrowserFixtureCleanup(cleanupErrors, "ops_tasks cleanup", () =>
    deleteByIds(client, "ops_tasks", "id", taskIds),
  )
  const archive = await captureBrowserFixtureCleanup(cleanupErrors, "audit fixture archive", () =>
    archiveAuditFixtures(client, {
      taskIds,
      studentIds,
      classIds,
      textbookIds,
      teacherIds,
      prefix: fixtureSet.prefix,
    }),
  )
  if (archive && (archive.activeFixtureRows !== 0 || (!allowPartial && archive.auditHistoryRetained < 1))) {
    cleanupErrors.push(new Error(`Operation fixture archive verification failed: ${JSON.stringify(archive)}`))
  }
  if (archive) printAuditFixtureResetInstruction(fixtureSet.databaseScope)
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Browser fixture cleanup failed.")
  return archive
}

async function createRegistrationWorkflowFixture(viewportName, loginId, password) {
  const { setupClient: client, authenticatedRosterClient, databaseScope } = await createFixtureClients(loginId, password)
  const token = `${viewportName}-${Date.now()}-${compactUuid()}`
  const prefix = `${UI_REGISTRATION_PREFIX} ${token}`
  const ids = {
    task: randomUUID(),
    student: randomUUID(),
    class: randomUUID(),
  }
  const now = nowIsoValue()

  try {
    ensureQueryOk(await client.from("students").insert({
      id: ids.student,
      name: `${prefix} 학생`,
      grade: "고1",
      enroll_date: todayDateValue(),
      class_ids: [],
      waitlist_class_ids: [],
      school: "검증고",
      contact: "010-0000-0101",
      parent_contact: "010-1000-0101",
      status: "재원",
    }), "registration workflow student fixture insert")

    ensureQueryOk(await client.from("classes").insert({
      id: ids.class,
      name: `${prefix} 대기반`,
      teacher: "브라우저 검증",
      schedule: "",
      student_ids: [],
      waitlist_ids: [],
      textbook_ids: [],
      room: "본관 1강",
      subject: "영어",
      grade: "고1",
      capacity: 12,
      fee: 0,
      status: "수강",
    }), "registration workflow class fixture insert")

    ensureQueryOk(await client.from("ops_tasks").insert({
      id: ids.task,
      title: `${prefix} 신청서`,
      type: "registration",
      status: "in_progress",
      priority: "normal",
      student_id: ids.student,
      class_id: ids.class,
      student_name: `${prefix} 학생`,
      class_name: `${prefix} 대기반`,
      campus: "본관",
      subject: "영어",
      due_at: now,
      memo: `${UI_REGISTRATION_PREFIX} fixture`,
    }), "registration workflow task fixture insert")

    ensureQueryOk(await client.from("ops_registration_details").insert({
      task_id: ids.task,
      inquiry_at: now,
      school_grade: "고1",
      school_name: "검증고",
      parent_phone: "010-1000-0101",
      student_phone: "010-0000-0101",
      level_test_at: now,
      level_test_place: "본관",
      counselor: "브라우저 검증",
      phone_consultation_at: now,
      consultation_at: now,
      pipeline_status: "3. 상담 완료",
      request_note: UI_REGISTRATION_PREFIX,
    }), "registration workflow detail fixture insert")

    return { client, authenticatedRosterClient, databaseScope, prefix, ids, title: `${prefix} 신청서` }
  } catch (error) {
    try {
      await cleanupRegistrationWorkflowFixture(
        { client, authenticatedRosterClient, databaseScope, prefix, ids },
        { allowPartial: true },
      )
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Registration fixture creation and cleanup failed.")
    }
    throw error
  }
}

async function cleanupRegistrationWorkflowFixture(fixture, { allowPartial = false } = {}) {
  const client = fixture?.client
  const authenticatedRosterClient = fixture?.authenticatedRosterClient
  const ids = fixture?.ids
  if (!client || !authenticatedRosterClient || !ids) return
  const cleanupErrors = []
  await captureBrowserFixtureCleanup(cleanupErrors, "roster cleanup", () =>
    removeRosterPairs(authenticatedRosterClient, [
      { studentId: ids.student, classId: ids.class },
    ], `${UI_REGISTRATION_PREFIX} roster cleanup`, { allowMissing: allowPartial }),
  )
  for (const table of [
    "ops_registration_messages",
    "ops_task_events",
    "ops_task_comments",
    "ops_task_attachments",
    "ops_registration_details",
  ]) {
    await captureBrowserFixtureCleanup(cleanupErrors, `${table} cleanup`, () =>
      deleteByIds(client, table, "task_id", [ids.task]),
    )
  }
  await captureBrowserFixtureCleanup(cleanupErrors, "ops_tasks cleanup", () =>
    deleteByIds(client, "ops_tasks", "id", [ids.task]),
  )
  const archive = await captureBrowserFixtureCleanup(cleanupErrors, "audit fixture archive", () =>
    archiveAuditFixtures(client, {
      taskIds: [ids.task],
      studentIds: [ids.student],
      classIds: [ids.class],
      prefix: fixture.prefix,
    }),
  )
  if (archive && (archive.activeFixtureRows !== 0 || (!allowPartial && archive.auditHistoryRetained < 2))) {
    cleanupErrors.push(new Error(`Registration fixture archive verification failed: ${JSON.stringify(archive)}`))
  }
  if (archive) printAuditFixtureResetInstruction(fixture.databaseScope)
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Browser fixture cleanup failed.")
  return archive
}

async function readRegistrationWorkflowState(fixture) {
  const { client, ids } = fixture
  const [taskResult, detailResult, studentResult, classResult, historyResult] = await Promise.all([
    client.from("ops_tasks").select("id,status").eq("id", ids.task).maybeSingle(),
    client.from("ops_registration_details").select("pipeline_status").eq("task_id", ids.task).maybeSingle(),
    client.from("students").select("class_ids,waitlist_class_ids").eq("id", ids.student).maybeSingle(),
    client.from("classes").select("student_ids,waitlist_ids").eq("id", ids.class).maybeSingle(),
    client.from("student_class_enrollment_history").select("action").eq("student_id", ids.student).eq("class_id", ids.class),
  ])
  for (const [label, result] of Object.entries({ taskResult, detailResult, studentResult, classResult, historyResult })) {
    if (result.error) throw new Error(`${label}: ${result.error.message}`)
  }
  return {
    task: taskResult.data || {},
    detail: detailResult.data || {},
    student: studentResult.data || {},
    classRow: classResult.data || {},
    history: historyResult.data || [],
  }
}

async function waitForRegistrationWorkflowState(fixture, expectedStatus, expectedWaitlist, timeoutMs = 15000) {
  const startedAt = Date.now()
  let state = null
  while (Date.now() - startedAt < timeoutMs) {
    state = await readRegistrationWorkflowState(fixture)
    const waitlistLinked = includesId(state.student.waitlist_class_ids, fixture.ids.class) &&
      includesId(state.classRow.waitlist_ids, fixture.ids.student)
    const enrolled = includesId(state.student.class_ids, fixture.ids.class) ||
      includesId(state.classRow.student_ids, fixture.ids.student)
    const hasWaitlistHistory = state.history.some((item) => item.action === "waitlist")
    const historyReady = !expectedWaitlist || hasWaitlistHistory
    if (state.detail.pipeline_status === expectedStatus && waitlistLinked === expectedWaitlist && !enrolled && historyReady) return state
    await new Promise((resolveReady) => setTimeout(resolveReady, 250))
  }
  throw new Error(`Registration workflow did not reach ${expectedStatus} with waitlist=${expectedWaitlist}.`)
}

async function openRegistrationFixtureDetail(page, baseUrl, flow, fixture) {
  const route = {
    path: `/admin/registration?flow=${flow}`,
    name: `registration-${flow}`,
    expectedTexts: ["등록", "등록 추가"],
  }
  await page.goto(joinUrl(baseUrl, route.path), { waitUntil: "networkidle" })
  await waitForRouteText(page, route)
  await openOperationSampleDetail(page, fixture.title)
  const detailDialog = page.getByRole("dialog").filter({ hasText: fixture.title }).first()
  await detailDialog.waitFor({ state: "visible", timeout: 5000 })
  return detailDialog
}

async function waitForRegistrationMessageReadiness(messageDialog, timeoutMs = 10000) {
  const startedAt = Date.now()
  let messageText = ""
  while (Date.now() - startedAt < timeoutMs) {
    messageText = await messageDialog.innerText({ timeout: 2000 }).catch(() => "")
    if (messageText.includes("SOLAPI 연결됨") || messageText.includes("검수/설정 대기")) return messageText
    await new Promise((resolveReady) => setTimeout(resolveReady, 250))
  }
  throw new Error(`Registration message readiness did not finish. Visible text: ${messageText.replace(/\s+/g, " ").slice(0, 300)}`)
}

async function assertLocatorFitsViewport(page, locator, label) {
  const [box, viewport] = await Promise.all([
    locator.boundingBox(),
    Promise.resolve(page.viewportSize()),
  ])
  if (!box || !viewport) throw new Error(`${label} bounds could not be measured.`)
  const tolerance = 1
  if (
    box.x < -tolerance ||
    box.y < -tolerance ||
    box.x + box.width > viewport.width + tolerance ||
    box.y + box.height > viewport.height + tolerance
  ) {
    throw new Error(`${label} is outside the viewport: ${JSON.stringify({ box, viewport })}`)
  }
  return box
}

async function verifyRegistrationWorkflowSet(page, baseUrl, viewportName, loginId, password, artifactDir) {
  let fixture = null
  try {
    fixture = await createRegistrationWorkflowFixture(viewportName, loginId, password)
    let detailDialog = await openRegistrationFixtureDetail(page, baseUrl, "consulting", fixture)
    const decisionButton = detailDialog.getByRole("button", { name: /상담 결과 선택|결과 선택/ }).last()
    await waitUntilEnabled(decisionButton, "registration decision button")
    await decisionButton.click()
    const waitlistDecision = page.getByRole("menuitem", { name: "현재반 대기", exact: true }).last()
    await waitUntilEnabled(waitlistDecision, "registration waitlist decision")
    await waitlistDecision.click()
    const waitlistState = await waitForRegistrationWorkflowState(fixture, "4-1. 현재반 대기 신청", true)
    if (!waitlistState.history.some((item) => item.action === "waitlist")) {
      throw new Error("Registration waitlist history was not recorded.")
    }

    await page.keyboard.press("Escape").catch(() => {})
    detailDialog = await openRegistrationFixtureDetail(page, baseUrl, "waiting", fixture)
    const enrollmentDecision = detailDialog.getByRole("button", { name: "다음: 입학 등록 결정", exact: true }).last()
    await waitUntilEnabled(enrollmentDecision, "registration enrollment decision")
    await enrollmentDecision.click()
    await waitForRegistrationWorkflowState(fixture, "5. 입학 등록 결정", false)

    await page.keyboard.press("Escape").catch(() => {})
    detailDialog = await openRegistrationFixtureDetail(page, baseUrl, "enrollment", fixture)
    const messageButton = detailDialog.getByRole("button", { name: "입학신청서 발송", exact: true }).last()
    await waitUntilEnabled(messageButton, "registration admission message button")
    await messageButton.click()
    const messageDialog = page.getByRole("dialog").filter({ hasText: "입학신청서 발송" }).last()
    await messageDialog.waitFor({ state: "visible", timeout: 5000 })
    const messageText = await waitForRegistrationMessageReadiness(messageDialog)
    const messageDialogBounds = await assertLocatorFitsViewport(page, messageDialog, "Registration message dialog")
    for (const expectedText of ["알림톡 미리보기", "메이크에듀용 내용 복사", "입학신청서 열기"]) {
      if (!messageText.includes(expectedText)) throw new Error(`Registration message dialog is missing ${expectedText}.`)
    }
    if (!messageText.includes("SOLAPI 연결됨") && !messageText.includes("검수/설정 대기")) {
      throw new Error("Registration message dialog did not show the SOLAPI readiness state.")
    }
    const sendButton = messageDialog.getByRole("button", { name: "알림톡 발송", exact: true }).last()
    if (messageText.includes("검수/설정 대기") && !(await sendButton.isDisabled().catch(() => false))) {
      throw new Error("Registration AlimTalk send button should stay disabled before template configuration.")
    }
    const screenshotPath = await writeDebugArtifacts(page, artifactDir, `registration-workflow-${viewportName}`, { fullPage: false })

    return {
      waitlistLinked: true,
      waitlistRemovedOnEnrollmentDecision: true,
      messageDialogReady: true,
      messageDialogBounds,
      screenshotPath,
    }
  } finally {
    if (fixture) await cleanupRegistrationWorkflowFixture(fixture)
  }
}

async function createTemporaryBrowserUserStorage(baseUrl) {
  const supabaseUrl = env("SUPABASE_URL", env("NEXT_PUBLIC_SUPABASE_URL", env("VITE_SUPABASE_URL")))
  const supabaseAnonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY", env("VITE_SUPABASE_ANON_KEY"))
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY", env("SUPABASE_SERVICE_KEY"))
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    throw new Error("OPS_BROWSER_TEMP_USER=1 requires SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.")
  }

  const { createClient } = await importSupabaseClient()
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  const uniqueToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const loginId = `${TEMP_USER_PREFIX}-${uniqueToken}`
  const email = `${loginId}@${DEFAULT_LOGIN_EMAIL_DOMAIN}`
  const password = `Codex-${uniqueToken}-42!`
  let userId = ""

  const cleanup = async () => {
    if (!userId) return
    try {
      await adminClient.from("profiles").delete().eq("id", userId).throwOnError()
    } catch {}
    await adminClient.auth.admin.deleteUser(userId).catch(() => {})
  }

  try {
    const created = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: "Codex 브라우저 검증",
      },
    })
    if (created.error || !created.data.user?.id) {
      throw new Error(`Temporary browser user creation failed: ${created.error?.message || "missing user id"}`)
    }
    userId = created.data.user.id

    const profilePayload = {
      id: userId,
      email,
      login_id: loginId,
      name: "Codex 브라우저 검증",
      role: "admin",
    }
    const profileResult = await adminClient.from("profiles").upsert(profilePayload)
    if (profileResult.error) throw profileResult.error

    const storageState = await createStorageStateFromSupabase(baseUrl, email, password)
    return { storageState, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

async function firstUsable(locator) {
  const count = await locator.count().catch(() => 0)
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index)
    if (await item.isVisible().catch(() => false)) return item
  }
  return locator.first()
}

async function firstVisibleText(page, text, options = {}, timeoutMs = 10000) {
  const startedAt = Date.now()
  const locator = page.getByText(text, options)
  while (Date.now() - startedAt < timeoutMs) {
    const count = await locator.count().catch(() => 0)
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index)
      if (await item.isVisible().catch(() => false)) return item
    }
    await page.waitForTimeout(250)
  }
  return locator.first()
}

async function waitUntilEnabled(locator, label, timeoutMs = 10000) {
  await locator.waitFor({ state: "visible", timeout: timeoutMs })
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await locator.isEnabled().catch(() => false)) return
    await new Promise((resolveReady) => setTimeout(resolveReady, 250))
  }
  throw new Error(`${label} did not become enabled.`)
}

async function countVisibleControls(locator, { enabledOnly = false } = {}) {
  return locator.locator('input:not([type="hidden"]), select, textarea, button').evaluateAll(
    (controls, options) => controls.filter((control) => {
        const rect = control.getBoundingClientRect()
        const style = window.getComputedStyle(control)
        const visible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
        return visible && (!options.enabledOnly || !control.matches(":disabled"))
      }).length,
    { enabledOnly },
  )
}

async function inspectVisibleSelects(locator) {
  return locator.locator("select").evaluateAll((selects) =>
    selects
      .filter((select) => {
        const rect = select.getBoundingClientRect()
        const style = window.getComputedStyle(select)
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
      })
      .map((select) => ({
        label: select.getAttribute("aria-label") || select.labels?.[0]?.textContent?.trim() || "",
        optionCount: select.options.length,
        firstOption: select.options[0]?.textContent?.trim() || "",
      })),
  )
}

async function verifyInitialSelectControls(dialog, route) {
  const selects = await inspectVisibleSelects(dialog)
  const unlabeledSelects = selects.filter((select) => !select.label)
  if (unlabeledSelects.length > 0) {
    throw new Error(`${route.name} has unlabeled select controls: ${unlabeledSelects.length}.`)
  }

  const denseSelects = selects.filter((select) => select.optionCount > MAX_INITIAL_SELECT_OPTIONS)
  if (denseSelects.length > 0) {
    const details = denseSelects.map((select) => `${select.label || "select"}:${select.optionCount}`).join(", ")
    throw new Error(`${route.name} first step has dense select controls: ${details}.`)
  }
}

async function verifyRegistrationSinglePageDialog(dialog) {
  const dialogText = await dialog.innerText({ timeout: 5000 })
  const applicationSections = [
    ["inquiry", "문의 정보"],
    ["level_test", "레벨테스트"],
    ["consultation", "상담"],
    ["placement", "등록·대기 정보"],
    ["admission", "입학 처리"],
  ]
  for (const [sectionId, title] of applicationSections) {
    const section = dialog.locator(`[data-registration-application-section="${sectionId}"]`)
    if (await section.count() !== 1 || !(await section.isVisible().catch(() => false))) {
      throw new Error(`registration dialog is missing its fixed ${title} section.`)
    }
    if (!(await section.innerText()).includes(title)) {
      throw new Error(`registration dialog section ${sectionId} is missing ${title}.`)
    }
  }
  if (/\b1\/4\b/.test(dialogText)) throw new Error("registration dialog still shows the old step progress label.")
  if (await dialog.getByRole("group", { name: /등록 입력 단계/ }).count().catch(() => 0)) {
    throw new Error("registration dialog still shows the old input tabs.")
  }
  if (dialogText.includes("현재 업무")) {
    throw new Error("registration dialog still renders a split 현재 업무 editor.")
  }
  if (await dialog.locator('[data-registration-application-section="history"]').count() > 0) {
    throw new Error("registration dialog still renders automatic history as an inline application section.")
  }
  if (!(await dialog.getByLabel("학생명", { exact: true }).isEnabled().catch(() => false))) {
    throw new Error("registration inquiry fields are not enabled.")
  }

  const lockedSections = dialog.locator('[data-registration-application-section] [role="group"][aria-disabled="true"]')
  if (await lockedSections.count() === 0) {
    throw new Error("registration dialog does not expose visible-but-locked future sections with aria-disabled.")
  }
  const lockReasons = await lockedSections.locator('[id$="-lock-reason"]').allInnerTexts().catch(() => [])
  if (!lockReasons.some((reason) => reason.trim().length > 0)) {
    throw new Error("registration dialog locked sections do not explain why they are unavailable.")
  }

  const page = dialog.page()
  const detachedAppointmentEditors = page.locator('section[aria-label="레벨테스트 예약"], section[aria-label="방문상담 예약"]')
  const appointmentEditorCount = await detachedAppointmentEditors.count().catch(() => 0)
  for (let index = 0; index < appointmentEditorCount; index += 1) {
    const isInsideApplicationHost = await detachedAppointmentEditors.nth(index).evaluate((element) => (
      Boolean(element.closest('[data-registration-application-host]'))
    ))
    if (!isInsideApplicationHost) {
      throw new Error("registration appointment editor escaped the common application host.")
    }
  }
}

async function verifyFlatOperationDialog(dialog, route) {
  const dialogText = await dialog.innerText({ timeout: 5000 })
  if (new RegExp(`${route.expectedTexts[0]}\\s+1\\/\\d+`).test(dialogText)) {
    throw new Error(`${route.name} dialog still shows the old step progress label.`)
  }
  if (await dialog.getByRole("group", { name: `${route.expectedTexts[0]} 입력 단계` }).count().catch(() => 0)) {
    throw new Error(`${route.name} dialog still shows the old input tabs.`)
  }
}

async function clickDeleteInTaskDialog(page, sampleTitle) {
  const detailDialog = page.getByRole("dialog").filter({ hasText: sampleTitle }).first()
  if (!(await detailDialog.isVisible().catch(() => false))) return false

  const deleteButton = detailDialog.getByRole("button", { name: /삭제/ }).last()
  await waitUntilEnabled(deleteButton, "Todo delete button")
  await deleteButton.click()

  const confirmDialog = page.getByRole("dialog").last()
  await confirmDialog.waitFor({ state: "visible", timeout: 5000 })
  const confirmButton = confirmDialog.getByRole("button", { name: /^삭제$/ }).last()
  await waitUntilEnabled(confirmButton, "Todo delete confirm button")
  await confirmButton.click()
  return true
}

async function completeTodoFromDetailDialog(detailDialog) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await detailDialog.getByRole("button", { name: "다시 열기" }).isVisible().catch(() => false)) return true

    const nextAction = await firstUsable(
      detailDialog.getByRole("button", { name: /^(확인|시작|검토 요청|완료)$/ }),
    )
    if (!(await nextAction.isVisible().catch(() => false))) return false
    if (!(await nextAction.isEnabled().catch(() => false))) return false
    await waitUntilEnabled(nextAction, "Todo completion step button")
    await nextAction.click()
    await new Promise((resolveReady) => setTimeout(resolveReady, 300))
  }

  return Boolean(await detailDialog.getByRole("button", { name: "다시 열기" }).isVisible().catch(() => false))
}

async function cleanupQuickAddSample(page, sampleTitle) {
  if (!(await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).includes(sampleTitle)) return

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await clickDeleteInTaskDialog(page, sampleTitle).catch(() => false)) return

    await page.keyboard.press("Escape").catch(() => {})
    const createdRow = await firstVisibleText(page, sampleTitle, { exact: false })
    if (await createdRow.isVisible().catch(() => false)) {
      await createdRow.click().catch(() => {})
    }
  }
}

async function fillFirst(page, selector, value, label) {
  const target = await firstUsable(page.locator(selector))
  if (!(await target.count().catch(() => 0))) {
    throw new Error(`Login ${label} input was not found.`)
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await target.fill(value)
    await page.waitForTimeout(150)
    const currentValue = await target.inputValue().catch(() => "")
    if (currentValue === value) return
  }

  throw new Error(`Login ${label} input did not retain the filled value.`)
}

async function clickLogin(page) {
  const loginButton = page
    .getByRole("button", { name: /로그인|sign in|log in/i })
    .or(page.locator('button[type="submit"]'))
    .first()
  if (!(await loginButton.count().catch(() => 0))) throw new Error("Login submit button was not found.")
  await waitUntilEnabled(loginButton, "Login submit button")
  await loginButton.click()
}

async function writeDebugArtifacts(page, artifactDir, name, options = {}) {
  if (!artifactDir) return ""
  mkdirSync(artifactDir, { recursive: true })
  const safeName = name.replace(/[^a-z0-9_.-]+/gi, "-").replace(/^-|-$/g, "")
  const screenshotPath = resolve(artifactDir, `${safeName}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: options.fullPage ?? true }).catch(() => {})
  return screenshotPath
}

async function waitForRouteText(page, route, timeoutMs = 15000) {
  const startedAt = Date.now()
  let lastText = ""

  while (Date.now() - startedAt < timeoutMs) {
    lastText = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "")
    const isSignedInRoute = !new URL(page.url()).pathname.includes("/sign-in")
    const hasExpectedText = route.expectedTexts.every((expectedText) => lastText.includes(expectedText))
    if (isSignedInRoute && lastText.length >= 20 && hasExpectedText) return lastText
    await page.waitForTimeout(250)
  }

  return lastText
}

async function waitForBodyToExclude(page, text, timeoutMs = 10000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const bodyText = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "")
    if (!bodyText.includes(text)) return
    await page.waitForTimeout(250)
  }
  throw new Error(`Page still contained deleted sample text: ${text}`)
}

async function verifySingleQuickAddInteraction(page, sampleIndex) {
  const sampleTitle = `${UI_SAMPLE_PREFIX} ${Date.now()}-${sampleIndex}-${Math.random().toString(36).slice(2, 8)}`
  const editedTitle = `${sampleTitle} 수정`
  const input = page.getByTestId("todo-quick-add-input").or(page.getByLabel("할 일 빠른 추가")).first()
  if (!(await input.count().catch(() => 0))) throw new Error("Todo quick-add input was not found.")

  try {
    await input.fill(`${sampleTitle} 내일 오전 10시까지`)
    const preview = page.getByTestId("todo-quick-add-preview")
    await preview.getByText("내일 10:00", { exact: false }).waitFor({ state: "visible", timeout: 5000 })
      .catch(() => {
        throw new Error("Todo quick-add preview did not parse the Korean due suffix.")
      })

    const addButton = page.getByTestId("todo-quick-add-submit").or(page.getByRole("button", { name: /할 일 추가|추가/ })).last()
    await waitUntilEnabled(addButton, "Todo add button")
    await addButton.click()

    const createdRow = await firstVisibleText(page, sampleTitle, { exact: false })
    await createdRow.waitFor({ state: "visible", timeout: 10000 })
    await createdRow.click()

    const detailDialog = page.getByRole("dialog").filter({ hasText: sampleTitle }).first()
    await detailDialog.waitFor({ state: "visible", timeout: 5000 })
    const detailText = await detailDialog.innerText({ timeout: 5000 })
    const detailTokens = detailText.split(/\s+/).filter(Boolean)
    for (const hiddenStatus of ["요청", "진행", "보류", "취소"]) {
      if (detailTokens.includes(hiddenStatus)) {
        throw new Error(`Todo detail leaked workflow status "${hiddenStatus}" for a simple todo.`)
      }
    }

    const editButton = detailDialog.getByRole("button", { name: "수정" }).last()
    await waitUntilEnabled(editButton, "Todo edit button")
    await editButton.click()

    const editDialog = page.getByRole("dialog").filter({ hasText: "할 일 수정" }).first()
    await editDialog.waitFor({ state: "visible", timeout: 5000 })
    await editDialog.getByLabel("제목").fill(editedTitle)
    const saveButton = editDialog.getByRole("button", { name: "저장" }).last()
    await waitUntilEnabled(saveButton, "Todo save button")
    await saveButton.click()
    await editDialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {})

    const editedRow = await firstVisibleText(page, editedTitle, { exact: false })
    await editedRow.waitFor({ state: "visible", timeout: 10000 })
    await editedRow.click()

    const editedDetailDialog = page.getByRole("dialog").filter({ hasText: editedTitle }).first()
    await editedDetailDialog.waitFor({ state: "visible", timeout: 5000 })
    await completeTodoFromDetailDialog(editedDetailDialog)

    if (!(await clickDeleteInTaskDialog(page, editedTitle))) {
      throw new Error("Todo detail dialog was not opened for the edited quick-add sample.")
    }
    await waitForBodyToExclude(page, editedTitle)
  } catch (error) {
    await cleanupQuickAddSample(page, editedTitle)
    await cleanupQuickAddSample(page, sampleTitle)
    throw error
  }
}

async function verifyQuickAddInteraction(page, sampleCount = DEFAULT_QUICK_ADD_SAMPLE_COUNT) {
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    await verifySingleQuickAddInteraction(page, sampleIndex + 1)
  }
  return { samplesCreated: sampleCount }
}

async function isFillableFormControl(field) {
  return field.evaluate((element) => {
    const tagName = element.tagName.toLowerCase()
    return tagName === "input" || tagName === "textarea" || element.getAttribute("contenteditable") === "true"
  }).catch(() => false)
}

async function fillIfPresent(scope, label, value) {
  const field = scope.getByLabel(label, { exact: true }).first()
  if (!(await field.count().catch(() => 0))) return false
  await field.waitFor({ state: "visible", timeout: 5000 })
  if (!(await isFillableFormControl(field))) return false
  await field.fill(value)
  return true
}

async function selectDateIfPresent(page, scope, label, value) {
  const field = scope.getByLabel(label, { exact: true }).first()
  if (!(await field.count().catch(() => 0))) return false
  await field.waitFor({ state: "visible", timeout: 5000 })
  await field.click()
  await page.getByRole("gridcell", { name: new RegExp(`${value}.*선택`) }).first().click()
  return true
}

async function selectManualIfPresent(page, scope, label) {
  const field = scope.getByLabel(label, { exact: true }).first()
  if (!(await field.count().catch(() => 0))) return false
  const tagName = await field.evaluate((element) => element.tagName.toLowerCase()).catch(() => "")
  if (tagName === "select") {
    await field.selectOption("__manual__")
    return true
  }

  await field.click()
  const manualOption = page
    .getByRole("option", { name: /직접 입력/ })
    .or(page.getByText("직접 입력", { exact: true }))
    .first()
  await manualOption.waitFor({ state: "visible", timeout: 5000 })
  await manualOption.click()
  return true
}

async function selectListboxOptionIfPresent(page, scope, label, optionLabel) {
  const field = scope.getByLabel(label, { exact: true }).first()
  if (!(await field.count().catch(() => 0))) return false
  await field.waitFor({ state: "visible", timeout: 5000 })
  await field.click()
  const option = page.getByRole("option", { name: optionLabel, exact: true }).first()
  await option.waitFor({ state: "visible", timeout: 5000 })
  await option.click()
  return true
}

async function fillOperationMinimumFields(page, dialog, route, sampleName) {
  if (route.name === "registration") {
    if (!(await fillIfPresent(dialog, "학생명", sampleName))) {
      throw new Error("Registration student name input was not found.")
    }
    const englishSubject = dialog.getByRole("button", { name: "영어", exact: true }).first()
    await englishSubject.waitFor({ state: "visible", timeout: 5000 })
    await englishSubject.click()
    if (!(await fillIfPresent(dialog, "학부모 전화", "010-1234-5678"))) {
      throw new Error("Registration parent phone input was not found.")
    }
    if (!(await selectListboxOptionIfPresent(page, dialog, "학년", "고1"))) {
      throw new Error("Registration grade listbox was not found.")
    }
    await fillIfPresent(dialog, "학교", "테스트")
    return
  }

  await selectManualIfPresent(page, dialog, "학생")
  if (!(await fillIfPresent(dialog, "학생명", sampleName))) {
    throw new Error(`${route.name} student name input was not found after manual selection.`)
  }
  await fillIfPresent(dialog, "수업명", `${sampleName} 수업`)
  await fillIfPresent(dialog, "전반사유", "브라우저 검증")
  await fillIfPresent(dialog, "고객 퇴원사유", "브라우저 검증")
  await selectDateIfPresent(page, dialog, "본시험일", new Date().toISOString().slice(0, 10))
}

async function openOperationSampleDetail(page, sampleName) {
  const detailButtons = page.getByRole("button", { name: /(상세 열기|상세 보기)$/ })
  const count = await detailButtons.count().catch(() => 0)
  for (let index = 0; index < count; index += 1) {
    const button = detailButtons.nth(index)
    const label = await button.getAttribute("aria-label").catch(() => "")
    if (!label?.includes(sampleName) || !(await button.isVisible().catch(() => false))) continue
    await button.click()
    return
  }
  throw new Error(`Operation detail button was not found for ${sampleName}.`)
}

async function verifySingleCreateDialogInteraction(page, route, sampleIndex) {
  const sampleName = `${UI_SAMPLE_PREFIX} ${route.name} ${Date.now()}-${sampleIndex}-${Math.random().toString(36).slice(2, 8)}`
  const editedTitle = `${UI_SAMPLE_PREFIX} ${route.name} 수정 ${Date.now()}-${sampleIndex}`
  const createButtonName = route.expectedTexts[1]
  const addButton = page.getByRole("button", { name: createButtonName, exact: true }).last()
  if (!(await addButton.count().catch(() => 0))) throw new Error(`${route.name} create button was not found.`)

  try {
    await waitUntilEnabled(addButton, `${route.name} create button`)
    await addButton.click()

    const dialog = page.getByRole("dialog").first()
    await dialog.waitFor({ state: "visible", timeout: 5000 })
    const dialogText = await dialog.innerText({ timeout: 5000 })
    if (!dialogText.includes(route.expectedTexts[0])) throw new Error(`${route.name} dialog did not show the operation name.`)
    if (route.name === "registration") {
      await verifyRegistrationSinglePageDialog(dialog)
    } else if (route.name === "word-retests") {
      if (!dialogText.includes("진행상태")) throw new Error("word-retests dialog did not show the progress stepper.")
    } else {
      await verifyFlatOperationDialog(dialog, route)
    }
    const visibleControls = await countVisibleControls(dialog, { enabledOnly: route.name === "registration" })
    const maxVisibleControls = route.name === "registration" ? 32 : MAX_INITIAL_TEMPLATE_CONTROLS
    if (visibleControls > maxVisibleControls) {
      throw new Error(`${route.name} first step is too dense: ${visibleControls} visible controls.`)
    }
    await verifyInitialSelectControls(dialog, route)
    if (route.name === "word-retests") {
      for (const expectedLabel of ["담당선생님", "수업", "학생", "본시험일", "장소", "교재", "시험범위", "커트라인(맞은 개수)", "출제 개수"]) {
        if (!dialogText.includes(expectedLabel)) throw new Error(`word-retests dialog is missing ${expectedLabel}.`)
      }
      await page.keyboard.press("Escape").catch(() => {})
      await dialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {})
      return { openedDialog: true }
    }
    await fillOperationMinimumFields(page, dialog, route, sampleName)

    const saveButton = dialog.getByRole("button", { name: "저장" }).last()
    await waitUntilEnabled(saveButton, `${route.name} save button`)
    await saveButton.click()
    await dialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {})

    await openOperationSampleDetail(page, sampleName)

    const detailDialog = page.getByRole("dialog").filter({ hasText: sampleName }).first()
    await detailDialog.waitFor({ state: "visible", timeout: 5000 })
    const editButton = detailDialog.getByRole("button", { name: "수정" }).last()
    await waitUntilEnabled(editButton, `${route.name} edit button`)
    await editButton.click()

    const editDialog = page.getByRole("dialog").filter({ hasText: `${route.expectedTexts[0]} 수정` }).first()
    await editDialog.waitFor({ state: "visible", timeout: 5000 })
    if (route.name === "registration") {
      if (!(await fillIfPresent(editDialog, "학교", "테스트 수정"))) {
        throw new Error("Registration common school field was not found during edit.")
      }
    } else {
      await editDialog.getByLabel("제목 직접 지정").fill(editedTitle)
    }
    const updateButton = editDialog.getByRole("button", { name: "저장" }).last()
    await waitUntilEnabled(updateButton, `${route.name} update button`)
    await updateButton.click()
    await editDialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {})

    const editedOperationRowLabel = sampleName
    await openOperationSampleDetail(page, editedOperationRowLabel)

    const editedDetailText = route.name === "registration" ? sampleName : editedTitle
    if (!(await clickDeleteInTaskDialog(page, editedDetailText))) {
      throw new Error(`${route.name} detail dialog was not opened for the edited sample.`)
    }
    await waitForBodyToExclude(page, editedDetailText)
  } catch (error) {
    await cleanupQuickAddSample(page, editedTitle)
    await cleanupQuickAddSample(page, sampleName)
    throw error
  }
}

async function verifyCreateDialogInteraction(page, route, sampleCount = DEFAULT_OPERATION_SAMPLE_COUNT) {
  let openedDialogs = 0
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const result = await verifySingleCreateDialogInteraction(page, route, sampleIndex + 1)
    if (result?.openedDialog) openedDialogs += 1
  }
  if (openedDialogs > 0) return { openedDialogs }
  return { samplesCreated: sampleCount }
}

async function verifyOperationCompletionInteraction(page, baseUrl, task) {
  const route = { path: task.routePath, name: task.key, expectedTexts: task.routeExpectedTexts }
  await page.goto(joinUrl(baseUrl, task.routePath), { waitUntil: "networkidle" })
  await waitForRouteText(page, route)

  await openOperationSampleDetail(page, task.title)

  const detailDialog = page.getByRole("dialog").filter({ hasText: task.title }).first()
  await detailDialog.waitFor({ state: "visible", timeout: 5000 })
  const actionButton = task.key === "registration"
    ? detailDialog.getByRole("button", { name: "다음: 등록 완료" }).last()
    : detailDialog.getByRole("button", { name: "완료" }).last()
  await waitUntilEnabled(actionButton, `${task.key} completion button`, 15000)
  await actionButton.click()

  await detailDialog.getByText("반영 완료", { exact: false }).waitFor({ state: "visible", timeout: 20000 })
  await page.keyboard.press("Escape").catch(() => {})
  await page.goto(joinUrl(baseUrl, task.routePath), { waitUntil: "networkidle" })
  await waitForRouteText(page, route)
  await waitForBodyToExclude(page, task.title, 15000)
}

function taskRowById(rows, id) {
  return rows.find((row) => String(row.id || "") === String(id || "")) || {}
}

function detailRowByTaskId(rows, taskId) {
  return rows.find((row) => String(row.task_id || "") === String(taskId || "")) || {}
}

async function verifyOperationCompletionSync(fixtureSet, completedTaskKeys) {
  const { client, ids } = fixtureSet
  const taskIds = Object.values(ids.tasks)
  const studentIds = Object.values(ids.students)
  const classIds = Object.values(ids.classes)
  const [
    taskRows,
    studentRows,
    classRows,
    registrationRows,
    withdrawalRows,
    transferRows,
    wordRetestRows,
  ] = await Promise.all([
    client.from("ops_tasks").select("id,status,student_id,class_id,textbook_id,student_name,class_name,textbook_title").in("id", taskIds),
    client.from("students").select("id,status,class_ids,waitlist_class_ids").in("id", studentIds),
    client.from("classes").select("id,student_ids,waitlist_ids,textbook_ids").in("id", classIds),
    client.from("ops_registration_details").select("*").eq("task_id", ids.tasks.registration),
    client.from("ops_withdrawal_details").select("*").eq("task_id", ids.tasks.withdrawal),
    client.from("ops_transfer_details").select("*").eq("task_id", ids.tasks.transfer),
    client.from("ops_word_retests").select("*").eq("task_id", ids.tasks.wordRetest),
  ].map(async (query, index) => {
    const result = await query
    if (result.error) throw new Error(`operationCompletionSync query ${index + 1}: ${result.error.message}`)
    return result.data || []
  }))

  const registrationTask = taskRowById(taskRows, ids.tasks.registration)
  const withdrawalTask = taskRowById(taskRows, ids.tasks.withdrawal)
  const transferTask = taskRowById(taskRows, ids.tasks.transfer)
  const wordRetestTask = taskRowById(taskRows, ids.tasks.wordRetest)
  const registrationStudent = taskRowById(studentRows, ids.students.registration)
  const withdrawalStudent = taskRowById(studentRows, ids.students.withdrawal)
  const transferStudent = taskRowById(studentRows, ids.students.transfer)
  const registrationClass = taskRowById(classRows, ids.classes.registration)
  const withdrawalClass = taskRowById(classRows, ids.classes.withdrawal)
  const transferFromClass = taskRowById(classRows, ids.classes.transferFrom)
  const transferToClass = taskRowById(classRows, ids.classes.transferTo)
  const registrationDetail = detailRowByTaskId(registrationRows, ids.tasks.registration)
  const withdrawalDetail = detailRowByTaskId(withdrawalRows, ids.tasks.withdrawal)
  const transferDetail = detailRowByTaskId(transferRows, ids.tasks.transfer)
  const wordRetestDetail = detailRowByTaskId(wordRetestRows, ids.tasks.wordRetest)

  const operationCompletionSync = {
    registration_student_linked:
      registrationTask.status === "done" &&
      String(registrationTask.student_id || "") === ids.students.registration &&
      String(registrationTask.class_id || "") === ids.classes.registration &&
      includesId(registrationStudent.class_ids, ids.classes.registration) &&
      includesId(registrationClass.student_ids, ids.students.registration),
    registration_textbook_linked:
      String(registrationTask.textbook_id || "") === ids.textbooks.registration &&
      includesId(registrationClass.textbook_ids, ids.textbooks.registration) &&
      registrationDetail.pipeline_status === "7. 등록 완료" &&
      registrationDetail.textbook_ready === true,
    withdrawal_unlinked:
      withdrawalTask.status === "done" &&
      !includesId(withdrawalStudent.class_ids, ids.classes.withdrawal) &&
      !includesId(withdrawalClass.student_ids, ids.students.withdrawal),
    withdrawal_status_applied:
      withdrawalStudent.status === "퇴원" &&
      withdrawalDetail.timetable_roster_updated === true,
    transfer_removed_from_old_class:
      transferTask.status === "done" &&
      !includesId(transferStudent.class_ids, ids.classes.transferFrom) &&
      !includesId(transferFromClass.student_ids, ids.students.transfer),
    transfer_assigned_to_new_class:
      String(transferTask.class_id || "") === ids.classes.transferTo &&
      includesId(transferStudent.class_ids, ids.classes.transferTo) &&
      includesId(transferToClass.student_ids, ids.students.transfer) &&
      transferDetail.timetable_roster_updated === true,
    word_retest_links_resolved:
      wordRetestTask.status === "done" &&
      String(wordRetestTask.student_id || "") === ids.students.wordRetest &&
      String(wordRetestTask.class_id || "") === ids.classes.wordRetest &&
      String(wordRetestTask.textbook_id || "") === ids.textbooks.wordRetest &&
      String(wordRetestDetail.teacher_catalog_id || "") === ids.teacher &&
      wordRetestDetail.retest_status === "done",
  }

  const completionPrefixes = {
    registration: "registration_",
    withdrawal: "withdrawal_",
    transfer: "transfer_",
    wordRetest: "word_retest_",
  }
  const selectedPrefixes = completedTaskKeys.map((key) => completionPrefixes[key]).filter(Boolean)
  const scopedCompletionSync = Object.fromEntries(
    Object.entries(operationCompletionSync).filter(([key]) => selectedPrefixes.some((prefix) => key.startsWith(prefix))),
  )
  const failed = Object.entries(scopedCompletionSync)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  if (failed.length > 0) {
    throw new Error(`Operation completion sync failed: ${failed.join(", ")}`)
  }

  return scopedCompletionSync
}

async function verifyOperationCompletionSet(page, baseUrl, viewportName, loginId, password) {
  let fixtureSet = null
  try {
    fixtureSet = await createOperationCompletionFixtures(viewportName, loginId, password)
    const operationFilter = env("OPS_BROWSER_OPERATION_COMPLETE_FILTER")
    const filterTerms = operationFilter.split(",").map((term) => term.trim()).filter(Boolean)
    const completedTasks = filterTerms.length > 0
      ? fixtureSet.tasks.filter((task) => filterTerms.some((term) => task.key.toLowerCase().includes(term.toLowerCase())))
      : fixtureSet.tasks
    if (completedTasks.length === 0) {
      throw new Error(`OPS_BROWSER_OPERATION_COMPLETE_FILTER matched no tasks: ${operationFilter}`)
    }
    for (const task of completedTasks) {
      await verifyOperationCompletionInteraction(page, baseUrl, task)
    }
    const operationCompletionSync = await verifyOperationCompletionSync(fixtureSet, completedTasks.map((task) => task.key))
    return {
      completedOperationSamples: completedTasks.length,
      operationCompletionSync,
    }
  } finally {
    if (fixtureSet) await cleanupOperationCompletionFixtures(fixtureSet)
  }
}

async function verifyWordRetestModeInteraction(page) {
  const teacherButton = await firstUsable(
    page.locator('button, [role="button"]').filter({ hasText: /담당\s*선생님/ }),
  )
  const assistantButton = await firstUsable(
    page.locator('button, [role="button"]').filter({ hasText: /조교\s*선생님/ }),
  )
  if (!(await teacherButton.count().catch(() => 0))) throw new Error("Word retest teacher mode button was not found.")
  if (!(await assistantButton.count().catch(() => 0))) throw new Error("Word retest assistant mode button was not found.")
  if (!(await teacherButton.innerText()).includes("선생님")) throw new Error("Word retest teacher mode label is not visible.")
  if (!(await assistantButton.innerText()).includes("조교")) throw new Error("Word retest assistant mode label is not visible.")

  await waitUntilEnabled(teacherButton, "Word retest teacher mode button")
  await teacherButton.click()
  await page.waitForTimeout(300)
  const teacherRole = new URL(page.url()).searchParams.get("role")
  const teacherSelected =
    teacherRole === "teacher" ||
    (!teacherRole && (await teacherButton.isVisible().catch(() => false))) ||
    (await teacherButton.getAttribute("aria-pressed").catch(() => "")) === "true"
  if (!teacherSelected) throw new Error("Word retest teacher mode did not become selected.")

  await waitUntilEnabled(assistantButton, "Word retest assistant mode button")
  await assistantButton.click()
  await page.waitForTimeout(300)
  const assistantRole = new URL(page.url()).searchParams.get("role")
  const assistantSelected =
    assistantRole === "assistant" ||
    (await assistantButton.getAttribute("aria-pressed").catch(() => "")) === "true"
  if (!assistantSelected) throw new Error("Word retest assistant mode did not become selected.")
}

async function verifyApprovalDraftInteraction(page) {
  const bodyText = await page.locator("body").innerText({ timeout: 5000 })
  if (bodyText.includes("저장 서식\n저장 서식")) throw new Error("Approval saved-template label is duplicated.")
  if (bodyText.includes("대상") || bodyText.includes("상신")) throw new Error("Approval composer should start collapsed.")

  const templateButtons = page.getByRole("button", { name: /영어|수학|자유/ })
  if ((await templateButtons.count().catch(() => 0)) < 3) throw new Error("Approval template buttons were not found.")
  await templateButtons.first().click()

  const expandedBodyText = await page.locator("body").innerText({ timeout: 5000 })
  if (!/영어\s*·\s*\d+\/\d+/.test(expandedBodyText)) throw new Error("Approval progress badge was not found.")

  const monthInput = page.locator('input[type="month"]').first()
  if (!(await monthInput.count().catch(() => 0))) throw new Error("Approval month input was not found.")
  const targetInput = page.locator('input[placeholder*="고1 영어A"]').first()
  if (!(await targetInput.count().catch(() => 0))) throw new Error("Approval target input was not found.")
  const checklistToggle = page.getByRole("button", { name: /점검/ }).first()
  if (!(await checklistToggle.count().catch(() => 0))) throw new Error("Approval checklist toggle was not found.")
  await checklistToggle.click()
  const doneButtons = page.getByRole("button", { name: "완료" })
  const notApplicableButtons = page.getByRole("button", { name: "해당 없음" })
  if (!(await doneButtons.count().catch(() => 0))) throw new Error("Approval done state buttons were not found.")
  if (!(await notApplicableButtons.count().catch(() => 0))) throw new Error("Approval not-applicable state buttons were not found.")
  const textareas = page.locator("textarea")
  if ((await textareas.count().catch(() => 0)) < 2) throw new Error("Approval body and attachment textareas were not found.")
  const body = textareas.first()
  const attachments = textareas.nth(1)
  const titleInput = page.locator('label:has-text("제목") input').first()
  await monthInput.fill("2026-05")
  await page.waitForTimeout(50)
  await monthInput.fill("2026-07")
  await page.waitForTimeout(50)
  const titleValue = await titleInput.inputValue().catch(() => "")
  const bodyValue = await body.inputValue().catch(() => "")
  const attachmentValue = await attachments.inputValue().catch(() => "")
  if (!titleValue.includes("2026년 07월")) throw new Error("Approval title did not refresh when report month changed.")
  if (!bodyValue.includes("## 7월") || bodyValue.includes("## 5월")) throw new Error("Approval body kept a stale monthly section after report month changed.")
  if (!attachmentValue.includes("07월") || attachmentValue.includes("05월")) throw new Error("Approval attachment template kept stale month labels.")
  const submitButton = page.getByRole("button", { name: "상신" }).last()
  await body.fill("브라우저 검증")
  if (await submitButton.isDisabled().catch(() => true)) {
    const approverSelect = page.getByRole("combobox", { name: "결재자" }).first()
    if (await approverSelect.count().catch(() => 0)) {
      await approverSelect.click()
      const options = page.getByRole("option")
      const optionCount = await options.count().catch(() => 0)
      for (let index = 0; index < optionCount; index += 1) {
        const option = options.nth(index)
        const optionText = await option.innerText().catch(() => "")
        if (optionText && !optionText.includes("미정")) {
          await option.click()
          break
        }
      }
    }
  }
  if (await submitButton.isDisabled().catch(() => true)) throw new Error("Approval submit button stayed disabled after body input.")
  await body.fill("")
  if (!(await submitButton.isDisabled().catch(() => false))) throw new Error("Approval submit button stayed enabled without a body.")
}

async function verifyMakeupRequestInteraction(page) {
  const expectedColumns = [
    "상태",
    "수업",
    "과목",
    "선생님",
    "사유",
    "휴강일",
    "보강일시",
    "보강 강의실",
    "신청자",
    "상신일시",
    "보완요청일시",
    "보완 사유",
    "승인일시",
    "승인 메모",
    "반려일시",
    "반려 사유",
    "승인취소일시",
    "승인취소 메모",
    "결재자",
    "액션",
  ]
  const requiredCardLabels = [
    "사유",
    "휴강일",
    "보강일시",
    "보강 강의실",
    "신청자",
    "상신일시",
    "결재자",
  ]
  const optionalCardLabels = [
    "보완요청일시",
    "보완 사유",
    "승인일시",
    "승인 메모",
    "반려일시",
    "반려 사유",
    "승인취소일시",
    "승인취소 메모",
  ]
  const hasEmptyCardField = (text, label) => {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`${escapedLabel}\\s*-`).test(text)
  }
  const viewportWidth = await page.evaluate(() => window.innerWidth)
  const isNarrowViewport = viewportWidth < 768
  const bodyText = await page.locator("body").innerText({ timeout: 5000 })
  for (const hiddenColumn of ["신청 ID", "승인자", "관리팀 처리자", "완료일시", "완료취소일시"]) {
    if (bodyText.includes(hiddenColumn)) throw new Error(`makeup-requests table should hide ${hiddenColumn}.`)
  }

  if (isNarrowViewport) {
    const table = page.getByRole("table", { name: "휴보강 신청 데이터테이블" }).first()
    if (await table.isVisible().catch(() => false)) throw new Error("makeup-requests mobile viewport should not show the horizontal data table.")
    const cardList = page.getByRole("list", { name: "휴보강 신청 카드목록" }).first()
    if (!(await cardList.count().catch(() => 0))) throw new Error("makeup-requests mobile card list was not found.")
    await cardList.waitFor({ state: "visible", timeout: 5000 })
    const cards = cardList.locator('[role="listitem"]')
    if (await cards.count().catch(() => 0)) {
      const cardText = await cards.first().innerText({ timeout: 5000 })
      for (const label of requiredCardLabels) {
        if (!cardText.includes(label)) throw new Error(`makeup-requests mobile card is missing ${label}.`)
      }
      for (const label of optionalCardLabels) {
        if (hasEmptyCardField(cardText, label)) throw new Error(`makeup-requests mobile card should hide empty ${label}.`)
      }
      for (const duplicateLabel of ["수업", "과목", "선생님"]) {
        if (cardText.includes(duplicateLabel)) throw new Error(`makeup-requests mobile card should hide duplicate ${duplicateLabel}.`)
      }
    }
  } else {
    for (const column of expectedColumns) {
      if (!bodyText.includes(column)) throw new Error(`makeup-requests table is missing ${column}.`)
    }
    for (const label of expectedColumns.filter((column) => column !== "액션")) {
      const headerButton = page.getByRole("button", { name: `${label} 필터/정렬` }).first()
      if (!(await headerButton.count().catch(() => 0))) throw new Error(`makeup-requests header ${label} filter/sort button was not found.`)
    }
    const resizeHandle = page.getByRole("button", { name: "과목 열 너비 조절" }).first()
    if (!(await resizeHandle.count().catch(() => 0))) throw new Error("makeup-requests subject resize handle was not found.")

    const subjectHeader = page.getByRole("button", { name: "과목 필터/정렬" }).first()
    await subjectHeader.click()
    const subjectFilter = page.getByPlaceholder("과목 값 입력")
    await subjectFilter.fill("영어")
    if (!(await page.getByText("과목 오름차순").count().catch(() => 0))) {
      throw new Error("makeup-requests subject sort badge was not shown after header click.")
    }
    await subjectFilter.fill("")
  }

  const detailButton = page.getByRole("button", { name: "휴보강 신청 상세 열기" }).first()
  if (await detailButton.count().catch(() => 0)) {
    await detailButton.click()
    const detailDialog = page.getByRole("dialog").filter({ hasText: "휴보강 상세" }).first()
    await detailDialog.waitFor({ state: "visible", timeout: 5000 })
    const detailText = await detailDialog.innerText({ timeout: 5000 })
    for (const label of requiredCardLabels) {
      if (!detailText.includes(label)) throw new Error(`makeup-requests detail card is missing ${label}.`)
    }
    for (const label of optionalCardLabels) {
      if (hasEmptyCardField(detailText, label)) throw new Error(`makeup-requests detail card should hide empty ${label}.`)
    }
    for (const duplicateLabel of ["수업", "과목", "선생님"]) {
      if (detailText.includes(`${duplicateLabel}\n`)) throw new Error(`makeup-requests detail card should hide duplicate ${duplicateLabel}.`)
    }
    await page.keyboard.press("Escape").catch(() => {})
    await detailDialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {})
  }

  const createButton = page.getByRole("button", { name: "신청", exact: true }).last()
  if (!(await createButton.count().catch(() => 0))) throw new Error("makeup-requests create button was not found.")
  await waitUntilEnabled(createButton, "makeup request create button")
  await createButton.click()
  const dialog = page.getByRole("dialog").filter({ hasText: "휴보강 신청" }).first()
  await dialog.waitFor({ state: "visible", timeout: 5000 })
  const dialogText = await dialog.innerText({ timeout: 5000 })
  for (const expectedLabel of ["과목", "선생님", "수업", "사유", "휴강일", "보강일시", "보강 강의실", "결재자", "보강일시 추가"]) {
    if (!dialogText.includes(expectedLabel)) throw new Error(`makeup-requests dialog is missing ${expectedLabel}.`)
  }
  await page.keyboard.press("Escape").catch(() => {})
  await dialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {})
  return { openedDialog: true, checkedDataTable: !isNarrowViewport, checkedCardList: isNarrowViewport }
}

async function verifyRouteInteraction(page, route, options = {}) {
  if (route.name === "word-retests") await verifyWordRetestModeInteraction(page)
  if (route.interaction === "makeup-request") return verifyMakeupRequestInteraction(page)
  if (route.interaction === "quick-add") return verifyQuickAddInteraction(page, options.quickAddSampleCount)
  if (route.interaction === "open-create") return verifyCreateDialogInteraction(page, route, options.operationSampleCount)
  if (route.interaction === "approval-draft") return verifyApprovalDraftInteraction(page)
  if (route.interaction === "registration-subject-track-fixture") return verifyRegistrationSubjectTrackFixture(page, options)
  return {}
}

async function verifyRegistrationSubjectTrackFixture(page, { baseUrl, registrationFixtureSafety }) {
  if (!registrationFixtureSafety) throw new Error("registration fixture safety guards were not installed before navigation.")
  await registrationFixtureSafety.installPageGuard()

  const fixtureDebugGlobal = "__TIPS_REGISTRATION_SUBJECT_TRACK_FIXTURE_DEBUG__"
  const fixtureSafetySnapshots = []
  let fixtureStateBaselineDigest = null
  const { assertNoInterceptedProviderRequests, interceptedProviderRequests } = registrationFixtureSafety

  async function readFixtureDebugSnapshot() {
    await page.waitForFunction((globalName) => (
      typeof globalThis[globalName]?.snapshot === "function"
    ), fixtureDebugGlobal, { timeout: 5000 })
    return page.evaluate((globalName) => globalThis[globalName].snapshot(), fixtureDebugGlobal)
  }

  async function recordFixtureSafetySnapshot(stage) {
    const snapshot = await readFixtureDebugSnapshot()
    assertRegistrationFixtureSafetySnapshot(snapshot, registrationFixtureSafety, stage)
    if (!snapshot.stateDigest) throw new Error(`registration fixture snapshot is missing its complete state digest during ${stage}.`)
    if (fixtureStateBaselineDigest === null) fixtureStateBaselineDigest = snapshot.stateDigest
    if (snapshot.stateDigest !== fixtureStateBaselineDigest) {
      throw new Error(`registration fixture state changed before navigation during ${stage}.`)
    }
    fixtureSafetySnapshots.push({ stage, counts: { ...snapshot.counts }, stateDigest: snapshot.stateDigest })
    return snapshot
  }

  async function navigateRegistrationFixture(stage, url) {
    await recordFixtureSafetySnapshot(`pre-navigation fixture snapshot: ${stage}`)
    await page.goto(url, { waitUntil: "networkidle" })
    await registrationFixtureSafety.installPageGuard()
  }

  async function assertNoHorizontalOverflow(locator, label) {
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }))
    if (metrics.scrollWidth > metrics.viewportWidth + 8) {
      throw new Error(`${label} has page-level horizontal overflow: ${metrics.scrollWidth}px over ${metrics.viewportWidth}px.`)
    }
    const surface = await locator.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      viewportWidth: element.clientWidth,
    }))
    if (surface.scrollWidth > surface.viewportWidth + 8) {
      throw new Error(`${label} has dialog horizontal overflow: ${surface.scrollWidth}px over ${surface.viewportWidth}px.`)
    }
  }

  async function getCanonicalRegistrationApplicationHost(studentName = "") {
    await page.waitForFunction(() => (
      document.querySelectorAll('[data-registration-application-host]').length > 0
    ), { timeout: 5000 })
    const applicationHost = page.locator("[data-registration-application-host]")
    const hostCount = await applicationHost.count()
    if (hostCount !== 1) {
      throw new Error(`canonical registration application host count is ${hostCount}, expected 1.`)
    }
    await applicationHost.waitFor({ state: "visible", timeout: 5000 })
    if (studentName) {
      await applicationHost.getByRole("heading", { name: studentName, exact: true }).waitFor({ state: "visible", timeout: 5000 })
    }
    return applicationHost
  }

  async function openRegistrationSubjectTrackFixtureCase({
    taskId,
    trackId,
    studentName,
    fixtureRole = "english_admin",
    appointmentId = "",
    view = "",
  }) {
    const search = new URLSearchParams({
      fixture: "registration-subject-tracks",
      fixtureRole,
      taskId,
      trackId,
    })
    if (appointmentId) search.set("appointmentId", appointmentId)
    if (view) search.set("view", view)
    await navigateRegistrationFixture("open saved registration application", joinUrl(baseUrl, `/admin/registration?${search.toString()}`))
    const applicationHost = await getCanonicalRegistrationApplicationHost(studentName)
    await assertNoHorizontalOverflow(applicationHost, `${studentName} registration application`)
    return applicationHost
  }

  async function openRegistrationSubjectTrackFixtureCalendarItem({
    taskId,
    appointmentId,
    studentName,
    fixtureRole = "english_admin",
  }) {
    const search = new URLSearchParams({
      fixture: "registration-subject-tracks",
      fixtureRole,
      view: "calendar",
    })
    await navigateRegistrationFixture("open calendar appointment", joinUrl(baseUrl, `/admin/registration?${search.toString()}`))
    const calendarItem = page.locator(
      `[data-registration-calendar-item][data-registration-calendar-appointment-id="${appointmentId}"][data-registration-calendar-task-id="${taskId}"]`,
    ).first()
    await calendarItem.waitFor({ state: "visible", timeout: 5000 })
    await calendarItem.click()
    await page.waitForURL((url) => (
      url.searchParams.get("taskId") === taskId
      && url.searchParams.get("appointmentId") === appointmentId
      && url.searchParams.get("view") === "calendar"
    ), { timeout: 5000 })
    const applicationHost = await getCanonicalRegistrationApplicationHost(studentName)
    const appointmentFocus = applicationHost.locator(`[data-registration-appointment-focus="${appointmentId}"]`)
    await appointmentFocus.waitFor({ state: "visible", timeout: 5000 })
    const focusSection = await appointmentFocus.evaluate((element) => (
      element.closest("[data-registration-application-section]")?.id || ""
    ))
    if (focusSection !== "registration-application-level_test") {
      throw new Error(`calendar focus opened ${focusSection || "no section"} instead of the level-test section.`)
    }
    await assertAppointmentAccessibleNames(applicationHost)
    return applicationHost
  }

  async function requireVisibleText(locator, text, label = text) {
    const candidates = locator.getByText(text, { exact: false })
    const count = await candidates.count().catch(() => 0)
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index)
      if (await candidate.isVisible().catch(() => false)) return candidate
    }
    throw new Error(`registration subject-track fixture is missing visible ${label}.`)
  }

  async function openFixtureCaseFromList({ studentName, subject = "영어", viewLabel }) {
    const viewTab = page.getByRole("tab", { name: new RegExp(`^${viewLabel}`) }).first()
    await viewTab.click()
    const mobileRow = page.getByRole("listitem", { name: `${studentName} 등록 신청`, exact: true })
    const desktopRow = page.getByRole("row").filter({ hasText: studentName })
    const registrationCaseRow = await firstUsable(mobileRow.or(desktopRow))
    if (!(await registrationCaseRow.isVisible().catch(() => false))) {
      throw new Error(`${studentName} registration case row is not visible in ${viewLabel}.`)
    }
    const visibleMatchingRows = await mobileRow.or(desktopRow).evaluateAll((rows) => rows.filter((row) => {
      const style = window.getComputedStyle(row)
      return style.display !== "none" && style.visibility !== "hidden" && row.getBoundingClientRect().width > 0
    }).length)
    if (visibleMatchingRows !== 1) {
      throw new Error(`${studentName} registration case row appeared ${visibleMatchingRows} times in ${viewLabel}.`)
    }
    const detailButton = await firstUsable(registrationCaseRow.getByRole("button", {
      name: new RegExp(`^${studentName} (문의 처리|레벨테스트 관리|상담 관리|대기 관리|등록 관리|완료 보기|상세)$`),
    }))
    await waitUntilEnabled(detailButton, `${studentName} ${subject} fixture detail button`)
    await detailButton.click()
    const applicationHost = await getCanonicalRegistrationApplicationHost(studentName)
    await assertNoHorizontalOverflow(applicationHost, `${studentName} reopened subject-track fixture`)
    if (subject) {
      const subjectTab = applicationHost.getByRole("tablist", { name: "과목별 등록 진행" })
        .getByRole("tab", { name: new RegExp(`^${subject}`) })
      const subjectTabCount = await subjectTab.count()
      if (subjectTabCount !== 1) {
        throw new Error(`${studentName} ${subject} requested subject tab count is ${subjectTabCount}, expected 1.`)
      }
      await subjectTab.click()
    }
    return applicationHost
  }

  async function assertPrecedes(left, right, label) {
    const rightElement = await right.elementHandle()
    if (!rightElement) throw new Error(`${label} is missing its later control.`)
    const precedes = await left.evaluate((leftElement, rightNode) => (
      Boolean(leftElement.compareDocumentPosition(rightNode) & Node.DOCUMENT_POSITION_FOLLOWING)
    ), rightElement)
    if (!precedes) throw new Error(`${label} is not rendered in the approved order.`)
  }

  async function assertSharedInquiryControls(applicationHost, expectedHistoryTriggerCount) {
    const subjectPicker = applicationHost.locator('[data-registration-focus="subject"]')
    const subjectButtons = applicationHost.locator('[data-registration-focus="subject"] button[aria-pressed]')
    const studentName = applicationHost.getByLabel(/^학생명/).first()
    const inquiryAt = applicationHost.getByLabel("문의일시 자동", { exact: true }).first()
    const schoolGrade = applicationHost.getByLabel(/^학년/).first()
    const schoolName = applicationHost.getByLabel(/^학교/).first()
    const parentPhone = applicationHost.getByLabel(/^학부모 전화/).first()
    const studentPhone = applicationHost.getByLabel(/^학생 전화/).first()
    const requestNote = applicationHost.getByLabel("요청 사항", { exact: true }).first()

    await subjectPicker.waitFor({ state: "visible", timeout: 5000 })
    if (await subjectButtons.count() !== 2) {
      throw new Error("registration application does not expose the two pressed-state subject buttons.")
    }
    for (const control of [studentName, inquiryAt, schoolGrade, schoolName, parentPhone, studentPhone, requestNote]) {
      await control.waitFor({ state: "visible", timeout: 5000 })
    }
    await assertPrecedes(subjectPicker, studentName, "subject picker before shared inquiry rows")
    const approvedRows = [studentName, inquiryAt, schoolGrade, schoolName, parentPhone, studentPhone, requestNote]
    for (let index = 0; index < approvedRows.length - 1; index += 1) {
      await assertPrecedes(approvedRows[index], approvedRows[index + 1], "shared inquiry fields")
    }

    const inquiryAtElement = await inquiryAt.elementHandle()
    const studentAndTimestampShareRow = inquiryAtElement && await studentName.evaluate((studentControl, timestamp) => (
      studentControl.closest("label")?.parentElement === timestamp.parentElement
    ), inquiryAtElement)
    if (!studentAndTimestampShareRow) {
      throw new Error("student name and automatic inquiry timestamp are not in the same shared row.")
    }

    const historyTriggerCount = await applicationHost.getByRole("button", { name: "자동 이력 보기" }).count()
    if (historyTriggerCount !== expectedHistoryTriggerCount) {
      throw new Error(`registration application has ${historyTriggerCount} history triggers, expected ${expectedHistoryTriggerCount}.`)
    }

    return { requestNote, schoolGrade, schoolName, subjectButtons }
  }

  async function assertApplicationSections(applicationHost) {
    const approvedSectionIds = ["inquiry", "level_test", "consultation", "placement", "admission"]
    for (const sectionId of approvedSectionIds) {
      const section = applicationHost.locator(`[data-registration-application-section="${sectionId}"]`)
      if (await section.count() !== 1 || !(await section.isVisible().catch(() => false))) {
        throw new Error(`registration application is missing its ${sectionId} section.`)
      }
    }
    const unexpectedSectionIds = await applicationHost.locator("[data-registration-application-section]").evaluateAll(
      (sections, allowed) => sections
        .map((section) => section.getAttribute("data-registration-application-section"))
        .filter((sectionId) => sectionId && !allowed.includes(sectionId)),
      approvedSectionIds,
    )
    if (unexpectedSectionIds.length > 0) {
      throw new Error(`registration application exposes unexpected sections: ${unexpectedSectionIds.join(", ")}.`)
    }
  }

  async function assertSubjectPanels(applicationHost, activeSubject, inactiveSubject, tab) {
    await tab.click()
    if (await tab.getAttribute("aria-selected") !== "true") {
      throw new Error(`${activeSubject} subject tab did not become selected.`)
    }
    const tabId = await tab.getAttribute("id")
    if (!tabId?.startsWith("registration-subject-tab-")) {
      throw new Error(`${activeSubject} tab is missing the registration-subject-tab- id contract.`)
    }

    const activePanels = applicationHost.locator(`[role="tabpanel"][data-registration-subject="${activeSubject}"]`)
    const inactivePanels = applicationHost.locator(`[role="tabpanel"][data-registration-subject="${inactiveSubject}"]`)
    if (await activePanels.count() === 0 || await inactivePanels.count() === 0) {
      throw new Error(`${activeSubject}/${inactiveSubject} subject panels are not both mounted.`)
    }
    for (let index = 0; index < await activePanels.count(); index += 1) {
      await activePanels.nth(index).waitFor({ state: "visible", timeout: 5000 })
    }
    for (let index = 0; index < await inactivePanels.count(); index += 1) {
      await inactivePanels.nth(index).waitFor({ state: "hidden", timeout: 5000 })
      if (await inactivePanels.nth(index).getAttribute("hidden") === null) {
        throw new Error(`${inactiveSubject} inactive panel is not retained with hidden.`)
      }
    }
    const visiblePanelSubjects = await applicationHost.locator('[role="tabpanel"]').evaluateAll((panels) => panels
      .filter((panel) => !panel.hidden && panel.getBoundingClientRect().width > 0)
      .map((panel) => panel.getAttribute("data-registration-subject")))
    if (visiblePanelSubjects.length === 0 || visiblePanelSubjects.some((subject) => subject !== activeSubject)) {
      throw new Error(`${activeSubject} tab leaves another subject panel visible.`)
    }
  }

  async function setNextFault(fault) {
    await page.evaluate(({ globalName, nextFault }) => {
      globalThis[globalName].setNextFault(nextFault)
    }, { globalName: fixtureDebugGlobal, nextFault: fault })
  }

  async function assertSubjectQualifiedAccessibleNames(applicationHost) {
    const missing = await applicationHost.locator('[data-registration-track-id] input, [data-registration-track-id] select, [data-registration-track-id] button').evaluateAll((controls) => controls
      .filter((control) => !control.disabled && control.getBoundingClientRect().width > 0)
      .map((control) => control.getAttribute("aria-label") || control.labels?.[0]?.textContent?.trim() || "")
      .filter((ariaLabel) => !/(영어|수학)/.test(ariaLabel)))
    if (missing.length > 0) {
      throw new Error(`subject-qualified accessible name is missing from ${missing.length} enabled track control(s).`)
    }
  }

  async function assertAppointmentPlanAccessibleNames(applicationHost) {
    const missing = await applicationHost.locator('[data-registration-appointment-plan-action]').evaluateAll((actions) => actions
      .filter((action) => action.getBoundingClientRect().width > 0)
      .map((action) => {
        const participantSubjects = (action.getAttribute("data-registration-appointment-subjects") || "")
          .split("|").map((subject) => subject.trim()).filter(Boolean)
        const label = action.getAttribute("aria-label") || action.textContent?.trim() || ""
        return {
          label,
          missingSubjects: participantSubjects.length > 0
            ? participantSubjects.filter((subject) => !label.includes(subject))
            : ["participant subjects"],
        }
      })
      .filter(({ missingSubjects }) => missingSubjects.length > 0))
    if (missing.length > 0) throw new Error("appointment plan actions are missing participant-qualified accessible names.")
  }

  async function assertAppointmentAccessibleNames(applicationHost) {
    const missing = await applicationHost.locator('[data-registration-appointment-shared-controls]').evaluateAll((owners) => owners.flatMap((owner) => {
      const participantSubjects = (owner.getAttribute("data-registration-appointment-subjects") || "")
        .split("|").map((subject) => subject.trim()).filter(Boolean)
      return [...owner.querySelectorAll("input, select, button")]
        .filter((control) => !control.disabled && control.getBoundingClientRect().width > 0)
        .filter((control) => {
          const label = control.getAttribute("aria-label") || control.labels?.[0]?.textContent?.trim() || ""
          return participantSubjects.length === 0 || participantSubjects.some((subject) => !label.includes(subject))
        })
    }))
    if (missing.length > 0) throw new Error("shared appointment controls are missing participant-qualified accessible names.")
  }

  async function assertMobileActionDomOrder(applicationHost) {
    const invalidOwners = await applicationHost.evaluate((host) => [...host.querySelectorAll("[data-registration-primary-action]")]
      .filter((action) => action.getBoundingClientRect().width > 0)
      .flatMap((action) => {
        const owner = action.closest("[data-registration-action-owner]")
        const actionLabel = action.getAttribute("aria-label") || action.textContent?.trim() || "unnamed action"
        if (!owner) return [`${actionLabel} has no action owner`]
        const fields = [...owner.querySelectorAll("input, select, textarea")]
          .filter((field) => field.getBoundingClientRect().width > 0)
        if (fields.length === 0) return [`${actionLabel} owner has no visible data field`]
        return fields[fields.length - 1].compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING
          ? []
          : [`${actionLabel} precedes its owner's final field`]
      }))
    if (invalidOwners.length > 0) throw new Error(`mobile action DOM order is invalid: ${invalidOwners.join(", ")}.`)
  }

  async function assertNonColorWorkflowState(applicationHost, expectedState) {
    const stateMatchers = {
      locked: /잠김|저장|입력|선택 후|불러오기|현재 진행 단계가 아닙니다/,
      current: /현재|진행 중/,
      saved: /^(저장된 신청서|저장 완료)$/,
      failed: /실패|못했습니다|오류/,
    }
    const stateSignals = await applicationHost.evaluate((host, state) => (
      [...host.querySelectorAll(`[data-registration-state="${state}"]`)].map((element) => {
        const describedBy = (element.getAttribute("aria-describedby") || "").split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() || "")
          .filter(Boolean)
          .join(" ")
        return {
          ariaLabel: element.getAttribute("aria-label") || "",
          describedBy,
          text: element.textContent?.trim() || "",
        }
      })
    ), expectedState)
    const matcher = stateMatchers[expectedState]
    if (!matcher || !stateSignals.some((signal) => matcher.test(
      [signal.ariaLabel, signal.describedBy, signal.text].filter(Boolean).join(" "),
    ))) {
      throw new Error(`${expectedState} workflow state is conveyed by color alone.`)
    }
  }

  async function verifyHistoryPopover(applicationHost) {
    const historyButton = applicationHost.getByRole("button", { name: "자동 이력 보기" })
    if (await historyButton.count() !== 1) throw new Error("saved registration application must have one history trigger.")

    await historyButton.click()
    const historyPanel = page.getByLabel("등록 자동 이력")
    await historyPanel.waitFor({ state: "visible", timeout: 5000 })
    await historyPanel.getByText("자동 이력", { exact: true }).waitFor({ state: "visible", timeout: 5000 })
    await historyPanel.getByLabel("과목", { exact: true }).waitFor({ state: "visible", timeout: 5000 })
    await historyPanel.getByLabel("단계", { exact: true }).waitFor({ state: "visible", timeout: 5000 })
    const historyText = await historyPanel.innerText()
    if (!/운영팀|fixture-profile-staff|알 수 없음|시스템/.test(historyText)) {
      throw new Error("registration history Popover is missing its actor.")
    }
    if (!/\d{4}|오전|오후|\d{1,2}:\d{2}/.test(historyText)) {
      throw new Error("registration history Popover is missing its time.")
    }

    await page.keyboard.press("Escape")
    await historyPanel.waitFor({ state: "hidden", timeout: 5000 })
    if (!(await applicationHost.isVisible().catch(() => false))) {
      throw new Error("closing registration history also closed the application dialog.")
    }
    const focusReturned = await historyButton.evaluate((button) => document.activeElement === button)
    if (!focusReturned) throw new Error("registration history did not return focus to its clock button.")

    await historyButton.focus()
    const scrollBeforeHistoryOpen = await applicationHost.evaluate((host) => {
      const maximumScroll = Math.max(0, host.scrollHeight - host.clientHeight)
      host.scrollTop = Math.min(8, maximumScroll)
      return host.scrollTop
    })
    if (scrollBeforeHistoryOpen <= 0) {
      throw new Error("registration application could not establish positive app scroll before opening history.")
    }
    await historyButton.click()
    await historyPanel.waitFor({ state: "visible", timeout: 5000 })
    const applicationHostElement = await applicationHost.elementHandle()
    const historyPortalEscapedApplication = applicationHostElement && await historyPanel.evaluate(
      (panel, host) => !host.contains(panel),
      applicationHostElement,
    )
    if (!historyPortalEscapedApplication) {
      throw new Error("registration history Popover did not escape the app scroll container.")
    }
    await page.keyboard.press("Escape")
    await historyPanel.waitFor({ state: "hidden", timeout: 5000 })
    const scrollAfterEscape = await applicationHost.evaluate((host) => host.scrollTop)
    if (scrollAfterEscape !== scrollBeforeHistoryOpen || !(await applicationHost.isVisible().catch(() => false))) {
      throw new Error("Escape changed the registration application scroll or closed its dialog.")
    }
    const finalFocusReturned = await historyButton.evaluate((button) => document.activeElement === button)
    if (!finalFocusReturned) throw new Error("registration history did not return focus after the scrolled Escape cycle.")
  }

  const initialSnapshot = await recordFixtureSafetySnapshot("initial fixture snapshot")

  await openRegistrationSubjectTrackFixtureCalendarItem({
    taskId: "fixture-task-dual-test",
    appointmentId: "fixture-appointment-dual-test",
    studentName: "김다미",
  })
  await navigateRegistrationFixture(
    "return from real calendar appointment to create",
    joinUrl(baseUrl, "/admin/registration?fixture=registration-subject-tracks&fixtureRole=english_admin"),
  )

  const createButton = page.getByRole("button", { name: "등록 추가", exact: true }).last()
  await waitUntilEnabled(createButton, "registration fixture create button")
  await createButton.click()
  const createApplicationHost = await getCanonicalRegistrationApplicationHost()
  if (await createApplicationHost.getAttribute("data-registration-application-mode") !== "create") {
    throw new Error("registration create did not open the shared application host in create mode.")
  }
  await assertNoHorizontalOverflow(createApplicationHost, "registration create application")
  await assertApplicationSections(createApplicationHost)
  const createControls = await assertSharedInquiryControls(createApplicationHost, 0)
  if (await createControls.schoolName.isEnabled()) {
    throw new Error("school must be disabled with 학년을 먼저 선택.")
  }
  await createControls.schoolGrade.selectOption("고1")
  await waitUntilEnabled(createControls.schoolName, "grade-scoped school select")
  const highSchoolOptions = await createControls.schoolName.locator("option").allTextContents()
  if (!highSchoolOptions.includes("새봄고")) {
    throw new Error("고1 school options are missing the high-school fixture 새봄고.")
  }
  if (highSchoolOptions.some((option) => option.includes("새봄초") || option.includes("새봄중"))) {
    throw new Error("고1 school options include an elementary or middle-school fixture.")
  }
  await createApplicationHost.getByRole("button", { name: /영어 문의 과목/ }).click()
  await createApplicationHost.getByRole("button", { name: /수학 문의 과목/ }).click()

  const detailApplicationHost = await openRegistrationSubjectTrackFixtureCase({
    taskId: "fixture-task-dual-test",
    trackId: "fixture-track-dual-english",
    appointmentId: "fixture-appointment-dual-test",
    studentName: "김다미",
  })
  if (await detailApplicationHost.getAttribute("data-registration-application-mode") !== "detail") {
    throw new Error("saved registration application did not open in detail mode.")
  }
  await assertApplicationSections(detailApplicationHost)
  const detailControls = await assertSharedInquiryControls(detailApplicationHost, 1)
  const legacySchoolOptions = await detailControls.schoolName.locator("option").allTextContents()
  if (!legacySchoolOptions.some((option) => option.includes("기존 입력") && option.includes("중앙고"))) {
    throw new Error("saved non-catalog school is missing its 기존 입력 option.")
  }

  const subjectTabs = detailApplicationHost.getByRole("tablist", { name: "과목별 등록 진행" })
  await subjectTabs.waitFor({ state: "visible", timeout: 5000 })
  const englishTab = subjectTabs.getByRole("tab", { name: /영어/ })
  const mathTab = subjectTabs.getByRole("tab", { name: /수학/ })
  const englishPanels = detailApplicationHost.locator('[role="tabpanel"][data-registration-subject="영어"]')
  const mathPanels = detailApplicationHost.locator('[role="tabpanel"][data-registration-subject="수학"]')
  if (await englishPanels.count() === 0 || await mathPanels.count() === 0) {
    throw new Error("saved dual-subject application is missing an English or Mathematics workflow panel.")
  }
  const originalRequestNote = await detailApplicationHost.getByLabel("요청 사항", { exact: true }).inputValue()
  const reversibleDraft = "브라우저 검증용 되돌릴 초안"
  await detailApplicationHost.getByLabel("요청 사항", { exact: true }).fill(reversibleDraft)
  await assertSubjectPanels(detailApplicationHost, "수학", "영어", mathTab)
  if (await detailApplicationHost.getByLabel("요청 사항", { exact: true }).inputValue() !== reversibleDraft) {
    throw new Error("shared request draft did not survive the Mathematics tab switch.")
  }
  await assertSubjectPanels(detailApplicationHost, "영어", "수학", englishTab)
  if (await detailApplicationHost.getByLabel("요청 사항", { exact: true }).inputValue() !== reversibleDraft) {
    throw new Error("shared request draft did not survive the English tab switch.")
  }
  await detailApplicationHost.getByLabel("요청 사항", { exact: true }).fill(originalRequestNote)

  const sharedAppointmentRow = detailApplicationHost.locator(
    '[data-registration-appointment-plan-action][data-registration-appointment-subjects="영어|수학"]',
  )
  await sharedAppointmentRow.waitFor({ state: "visible", timeout: 5000 })
  if (await sharedAppointmentRow.count() !== 1) {
    throw new Error("shared appointment does not retain one participant action row.")
  }
  const sharedAppointmentEditor = detailApplicationHost.locator(
    '[data-registration-appointment-focus="fixture-appointment-dual-test"] [data-registration-appointment-shared-controls][data-registration-appointment-subjects="영어|수학"]',
  )
  await sharedAppointmentEditor.waitFor({ state: "visible", timeout: 5000 })
  if (await sharedAppointmentEditor.count() !== 1) {
    throw new Error("fixture-appointment-dual-test does not retain one appointmentId and participant set.")
  }
  await assertSubjectQualifiedAccessibleNames(detailApplicationHost)
  await assertAppointmentPlanAccessibleNames(detailApplicationHost)
  await assertAppointmentAccessibleNames(detailApplicationHost)
  await assertNonColorWorkflowState(detailApplicationHost, "current")
  await assertNonColorWorkflowState(detailApplicationHost, "saved")

  await verifyHistoryPopover(detailApplicationHost)

  const admissionApplicationHost = await openRegistrationSubjectTrackFixtureCase({
    taskId: "fixture-task-multiple-classes",
    trackId: "fixture-track-multiple-english",
    studentName: "최유진",
  })
  const placementSection = admissionApplicationHost.locator('[data-registration-application-section="placement"]')
  const admissionSection = admissionApplicationHost.locator('[data-registration-application-section="admission"]')
  await placementSection.getByRole("button", { name: "수업 추가", exact: true }).waitFor({ state: "visible", timeout: 5000 })
  await admissionSection.getByRole("button", { name: "입학 처리 시작", exact: true }).waitFor({ state: "visible", timeout: 5000 })
  await assertMobileActionDomOrder(admissionApplicationHost)

  const readOnlyAdmissionDialog = await openRegistrationSubjectTrackFixtureCase({
    taskId: "fixture-task-partial-registration",
    trackId: "fixture-track-partial-math",
    studentName: "이도윤",
    fixtureRole: "assistant",
  })
  await readOnlyAdmissionDialog.getByLabel("읽기 전용 입학 처리 상태").waitFor({ state: "visible", timeout: 5000 })
  if (await readOnlyAdmissionDialog.getByRole("button", { name: "입학 처리 시작" }).count() !== 0) {
    throw new Error("assistant read-only admission exposed a persistent start action.")
  }

  const migrationDialog = await openRegistrationSubjectTrackFixtureCase({
    taskId: "fixture-task-migration-review",
    trackId: "fixture-track-review-english",
    studentName: "윤지호",
  })
  await requireVisibleText(migrationDialog, "과목 분리 확인 필요")
  if (await migrationDialog.locator('section[aria-label="영어 문의 처리"]').count() !== 0) {
    throw new Error("migration review incorrectly exposed ordinary English inquiry controls.")
  }

  const cleanFixtureListUrl = joinUrl(baseUrl, "/admin/registration?fixture=registration-subject-tracks&fixtureRole=english_admin")
  await navigateRegistrationFixture("open clean fixture list for consultation-stage reopen", cleanFixtureListUrl)
  const consultationDialog = await openFixtureCaseFromList({ studentName: "김예린", subject: "영어", viewLabel: "상담" })
  const consultationTaskId = new URL(page.url()).searchParams.get("taskId")
  const unsavedInquiryRequestNote = "검증 중 저장하지 않을 문의 초안"
  await consultationDialog.getByLabel("요청 사항", { exact: true }).fill(unsavedInquiryRequestNote)
  await page.keyboard.press("Escape")
  const dirtyCloseConfirm = page.getByText("입력한 내용을 버릴까요?", { exact: true })
  await dirtyCloseConfirm.waitFor({ state: "visible", timeout: 5000 })
  await page.getByRole("button", { name: "계속 작성", exact: true }).click()
  await consultationDialog.waitFor({ state: "visible", timeout: 5000 })
  await page.keyboard.press("Escape")
  await dirtyCloseConfirm.waitFor({ state: "visible", timeout: 5000 })
  await page.getByRole("button", { name: "저장하지 않고 닫기", exact: true }).click()
  await consultationDialog.waitFor({ state: "hidden", timeout: 5000 })

  await navigateRegistrationFixture("open clean fixture list for level-test-stage reopen", cleanFixtureListUrl)
  const levelTestDialog = await openFixtureCaseFromList({ studentName: "김예린", subject: "수학", viewLabel: "레벨테스트" })
  const levelTestTaskId = new URL(page.url()).searchParams.get("taskId")
  if (consultationTaskId !== "fixture-task-cross-stage" || levelTestTaskId !== "fixture-task-cross-stage") {
    throw new Error("cross-stage list reopen did not retain the shared fixture-task-cross-stage application identity.")
  }
  await requireVisibleText(levelTestDialog, "수학")

  await navigateRegistrationFixture("open clean fixture list for all-terminal reopen", cleanFixtureListUrl)
  const allTerminalDialog = await openFixtureCaseFromList({ studentName: "서지안", subject: "영어", viewLabel: "완료" })
  await requireVisibleText(allTerminalDialog, "등록 완료")
  await requireVisibleText(allTerminalDialog, "미등록 완료")
  if (new URL(page.url()).searchParams.get("taskId") !== "fixture-task-all-terminal") {
    throw new Error("all-terminal list reopen did not retain fixture-task-all-terminal.")
  }

  await navigateRegistrationFixture("open clean fixture list for option recovery", cleanFixtureListUrl)
  await setNextFault({ kind: "option_data_once", error: "담당자 정보를 불러오지 못했습니다" })
  const optionFaultCreateButton = page.getByRole("button", { name: "등록 추가", exact: true }).last()
  await waitUntilEnabled(optionFaultCreateButton, "option-fault create button")
  await optionFaultCreateButton.click()
  const optionFaultHost = await getCanonicalRegistrationApplicationHost()
  const optionFaultEnglishSubject = optionFaultHost.locator('[data-registration-focus="subject"] button[aria-pressed]').filter({ hasText: "영어" })
  if (await optionFaultEnglishSubject.getAttribute("aria-pressed") !== "true") await optionFaultEnglishSubject.click()
  await optionFaultHost.getByLabel("영어 다음 업무", { exact: true }).selectOption("direct_phone")
  const optionFaultDirector = optionFaultHost.getByLabel("영어 상담 책임자", { exact: true })
  if (await optionFaultDirector.isEnabled()) throw new Error("option fault left the director catalog enabled.")
  await assertNonColorWorkflowState(optionFaultHost, "locked")
  await assertNonColorWorkflowState(optionFaultHost, "failed")
  const optionFaultRetry = optionFaultHost.getByRole("button", { name: "다시 불러오기", exact: true })
  await optionFaultRetry.click()
  await waitUntilEnabled(optionFaultDirector, "recovered English director catalog")
  if (!(await optionFaultDirector.isEnabled())) throw new Error("option retry did not re-enable the director catalog.")

  const finalFixtureSnapshot = await recordFixtureSafetySnapshot("final fixture snapshot")
  if (finalFixtureSnapshot.stateDigest !== initialSnapshot.stateDigest) throw new Error("no-send registration verification changed canonical fixture state.")
  assertNoInterceptedProviderRequests("no-send registration application verification")

  return {
    subjectTrackFixture: true,
    interceptedProviderRequests: interceptedProviderRequests.length,
    scenarios: [
      "subject-first shared create without save",
      "grade-scoped configured school select",
      "whole-workflow English and Mathematics tabs",
      "reversible draft retention",
      "shared appointment and admission actions",
      "automatic history Popover focus and Escape",
      "real calendar appointment focus and list-stage reopen",
      "read-only permission and migration gating",
      "cross-stage and all-terminal application identity",
      "dirty close confirm continue and discard",
      "option error recovery and non-color accessibility",
    ],
  }
}

const REGISTRATION_FIXTURE_PROVIDER_ROUTE_PATTERNS = [
  "**/api/google-chat",
  "**/api/web-push",
  "**/api/solapi",
  "**/api/solapi/**",
  "**/api/registration/consultation-notification",
  "**/api/notifications/worker",
  "**/api/notifications/connections",
  "**/api/notifications/legacy/**",
  "**/api/notifications/self-test/**",
  "**/api/notifications/**/self-test",
]

async function installRegistrationFixtureSafetyGuards(page) {
  const interceptedProviderRequests = []
  const notificationPermissionPrompts = []
  const fulfillProviderFixture = async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue()
      return
    }
    interceptedProviderRequests.push({
      method: route.request().method(),
      url: route.request().url(),
    })
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, fixture: true, blocked: "provider POST dispatch" }),
    })
  }
  for (const providerRoutePattern of REGISTRATION_FIXTURE_PROVIDER_ROUTE_PATTERNS) {
    await page.route(providerRoutePattern, fulfillProviderFixture)
  }
  await page.exposeFunction("__TIPS_RECORD_NOTIFICATION_PERMISSION_PROMPT__", () => {
    notificationPermissionPrompts.push("permission prompt")
  })
  const installNotificationPermissionGuard = () => {
    if (typeof Notification !== "undefined" && typeof Notification.requestPermission === "function") {
      Notification.requestPermission = async () => {
        await globalThis.__TIPS_RECORD_NOTIFICATION_PERMISSION_PROMPT__?.()
        throw new Error("registration fixture blocked a notification permission prompt")
      }
    }
  }
  await page.addInitScript(installNotificationPermissionGuard)

  return {
    interceptedProviderRequests,
    notificationPermissionPrompts,
    async installPageGuard() {
      await page.evaluate(installNotificationPermissionGuard)
    },
    assertNoInterceptedProviderRequests(stage) {
      if (interceptedProviderRequests.length !== 0) {
        throw new Error(
          `registration fixture attempted ${interceptedProviderRequests.length} provider request(s) during ${stage}: ${interceptedProviderRequests.map((request) => `${request.method} ${request.url}`).join(" | ")}`,
        )
      }
    },
    async cleanup() {
      for (const providerRoutePattern of REGISTRATION_FIXTURE_PROVIDER_ROUTE_PATTERNS) {
        await page.unroute(providerRoutePattern, fulfillProviderFixture)
      }
    },
  }
}

function assertRegistrationFixtureSafetySnapshot(snapshot, safety, stage) {
  if (snapshot?.counts?.notificationReceipts !== 0) {
    throw new Error(`registration fixture notification receipt count is ${snapshot?.counts?.notificationReceipts}, expected 0 during ${stage}.`)
  }
  if (snapshot?.counts?.externalCalls !== 0) {
    throw new Error(`registration fixture recorded provider dispatch attempts: ${snapshot?.counts?.externalCalls} during ${stage}.`)
  }
  if (safety.interceptedProviderRequests.length !== 0) {
    throw new Error(`registration fixture intercepted ${safety.interceptedProviderRequests.length} provider request(s) during ${stage}.`)
  }
  if (safety.notificationPermissionPrompts.length !== 0) {
    throw new Error(`registration fixture triggered ${safety.notificationPermissionPrompts.length} notification permission prompt(s) during ${stage}.`)
  }
}

async function login(page, baseUrl, candidates, password, artifactDir) {
  const attempted = []
  let lastText = ""

  for (const candidate of candidates) {
    attempted.push(candidate.includes("@") ? "email" : "id")
    await page.goto(joinUrl(baseUrl, "/sign-in"), { waitUntil: "networkidle" })
    if (!new URL(page.url()).pathname.includes("/sign-in")) return

    await fillFirst(
      page,
      '[data-testid="sign-in-login-id"], input[name="loginId"], input[type="email"], input[name="email"], input[autocomplete="username"], input[placeholder*="아이디"], input[placeholder*="이메일"], input[placeholder*="email" i]',
      candidate,
      "login id",
    )
    await fillFirst(
      page,
      '[data-testid="sign-in-password"], input[type="password"], input[name="password"], input[autocomplete="current-password"], input[placeholder*="비밀번호"]',
      password,
      "password",
    )
    await clickLogin(page)
    await page.waitForURL((url) => !url.pathname.includes("/sign-in"), { timeout: 8000 }).catch(() => {})
    await page.waitForLoadState("networkidle").catch(() => {})

    if (!new URL(page.url()).pathname.includes("/sign-in")) return
    lastText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")
  }

  const compactText = lastText.replace(/\s+/g, " ").trim().slice(0, 500)
  const screenshotPath = await writeDebugArtifacts(page, artifactDir, "login-failed")
  const artifactText = screenshotPath ? ` Screenshot: ${screenshotPath}` : ""
  throw new Error(`Login failed before route checks after ${attempted.join(" and ")} attempts. Check OPS_BROWSER_LOGIN_ID/OPS_BROWSER_EMAIL and password. Visible text: ${compactText}${artifactText}`)
}

async function inspectRoute(page, baseUrl, route, options = {}) {
  const consoleMessages = []
  const pageErrors = []
  const failedRequests = []
  const responseErrors = []
  const isKnownRedirectMeasureError = (value) =>
    route.name === "lesson-design" &&
    String(value || "").includes("LegacyClassScheduleLessonDesignRedirect") &&
    String(value || "").includes("cannot have a negative time stamp")
  const onConsole = (message) => {
    if (message.type() === "error" && !isKnownRedirectMeasureError(message.text())) consoleMessages.push(message.text())
  }
  const onPageError = (error) => {
    if (!isKnownRedirectMeasureError(error.message)) pageErrors.push(error.message)
  }
  const onResponse = (response) => {
    if (response.status() < 400) return
    const request = response.request()
    responseErrors.push(`${response.status()} ${request.method()} ${response.url()}`)
  }
  const onRequestFailed = (request) => {
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || "request failed"}`)
  }
  page.on("console", onConsole)
  page.on("pageerror", onPageError)
  page.on("requestfailed", onRequestFailed)
  page.on("response", onResponse)
  const registrationFixtureSafety = route.interaction === "registration-subject-track-fixture"
    ? await installRegistrationFixtureSafetyGuards(page)
    : null

  try {
    const assertRouteHealth = async (stage) => {
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }))
      if (metrics.scrollWidth > metrics.viewportWidth + 8) {
        throw new Error(`${route.name} has horizontal overflow during ${stage}: ${metrics.scrollWidth}px over ${metrics.viewportWidth}px.`)
      }
      if (consoleMessages.length > 0 || pageErrors.length > 0 || failedRequests.length > 0 || responseErrors.length > 0) {
        throw new Error(`${route.name} has browser errors during ${stage}: ${[...consoleMessages, ...pageErrors, ...failedRequests, ...responseErrors].join(" | ")}`)
      }
      return metrics
    }

    await page.goto(joinUrl(baseUrl, route.path), { waitUntil: "networkidle" })
    const url = new URL(page.url())
    const bodyText = await waitForRouteText(page, route)

    if (url.pathname.includes("/sign-in")) throw new Error(`${route.name} redirected to sign-in.`)
    if (bodyText.length < 20) throw new Error(`${route.name} rendered too little content.`)
    for (const expectedText of route.expectedTexts) {
      if (!bodyText.includes(expectedText)) throw new Error(`${route.name} is missing visible text: ${expectedText}.`)
    }
    if (bodyText.includes(SAMPLE_TAG)) throw new Error(`${route.name} still shows a sample workflow tag.`)
    if (bodyText.includes(UI_SAMPLE_PREFIX)) throw new Error(`${route.name} still shows a UI sample task.`)
    if (/403|permission denied|unauthorized/i.test(bodyText)) throw new Error(`${route.name} rendered an authorization error.`)
    const metrics = await assertRouteHealth("initial navigation")
    const interactionResult = await verifyRouteInteraction(page, route, {
      ...options,
      baseUrl,
      registrationFixtureSafety,
    })
    await assertRouteHealth("post interaction")

    return {
      name: route.name,
      path: route.path,
      ok: true,
      interaction: route.interaction || "visible-controls",
      ...(interactionResult || {}),
      scrollWidth: metrics.scrollWidth,
      viewportWidth: metrics.viewportWidth,
    }
  } finally {
    await registrationFixtureSafety?.cleanup()
    page.off("console", onConsole)
    page.off("pageerror", onPageError)
    page.off("requestfailed", onRequestFailed)
    page.off("response", onResponse)
  }
}

async function inspectPublicSmokeRoute(page, baseUrl, route) {
  const consoleMessages = []
  const pageErrors = []
  const onConsole = (message) => {
    if (message.type() === "error") consoleMessages.push(message.text())
  }
  const onPageError = (error) => pageErrors.push(error.message)
  page.on("console", onConsole)
  page.on("pageerror", onPageError)

  try {
    await page.goto(joinUrl(baseUrl, route.path), { waitUntil: "networkidle" })
    const url = new URL(page.url())
    const bodyText = await page.locator("body").innerText({ timeout: 10000 })
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }))

    if (url.pathname !== route.expectedPath) {
      throw new Error(`${route.name} expected ${route.expectedPath} but reached ${url.pathname}.`)
    }
    if (route.expectedSearchIncludes && !url.search.includes(route.expectedSearchIncludes)) {
      throw new Error(`${route.name} search did not include ${route.expectedSearchIncludes}. Reached ${url.pathname}${url.search}.`)
    }
    if (bodyText.length < 20) throw new Error(`${route.name} rendered too little content.`)
    for (const expectedText of route.expectedTexts) {
      if (!bodyText.includes(expectedText)) throw new Error(`${route.name} is missing visible text: ${expectedText}.`)
    }
    if (metrics.scrollWidth > metrics.viewportWidth + 8) {
      throw new Error(`${route.name} has horizontal overflow: ${metrics.scrollWidth}px over ${metrics.viewportWidth}px.`)
    }
    if (consoleMessages.length > 0 || pageErrors.length > 0) {
      throw new Error(`${route.name} has browser errors: ${[...consoleMessages, ...pageErrors].join(" | ")}`)
    }

    return {
      name: route.name,
      path: route.path,
      ok: true,
      reachedPath: url.pathname,
      scrollWidth: metrics.scrollWidth,
      viewportWidth: metrics.viewportWidth,
    }
  } finally {
    page.off("console", onConsole)
    page.off("pageerror", onPageError)
  }
}

async function runPublicSmokeViewport(browser, baseUrl, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  })
  const page = await context.newPage()
  try {
    const routes = []
    for (const route of PUBLIC_SMOKE_ROUTES) {
      routes.push(await inspectPublicSmokeRoute(page, baseUrl, route))
    }
    return { viewport: viewport.name, routes }
  } finally {
    await context.close()
  }
}

async function runPublicSmoke(baseUrl) {
  const { chromium } = await importPlaywright()
  const browser = await chromium.launch({ headless: true })
  try {
    const viewports = []
    for (const viewport of VIEWPORTS) {
      viewports.push(await runPublicSmokeViewport(browser, baseUrl, viewport))
    }
    console.log(JSON.stringify({ ok: true, baseUrl, authMode: "public-smoke", viewports }, null, 2))
  } finally {
    await browser.close()
  }
}

async function runViewport(browser, baseUrl, candidates, password, viewport, storageStatePath, artifactDir) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    ...(storageStatePath ? { storageState: storageStatePath } : {}),
  })
  const page = await context.newPage()
  try {
    if (!storageStatePath) await login(page, baseUrl, candidates, password, artifactDir)
    const routes = []
    const quickAddSampleCount = positiveIntegerEnv("OPS_BROWSER_QUICK_ADD_SAMPLE_COUNT", DEFAULT_QUICK_ADD_SAMPLE_COUNT)
    const operationSampleCount = positiveIntegerEnv("OPS_BROWSER_OPERATION_SAMPLE_COUNT", DEFAULT_OPERATION_SAMPLE_COUNT)
    for (const route of getAuthenticatedRoutes()) {
      routes.push(await inspectRoute(page, baseUrl, route, { quickAddSampleCount, operationSampleCount }))
    }
    if (isEnabledEnv(env("OPS_BROWSER_OPERATION_COMPLETE_SAMPLE"))) {
      routes.push({
        name: "operation-completion",
        path: "/admin/registration,/admin/transfer,/admin/withdrawal,/admin/word-retests",
        ok: true,
        interaction: "operation-completion",
        ...(await verifyOperationCompletionSet(page, baseUrl, viewport.name, candidates[0] || "", password)),
      })
    }
    if (isEnabledEnv(env("OPS_BROWSER_REGISTRATION_WORKFLOW_SAMPLE"))) {
      routes.push({
        name: "registration-workflow",
        path: "/admin/registration",
        ok: true,
        interaction: "registration-workflow",
        ...(await verifyRegistrationWorkflowSet(
          page,
          baseUrl,
          viewport.name,
          candidates[0] || "",
          password,
          artifactDir,
        )),
      })
    }
    return { viewport: viewport.name, routes }
  } finally {
    await context.close()
  }
}

async function run() {
  verifySubjectTrackSamples()
  loadEnvFile(resolve(ROOT, ".env.ops-browser.local"))
  loadEnvFile(resolve(ROOT, ".env.local"))

  const baseUrl = env("OPS_BROWSER_BASE_URL", DEFAULT_BASE_URL)
  if (isEnabledEnv(env("OPS_BROWSER_PREFLIGHT"))) {
    const authPreflight = buildOpsBrowserAuthPreflight()
    console.log(JSON.stringify({ ok: authPreflight.canRunAuthenticatedWorkflow, baseUrl, authPreflight }, null, 2))
    if (!authPreflight.canRunAuthenticatedWorkflow) process.exitCode = 1
    return
  }

  const publicSmoke = isEnabledEnv(env("OPS_BROWSER_PUBLIC_SMOKE"))
  const workflowEnabled = ENABLED || isEnabledEnv(env("OPS_BROWSER_WORKFLOW"))
  if (!workflowEnabled) {
    if (publicSmoke) {
      await runPublicSmoke(baseUrl)
      return
    }
    if (!requireEnabled()) return
  }

  const browserTarget = new URL(baseUrl)
  if (!["localhost", "127.0.0.1", "::1"].includes(browserTarget.hostname)) {
    throw new Error("OPS_BROWSER_BASE_URL must use localhost for authenticated workflow verification.")
  }
  const deterministicFixtureOnly = getAuthenticatedRoutes().every((route) => (
    route.interaction === "registration-subject-track-fixture"
  ))
  const authorizedSupabaseUrl = env("SUPABASE_URL", env("NEXT_PUBLIC_SUPABASE_URL", env("VITE_SUPABASE_URL")))
  if (!deterministicFixtureOnly && !authorizedSupabaseUrl) {
    throw new Error("Authenticated browser verification requires an explicit localhost Supabase URL.")
  }
  if (!deterministicFixtureOnly) assertAuthorizedLocalFixtureDatabase(authorizedSupabaseUrl)

  const loginId = env("OPS_BROWSER_LOGIN_ID", env("OPS_BROWSER_EMAIL"))
  const password = env("OPS_BROWSER_PASSWORD")
  const storageStatePath = env("OPS_BROWSER_STORAGE_STATE")
  const useSupabaseStorage = env("OPS_BROWSER_SUPABASE_STORAGE", "1") !== "0"
  const useTemporaryUser = isEnabledEnv(env("OPS_BROWSER_TEMP_USER"))
  const artifactDir = env("OPS_BROWSER_ARTIFACT_DIR", resolve(ROOT, "test-results", "ops-browser"))
  if (storageStatePath && !existsSync(storageStatePath)) throw new Error(`OPS_BROWSER_STORAGE_STATE file was not found: ${storageStatePath}`)
  if (!storageStatePath && !useTemporaryUser && (!loginId || !password)) {
    throw new Error("Set OPS_BROWSER_STORAGE_STATE, OPS_BROWSER_TEMP_USER=1, or add OPS_BROWSER_LOGIN_ID/OPS_BROWSER_PASSWORD to .env.ops-browser.local.")
  }
  const candidates = loginId ? loginCandidates(loginId) : []
  let generatedStorageState = null
  let cleanupTemporaryUser = null
  let authMode = storageStatePath ? "storage-state-file" : "ui-login"

  if (!storageStatePath && useTemporaryUser) {
    const temporaryUser = await createTemporaryBrowserUserStorage(baseUrl)
    generatedStorageState = temporaryUser.storageState
    cleanupTemporaryUser = temporaryUser.cleanup
    authMode = "temp-user-storage"
  } else if (!storageStatePath && useSupabaseStorage) {
    try {
      generatedStorageState = await createStorageStateFromSupabase(baseUrl, loginId, password)
      if (generatedStorageState) authMode = "supabase-storage"
    } catch {
      generatedStorageState = null
      authMode = "ui-login"
    }
  }
  const storageState = storageStatePath || generatedStorageState

  const { chromium } = await importPlaywright()
  const browser = await chromium.launch({ headless: true })
  try {
    const results = []
    for (const viewport of VIEWPORTS) {
      results.push(await runViewport(browser, baseUrl, candidates, password, viewport, storageState, artifactDir))
    }
    const remainingUiSamples = await countRemainingUiSamples(loginId, password)
    if (remainingUiSamples !== null && remainingUiSamples > 0) {
      throw new Error(`UI sample cleanup left ${remainingUiSamples} task(s) in ops_tasks.`)
    }
    console.log(JSON.stringify({ ok: true, baseUrl, authMode, remainingUiSamples, viewports: results }, null, 2))
  } finally {
    await browser.close()
    if (cleanupTemporaryUser) await cleanupTemporaryUser()
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
