import fs from "node:fs/promises";

import { unstable_cache } from "next/cache.js";

import {
  buildFallbackPublicClassesPayload,
  buildPublicClassesPayload,
  isFallbackPublicClassesPayload,
  normalizePublicClassesFullPayload,
  normalizePublicClassesSummaryPayload,
  publicClassesOutputPath,
} from "./public-classes-payload.js";

export const PUBLIC_CLASSES_FULL_CACHE_TAG = "public-classes-full-v1";
export const PUBLIC_CLASSES_FULL_REVALIDATE_SECONDS = 600;
export const PUBLIC_CLASSES_SNAPSHOT_MAX_AGE_MS = 86_400_000;
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

function fullUnavailable() {
  return new Error("public_classes_full_unavailable");
}

async function readPublicClassesFullSnapshot() {
  try {
    const raw = await fs.readFile(publicClassesOutputPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isFreshPublicClassesSnapshot(payload, now) {
  const generatedAt = Date.parse(payload.generatedAt);
  if (!Number.isFinite(generatedAt)) return false;

  const age = now() - generatedAt;
  return age >= 0 && age <= PUBLIC_CLASSES_SNAPSHOT_MAX_AGE_MS;
}

export async function loadSuccessfulPublicClassesFull(...sourceArguments) {
  const [options = {}] = sourceArguments;
  const payload = await buildPublicClassesPayload({
    ...options,
    mode: "full",
  });
  const normalized = normalizePublicClassesFullPayload(payload);
  if (!normalized) throw fullUnavailable();
  return normalized;
}

// The full compatibility response can exceed Next Data Cache's 2 MB item
// limit. Its route sends a 10-minute CDN cache header instead, while the
// smaller summary payload continues to use the tagged Next Data Cache above.
export async function loadCachedSuccessfulPublicClassesFull(...sourceArguments) {
  return loadSuccessfulPublicClassesFull(...sourceArguments);
}

export function createPublicClassesFullCache({
  loadFull = loadSuccessfulPublicClassesFull,
  readSnapshot = readPublicClassesFullSnapshot,
  now = () => Date.now(),
} = {}) {
  return {
    async load(...sourceArguments) {
      try {
        const payload = await loadFull(...sourceArguments);
        const normalized = normalizePublicClassesFullPayload(payload);
        if (!normalized) throw fullUnavailable();
        return normalized;
      } catch {
        const rawSnapshot = await readSnapshot();
        const snapshot = normalizePublicClassesFullPayload(rawSnapshot);
        if (
          snapshot &&
          typeof rawSnapshot?.generatedAt === "string" &&
          isFreshPublicClassesSnapshot(rawSnapshot, now)
        ) {
          return snapshot;
        }
        return buildFallbackPublicClassesPayload(
          "Public class data is temporarily unavailable.",
        );
      }
    },
  };
}

const defaultFullCache = createPublicClassesFullCache();

export async function loadCachedPublicClassesFull(...sourceArguments) {
  return defaultFullCache.load(...sourceArguments);
}
