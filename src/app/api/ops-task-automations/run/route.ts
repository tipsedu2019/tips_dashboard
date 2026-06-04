import { NextResponse } from "next/server"

import {
  createOpsAutomationSupabaseClient,
  createSupabaseOpsTaskAutomationStore,
  runOpsTaskAutomationCycle,
} from "../../../../server/ops-task-automation-runner.js"

export const dynamic = "force-dynamic"

function isAuthorizedAutomationRequest(request: Request) {
  const authHeader = request.headers.get("authorization")
  return Boolean(process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`)
}

export async function GET(request: Request) {
  if (!isAuthorizedAutomationRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const client = createOpsAutomationSupabaseClient()
  if (!client) {
    return NextResponse.json({
      ok: false,
      error: "SUPABASE_SERVICE_ROLE_KEY is required for ops task automations.",
    }, { status: 503 })
  }

  const store = createSupabaseOpsTaskAutomationStore(client)
  const runAutomationCycle = runOpsTaskAutomationCycle as (options: { store: unknown }) => Promise<unknown>
  const result = await runAutomationCycle({ store })

  return NextResponse.json({ ok: true, result })
}
