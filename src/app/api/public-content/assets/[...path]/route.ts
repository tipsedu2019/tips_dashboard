import { servePublicContentAsset } from "@/features/public-content/server/content-routes";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return servePublicContentAsset(request, (await context.params).path);
}
