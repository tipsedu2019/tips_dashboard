import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

const root = new URL("../", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")
const sql = read("docs/security/sql/registration-contact-lifecycle-integration-draft.sql")
const md5 = (value) => createHash("md5").update(value).digest("hex")
const functionBody = (source, name) => {
  const match = source.match(new RegExp(`create(?: or replace)? function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`, "iu"))
  assert.ok(match, name)
  return match[1]
}
const originalProjection = functionBody(read("supabase/migrations/20260901110600_registration_subject_soft_archive.sql"), "dashboard_private.derive_registration_parent_projection")
const originalGuard = functionBody(read("supabase/migrations/20260712182834_registration_subject_track_mutations.sql"), "public.prevent_completed_operation_reopen")
const originalRecompute = functionBody(read("supabase/migrations/20260712182834_registration_subject_track_mutations.sql"), "dashboard_private.recompute_registration_parent")
const originalReopen = functionBody(read("supabase/migrations/20260714073327_registration_intake_workflow.sql"), "dashboard_private.reopen_registration_track_impl")

function uniqueReplace(source, anchor, replacement) {
  assert.equal(source.split(anchor).length - 1, 1, "each current source anchor must be unique")
  return source.replace(anchor, replacement)
}
function transformed(section, prefix, source) {
  const anchors = [...section.matchAll(new RegExp(`\\$${prefix}_anchor_(\\d+)\\$([\\s\\S]*?)\\$${prefix}_anchor_\\1\\$`, "gu"))]
  const replacements = [...section.matchAll(new RegExp(`\\$${prefix}_replace_(\\d+)\\$([\\s\\S]*?)\\$${prefix}_replace_\\1\\$`, "gu"))]
  assert.equal(anchors.length, 3)
  assert.deepEqual(anchors.map(item => item[1]), replacements.map(item => item[1]))
  let result = source
  anchors.forEach((item, index) => { result = uniqueReplace(result, item[2], replacements[index][2]) })
  return { result, anchors, replacements }
}

test("source-only proof: final parent guard/recompute remain intact and eleven current bodies are pinned before DDL", () => {
  assert.equal(md5(originalProjection), "9a9f8076e1ef5c2b5c70dcb7e7e1e254")
  assert.equal(md5(originalGuard), "fcdcaf1f93f4e69cb850e5c322b30d0f")
  assert.equal(md5(originalRecompute), "97ed8488eb50f6299c8f6b9057630fe2")
  assert.equal(md5(originalReopen), "1d6f75da0c146dcfc1c71f45d66ae590")
  const preflight = sql.slice(0, sql.indexOf("alter table public.ops_registration_details"))
  assert.equal([...preflight.matchAll(/'([a-f0-9]{32})','?[vs]/gu)].length, 11)
  assert.equal([...preflight.matchAll(/'[a-f0-9]{32}'/gu)].length, 11)
  for (const value of [md5(originalProjection), md5(originalGuard), md5(originalReopen)]) assert.ok(preflight.includes(value))
  assert.match(preflight, /proc\.provolatile::text=item\.volatility/u)
  assert.match(preflight, /proc\.prorettype=pg_catalog\.to_regtype\(item\.return_type\)/u)
  assert.doesNotMatch(sql, /create(?: or replace)? function public\.prevent_completed_operation_reopen|create(?: or replace)? function dashboard_private\.recompute_registration_parent/u)
  assert.match(originalGuard, /new\.completed_at is null[\s\S]*?23514/u)
})

test("source-only proof: both projection returns wrap without changing any original CTE or business fact", () => {
  const section = sql.slice(sql.indexOf("do $registration_contact_parent_projection_patch$"), sql.indexOf("end $registration_contact_parent_projection_patch$;"))
  const { result, anchors, replacements } = transformed(section, "parent", originalProjection)
  assert.equal(result.match(/return dashboard_private\.registration_contact_parent_projection_v1\(/gu).length, 2)
  let inverse = result
  replacements.forEach((item, index) => { inverse = uniqueReplace(inverse, item[2], anchors[index][2]) })
  assert.equal(inverse, originalProjection, "the full original zero-current and active-track projection can be reconstructed exactly")
  assert.match(section, /proc\.prosrc=prior\.prosrc/u)
  assert.match(section, /alter function dashboard_private\.derive_registration_parent_projection\(uuid\) volatile/u)
  assert.match(section, /after_proc\.proacl is distinct from prior\.proacl/u)
  assert.match(section, /parent_security_attribute_drift' using errcode='55000'/u)
  assert.throws(() => uniqueReplace("anchor anchor", "anchor", "replacement"))
  assert.throws(() => uniqueReplace("missing", "anchor", "replacement"))
})

test("explicit cancel is durable, natural legacy cancellation is not promoted into an explicit override", () => {
  const overlay = functionBody(sql, "dashboard_private.registration_contact_parent_projection_v1")
  assert.match(overlay, /detail\.contact_whole_cancel_explicit and detail\.contact_phase='closed'/u)
  assert.match(overlay, /claim\.parent_reopen_authorized and claim\.command='reopen'/u)
  assert.match(overlay, /source\.expected_generation=detail\.contact_generation and source\.expected_revision=detail\.contact_revision/u)
  assert.match(overlay, /not source\.legacy_replay and not source\.lifecycle_applied/u)
  assert.doesNotMatch(overlay, /for update|pg_advisory|set_config|request\.jwt|student|enrollment/u)
  assert.match(overlay, /p_projection\|\|pg_catalog\.jsonb_build_object\('parentStatus','canceled'\)/u)
  const refresh = functionBody(sql, "dashboard_private.refresh_registration_contact_case_v1")
  assert.match(refresh, /reason:=case when coalesce\(sealed_cancel,false\) or exists\(select 1 from public\.ops_tasks task where task\.id=p_task_id and task\.status='canceled'\) then 'whole_case_cancelled'/u)
  assert.match(refresh, /contact_whole_cancel_explicit=case when reopen_now then false[\s\S]*?claim\.command='close' and claim\.close_reason='whole_case_cancelled' then true/u)
  assert.match(sql, /registration_contact_explicit_cancel_v1 check\(not contact_whole_cancel_explicit/u)
})

test("cancel preserves the original nonnull/stable completed-at rule; B manual recording has no parent write", () => {
  const mutation = functionBody(sql, "public.mutate_registration_contact_v1")
  const manual = mutation.slice(mutation.indexOf("when 'set_workflow_status' then\n"), mutation.indexOf("when 'waiting_details' then result"))
  assert.match(manual, /set_registration_workflow_status_v1_impl/u)
  assert.doesNotMatch(manual, /update public\.ops_tasks|parent_reopen_authorized|contact_generation/u)
  const close = mutation.slice(mutation.indexOf("when 'close' then\n          if p_payload"), mutation.indexOf("when 'archive','unarchive' then\n"))
  assert.match(close, /completed_at=case when source\.status='canceled' and source\.completed_at is not null\s+then source\.completed_at else pg_catalog\.now\(\) end/u)
  assert.doesNotMatch(close, /completed_at=null/u)
})

test("typed contact reopen inherits nonterminal raw business projection and cannot reopen a completed/canceled business state", () => {
  const mutation = functionBody(sql, "public.mutate_registration_contact_v1")
  const reopen = mutation.slice(mutation.indexOf("when 'reopen' then\n          if source_track"), mutation.indexOf("when 'close' then\n          if p_payload"))
  assert.match(reopen, /registration_contact_legacy_parent_projection_v1\(p_task_id\)/u)
  assert.match(reopen, /inherited_status not in \('requested','in_progress'\)/u)
  assert.match(reopen, /registration_contact_business_reopen_required' using errcode='23514'/u)
  assert.match(reopen, /parent_reopen_authorized=true/u)
  assert.match(reopen, /set status=inherited_status/u)
  assert.doesNotMatch(reopen, /set status='requested'|insert into public\.students|class_ids|waitlist_class_ids/u)
})

test("natural business cancel clears contacts only after original parent guards; generic recompute cannot mint a reopening intent", () => {
  const reconcile = functionBody(sql, "dashboard_private.reconcile_registration_contact_parent_projection_v1")
  assert.match(sql, /create trigger registration_contact_parent_projection_v1 after update of status on public\.ops_tasks/u)
  assert.match(reconcile, /typed_resume:=new\.status in \('requested','in_progress'\) and exists/u)
  assert.match(reconcile, /select 1 from dashboard_private\.registration_contact_projection_claims_v1 capability/u)
  assert.match(reconcile, /capability\.actor_id is not distinct from \(select auth\.uid\(\)\)/u)
  assert.match(reconcile, /if not typed_resume then\s+insert into dashboard_private\.registration_contact_projection_claims_v1/u)
  assert.match(reconcile, /if current_count=0 then\s+projection_direction:='seal'/u)
  assert.match(reconcile, /open_now:=not all_closed/u)
  assert.match(reconcile, /contact_whole_cancel_explicit=false,parent_phone=null,student_phone=null/u)
  assert.doesNotMatch(reconcile, /update public\.ops_tasks|update public\.students|update public\.ops_registration_subject_tracks|set_config/u)
})

test("actual business-reopen body retains original retry/source/roster behavior and mints capability only after exact replay", () => {
  const section = sql.slice(sql.indexOf("do $registration_contact_legacy_business_reopen_patch$"), sql.indexOf("end $registration_contact_legacy_business_reopen_patch$;"))
  const { result, anchors, replacements } = transformed(section, "business", originalReopen)
  let inverse = result
  replacements.forEach((item, index) => { inverse = uniqueReplace(inverse, item[2], anchors[index][2]) })
  assert.equal(inverse, originalReopen)
  assert.ok(result.indexOf("prepare_registration_contact_write_v1") < result.indexOf("pg_advisory_xact_lock"))
  assert.ok(result.indexOf("if v_receipt_found then") < result.indexOf("authorize_registration_contact_business_reopen_v1"))
  assert.ok(result.indexOf("reopen_track_mutable_state_check") < result.indexOf("authorize_registration_contact_business_reopen_v1"))
  assert.ok(result.indexOf("authorize_registration_contact_business_reopen_v1") < result.indexOf("transition_registration_track_status"))
  assert.ok(result.indexOf("recompute_registration_parent") < result.indexOf("clear_registration_contact_business_reopen_v1"))
  assert.deepEqual(result.match(/using errcode = '[A-Z0-9]{5}'/gu), originalReopen.match(/using errcode = '[A-Z0-9]{5}'/gu),
    "this patch introduces no business 40001 or rewritten old source error labels")
})

test("projection capability is owner-only, transient, null-actor-safe and permits no business or raw-contact write", () => {
  const guard = functionBody(sql, "dashboard_private.guard_registration_contact_detail_write_v1")
  assert.match(guard, /projection\.direction in \('close','seal'\)/u)
  assert.match(guard, /projection\.direction='reopen'/u)
  assert.match(guard, /source\.actor_id is not distinct from \(select auth\.uid\(\)\)/u)
  assert.match(guard, /source\.expected_generation=old\.contact_generation and source\.expected_revision=old\.contact_revision/u)
  assert.match(guard, /new\.parent_phone is null and new\.student_phone is null/u)
  assert.match(guard, /pg_catalog\.to_jsonb\(new\)-array[\s\S]*?is not distinct from \(pg_catalog\.to_jsonb\(old\)-array/u)
  assert.match(guard, /new\.contact_whole_cancel_explicit/u)
  assert.match(sql, /alter table dashboard_private\.registration_contact_projection_claims_v1 enable row level security/u)
  assert.match(sql, /revoke all on dashboard_private\.registration_contact_projection_claims_v1 from public,anon,authenticated,service_role/u)
  const mint = functionBody(sql, "dashboard_private.authorize_registration_contact_business_reopen_v1")
  assert.match(mint, /assert_registration_actor_is_active_manager_v1/u)
  assert.match(mint, /assert_registration_mutation_access/u)
  assert.doesNotMatch(mint, /request_hmac|fingerprint|phone|response_payload/u)
  const acl = sql.slice(sql.indexOf("do $registration_contact_helper_acl$"))
  for (const name of ["registration_contact_parent_projection_v1", "registration_contact_legacy_parent_projection_v1", "reconcile_registration_contact_parent_projection_v1", "authorize_registration_contact_business_reopen_v1", "clear_registration_contact_business_reopen_v1"]) assert.ok(acl.includes(name))
  assert.doesNotMatch(sql, /^\s*grant /mu)
})


test("B sealing survives generic parent repair then terminal/manual/inquiry/archive edits without reclassification", () => {
  const refresh = functionBody(sql, "dashboard_private.refresh_registration_contact_case_v1")
  assert.match(refresh, /sealed_cancel:=detail\.contact_closure_reason='whole_case_cancelled'/u)
  assert.match(refresh, /not coalesce\(sealed_cancel,false\) or claim\.command='reopen' and claim\.parent_reopen_authorized/u)
  assert.match(refresh, /close_now:=not reopen_now and \([\s\S]*?or coalesce\(sealed_cancel,false\)/u)
  assert.ok(refresh.indexOf("when coalesce(sealed_cancel,false)") < refresh.indexOf("when (snapshot->>'allPhasesClosed')::boolean then 'all_current_tracks_terminal'"))
  assert.match(sql, /source_task\.status='canceled' or snapshot->>'closureReason'='whole_case_cancelled'/u)
  const mutation = functionBody(sql, "public.mutate_registration_contact_v1")
  const reopen = mutation.slice(mutation.indexOf("when 'reopen' then\n          if source_track"), mutation.indexOf("when 'close' then\n          if p_payload"))
  assert.match(reopen, /source_task\.status='canceled' or snapshot->>'closureReason'='whole_case_cancelled'/u)
  assert.match(reopen, /inherited_status not in \('requested','in_progress'\)/u)
})

test("historical default-open canceled contacts are physically sealed on generic status repair, never reopened", () => {
  const reconcile = functionBody(sql, "dashboard_private.reconcile_registration_contact_parent_projection_v1")
  assert.match(reconcile, /if new\.status<>'canceled' and old\.status<>'canceled' then return null/u)
  assert.match(reconcile, /when typed_resume then 'reopen' else 'seal'/u)
  assert.match(reconcile, /contact_phase=case when open_now then 'open' else 'closed' end/u)
  assert.match(reconcile, /contact_generation=case when open_now then source\.contact_generation\+1 else source\.contact_generation end/u)
  assert.match(reconcile, /when projection_direction='reopen' then 'all_current_tracks_terminal' else 'whole_case_cancelled'/u)
  assert.match(reconcile, /parent_phone=null,student_phone=null/u)
  assert.match(reconcile, /if not open_now then[\s\S]*?retire_registration_contact_dispatch_v1/u)
})

test("actual validated legacy resume retains terminal closure but clears cancellation seal; unchanged parent status is handled only by its live callback", () => {
  const reconcile = functionBody(sql, "dashboard_private.reconcile_registration_contact_parent_projection_v1")
  assert.match(reconcile, /open_now:=not all_closed/u)
  const guard = functionBody(sql, "dashboard_private.guard_registration_contact_detail_write_v1")
  assert.match(guard, /new\.contact_generation=old\.contact_generation and new\.contact_phase='closed'/u)
  assert.match(guard, /new\.contact_closure_reason='all_current_tracks_terminal'/u)
  assert.match(guard, /not exists\(select 1 from public\.ops_registration_subject_tracks track[\s\S]*?workflow_status not in/u)
  const callback = functionBody(sql, "dashboard_private.clear_registration_contact_business_reopen_v1")
  assert.match(callback, /source\.direction='reopen'/u)
  assert.match(callback, /detail\.contact_closure_reason='whole_case_cancelled' and not detail\.contact_whole_cancel_explicit/u)
  assert.match(callback, /task\.status in \('requested','in_progress'\)/u)
  assert.match(callback, /detail\.contact_generation<>capability\.expected_generation or detail\.contact_revision<>capability\.expected_revision/u)
  assert.match(callback, /contact_generation=case when all_closed then source\.contact_generation else source\.contact_generation\+1 end/u)
  assert.match(callback, /parent_phone=null,student_phone=null/u)
  assert.doesNotMatch(callback, /update public\.ops_tasks|update public\.students|update public\.ops_registration_subject_tracks/u)
})


test("capability projection preserves the final recipient bump rule instead of allowing an arbitrary business counter edit", () => {
  const original = functionBody(read("supabase/migrations/20260819012301_registration_customer_message_bundles.sql"), "dashboard_private.bump_registration_customer_message_recipient_revision_v1")
  const final = original.replaceAll("pg_catalog.coalesce", "coalesce")
  assert.match(read("supabase/migrations/20260819012401_fix_registration_customer_message_bundle_coalesce.sql"), /replace\(v_definition, 'pg_catalog\.coalesce', 'coalesce'\)/u)
  assert.equal(md5(final), "b29b56dd0151a2eecc74fbe2409ebfeb")
  assert.match(sql.slice(0, sql.indexOf("alter table public.ops_registration_details")), /bump_registration_customer_message_recipient_revision_v1\(\)','b29b56dd0151a2eecc74fbe2409ebfeb','v','trigger'/u)
  assert.doesNotMatch(sql, /create(?: or replace)? function dashboard_private\.bump_registration_customer_message_recipient_revision_v1|drop trigger.*bump_registration_customer_message/u)
  const guard = functionBody(sql, "dashboard_private.guard_registration_contact_detail_write_v1")
  assert.match(guard, /new\.customer_message_recipient_revision=old\.customer_message_recipient_revision\+\s+\(case when pg_catalog\.regexp_replace\(coalesce\(new\.parent_phone,''\),'\[\^0-9\]','','g'\)\s+is distinct from pg_catalog\.regexp_replace\(coalesce\(old\.parent_phone,''\),'\[\^0-9\]','','g'\) then 1 else 0 end\)/u)
  const strips = [...guard.matchAll(/pg_catalog\.to_jsonb\((?:new|old)\)-array\[([^\]]+)\]::text\[\]/gu)]
  assert.equal(strips.length, 2)
  const expected = ["parent_phone", "student_phone", "contact_phase", "contact_generation", "contact_revision", "contact_closed_at", "contact_closure_reason", "contact_whole_cancel_explicit", "customer_message_recipient_revision", "updated_at"]
  for (const strip of strips) assert.deepEqual([...strip[1].matchAll(/'([^']+)'/gu)].map(item => item[1]), expected,
    "no student/case/roster/business column is removed from exact equality")
  assert.match(guard, /source\.actor_id is not distinct from \(select auth\.uid\(\)\)/u)
  assert.match(guard, /source\.expected_generation=old\.contact_generation and source\.expected_revision=old\.contact_revision/u)
  assert.match(guard, /registration_contact_transition_required' using errcode='42501'/u)
})
