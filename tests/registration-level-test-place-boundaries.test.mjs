import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../supabase/migrations/20260720113000_registration_level_test_place_boundaries.sql",
  import.meta.url,
)
const runtimeTestUrl = new URL(
  "../supabase/tests/registration_level_test_place_boundaries_test.sql",
  import.meta.url,
)

async function optionalSource(url) {
  return readFile(url, "utf8").catch(() => "")
}

function functionBlock(sql, qualifiedName) {
  const marker = `function ${qualifiedName}(`
  const start = sql.indexOf(marker)
  assert.notEqual(start, -1, `missing ${qualifiedName}`)
  const end = sql.indexOf("\n$$;", start)
  assert.notEqual(end, -1, `unterminated ${qualifiedName}`)
  return sql.slice(start, end + 4)
}

test("forward migration validates canonical level-test places without rewriting stored rows", async () => {
  const sql = await optionalSource(migrationUrl)

  assert.notEqual(sql, "", "missing forward-only level-test place boundary migration")
  assert.match(sql.trim(), /^begin;[\s\S]*commit;$/i)
  assert.equal((sql.match(/^begin;$/gim) || []).length, 1)
  assert.equal((sql.match(/^commit;$/gim) || []).length, 1)
  assert.doesNotMatch(sql, /\b(?:alter\s+table|update\s+public\.|insert\s+into\s+public\.|delete\s+from|backfill)\b/i)

  const placeHelper = functionBlock(
    sql,
    "dashboard_private.normalize_registration_appointment_place_v1",
  )
  assert.match(placeHelper, /p_kind = 'level_test'/)
  assert.match(placeHelper, /pg_catalog\.btrim\(p_place\)/)
  assert.match(placeHelper, /not in \('본관', '별관'\)/)
  assert.match(placeHelper, /registration_level_test_place_invalid/)
  assert.doesNotMatch(placeHelper, /p_kind = 'visit_consultation'[\s\S]*raise exception/)

  const createWrapper = functionBlock(
    sql,
    "public.create_registration_case_with_initial_workflow_v1",
  )
  const saveWrapper = functionBlock(sql, "public.save_registration_shared_appointment")
  assert.match(createWrapper, /dashboard_private\.normalize_registration_level_test_appointment_v1\(\s*p_level_test_appointment\s*\)/)
  assert.match(createWrapper, /dashboard_private\.create_registration_case_with_reminders_v1_impl/)
  assert.match(saveWrapper, /dashboard_private\.normalize_registration_appointment_place_v1\(\s*p_kind,\s*p_place\s*\)/)
  assert.match(saveWrapper, /dashboard_private\.save_registration_shared_appointment_with_reminders_v1_impl/)
  for (const wrapper of [createWrapper, saveWrapper]) {
    assert.match(wrapper, /security invoker/)
    assert.match(wrapper, /set search_path = ''/)
  }

  assert.match(sql, /revoke all on function public\.create_registration_case_with_initial_workflow_v1\([\s\S]*?from public, anon, service_role;/)
  assert.match(sql, /grant execute on function public\.create_registration_case_with_initial_workflow_v1\([\s\S]*?to authenticated;/)
  assert.match(sql, /revoke all on function public\.save_registration_shared_appointment\([\s\S]*?from public, anon, service_role;/)
  assert.match(sql, /grant execute on function public\.save_registration_shared_appointment\([\s\S]*?to authenticated;/)
})

test("focused pgTAP exercises authenticated public RPC rejection and visit free text", async () => {
  const sql = await optionalSource(runtimeTestUrl)

  assert.notEqual(sql, "", "missing focused level-test place runtime test")
  assert.match(sql, /^begin;\s*select no_plan\(\);/i)
  assert.match(sql, /set local role authenticated/i)
  assert.match(sql, /public\.create_registration_case_with_initial_workflow_v1\(/)
  assert.match(sql, /public\.save_registration_shared_appointment\(/)
  assert.match(sql, /본관 201호/)
  assert.match(sql, /별관 301호/)
  assert.match(sql, /registration_level_test_place_invalid/)
  assert.match(sql, /normalize_registration_appointment_place_v1\(\s*'visit_consultation'/)
  assert.match(sql, /select \* from finish\(\);\s*rollback;\s*$/i)
})
