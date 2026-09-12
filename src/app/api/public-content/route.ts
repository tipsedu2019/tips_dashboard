import { createPublicContentHandler } from "@/features/public-content/server/content-routes";
export const runtime = "nodejs";
export const GET = createPublicContentHandler();
