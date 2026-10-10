import { createProductionRegistrationContactCommandRoute } from "@/features/tasks/server/registration-contact-command-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const handler = createProductionRegistrationContactCommandRoute()

export function POST(request: Request) { return handler(request) }
