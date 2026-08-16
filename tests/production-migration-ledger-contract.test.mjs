import assert from "node:assert/strict"
import { access } from "node:fs/promises"
import test from "node:test"

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url)

test("운영에 적용된 SOLAPI checksum migration 버전을 소스가 그대로 보존한다", async () => {
  await assert.doesNotReject(access(new URL(
    "20260816002344_registration_customer_reminder_provider_payload_checksum.sql",
    migrationsUrl,
  )))
})
