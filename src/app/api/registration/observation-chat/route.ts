import { createProductionRegistrationObservationChatHandlers } from "@/features/tasks/server/registration-observation-chat-route"
export const runtime = "nodejs"
export async function GET(request: Request) { return createProductionRegistrationObservationChatHandlers().GET(request) }
export async function POST(request: Request) { return createProductionRegistrationObservationChatHandlers().POST(request) }
