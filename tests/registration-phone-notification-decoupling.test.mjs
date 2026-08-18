import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationFileName =
  "20260818202752_decouple_registration_phone_save_from_retired_in_app.sql"
const migrationUrl = new URL(`../supabase/migrations/${migrationFileName}`, import.meta.url)
const manifestUrl = new URL(
  "../supabase/test-baselines/dashboard-free-tier-v1.manifest.json",
  import.meta.url,
)

function functionBlock(sql, name) {
  const start = sql.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `missing function ${name}`)
  const end = sql.indexOf("\n$$;", start)
  assert.ok(end > start, `unterminated function ${name}`)
  return sql.slice(start, end + 4)
}

test("retired in-app rule skips phone projection without rolling back the consultation", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  const projection = functionBlock(
    sql,
    "dashboard_private.materialize_registration_phone_legacy_v1",
  )

  assert.match(projection, /\(snapshot\.item ->> 'enabled'\)::boolean as rule_enabled/)
  assert.match(
    projection,
    /if not v_rule_selection\.rule_enabled then\s+return pg_catalog\.jsonb_build_object\(\s*'deliveryId', null,\s*'acquired', false,\s*'status', 'skipped',\s*'statusReason', 'rule_disabled'\s*\);\s+end if;/,
  )
  assert.match(
    projection,
    /if not found then\s+raise exception 'registration_phone_rule_not_found'/,
  )

  const skipBoundary = projection.indexOf("if not v_rule_selection.rule_enabled then")
  const materializeBoundary = projection.indexOf("materialize_notification_delivery_v1")
  assert.ok(skipBoundary > 0 && skipBoundary < materializeBoundary)
  assert.match(
    sql,
    /revoke all on function dashboard_private\.materialize_registration_phone_legacy_v1\(uuid, uuid\)\s+from public, anon, authenticated, service_role;/,
  )
})

test("phone decoupling migration is final and byte-pinned", async () => {
  const [migration, manifest] = await Promise.all([
    readFile(migrationUrl),
    readFile(manifestUrl, "utf8").then(JSON.parse),
  ])

  assert.deepEqual(
    manifest.orderedNewMigrations.find(({ fileName }) => fileName === migrationFileName),
    {
      fileName: migrationFileName,
      status: "final",
      sha256: createHash("sha256").update(migration).digest("hex"),
    },
  )
})
