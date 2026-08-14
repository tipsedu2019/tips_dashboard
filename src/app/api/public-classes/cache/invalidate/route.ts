import { createClient } from "@supabase/supabase-js";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { createPublicClassesCacheInvalidationResponder } from "../../../../../server/public-classes-cache-invalidation.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function bearer(request: Request) {
  return /^Bearer ([^\s]+)$/iu.exec(request.headers.get("authorization") || "")?.[1] || "";
}

async function authenticate(request: Request) {
  const token = bearer(request);
  const url = text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const key = text(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);
  if (!token || !url || !key) return null;
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const user = await client.auth.getUser(token);
  if (user.error || !user.data.user?.id) return null;
  const roleResult = await client.rpc("current_dashboard_role").abortSignal(AbortSignal.timeout(8_000)).retry(false);
  if (roleResult.error) return null;
  return { role: text(roleResult.data) };
}

const respond = createPublicClassesCacheInvalidationResponder({
  authenticate,
  revalidateTag,
  revalidatePath,
});

export async function POST(request: Request) {
  const result = await respond(await request.json().catch(() => null), request);
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
