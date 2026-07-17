export type LegacyDeliveryIntentRecord = Readonly<{
  deliveryId: string
  legacyTemplateChecksum: string
  normalizedRenderedHash: string
  requestId: string
}>

export type LegacyDeliveryRenderedContent = Readonly<{
  title: unknown
  body: unknown
  href: unknown
}>

export function normalizedNotificationRenderedHash(
  content: LegacyDeliveryRenderedContent,
): string

export function recordLegacyNotificationDeliveryIntent(
  input: LegacyDeliveryRenderedContent & Readonly<{
    deliveryId: string
    requestId: string
    legacyTemplateChecksum: string
    record: (intent: LegacyDeliveryIntentRecord) => Promise<unknown>
  }>,
): Promise<Readonly<{
  recorded: boolean
  normalizedRenderedHash: string
  reason?: "legacy_delivery_intent_recorder_failed"
}>>
