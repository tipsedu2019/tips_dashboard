import test from "node:test"
import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url)
const supabaseTestsUrl = new URL("../supabase/tests/", import.meta.url)
const scriptsUrl = new URL("../scripts/", import.meta.url)
const registrationPlanUrl = new URL(
  "../docs/superpowers/plans/2026-07-12-registration-subject-tracks-and-multi-enrollment.md",
  import.meta.url,
)

async function readMigration(suffix) {
  const names = await readdir(migrationsUrl)
  const name = names.find((candidate) => candidate.endsWith(`_${suffix}.sql`))
  assert.ok(name, `missing ${suffix} migration`)
  return readFile(new URL(name, migrationsUrl), "utf8")
}

function readPolicyBlock(sql, name) {
  const marker = `create policy ${name}`
  const start = sql.indexOf(marker)
  assert.notEqual(start, -1, `missing ${name}`)
  const nextBlank = sql.indexOf("\n\n", start)
  return sql.slice(start, nextBlank === -1 ? sql.length : nextBlank)
}

test("subject-track schema is additive, exposed deliberately, and RLS protected", async () => {
  const sql = await readMigration("registration_subject_tracks_schema")
  const publicTables = [
    "ops_registration_subject_tracks",
    "ops_registration_appointments",
    "ops_registration_level_tests",
    "ops_registration_consultations",
    "ops_registration_admission_batches",
    "ops_registration_enrollments",
  ]
  for (const table of publicTables) {
    assert.match(sql, new RegExp(`create table public\\.${table}`))
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`))
  }
  const revokeBlock = sql.match(/revoke all on table([\s\S]*?)from anon, authenticated;/)?.[1] || ""
  const grantBlock = sql.match(/grant select on table([\s\S]*?)to authenticated;/)?.[1] || ""
  for (const table of publicTables) {
    assert.match(revokeBlock, new RegExp(`public\\.${table}`))
    assert.match(grantBlock, new RegExp(`public\\.${table}`))
    assert.match(sql, new RegExp(`create policy ${table}_authenticated_select[\\s\\S]*?on public\\.${table}[\\s\\S]*?for select[\\s\\S]*?to authenticated[\\s\\S]*?using`))
  }
  assert.doesNotMatch(sql, /grant (?:insert|update|delete|select, insert)[\s\S]*public\.ops_registration_/i)
  assert.match(sql, /create table dashboard_private\.ops_registration_mutations/)
  assert.match(sql, /primary key \(actor_id, request_key\)/)
  assert.match(sql, /target_fingerprint jsonb not null/)
  assert.match(sql, /alter table dashboard_private\.ops_registration_mutations enable row level security/)
  assert.match(sql, /revoke all on dashboard_private\.ops_registration_mutations from public, anon, authenticated/)
  assert.doesNotMatch(sql, /grant\b[^;]*\bon\s+(?:table\s+)?dashboard_private\.ops_registration_mutations\b[^;]*\bto\s+authenticated\b[^;]*;/i)
  assert.doesNotMatch(sql, /create table public\.ops_registration_mutations/)
  assert.match(sql, /stage_entered_at timestamptz not null/)
  assert.match(sql, /alter table public\.ops_registration_details[\s\S]*?common_revision integer not null default 1[\s\S]*?check \(common_revision > 0\)/)
  assert.match(sql, /notification_revision integer not null default 1/)
  assert.match(sql, /student_id uuid references public\.students\(id\) on delete restrict/)
  assert.match(sql, /roster_active boolean not null default false/)
  assert.match(sql, /roster_released_at timestamptz/)
  assert.match(sql, /roster_release_source_task_id uuid references public\.ops_tasks\(id\) on delete restrict/)
  assert.match(sql, /roster_release_kind text/)
  assert.match(sql, /ops_registration_enrollments_student_class_claim_uidx[\s\S]*?\(student_id, class_id\)[\s\S]*?where roster_active/)
  assert.match(sql, /ops_registration_messages[\s\S]*?claim_active boolean/)
  assert.match(sql, /create unique index ops_registration_one_live_admission_message[\s\S]*?on public\.ops_registration_messages\s*\(task_id, template_key\)[\s\S]*?where claim_active/)
  assert.match(sql, /level_test_retake_decision text/)
  assert.match(sql, /director_assignment_source text/)
  assert.match(sql, /director_assignment_rule_key text/)
  assert.match(sql, /director_profile_id uuid references public\.profiles\(id\) on delete restrict/)
  assert.match(sql, /director_profile_id is not null\s+and director_assignment_source is not null\s+and director_assigned_at is not null/)
  assert.match(sql, /director_assignment_source = 'default'.*nullif\(btrim\(director_assignment_rule_key\), ''\) is not null/s)
  assert.match(sql, /ops_registration_enrollments_active_class_uidx[\s\S]*?where status = 'planned' or roster_active/)
  assert.match(sql, /where status = 'waitlisted'/)
  assert.match(sql, /revoke select on table public\.ops_registration_messages from authenticated/)
  assert.match(sql, /grant select \(id, task_id, template_key, request_key, status, claim_active, created_at, updated_at\) on public\.ops_registration_messages to authenticated/)
  assert.match(sql, /migration_review_required/)
  assert.match(sql, /pipeline_status = 'migration_review'/)
  const legacyWriteLockIndex = sql.indexOf("-- registration_legacy_write_lock")
  const globalRosterPreflightIndex = sql.indexOf("-- global_roster_projection_preflight")
  const attributionPreflightIndex = sql.indexOf("-- registration_subject_attribution_preflight")
  const rosterRevalidationIndex = sql.indexOf("-- registration_roster_evidence_revalidation")
  const backfillIndex = sql.indexOf("-- registration_subject_tracks_backfill")
  assert.notEqual(legacyWriteLockIndex, -1)
  assert.notEqual(globalRosterPreflightIndex, -1)
  assert.notEqual(attributionPreflightIndex, -1)
  assert.notEqual(rosterRevalidationIndex, -1)
  assert.notEqual(backfillIndex, -1)
  assert.ok(legacyWriteLockIndex < globalRosterPreflightIndex)
  assert.ok(globalRosterPreflightIndex < attributionPreflightIndex)
  assert.ok(attributionPreflightIndex < rosterRevalidationIndex)
  assert.ok(rosterRevalidationIndex < backfillIndex)
  assert.match(sql.slice(legacyWriteLockIndex, globalRosterPreflightIndex), /set local lock_timeout = '5s'[\s\S]*?lock table public\.ops_tasks in share row exclusive mode[\s\S]*?lock table public\.ops_registration_details in share row exclusive mode[\s\S]*?lock table public\.students in share row exclusive mode[\s\S]*?lock table public\.classes in share row exclusive mode/)
  const globalRosterBlock = sql.slice(globalRosterPreflightIndex, attributionPreflightIndex)
  assert.match(globalRosterBlock, /-- reviewed_roster_projection_repairs/)
  assert.match(globalRosterBlock, /registration_roster_projection_invalid/)
  assert.match(globalRosterBlock, /registration_global_roster_repair_required/)
  assert.match(globalRosterBlock, /registration_withdrawn_roster_review_required/)
  assert.match(globalRosterBlock, /global_roster_projection_symmetric/)
  const attributionBlock = sql.slice(attributionPreflightIndex, rosterRevalidationIndex)
  assert.match(attributionBlock, /-- reviewed_registration_subject_attribution/)
  assert.match(attributionBlock, /registration_subject_attribution_required/)
  assert.match(attributionBlock, /registration_subject_token_unrecognized/)
  const rosterBlock = sql.slice(rosterRevalidationIndex, backfillIndex)
  assert.match(rosterBlock, /from public\.students[\s\S]*?order by[\s\S]*?\.id[\s\S]*?for update[\s\S]*?from public\.classes[\s\S]*?order by[\s\S]*?\.id[\s\S]*?for update/)
  assert.match(rosterBlock, /roster_evidence_valid/)
  assert.match(sql.slice(backfillIndex), /registration_subject_track_coverage_mismatch/)
  assert.doesNotMatch(sql, /drop column .*pipeline_status/i)
  assert.doesNotMatch(sql, /drop column .*class_id/i)
})

test("track summary view exposes one bounded active visit without bypassing child RLS", async () => {
  const sql = await readMigration("registration_subject_tracks_schema")
  const start = sql.indexOf("create view public.ops_registration_subject_track_summaries")
  const end = sql.indexOf(";", start)
  assert.notEqual(start, -1, "missing registration track summary view")
  const view = sql.slice(start, end + 1)

  assert.match(view, /with \(security_invoker = true\)/)
  assert.match(view, /from public\.ops_registration_subject_tracks track/)
  assert.match(view, /left join lateral/)
  assert.match(view, /from public\.ops_registration_consultations consultation/)
  assert.match(view, /join public\.ops_registration_appointments appointment/)
  assert.match(view, /consultation\.mode = 'visit'/)
  assert.match(view, /consultation\.status = 'scheduled'/)
  assert.match(view, /appointment\.status = 'scheduled'/)
  assert.match(view, /order by consultation\.created_at desc, consultation\.id desc/)
  assert.match(view, /limit 1/)
  assert.match(view, /active_visit\.scheduled_at as visit_scheduled_at/)
  assert.match(view, /active_visit\.place as visit_place/)
  assert.doesNotMatch(view, /select\s+\*/i)
  assert.match(sql, /revoke all on table public\.ops_registration_subject_track_summaries from public, anon, authenticated/)
  assert.match(sql, /grant select on table public\.ops_registration_subject_track_summaries to authenticated/)
})

test("consultation and RLS invariants are explicit", async () => {
  const sql = await readMigration("registration_subject_tracks_schema")
  const selectPolicy = readPolicyBlock(sql, "ops_tasks_select")
  const insertPolicy = readPolicyBlock(sql, "ops_tasks_insert")
  const taskUpdatePolicy = readPolicyBlock(sql, "ops_tasks_update")
  const taskDeletePolicy = readPolicyBlock(sql, "ops_tasks_delete")
  const detailUpdatePolicy = readPolicyBlock(sql, "ops_registration_details_update")
  const detailDeletePolicy = readPolicyBlock(sql, "ops_registration_details_delete")
  const eventWritePolicy = readPolicyBlock(sql, "ops_task_events_write")
  assert.match(sql, /mode = 'phone'.*appointment_id is null/s)
  assert.match(sql, /mode = 'visit'.*appointment_id is not null/s)
  assert.match(sql, /for select\s+to authenticated\s+using/s)
  assert.doesNotMatch(sql, /dashboard_private\.can_access_registration_task/)
  assert.match(selectPolicy, /current_dashboard_role\(\) in \('admin', 'staff', 'assistant'\)/)
  assert.match(selectPolicy, /requested_by = auth\.uid\(\)/)
  assert.match(selectPolicy, /assignee_id = auth\.uid\(\)/)
  assert.match(selectPolicy, /secondary_assignee_id = auth\.uid\(\)/)
  assert.match(selectPolicy, /dashboard_private\.is_ops_word_retest_teacher\(id\)/)
  assert.doesNotMatch(selectPolicy, /ops_registration_subject_tracks/)
  assert.match(sql, /create policy ops_registration_subject_tracks_authenticated_select[\s\S]*?exists[\s\S]*?from public\.ops_tasks/)
  assert.match(insertPolicy, /type <> 'registration'/)
  assert.match(insertPolicy, /requested_by is null/)
  assert.match(insertPolicy, /current_dashboard_role\(\) in \('admin', 'staff', 'assistant'\)/)
  assert.match(sql, /create or replace function dashboard_private\.prevent_registration_type_reclassification\(\)/)
  assert.match(sql, /old\.type is distinct from new\.type[\s\S]*?\(old\.type = 'registration' or new\.type = 'registration'\)/)
  assert.match(sql, /create trigger prevent_registration_type_reclassification[\s\S]*?before update of type on public\.ops_tasks/)
  assert.doesNotMatch(sql, /create policy ops_registration_details_insert/)
  assert.match(sql, /create or replace function dashboard_private\.registration_task_has_subject_tracks\(p_task_id uuid\)[\s\S]*?returns boolean[\s\S]*?stable[\s\S]*?security definer[\s\S]*?set search_path = ''[\s\S]*?from public\.ops_registration_subject_tracks/)
  assert.match(sql, /alter function dashboard_private\.registration_task_has_subject_tracks\(uuid\)[\s\S]*?owner to postgres/)
  assert.match(sql, /revoke all on function dashboard_private\.registration_task_has_subject_tracks\(uuid\) from public, anon/)
  assert.match(sql, /grant execute on function dashboard_private\.registration_task_has_subject_tracks\(uuid\) to authenticated/)
  assert.match(taskUpdatePolicy, /not dashboard_private\.registration_task_has_subject_tracks\(id\)/)
  assert.doesNotMatch(taskUpdatePolicy, /from public\.ops_registration_subject_tracks/)
  assert.match(taskUpdatePolicy, /dashboard_private\.is_ops_word_retest_teacher\(id\)/)
  assert.match(taskDeletePolicy, /not dashboard_private\.registration_task_has_subject_tracks\(id\)/)
  assert.doesNotMatch(taskDeletePolicy, /from public\.ops_registration_subject_tracks/)
  assert.match(detailUpdatePolicy, /not exists[\s\S]*?ops_registration_subject_tracks/)
  assert.match(detailUpdatePolicy, /track\.task_id = ops_registration_details\.task_id/)
  assert.match(detailDeletePolicy, /not exists[\s\S]*?ops_registration_subject_tracks/)
  assert.match(detailDeletePolicy, /track\.task_id = ops_registration_details\.task_id/)
  assert.match(eventWritePolicy, /event_type not in \('registration_track_event', 'legacy_registration_imported', 'customer_message_sent', 'registration_admission_message_reconciled', 'registration_admission_message_retry_released', 'registration_subject_removed'\)/)
  assert.doesNotMatch(sql, /create policy ops_registration_(?:subject_tracks|appointments|level_tests|consultations|admission_batches|enrollments)_(?:insert|update|delete)/i)
})

test("legacy consultation backfill distinguishes valid visit and phone-only evidence", async () => {
  const sql = await readMigration("registration_subject_tracks_schema")
  const backfillStart = sql.indexOf("-- registration_subject_tracks_backfill")
  const candidateEnd = sql.indexOf("create temporary table registration_active_claim_candidates", backfillStart)
  const candidates = sql.slice(backfillStart, candidateEnd)
  const appointmentsStart = sql.indexOf("insert into public.ops_registration_appointments", candidateEnd)
  const consultationsEnd = sql.indexOf("do $$", sql.indexOf("insert into public.ops_registration_consultations", appointmentsStart))
  const children = sql.slice(appointmentsStart, consultationsEnd)

  assert.match(candidates, /when evidence\.pipeline_status like '2\.%'[\s\S]*?evidence\.visit_consultation_at is not null[\s\S]*?nullif\(btrim\(evidence\.visit_consultation_place\), ''\) is not null[\s\S]*?then 'visit_consultation_scheduled'[\s\S]*?when evidence\.pipeline_status like '2\.%' then 'consultation_waiting'/)
  assert.match(candidates, /when evidence\.pipeline_status like '2\.%' then[\s\S]*?evidence\.director_profile_id is not null[\s\S]*?evidence\.visit_consultation_at is not null[\s\S]*?visit_consultation_place\), ''\) is not null[\s\S]*?or[\s\S]*?evidence\.visit_consultation_at is null[\s\S]*?visit_consultation_place\), ''\) is null/)
  assert.match(children, /when candidate\.pipeline_status like '2\.%' then 'visit_consultation'[\s\S]*?when candidate\.pipeline_status like '2\.%' then candidate\.visit_consultation_at/)
  assert.match(children, /candidate\.pipeline_status like '2\.%'[\s\S]*?candidate\.visit_consultation_at is not null then candidate\.appointment_id[\s\S]*?then 'visit'[\s\S]*?else 'phone'[\s\S]*?then 'scheduled'[\s\S]*?else 'waiting'/)
})

test("legacy pipeline backfill sends null and unknown stages to review", async () => {
  const sql = await readMigration("registration_subject_tracks_schema")
  const backfillStart = sql.indexOf("-- registration_subject_tracks_backfill")
  const candidateEnd = sql.indexOf("create temporary table registration_active_claim_candidates", backfillStart)
  const candidates = sql.slice(backfillStart, candidateEnd)

  assert.match(candidates, /when evidence\.pipeline_status like '4-1\.%' then 'waiting'/)
  assert.match(candidates, /when evidence\.pipeline_status like '4-2\.%' then 'waiting'/)
  assert.match(candidates, /when evidence\.pipeline_status like '4-3\.%' then 'waiting'/)
  assert.doesNotMatch(candidates, /when evidence\.pipeline_status like '4-%' then 'waiting'/)
  assert.match(candidates, /else 'migration_review'\s+end as mapped_pipeline_status/)
  assert.match(candidates, /else false\s+end as legacy_evidence_valid/)
  assert.match(candidates, /when mapped\.mapped_pipeline_status = 'migration_review' then 'migration_review'/)
  assert.match(candidates, /\(mapped\.pipeline_status like '0\.%'\) is not true/)
 assert.doesNotMatch(candidates, /pipeline_status not like '0\.%'/)
})

function readReplaceableFunctionBlock(sql, schema, name) {
  const markers = [
    `create or replace function ${schema}.${name}(`,
    `create function ${schema}.${name}(`,
  ]
  const start = markers
    .map((marker) => sql.indexOf(marker))
    .filter((index) => index !== -1)
    .sort((left, right) => left - right)[0]
  assert.notEqual(start, undefined, `missing ${schema}.${name}`)
  const end = sql.indexOf("\n$$;", start)
  assert.notEqual(end, -1, `unterminated ${schema}.${name}`)
  return sql.slice(start, end + 4)
}

test("Task 3A director and roster foundations preserve exact boundaries", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const director = readReplaceableFunctionBlock(
    sql,
    "dashboard_private",
    "resolve_registration_default_director",
  )
  const mathGradePattern = director.match(
    /if v_grade ~ '([^']+)' then\s+v_director_name := '강정은'/,
  )?.[1]
  assert.ok(mathGradePattern, "missing mathematics grade boundary")
  assert.match("초6", new RegExp(mathGradePattern))
  assert.match("중3", new RegExp(mathGradePattern))
  assert.doesNotMatch("중4", new RegExp(mathGradePattern))

  const roster = readReplaceableFunctionBlock(
    sql,
    "dashboard_private",
    "apply_student_class_roster_mode",
  )
  const canonicalElement = /\(\(element\.value #>> '\{\}'\)::uuid\)::text/g
  assert.ok(
    (roster.match(canonicalElement) || []).length >= 4,
    "all four roster arrays must canonicalize UUID strings",
  )
  const canonicalizationIndex = roster.indexOf("::uuid)::text")
  const duplicateCheckIndex = roster.indexOf("jsonb_array_length(v_student_classes)")
  const membershipIndex = roster.indexOf("v_student_enrolled :=")
  assert.ok(canonicalizationIndex !== -1 && canonicalizationIndex < duplicateCheckIndex)
  assert.ok(duplicateCheckIndex !== -1 && duplicateCheckIndex < membershipIndex)
  assert.match(
    roster,
    /if v_current_mode = v_next_mode and p_claim_enrollment_id is null then/,
  )
  const expectedModeCheckIndex = roster.indexOf("if v_current_mode <> v_expected_mode then")
  const claimedNoopIndex = roster.indexOf(
    "if v_current_mode = v_next_mode then",
    expectedModeCheckIndex,
  )
  assert.ok(expectedModeCheckIndex !== -1 && expectedModeCheckIndex < claimedNoopIndex)

  const globalPreflight = sql.slice(sql.indexOf("-- global_roster_gateway_lock"))
  assert.match(
    globalPreflight,
    /element\.value #>> '\{\}' is distinct from \(\(element\.value #>> '\{\}'\)::uuid\)::text/,
  )
  assert.match(
    globalPreflight,
    /count\(distinct \(\(element\.value #>> '\{\}'\)::uuid\)::text\)/,
  )
  assert.doesNotMatch(
    globalPreflight,
    /count\(distinct element\.value #>> '\{\}'\)/,
  )
  const canonicalOrderStart = globalPreflight.indexOf(
    "-- global_roster_canonical_order_preflight",
  )
  const symmetryStart = globalPreflight.indexOf(
    "-- global_roster_symmetry_preflight",
  )
  assert.notEqual(canonicalOrderStart, -1, "missing canonical roster order preflight")
  assert.ok(symmetryStart > canonicalOrderStart)
  const canonicalOrderBlock = globalPreflight.slice(canonicalOrderStart, symmetryStart)
  for (const field of [
    "student.class_ids",
    "student.waitlist_class_ids",
    "class.student_ids",
    "class.waitlist_ids",
  ]) {
    assert.match(canonicalOrderBlock, new RegExp(field.replace(".", "\\.")))
  }
  assert.equal(
    (canonicalOrderBlock.match(/projection\.value is distinct from/g) || []).length,
    2,
  )
  assert.equal(
    (canonicalOrderBlock.match(
      /jsonb_agg\(pg_catalog\.to_jsonb\(canonical\.value\) order by canonical\.value\)/g,
    ) || []).length,
    2,
  )
})

test("runtime pgTAP packet fixes all 150 ordered workflow proofs and rolls fixtures back", async () => {
  const [sql, registrationPlan] = await Promise.all([
    readFile(
      new URL("registration_subject_tracks_runtime_test.sql", supabaseTestsUrl),
      "utf8",
    ),
    readFile(registrationPlanUrl, "utf8"),
  ])

  assert.match(sql, /^begin;\s*$/m)
  assert.match(sql, /select\s+plan\(150\);/i)
  assert.match(sql, /select\s+\*\s+from\s+finish\(\);\s*\nrollback;\s*$/i)

  const numberedAssertions = [
    ...sql.matchAll(/^-- assertion (\d+):\s+(.+)$/gm),
  ]
  assert.equal(numberedAssertions.length, 150)
  assert.deepEqual(
    numberedAssertions.map((match) => Number(match[1])),
    Array.from({ length: 150 }, (_, index) => index + 1),
  )
  const plannedAssertionSection = registrationPlan.slice(
    registrationPlan.indexOf("1. atomic RPC creation"),
    registrationPlan.indexOf("\n\nEvery fixture rolls back"),
  )
  const plannedAssertions = [
    ...plannedAssertionSection.matchAll(/^(\d+)\. (.+)$/gm),
  ]
  assert.equal(plannedAssertions.length, 150)
  assert.deepEqual(
    numberedAssertions.map((match) => [Number(match[1]), match[2]]),
    plannedAssertions.map((match) => [Number(match[1]), match[2]]),
  )

  const tapStatements = [
    ...sql.matchAll(/^select\s+(?:ok|is|isnt|is_empty|isnt_empty|lives_ok|throws_ok|results_eq|set_eq|bag_eq|col_is_null|col_not_null)\s*\(/gim),
  ]
  assert.equal(tapStatements.length, 150)

  const observationMarkers = [
    ...sql.matchAll(/^select\s+pg_temp\.registration_record\(\s*(\d+)/gim),
  ]
  assert.equal(observationMarkers.length, 150)
  const observationNumbers = observationMarkers.map((match) => Number(match[1]))
  assert.equal(new Set(observationNumbers).size, 150)
  assert.deepEqual(
    observationNumbers.toSorted((left, right) => left - right),
    Array.from({ length: 150 }, (_, index) => index + 1),
  )
  assert.match(sql, /registration_runtime_observation_missing:/)
  assert.doesNotMatch(sql, /registration_function_mentions/)
  const globalRosterReady = readFunctionBlock(
    sql,
    "pg_temp",
    "registration_global_roster_ready",
  )
  assert.match(globalRosterReady, /security definer/)
  assert.match(globalRosterReady, /jsonb_typeof\(projection\.value\)/)
  assert.match(globalRosterReady, /jsonb_typeof\(element\.value\) <> 'string'/)
  assert.match(globalRosterReady, /count\(distinct \(\(element\.value #>> '\{\}'\)::uuid\)::text\)/)
  assert.match(globalRosterReady, /jsonb_agg\(pg_catalog\.to_jsonb\(canonical\.value\) order by canonical\.value\)/)
  assert.match(globalRosterReady, /student\.waitlist_class_ids[\s\S]*?class\.waitlist_ids/)
  assert.match(globalRosterReady, /class\.student_ids[\s\S]*?student\.class_ids/)
  assert.match(globalRosterReady, /when others then\s+return false/)
  assert.match(
    sql,
    /update public\.classes class\s+set student_ids = \([\s\S]*?jsonb_agg\(pg_catalog\.to_jsonb\(canonical\.value\) order by canonical\.value\)[\s\S]*?select '00000000-0000-4000-8000-000000000680'[\s\S]*?where class\.id = '00000000-0000-4000-8000-000000000302';/,
    "late roster fixtures must preserve the canonical UUID order checked by assertion 15",
  )
  assert.doesNotMatch(
    sql,
    /set student_ids = coalesce\(student_ids, '\[\]'::jsonb\)[\s\S]{0,120}00000000-0000-4000-8000-000000000680/,
  )
  const structuralObservationNumbers = new Set([14, 15, 69, 150])
  for (const [index, marker] of observationMarkers.entries()) {
    const assertionNumber = Number(marker[1])
    if (structuralObservationNumbers.has(assertionNumber)) continue
    const nextMarker = observationMarkers[index + 1]
    const observationBlock = sql.slice(
      marker.index,
      nextMarker?.index ?? sql.indexOf("-- assertion 1:"),
    )
    assert.doesNotMatch(
      observationBlock,
      /pg_temp\.registration_(?:contract|function_mentions)\s*\(/,
      `assertion ${assertionNumber} must record executable state, not a source proxy`,
    )
  }

  for (const fixtureToken of [
    "00000000-0000-4000-8000-000000000101",
    "00000000-0000-4000-8000-000000000102",
    "00000000-0000-4000-8000-000000000103",
    "00000000-0000-4000-8000-000000000201",
    "00000000-0000-4000-8000-000000000301",
    "00000000-0000-4000-8000-000000000401",
    "00000000-0000-4000-8000-000000000501",
  ]) {
    assert.match(sql, new RegExp(fixtureToken))
  }
  assert.match(sql, /insert into auth\.users/i)
  assert.match(sql, /insert into public\.profiles/i)
  assert.match(
    sql,
    /update public\.profiles\s+set teacher_catalog_id = null[\s\S]*?delete from public\.teacher_catalogs\s+where profile_id in/i,
  )
  assert.match(
    sql,
    /update public\.profiles profile\s+set teacher_catalog_id = fixture\.teacher_catalog_id/i,
  )
  assert.match(sql, /insert into public\.students/i)
  assert.match(sql, /insert into public\.classes/i)
  assert.match(sql, /insert into public\.textbooks/i)
  assert.match(sql, /insert into public\.ops_tasks/i)
  assert.match(sql, /set local role authenticated/i)
  assert.match(sql, /set_config\('request\.jwt\.claims'/i)
  assert.match(
    sql,
    /grant select, update on table registration_runtime_ids to authenticated;/i,
  )
  assert.match(
    sql,
    /grant select, insert, update on table registration_runtime_observations\s+to authenticated;/i,
  )
  for (const roleName of [
    "management admin",
    "assigned admin director",
    "sibling admin director",
    "staff",
    "assistant",
    "ordinary teacher",
  ]) {
    assert.match(sql, new RegExp(roleName, "i"))
  }
  assert.match(sql, /-- service-role finalizer lane: begin/i)
  assert.match(sql, /set local role service_role/i)
  assert.match(sql, /-- service-role finalizer lane: end/i)
  const serviceLane = sql.slice(
    sql.indexOf("-- service-role finalizer lane: begin"),
    sql.indexOf("-- service-role finalizer lane: end"),
  )
  assert.doesNotMatch(
    serviceLane,
    /\b(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?!ops_registration_messages\b)/i,
  )

  assert.match(numberedAssertions[0][2], /atomic RPC creation/i)
  assert.match(numberedAssertions[41][2], /default-director resolver/i)
  assert.match(numberedAssertions[117][2], /authenticated admin\/staff direct execution.*finalizer.*denied/i)
  assert.match(numberedAssertions[118][2], /service-role finalizer/i)
  assert.match(numberedAssertions[149][2], /message-table column grants/i)
})

function readFunctionBlock(sql, schema, name) {
  const markers = [
    `create function ${schema}.${name}(`,
    `create or replace function ${schema}.${name}(`,
  ]
  const start = markers
    .map((marker) => sql.indexOf(marker))
    .filter((position) => position !== -1)
    .sort((left, right) => left - right)[0] ?? -1
  assert.notEqual(start, -1, `missing ${schema}.${name}`)
  const end = sql.indexOf("\n$$;", start)
  assert.notEqual(end, -1, `unterminated ${schema}.${name}`)
  return sql.slice(start, end + 4)
}

function readFunctionArgumentTypes(block) {
  const header = block.slice(block.indexOf("(") + 1, block.indexOf(")\nreturns"))
  return [...header.matchAll(/p_[a-z0-9_]+\s+(uuid\[\]|text\[\]|timestamptz|boolean|integer|jsonb|uuid|text)/g)]
    .map((match) => match[1])
}

test("Task 3B case and inquiry routing mutations preserve transactional contracts", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const createCase = readFunctionBlock(sql, "dashboard_private", "create_registration_case_impl")
  const syncSubjects = readFunctionBlock(sql, "dashboard_private", "sync_registration_case_subjects_impl")
  const updateCommon = readFunctionBlock(sql, "dashboard_private", "update_registration_case_common_impl")
  const routeInquiry = readFunctionBlock(sql, "dashboard_private", "route_registration_inquiry_impl")
  const assignDirector = readFunctionBlock(sql, "dashboard_private", "assign_registration_track_director_impl")

  for (const block of [createCase, syncSubjects, updateCommon, routeInquiry, assignDirector]) {
    assert.match(block, /target_fingerprint/)
    assert.match(block, /pg_advisory_xact_lock/)
    assert.match(block, /idempotency_key_reused/)
    assert.match(block, /dashboard_private\.ops_registration_mutations/)
    assert.match(block, /response_payload/)
    assert.match(block, /pg_catalog\.jsonb_build_object\(\s*'taskId'/)
  }

  assert.match(createCase, /array_agg\(distinct pg_catalog\.btrim\(subject\.value\) order by pg_catalog\.btrim\(subject\.value\)\)/)
  assert.match(createCase, /registration_subjects_required/)
  assert.match(createCase, /registration_subject_invalid/)
  assert.match(createCase, /registration_student_name_required/)
  assert.match(createCase, /registration_school_grade_required/)
  assert.match(createCase, /registration_parent_phone_invalid/)
  assert.match(createCase, /registration_inquiry_at_required/)
  assert.match(createCase, /insert into public\.ops_tasks[\s\S]*?student_id[\s\S]*?null/s)
  assert.match(createCase, /insert into public\.ops_registration_details/)
  assert.match(createCase, /insert into public\.ops_registration_subject_tracks/)
  assert.match(createCase, /'commonRevision',\s*1[\s\S]*?'subjects'[\s\S]*?'tracks'/s)

  assert.match(syncSubjects, /registration_last_subject_required/)
  assert.match(syncSubjects, /director_assignment_source in \('manual', 'migration'\)/)
  for (const table of [
    "ops_registration_level_tests",
    "ops_registration_consultations",
    "ops_registration_enrollments",
  ]) {
    assert.match(syncSubjects, new RegExp(`public\\.${table}`))
  }
  assert.match(syncSubjects, /director_default_resolved/)
  assert.match(syncSubjects, /registration_subject_removal_blocked/)
  assert.match(syncSubjects, /'registration_subject_removed'/)
  assert.match(syncSubjects, /registration_subject_track_coverage_mismatch/)

  const receiptReplay = updateCommon.indexOf("if v_receipt_found then return v_response; end if;")
  const revisionCheck = updateCommon.indexOf("registration_common_revision_conflict", receiptReplay)
  assert.ok(receiptReplay !== -1 && receiptReplay < revisionCheck)
  assert.match(updateCommon, /common_revision = common_revision \+ 1/)
  assert.match(updateCommon, /registration_student_identity_correction_required/)
  assert.match(updateCommon, /public\.ops_registration_admission_batches/)
  assert.match(updateCommon, /public\.ops_registration_enrollments/)
  assert.match(updateCommon, /public\.ops_registration_messages[\s\S]*?claim_active/s)
  assert.match(updateCommon, /admission_notice_sent/)
  assert.match(updateCommon, /student_id = case when v_clear_student_link then null else student_id end/)
  assert.match(updateCommon, /student_link_recheck_required/)
  assert.match(updateCommon, /registration_common_info_updated/)
  assert.doesNotMatch(updateCommon, /\bp_subjects\b|\bp_pipeline_status\b|\bp_director_profile_id\b|\bp_class_id\b|\bp_textbook_id\b/)

  assert.match(routeInquiry, /v_source_status <> 'inquiry'[\s\S]*?registration_invalid_source_state/s)
  assert.match(routeInquiry, /v_destination not in \('consultation_waiting', 'waiting', 'inquiry_closed'\)/)
  assert.match(routeInquiry, /assert_registration_track_director_ready/)
  assert.match(routeInquiry, /insert into public\.ops_registration_consultations[\s\S]*?'phone'[\s\S]*?'waiting'/s)
  assert.doesNotMatch(routeInquiry, /insert into public\.ops_registration_appointments/)
  assert.match(routeInquiry, /apply_registration_current_class_wait/)
  assert.match(routeInquiry, /transition_registration_track_status/)
  assert.match(routeInquiry, /write_registration_track_event/)

  assert.match(assignDirector, /v_assignment_source not in \('default', 'manual', 'clear_default'\)/)
  assert.match(assignDirector, /is_active_registration_director/)
  assert.match(assignDirector, /resolve_registration_default_director/)
  assert.match(assignDirector, /registration_director_default_stale/)
  assert.match(assignDirector, /registration_visit_reassign_requires_reschedule/)
  assert.match(assignDirector, /update public\.ops_registration_consultations[\s\S]*?director_profile_id/s)
  assert.match(assignDirector, /if v_phone_director_id is distinct from p_director_profile_id then[\s\S]*?update public\.ops_registration_consultations[\s\S]*?where id = v_phone_consultation_id[\s\S]*?end if;/s)
  assert.match(assignDirector, /insert into public\.ops_registration_consultations[\s\S]*?'phone'[\s\S]*?'waiting'/s)
  assert.match(assignDirector, /delete from public\.dashboard_notifications[\s\S]*?read_at is null/s)
  assert.match(assignDirector, /'registration_consultation'/)
  assert.match(assignDirector, /\/admin\/registration\?taskId=/)
  assert.match(assignDirector, /registration:' \|\| v_task_id::text \|\| ':track:'/)
  assert.match(assignDirector, /:consultation:'[\s\S]*?:director:/s)
  assert.match(assignDirector, /insert into public\.dashboard_notifications as existing/)
  assert.match(assignDirector, /on conflict \(dedupe_key\) do update[\s\S]*?read_at = null[\s\S]*?created_at = pg_catalog\.now\(\)[\s\S]*?where v_track\.director_profile_id is distinct from p_director_profile_id[\s\S]*?returning existing\.id into v_notification_id/s)
  assert.match(assignDirector, /if v_notification_id is null then[\s\S]*?select notification\.id[\s\S]*?into v_notification_id[\s\S]*?where notification\.dedupe_key = v_notification_dedupe_key[\s\S]*?end if;/s)
  assert.doesNotMatch(assignDirector, /http|webhook|google_chat/i)
})

test("Task 3C1a shared appointment creation remains transactional after edit expansion", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const saveAppointment = readFunctionBlock(
    sql,
    "dashboard_private",
    "save_registration_shared_appointment_impl",
  )
  const saveWrapper = readFunctionBlock(
    sql,
    "public",
    "save_registration_shared_appointment",
  )

  const normalizedTracks = saveAppointment.indexOf("array_agg(distinct track_id order by track_id)")
  const saveFingerprint = saveAppointment.indexOf("v_target_fingerprint :=")
  assert.ok(normalizedTracks !== -1 && normalizedTracks < saveFingerprint)
  assert.match(saveAppointment, /cardinality\(v_track_ids\) not between 1 and 2/)
  assert.match(saveAppointment, /registration_appointment_tracks_required/)
  assert.match(saveAppointment, /p_appointment_id is null[\s\S]*?p_expected_notification_revision is not null/)
  assert.match(saveAppointment, /p_appointment_id is not null[\s\S]*?p_expected_notification_revision is null/)
  assert.match(saveAppointment, /target_fingerprint/)
  assert.match(saveAppointment, /pg_advisory_xact_lock/)
  assert.match(saveAppointment, /idempotency_key_reused/)

  assert.match(saveAppointment, /order by task\.id[\s\S]*?for update/)
  assert.match(saveAppointment, /order by track\.id[\s\S]*?for update/)
  assert.match(saveAppointment, /order by attempt\.id[\s\S]*?for update/)
  assert.match(saveAppointment, /order by consultation\.id[\s\S]*?for update/)
  assert.match(saveAppointment, /p_kind not in \('level_test', 'visit_consultation'\)/)
  assert.match(saveAppointment, /registration_appointment_kind_invalid/)
  assert.match(saveAppointment, /registration_appointment_task_mismatch/)
  assert.match(saveAppointment, /assert_registration_track_director_ready/)
  assert.match(saveAppointment, /registration_invalid_source_state/)
  assert.match(saveAppointment, /registration_appointment_active_activity_exists/)

  const retestStudentLocks = saveAppointment.indexOf("-- current_class_retest_student_locks")
  const retestClaimLocks = saveAppointment.indexOf("-- current_class_retest_claim_locks")
  const retestClassLocks = saveAppointment.indexOf("-- current_class_retest_class_locks")
  const rosterRemoval = saveAppointment.indexOf(
    "apply_student_class_roster_mode",
    retestStudentLocks,
  )
  const claimDeactivation = saveAppointment.indexOf(
    "-- current_class_retest_claim_deactivation",
    rosterRemoval,
  )
  assert.ok(rosterRemoval !== -1 && rosterRemoval < claimDeactivation)
  assert.ok(
    retestStudentLocks !== -1
      && retestStudentLocks < retestClaimLocks
      && retestClaimLocks < retestClassLocks
      && retestClassLocks < rosterRemoval,
    "current-class retests lock all students, claims, and classes in global tier order before roster writes",
  )
  assert.match(
    saveAppointment,
    /pg_catalog\.btrim\(class\.subject\) = v_track\.subject[\s\S]*?enrollment\.student_id = v_task_student_id/,
  )
  const phoneCancellation = saveAppointment.indexOf("-- visit_phone_cancellation")
  const phoneNotificationCleanup = saveAppointment.indexOf("-- visit_phone_notification_cleanup")
  const visitInsertion = saveAppointment.indexOf("insert into public.ops_registration_consultations", phoneCancellation)
  assert.ok(
    phoneCancellation !== -1
      && phoneCancellation < phoneNotificationCleanup
      && phoneNotificationCleanup < visitInsertion,
  )
  assert.match(
    saveAppointment,
    /delete from public\.dashboard_notifications[\s\S]*?'registration:'[\s\S]*?v_phone_consultation_id[\s\S]*?v_phone_director_id/,
  )

  assert.match(saveAppointment, /insert into public\.ops_registration_appointments[\s\S]*?notification_revision[\s\S]*?1/s)
  assert.match(saveAppointment, /coalesce\(max\(attempt\.attempt_number\), 0\) \+ 1/)
  assert.match(saveAppointment, /insert into public\.ops_registration_level_tests/)
  assert.match(saveAppointment, /insert into public\.ops_registration_consultations/)
  assert.match(saveAppointment, /from pg_catalog\.unnest\(v_track_ids\) selected\(track_id\)/)
  assert.match(saveAppointment, /transition_registration_track_status/)
  assert.match(saveAppointment, /level_test_retake_scheduled/)
  assert.match(saveAppointment, /visit_scheduled/)
  assert.match(saveAppointment, /write_registration_track_event/)
  assert.match(
    saveAppointment,
    /'activeTrackIds', pg_catalog\.to_jsonb\(v_track_ids\)[\s\S]*?'canceledTrackIds', '\[\]'::jsonb[\s\S]*?'changeKind', 'created'/,
  )
  assert.match(saveAppointment, /recompute_registration_parent/)

  assert.match(saveAppointment, /'appointmentId'[\s\S]*?'notificationRevision'[\s\S]*?'trackIds'[\s\S]*?'activityIds'[\s\S]*?'requiresDirectorAssignmentTrackIds'[\s\S]*?'notificationTargets'/s)
  assert.match(saveAppointment, /p_kind = 'visit_consultation'[\s\S]*?jsonb_build_array\([\s\S]*?'appointmentId'[\s\S]*?'notificationRevision'/s)
  assert.match(saveAppointment, /insert into dashboard_private\.ops_registration_mutations/)
  assert.match(saveAppointment, /'save_appointment'/)

  assert.match(saveWrapper, /security invoker/)
  assert.match(saveWrapper, /dashboard_private\.save_registration_shared_appointment_impl/)
  assert.match(sql, /alter function dashboard_private\.save_registration_shared_appointment_impl\(uuid, uuid, text, timestamptz, text, uuid\[\], boolean, integer, text\)[\s\S]*?owner to postgres/)
  assert.match(sql, /revoke execute on function dashboard_private\.save_registration_shared_appointment_impl\(uuid, uuid, text, timestamptz, text, uuid\[\], boolean, integer, text\) from public, anon;/)
  assert.match(sql, /grant execute on function dashboard_private\.save_registration_shared_appointment_impl\(uuid, uuid, text, timestamptz, text, uuid\[\], boolean, integer, text\) to authenticated;/)
  assert.match(sql, /revoke execute on function public\.save_registration_shared_appointment\(uuid, uuid, text, timestamptz, text, uuid\[\], boolean, integer, text\) from public, anon;/)
  assert.match(sql, /grant execute on function public\.save_registration_shared_appointment\(uuid, uuid, text, timestamptz, text, uuid\[\], boolean, integer, text\) to authenticated;/)

  assert.doesNotMatch(
    saveAppointment,
    /registration_appointment_edit_not_implemented/,
    "Task 3C1a remains intentionally RED until edit/replacement semantics replace the explicit marker",
  )
})

test("Task 3C1b appointment edit and replacement preserve immutable history", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const saveAppointment = readFunctionBlock(
    sql,
    "dashboard_private",
    "save_registration_shared_appointment_impl",
  )

  assert.doesNotMatch(saveAppointment, /registration_appointment_edit_not_implemented/)
  assert.doesNotMatch(
    saveAppointment,
    /\bv_track_id\b/,
    "save appointment must use the locked loop record rather than an undeclared scalar track ID",
  )
  assert.match(saveAppointment, /p_appointment_id is not null[\s\S]*?p_expected_notification_revision is null[\s\S]*?registration_appointment_revision_conflict/)
  assert.match(saveAppointment, /'appointmentId', p_appointment_id[\s\S]*?'replaceRemaining', coalesce\(p_replace_remaining, false\)[\s\S]*?'expectedNotificationRevision', p_expected_notification_revision/)

  const allTrackLocks = saveAppointment.indexOf("-- appointment_parent_track_locks")
  const appointmentLock = saveAppointment.indexOf("-- appointment_row_lock")
  const activityLocks = saveAppointment.indexOf("-- appointment_activity_locks")
  const receiptLookup = saveAppointment.indexOf("-- appointment_receipt_lookup")
  const staleRevision = saveAppointment.indexOf("-- appointment_stale_revision_check")
  assert.ok(
    allTrackLocks !== -1
      && allTrackLocks < appointmentLock
      && appointmentLock < activityLocks
      && activityLocks < receiptLookup
      && receiptLookup < staleRevision,
    "edit locks parent tracks, appointment, and activities before replay and checks stale revision only afterward",
  )
  assert.match(saveAppointment, /where track\.task_id = p_task_id[\s\S]*?order by track\.id[\s\S]*?for update/)
  assert.match(saveAppointment, /appointment\.task_id is distinct from p_task_id[\s\S]*?appointment\.kind is distinct from p_kind/)
  assert.match(saveAppointment, /registration_appointment_task_mismatch/)
  assert.match(saveAppointment, /registration_appointment_kind_mismatch/)

  assert.match(saveAppointment, /-- ordinary_appointment_edit[\s\S]*?registration_appointment_immutable/)
  assert.match(saveAppointment, /v_existing_track_ids[\s\S]*?v_added_track_ids[\s\S]*?v_deselected_track_ids/)
  assert.match(saveAppointment, /v_real_diff[\s\S]*?return v_response/)
  assert.match(saveAppointment, /notification_revision = notification_revision \+ 1/)
  assert.match(saveAppointment, /appointment_subject_deselected/)
  assert.match(saveAppointment, /status = 'canceled'[\s\S]*?completed_at = pg_catalog\.now\(\)/)
  assert.match(saveAppointment, /transition_registration_track_status\([\s\S]*?'inquiry'/)
  assert.match(saveAppointment, /transition_registration_track_status\([\s\S]*?'consultation_waiting'/)
  assert.match(saveAppointment, /assert_registration_track_director_ready[\s\S]*?when sqlstate '40001'/)
  assert.match(saveAppointment, /director_assignment_required/)
  assert.match(saveAppointment, /mode[\s\S]*?status[\s\S]*?'phone'[\s\S]*?'waiting'/)
  assert.match(
    saveAppointment,
    /case[\s\S]*?when p_kind = 'level_test' and v_track\.pipeline_status = 'inquiry'[\s\S]*?then 'level_test_scheduled'[\s\S]*?when p_kind = 'level_test' then 'level_test_retake_scheduled'[\s\S]*?else 'visit_scheduled'[\s\S]*?end/,
  )

  assert.match(saveAppointment, /-- replacement_appointment_edit/)
  assert.match(saveAppointment, /registration_appointment_replacement_track_set_mismatch/)
  assert.match(saveAppointment, /v_track_ids is distinct from v_scheduled_track_ids/)
  assert.match(saveAppointment, /status in \('in_progress', 'completed', 'absent', 'canceled'\)/)
  assert.match(saveAppointment, /status in \('completed', 'absent', 'canceled'\)/)
  assert.match(saveAppointment, /appointment_replaced/)
  assert.match(saveAppointment, /'changeKind', 'appointment_replaced'/)
  assert.match(saveAppointment, /'oldAppointmentId'[\s\S]*?'newAppointmentId'/)
  assert.match(saveAppointment, /'oldScheduledAt'[\s\S]*?'oldPlace'[\s\S]*?'scheduledAt'[\s\S]*?'place'/)
  assert.match(saveAppointment, /v_old_notification_revision[\s\S]*?v_new_appointment_id[\s\S]*?v_new_notification_revision/)
  assert.match(saveAppointment, /v_notification_targets :=[\s\S]*?v_old_notification_revision[\s\S]*?v_new_notification_revision[\s\S]*?'notificationTargets', v_notification_targets/)
})

test("Task 3C shared appointment mutations preserve subject-scoped lifecycle contracts", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const saveAppointment = readFunctionBlock(
    sql,
    "dashboard_private",
    "save_registration_shared_appointment_impl",
  )
  const cancelAppointment = readFunctionBlock(
    sql,
    "dashboard_private",
    "cancel_registration_appointment_impl",
  )

  for (const block of [saveAppointment, cancelAppointment]) {
    assert.match(block, /target_fingerprint/)
    assert.match(block, /pg_advisory_xact_lock/)
    assert.match(block, /idempotency_key_reused/)
    assert.match(block, /dashboard_private\.ops_registration_mutations/)
    assert.match(block, /registration_appointment_revision_conflict/)
    assert.match(block, /for update/)
    assert.match(block, /transition_registration_track_status/)
    assert.match(block, /write_registration_track_event/)
    assert.match(block, /recompute_registration_parent/)
    assert.match(block, /'requiresDirectorAssignmentTrackIds'/)
    assert.match(block, /'notificationTargets'/)
    assert.doesNotMatch(block, /http|webhook|google_chat/i)
  }

  const normalizedTracks = saveAppointment.indexOf("array_agg(distinct track_id order by track_id)")
  const saveFingerprint = saveAppointment.indexOf("v_target_fingerprint :=")
  assert.ok(normalizedTracks !== -1 && normalizedTracks < saveFingerprint)
  assert.match(saveAppointment, /cardinality\(v_track_ids\) not between 1 and 2/)
  assert.match(saveAppointment, /registration_appointment_tracks_required/)
  assert.match(saveAppointment, /p_appointment_id is null[\s\S]*?p_expected_notification_revision is not null/)
  assert.match(saveAppointment, /p_appointment_id is not null[\s\S]*?p_expected_notification_revision is null/)
  assert.match(saveAppointment, /order by task\.id[\s\S]*?for update/)
  assert.match(saveAppointment, /order by track\.id[\s\S]*?for update/)
  assert.match(saveAppointment, /order by appointment\.id[\s\S]*?for update/)
  assert.match(saveAppointment, /order by attempt\.id[\s\S]*?for update/)
  assert.match(saveAppointment, /order by consultation\.id[\s\S]*?for update/)
  assert.match(saveAppointment, /assert_registration_track_director_ready/)
  assert.match(saveAppointment, /registration_director_refresh_required/)
  assert.match(saveAppointment, /registration_appointment_active_activity_exists/)
  assert.match(saveAppointment, /registration_appointment_immutable/)
  assert.match(saveAppointment, /registration_invalid_source_state/)
  assert.match(saveAppointment, /apply_student_class_roster_mode/)
  assert.match(saveAppointment, /level_test_retake_scheduled/)
  assert.match(saveAppointment, /attempt_number[\s\S]*?coalesce\(max\(attempt\.attempt_number\), 0\) \+ 1/s)
  assert.match(saveAppointment, /mode = 'phone'[\s\S]*?status = 'waiting'[\s\S]*?track_id = v_track\.id/s)
  assert.match(saveAppointment, /visit_scheduled/)
  assert.match(saveAppointment, /appointment_subject_deselected/)
  assert.match(saveAppointment, /appointment_replaced/)
  assert.match(saveAppointment, /p_replace_remaining/)
  assert.match(saveAppointment, /registration_appointment_replacement_track_set_mismatch/)
  assert.match(saveAppointment, /v_track_ids is distinct from v_scheduled_track_ids/)
  assert.match(saveAppointment, /notification_revision = notification_revision \+ 1/)
  assert.match(saveAppointment, /status in \('in_progress', 'completed', 'absent', 'canceled'\)/)
  assert.match(saveAppointment, /status in \('completed', 'absent', 'canceled'\)/)
  assert.match(saveAppointment, /insert into public\.ops_registration_level_tests/)
  assert.match(saveAppointment, /insert into public\.ops_registration_consultations/)
  assert.match(saveAppointment, /'appointmentId'[\s\S]*?'notificationRevision'[\s\S]*?'requiresDirectorAssignmentTrackIds'[\s\S]*?'notificationTargets'/s)
  assert.match(saveAppointment, /'kind', p_kind[\s\S]*?'scheduledAt', p_scheduled_at[\s\S]*?'place', v_place/s)

  assert.match(cancelAppointment, /nullif\(pg_catalog\.btrim\(p_reason\), ''\)/)
  assert.match(cancelAppointment, /registration_appointment_cancel_reason_required/)
  assert.match(cancelAppointment, /status = 'scheduled'[\s\S]*?status = 'canceled'/s)
  assert.doesNotMatch(cancelAppointment, /status in \('completed', 'absent'\)[\s\S]*?status = 'canceled'/s)
  assert.match(cancelAppointment, /assert_registration_track_director_ready/)
  assert.match(cancelAppointment, /when sqlstate '40001'/)
  assert.match(cancelAppointment, /director_assignment_required/)
  assert.match(cancelAppointment, /insert into public\.ops_registration_consultations[\s\S]*?'phone'[\s\S]*?'waiting'/s)
  assert.match(cancelAppointment, /notification_revision = notification_revision \+ 1/)
  assert.match(cancelAppointment, /appointment_canceled/)
  assert.match(cancelAppointment, /'kind', v_kind[\s\S]*?'scheduledAt', v_appointment\.scheduled_at[\s\S]*?'place', v_appointment\.place/s)
  assert.match(cancelAppointment, /'appointmentId'[\s\S]*?'notificationRevision'[\s\S]*?'requiresDirectorAssignmentTrackIds'[\s\S]*?'notificationTargets'/s)
})

test("Task 3D1 level-test lifecycle mutations preserve independent subject history", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const startAttempt = readFunctionBlock(
    sql,
    "dashboard_private",
    "start_registration_level_test_attempt_impl",
  )
  const completeAttempt = readFunctionBlock(
    sql,
    "dashboard_private",
    "complete_registration_level_test_attempt_impl",
  )
  const closeTrack = readFunctionBlock(
    sql,
    "dashboard_private",
    "close_registration_level_test_track_impl",
  )

  for (const block of [startAttempt, completeAttempt, closeTrack]) {
    assert.match(block, /target_fingerprint/)
    assert.match(block, /pg_advisory_xact_lock/)
    assert.match(block, /idempotency_key_reused/)
    assert.match(block, /dashboard_private\.ops_registration_mutations/)
    assert.match(block, /transition_registration_track_status/)
    assert.match(block, /write_registration_track_event/)
    assert.match(block, /recompute_registration_parent/)
    assert.doesNotMatch(block, /notification_revision\s*=/)
    assert.doesNotMatch(block, /dashboard_notifications|http|webhook|google_chat/i)

    const taskLock = block.indexOf("-- level_test_task_lock")
    const detailLock = block.indexOf("-- level_test_detail_lock")
    const trackLock = block.indexOf("-- level_test_track_locks")
    const appointmentLock = block.indexOf("-- level_test_appointment_locks")
    const attemptLock = block.indexOf("-- level_test_attempt_locks")
    const consultationLock = block.indexOf("-- level_test_consultation_locks")
    const receipt = block.indexOf("-- level_test_receipt_lookup")
    const mutableState = block.indexOf("-- level_test_mutable_state_check")
    assert.ok(
      taskLock !== -1
        && taskLock < detailLock
        && detailLock < trackLock
        && trackLock < appointmentLock
        && appointmentLock < attemptLock
        && attemptLock < consultationLock
        && consultationLock < receipt
        && receipt < mutableState,
      "level-test lifecycle locks globally before replay and checks mutable state only afterward",
    )
  }

  assert.match(startAttempt, /attempt\.status <> 'scheduled'/)
  assert.match(startAttempt, /track\.pipeline_status <> 'level_test_scheduled'/)
  assert.match(startAttempt, /status = 'in_progress'[\s\S]*?started_at = pg_catalog\.now\(\)/)
  assert.match(startAttempt, /'level_test_in_progress'/)
  assert.match(startAttempt, /'level_test_started'/)
  for (const block of [startAttempt, completeAttempt]) {
    assert.match(
      block,
      /array_agg\(distinct attempt\.track_id order by attempt\.track_id\)[\s\S]*?attempt\.status in \('scheduled', 'in_progress'\)[\s\S]*?'activeTrackIds', pg_catalog\.to_jsonb\(v_active_track_ids\)/,
    )
    assert.match(
      block,
      /array_agg\(distinct attempt\.track_id order by attempt\.track_id\)[\s\S]*?attempt\.status = 'canceled'[\s\S]*?'canceledTrackIds', pg_catalog\.to_jsonb\(v_canceled_track_ids\)/,
    )
  }

  assert.match(completeAttempt, /v_status not in \('completed', 'absent', 'canceled'\)/)
  assert.match(completeAttempt, /v_status = 'completed'[\s\S]*?attempt\.status <> 'in_progress'/)
  assert.match(completeAttempt, /v_status in \('absent', 'canceled'\)[\s\S]*?attempt\.status not in \('scheduled', 'in_progress'\)/)
  assert.match(completeAttempt, /registration_level_test_material_link_required/)
  const directorReady = completeAttempt.indexOf("assert_registration_track_director_ready")
  const resultWrite = completeAttempt.indexOf("update public.ops_registration_level_tests")
  const phoneInsert = completeAttempt.indexOf("insert into public.ops_registration_consultations")
  const consultationTransition = completeAttempt.indexOf("'consultation_waiting'", phoneInsert)
  assert.ok(directorReady !== -1 && directorReady < resultWrite)
  assert.ok(resultWrite < phoneInsert && phoneInsert < consultationTransition)
  assert.match(completeAttempt, /completed_at = pg_catalog\.now\(\)/)
  assert.match(completeAttempt, /case when v_status = 'completed' then v_material_link else null end/)
  assert.match(completeAttempt, /when v_status = 'completed' then 'consultation_waiting'[\s\S]*?else 'level_test_scheduled'/)
  assert.match(completeAttempt, /status in \('scheduled', 'in_progress'\)[\s\S]*?v_appointment_status := 'scheduled'/)
  assert.match(completeAttempt, /status <> 'canceled'[\s\S]*?v_appointment_status := 'canceled'[\s\S]*?v_appointment_status := 'completed'/)

  assert.match(closeTrack, /nullif\(pg_catalog\.btrim\(p_reason\), ''\)/)
  assert.match(closeTrack, /registration_level_test_close_reason_required/)
  assert.match(closeTrack, /track\.pipeline_status <> 'level_test_scheduled'/)
  assert.match(closeTrack, /status in \('scheduled', 'in_progress'\)/)
  assert.match(closeTrack, /order by attempt\.attempt_number desc[\s\S]*?status not in \('absent', 'canceled'\)/)
  assert.match(closeTrack, /'inquiry_closed'/)
  assert.match(closeTrack, /'level_test_track_closed'/)
  assert.doesNotMatch(closeTrack, /update public\.ops_registration_level_tests|delete from public\.ops_registration_level_tests/)

  for (const [name, signature] of [
    ["start_registration_level_test_attempt", "uuid, text"],
    ["complete_registration_level_test_attempt", "uuid, text, text, text"],
    ["close_registration_level_test_track", "uuid, text, text"],
  ]) {
    const wrapper = readFunctionBlock(sql, "public", name)
    assert.match(wrapper, /security invoker/)
    assert.match(wrapper, new RegExp(`dashboard_private\\.${name}_impl`))
    assert.match(sql, new RegExp(`revoke execute on function dashboard_private\\.${name}_impl\\(${signature}\\) from public, anon;`))
    assert.match(sql, new RegExp(`grant execute on function dashboard_private\\.${name}_impl\\(${signature}\\) to authenticated;`))
    assert.match(sql, new RegExp(`revoke execute on function public\\.${name}\\(${signature}\\) from public, anon;`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\(${signature}\\) to authenticated;`))
  }
})

test("Task 3D2 consultation completion enforces director ownership and atomic outcomes", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const completeConsultation = readFunctionBlock(
    sql,
    "dashboard_private",
    "complete_registration_consultation_impl",
  )
  const wrapper = readFunctionBlock(
    sql,
    "public",
    "complete_registration_consultation",
  )

  assert.match(completeConsultation, /target_fingerprint/)
  assert.match(completeConsultation, /pg_advisory_xact_lock/)
  assert.match(completeConsultation, /idempotency_key_reused/)
  assert.match(completeConsultation, /dashboard_private\.ops_registration_mutations/)

  const taskLock = completeConsultation.indexOf("-- consultation_task_lock")
  const detailLock = completeConsultation.indexOf("-- consultation_detail_lock")
  const trackLock = completeConsultation.indexOf("-- consultation_track_locks")
  const appointmentLock = completeConsultation.indexOf("-- consultation_appointment_locks")
  const activityLock = completeConsultation.indexOf("-- consultation_activity_locks")
  const accessCheck = completeConsultation.indexOf("'complete_consultation'")
  const directorCheck = completeConsultation.indexOf("assert_registration_track_director_ready")
  const receipt = completeConsultation.indexOf("-- consultation_receipt_lookup")
  const mutableState = completeConsultation.indexOf("-- consultation_mutable_state_check")
  assert.ok(
    taskLock !== -1
      && taskLock < detailLock
      && detailLock < trackLock
      && trackLock < appointmentLock
      && appointmentLock < activityLock
      && activityLock < accessCheck
      && accessCheck < directorCheck
      && directorCheck < receipt
      && receipt < mutableState,
    "consultation completion locks, revalidates ownership, replays, then checks mutable activity state",
  )

  assert.match(completeConsultation, /v_outcome not in \('enrollment', 'waiting', 'not_registered'\)/)
  assert.match(completeConsultation, /v_outcome = 'waiting'[\s\S]*?v_waiting_kind not in \('current_class', 'current_term_opening', 'next_term_opening'\)/)
  assert.match(completeConsultation, /v_waiting_kind = 'current_class'[\s\S]*?p_class_id is null/)
  assert.match(completeConsultation, /v_waiting_kind <> 'current_class'[\s\S]*?p_class_id is not null/)
  assert.match(completeConsultation, /v_outcome <> 'waiting'[\s\S]*?v_waiting_kind is not null[\s\S]*?p_class_id is not null/)

  assert.match(completeConsultation, /public\.current_dashboard_role\(\) <> 'admin'/)
  assert.match(completeConsultation, /track\.director_profile_id is distinct from v_actor_id/)
  assert.match(completeConsultation, /consultation\.director_profile_id is distinct from v_actor_id/)
  assert.match(completeConsultation, /assert_registration_mutation_access\([\s\S]*?'complete_consultation'/)
  assert.match(completeConsultation, /assert_registration_track_director_ready/)
  assert.match(completeConsultation, /v_consultation\.mode = 'phone'[\s\S]*?v_consultation\.status <> 'waiting'[\s\S]*?v_track\.pipeline_status <> 'consultation_waiting'/)
  assert.match(completeConsultation, /v_consultation\.mode = 'visit'[\s\S]*?v_consultation\.status <> 'scheduled'[\s\S]*?v_track\.pipeline_status <> 'visit_consultation_scheduled'/)
  assert.match(completeConsultation, /v_appointment\.task_id is distinct from v_task_id[\s\S]*?v_appointment\.kind <> 'visit_consultation'/)
  assert.match(completeConsultation, /v_appointment_id := v_consultation\.appointment_id;/)

  const currentClassHelper = completeConsultation.indexOf("apply_registration_current_class_wait")
  const consultationWrite = completeConsultation.indexOf("update public.ops_registration_consultations")
  assert.ok(activityLock < currentClassHelper && currentClassHelper < consultationWrite)
  assert.match(completeConsultation, /status = 'completed'[\s\S]*?completed_at = pg_catalog\.now\(\)[\s\S]*?outcome = v_outcome/)
  assert.match(completeConsultation, /when v_outcome = 'enrollment' then 'enrollment_decided'[\s\S]*?when v_outcome = 'waiting' then 'waiting'[\s\S]*?else 'not_registered'/)
  assert.match(completeConsultation, /transition_registration_track_status/)

  assert.match(completeConsultation, /if v_consultation\.mode = 'phone' then[\s\S]*?delete from public\.dashboard_notifications/)
  assert.match(completeConsultation, /notification\.type = 'registration_consultation'[\s\S]*?notification\.read_at is null/)
  assert.match(completeConsultation, /'registration:' \|\| v_task_id::text \|\| ':track:'[\s\S]*?v_consultation\.id[\s\S]*?v_consultation\.director_profile_id/)
  assert.doesNotMatch(completeConsultation, /insert into public\.dashboard_notifications|http|webhook|google_chat/i)

  assert.match(completeConsultation, /v_consultation\.mode = 'visit'[\s\S]*?update public\.ops_registration_appointments/)
  assert.doesNotMatch(completeConsultation, /notification_revision\s*=/)
  assert.match(completeConsultation, /write_registration_track_event/)
  assert.match(completeConsultation, /recompute_registration_parent/)
  assert.match(completeConsultation, /'consultation', pg_catalog\.jsonb_build_object\([\s\S]*?'track', pg_catalog\.jsonb_build_object\(/)
  assert.match(completeConsultation, /'createdAt', v_consultation\.created_at[\s\S]*?'updatedAt', v_consultation\.updated_at/)
  assert.match(completeConsultation, /'legacy', false[\s\S]*?'directorName',[\s\S]*?'directorAssignmentSource',[\s\S]*?'directorAssignmentRuleKey'/)
  assert.match(completeConsultation, /'levelTestRetakeDecision',[\s\S]*?'migrationReviewRequired', v_track\.migration_review_required/)

  assert.match(wrapper, /security invoker/)
  assert.match(wrapper, /dashboard_private\.complete_registration_consultation_impl/)
  assert.match(sql, /revoke execute on function dashboard_private\.complete_registration_consultation_impl\(uuid, text, text, uuid, text\) from public, anon;/)
  assert.match(sql, /grant execute on function dashboard_private\.complete_registration_consultation_impl\(uuid, text, text, uuid, text\) to authenticated;/)
  assert.match(sql, /revoke execute on function public\.complete_registration_consultation\(uuid, text, text, uuid, text\) from public, anon;/)
  assert.match(sql, /grant execute on function public\.complete_registration_consultation\(uuid, text, text, uuid, text\) to authenticated;/)
})

test("Task 3E1 waiting and enrollment-decision routing preserve exact roster claims", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const transitionWaiting = readFunctionBlock(
    sql,
    "dashboard_private",
    "transition_registration_waiting_impl",
  )
  const routeEnrollment = readFunctionBlock(
    sql,
    "dashboard_private",
    "route_registration_enrollment_decision_impl",
  )

  for (const implementation of [transitionWaiting, routeEnrollment]) {
    assert.match(implementation, /target_fingerprint/)
    assert.match(implementation, /pg_advisory_xact_lock/)
    assert.match(implementation, /idempotency_key_reused/)
    assert.match(implementation, /dashboard_private\.ops_registration_mutations/)
    assert.match(implementation, /transition_registration_track_status/)
    assert.match(implementation, /write_registration_track_event/)
    assert.match(implementation, /recompute_registration_parent/)
    assert.match(implementation, /'enrollmentId'/)
    assert.match(implementation, /'canceledEnrollmentIds'/)
  }

  const waitingTaskLock = transitionWaiting.indexOf("-- waiting_task_lock")
  const waitingDetailLock = transitionWaiting.indexOf("-- waiting_detail_lock")
  const waitingTrackLocks = transitionWaiting.indexOf("-- waiting_track_locks")
  const waitingIdentityLock = transitionWaiting.indexOf("-- waiting_identity_lock")
  const waitingStudentLocks = transitionWaiting.indexOf("-- waiting_student_locks")
  const waitingEnrollmentLocks = transitionWaiting.indexOf("-- waiting_enrollment_locks")
  const waitingClassLocks = transitionWaiting.indexOf("-- waiting_class_locks")
  const waitingAccess = transitionWaiting.indexOf("'transition_waiting'")
  const waitingReceipt = transitionWaiting.indexOf("-- waiting_receipt_lookup")
  const waitingMutable = transitionWaiting.indexOf("-- waiting_mutable_state_check")
  assert.ok(
    waitingTaskLock !== -1
      && waitingTaskLock < waitingDetailLock
      && waitingDetailLock < waitingTrackLocks
      && waitingTrackLocks < waitingIdentityLock
      && waitingIdentityLock < waitingStudentLocks
      && waitingStudentLocks < waitingEnrollmentLocks
      && waitingEnrollmentLocks < waitingClassLocks
      && waitingClassLocks < waitingAccess
      && waitingAccess < waitingReceipt
      && waitingReceipt < waitingMutable,
    "waiting transition follows actor -> parent -> identity/student -> claim -> class order before replay and mutable checks",
  )
  assert.match(transitionWaiting, /v_action not in \(\s*'change_waiting_kind', 'record_retest_required',\s*'move_to_enrollment', 'close_not_registered'\s*\)/)
  assert.match(transitionWaiting, /v_track\.pipeline_status <> 'waiting'/)
  assert.match(transitionWaiting, /v_action = 'change_waiting_kind'[\s\S]*?v_waiting_kind not in \('current_class', 'current_term_opening', 'next_term_opening'\)/)
  assert.match(transitionWaiting, /v_action = 'record_retest_required'[\s\S]*?v_retake_decision <> 'required'/)
  assert.match(transitionWaiting, /v_action = 'move_to_enrollment'[\s\S]*?v_retake_decision <> 'not_required'/)
  assert.match(transitionWaiting, /v_action = 'close_not_registered'[\s\S]*?v_reason is null/)
  assert.match(transitionWaiting, /apply_student_class_roster_mode\([\s\S]*?'removed'[\s\S]*?'waitlist'/)
  assert.match(transitionWaiting, /-- waiting_enrollment_locks[\s\S]*?enrollment\.track_id = p_track_id[\s\S]*?enrollment\.class_id = p_class_id[\s\S]*?enrollment\.roster_active/)
  assert.match(transitionWaiting, /-- waiting_current_claim_deactivation[\s\S]*?status = 'canceled'[\s\S]*?roster_active = false/)
  assert.match(transitionWaiting, /apply_registration_current_class_wait/)
  assert.match(transitionWaiting, /when v_action = 'record_retest_required' then 'waiting'[\s\S]*?when v_action = 'move_to_enrollment' then 'enrollment_decided'[\s\S]*?else 'not_registered'/)

  const routeTaskLock = routeEnrollment.indexOf("-- enrollment_decision_task_lock")
  const routeDetailLock = routeEnrollment.indexOf("-- enrollment_decision_detail_lock")
  const routeTrackLocks = routeEnrollment.indexOf("-- enrollment_decision_track_locks")
  const routeIdentityLock = routeEnrollment.indexOf("-- enrollment_decision_identity_lock")
  const routeStudentLocks = routeEnrollment.indexOf("-- enrollment_decision_student_locks")
  const routeEnrollmentLocks = routeEnrollment.indexOf("-- enrollment_decision_enrollment_locks")
  const routeClassLocks = routeEnrollment.indexOf("-- enrollment_decision_class_locks")
  const routeAccess = routeEnrollment.indexOf("'route_enrollment_decision'")
  const routeReceipt = routeEnrollment.indexOf("-- enrollment_decision_receipt_lookup")
  const routeMutable = routeEnrollment.indexOf("-- enrollment_decision_mutable_state_check")
  assert.ok(
    routeTaskLock !== -1
      && routeTaskLock < routeDetailLock
      && routeDetailLock < routeTrackLocks
      && routeTrackLocks < routeIdentityLock
      && routeIdentityLock < routeStudentLocks
      && routeStudentLocks < routeEnrollmentLocks
      && routeEnrollmentLocks < routeClassLocks
      && routeClassLocks < routeAccess
      && routeAccess < routeReceipt
      && routeReceipt < routeMutable,
    "enrollment decision routing follows the global roster lock order before replay and mutable checks",
  )
  assert.match(routeEnrollment, /v_destination not in \('waiting', 'not_registered'\)/)
  assert.match(routeEnrollment, /v_track\.pipeline_status <> 'enrollment_decided'/)
  assert.match(routeEnrollment, /v_destination = 'waiting'[\s\S]*?v_waiting_kind not in \('current_class', 'current_term_opening', 'next_term_opening'\)/)
  assert.match(routeEnrollment, /v_destination = 'not_registered'[\s\S]*?v_reason is null/)
  const cancelDrafts = routeEnrollment.indexOf("-- enrollment_decision_cancel_unbatched_drafts")
  const materializeWait = routeEnrollment.indexOf("apply_registration_current_class_wait")
  assert.ok(cancelDrafts !== -1 && cancelDrafts < materializeWait)
  const cancelDraftBlock = routeEnrollment.slice(cancelDrafts, materializeWait)
  assert.match(cancelDraftBlock, /status = 'planned'[\s\S]*?admission_batch_id is null[\s\S]*?not enrollment\.roster_active/)
  assert.doesNotMatch(cancelDraftBlock, /student_id is null/)
  assert.match(routeEnrollment, /status = 'canceled'[\s\S]*?roster_active = false/)
  assert.match(routeEnrollment, /-- enrollment_decision_enrollment_locks[\s\S]*?enrollment\.track_id = p_track_id[\s\S]*?enrollment\.class_id = p_class_id[\s\S]*?enrollment\.roster_active/)

  const signatures = [
    ["transition_registration_waiting", "uuid, text, text, uuid, text, text, text"],
    ["route_registration_enrollment_decision", "uuid, text, text, uuid, text, text"],
  ]
  for (const [name, signature] of signatures) {
    const wrapper = readFunctionBlock(sql, "public", name)
    assert.match(wrapper, /security invoker/)
    assert.match(wrapper, new RegExp(`dashboard_private\\.${name}_impl`))
    assert.match(sql, new RegExp(`revoke execute on function dashboard_private\\.${name}_impl\\(${signature}\\) from public, anon;`))
    assert.match(sql, new RegExp(`grant execute on function dashboard_private\\.${name}_impl\\(${signature}\\) to authenticated;`))
    assert.match(sql, new RegExp(`revoke execute on function public\\.${name}\\(${signature}\\) from public, anon;`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\(${signature}\\) to authenticated;`))
  }
})

test("Task 3E2 enrollment draft rows validate canonical class schedule and textbook links", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const saveRows = readFunctionBlock(
    sql,
    "dashboard_private",
    "save_registration_enrollment_rows_impl",
  )
  const wrapper = readFunctionBlock(
    sql,
    "public",
    "save_registration_enrollment_rows",
  )

  assert.match(saveRows, /pg_catalog\.jsonb_typeof\(p_rows\) <> 'array'/)
  assert.match(saveRows, /-- enrollment_rows_shape_validation/)
  assert.match(saveRows, /jsonb_object_keys/)
  for (const key of [
    "id", "classId", "textbookId", "classStartDate",
    "classStartSessionKey", "classStartSession", "sortOrder",
  ]) {
    assert.match(saveRows, new RegExp(`'${key}'`))
  }
  for (const denied of [
    "status", "makeeduRegistered", "makeedu_registered", "admissionBatchId",
    "admission_batch_id", "trackId", "track_id", "clientKey",
  ]) {
    assert.match(saveRows, new RegExp(`'${denied}'`))
  }
  const shapeValidation = saveRows.indexOf("-- enrollment_rows_shape_validation")
  const integerValidation = saveRows.indexOf("v_sort_order_text !~")
  const integerCasts = saveRows.indexOf("-- enrollment_rows_integer_casts")
  const uuidCasts = saveRows.indexOf("-- enrollment_rows_uuid_casts")
  assert.ok(
    shapeValidation !== -1
      && shapeValidation < integerValidation
      && integerValidation < integerCasts
      && integerCasts < uuidCasts,
    "integer syntax and range are rejected before any integer or UUID cast",
  )
  assert.match(saveRows, /registration_enrollment_rows_duplicate_id/)
  assert.match(saveRows, /registration_enrollment_rows_duplicate_class/)
  assert.match(saveRows, /jsonb_agg[\s\S]*?order by[\s\S]*?'id'[\s\S]*?'classId'/)
  assert.match(saveRows, /target_fingerprint/)
  assert.match(saveRows, /idempotency_key_reused/)

  const taskLock = saveRows.indexOf("-- enrollment_rows_task_lock")
  const detailLock = saveRows.indexOf("-- enrollment_rows_detail_lock")
  const trackLocks = saveRows.indexOf("-- enrollment_rows_track_locks")
  const enrollmentLocks = saveRows.indexOf("-- enrollment_rows_enrollment_locks")
  const classLocks = saveRows.indexOf("-- enrollment_rows_class_locks")
  const textbookLocks = saveRows.indexOf("-- enrollment_rows_textbook_locks")
  const access = saveRows.indexOf("'save_enrollment_rows'")
  const receipt = saveRows.indexOf("-- enrollment_rows_receipt_lookup")
  const mutable = saveRows.indexOf("-- enrollment_rows_mutable_state_check")
  assert.ok(
    taskLock !== -1
      && taskLock < detailLock
      && detailLock < trackLocks
      && trackLocks < enrollmentLocks
      && enrollmentLocks < classLocks
      && classLocks < textbookLocks
      && textbookLocks < access
      && access < receipt
      && receipt < mutable,
    "draft rows lock parent, all track rows, requested classes, and textbooks before receipt and mutable checks",
  )

  assert.match(saveRows, /v_track\.pipeline_status not in \('enrollment_decided', 'registered'\)/)
  assert.doesNotMatch(saveRows, /transition_registration_track_status/)
  assert.match(saveRows, /status <> 'planned'[\s\S]*?admission_batch_id is not null[\s\S]*?student_id is not null[\s\S]*?roster_active/)
  assert.doesNotMatch(saveRows, /delete from public\.ops_registration_enrollments/)
  assert.match(saveRows, /enrollment\.status = 'planned'[\s\S]*?or enrollment\.roster_active/)
  assert.match(saveRows, /pg_catalog\.btrim\(v_class\.subject\) is distinct from v_track\.subject/)
  assert.match(saveRows, /validate_registration_class_session/)
  assert.match(saveRows, /class_start_date is null[\s\S]*?class_start_session_key is null[\s\S]*?class_start_session is null/)
  assert.match(saveRows, /v_session ->> 'sessionLabel'[\s\S]*?v_class_start_session/)
  assert.match(saveRows, /pg_catalog\.jsonb_typeof\([\s\S]*?pg_catalog\.to_jsonb\(v_class\.textbook_ids\)[\s\S]*?= 'array'/)
  assert.match(saveRows, /coalesce\([\s\S]*?pg_catalog\.to_jsonb\(v_class\.textbook_ids\), '\[\]'::jsonb[\s\S]*?\? v_textbook_id::text/)

  assert.match(saveRows, /insert into public\.ops_registration_enrollments\([\s\S]*?student_id[\s\S]*?admission_batch_id[\s\S]*?status[\s\S]*?makeedu_registered[\s\S]*?roster_active/)
  assert.match(saveRows, /update public\.ops_registration_enrollments enrollment[\s\S]*?class_id =[\s\S]*?textbook_id =[\s\S]*?class_start_date =[\s\S]*?sort_order =/)
  assert.match(saveRows, /'trackId', p_track_id[\s\S]*?'rows',/)
  assert.match(saveRows, /write_registration_track_event/)
  assert.match(saveRows, /'enrollment_rows_saved'[\s\S]*?'rowIds'[\s\S]*?'rowCount'[\s\S]*?'rows', v_rows_response/)
  assert.match(saveRows, /recompute_registration_parent/)
  assert.match(saveRows, /dashboard_private\.ops_registration_mutations/)

  assert.match(wrapper, /security invoker/)
  assert.match(wrapper, /dashboard_private\.save_registration_enrollment_rows_impl/)
  assert.match(sql, /revoke execute on function dashboard_private\.save_registration_enrollment_rows_impl\(uuid, jsonb, text\) from public, anon;/)
  assert.match(sql, /grant execute on function dashboard_private\.save_registration_enrollment_rows_impl\(uuid, jsonb, text\) to authenticated;/)
  assert.match(sql, /revoke execute on function public\.save_registration_enrollment_rows\(uuid, jsonb, text\) from public, anon;/)
  assert.match(sql, /grant execute on function public\.save_registration_enrollment_rows\(uuid, jsonb, text\) to authenticated;/)
})

test("Task 3F1 admission messaging grants send authority once and finalizes server-side", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const claim = readFunctionBlock(
    sql,
    "dashboard_private",
    "claim_registration_admission_message_impl",
  )
  const finalizer = readFunctionBlock(
    sql,
    "dashboard_private",
    "finalize_registration_admission_message_impl",
  )

  assert.doesNotMatch(claim, /target_fingerprint|idempotency_key_reused|ops_registration_mutations/)
  assert.match(claim, /pg_advisory_xact_lock[\s\S]*?v_message_request_key/)
  const taskLock = claim.indexOf("-- admission_claim_task_lock")
  const detailLock = claim.indexOf("-- admission_claim_detail_lock")
  const trackLocks = claim.indexOf("-- admission_claim_track_locks")
  const enrollmentLocks = claim.indexOf("-- admission_claim_enrollment_locks")
  const messageLocks = claim.indexOf("-- admission_claim_message_locks")
  const access = claim.indexOf("'claim_admission_message'")
  const activeClaim = claim.indexOf("-- admission_claim_existing_active")
  const eligibility = claim.indexOf("-- admission_claim_eligibility")
  const insert = claim.indexOf("-- admission_claim_insert")
  assert.ok(
    taskLock !== -1
      && taskLock < detailLock
      && detailLock < trackLocks
      && trackLocks < enrollmentLocks
      && enrollmentLocks < messageLocks
      && messageLocks < access
      && access < activeClaim
      && activeClaim < eligibility
      && eligibility < insert,
    "claim locks parent children then messages, returns existing claims before new-send eligibility",
  )
  assert.match(claim, /registration_message_request_key_reused/)
  assert.match(claim, /message\.claim_active[\s\S]*?'shouldSend', false[\s\S]*?'retryRequiresNewMessageKey', false/)
  assert.match(claim, /v_key_message\.status = 'failed'[\s\S]*?not v_key_message\.claim_active[\s\S]*?'retryRequiresNewMessageKey', true/)
  assert.match(claim, /track\.pipeline_status = 'enrollment_decided'/)
  assert.match(claim, /track\.pipeline_status = 'registered'[\s\S]*?enrollment\.status = 'planned'[\s\S]*?enrollment\.admission_batch_id is null/)
  assert.match(claim, /admission_notice_sent/)
  assert.match(claim, /registration_student_name_required/)
  assert.match(claim, /registration_parent_phone_invalid/)
  assert.match(claim, /insert into public\.ops_registration_messages[\s\S]*?on conflict do nothing[\s\S]*?returning/)
  const trueBranch = claim.indexOf("'shouldSend', true")
  assert.ok(trueBranch !== -1 && trueBranch < claim.indexOf("'studentName'", trueBranch))
  assert.match(claim, /'parentPhone'[\s\S]*?'commonRevision'/)

  assert.doesNotMatch(finalizer, /pg_advisory_xact_lock|assert_registration_mutation_access|ops_registration_mutations|write_registration_track_event/)
  assert.match(finalizer, /auth\.role\(\) <> 'service_role'/)
  assert.match(finalizer, /pg_catalog\.jsonb_typeof\(p_provider_result\) <> 'object'/)
  assert.match(finalizer, /jsonb_object_keys/)
  for (const key of [
    "providerMessageId", "providerGroupId", "providerStatusCode",
    "providerStatusMessage", "errorMessage",
  ]) {
    assert.match(finalizer, new RegExp(`'${key}'`))
  }
  assert.match(finalizer, /v_result not in \('accepted', 'failed', 'unknown'\)/)
  assert.match(finalizer, /v_result = 'accepted'[\s\S]*?v_provider_message_id is null[\s\S]*?v_provider_group_id is null/)
  const finalizerTaskLock = finalizer.indexOf("-- admission_finalizer_task_lock")
  const finalizerDetailLock = finalizer.indexOf("-- admission_finalizer_detail_lock")
  const finalizerMessageLock = finalizer.indexOf("-- admission_finalizer_message_lock")
  const finalizerState = finalizer.indexOf("-- admission_finalizer_state_machine")
  const finalizerUpdate = finalizer.indexOf("update public.ops_registration_messages")
  const finalizerResponse = finalizer.indexOf("-- admission_finalizer_response")
  assert.ok(
    finalizerTaskLock !== -1
      && finalizerTaskLock < finalizerDetailLock
      && finalizerDetailLock < finalizerMessageLock
      && finalizerMessageLock < finalizerState
      && finalizerState < finalizerUpdate
      && finalizerUpdate < finalizerResponse,
  )
  assert.match(finalizer, /v_message\.status = 'accepted'[\s\S]*?v_applied := false/)
  assert.match(finalizer, /v_message\.status = 'failed'[\s\S]*?not v_message\.claim_active[\s\S]*?v_applied := false/)
  assert.match(finalizer, /v_message\.status = 'failed'[\s\S]*?v_message\.claim_active[\s\S]*?v_result = 'accepted'/)
  assert.match(finalizer, /status = v_result[\s\S]*?claim_active = v_next_claim_active[\s\S]*?updated_at = pg_catalog\.now\(\)/)
  const redactedResponse = finalizer.slice(finalizerResponse)
  assert.match(redactedResponse, /'applied'[\s\S]*?'currentStatus'[\s\S]*?'claimActive'[\s\S]*?'messageRequestKey'/)
  assert.match(redactedResponse, /'requiresAdmissionMark'[\s\S]*?'retryRequiresNewMessageKey'/)
  assert.doesNotMatch(redactedResponse, /providerMessageId|providerGroupId|providerStatusCode|providerStatusMessage|errorMessage/)

  for (const [name, signature, rolePattern] of [
    ["claim_registration_admission_message", "uuid, text", "authenticated"],
    ["finalize_registration_admission_message", "uuid, text, jsonb", "service_role"],
  ]) {
    const wrapper = readFunctionBlock(sql, "public", name)
    assert.match(wrapper, /security invoker/)
    assert.match(wrapper, new RegExp(`dashboard_private\\.${name}_impl`))
    const revoked = name.startsWith("finalize_") ? "public, anon, authenticated" : "public, anon"
    assert.match(sql, new RegExp(`revoke execute on function dashboard_private\\.${name}_impl\\(${signature}\\) from ${revoked};`))
    assert.match(sql, new RegExp(`grant execute on function dashboard_private\\.${name}_impl\\(${signature}\\) to ${rolePattern};`))
    assert.match(sql, new RegExp(`revoke execute on function public\\.${name}\\(${signature}\\) from ${revoked};`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\(${signature}\\) to ${rolePattern};`))
  }
  assert.match(sql, /grant usage on schema dashboard_private to service_role;/)
})

test("Task 3F2 admission reconciliation release and mark keep redacted one-time history", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const reconcile = readFunctionBlock(
    sql,
    "dashboard_private",
    "reconcile_registration_admission_message_impl",
  )
  const release = readFunctionBlock(
    sql,
    "dashboard_private",
    "release_registration_admission_message_retry_impl",
  )
  const mark = readFunctionBlock(
    sql,
    "dashboard_private",
    "mark_registration_admission_notice_sent_impl",
  )

  for (const implementation of [reconcile, release]) {
    assert.match(implementation, /pg_catalog\.jsonb_typeof\(p_provider_evidence\) <> 'object'/)
    assert.match(implementation, /jsonb_object_keys/)
    for (const key of [
      "providerMessageId", "providerGroupId", "lookupRequestKey",
      "observedState", "observedStatusCode", "observedStatusMessage",
    ]) {
      assert.match(implementation, new RegExp(`'${key}'`))
    }
    assert.match(implementation, /v_observed_state not in \('accepted', 'failed', 'not_found', 'closed'\)/)
    assert.match(implementation, /v_lookup_request_key is distinct from v_message\.request_key/)
    assert.match(implementation, /target_fingerprint/)
    assert.match(implementation, /idempotency_key_reused/)
  }

  const reconcileTask = reconcile.indexOf("-- admission_reconcile_task_lock")
  const reconcileDetail = reconcile.indexOf("-- admission_reconcile_detail_lock")
  const reconcileMessage = reconcile.indexOf("-- admission_reconcile_message_lock")
  const reconcileAccess = reconcile.indexOf("'reconcile_admission_message'")
  const reconcileReceipt = reconcile.indexOf("-- admission_reconcile_receipt_lookup")
  const reconcileMutable = reconcile.indexOf("-- admission_reconcile_mutable_state_check")
  assert.ok(
    reconcileTask !== -1
      && reconcileTask < reconcileDetail
      && reconcileDetail < reconcileMessage
      && reconcileMessage < reconcileAccess
      && reconcileAccess < reconcileReceipt
      && reconcileReceipt < reconcileMutable,
  )
  assert.match(reconcile, /v_message\.status = 'pending'[\s\S]*?registration_message_provider_check_required/)
  assert.match(reconcile, /v_resolution = 'accepted'[\s\S]*?v_observed_state <> 'accepted'[\s\S]*?v_provider_message_id is null[\s\S]*?v_provider_group_id is null/)
  assert.match(reconcile, /v_resolution = 'failed'[\s\S]*?v_observed_state not in \('failed', 'not_found', 'closed'\)/)
  assert.match(reconcile, /v_message\.status = 'unknown'[\s\S]*?v_resolution in \('accepted', 'failed'\)/)
  assert.match(reconcile, /v_message\.status = 'failed'[\s\S]*?v_message\.claim_active[\s\S]*?v_resolution = 'accepted'/)
  assert.match(reconcile, /status = v_resolution[\s\S]*?claim_active = true[\s\S]*?updated_at = pg_catalog\.now\(\)/)
  const reconcileEvent = reconcile.slice(
    reconcile.indexOf("-- admission_reconcile_event"),
    reconcile.indexOf("-- admission_reconcile_response"),
  )
  assert.match(reconcileEvent, /registration_admission_message_reconciled/)
  assert.match(reconcileEvent, /observedState[\s\S]*?hasProviderIdentity/)
  assert.doesNotMatch(reconcileEvent, /providerMessageId|providerGroupId|observedStatusCode|observedStatusMessage|errorMessage/)

  const releaseTask = release.indexOf("-- admission_release_task_lock")
  const releaseDetail = release.indexOf("-- admission_release_detail_lock")
  const releaseMessage = release.indexOf("-- admission_release_message_lock")
  const releaseAccess = release.indexOf("'release_admission_message_retry'")
  const releaseReceipt = release.indexOf("-- admission_release_receipt_lookup")
  const releaseMutable = release.indexOf("-- admission_release_mutable_state_check")
  assert.ok(
    releaseTask !== -1
      && releaseTask < releaseDetail
      && releaseDetail < releaseMessage
      && releaseMessage < releaseAccess
      && releaseAccess < releaseReceipt
      && releaseReceipt < releaseMutable,
  )
  assert.match(release, /v_observed_state not in \('failed', 'not_found', 'closed'\)/)
  assert.match(release, /v_message\.status <> 'failed'[\s\S]*?not v_message\.claim_active/)
  assert.match(release, /v_message\.updated_at > pg_catalog\.now\(\) - interval '15 minutes'/)
  const releaseUpdate = release.slice(
    release.indexOf("-- admission_release_claim_update"),
    release.indexOf("-- admission_release_event"),
  )
  const releaseSet = releaseUpdate.slice(
    releaseUpdate.indexOf("set"),
    releaseUpdate.indexOf("where id"),
  )
  assert.match(releaseSet, /claim_active = false[\s\S]*?updated_at = pg_catalog\.now\(\)/)
  assert.doesNotMatch(releaseSet, /status =|provider_message_id =|provider_group_id =|provider_status_code =|provider_status_message =|error_message =/)
  const releaseEvent = release.slice(
    release.indexOf("-- admission_release_event"),
    release.indexOf("-- admission_release_response"),
  )
  assert.match(releaseEvent, /registration_admission_message_retry_released/)
  assert.doesNotMatch(releaseEvent, /providerMessageId|providerGroupId|observedStatusCode|observedStatusMessage|errorMessage/)

  assert.match(mark, /target_fingerprint/)
  assert.match(mark, /idempotency_key_reused/)
  const markTask = mark.indexOf("-- admission_mark_task_lock")
  const markDetail = mark.indexOf("-- admission_mark_detail_lock")
  const markMessage = mark.indexOf("-- admission_mark_message_lock")
  const markAccess = mark.indexOf("'mark_admission_notice'")
  const markReceipt = mark.indexOf("-- admission_mark_receipt_lookup")
  const markMutable = mark.indexOf("-- admission_mark_mutable_state_check")
  const taskGuard = mark.indexOf("-- admission_mark_task_level_guard")
  const markUpdate = mark.indexOf("-- admission_mark_flag_update")
  const markEvent = mark.indexOf("-- admission_mark_event")
  assert.ok(
    markTask !== -1
      && markTask < markDetail
      && markDetail < markMessage
      && markMessage < markAccess
      && markAccess < markReceipt
      && markReceipt < markMutable
      && markMutable < taskGuard
      && taskGuard < markUpdate
      && markUpdate < markEvent,
  )
  assert.match(mark, /message\.template_key = 'admission_application'[\s\S]*?v_message\.status <> 'accepted'/)
  assert.match(mark, /v_detail\.admission_notice_sent[\s\S]*?'applied', false[\s\S]*?ops_registration_mutations/)
  assert.match(mark, /set\s+admission_notice_sent = true/)
  const markEventBlock = mark.slice(markEvent)
  assert.match(markEventBlock, /customer_message_sent/)
  assert.doesNotMatch(markEventBlock, /provider_message_id|provider_group_id|provider_status_code|provider_status_message|error_message|pipeline_status\s*=/)

  const signatures = [
    ["reconcile_registration_admission_message", "uuid, text, jsonb, text, text"],
    ["release_registration_admission_message_retry", "uuid, jsonb, text, text"],
    ["mark_registration_admission_notice_sent", "uuid, text, text"],
  ]
  for (const [name, signature] of signatures) {
    const wrapper = readFunctionBlock(sql, "public", name)
    assert.match(wrapper, /security invoker/)
    assert.match(wrapper, new RegExp(`dashboard_private\\.${name}_impl`))
    assert.match(sql, new RegExp(`revoke execute on function dashboard_private\\.${name}_impl\\(${signature}\\) from public, anon;`))
    assert.match(sql, new RegExp(`grant execute on function dashboard_private\\.${name}_impl\\(${signature}\\) to authenticated;`))
    assert.match(sql, new RegExp(`revoke execute on function public\\.${name}\\(${signature}\\) from public, anon;`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\(${signature}\\) to authenticated;`))
  }
})

test("Task 3G1 admission batch start and finance advancement freeze the exact selected enrollment set", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const start = readFunctionBlock(
    sql,
    "dashboard_private",
    "start_registration_admission_batch_impl",
  )
  const setMakeedu = readFunctionBlock(
    sql,
    "dashboard_private",
    "set_registration_enrollment_makeedu_impl",
  )
  const advance = readFunctionBlock(
    sql,
    "dashboard_private",
    "advance_registration_admission_batch_impl",
  )

  assert.match(start, /array_agg\(distinct track_id order by track_id\)/)
  assert.match(start, /array_agg\(distinct enrollment_id order by enrollment_id\)/)
  assert.match(start, /cardinality\(v_track_ids\) = 0/)
  assert.match(start, /cardinality\(v_enrollment_ids\) = 0/)
  assert.match(start, /target_fingerprint/)
  assert.match(start, /idempotency_key_reused/)
  assert.match(start, /declare[\s\S]*?v_track_id uuid;[\s\S]*?begin/)
  assert.match(start, /foreach v_track_id in array v_track_ids/)

  const orderedStartMarkers = [
    "-- admission_batch_task_lock",
    "-- admission_batch_detail_lock",
    "-- admission_batch_track_locks",
    "-- admission_batch_identity_lock",
    "-- admission_batch_student_locks",
    "-- admission_batch_batch_locks",
    "-- admission_batch_enrollment_locks",
    "-- admission_batch_class_locks",
    "-- admission_batch_textbook_locks",
    "'start_admission_batch'",
    "-- admission_batch_receipt_lookup",
    "-- admission_batch_mutable_state_check",
  ].map((marker) => start.indexOf(marker))
  assert.ok(orderedStartMarkers.every((position) => position !== -1))
  assert.deepEqual(orderedStartMarkers, [...orderedStartMarkers].sort((a, b) => a - b))

  assert.match(start, /admission_notice_sent is not true/)
  assert.match(start, /status not in \('completed', 'canceled'\)/)
  assert.match(start, /pipeline_status not in \('enrollment_decided', 'registered'\)/)
  assert.match(start, /group by selected\.track_id[\s\S]*?count\(enrollment\.id\) < 1/)
  assert.match(start, /status <> 'planned'[\s\S]*?admission_batch_id is not null[\s\S]*?student_id is not null[\s\S]*?roster_active/)
  assert.match(start, /registration_class_subject_mismatch/)
  assert.match(start, /registration_textbook_class_mismatch/)
  assert.match(start, /validate_registration_class_session/)
  assert.match(start, /registration_class_session_invalid/)

  assert.match(start, /'registration-student:' \|\| v_name_key \|\| ':' \|\| v_parent_phone_key/)
  assert.match(start, /registration_student_identity_ambiguous/)
  assert.match(start, /registration_student_identity_mismatch/)
  assert.match(start, /registration_student_reactivation_required/)
  assert.match(start, /class_ids[\s\S]*?waitlist_class_ids[\s\S]*?student_ids[\s\S]*?waitlist_ids/)
  assert.match(start, /registration_roster_mode_conflict/)
  assert.doesNotMatch(start, /apply_student_class_roster_mode\s*\(/)
  assert.doesNotMatch(start, /student_class_enrollment_history/)

  assert.match(start, /coalesce\(max\(batch\.revision_number\), 0\) \+ 1/)
  assert.match(start, /insert into public\.ops_registration_admission_batches/)
  assert.match(start, /set[\s\S]*?student_id = v_student_id[\s\S]*?admission_batch_id = v_batch_id[\s\S]*?roster_active = true/)
  assert.match(start, /where enrollment\.id = any\(v_enrollment_ids\)/)
  assert.match(start, /unique_violation[\s\S]*?get stacked diagnostics v_unique_constraint = constraint_name/)
  assert.match(start, /v_unique_constraint = 'ops_registration_enrollments_student_class_claim_uidx'[\s\S]*?registration_student_class_already_active/)
  assert.match(start, /end if;[\s\S]*?raise;[\s\S]*?end;/)
  assert.match(start, /transition_registration_track_status\([\s\S]*?'enrollment_processing'/)
  assert.match(start, /admission_batch_started/)
  assert.match(start, /recompute_registration_parent/)

  const makeeduBatch = setMakeedu.indexOf("-- makeedu_batch_lock")
  const makeeduEnrollments = setMakeedu.indexOf("-- makeedu_enrollment_locks")
  const makeeduAccess = setMakeedu.indexOf("'set_makeedu'")
  const makeeduReceipt = setMakeedu.indexOf("-- makeedu_receipt_lookup")
  const makeeduMutable = setMakeedu.indexOf("-- makeedu_mutable_state_check")
  assert.ok(
    makeeduBatch !== -1
      && makeeduBatch < makeeduEnrollments
      && makeeduEnrollments < makeeduAccess
      && makeeduAccess < makeeduReceipt
      && makeeduReceipt < makeeduMutable,
  )
  assert.match(setMakeedu, /v_batch\.status <> 'draft'/)
  assert.match(setMakeedu, /v_enrollment\.status <> 'planned'/)
  assert.match(setMakeedu, /makeedu_registered = p_makeedu_registered/)
  assert.match(setMakeedu, /registration_enrollment_makeedu_updated/)
  assert.match(setMakeedu, /recompute_registration_parent/)

  const advanceBatch = advance.indexOf("-- admission_advance_batch_lock")
  const advanceEnrollments = advance.indexOf("-- admission_advance_enrollment_locks")
  const advanceAccess = advance.indexOf("'advance_admission_batch'")
  const advanceReceipt = advance.indexOf("-- admission_advance_receipt_lookup")
  const advanceMutable = advance.indexOf("-- admission_advance_mutable_state_check")
  assert.ok(
    advanceBatch !== -1
      && advanceBatch < advanceEnrollments
      && advanceEnrollments < advanceAccess
      && advanceAccess < advanceReceipt
      && advanceReceipt < advanceMutable,
  )
  assert.match(advance, /v_action not in \('invoice_sent', 'payment_confirmed'\)/)
  assert.match(advance, /v_action = 'invoice_sent'[\s\S]*?v_batch\.status = 'draft'/)
  assert.match(advance, /elsif v_batch\.status = 'invoiced' then[\s\S]*?v_applied := false/)
  assert.doesNotMatch(advance, /elsif v_batch\.status in \('invoiced', 'paid'\)/)
  assert.match(advance, /not enrollment\.makeedu_registered/)
  assert.match(advance, /status = 'invoiced'[\s\S]*?invoice_sent_at = pg_catalog\.now\(\)/)
  assert.match(advance, /v_action = 'payment_confirmed'[\s\S]*?v_batch\.status = 'invoiced'/)
  assert.match(advance, /v_batch\.invoice_sent_at is null/)
  assert.match(advance, /status = 'paid'[\s\S]*?payment_confirmed_at = pg_catalog\.now\(\)/)
  assert.match(advance, /v_applied := false/)
  assert.match(advance, /if v_applied then[\s\S]*?admission_batch_advanced/)
  assert.match(advance, /recompute_registration_parent/)

  for (const [name, signature] of [
    ["start_registration_admission_batch", "uuid, uuid[], uuid[], text"],
    ["set_registration_enrollment_makeedu", "uuid, boolean, text"],
    ["advance_registration_admission_batch", "uuid, text, text"],
  ]) {
    const wrapper = readFunctionBlock(sql, "public", name)
    assert.match(wrapper, /security invoker/)
    assert.match(wrapper, new RegExp(`dashboard_private\\.${name}_impl`))
    assert.match(sql, new RegExp(`revoke execute on function dashboard_private\\.${name}_impl\\(${signature.replaceAll("[]", "\\[\\]")}\\) from public, anon;`))
    assert.match(sql, new RegExp(`grant execute on function dashboard_private\\.${name}_impl\\(${signature.replaceAll("[]", "\\[\\]")}\\) to authenticated;`))
    assert.match(sql, new RegExp(`revoke execute on function public\\.${name}\\(${signature.replaceAll("[]", "\\[\\]")}\\) from public, anon;`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\(${signature.replaceAll("[]", "\\[\\]")}\\) to authenticated;`))
  }
})

test("Task 3G2 batch cancellation completion and row cancellation preserve claims and roster history", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const cancelBatch = readFunctionBlock(
    sql,
    "dashboard_private",
    "cancel_registration_admission_batch_impl",
  )
  const completeBatch = readFunctionBlock(
    sql,
    "dashboard_private",
    "complete_registration_admission_batch_impl",
  )
  const cancelEnrollment = readFunctionBlock(
    sql,
    "dashboard_private",
    "cancel_registration_enrollment_impl",
  )

  assert.match(cancelBatch, /jsonb_typeof\(p_resolutions\) <> 'array'/)
  assert.match(cancelBatch, /jsonb_object_keys/)
  assert.match(cancelBatch, /registration_admission_resolution_key_invalid/)
  assert.match(cancelBatch, /group by row\.value ->> 'trackId'[\s\S]*?having pg_catalog\.count\(\*\) > 1/)
  assert.match(cancelBatch, /jsonb_agg\([\s\S]*?order by row\.value ->> 'trackId'/)
  assert.match(cancelBatch, /target_fingerprint/)
  assert.match(cancelBatch, /idempotency_key_reused/)
  const cancelOrder = [
    "-- admission_cancel_task_lock",
    "-- admission_cancel_detail_lock",
    "-- admission_cancel_track_locks",
    "-- admission_cancel_identity_lock",
    "-- admission_cancel_student_locks",
    "-- admission_cancel_batch_locks",
    "-- admission_cancel_enrollment_locks",
    "-- admission_cancel_class_locks",
    "'cancel_admission_batch'",
    "-- admission_cancel_receipt_lookup",
    "-- admission_cancel_mutable_state_check",
  ].map((marker) => cancelBatch.indexOf(marker))
  assert.ok(cancelOrder.every((position) => position !== -1))
  assert.deepEqual(cancelOrder, [...cancelOrder].sort((a, b) => a - b))
  assert.match(cancelBatch, /-- admission_cancel_track_locks[\s\S]*?track\.task_id = v_task_id[\s\S]*?enrollment\.admission_batch_id = p_batch_id[\s\S]*?-- admission_cancel_identity_lock/)
  assert.match(cancelBatch, /v_batch\.status not in \('draft', 'invoiced'\)/)
  assert.match(cancelBatch, /status = 'canceled'[\s\S]*?roster_active = false[\s\S]*?roster_released_at = null/)
  assert.match(cancelBatch, /admission_batch_id = p_batch_id/)
  assert.doesNotMatch(cancelBatch, /student_id = null/)
  assert.match(cancelBatch, /status = 'enrolled'[\s\S]*?admission_batch_id is distinct from p_batch_id/)
  assert.match(cancelBatch, /-- admission_cancel_membership_invariant[\s\S]*?registration_admission_batch_membership_invariant/)
  assert.match(cancelBatch, /enrollment\.admission_batch_id = p_batch_id[\s\S]*?track\.task_id is distinct from v_task_id/)
  assert.match(cancelBatch, /v_has_historical_enrollment[\s\S]*?destination[\s\S]*?registered/)
  assert.match(cancelBatch, /registration_admission_resolution_(?:missing|extra|duplicate)/)
  const cancelOtherDrafts = cancelBatch.indexOf("-- admission_cancel_other_drafts")
  const cancelCurrentWait = cancelBatch.indexOf("apply_registration_current_class_wait")
  assert.ok(cancelOtherDrafts !== -1 && cancelOtherDrafts < cancelCurrentWait)
  assert.match(cancelBatch, /registration_class_subject_mismatch/)
  assert.match(cancelBatch, /admission_batch_canceled/)
  assert.match(cancelBatch, /recompute_registration_parent/)

  const completeOrder = [
    "-- admission_complete_task_lock",
    "-- admission_complete_detail_lock",
    "-- admission_complete_track_locks",
    "-- admission_complete_identity_lock",
    "-- admission_complete_student_locks",
    "-- admission_complete_batch_locks",
    "-- admission_complete_enrollment_locks",
    "-- admission_complete_class_locks",
    "-- admission_complete_textbook_locks",
    "'complete_admission_batch'",
    "-- admission_complete_receipt_lookup",
    "-- admission_complete_mutable_state_check",
  ].map((marker) => completeBatch.indexOf(marker))
  assert.ok(completeOrder.every((position) => position !== -1))
  assert.deepEqual(completeOrder, [...completeOrder].sort((a, b) => a - b))
  assert.match(completeBatch, /-- admission_complete_track_locks[\s\S]*?track\.task_id = v_task_id[\s\S]*?enrollment\.admission_batch_id = p_batch_id[\s\S]*?-- admission_complete_identity_lock/)
  assert.match(completeBatch, /v_batch\.status <> 'paid'/)
  assert.match(completeBatch, /v_batch\.invoice_sent_at is null[\s\S]*?v_batch\.payment_confirmed_at is null/)
  assert.match(completeBatch, /not enrollment\.makeedu_registered/)
  assert.match(completeBatch, /-- admission_complete_membership_invariant[\s\S]*?registration_admission_batch_membership_invariant/)
  assert.match(completeBatch, /enrollment\.admission_batch_id = p_batch_id[\s\S]*?track\.task_id is distinct from v_task_id/)
  assert.match(completeBatch, /registration_student_identity_mismatch/)
  assert.match(completeBatch, /registration_student_reactivation_required/)
  assert.match(completeBatch, /validate_registration_class_session/)
  assert.match(completeBatch, /registration_textbook_class_mismatch/)
  assert.match(completeBatch, /registration_student_class_claim_invariant/)
  assert.match(completeBatch, /registration_roster_mode_conflict/)
  assert.match(completeBatch, /order by enrollment\.class_id, enrollment\.id[\s\S]*?apply_student_class_roster_mode/)
  assert.match(completeBatch, /set[\s\S]*?status = 'enrolled'[\s\S]*?roster_active = true/)
  assert.match(completeBatch, /transition_registration_track_status\([\s\S]*?'registered'/)
  assert.match(completeBatch, /status = 'completed'/)
  assert.match(completeBatch, /'batch'[\s\S]*?'enrollments'/)
  assert.match(completeBatch, /recompute_registration_parent/)

  const rowCancelOrder = [
    "-- enrollment_cancel_task_lock",
    "-- enrollment_cancel_detail_lock",
    "-- enrollment_cancel_track_lock",
    "-- enrollment_cancel_identity_lock",
    "-- enrollment_cancel_student_lock",
    "-- enrollment_cancel_batch_locks",
    "-- enrollment_cancel_enrollment_locks",
    "-- enrollment_cancel_class_lock",
    "'cancel_enrollment'",
    "-- enrollment_cancel_receipt_lookup",
    "-- enrollment_cancel_mutable_state_check",
  ].map((marker) => cancelEnrollment.indexOf(marker))
  assert.ok(rowCancelOrder.every((position) => position !== -1))
  assert.deepEqual(rowCancelOrder, [...rowCancelOrder].sort((a, b) => a - b))
  assert.match(cancelEnrollment, /status = 'waitlisted'[\s\S]*?registration_waiting_transition_required/)
  assert.match(cancelEnrollment, /registration_open_admission_batch/)
  assert.match(cancelEnrollment, /status = 'planned'[\s\S]*?admission_batch_id is null/)
  assert.match(cancelEnrollment, /status = 'enrolled'[\s\S]*?roster_active/)
  assert.match(cancelEnrollment, /apply_student_class_roster_mode\([\s\S]*?'removed'[\s\S]*?'enrolled'/)
  assert.match(cancelEnrollment, /v_remaining_live_count > 0[\s\S]*?v_destination is not null/)
  assert.match(cancelEnrollment, /v_remaining_live_count = 0[\s\S]*?\('enrollment_decided', 'waiting', 'not_registered'\)/)
  const rowRelease = cancelEnrollment.indexOf("-- enrollment_cancel_live_claim_release")
  const rowCurrentWait = cancelEnrollment.indexOf("apply_registration_current_class_wait")
  assert.ok(rowRelease !== -1 && rowRelease < rowCurrentWait)
  assert.match(cancelEnrollment, /v_destination in \('waiting', 'not_registered'\)[\s\S]*?-- enrollment_cancel_remaining_drafts/)
  assert.match(cancelEnrollment, /registration_enrollment_canceled/)
  assert.match(cancelEnrollment, /'enrollmentSnapshot'[\s\S]*?'classId', v_enrollment\.class_id[\s\S]*?'textbookId', v_enrollment\.textbook_id[\s\S]*?'admissionBatchId', v_enrollment\.admission_batch_id[\s\S]*?'classStartSession', v_enrollment\.class_start_session/)
  assert.match(cancelEnrollment, /recompute_registration_parent/)

  for (const [name, signature] of [
    ["cancel_registration_admission_batch", "uuid, jsonb, text, text"],
    ["complete_registration_admission_batch", "uuid, text"],
    ["cancel_registration_enrollment", "uuid, text, text, uuid, text, text"],
  ]) {
    const wrapper = readFunctionBlock(sql, "public", name)
    assert.match(wrapper, /security invoker/)
    assert.match(wrapper, new RegExp(`dashboard_private\\.${name}_impl`))
    assert.match(sql, new RegExp(`revoke execute on function dashboard_private\\.${name}_impl\\(${signature}\\) from public, anon;`))
    assert.match(sql, new RegExp(`grant execute on function dashboard_private\\.${name}_impl\\(${signature}\\) to authenticated;`))
    assert.match(sql, new RegExp(`revoke execute on function public\\.${name}\\(${signature}\\) from public, anon;`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\(${signature}\\) to authenticated;`))
  }
})

test("Task 3H1 withdrawal and transfer completion own cross-workflow roster lifecycle atomically", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const accessStart = sql.indexOf(
    "create or replace function dashboard_private.assert_registration_mutation_access(",
  )
  const accessEnd = sql.indexOf("\n$$;", accessStart)
  assert.notEqual(accessStart, -1)
  assert.notEqual(accessEnd, -1)
  const access = sql.slice(accessStart, accessEnd + 4)
  const withdrawal = readFunctionBlock(
    sql,
    "dashboard_private",
    "complete_ops_withdrawal_roster_transition_impl",
  )
  const transfer = readFunctionBlock(
    sql,
    "dashboard_private",
    "complete_ops_transfer_roster_transition_impl",
  )

  assert.match(access, /p_action = 'complete_withdrawal_roster_transition'[\s\S]*?task\.type = 'withdrawal'/)
  assert.match(access, /p_action = 'complete_transfer_roster_transition'[\s\S]*?task\.type = 'transfer'/)
  assert.match(access, /coalesce\(public\.current_dashboard_role\(\), ''\) not in \('admin', 'staff'\)/)

  const withdrawalOrder = [
    "-- withdrawal_preliminary_source",
    "-- withdrawal_parent_task_locks",
    "-- withdrawal_track_locks",
    "-- withdrawal_identity_lock",
    "-- withdrawal_student_lock",
    "-- withdrawal_parent_rescan",
    "-- withdrawal_batch_locks",
    "-- withdrawal_claim_locks",
    "-- withdrawal_class_locks",
    "'complete_withdrawal_roster_transition'",
    "-- withdrawal_receipt_lookup",
    "-- withdrawal_mutable_state_check",
  ].map((marker) => withdrawal.indexOf(marker))
  assert.ok(withdrawalOrder.every((position) => position !== -1))
  assert.deepEqual(withdrawalOrder, [...withdrawalOrder].sort((a, b) => a - b))
  assert.match(withdrawal, /target_fingerprint/)
  assert.match(withdrawal, /idempotency_key_reused/)
  assert.match(withdrawal, /registration_workflow_retry_required/)
  assert.match(withdrawal, /registration_open_admission_batch/)
  assert.match(withdrawal, /makeedu_withdrawal_done[\s\S]*?fee_processed[\s\S]*?textbook_fee_processed/)
  assert.match(withdrawal, /class_ids[\s\S]*?waitlist_class_ids/)
  assert.match(withdrawal, /student_ids[\s\S]*?waitlist_ids/)
  assert.match(withdrawal, /registration_student_class_claim_invariant/)
  assert.match(withdrawal, /apply_student_class_roster_mode\([\s\S]*?'removed'[\s\S]*?'enrolled'/)
  assert.match(withdrawal, /apply_student_class_roster_mode\([\s\S]*?'removed'[\s\S]*?'waitlist'/)
  assert.match(withdrawal, /status = 'enrolled'[\s\S]*?roster_active = false[\s\S]*?roster_release_kind = 'withdrawal'/)
  assert.match(withdrawal, /status = 'canceled'[\s\S]*?roster_active = false[\s\S]*?roster_released_at = null/)
  assert.match(withdrawal, /transition_registration_track_status\([\s\S]*?'not_registered'/)
  assert.match(withdrawal, /registration_waitlist_canceled_by_withdrawal/)
  assert.match(withdrawal, /registration_enrollment_roster_released[\s\S]*?'enrollmentSnapshot'[\s\S]*?'classId', v_claim\.class_id[\s\S]*?'textbookId', v_claim\.textbook_id/)
  assert.match(withdrawal, /update public\.students[\s\S]*?status = '퇴원'/)
  assert.match(withdrawal, /update public\.ops_withdrawal_details[\s\S]*?timetable_roster_updated = true/)
  assert.match(withdrawal, /update public\.ops_tasks[\s\S]*?status = 'done'[\s\S]*?completed_at = pg_catalog\.now\(\)/)
  assert.match(withdrawal, /auto_checked[\s\S]*?auto_synced/)

  const transferOrder = [
    "-- transfer_preliminary_source",
    "-- transfer_parent_task_locks",
    "-- transfer_track_lock",
    "-- transfer_identity_lock",
    "-- transfer_student_lock",
    "-- transfer_claim_rescan",
    "-- transfer_batch_locks",
    "-- transfer_claim_locks",
    "-- transfer_claim_locked_rescan",
    "-- transfer_class_locks",
    "'complete_transfer_roster_transition'",
    "-- transfer_receipt_lookup",
    "-- transfer_mutable_state_check",
  ].map((marker) => transfer.indexOf(marker))
  assert.ok(transferOrder.every((position) => position !== -1))
  assert.deepEqual(transferOrder, [...transferOrder].sort((a, b) => a - b))
  assert.match(transfer, /target_fingerprint/)
  assert.match(transfer, /idempotency_key_reused/)
  assert.match(transfer, /registration_workflow_retry_required/)
  assert.match(transfer, /makeedu_transfer_done[\s\S]*?fee_processed[\s\S]*?textbook_fee_processed/)
  assert.match(transfer, /from_class_id[\s\S]*?to_class_id/)
  assert.match(transfer, /registration_student_class_claim_invariant/)
  assert.match(transfer, /-- transfer_claim_locked_rescan[\s\S]*?v_current_claim_count is distinct from v_pre_claim_count[\s\S]*?registration_workflow_retry_required/)
  assert.match(transfer, /registration_student_class_already_active/)
  assert.match(transfer, /registration_open_admission_batch/)
  assert.match(transfer, /apply_student_class_roster_mode\([\s\S]*?'removed'[\s\S]*?'enrolled'/)
  assert.match(transfer, /status = 'enrolled'[\s\S]*?roster_active = false[\s\S]*?roster_release_kind = 'transfer'/)
  assert.match(transfer, /apply_student_class_roster_mode\([\s\S]*?'enrolled'[\s\S]*?'removed'[\s\S]*?null/)
  assert.doesNotMatch(transfer, /insert into public\.ops_registration_enrollments/)
  assert.match(transfer, /registration_enrollment_roster_released[\s\S]*?'enrollmentSnapshot'[\s\S]*?'classId', v_claim\.class_id[\s\S]*?'textbookId', v_claim\.textbook_id/)
  assert.match(transfer, /update public\.ops_transfer_details[\s\S]*?timetable_roster_updated = true/)
  assert.match(transfer, /update public\.ops_tasks[\s\S]*?status = 'done'[\s\S]*?completed_at = pg_catalog\.now\(\)/)
  assert.match(transfer, /auto_checked[\s\S]*?auto_synced/)

  for (const [name, action] of [
    ["complete_ops_withdrawal_roster_transition", "complete_withdrawal_roster_transition"],
    ["complete_ops_transfer_roster_transition", "complete_transfer_roster_transition"],
  ]) {
    const implementation = readFunctionBlock(sql, "dashboard_private", `${name}_impl`)
    const wrapper = readFunctionBlock(sql, "public", name)
    assert.match(implementation, new RegExp(`assert_registration_mutation_access\\([^;]*'${action}'`))
    assert.match(wrapper, /security invoker/)
    assert.match(wrapper, new RegExp(`dashboard_private\\.${name}_impl`))
    assert.match(sql, new RegExp(`revoke execute on function dashboard_private\\.${name}_impl\\(uuid, text\\) from public, anon;`))
    assert.match(sql, new RegExp(`grant execute on function dashboard_private\\.${name}_impl\\(uuid, text\\) to authenticated;`))
    assert.match(sql, new RegExp(`revoke execute on function public\\.${name}\\(uuid, text\\) from public, anon;`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\(uuid, text\\) to authenticated;`))
  }
})

test("Task 3H2 migration review normalizes unordered attribution and imports only proven target state", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const migrationReview = readFunctionBlock(sql, "dashboard_private", "resolve_registration_migration_review_impl")
  const wrapper = readFunctionBlock(sql, "public", "resolve_registration_migration_review")

  const orderedMarkers = [
    "-- migration_review_payload_validation",
    "-- migration_review_actor_request_lock",
    "-- migration_review_task_detail_lock",
    "-- migration_review_track_lock",
    "-- migration_review_receipt_lookup",
    "-- migration_review_evidence_validation",
    "-- migration_review_activity_creation",
    "-- migration_review_transition",
    "-- migration_review_parent_recompute",
    "-- migration_review_receipt_insert",
  ].map((marker) => migrationReview.indexOf(marker))
  assert.ok(orderedMarkers.every((position) => position !== -1))
  assert.deepEqual(orderedMarkers, [...orderedMarkers].sort((left, right) => left - right))

  assert.match(migrationReview, /jsonb_object_keys\(coalesce\(p_assignments, '\{\}'::jsonb\)\)[\s\S]*?not in \('assignments', 'trackStates'\)/)
  assert.match(migrationReview, /registration_migration_assignment_group_duplicate/)
  assert.match(migrationReview, /registration_migration_track_state_duplicate/)
  assert.match(migrationReview, /jsonb_agg\([\s\S]*?order by[\s\S]*?group/)
  assert.match(migrationReview, /jsonb_agg\([\s\S]*?order by[\s\S]*?trackId/)
  assert.match(migrationReview, /'assignments',[\s\S]*?'trackStates'/)
  assert.match(migrationReview, /pg_advisory_xact_lock/)
  assert.match(migrationReview, /assert_registration_mutation_access\([\s\S]*?'resolve_migration_review'/)
  assert.match(migrationReview, /mutation_type = 'resolve_migration_review'[\s\S]*?target_fingerprint = v_target_fingerprint/)
  assert.match(migrationReview, /idempotency_key_reused/)
  assert.match(migrationReview, /order by track\.id[\s\S]*?for update/)
  assert.match(migrationReview, /registration-student:/)
  assert.match(migrationReview, /registration_migration_track_states_incomplete/)
  assert.match(migrationReview, /registration_migration_group_assignment_required/)
  assert.match(migrationReview, /registration_migration_assignment_track_invalid/)
  assert.match(migrationReview, /registration_migration_level_test_evidence_invalid/)
  assert.match(migrationReview, /registration_migration_visit_evidence_invalid/)
  assert.match(migrationReview, /registration_migration_placement_evidence_invalid/)
  assert.match(migrationReview, /registration_student_identity_mismatch/)
  assert.match(migrationReview, /registration_student_class_already_active/)
  assert.match(migrationReview, /v_task\.student_id is distinct from v_legacy_student_id/)
  assert.match(migrationReview, /ops_registration_enrollments[\s\S]*?student_id = v_legacy_student_id[\s\S]*?class_id = v_legacy_class_id[\s\S]*?roster_active/)
  assert.match(migrationReview, /event_type = 'legacy_registration_imported'/)
  assert.match(migrationReview, /after_value::jsonb[\s\S]*?->> 'version'[\s\S]*?->> 'trackId'/)
  assert.match(migrationReview, /v_legacy_pipeline_status/)
  assert.match(migrationReview, /v_legacy_booleans/)
  assert.match(migrationReview, /v_legacy_class_id/)
  assert.match(migrationReview, /assert_registration_track_director_ready/)
  assert.match(migrationReview, /insert into public\.ops_registration_appointments/)
  assert.match(migrationReview, /insert into public\.ops_registration_level_tests/)
  assert.match(migrationReview, /insert into public\.ops_registration_consultations/)
  assert.match(migrationReview, /apply_registration_current_class_wait/)
  assert.match(migrationReview, /validate_registration_class_session/)
  assert.match(migrationReview, /insert into public\.ops_registration_enrollments/)
  assert.match(migrationReview, /insert into public\.ops_registration_admission_batches/)
  assert.match(migrationReview, /v_legacy_pipeline_status like '5-1\.%'[\s\S]*?v_legacy_pipeline_status like '6\.%'/)
  assert.match(migrationReview, /v_invoice_sent and not v_makeedu_registered/)
  assert.match(migrationReview, /v_legacy_updated_at is null/)
  assert.match(migrationReview, /v_legacy_pipeline_status like '7\.%'[\s\S]*?admissionNoticeSent[\s\S]*?makeeduRegistered[\s\S]*?makeeduInvoiceSent[\s\S]*?paymentChecked/)
  assert.match(migrationReview, /transition_registration_track_status/)
  assert.match(migrationReview, /write_registration_track_event\([\s\S]*?'migration_review_resolved'/)
  assert.match(migrationReview, /recompute_registration_parent/)
  assert.match(migrationReview, /insert into dashboard_private\.ops_registration_mutations/)
  assert.doesNotMatch(migrationReview, /update\s+public\.ops_registration_subject_tracks\b[^;]*\bpipeline_status\s*=/s)

  assert.match(wrapper, /security invoker/)
  assert.match(wrapper, /dashboard_private\.resolve_registration_migration_review_impl/)
  assert.match(sql, /revoke execute on function dashboard_private\.resolve_registration_migration_review_impl\(uuid, jsonb, text\) from public, anon;/)
  assert.match(sql, /grant execute on function dashboard_private\.resolve_registration_migration_review_impl\(uuid, jsonb, text\) to authenticated;/)
  assert.match(sql, /revoke execute on function public\.resolve_registration_migration_review\(uuid, jsonb, text\) from public, anon;/)
  assert.match(sql, /grant execute on function public\.resolve_registration_migration_review\(uuid, jsonb, text\) to authenticated;/)
})

test("Task 3H2 reopen accepts only terminal nonregistration outcomes and creates one owned phone queue", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const reopen = readFunctionBlock(sql, "dashboard_private", "reopen_registration_track_impl")
  const wrapper = readFunctionBlock(sql, "public", "reopen_registration_track")

  const orderedMarkers = [
    "-- reopen_track_actor_request_lock",
    "-- reopen_track_task_detail_lock",
    "-- reopen_track_track_lock",
    "-- reopen_track_receipt_lookup",
    "-- reopen_track_mutable_state_check",
    "-- reopen_track_activity_creation",
    "-- reopen_track_transition",
    "-- reopen_track_parent_recompute",
    "-- reopen_track_receipt_insert",
  ].map((marker) => reopen.indexOf(marker))
  assert.ok(orderedMarkers.every((position) => position !== -1))
  assert.deepEqual(orderedMarkers, [...orderedMarkers].sort((left, right) => left - right))

  assert.match(reopen, /registration_reopen_reason_required/)
  assert.match(reopen, /p_destination[\s\S]*?not in \('inquiry', 'consultation_waiting'\)/)
  assert.match(reopen, /pg_advisory_xact_lock/)
  assert.match(reopen, /assert_registration_mutation_access\([\s\S]*?'reopen_track'/)
  assert.match(reopen, /mutation_type = 'reopen_track'[\s\S]*?target_fingerprint = v_target_fingerprint/)
  assert.match(reopen, /idempotency_key_reused/)
  assert.match(reopen, /pipeline_status not in \('not_registered', 'inquiry_closed'\)/)
  assert.match(reopen, /from public\.ops_registration_consultations consultation[\s\S]*?order by consultation\.id[\s\S]*?for update/)
  assert.match(reopen, /assert_registration_track_director_ready/)
  assert.match(reopen, /insert into public\.ops_registration_consultations\([\s\S]*?'phone'[\s\S]*?'waiting'/)
  assert.match(reopen, /not exists \([\s\S]*?ops_registration_consultations[\s\S]*?status in \('waiting', 'scheduled'\)/)
  assert.match(reopen, /transition_registration_track_status/)
  assert.match(reopen, /write_registration_track_event\([\s\S]*?'track_reopened'/)
  assert.match(reopen, /recompute_registration_parent/)
  assert.match(reopen, /insert into dashboard_private\.ops_registration_mutations/)
  assert.doesNotMatch(reopen, /pipeline_status\s*=/)

  assert.match(wrapper, /security invoker/)
  assert.match(wrapper, /dashboard_private\.reopen_registration_track_impl/)
  assert.match(sql, /revoke execute on function dashboard_private\.reopen_registration_track_impl\(uuid, text, text, text\) from public, anon;/)
  assert.match(sql, /grant execute on function dashboard_private\.reopen_registration_track_impl\(uuid, text, text, text\) to authenticated;/)
  assert.match(sql, /revoke execute on function public\.reopen_registration_track\(uuid, text, text, text\) from public, anon;/)
  assert.match(sql, /grant execute on function public\.reopen_registration_track\(uuid, text, text, text\) to authenticated;/)
})

test("Task 3H3 installs the locked roster gateway and advertises readiness only at the literal tail", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const gatewayIndex = sql.indexOf("-- global_roster_gateway_lock")
  assert.notEqual(gatewayIndex, -1)
  const gateway = sql.slice(gatewayIndex)

  assert.match(gateway, /set local lock_timeout = '5s'/)
  assert.match(gateway, /lock table public\.students in share row exclusive mode[\s\S]*?lock table public\.classes in share row exclusive mode/)
  assert.match(gateway, /global_roster_canonical_order_preflight/)
  assert.match(gateway, /global_roster_symmetry_preflight/)
  assert.match(gateway, /jsonb_typeof[\s\S]*?jsonb_array_elements[\s\S]*?count\(distinct/)
  assert.match(gateway, /class_ids[\s\S]*?waitlist_class_ids[\s\S]*?student_ids[\s\S]*?waitlist_ids/)
  assert.match(gateway, /registration_roster_projection_invalid/)
  assert.match(gateway, /registration_global_roster_repair_required/)
  assert.match(gateway, /student\.status = '퇴원'[\s\S]*?enrollment\.roster_active[\s\S]*?registration_withdrawn_roster_review_required/)
  assert.match(gateway, /ops_registration_details[\s\S]*?task\.type <> 'registration'/)
  assert.match(gateway, /ops_registration_subject_tracks[\s\S]*?task\.type <> 'registration'/)
  assert.match(gateway, /count\(\*\)[\s\S]*?not in \(1, 2\)[\s\S]*?registration_subject_track_coverage_mismatch/)

  const completionGuard = readFunctionBlock(sql, "dashboard_private", "prevent_ops_roster_completion_bypass")
  assert.match(completionGuard, /security invoker/)
  assert.match(completionGuard, /tg_op = 'INSERT'[\s\S]*?ops_roster_completion_requires_rpc/)
  assert.match(completionGuard, /old\.type is distinct from new\.type[\s\S]*?ops_roster_type_immutable/)
  assert.match(completionGuard, /ops_roster_detail_type_mismatch/)
  assert.match(completionGuard, /current_user <> 'postgres'/)

  const rosterGuard = readFunctionBlock(sql, "dashboard_private", "prevent_direct_roster_array_write")
  assert.match(rosterGuard, /security invoker/)
  assert.match(rosterGuard, /tg_op = 'INSERT'/)
  assert.match(rosterGuard, /jsonb_array_length[\s\S]*?registration_roster_write_requires_rpc/)
  const statusGuard = readFunctionBlock(sql, "dashboard_private", "prevent_direct_student_status_write")
  assert.match(statusGuard, /old\.status is distinct from new\.status[\s\S]*?student_status_transition_requires_workflow/)
  const deleteGuard = readFunctionBlock(sql, "dashboard_private", "prevent_linked_roster_entity_delete")
  assert.match(deleteGuard, /student_class_enrollment_history/)
  assert.match(deleteGuard, /ops_registration_enrollments/)
  assert.match(deleteGuard, /registration_roster_cleanup_required/)
  assert.match(deleteGuard, /registration_history_preservation_required/)

  assert.match(gateway, /create trigger prevent_ops_roster_completion_bypass[\s\S]*?before insert or update of type, status on public\.ops_tasks/)
  assert.equal((gateway.match(/before insert or update of timetable_roster_updated on public\.ops_(?:withdrawal|transfer)_details/g) || []).length, 2)
  assert.match(gateway, /create trigger prevent_direct_student_roster_insert[\s\S]*?before insert on public\.students/)
  assert.match(gateway, /create trigger prevent_direct_class_roster_insert[\s\S]*?before insert on public\.classes/)
  assert.match(gateway, /create trigger prevent_direct_student_roster_array_write[\s\S]*?before update of class_ids, waitlist_class_ids on public\.students/)
  assert.match(gateway, /create trigger prevent_direct_class_roster_array_write[\s\S]*?before update of student_ids, waitlist_ids on public\.classes/)
  assert.match(gateway, /create trigger prevent_direct_student_status_write[\s\S]*?before update of status on public\.students/)
  assert.match(gateway, /create trigger prevent_linked_student_delete[\s\S]*?before delete on public\.students/)
  assert.match(gateway, /create trigger prevent_linked_class_delete[\s\S]*?before delete on public\.classes/)

  for (const guardName of [
    "prevent_ops_roster_completion_bypass",
    "prevent_direct_roster_array_write",
    "prevent_direct_student_status_write",
    "prevent_linked_roster_entity_delete",
  ]) {
    assert.match(sql, new RegExp(`alter function dashboard_private\\.${guardName}\\(\\) owner to postgres`))
    assert.match(sql, new RegExp(`revoke execute on function dashboard_private\\.${guardName}\\(\\)[\\s\\S]*?from public, anon, authenticated`))
  }

  assert.match(gateway, /drop policy if exists student_class_enrollment_history_staff_write[\s\S]*?revoke all on table public\.student_class_enrollment_history from anon, authenticated;[\s\S]*?grant select on table public\.student_class_enrollment_history to authenticated;/)
  const compatibilityGuard = readFunctionBlock(sql, "public", "prevent_registration_compatibility_override")
  assert.match(compatibilityGuard, /security definer/)
  assert.doesNotMatch(compatibilityGuard, /current_user|session_user/)
  assert.match(compatibilityGuard, /new\.level_test_completed_at is distinct from old\.level_test_completed_at/)
  assert.match(compatibilityGuard, /new\.level_test_result is distinct from old\.level_test_result/)
  assert.match(compatibilityGuard, /new\.phone_consultation_at is distinct from old\.phone_consultation_at/)
  assert.match(compatibilityGuard, /new\.visit_consultation_at is distinct from old\.visit_consultation_at/)
  assert.doesNotMatch(compatibilityGuard, /new\.admission_notice_sent is distinct from old\.admission_notice_sent/)
  const runtimeIndex = sql.indexOf("create function public.registration_subject_tracks_runtime_version()")
  assert.ok(runtimeIndex > gatewayIndex)
  assert.match(sql.slice(runtimeIndex), /returns integer[\s\S]*?language sql[\s\S]*?security invoker[\s\S]*?select 1/)
  assert.match(sql.slice(runtimeIndex), /revoke execute on function public\.registration_subject_tracks_runtime_version\(\) from public, anon;[\s\S]*?grant execute on function public\.registration_subject_tracks_runtime_version\(\) to authenticated;/)
  assert.match(sql.trim(), /create function public\.registration_subject_tracks_runtime_version\(\)[\s\S]*?grant execute on function public\.registration_subject_tracks_runtime_version\(\) to authenticated;$/)
})

test("Task 3H3 prepares the exact schema pgTAP packet and a network-free concurrency dry run", async () => {
  const pgTap = await readFile(new URL("registration_subject_tracks_test.sql", supabaseTestsUrl), "utf8")
  const concurrency = await readFile(new URL("verify-registration-subject-track-concurrency.mjs", scriptsUrl), "utf8")

  assert.match(pgTap, /select plan\(12\)/)
  assert.equal((pgTap.match(/select has_table\(/g) || []).length, 7)
  assert.equal((pgTap.match(/select has_function\(/g) || []).length, 2)
  assert.equal((pgTap.match(/select function_privs_are\(/g) || []).length, 1)
  assert.equal((pgTap.match(/select is_empty\(/g) || []).length, 2)
  assert.match(pgTap, /select \* from finish\(\);[\s\S]*?rollback;/)

  assert.match(concurrency, /--run/)
  for (const flag of ["--url", "--anon-key", "--service-role-key", "--admin-token", "--second-admin-token"]) {
    assert.match(concurrency, new RegExp(flag))
  }
  assert.match(concurrency, /if \(!options\.run\)[\s\S]*?process\.exitCode = 0/)
  assert.match(concurrency, /production[\s\S]*?abort|abort[\s\S]*?production/i)
  assert.match(concurrency, /student identity[\s\S]*?appointment revision[\s\S]*?batch start[\s\S]*?message claim[\s\S]*?withdrawal/i)
  assert.match(concurrency, /executeAuthorizedScenarios/)
  assert.doesNotMatch(concurrency, /Executable seeded mutation races are not implemented/)
  for (const marker of [
    "runStudentIdentityRace",
    "runAppointmentRevisionRace",
    "runAttemptAndBatchCancellationRace",
    "runSamePairRosterBatchRace",
    "runUnrelatedRosterBatchRace",
    "runTwoCaseClaimRace",
    "runInvoicePaymentReplayRace",
    "runMessageRaces",
    "runDirectorReassignmentRace",
    "runWithdrawalLifecycleRaces",
  ]) {
    assert.match(concurrency, new RegExp(marker))
  }
  assert.match(concurrency, /scenarioStatus:\s*["']executed["']/)
  assert.match(concurrency, /rpc\(context\.serviceRoleFinalizerClient, ["']finalize_registration_admission_message["']/)
})

test("Task 3H3 withdrawal races use bounded fixture-only service checkpoints at exact mutation boundaries", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const concurrency = await readFile(new URL("verify-registration-subject-track-concurrency.mjs", scriptsUrl), "utf8")

  assert.match(sql, /create table dashboard_private\.ops_registration_verification_checkpoints/)
  assert.match(sql, /operation_kind text not null check \(operation_kind in \(\s*'admission_batch_before_first_claim',\s*'current_class_wait_before_materialization',\s*'withdrawal_after_parent_snapshot',\s*'withdrawal_before_status_flip'\s*\)\)/s)
  assert.match(sql, /primary key \(operation_kind, task_id, student_id\)/)
  assert.match(sql, /expires_at <= armed_at \+ interval '12 seconds'/)
  assert.match(sql, /alter table dashboard_private\.ops_registration_verification_checkpoints\s+enable row level security/)
  assert.match(sql, /revoke all on table dashboard_private\.ops_registration_verification_checkpoints\s+from public, anon, authenticated, service_role/)
  const checkpointTableStart = sql.indexOf("create table dashboard_private.ops_registration_verification_checkpoints")
  const checkpointTable = sql.slice(checkpointTableStart, sql.indexOf(";", checkpointTableStart) + 1)
  assert.doesNotMatch(checkpointTable, /\b(?:sql|query|statement|payload)\b/i)

  const helper = readFunctionBlock(sql, "dashboard_private", "await_registration_verification_checkpoint")
  assert.match(helper, /registration_verification_checkpoint_timeout/)
  assert.match(helper, /registration_verification_checkpoint_disarmed/)
  assert.match(helper, /pg_try_advisory_xact_lock/)
  assert.doesNotMatch(helper, /perform pg_catalog\.pg_advisory_xact_lock\(/)
  assert.match(helper, /pg_sleep\(0\.025\)/)
  assert.match(helper, /clock_timestamp\(\) >= v_expires_at/)

  for (const functionName of [
    "arm_registration_verification_checkpoint",
    "wait_registration_verification_checkpoint_reached",
    "release_registration_verification_checkpoint",
    "disarm_registration_verification_checkpoint",
  ]) {
    const implementation = readFunctionBlock(sql, "dashboard_private", `${functionName}_impl`)
    const wrapper = readFunctionBlock(sql, "public", functionName)
    assert.match(implementation, /security definer/)
    assert.match(implementation, /auth\.role\(\) <> 'service_role'/)
    assert.match(wrapper, /security invoker/)
    assert.match(sql, new RegExp(`revoke execute on function dashboard_private\\.${functionName}_impl\\(text, uuid, uuid\\)\\s+from public, anon, authenticated;`))
    assert.match(sql, new RegExp(`grant execute on function dashboard_private\\.${functionName}_impl\\(text, uuid, uuid\\)\\s+to service_role;`))
    assert.match(sql, new RegExp(`revoke execute on function public\\.${functionName}\\(text, uuid, uuid\\)\\s+from public, anon, authenticated;`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${functionName}\\(text, uuid, uuid\\)\\s+to service_role;`))
  }

  const arm = readFunctionBlock(sql, "dashboard_private", "arm_registration_verification_checkpoint_impl")
  const waitForReached = readFunctionBlock(
    sql,
    "dashboard_private",
    "wait_registration_verification_checkpoint_reached_impl",
  )
  assert.match(arm, /task\.memo like '\[codex-registration-race-%'/)
  assert.match(arm, /student\.name like '\[codex-registration-race-%'/)
  assert.match(arm, /task\.student_id = p_student_id/)
  assert.match(arm, /task\.type = case[\s\S]*?p_operation_kind in \(\s*'withdrawal_after_parent_snapshot',\s*'withdrawal_before_status_flip'\s*\) then 'withdrawal'[\s\S]*?else 'registration'/)
  assert.match(arm, /interval '12 seconds'/)
  assert.match(waitForReached, /when query_canceled then/)
  assert.match(waitForReached, /pg_advisory_unlock\(v_lock_key\)/)

  const waitHelper = readFunctionBlock(sql, "dashboard_private", "apply_registration_current_class_wait")
  const batch = readFunctionBlock(sql, "dashboard_private", "start_registration_admission_batch_impl")
  const withdrawal = readFunctionBlock(sql, "dashboard_private", "complete_ops_withdrawal_roster_transition_impl")
  assert.match(waitHelper, /-- verification_checkpoint_current_class_wait_before_materialization[\s\S]*?await_registration_verification_checkpoint\(\s*'current_class_wait_before_materialization',[\s\S]*?insert into public\.ops_registration_enrollments/)
  assert.match(batch, /-- verification_checkpoint_admission_batch_before_first_claim[\s\S]*?await_registration_verification_checkpoint\(\s*'admission_batch_before_first_claim',[\s\S]*?update public\.ops_registration_enrollments enrollment/)
  assert.match(withdrawal, /-- verification_checkpoint_withdrawal_before_status_flip[\s\S]*?await_registration_verification_checkpoint\(\s*'withdrawal_before_status_flip',[\s\S]*?apply_student_class_roster_mode/)
  assert.match(withdrawal, /-- verification_checkpoint_withdrawal_after_parent_snapshot[\s\S]*?await_registration_verification_checkpoint\(\s*'withdrawal_after_parent_snapshot',[\s\S]*?-- withdrawal_parent_task_locks/)

  assert.doesNotMatch(concurrency, /setTimeout\(resolve, 20\)/)
  assert.match(concurrency, /armRegistrationVerificationCheckpoint/)
  assert.match(concurrency, /waitForRegistrationVerificationCheckpoint/)
  assert.match(concurrency, /releaseRegistrationVerificationCheckpoint/)
  assert.match(concurrency, /disarmRegistrationVerificationCheckpoint/)
  assert.match(concurrency, /"registration_student_reactivation_required"/)
  assert.match(concurrency, /"registration_workflow_retry_required"/)
  assert.match(concurrency, /proofScope:\s*"deterministic_internal_checkpoint_race"/)
  assert.match(concurrency, /internalLockOrderProven:\s*true/)
  assert.match(concurrency, /lockOrders:\s*cases\.length/)
})

test("registration mutations are invoker-safe, explicit, and authenticated-only", async () => {
  const sql = await readMigration("registration_subject_track_mutations")
  const signatures = {
    create_registration_case: ["text", "text", "text", "text", "text", "text", "timestamptz", "text[]", "text", "text", "text"],
    sync_registration_case_subjects: ["uuid", "text[]", "text"],
    update_registration_case_common: ["uuid", "text", "text", "text", "text", "text", "text", "timestamptz", "text", "text", "integer", "text"],
    route_registration_inquiry: ["uuid", "text", "text", "uuid", "text"],
    assign_registration_track_director: ["uuid", "uuid", "text", "text", "integer", "text"],
    save_registration_shared_appointment: ["uuid", "uuid", "text", "timestamptz", "text", "uuid[]", "boolean", "integer", "text"],
    cancel_registration_appointment: ["uuid", "integer", "text", "text"],
    start_registration_level_test_attempt: ["uuid", "text"],
    complete_registration_level_test_attempt: ["uuid", "text", "text", "text"],
    close_registration_level_test_track: ["uuid", "text", "text"],
    complete_registration_consultation: ["uuid", "text", "text", "uuid", "text"],
    transition_registration_waiting: ["uuid", "text", "text", "uuid", "text", "text", "text"],
    route_registration_enrollment_decision: ["uuid", "text", "text", "uuid", "text", "text"],
    save_registration_enrollment_rows: ["uuid", "jsonb", "text"],
    claim_registration_admission_message: ["uuid", "text"],
    finalize_registration_admission_message: ["uuid", "text", "jsonb"],
    reconcile_registration_admission_message: ["uuid", "text", "jsonb", "text", "text"],
    release_registration_admission_message_retry: ["uuid", "jsonb", "text", "text"],
    mark_registration_admission_notice_sent: ["uuid", "text", "text"],
    start_registration_admission_batch: ["uuid", "uuid[]", "uuid[]", "text"],
    set_registration_enrollment_makeedu: ["uuid", "boolean", "text"],
    advance_registration_admission_batch: ["uuid", "text", "text"],
    cancel_registration_admission_batch: ["uuid", "jsonb", "text", "text"],
    complete_registration_admission_batch: ["uuid", "text"],
    cancel_registration_enrollment: ["uuid", "text", "text", "uuid", "text", "text"],
    complete_ops_withdrawal_roster_transition: ["uuid", "text"],
    complete_ops_transfer_roster_transition: ["uuid", "text"],
    resolve_registration_migration_review: ["uuid", "jsonb", "text"],
    reopen_registration_track: ["uuid", "text", "text", "text"],
  }
  const actionByFunction = {
    sync_registration_case_subjects: "sync_subjects",
    update_registration_case_common: "update_common",
    route_registration_inquiry: "route_inquiry",
    assign_registration_track_director: "assign_director",
    save_registration_shared_appointment: "save_appointment",
    cancel_registration_appointment: "cancel_appointment",
    start_registration_level_test_attempt: "start_level_test",
    complete_registration_level_test_attempt: "complete_level_test",
    close_registration_level_test_track: "close_level_test",
    complete_registration_consultation: "complete_consultation",
    transition_registration_waiting: "transition_waiting",
    route_registration_enrollment_decision: "route_enrollment_decision",
    save_registration_enrollment_rows: "save_enrollment_rows",
    claim_registration_admission_message: "claim_admission_message",
    reconcile_registration_admission_message: "reconcile_admission_message",
    release_registration_admission_message_retry: "release_admission_message_retry",
    mark_registration_admission_notice_sent: "mark_admission_notice",
    start_registration_admission_batch: "start_admission_batch",
    set_registration_enrollment_makeedu: "set_makeedu",
    advance_registration_admission_batch: "advance_admission_batch",
    cancel_registration_admission_batch: "cancel_admission_batch",
    complete_registration_admission_batch: "complete_admission_batch",
    cancel_registration_enrollment: "cancel_enrollment",
    complete_ops_withdrawal_roster_transition: "complete_withdrawal_roster_transition",
    complete_ops_transfer_roster_transition: "complete_transfer_roster_transition",
    resolve_registration_migration_review: "resolve_migration_review",
    reopen_registration_track: "reopen_track",
  }
  const functionNames = Object.keys(signatures)
  assert.deepEqual(Object.keys(actionByFunction), functionNames.filter((name) => !["create_registration_case", "finalize_registration_admission_message"].includes(name)))
  for (const functionName of functionNames) {
    const implementation = readFunctionBlock(sql, "dashboard_private", `${functionName}_impl`)
    const wrapper = readFunctionBlock(sql, "public", functionName)
    assert.deepEqual(readFunctionArgumentTypes(implementation), signatures[functionName])
    assert.deepEqual(readFunctionArgumentTypes(wrapper), signatures[functionName])
    assert.match(implementation, /security definer/)
    assert.match(implementation, /set search_path = ''/)
    if (functionName !== "finalize_registration_admission_message") {
      assert.match(implementation, /pg_advisory_xact_lock/)
    }
    if (functionName === "claim_registration_admission_message") {
      assert.doesNotMatch(implementation, /target_fingerprint|idempotency_key_reused|ops_registration_mutations/)
      assert.match(implementation, /insert[\s\S]*ops_registration_messages[\s\S]*on conflict do nothing[\s\S]*returning/s)
      assert.match(implementation, /'shouldSend',[\s\S]*true/s)
    } else if (functionName === "finalize_registration_admission_message") {
      assert.doesNotMatch(implementation, /target_fingerprint|idempotency_key_reused|ops_registration_mutations/)
      assert.match(implementation, /auth\.role\(\)\s*<>\s*'service_role'/)
      assert.match(implementation, /for update/)
    } else {
      assert.match(implementation, /target_fingerprint/)
      assert.match(implementation, /idempotency_key_reused/)
    }
    assert.doesNotMatch(implementation, /update\s+public\.ops_registration_subject_tracks\b[^;]*\bpipeline_status\s*=/s)
    assert.doesNotMatch(implementation, /update\s+public\.ops_registration_subject_tracks\b[^;]*\bstage_entered_at\s*=/s)
    if (functionName === "create_registration_case") {
      assert.match(implementation, /current_dashboard_role\(\).*'admin'.*'staff'/s)
    } else if (functionName === "finalize_registration_admission_message") {
      assert.doesNotMatch(implementation, /assert_registration_mutation_access/)
    } else {
      const expectedAction = actionByFunction[functionName]
      assert.match(implementation, new RegExp(`dashboard_private\\.assert_registration_mutation_access\\([^;]*'${expectedAction}'[^;]*\\);`))
      if (functionName !== "complete_registration_consultation") {
        assert.doesNotMatch(implementation, /assert_registration_mutation_access\([^;]*'complete_consultation'[^;]*\);/)
      }
    }
    assert.match(wrapper, /security invoker/)
    assert.match(wrapper, /set search_path = ''/)
    const sqlSignature = signatures[functionName].join(", ")
    const revokedRoles = functionName === "finalize_registration_admission_message"
      ? "public\\s*,\\s*anon\\s*,\\s*authenticated"
      : "public\\s*,\\s*anon"
    const grantedRole = functionName === "finalize_registration_admission_message" ? "service_role" : "authenticated"
    assert.match(sql, new RegExp(`revoke execute on function dashboard_private\\.${functionName}_impl\\(${sqlSignature.replaceAll("[]", "\\[\\]")}\\)\\s+from\\s+${revokedRoles}\\s*;`, "i"))
    assert.match(sql, new RegExp(`grant execute on function dashboard_private\\.${functionName}_impl\\(${sqlSignature.replaceAll("[]", "\\[\\]")}\\)\\s+to\\s+${grantedRole}\\s*;`, "i"))
    assert.match(sql, new RegExp(`revoke execute on function public\\.${functionName}\\(${sqlSignature.replaceAll("[]", "\\[\\]")}\\)\\s+from\\s+${revokedRoles}\\s*;`, "i"))
    assert.match(sql, new RegExp(`grant execute on function public\\.${functionName}\\(${sqlSignature.replaceAll("[]", "\\[\\]")}\\)\\s+to\\s+${grantedRole}\\s*;`, "i"))
  }
  assert.match(sql, /for update/)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /target_fingerprint/)
  assert.match(sql, /idempotency_key_reused/)
  assert.match(sql, /dashboard_private\.ops_registration_mutations/)
  assert.doesNotMatch(sql, /public\.ops_registration_mutations/)
  assert.match(sql, /create or replace function dashboard_private\.prevent_ops_roster_completion_bypass\(\)/)
  assert.match(sql, /current_user\s*<>\s*'postgres'/)
  assert.match(sql, /old\.type[\s\S]*?'withdrawal'[\s\S]*?'transfer'[\s\S]*?new\.type/)
  assert.match(sql, /before insert or update of type, status on public\.ops_tasks/)
  assert.match(sql, /before insert or update of timetable_roster_updated on public\.ops_(?:withdrawal|transfer)_details/)
  assert.match(sql, /student_status_transition_requires_workflow/)
  assert.match(sql, /before update of status on public\.students/)
  assert.match(sql, /dashboard_private\.validate_registration_class_session/)
  assert.match(sql, /dashboard_private\.apply_student_class_roster_mode/)
  assert.match(sql, /dashboard_private\.apply_registration_current_class_wait/)
  assert.match(sql, /dashboard_private\.is_active_registration_director/)
  assert.match(sql, /dashboard_private\.resolve_registration_default_director/)
  assert.match(sql, /dashboard_private\.assert_registration_track_director_ready/)
  assert.match(sql, /dashboard_private\.transition_registration_track_status/)
  assert.match(sql, /transition_registration_track_status\(\s*p_track_id uuid,\s*p_next_status text,\s*p_next_waiting_kind text,\s*p_next_retake_decision text,\s*p_next_migration_review_required boolean\s*\)/s)
  assert.match(sql, /dashboard_private\.assert_registration_mutation_access/)
  assert.match(sql, /dashboard_private\.write_registration_track_event/)
  assert.match(sql, /dashboard_private\.derive_registration_parent_projection/)
  assert.match(sql, /dashboard_private\.recompute_registration_parent/)
  assert.match(sql, /registration_subjects_required/)
  assert.match(sql, /registration_last_subject_required/)
  assert.match(sql, /registration_appointment_tracks_required/)
  assert.match(sql, /registration_subject_track_coverage_mismatch/)
  assert.match(sql, /registration_roster_projection_invalid/)
  assert.match(sql, /create or replace function public\.prevent_completed_operation_reopen/)
  assert.match(sql, /create(?: or replace)? function public\.prevent_registration_compatibility_override/)
  const completedGuardIndex = sql.indexOf("create or replace function public.prevent_completed_operation_reopen")
  const recomputeBackfillIndex = sql.indexOf("-- registration_backfill_parent_recompute")
  const globalRosterGatewayLockIndex = sql.indexOf("-- global_roster_gateway_lock")
  const compatibilityTriggerIndex = sql.indexOf("create trigger prevent_registration_compatibility_override")
  assert.ok(completedGuardIndex < recomputeBackfillIndex)
  assert.ok(recomputeBackfillIndex < compatibilityTriggerIndex)
  assert.ok(recomputeBackfillIndex < globalRosterGatewayLockIndex)
  assert.match(sql.slice(globalRosterGatewayLockIndex), /set local lock_timeout = '5s'[\s\S]*?lock table public\.students in share row exclusive mode[\s\S]*?lock table public\.classes in share row exclusive mode[\s\S]*?registration_global_roster_repair_required/)
  assert.match(sql.slice(globalRosterGatewayLockIndex), /registration_withdrawn_roster_review_required/)
  assert.match(sql, /registration_backfill_parent_recompute[\s\S]*?order by task\.id/)
  assert.match(sql, /registration_parent_projection_mismatch/)
  assert.match(sql, /create function public\.registration_subject_tracks_runtime_version\(\)[\s\S]*?select 1/)
  assert.match(sql, /grant execute on function public\.registration_subject_tracks_runtime_version\(\) to authenticated/)
  assert.ok(compatibilityTriggerIndex < sql.indexOf("create function public.registration_subject_tracks_runtime_version"))
  for (const helperName of [
    "validate_registration_class_session",
    "apply_student_class_roster_mode",
    "apply_registration_current_class_wait",
    "is_active_registration_director",
    "resolve_registration_default_director",
    "assert_registration_track_director_ready",
    "transition_registration_track_status",
    "assert_registration_mutation_access",
    "write_registration_track_event",
    "derive_registration_parent_projection",
    "recompute_registration_parent",
  ]) {
    assert.match(sql, new RegExp(`revoke execute on function dashboard_private\\.${helperName}`))
  }
  const rosterImpl = readFunctionBlock(sql, "dashboard_private", "set_student_class_roster_mode_impl")
  const rosterWrapper = readFunctionBlock(sql, "public", "set_student_class_roster_mode")
  assert.deepEqual(readFunctionArgumentTypes(rosterImpl), ["uuid", "uuid", "text", "text", "text"])
  assert.deepEqual(readFunctionArgumentTypes(rosterWrapper), ["uuid", "uuid", "text", "text", "text"])
  assert.match(rosterImpl, /security definer/)
  assert.match(rosterImpl, /current_dashboard_role\(\) in \('admin', 'staff'\)/)
  assert.doesNotMatch(rosterImpl, /'assistant'/)
  assert.match(rosterImpl, /apply_student_class_roster_mode/)
  assert.match(rosterImpl, /registration_roster_mode_conflict/)
  assert.match(rosterWrapper, /security invoker/)
  assert.match(sql, /revoke execute on function dashboard_private\.set_student_class_roster_mode_impl\(uuid, uuid, text, text, text\) from public, anon;/)
  assert.match(sql, /grant execute on function dashboard_private\.set_student_class_roster_mode_impl\(uuid, uuid, text, text, text\) to authenticated;/)
  assert.match(sql, /revoke execute on function public\.set_student_class_roster_mode\(uuid, uuid, text, text, text\) from public, anon;/)
  assert.match(sql, /grant execute on function public\.set_student_class_roster_mode\(uuid, uuid, text, text, text\) to authenticated;/)
  assert.match(sql, /create or replace function dashboard_private\.prevent_direct_roster_array_write\(\)/)
  assert.match(sql, /current_user <> 'postgres'/)
  assert.match(sql, /create trigger prevent_direct_student_roster_insert[\s\S]*?before insert on public\.students/)
  assert.match(sql, /create trigger prevent_direct_class_roster_insert[\s\S]*?before insert on public\.classes/)
  assert.match(sql, /create trigger prevent_direct_student_roster_array_write[\s\S]*?before update of class_ids, waitlist_class_ids on public\.students/)
  assert.match(sql, /create trigger prevent_direct_class_roster_array_write[\s\S]*?before update of student_ids, waitlist_ids on public\.classes/)
  assert.match(sql, /create trigger prevent_linked_student_delete[\s\S]*?before delete on public\.students/)
  assert.match(sql, /create trigger prevent_linked_class_delete[\s\S]*?before delete on public\.classes/)
  assert.match(sql, /registration_roster_write_requires_rpc/)
  assert.match(sql, /registration_roster_cleanup_required/)
  assert.match(sql, /registration_history_preservation_required/)
  assert.doesNotMatch(sql, /create policy student_class_enrollment_history[^;]*for (?:all|insert|update|delete)/i)
  assert.match(sql, /revoke all on table public\.student_class_enrollment_history from anon, authenticated;/)
  assert.match(sql, /grant select on table public\.student_class_enrollment_history to authenticated;/)
  assert.doesNotMatch(sql, /grant\s+(?!select\s+on)[^;]*on\s+(?:table\s+)?public\.student_class_enrollment_history[^;]*to\s+(?:anon|authenticated)/i)
})
