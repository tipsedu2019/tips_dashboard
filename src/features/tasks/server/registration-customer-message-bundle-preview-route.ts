import type { SupabaseClient } from "@supabase/supabase-js"
import {
  assertRegistrationNonpageableRpcArguments,
  assertRegistrationNonpageableRpcResult,
} from "../../../lib/registration-nonpageable-rpc-contract.js"
import {
  assertRegistrationCustomerMessagePublicPayload,
  isRegistrationCustomerMessageBundleKind,
  parseRegistrationCustomerMessageTarget,
  type RegistrationCustomerMessagePreviewResponse,
} from "../registration-customer-message-contract.ts"
import {
  createRegistrationCustomerMessageCatalog,
  type RegistrationCustomerMessageServerEnv,
} from "./registration-customer-message-catalog.ts"
import { createRegistrationCustomerMessageBundlePreviewSourceResolver } from "./registration-customer-message-bundle-source.ts"
import {
  RegistrationCustomerMessageHttpError,
  createProductionRegistrationCustomerMessageAuth,
} from "./registration-customer-message-auth.ts"
import {
  assertRegistrationCustomerMessageContactUse,
  parseRegistrationCustomerMessageContactFence,
} from "./registration-customer-message-contact-fence.ts"

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

async function readBundleContactFence(
  client: SupabaseClient,
  actorProfileId: string,
  messageKind: string,
  sourceId: string,
) {
  const args = {
    p_actor_profile_id: actorProfileId,
    p_message_kind: messageKind,
    p_source_id: sourceId,
  }
  assertRegistrationNonpageableRpcArguments("read_registration_contact_message_fence_v1", args)
  const result = await client.rpc("read_registration_contact_message_fence_v1", args)
    .abortSignal(AbortSignal.timeout(8_000)).retry(false)
  if (result.error) return result
  assertRegistrationNonpageableRpcResult("read_registration_contact_message_fence_v1", result.data, args)
  return result
}

async function readBundleSource(client: SupabaseClient, messageKind: string, sourceId: string) {
  const args = {
    p_message_kind: messageKind,
    p_task_id: sourceId,
    p_service_date: null,
  }
  assertRegistrationNonpageableRpcArguments("read_registration_contact_bundle_preview_v1", args)
  const result = await client.rpc("read_registration_contact_bundle_preview_v1", args)
    .abortSignal(AbortSignal.timeout(8_000)).retry(false)
  if (result.error) return result
  assertRegistrationNonpageableRpcResult("read_registration_contact_bundle_preview_v1", result.data, args)
  return result
}

export function createProductionRegistrationCustomerMessageBundlePreviewHandler(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: Readonly<{ auth?: ReturnType<typeof createProductionRegistrationCustomerMessageAuth> }> = {},
) {
  const auth = dependencies.auth ?? createProductionRegistrationCustomerMessageAuth()
  const catalog = createRegistrationCustomerMessageCatalog(environment as RegistrationCustomerMessageServerEnv)
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
      const fenceResult = await readBundleContactFence(
        context.serviceClient, context.actorProfileId, target.messageKind, target.sourceId,
      )
      if (fenceResult.error) {
        throw new RegistrationCustomerMessageHttpError(503, "registration_customer_message_runtime_unavailable")
      }
      const contactFence = parseRegistrationCustomerMessageContactFence(fenceResult.data, {
        ...bundleTarget, taskId: target.sourceId,
      })
      try {
        assertRegistrationCustomerMessageContactUse({ fence: contactFence, action: "preview",
          expectedContactGeneration: contactFence.contactGeneration, request: null })
      } catch {
        throw new RegistrationCustomerMessageHttpError(409, "registration_customer_message_source_ineligible")
      }
      const resolver = createRegistrationCustomerMessageBundlePreviewSourceResolver({
        catalog,
        async resolveSource(input) {
          const result = await readBundleSource(context.serviceClient, input.messageKind, input.sourceId)
          if (result.error) {
            throw new Error("registration_customer_message_bundle_source_invalid")
          }
          return result.data
        },
      })
      const source = await resolver.resolve(bundleTarget)
      const template = catalog.templates[source.templateKind]
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
