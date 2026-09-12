import { createRecruitingAdminHandlers } from "../../../../../features/recruiting/server/recruiting-routes.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createRecruitingAdminHandlers().list;
