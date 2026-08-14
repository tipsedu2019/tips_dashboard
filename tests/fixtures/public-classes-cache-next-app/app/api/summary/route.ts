import { revalidateTag } from "next/cache";

import {
  PUBLIC_CLASSES_SUMMARY_CACHE_TAG,
  createPublicClassesSummaryCache,
} from "../../../../../../src/server/public-classes-cache.js";

export const dynamic = "force-dynamic";

const counterPath = process.env.TIPS_PUBLIC_CACHE_COUNTER_PATH || "";
const shouldFail = () => process.env.TIPS_PUBLIC_CACHE_FAIL === "1";

async function count() {
  const fs = await import("node:fs/promises");
  const current = Number(await fs.readFile(counterPath, "utf8").catch(() => "0"));
  const next = current + 1;
  await fs.writeFile(counterPath, String(next), "utf8");
  return next;
}

const cache = createPublicClassesSummaryCache({
  async loadSummary() {
    const call = await count();
    if (shouldFail()) throw new Error("fixture_upstream_unavailable");
    return {
      generatedAt: "2026-08-14T00:00:00.000Z",
      source: "supabase",
      classes: [{ id: `class-${call}`, name: "cache fixture" }],
      textbooks: [],
      progressLogs: [],
    };
  },
});

export async function GET() {
  return Response.json(await cache.load());
}

export async function POST() {
  revalidateTag(PUBLIC_CLASSES_SUMMARY_CACHE_TAG, "max");
  return Response.json({ ok: true });
}
