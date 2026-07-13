import test from "node:test"
import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url)
const supabaseTestsUrl = new URL("../supabase/tests/", import.meta.url)

async function readMigration(suffix) {
  const names = await readdir(migrationsUrl)
  const name = names.find((candidate) => candidate.endsWith(`_${suffix}.sql`))
  assert.ok(name, `missing ${suffix} migration`)
  return readFile(new URL(name, migrationsUrl), "utf8")
}

test("registration compatibility trigger reads only fields available on its current table", async () => {
  const sql = await readMigration("fix_registration_compatibility_trigger")
  const functionStart = sql.indexOf(
    "create or replace function public.prevent_registration_compatibility_override()",
  )
  const functionEnd = sql.indexOf("$$;", functionStart)
  assert.notEqual(functionStart, -1)
  assert.notEqual(functionEnd, -1)
  const triggerFunction = sql.slice(functionStart, functionEnd + 3)

  assert.match(sql.trim(), /^begin;[\s\S]*commit;$/i)
  assert.match(triggerFunction, /security definer/)
  assert.match(triggerFunction, /set search_path = ''/)
  assert.match(
    triggerFunction,
    /if tg_relid = 'public\.ops_tasks'::regclass then\s+v_task_id := new\.id;\s+elsif tg_relid = 'public\.ops_registration_details'::regclass then\s+v_task_id := new\.task_id;/,
  )
  assert.match(
    triggerFunction,
    /else\s+raise exception 'registration_compatibility_trigger_table_invalid'/,
  )
  assert.doesNotMatch(triggerFunction, /case[\s\S]*new\.id[\s\S]*new\.task_id/)
  assert.doesNotMatch(triggerFunction, /tg_table_name/)
  assert.match(triggerFunction, /dashboard_private\.derive_registration_parent_projection/)
  assert.equal(
    (triggerFunction.match(/registration_compatibility_override_denied/g) || []).length,
    2,
  )
  assert.match(
    sql,
    /alter function public\.prevent_registration_compatibility_override\(\) owner to postgres;/,
  )
  assert.match(
    sql,
    /revoke execute on function public\.prevent_registration_compatibility_override\(\)\s+from public, anon, authenticated;/,
  )
})

test("pgTAP packet reproduces non-registration parent and registration-detail trigger rows", async () => {
  const sql = await readFile(
    new URL("ops_task_compatibility_trigger_runtime_test.sql", supabaseTestsUrl),
    "utf8",
  )

  assert.match(sql, /insert into public\.ops_tasks/)
  assert.match(sql, /insert into public\.ops_registration_details/)
  assert.match(sql, /insert into public\.ops_registration_subject_tracks/)
  assert.match(sql, /update public\.ops_tasks set subject/)
  assert.match(sql, /update public\.ops_registration_details set pipeline_status/)
  assert.match(sql, /create temporary table unexpected_compatibility_trigger_row/)
  assert.match(sql, /registration_compatibility_trigger_table_invalid/)
  assert.equal((sql.match(/select lives_ok\(/g) || []).length, 4)
  assert.equal((sql.match(/select throws_ok\(/g) || []).length, 3)
})
