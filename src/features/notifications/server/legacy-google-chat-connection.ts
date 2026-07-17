type LegacyGoogleChatConnectionRow = Readonly<{
  found: boolean
  connectionState: string | null
  webhookUrl: string | null
}>

type LegacyGoogleChatConnectionReader = Readonly<{
  loadRow: () => Promise<LegacyGoogleChatConnectionRow>
  legacyEnvironmentUrl: string
}>

function normalizedText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : ""
}

export async function readLegacyGoogleChatWebhookUrl(
  reader: LegacyGoogleChatConnectionReader,
) {
  const row = await reader.loadRow()
  if (!row.found) return normalizedText(reader.legacyEnvironmentUrl)

  if (row.connectionState === "disconnected") return ""
  if (
    row.connectionState === "legacy_active" ||
    row.connectionState === "encrypted_active"
  ) {
    return normalizedText(row.webhookUrl)
  }

  return ""
}
