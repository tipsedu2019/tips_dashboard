import { createRecruitingApplicationHandler, createRecruitingProxyProbeHandler } from "../../../../features/recruiting/server/recruiting-routes.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createRecruitingApplicationHandler();
export const GET = createRecruitingProxyProbeHandler();
