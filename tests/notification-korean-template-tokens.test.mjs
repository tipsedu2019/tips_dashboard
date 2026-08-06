import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../supabase/migrations/20260806123000_notification_korean_template_tokens.sql",
  import.meta.url,
)

function functionBlock(source, qualifiedName) {
  const start = source.indexOf(`create or replace function ${qualifiedName}`)
  assert.notEqual(start, -1, `missing ${qualifiedName}`)
  const end = source.indexOf("\n$$;", start)
  assert.notEqual(end, -1, `unterminated ${qualifiedName}`)
  return source.slice(start, end + 4)
}

test("한국어 변수 migration은 서버 검증과 기존 활성 템플릿을 함께 전환한다", async () => {
  const migration = await readFile(migrationUrl, "utf8")
  const validator = functionBlock(
    migration,
    "dashboard_private.notification_template_contract_violations_v1",
  )
  const converter = functionBlock(
    migration,
    "dashboard_private.notification_template_with_korean_tokens_v1",
  )

  assert.match(migration.trim(), /^begin;[\s\S]*commit;$/iu)
  assert.match(validator, /variable\.item\s*->>\s*'key'\s*=\s*v_token_match\[1\]/u)
  assert.match(validator, /variable\.item\s*->>\s*'token'\s*=\s*v_token_match\[1\]/u)
  assert.match(validator, /required\.token/u)
  assert.match(validator, /optional\.token/u)
  assert.match(converter, /pg_catalog\.replace/u)
  assert.match(converter, /variable\.item\s*->>\s*'key'/u)
  assert.match(converter, /variable\.item\s*->>\s*'token'/u)

  assert.match(migration, /insert\s+into\s+dashboard_private\.notification_templates/iu)
  assert.doesNotMatch(migration, /update\s+dashboard_private\.notification_templates/iu)
  assert.match(migration, /update\s+dashboard_private\.notification_rules/iu)
  assert.match(migration, /active_template_id\s*=\s*replacement\.id/iu)
  assert.match(migration, /revision\s*=\s*rule_row\.revision\s*\+\s*1/iu)
  assert.match(migration, /notification_template_compliance_v1/iu)
  assert.match(migration, /channel_key\s*<>\s*'customer_message'/iu)
  assert.doesNotMatch(migration, /notification_runtime_flags/iu)
  assert.doesNotMatch(migration, /notification_(?:events|deliveries|provider_attempts)/iu)
})
