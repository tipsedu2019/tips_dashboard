import fs from "node:fs/promises";

import {
  buildPublicClassesPayload,
  isFallbackPublicClassesPayload,
  publicClassesOutputPath,
} from "../server/public-classes-payload.js";

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
  buildPayload = buildPublicClassesPayload,
  readSnapshot = readPublicClassesSnapshot,
) {
  const livePayload = await buildPayload();
  if (!isFallbackPublicClassesPayload(livePayload)) {
    return livePayload;
  }

  const snapshotPayload = await readSnapshot();
  return snapshotPayload || livePayload;
}
