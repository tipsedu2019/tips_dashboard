import {
  buildPublicClassesPayload,
  isFallbackPublicClassesPayload,
  writePublicClassesPayload,
} from "../src/server/publicClassesPayload.js";

async function main() {
  const payload = await buildPublicClassesPayload();
  await writePublicClassesPayload(payload);

  if (isFallbackPublicClassesPayload(payload)) {
    console.warn("[public-classes] wrote fallback payload.");
    console.warn(payload.reason || "Unknown fetch error");
    return;
  }

  console.log(
    `[public-classes] wrote ${payload.classes.length} classes, ${payload.textbooks.length} textbooks, ${payload.progressLogs.length} progress logs`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
