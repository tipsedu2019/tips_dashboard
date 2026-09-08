import { POST as sendVisitNotification } from "../consultation-notification/route"
import { createProductionRegistrationVisitCancellationGet } from "@/features/tasks/server/registration-visit-cancellation-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = createProductionRegistrationVisitCancellationGet()

export async function POST(request: Request) {
  const body = await request.clone().json().catch(() => null)
  if (body?.intent !== "send_registration_visit_cancellation") {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }
  const result = await sendVisitNotification(request)
  result.headers.set("Cache-Control", "no-store")
  return result
}
