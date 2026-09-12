import { createContentAdminHandlers } from "@/features/public-content/server/content-routes";
export const runtime = "nodejs";
export const { entries: GET } = createContentAdminHandlers();
export const POST = GET;
