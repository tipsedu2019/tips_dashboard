import { readPublicClassesSnapshot } from "../lib/public-classes-server.js";
import { createPublicClassCatalogLoader } from "./public-class-catalog.ts";
import { loadCachedPublicClassesSummary } from "./public-classes-cache.js";
import { normalizePublicClassesSummaryPayload } from "./public-classes-payload.js";

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const textFields = ["name", "className", "subject", "grade", "teacher", "room", "classroom", "schedule", "status"];
const numericFields = ["fee", "tuition", "capacity"];

// The existing normalizer deliberately tolerates legacy snapshots. Reject a
// damaged batch before its record filtering can turn a failure into empty data.
function verifiedPayload(payload) {
  if (!record(payload) || payload.source !== "supabase" || !Array.isArray(payload.classes)) {
    throw new Error("public_classes_unavailable");
  }
  const ids = new Set();
  for (const row of payload.classes) {
    if (!record(row) || typeof row.id !== "string" || !row.id.trim() || ids.has(row.id)) {
      throw new Error("public_classes_unavailable");
    }
    ids.add(row.id);
    for (const key of textFields) {
      if (row[key] != null && typeof row[key] !== "string") throw new Error("public_classes_unavailable");
    }
    for (const key of numericFields) {
      if (row[key] == null) continue;
      const value = typeof row[key] === "number" || typeof row[key] === "string" ? Number(row[key]) : NaN;
      if (!Number.isFinite(value) || value < 0 || (key === "capacity" && !Number.isSafeInteger(value))) {
        throw new Error("public_classes_unavailable");
      }
    }
    for (const key of ["enrolledCount", "waitlistCount"]) {
      if (row[key] != null && (!Number.isSafeInteger(row[key]) || row[key] < 0)) {
        throw new Error("public_classes_unavailable");
      }
    }
  }
  return payload;
}

export function createPublicClassesSummaryApiResponder({
  loadLive = loadCachedPublicClassesSummary,
  readSnapshot = readPublicClassesSnapshot,
  now = () => Date.now(),
} = {}) {
  // This is the same small tagged summary read and bounded static fallback used
  // by the Next public list. Never load the full plans/textbook/progress API.
  const loadCatalog = createPublicClassCatalogLoader({
    loadLive: async () => verifiedPayload(await loadLive()),
    readSnapshot: async () => verifiedPayload(await readSnapshot()),
    now,
  });
  return async function respond() {
    try {
      const catalog = await loadCatalog();
      if (catalog.availability === "unavailable") throw new Error("public_classes_unavailable");
      const summary = normalizePublicClassesSummaryPayload({
        source: "supabase",
        generatedAt: catalog.generatedAt,
        classes: catalog.classes,
      });
      if (!summary) throw new Error("public_classes_unavailable");
      return {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": catalog.availability === "live"
            ? "public, max-age=0, s-maxage=600"
            : "no-store",
        },
        body: JSON.stringify({
          source: "supabase",
          generatedAt: catalog.generatedAt,
          availability: catalog.availability,
          classes: summary.classes,
        }),
      };
    } catch {
      return {
        status: 503,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        body: JSON.stringify({ error: "public_classes_unavailable" }),
      };
    }
  };
}
