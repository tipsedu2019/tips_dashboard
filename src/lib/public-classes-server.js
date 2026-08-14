import fs from "node:fs/promises";

import {
  buildFallbackPublicClassesPayload,
  isFallbackPublicClassesPayload,
  normalizePublicClassesSummaryPayload,
  publicClassesOutputPath,
} from "../server/public-classes-payload.js";
import { loadCachedPublicClassesSummary } from "../server/public-classes-cache.js";

export async function readPublicClassesSnapshot(
  outputPath = publicClassesOutputPath,
) {
  try {
    const raw = await fs.readFile(outputPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function loadPublicClassesPagePayload(
  buildPayload = null,
  readSnapshot = readPublicClassesSnapshot,
) {
  const livePayload = buildPayload
    ? await buildPayload()
    : await loadCachedPublicClassesSummary();
  if (livePayload && !isFallbackPublicClassesPayload(livePayload)) {
    return livePayload;
  }

  const snapshotPayload = await readSnapshot();
  return normalizePublicClassesSummaryPayload(snapshotPayload)
    || livePayload
    || buildFallbackPublicClassesPayload("Public class data is temporarily unavailable.");
}
