import { unstable_cache } from "next/cache.js";

import {
  buildFallbackPublicClassesPayload,
  buildPublicClassesPayload,
  isFallbackPublicClassesPayload,
  normalizePublicClassesSummaryPayload,
} from "./public-classes-payload.js";

export const PUBLIC_CLASSES_SUMMARY_CACHE_TAG = "public-classes-summary-v1";
export const PUBLIC_CLASSES_SUMMARY_REVALIDATE_SECONDS = 600;

function unavailable() {
  return new Error("public_classes_summary_unavailable");
}

export async function loadSuccessfulPublicClassSummary(...sourceArguments) {
  const [options = {}] = sourceArguments;
  const payload = await buildPublicClassesPayload({
    ...options,
    mode: "summary",
  });
  if (isFallbackPublicClassesPayload(payload)) throw unavailable();
  return payload;
}

export const loadCachedSuccessfulPublicClassSummary = unstable_cache(
  loadSuccessfulPublicClassSummary,
  ["public-classes-summary-v1"],
  {
    revalidate: 600,
    tags: ["public-classes-summary-v1"],
  },
);

export function createPublicClassesSummaryCache({
  loadSummary = loadSuccessfulPublicClassSummary,
  readSnapshot = async () => null,
  cache = unstable_cache,
} = {}) {
  const loadCachedSummary = cache(
    async (...sourceArguments) => {
      const payload = await loadSummary(...sourceArguments);
      if (isFallbackPublicClassesPayload(payload)) throw unavailable();
      return payload;
    },
    [PUBLIC_CLASSES_SUMMARY_CACHE_TAG],
    {
      revalidate: PUBLIC_CLASSES_SUMMARY_REVALIDATE_SECONDS,
      tags: [PUBLIC_CLASSES_SUMMARY_CACHE_TAG],
    },
  );

  return {
    async load(...sourceArguments) {
      try {
        return await loadCachedSummary(...sourceArguments);
      } catch {
        const snapshot = await readSnapshot();
        const normalized = normalizePublicClassesSummaryPayload(snapshot);
        return normalized || buildFallbackPublicClassesPayload(
          "Public class data is temporarily unavailable.",
        );
      }
    },
  };
}

const defaultSummaryCache = {
  async load(...sourceArguments) {
    try {
      return await loadCachedSuccessfulPublicClassSummary(...sourceArguments);
    } catch {
      return null;
    }
  },
};

export async function loadCachedPublicClassesSummary(...sourceArguments) {
  return defaultSummaryCache.load(...sourceArguments);
}
