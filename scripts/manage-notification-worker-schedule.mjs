import { fileURLToPath } from "node:url"

export const NOTIFICATION_SCHEDULE_NAMES = Object.freeze([
  "tips-notification-worker-v1",
  "tips-notification-cutover-watchdog-v1",
])

const MODE_FUNCTION = Object.freeze({
  inspect: "dashboard_private.inspect_notification_schedules_v1()",
  install: "dashboard_private.manage_notification_schedules_v1('install')",
  disable: "dashboard_private.manage_notification_schedules_v1('disable')",
  remove: "dashboard_private.manage_notification_schedules_v1('remove')",
})
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function buildNotificationSchedulePlan(input = {}) {
  const mode = String(input.mode || "inspect")
  if (!(mode in MODE_FUNCTION)) throw new Error("notification_schedule_mode_invalid")
  const execute = input.execute === true
  if (execute && input.authorization !== "schedule-change-approved") {
    throw new Error("explicit_schedule_authorization_required")
  }
  const requestId = String(input.requestId || "")
  if (execute && !UUID.test(requestId)) {
    throw new Error("notification_schedule_request_id_required")
  }
  return Object.freeze({
    mode,
    execute,
    requestId,
    scheduleNames: NOTIFICATION_SCHEDULE_NAMES,
    statements: Object.freeze([`select ${MODE_FUNCTION[mode]};`]),
  })
}

export async function executeNotificationSchedulePlan(plan, dependencies) {
  if (!plan?.execute || !UUID.test(String(plan.requestId || ""))) {
    throw new Error("notification_schedule_execution_not_authorized")
  }
  if (!dependencies || typeof dependencies.rpc !== "function") {
    throw new Error("notification_schedule_rpc_unavailable")
  }
  return dependencies.rpc("manage_notification_worker_schedule_v1", {
    p_action: plan.mode,
    p_request_id: plan.requestId,
  })
}

function argumentsFor(argv) {
  const modeIndex = argv.indexOf("--mode")
  return {
    mode: modeIndex >= 0 ? argv[modeIndex + 1] : "inspect",
    execute: argv.includes("--execute"),
    authorization: argv.includes("--authorized") ? "schedule-change-approved" : "",
    requestId: argv.includes("--request-id")
      ? argv[argv.indexOf("--request-id") + 1]
      : "",
  }
}

async function main() {
  const plan = buildNotificationSchedulePlan(argumentsFor(process.argv.slice(2)))
  if (plan.execute) {
    const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim()
    const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
    if (!url || !serviceRoleKey) throw new Error("Supabase 서비스 실행 환경이 필요합니다.")
    const { createClient } = await import("@supabase/supabase-js")
    const client = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const result = await executeNotificationSchedulePlan(plan, {
      async rpc(name, parameters) {
        const { data, error } = await client.rpc(name, parameters)
        if (error) throw new Error("스케줄 관리 RPC 실행에 실패했습니다.")
        return data
      },
    })
    process.stdout.write(`${JSON.stringify({
      ok: true,
      실행: true,
      모드: plan.mode,
      스케줄: plan.scheduleNames,
      결과: result,
    }, null, 2)}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    실행: false,
    모드: plan.mode,
    스케줄: plan.scheduleNames,
    SQL: plan.statements,
  }, null, 2)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "스케줄 점검에 실패했습니다."}\n`)
    process.exitCode = 1
  })
}
