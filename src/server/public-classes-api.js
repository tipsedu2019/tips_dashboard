import {
  buildPublicClassesPayload,
  isFallbackPublicClassesPayload,
} from "./public-classes-payload.js";

export function createPublicClassesApiResponder(
  buildPayload = buildPublicClassesPayload,
) {
  return async function respond() {
    const payload = await buildPayload();
    const isFallback = isFallbackPublicClassesPayload(payload);

    return {
      status: isFallback ? 503 : 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": isFallback
          ? "no-store"
          : "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      },
      body: JSON.stringify(payload),
    };
  };
}
