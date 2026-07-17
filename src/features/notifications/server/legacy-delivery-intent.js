import { createHash } from "node:crypto"

function normalizeRenderedValue(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .normalize("NFC")
    .replace(/^[ \t\n\f\v]+|[ \t\n\f\v]+$/g, "")
}

export function normalizedNotificationRenderedHash({ title, body, href }) {
  const serialized = JSON.stringify({
    title: normalizeRenderedValue(title),
    body: normalizeRenderedValue(body),
    href: normalizeRenderedValue(href),
  })
  return createHash("sha256").update(serialized, "utf8").digest("hex")
}

export async function recordLegacyNotificationDeliveryIntent({
  deliveryId,
  requestId,
  legacyTemplateChecksum,
  title,
  body,
  href,
  record,
}) {
  const normalizedRenderedHash = normalizedNotificationRenderedHash({ title, body, href })
  try {
    const result = await record({
      deliveryId,
      legacyTemplateChecksum,
      normalizedRenderedHash,
      requestId,
    })
    return {
      recorded: result !== null
        && typeof result === "object"
        && !Array.isArray(result)
        && result.recorded === true,
      normalizedRenderedHash,
    }
  } catch {
    return {
      recorded: false,
      normalizedRenderedHash,
      reason: "legacy_delivery_intent_recorder_failed",
    }
  }
}
