import { createProductionRegistrationCustomerMessageAuth } from "./registration-customer-message-auth.ts"
import { parseRegistrationVisitCancellationPage } from "../registration-visit-cancellation-service.ts"

type Dependencies = {
  authenticate(request: Request): Promise<{
    role: string
    actorClient: { rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }
  }>
}

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

export function createRegistrationVisitCancellationGet(dependencies: Dependencies) {
  return async function GET(request: Request) {
    try {
      const context = await dependencies.authenticate(request)
      if (!["admin", "staff"].includes(context.role)) return response({ ok: false, error: "Forbidden" }, 403)
      const query = new URL(request.url).searchParams
      const taskId = query.get("taskId") ?? ""
      const rawPage = query.get("page") ?? "1"
      const rawPageSize = query.get("pageSize") ?? "10"
      const page = Number(rawPage)
      const pageSize = Number(rawPageSize)
      if (request.method !== "GET" || !/^[1-9]\d{0,5}$/.test(rawPage) || !["10", "15", "20"].includes(rawPageSize)
        || [...query.keys()].some((key) => !["taskId", "page", "pageSize"].includes(key))
        || query.getAll("taskId").length !== 1 || query.getAll("page").length > 1 || query.getAll("pageSize").length > 1
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)
        || !Number.isInteger(page) || page < 1 || page > 100000 || ![10,15,20].includes(pageSize)) {
        return response({ ok: false, error: "Invalid request" }, 400)
      }
      const result = await context.actorClient.rpc("list_registration_visit_cancellations_v1", { p_task_id: taskId, p_page: page, p_page_size: pageSize })
      if (result.error) throw result.error
      if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw new Error("invalid_list")
      return response({ ...parseRegistrationVisitCancellationPage(result.data, page, pageSize as 10 | 15 | 20), ok: true })
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 503
      return response({ ok: false, error: status === 401 ? "Unauthorized" : "취소 안내 목록을 불러오지 못했습니다." }, [401, 403].includes(status) ? status : 503)
    }
  }
}

export function createProductionRegistrationVisitCancellationGet() {
  return createRegistrationVisitCancellationGet({
    authenticate: (request) => createProductionRegistrationCustomerMessageAuth().authenticate(request),
  })
}
