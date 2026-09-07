import type {
  PublicClassCatalog,
  PublicClassItem,
} from "../components/public/classes/types.ts";
import { readPublicClassesSnapshot } from "../lib/public-classes-server.js";
import {
  PUBLIC_CLASSES_SNAPSHOT_MAX_AGE_MS,
  PUBLIC_CLASSES_SUMMARY_REVALIDATE_SECONDS,
  loadCachedPublicClassesSummary,
} from "./public-classes-cache.js";
import {
  isFallbackPublicClassesPayload,
  normalizePublicClassesSummaryPayload,
} from "./public-classes-payload.js";

type CatalogPayload = {
  generatedAt?: unknown;
  source?: unknown;
  classes?: unknown;
};

type PublicClassCatalogLoaderOptions = {
  loadLive?: () => Promise<unknown>;
  readSnapshot?: () => Promise<unknown>;
  now?: () => number;
};

function generatedAt(payload: CatalogPayload): string | null {
  return typeof payload.generatedAt === "string" ? payload.generatedAt : null;
}

function ageOf(payload: CatalogPayload, now: () => number): number | null {
  const timestamp = generatedAt(payload);
  if (!timestamp) return null;
  const age = now() - Date.parse(timestamp);
  return Number.isFinite(age) && age >= 0 ? age : null;
}

function isFreshSnapshot(payload: CatalogPayload, now: () => number): boolean {
  const age = ageOf(payload, now);
  return age !== null && age <= PUBLIC_CLASSES_SNAPSHOT_MAX_AGE_MS;
}

function normalizeCatalog(
  payload: unknown,
  availability: "live" | "snapshot",
): PublicClassCatalog | null {
  if (!payload || typeof payload !== "object" || isFallbackPublicClassesPayload(payload)) {
    return null;
  }
  const normalized = normalizePublicClassesSummaryPayload(payload);
  if (!normalized) return null;
  return {
    classes: normalized.classes as PublicClassItem[],
    generatedAt: generatedAt(payload as CatalogPayload),
    availability,
  };
}

export function createPublicClassCatalogLoader({
  loadLive = loadCachedPublicClassesSummary,
  readSnapshot = readPublicClassesSnapshot,
  now = () => Date.now(),
}: PublicClassCatalogLoaderOptions = {}) {
  return async function loadCatalog(): Promise<PublicClassCatalog> {
    try {
      const livePayload = await loadLive();
      if (livePayload && typeof livePayload === "object") {
        const age = ageOf(livePayload as CatalogPayload, now);
        if (age !== null && age <= PUBLIC_CLASSES_SNAPSHOT_MAX_AGE_MS) {
          const availability = age <= PUBLIC_CLASSES_SUMMARY_REVALIDATE_SECONDS * 1_000
            ? "live"
            : "snapshot";
          const live = normalizeCatalog(livePayload, availability);
          if (live) return live;
        }
      }
    } catch {
      // A bounded static snapshot is the only fallback for a failed live read.
    }

    try {
      const snapshot = await readSnapshot();
      if (
        snapshot &&
        typeof snapshot === "object" &&
        isFreshSnapshot(snapshot as CatalogPayload, now)
      ) {
        const normalized = normalizeCatalog(snapshot, "snapshot");
        if (normalized) return normalized;
      }
    } catch {
      // Missing and unreadable snapshots both produce the recoverable state below.
    }

    return { classes: [], generatedAt: null, availability: "unavailable" };
  };
}

const loadDefaultPublicClassCatalog = createPublicClassCatalogLoader();

export async function loadPublicClassCatalog(): Promise<PublicClassCatalog> {
  return loadDefaultPublicClassCatalog();
}
