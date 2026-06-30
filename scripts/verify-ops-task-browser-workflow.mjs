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
const TEMP_USER_PREFIX = "codex-browser-verifier"
const DEFAULT_QUICK_ADD_SAMPLE_COUNT = 1
const DEFAULT_OPERATION_SAMPLE_COUNT = 1
const MAX_INITIAL_TEMPLATE_CONTROLS = 22
const MAX_INITIAL_SELECT_OPTIONS = 16
const SIGN_IN_EXPECTED_TEXTS = ["TIPS 로그인", "아이디", "비밀번호"]
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
    expectedTexts: ["수업 설계"],
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
  { path: "/admin/transfer", name: "transfer", expectedTexts: ["전반", "전반 추가"], interaction: "open-create" },
  { path: "/admin/withdrawal", name: "withdrawal", expectedTexts: ["퇴원", "퇴원 추가"], interaction: "open-create" },
  { path: "/admin/word-retests", name: "word-retests", expectedTexts: ["단어 재시험", "단어 재시험 추가"], interaction: "open-create" },
  { path: "/admin/approvals", name: "approvals", expectedTexts: ["전자결재", "영어", "수학", "자유"], interaction: "approval-draft" },
  ...AUTHENTICATED_CORE_SMOKE_ROUTES,
]

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
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
  const canCreateCompletionFixtures = Boolean(serviceRoleKey || (loginId && password))

  return {
    canRunAuthenticatedWorkflow,
    canCreateCompletionFixtures,
    authModes,
    hint: "Set OPS_BROWSER_STORAGE_STATE, OPS_BROWSER_TEMP_USER=1, or OPS_BROWSER_LOGIN_ID/OPS_BROWSER_PASSWORD in .env.ops-browser.local.",
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
  for (const prefix of [UI_SAMPLE_PREFIX, UI_COMPLETION_PREFIX]) {
    const { count, error: countError } = await client
      .from("ops_tasks")
      .select("id", { count: "exact", head: true })
      .ilike("title", `%${prefix}%`)

    if (countError) throw countError
    remaining += count || 0
  }
  return remaining
}

