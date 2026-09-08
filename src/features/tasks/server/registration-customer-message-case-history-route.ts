import {
  parseRegistrationCaseCustomerMessageHistory,
  parseRegistrationCaseCustomerMessageHistoryInput,
  type RegistrationCaseCustomerMessageHistoryInput,
} from "../registration-customer-message-case-history-contract.ts"
import {
  createProductionRegistrationCustomerMessageAuth,
  RegistrationCustomerMessageHttpError,
  type RegistrationCustomerMessageAuthContext,
} from "./registration-customer-message-auth.ts"

type Dependencies = Readonly<{
  authenticate: (request: Request) => Promise<RegistrationCustomerMessageAuthContext>
  authorizeTask: (context: RegistrationCustomerMessageAuthContext, taskId: string) => Promise<boolean>
  listHistory: (context: RegistrationCustomerMessageAuthContext, input: RegistrationCaseCustomerMessageHistoryInput) => Promise<unknown>
}>

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "Vary": "Authorization" } })
}

export function createRegistrationCaseCustomerMessageHistoryHandler(dependencies: Dependencies) {
  return async (request: Request) => {
    try {
      const context = await dependencies.authenticate(request)
      if (!["admin", "staff"].includes(context.role)) throw new RegistrationCustomerMessageHttpError(403, "registration_customer_message_forbidden")
      const input = parseRegistrationCaseCustomerMessageHistoryInput(new URL(request.url).searchParams)
      if (request.method !== "GET" || !input) throw new RegistrationCustomerMessageHttpError(400, "registration_customer_message_history_input_invalid")
      if (!await dependencies.authorizeTask(context, input.taskId)) throw new RegistrationCustomerMessageHttpError(404, "registration_customer_message_source_not_found")
      return json(parseRegistrationCaseCustomerMessageHistory(await dependencies.listHistory(context, input), input))
    } catch (error) {
      if (error instanceof RegistrationCustomerMessageHttpError) return json({ ok: false, code: error.code }, error.status)
      return json({ ok: false, code: "registration_customer_message_history_unavailable" }, 503)
    }
  }
}

export function createProductionRegistrationCaseCustomerMessageHistoryHandler() {
  const auth = createProductionRegistrationCustomerMessageAuth()
  return createRegistrationCaseCustomerMessageHistoryHandler({
    authenticate: auth.authenticate,
    authorizeTask: auth.authorizeTask,
    async listHistory(context, input) {
      const result = await context.serviceClient.rpc("list_registration_case_customer_messages_v1", {
        p_actor_profile_id: context.actorProfileId,
        p_task_id: input.taskId,
        p_page: input.page,
        p_page_size: input.pageSize,
      })
      if (result.error) {
        const forbidden = ["42501", "P0002"].includes(result.error.code)
        throw new RegistrationCustomerMessageHttpError(forbidden ? 404 : 503,
          forbidden ? "registration_customer_message_source_not_found" : "registration_customer_message_history_unavailable")
      }
      return result.data
    },
  })
}
