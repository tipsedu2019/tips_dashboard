import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import test from "node:test"

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url)

function lastMatchIndex(source, pattern) {
  let latest = -1
  for (const match of source.matchAll(pattern)) latest = match.index
  return latest
}

test("active notification revalidation never references an unapplied source registry", async () => {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort()
  const activeSql = (await Promise.all(
    files.map((file) => readFile(new URL(file, migrationsDirectory), "utf8")),
  )).join("\n")

  assert.match(activeSql, /notification_source_type_registry/i)

  const createAt = lastMatchIndex(
    activeSql,
    /create table(?: if not exists)? dashboard_private\.notification_source_type_registry/gi,
  )
  const dropAt = lastMatchIndex(
    activeSql,
    /drop table(?: if exists)? dashboard_private\.notification_source_type_registry/gi,
  )
  const enableRlsAt = lastMatchIndex(
    activeSql,
    /alter table\s+dashboard_private\.notification_source_type_registry\s+enable row level security/gi,
  )
  const disableRlsAt = lastMatchIndex(
    activeSql,
    /alter table\s+dashboard_private\.notification_source_type_registry\s+disable row level security/gi,
  )
  const grantAt = lastMatchIndex(
    activeSql,
    /grant select on table\s+dashboard_private\.notification_source_type_registry\s+to service_role/gi,
  )
  const revokeAt = lastMatchIndex(
    activeSql,
    /revoke (?:all|select) on table\s+dashboard_private\.notification_source_type_registry\s+from[^;]*service_role/gi,
  )

  assert.ok(createAt > dropAt, "the active registry must not be dropped after creation")
  assert.ok(enableRlsAt > disableRlsAt, "the active registry must finish with RLS enabled")
  assert.ok(grantAt > revokeAt, "service_role SELECT must survive later revocations")
})
