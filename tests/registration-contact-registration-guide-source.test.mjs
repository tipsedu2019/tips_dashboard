import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

const root = new URL("../", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")
const sql = read("docs/security/sql/registration-contact-message-fence-draft.sql")
const lifecycle = read("docs/security/sql/registration-contact-lifecycle-integration-draft.sql")
const sha = (value) => createHash("sha256").update(value).digest("hex")
const canonicalSources = [
  ["20260808124315_registration_customer_message_subject_admission_details.sql", "c75e570cb032c5d4d7ec266b2128d103618a0490e293255aab6f688d71574ef0"],
  ["20260809106200_registration_observation_solapi_dispatch.sql", "33f58ff36dd21828201e95411d050a61791b7cae19123d9eb6b96663f6aa757f"],
  ["20260817111315_registration_customer_booking_source_eligibility.sql", "d913ecb61b58b179fbbf054bd22249380d43c174f00c56c846774a8ad9ea37a2"],
  ["20260819152417_registration_admission_preview_active_resolver_status_compatibility.sql", "0f2653938f2f5726e7c4ed6c494fa8862230f8cd588208667cd9d9595cb98bd9"],
  ["20260901110900_registration_archived_subject_delivery_fence.sql", "ad75e49923afa71d3bab42b977f6e7877ce5bf643adb74614984549b934ef08c"],
  ["20260909045454_registration_admission_preview_saved_facts.sql", "56afc8314ac4d4e1638f38d4da07ea8e4f6e78e37c22cd5f419c9ac193bcd1fa"],
].map(([file, pin]) => {
  const source = read(`supabase/migrations/${file}`)
  assert.equal(sha(source), pin, `unchanged canonical source ${file}`)
  return source
})

function body(source, name) {
  const escaped = name.replaceAll(".", "\\.")
  const match = source.match(new RegExp(`create (?:or replace )?function ${escaped}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`, "iu"))
  assert.ok(match, `actual declared source ${name}`)
  return match[1]
}

// Ordered textual reconstruction, not a PostgreSQL runtime or catalog proof.
function delegatedAdmissionBody() {
  let result = body(canonicalSources[0], "dashboard_private.resolve_registration_customer_message_source_v1_impl")
  assert.match(canonicalSources[1], /rename to resolve_registration_customer_message_source_pre_observation_v1/u)
  assert.match(canonicalSources[2], /rename to resolve_registration_customer_message_source_pre_booking_eligibility_v1/u)
  assert.match(canonicalSources[3], /resolve_registration_customer_message_source_pre_booking_eligib\(text,uuid\)/u)
  const manual = "track.workflow_status = 'enrollment_requested'"
  const pipeline = "track.pipeline_status in ('enrollment_decided', 'enrollment_processing')"
  assert.equal(result.split(manual).length - 1, 2)
  result = result.replaceAll(manual, pipeline)
  for (const anchor of ["and track.task_id = v_task_id", "where track.task_id = v_task_id"]) {
    result = result.replaceAll(anchor, `${anchor}\n      and track.archived_at is null`)
  }
  assert.equal(result.split("track.archived_at is null").length - 1, 7)
  assert.equal(result.split(pipeline).length - 1, 2)
  result = result.replaceAll(pipeline, "not track.migration_review_required")
  return result
}

test("registration guidance uses final delegated saved facts while preserving schedules and duplicate guards", () => {
  const resolver = delegatedAdmissionBody()
  assert.match(resolver, /enrollment\.status = 'planned'/u)
  assert.match(resolver, /enrollment\.admission_batch_id is null/u)
  assert.match(resolver, /not track\.migration_review_required/u)
  assert.doesNotMatch(resolver, /track\.workflow_status = 'enrollment_requested'|track\.pipeline_status in/u)
  assert.match(resolver, /registration_customer_message_admission_plan_v1\(/u)
  assert.match(resolver, /v_detail\.admission_notice_sent or exists/u)
  assert.match(resolver, /legacy_message\.status = 'accepted'[\s\S]*legacy_message\.claim_active/u)
  assert.match(resolver, /order by track\.id\s+for share/u)
  assert.match(canonicalSources[1], /return dashboard_private\.resolve_registration_customer_message_source_pre_observation_v1\(/u)
  assert.match(canonicalSources[2], /return dashboard_private\.resolve_registration_customer_message_source_pre_booking_eligibility_v1\(/u)
  assert.doesNotMatch(sql, /create (?:or replace )?function dashboard_private\.(?:registration_customer_message_admission_plan_v1|resolve_registration_customer_message_source_pre_booking_eligib)\(/u)
})

test("admission fence requires the exact case's current nonreview planned set and rejects a mixed terminal set", () => {
  const source = body(sql, "dashboard_private.registration_contact_message_fence_v1")
  const start = source.indexOf("elsif p_kind='admission_application' then")
  assert.ok(start > 0)
  const branch = source.slice(start, source.indexOf("    end if;", start))
  assert.match(branch, /pg_catalog\.count\(\*\)>0 and coalesce\(pg_catalog\.bool_and\(/u)
  assert.match(branch, /t\.workflow_status not in \('registered','not_registered','inquiry_only'\)/u)
  assert.match(branch, /t\.task_id=v_task_id and t\.archived_at is null and not t\.migration_review_required/u)
  assert.match(branch, /e\.track_id=t\.id and e\.status='planned' and e\.admission_batch_id is null/u)
  assert.doesNotMatch(branch, /pipeline_status|enrollment_requested|jsonb_agg|limit|update|insert into|parent_phone/u)
  assert.match(source, /v_task_id := dashboard_private\.registration_customer_message_source_task_v1\(p_kind,p_source\)/u)
  assert.match(source, /snapshot := dashboard_private\.registration_case_contact_snapshot_v1\(v_task_id,false\)/u)
})

test("the final scoped admission guard rechecks after locking without trusting caller approval flags", () => {
  const guard = body(sql, "dashboard_private.assert_registration_contact_message_source_v1")
  const firstRead = guard.indexOf("registration_contact_message_fence_v1")
  const lock = guard.indexOf("assert_registration_contact_open_v1")
  const secondRead = guard.indexOf("registration_contact_message_fence_v1", firstRead + 1)
  assert.ok(firstRead < lock && lock < secondRead)
  assert.match(guard, /fence->>'contactGeneration' is distinct from generation/u)
  assert.match(guard, /sourcePhaseOpen'\)::boolean,false\) is not true/u)
  assert.match(guard, /p_kind='admission_application' and fence->>'canonicalAppointmentKind' is null/u)
  assert.match(guard, /registration_contact_use_not_allowed' using errcode='23514'/u)
  assert.doesNotMatch(guard, /approved|p_purpose|p_phase|p_workflow|using errcode='40001'/u)
})

test("existing service-only source and preview/claim/attempt paths all retain the canonical admission guard", () => {
  const fenceBody = body(sql, "dashboard_private.registration_contact_message_fence_v1")
  assert.match(fenceBody, /auth\.role\(\)\) is distinct from 'service_role'/u)
  for (const [name, clone] of [
    ["dashboard_private.resolve_registration_customer_message_source_v1_impl", "contact_source_legacy_v1"],
    ["public.create_registration_customer_message_preview_v1", "contact_preview_legacy_v1"],
    ["public.claim_registration_customer_message_v1", "contact_claim_legacy_v1"],
    ["public.mark_registration_customer_message_attempt_started_v1", "contact_attempt_legacy_v1"],
  ]) {
    const functionBody = body(sql, name)
    // The owner-only private source inherits the non-NULL JWT guard through
    // assert_source -> message_fence. Public mutation capabilities also guard
    // service_role directly before examining actor/preview/message scope.
    if (name.startsWith("public.")) assert.match(functionBody, /auth\.role\(\)\) is distinct from 'service_role'/u)
    const guard = functionBody.indexOf("assert_registration_contact_message_source_v1")
    assert.ok(guard >= 0 && guard < functionBody.indexOf(clone), `${name}: guard before original capability`)
  }
})

test("purpose restoration adds neither ACL nor sender activation and preserves the retired reminder", () => {
  assert.doesNotMatch(sql, /^\s*grant\s+/imu)
  const reconcile = body(sql, "public.reconcile_registration_customer_reminder_claims_v1")
  assert.match(reconcile, /return;/u)
  assert.doesNotMatch(reconcile, /insert|update|claim_registration_customer_reminder_job/u)
  assert.match(sql, /return null; end;/u)
  assert.match(sql, /Bundle runtime is currently preview-only, activation off/u)
})

test("fresh open commands clear only the detail student phone while parent and student master remain protected", () => {
  assert.equal(sha(lifecycle), "90620671fddb7f99d235aacdc7576f19ef431e764a6bd02885994356d0e3a85a")
  const refresh = body(lifecycle, "dashboard_private.refresh_registration_contact_case_v1")
  assert.match(refresh, /update public\.ops_registration_details source set/u)
  assert.match(refresh, /parent_phone=case when reopen_now or close_now or source\.contact_phase='closed' then null else source\.parent_phone end/u)
  assert.match(refresh, /student_phone=null/u)
  assert.doesNotMatch(lifecycle, /(?:update|insert into|delete from) public\.students\b/u)
  assert.match(lifecycle, /p_command='update_common' and not \(p_payload \? 'parentPhone'\) and snapshot->>'phase'='open'/u)
  assert.match(lifecycle, /select detail\.parent_phone into parent_phone/u)
})
