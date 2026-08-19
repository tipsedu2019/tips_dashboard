import {
  assertRegistrationCustomerMessagePublicPayload,
  isRegistrationCustomerMessageBundleKind,
  parseRegistrationCustomerMessageTarget,
  type RegistrationCustomerMessagePreviewResponse,
} from "../registration-customer-message-contract.ts"
import {
  createRegistrationCustomerMessageBundleCatalog,
  type RegistrationCustomerMessageBundleServerEnv,
} from "./registration-customer-message-bundle-catalog.ts"
import { createRegistrationCustomerMessageBundleSourceResolver } from "./registration-customer-message-bundle-source.ts"
import {
  RegistrationCustomerMessageHttpError,
  createProductionRegistrationCustomerMessageAuth,
} from "./registration-customer-message-auth.ts"

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } })
}

function errorResponse(error: unknown) {
  if (error instanceof RegistrationCustomerMessageHttpError) return json({ ok: false, code: error.code }, error.status)
  if (error instanceof Error && error.message.startsWith("registration_customer_message_bundle_")) {
    return json({ ok: false, code: "registration_customer_message_source_invalid" }, 422)
  }
  return json({ ok: false, code: "registration_customer_message_runtime_unavailable" }, 503)
}

export function createProductionRegistrationCustomerMessageBundlePreviewHandler(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const auth = createProductionRegistrationCustomerMessageAuth()
  const catalog = createRegistrationCustomerMessageBundleCatalog(environment as RegistrationCustomerMessageBundleServerEnv)
  return async function preview(request: Request) {
    try {
      const target = parseRegistrationCustomerMessageTarget(await request.json())
      if (!target || !isRegistrationCustomerMessageBundleKind(target.messageKind)) {
        throw new RegistrationCustomerMessageHttpError(400, "registration_customer_message_preview_input_invalid")
      }
      const context = await auth.authenticate(request)
      if (!["admin", "staff"].includes(context.role) || !await auth.authorizeTask(context, target.sourceId)) {
        throw new RegistrationCustomerMessageHttpError(404, "registration_customer_message_source_not_found")
      }
      const bundleTarget = { messageKind: target.messageKind, sourceId: target.sourceId }
      const resolver = createRegistrationCustomerMessageBundleSourceResolver({
        catalog,
        async resolveSource(input) {
          const result = await context.serviceClient.rpc("resolve_registration_customer_message_bundle_source_v1", {
            p_message_kind: input.messageKind,
            p_task_id: input.sourceId,
            p_service_date: null,
          })
          if (result.error) {
            console.error("registration_customer_message_bundle_source_rpc_failed", {
              code: result.error.code,
              hint: result.error.hint,
            })
            throw new Error("registration_customer_message_bundle_source_invalid")
          }
          return result.data
        },
      })
      const source = await resolver.resolve(bundleTarget)
      const template = catalog.templates[bundleTarget.messageKind]
      const readiness = {
        runtimeReady: true,
        activationMode: "off" as const,
        activationEligible: false,
        credentialsConfigured: false,
        pfConfigured: false,
        templateConfigured: template.templateConfigured,
        templateVerified: false,
        verifiedAt: null,
        sourceValid: true,
        sendAllowed: false,
        blockers: ["activation_off"] as const,
      }
      const payload: RegistrationCustomerMessagePreviewResponse = {
        ok: true,
        previewId: null,
        expiresAt: null,
        messageKind: source.messageKind,
        studentName: source.studentName,
        recipientLast4: "0000",
        facts: source.facts,
        body: source.body,
        buttons: source.buttons,
        readiness: { ...readiness, blockers: [...readiness.blockers] },
        latestMessage: null,
      }
      return json(assertRegistrationCustomerMessagePublicPayload(payload))
    } catch (error) {
      return errorResponse(error)
    }
  }
}
