import { pathToFileURL } from "node:url"
import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

import {
  decodeNotificationConnectionEncryptionKey,
  encryptNotificationConnectionSecret,
  maskGoogleChatWebhookUrl,
} from "../src/features/notifications/server/notification-connection-crypto.ts"

const DECIMAL_REVISION = /^(0|[1-9]\d*)$/

export function parseGoogleChatWebhookBackfillArgs(argv) {
  if (argv.length === 0) return { apply: false }
  if (argv.length === 1 && argv[0] === "--apply") return { apply: true }
  throw new Error("지원하지 않는 인자입니다. 기본은 dry-run이며 실제 반영은 --apply만 허용됩니다.")
}

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}

function revision(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error("연결 revision이 안전한 정수 범위를 벗어났습니다.")
  }
  const normalized = typeof value === "bigint" ? value.toString() : String(value ?? "")
  if (!DECIMAL_REVISION.test(normalized)) {
    throw new Error("연결 revision 형식이 올바르지 않습니다.")
  }
  return normalized
}

function fingerprint(value) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export async function runGoogleChatWebhookEncryptionBackfill(dependencies) {
  const key = decodeNotificationConnectionEncryptionKey(dependencies.encryptionKey)
  const rows = await dependencies.loadRows()
  let candidates = 0
  let applied = 0
  let skipped = 0

  for (const row of rows) {
    const channel = text(row?.channel)
    const state = text(row?.connection_state)
    const plaintext = text(row?.webhook_url)
    const existingCiphertext = text(row?.webhook_url_ciphertext)
    const isCandidate = Boolean(
      channel &&
      state === "legacy_active" &&
      plaintext &&
      !existingCiphertext,
    )

    if (!isCandidate) {
      skipped += 1
      continue
    }

    candidates += 1
    dependencies.log(`채널=${channel} 상태=${state} 대상=${dependencies.apply ? "반영" : "확인"}`)
    if (!dependencies.apply) continue

    await dependencies.applyEncryptedRow({
      channel,
      webhookUrlCiphertext: encryptNotificationConnectionSecret(plaintext, key),
      webhookUrlMask: maskGoogleChatWebhookUrl(plaintext),
      expectedWebhookFingerprint: fingerprint(plaintext),
      expectedRevision: revision(row.revision),
    })
    applied += 1
  }

  return {
    mode: dependencies.apply ? "apply" : "dry_run",
    candidates,
    applied,
    skipped,
  }
}

async function runCli() {
  const { apply } = parseGoogleChatWebhookBackfillArgs(process.argv.slice(2))
  const encryptionKey = text(process.env.NOTIFICATION_CONNECTION_ENCRYPTION_KEY)
  const supabaseUrl = text(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  )
  const serviceRoleKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY)
  if (!encryptionKey || !supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "필수 환경 변수가 없습니다: NOTIFICATION_CONNECTION_ENCRYPTION_KEY, Supabase URL, SUPABASE_SERVICE_ROLE_KEY",
    )
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const result = await runGoogleChatWebhookEncryptionBackfill({
    apply,
    encryptionKey,
    async loadRows() {
      const { data, error } = await client
        .from("google_chat_webhook_settings")
        .select(
          "channel,webhook_url,webhook_url_ciphertext,webhook_url_mask,connection_state,revision",
        )
        .order("channel")
      if (error) throw new Error("Google Chat 연결 목록을 읽지 못했습니다.")
      return data ?? []
    },
    async applyEncryptedRow(input) {
      const { data, error } = await client
        .rpc("backfill_google_chat_connection_encryption_v1", {
          p_channel: input.channel,
          p_expected_revision: input.expectedRevision,
          p_expected_webhook_fingerprint: input.expectedWebhookFingerprint,
          p_webhook_url_ciphertext: input.webhookUrlCiphertext,
          p_webhook_url_mask: input.webhookUrlMask,
        })
      if (
        error ||
        !data ||
        data.connection_state !== "encrypted_active"
      ) {
        throw new Error(`채널 ${input.channel}의 연결 정보가 변경되어 반영을 중단했습니다.`)
      }
    },
    log(entry) {
      process.stdout.write(`${entry}\n`)
    },
  })
  process.stdout.write(
    `완료: 모드=${result.mode} 대상=${result.candidates} 반영=${result.applied} 건너뜀=${result.skipped}\n`,
  )
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false

if (isDirectExecution) {
  runCli().catch((error) => {
    const message = error instanceof Error ? error.message : "백필을 실행하지 못했습니다."
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
