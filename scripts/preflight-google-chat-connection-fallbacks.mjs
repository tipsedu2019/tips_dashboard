import { createClient } from "@supabase/supabase-js"
import { pathToFileURL } from "node:url"

import { GOOGLE_CHAT_CONNECTION_CATALOG } from "../src/features/notifications/notification-google-chat-catalog.ts"
import { isAllowedGoogleChatWebhookUrl } from "../src/features/notifications/server/notification-connection-crypto.ts"

const LEGACY_ENVIRONMENT_KEY_BY_CHANNEL = Object.freeze({
  admin: "GOOGLE_CHAT_WEBHOOK_ADMIN",
  executive: "GOOGLE_CHAT_WEBHOOK_EXECUTIVE",
  english: "GOOGLE_CHAT_WEBHOOK_ENGLISH",
  math: "GOOGLE_CHAT_WEBHOOK_MATH",
  science: null,
})

export function findGoogleChatConnectionFallbackConflicts({ storedChannels, environment }) {
  const stored = new Set(storedChannels)
  return GOOGLE_CHAT_CONNECTION_CATALOG
    .filter(({ channel }) => {
      const environmentKey = LEGACY_ENVIRONMENT_KEY_BY_CHANNEL[channel]
      return environmentKey !== null && !stored.has(channel) &&
        isAllowedGoogleChatWebhookUrl(environment[environmentKey])
    })
    .map(({ connectionKey }) => connectionKey)
}

export class GoogleChatConnectionFallbackConflictError extends Error {
  constructor(connectionKeys) {
    super("google_chat_connection_fallback_conflict")
    this.name = "GoogleChatConnectionFallbackConflictError"
    this.connectionKeys = Object.freeze([...connectionKeys])
  }
}

export async function runGoogleChatConnectionFallbackPreflight({
  environment = process.env,
  createClientImpl = createClient,
} = {}) {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL || environment.VITE_SUPABASE_URL || ""
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY || ""
  if (!url || !serviceRoleKey) throw new Error("google_chat_connection_preflight_configuration_missing")
  const { data, error } = await createClientImpl(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).from("google_chat_webhook_settings").select("channel")
  if (error || !Array.isArray(data)) throw new Error("google_chat_connection_preflight_db_read_failed")
  const conflicts = findGoogleChatConnectionFallbackConflicts({
    storedChannels: data.map(({ channel }) => channel),
    environment,
  })
  if (conflicts.length) throw new GoogleChatConnectionFallbackConflictError(conflicts)
  return Object.freeze({ ok: true, checkedChannelCount: data.length })
}

function isDirectRun() {
  return typeof process.argv[1] === "string" &&
    import.meta.url === pathToFileURL(process.argv[1]).href
}

if (isDirectRun()) {
  try {
    await runGoogleChatConnectionFallbackPreflight()
    console.log("google_chat_connection_preflight_passed")
  } catch (error) {
    const safeDetail = error instanceof GoogleChatConnectionFallbackConflictError
      ? `: ${error.connectionKeys.join(",")}`
      : ""
    console.error(`google_chat_connection_preflight_failed${safeDetail}`)
    process.exitCode = 1
  }
}
