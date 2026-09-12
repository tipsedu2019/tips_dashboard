import { createRecruitingAdminHandlers } from "../../../../../../features/recruiting/server/recruiting-routes.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createRecruitingAdminHandlers();
type Context = { params: Promise<{ applicationId: string }> };
export async function GET(request: Request, context: Context) {
  return handlers.detail(request, (await context.params).applicationId);
}
export async function DELETE(request: Request, context: Context) {
  return handlers.detail(request, (await context.params).applicationId);
}