async function createAdminSupabaseClient(loginId, password) {
  const supabaseUrl = env("SUPABASE_URL", env("NEXT_PUBLIC_SUPABASE_URL", env("VITE_SUPABASE_URL")))
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY", env("SUPABASE_SERVICE_KEY"))
  const supabaseAnonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY", env("VITE_SUPABASE_ANON_KEY"))
  if (!supabaseUrl) throw new Error("OPS_BROWSER_OPERATION_COMPLETE_SAMPLE=1 requires SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL.")

  const { createClient } = await importSupabaseClient()
  if (serviceRoleKey) {
    return createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  if (!supabaseAnonKey || !loginId || !password) {
    throw new Error("OPS_BROWSER_OPERATION_COMPLETE_SAMPLE=1 requires SUPABASE_SERVICE_ROLE_KEY or OPS_BROWSER_LOGIN_ID/OPS_BROWSER_PASSWORD.")
  }
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  const { error } = await client.auth.signInWithPassword({ email: normalizeLoginIdentifier(loginId), password })
  if (error) throw new Error(`Operation fixture login failed: ${error.message}`)
  return client
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
  const client = await createAdminSupabaseClient(loginId, password)
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
        class_ids: [ids.classes.withdrawal],
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
        class_ids: [ids.classes.transferFrom],
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
        class_ids: [ids.classes.wordRetest],
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
        student_ids: [ids.students.withdrawal],
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
        student_ids: [ids.students.transfer],
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
        student_ids: [ids.students.wordRetest],
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

    const tasks = [
      {
        key: "registration",
        routePath: "/admin/registration",
        routeExpectedTexts: ["등록", "등록 추가"],
        title: `${prefix} 등록 완료`,
        id: ids.tasks.registration,
      },
      {
        key: "withdrawal",
        routePath: "/admin/withdrawal",
        routeExpectedTexts: ["퇴원", "퇴원 추가"],
        title: `${prefix} 퇴원 완료`,
        id: ids.tasks.withdrawal,
      },
      {
        key: "transfer",
        routePath: "/admin/transfer",
        routeExpectedTexts: ["전반", "전반 추가"],
        title: `${prefix} 전반 완료`,
        id: ids.tasks.transfer,
      },
      {
        key: "wordRetest",
        routePath: "/admin/word-retests",
        routeExpectedTexts: ["단어 재시험", "단어 재시험 추가"],
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
      inquiry_channel: "검증",
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
      pipeline_status: "6. 수납 진행 중",
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

    return { client, prefix, ids, tasks }
  } catch (error) {
    await cleanupOperationCompletionFixtures({ client, ids }).catch(() => {})
    throw error
  }
}

async function cleanupOperationCompletionFixtures(fixtureSet) {
  const client = fixtureSet?.client
  const ids = fixtureSet?.ids
  if (!client || !ids) return
  const taskIds = Object.values(ids.tasks || {})
  const studentIds = Object.values(ids.students || {})
  const classIds = Object.values(ids.classes || {})
  const textbookIds = Object.values(ids.textbooks || {})
  const teacherIds = [ids.teacher].filter(Boolean)

  for (const table of [
    "ops_task_comments",
    "ops_task_events",
    "ops_task_attachments",
    "ops_registration_details",
    "ops_withdrawal_details",
    "ops_transfer_details",
    "ops_word_retests",
  ]) {
    await deleteByIds(client, table, "task_id", taskIds).catch(() => {})
  }
  await deleteByIds(client, "ops_tasks", "id", taskIds).catch(() => {})
  await deleteByIds(client, "student_class_enrollment_history", "student_id", studentIds).catch(() => {})
  await deleteByIds(client, "students", "id", studentIds).catch(() => {})
  await deleteByIds(client, "classes", "id", classIds).catch(() => {})
  await deleteByIds(client, "textbooks", "id", textbookIds).catch(() => {})
  await deleteByIds(client, "teacher_catalogs", "id", teacherIds).catch(() => {})
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

async function waitUntilEnabled(locator, label, timeoutMs = 10000) {
  await locator.waitFor({ state: "visible", timeout: timeoutMs })
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await locator.isEnabled().catch(() => false)) return
    await new Promise((resolveReady) => setTimeout(resolveReady, 250))
  }
  throw new Error(`${label} did not become enabled.`)
}

async function countVisibleControls(locator) {
  return locator.locator('input:not([type="hidden"]), select, textarea, button').evaluateAll((controls) =>
    controls.filter((control) => {
      const rect = control.getBoundingClientRect()
      const style = window.getComputedStyle(control)
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    }).length,
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

async function cleanupQuickAddSample(page, sampleTitle) {
  if (!(await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).includes(sampleTitle)) return

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await clickDeleteInTaskDialog(page, sampleTitle).catch(() => false)) return

    await page.keyboard.press("Escape").catch(() => {})
    const createdRow = page.getByText(sampleTitle, { exact: false }).first()
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

async function writeDebugArtifacts(page, artifactDir, name) {
  if (!artifactDir) return ""
  mkdirSync(artifactDir, { recursive: true })
  const safeName = name.replace(/[^a-z0-9_.-]+/gi, "-").replace(/^-|-$/g, "")
  const screenshotPath = resolve(artifactDir, `${safeName}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})
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

    const createdRow = page.getByText(sampleTitle, { exact: false }).first()
    await createdRow.waitFor({ state: "visible", timeout: 10000 })
    await createdRow.click()

    const detailDialog = page.getByRole("dialog").filter({ hasText: sampleTitle }).first()
    await detailDialog.waitFor({ state: "visible", timeout: 5000 })
    const detailText = await detailDialog.innerText({ timeout: 5000 })
    for (const hiddenStatus of ["요청", "진행", "보류", "취소"]) {
      if (detailText.includes(hiddenStatus)) {
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

    const editedRow = page.getByText(editedTitle, { exact: false }).first()
    await editedRow.waitFor({ state: "visible", timeout: 10000 })
    await editedRow.click()

    const editedDetailDialog = page.getByRole("dialog").filter({ hasText: editedTitle }).first()
    await editedDetailDialog.waitFor({ state: "visible", timeout: 5000 })
    const completeButton = editedDetailDialog.getByRole("button", { name: "완료" }).last()
    await waitUntilEnabled(completeButton, "Todo complete button")
    await completeButton.click()
    await editedDetailDialog.getByRole("button", { name: "다시 열기" }).waitFor({ state: "visible", timeout: 10000 })

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

async function fillIfPresent(scope, label, value) {
  const field = scope.getByLabel(label, { exact: true }).first()
  if (!(await field.count().catch(() => 0))) return false
  await field.waitFor({ state: "visible", timeout: 5000 })
  await field.fill(value)
  return true
}

async function selectManualIfPresent(scope, label) {
  const field = scope.getByLabel(label, { exact: true }).first()
  if (!(await field.count().catch(() => 0))) return false
  await field.selectOption("__manual__")
  return true
}

async function fillOperationMinimumFields(dialog, route, sampleName) {
  if (route.name === "registration") {
    if (!(await fillIfPresent(dialog, "학생명", sampleName))) {
      throw new Error("Registration student name input was not found.")
    }
    await fillIfPresent(dialog, "학년", "테스트")
    await fillIfPresent(dialog, "학교", "테스트")
    return
  }

  await selectManualIfPresent(dialog, "학생")
  if (!(await fillIfPresent(dialog, "학생명", sampleName))) {
    throw new Error(`${route.name} student name input was not found after manual selection.`)
  }
  await fillIfPresent(dialog, "수업명", `${sampleName} 수업`)
  await fillIfPresent(dialog, "전반사유", "브라우저 검증")
  await fillIfPresent(dialog, "고객 퇴원사유", "브라우저 검증")
  await fillIfPresent(dialog, "응시일시", `${new Date().toISOString().slice(0, 10)}T09:00`)
}

async function verifySingleCreateDialogInteraction(page, route, sampleIndex) {
  const sampleName = `${UI_SAMPLE_PREFIX} ${route.name} ${Date.now()}-${sampleIndex}-${Math.random().toString(36).slice(2, 8)}`
  const editedTitle = `${UI_SAMPLE_PREFIX} ${route.name} 수정 ${Date.now()}-${sampleIndex}`
  const addButton = page.getByRole("button", { name: new RegExp(`${route.expectedTexts[0]} 추가`) }).last()
  if (!(await addButton.count().catch(() => 0))) throw new Error(`${route.name} create button was not found.`)

  try {
    await waitUntilEnabled(addButton, `${route.name} create button`)
    await addButton.click()

    const dialog = page.getByRole("dialog").first()
    await dialog.waitFor({ state: "visible", timeout: 5000 })
    const dialogText = await dialog.innerText({ timeout: 5000 })
    if (!dialogText.includes(route.expectedTexts[0])) throw new Error(`${route.name} dialog did not show the operation name.`)
    if (!new RegExp(`${route.expectedTexts[0]}\\s+1\\/\\d+`).test(dialogText)) {
      throw new Error(`${route.name} dialog did not show a fixed step progress label.`)
    }
    const visibleControls = await countVisibleControls(dialog)
    if (visibleControls > MAX_INITIAL_TEMPLATE_CONTROLS) {
      throw new Error(`${route.name} first step is too dense: ${visibleControls} visible controls.`)
    }
    await verifyInitialSelectControls(dialog, route)
    await fillOperationMinimumFields(dialog, route, sampleName)

    const saveButton = dialog.getByRole("button", { name: "저장" }).last()
    await waitUntilEnabled(saveButton, `${route.name} save button`)
    await saveButton.click()
    await dialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {})

    const createdRow = page.getByText(sampleName, { exact: false }).first()
    await createdRow.waitFor({ state: "visible", timeout: 10000 })
    await createdRow.click()

    const detailDialog = page.getByRole("dialog").filter({ hasText: sampleName }).first()
    await detailDialog.waitFor({ state: "visible", timeout: 5000 })
    const editButton = detailDialog.getByRole("button", { name: "수정" }).last()
    await waitUntilEnabled(editButton, `${route.name} edit button`)
    await editButton.click()

    const editDialog = page.getByRole("dialog").filter({ hasText: `${route.expectedTexts[0]} 수정` }).first()
    await editDialog.waitFor({ state: "visible", timeout: 5000 })
    await editDialog.getByLabel("제목 직접 지정").fill(editedTitle)
    const updateButton = editDialog.getByRole("button", { name: "저장" }).last()
    await waitUntilEnabled(updateButton, `${route.name} update button`)
    await updateButton.click()
    await editDialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {})

    const editedRow = page.getByText(editedTitle, { exact: false }).first()
    await editedRow.waitFor({ state: "visible", timeout: 10000 })
    await editedRow.click()

    if (!(await clickDeleteInTaskDialog(page, editedTitle))) {
      throw new Error(`${route.name} detail dialog was not opened for the edited sample.`)
    }
    await waitForBodyToExclude(page, editedTitle)
  } catch (error) {
    await cleanupQuickAddSample(page, editedTitle)
    await cleanupQuickAddSample(page, sampleName)
    throw error
  }
}

async function verifyCreateDialogInteraction(page, route, sampleCount = DEFAULT_OPERATION_SAMPLE_COUNT) {
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    await verifySingleCreateDialogInteraction(page, route, sampleIndex + 1)
  }
  return { samplesCreated: sampleCount }
}

async function verifyOperationCompletionInteraction(page, baseUrl, task) {
  const route = { path: task.routePath, name: task.key, expectedTexts: task.routeExpectedTexts }
  await page.goto(joinUrl(baseUrl, task.routePath), { waitUntil: "networkidle" })
  await waitForRouteText(page, route)

  const createdRow = page.getByText(task.title, { exact: false }).first()
  await createdRow.waitFor({ state: "visible", timeout: 15000 })
  await createdRow.click()

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

async function verifyOperationCompletionSync(fixtureSet) {
  const { client, ids } = fixtureSet
  const taskIds = Object.values(ids.tasks)
  const studentIds = Object.values(ids.students)
  const classIds = Object.values(ids.classes)
  const textbookIds = Object.values(ids.textbooks)
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

  const failed = Object.entries(operationCompletionSync)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  if (failed.length > 0) {
    throw new Error(`Operation completion sync failed: ${failed.join(", ")}`)
  }

  return operationCompletionSync
}

async function verifyOperationCompletionSet(page, baseUrl, viewportName, loginId, password) {
  let fixtureSet = null
  try {
    fixtureSet = await createOperationCompletionFixtures(viewportName, loginId, password)
    for (const task of fixtureSet.tasks) {
      await verifyOperationCompletionInteraction(page, baseUrl, task)
    }
    const operationCompletionSync = await verifyOperationCompletionSync(fixtureSet)
    return {
      completedOperationSamples: fixtureSet.tasks.length,
      operationCompletionSync,
    }
  } finally {
    if (fixtureSet) await cleanupOperationCompletionFixtures(fixtureSet)
  }
}

async function verifyWordRetestModeInteraction(page) {
  const teacherButton = page.getByRole("button", { name: "담당 선생님 보기" }).first()
  const assistantButton = page.getByRole("button", { name: "조교 선생님 보기" }).first()
  if (!(await teacherButton.count().catch(() => 0))) throw new Error("Word retest teacher mode button was not found.")
  if (!(await assistantButton.count().catch(() => 0))) throw new Error("Word retest assistant mode button was not found.")
  if (!(await teacherButton.innerText()).includes("선생님")) throw new Error("Word retest teacher mode label is not visible.")
  if (!(await assistantButton.innerText()).includes("조교")) throw new Error("Word retest assistant mode label is not visible.")

  await waitUntilEnabled(teacherButton, "Word retest teacher mode button")
  await teacherButton.click()
  if ((await teacherButton.getAttribute("aria-pressed")) !== "true") throw new Error("Word retest teacher mode did not become selected.")

  await waitUntilEnabled(assistantButton, "Word retest assistant mode button")
  await assistantButton.click()
  if ((await assistantButton.getAttribute("aria-pressed")) !== "true") throw new Error("Word retest assistant mode did not become selected.")
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

async function verifyRouteInteraction(page, route, options = {}) {
  if (route.name === "word-retests") await verifyWordRetestModeInteraction(page)
  if (route.interaction === "quick-add") return verifyQuickAddInteraction(page, options.quickAddSampleCount)
  if (route.interaction === "open-create") return verifyCreateDialogInteraction(page, route, options.operationSampleCount)
  if (route.interaction === "approval-draft") return verifyApprovalDraftInteraction(page)
  return {}
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
  const onConsole = (message) => {
    if (message.type() === "error") consoleMessages.push(message.text())
  }
  const onPageError = (error) => pageErrors.push(error.message)
  page.on("console", onConsole)
  page.on("pageerror", onPageError)

  try {
    await page.goto(joinUrl(baseUrl, route.path), { waitUntil: "networkidle" })
    const url = new URL(page.url())
    const bodyText = await waitForRouteText(page, route)
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }))

    if (url.pathname.includes("/sign-in")) throw new Error(`${route.name} redirected to sign-in.`)
    if (bodyText.length < 20) throw new Error(`${route.name} rendered too little content.`)
    for (const expectedText of route.expectedTexts) {
      if (!bodyText.includes(expectedText)) throw new Error(`${route.name} is missing visible text: ${expectedText}.`)
    }
    if (bodyText.includes(SAMPLE_TAG)) throw new Error(`${route.name} still shows a sample workflow tag.`)
    if (bodyText.includes(UI_SAMPLE_PREFIX)) throw new Error(`${route.name} still shows a UI sample task.`)
    if (/403|permission denied|unauthorized/i.test(bodyText)) throw new Error(`${route.name} rendered an authorization error.`)
    if (metrics.scrollWidth > metrics.viewportWidth + 8) {
      throw new Error(`${route.name} has horizontal overflow: ${metrics.scrollWidth}px over ${metrics.viewportWidth}px.`)
    }
    if (consoleMessages.length > 0 || pageErrors.length > 0) {
      throw new Error(`${route.name} has browser errors: ${[...consoleMessages, ...pageErrors].join(" | ")}`)
    }
    const interactionResult = await verifyRouteInteraction(page, route, options)

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
    page.off("console", onConsole)
    page.off("pageerror", onPageError)
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
    for (const route of ROUTES) {
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
    return { viewport: viewport.name, routes }
  } finally {
    await context.close()
  }
}

async function run() {
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
