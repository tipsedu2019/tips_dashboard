import { createProductionRegistrationCustomerMessageBundlePreviewHandler } from "@/features/tasks/server/registration-customer-message-bundle-preview-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

let preview: ReturnType<typeof createProductionRegistrationCustomerMessageBundlePreviewHandler> | null = null

export function POST(request: Request) {
  preview ??= createProductionRegistrationCustomerMessageBundlePreviewHandler()
  return preview(request)
}
