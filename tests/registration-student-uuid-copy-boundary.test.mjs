import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { applyPr126TransferCompletionSource, readFinalUuidProtocolSources, replaceOne, sourceHash,
  TRANSFER_COMPLETION_PR126_SOURCE, UUID_PROTOCOL_SIGNATURES } from "./helpers/registration-privacy-uuid-final-source.mjs"

const draft = readFileSync(new URL("../docs/security/sql/registration-student-uuid-copy-boundary-draft.sql", import.meta.url), "utf8")
const finalSources = readFinalUuidProtocolSources()
const rows = [...draft.matchAll(/\('([^']+)', '([a-f0-9]{64})', '([a-f0-9]{64})', (\$uuid_identity_body_[0-9]+\$)([\s\S]*?)\4\)/gu)]
const candidates = new Map(rows.map((row) => [row[1], { beforeHash: row[2], afterHash: row[3], body: row[5] }]))
const writeStatements = (body) => [...body.matchAll(/^\s*(?:update\s+|insert\s+into\s+|delete\s+from\s+)(?:public|dashboard_private)\.[\s\S]*?;/gmu)]
  .map((match) => match[0].trim())
const helperCalls = (body) => [...body.matchAll(/^\s*perform dashboard_private\.[a-z0-9_]+\([\s\S]*?\);/gmu)]
  .map((match) => match[0].trim()).sort()
const fingerprintStatements = (body) => [...body.matchAll(/v_target_fingerprint := [\s\S]*?;/gu)].map((match) => match[0])

test("nine source-pinned targets include the real last-lesson worker and final ordered replacements", () => {
  assert.equal(candidates.size, 9)
  assert.deepEqual([...candidates.keys()].sort(), [...UUID_PROTOCOL_SIGNATURES].sort())
  assert.deepEqual(finalSources.get("dashboard_private.finalize_registration_track_enrollments_v1(uuid,uuid)").sources,
    ["20260825152044_registration_admission_checklist_roster_consistency.sql", "20260922105632_registration_multiple_textbooks.sql"])
  assert.deepEqual(finalSources.get("dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid,text)").sources,
    ["20260801110000_withdrawal_subject_scoped_completion.sql", "20261006090000_withdrawal_last_lesson_release.sql", "20261007141548_withdrawal_completion_without_settlement.sql"])
  assert.deepEqual(finalSources.get("dashboard_private.complete_ops_transfer_roster_transition_impl(uuid,text)").sources,
    ["20260712182834_registration_subject_track_mutations.sql", TRANSFER_COMPLETION_PR126_SOURCE.migration])
})

test("batch and enrollment targets use actual declared parameter identities rather than function names alone", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20260712182834_registration_subject_track_mutations.sql", import.meta.url), "utf8")
  const targets = [
    ["cancel_registration_admission_batch_impl", "uuid,jsonb,text,text", "uuid,uuid,text,text"],
    ["complete_registration_admission_batch_impl", "uuid,text", "uuid,uuid,text"],
    ["cancel_registration_enrollment_impl", "uuid,text,text,uuid,text,text", "uuid,text,text"],
  ]
  for (const [name, expectedTypes, wrongTypes] of targets) {
    const headers = [...migration.matchAll(new RegExp(`create function dashboard_private\\.${name}\\(([\\s\\S]*?)\\)\\s*returns`, "gu"))]
    assert.equal(headers.length, 1)
    const types = headers[0][1].split(",").map((argument) => argument.trim().split(/\s+/u).slice(1).join(" ")).join(",")
    assert.equal(types, expectedTypes, "types come from the final ordered declaration")
    const identity = `dashboard_private.${name}(${types})`
    assert.equal(finalSources.get(identity).declarationIdentity, identity)
    assert.ok(candidates.has(identity))
    const wrongIdentity = `dashboard_private.${name}(${wrongTypes})`
    assert.ok(!finalSources.has(wrongIdentity), "the earlier name-only reader must not manufacture an overload")
    assert.ok(!candidates.has(wrongIdentity))
  }
})

test("PR126 dynamic transfer reconstruction fails closed on changed source or old body; no SQL execution is implied", () => {
  const migration = readFileSync(new URL(`../supabase/migrations/${TRANSFER_COMPLETION_PR126_SOURCE.migration}`, import.meta.url), "utf8")
  const original = readFileSync(new URL("../supabase/migrations/20260712182834_registration_subject_track_mutations.sql", import.meta.url), "utf8")
    .match(/create function dashboard_private\.complete_ops_transfer_roster_transition_impl\([\s\S]*?\bas\s+\$\$([\s\S]*?)\$\$;/iu)?.[1]
  assert.ok(original)
  const final = finalSources.get("dashboard_private.complete_ops_transfer_roster_transition_impl(uuid,text)").body
  assert.equal(applyPr126TransferCompletionSource(original, migration), final)
  assert.equal(sourceHash(final), TRANSFER_COMPLETION_PR126_SOURCE.finalBodySha256)
  assert.throws(() => applyPr126TransferCompletionSource(original, `${migration}\n-- changed source`), /reviewed full migration source/u)
  assert.throws(() => applyPr126TransferCompletionSource(original.replace("'40001'", "'23514'"), migration), /exact ordered body/u)
  assert.throws(() => applyPr126TransferCompletionSource(final, migration), /exact ordered body/u)
})

test("transfer candidate differs from final PR126 body only in three UUID identity/epoch source fragments", () => {
  const signature = "dashboard_private.complete_ops_transfer_roster_transition_impl(uuid,text)"
  let expected = finalSources.get(signature).body
  expected = replaceOne(expected, "  v_name_key text;\n  v_parent_phone_key text;\n", "", "identity declarations")
  expected = replaceOne(expected, String.raw`  v_name_key := pg_catalog.lower(
    pg_catalog.regexp_replace(coalesce(v_pre_student.name, ''), '\s+', '', 'g')
  );
  v_parent_phone_key := pg_catalog.regexp_replace(
    coalesce(v_pre_student.parent_contact, ''), '\D+', '', 'g'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'registration-student:' || v_name_key || ':' || v_parent_phone_key,
      0
    )
  );`, `  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('registration-student-id:' || v_student_id::text, 0)
  );`, "UUID advisory identity")
  expected = replaceOne(expected, String.raw`    or pg_catalog.lower(
      pg_catalog.regexp_replace(coalesce(v_student.name, ''), '\s+', '', 'g')
    ) is distinct from v_name_key
    or pg_catalog.regexp_replace(
      coalesce(v_student.parent_contact, ''), '\D+', '', 'g'
    ) is distinct from v_parent_phone_key`, `    or v_student.id is distinct from v_pre_student.id
    or v_student.created_at is distinct from v_pre_student.created_at`, "UUID epoch rescan")
  assert.equal(candidates.get(signature).body, expected, "no PR126 status, roster, claim, receipt, auth, lock or business logic is restored to an older body")
})

test("PR126 removed-source and enrolled-destination reconciliation preserves waits, destination claim and saved business facts", () => {
  const transfer = candidates.get("dashboard_private.complete_ops_transfer_roster_transition_impl(uuid,text)").body
  assert.doesNotMatch(transfer, /if v_student\.status = '퇴원'|raise exception 'registration_student_reactivation_required'|raise exception 'registration_student_class_already_active'/u)
  for (const direction of ["from", "to"]) {
    assert.ok(transfer.includes(`coalesce(v_student.waitlist_class_ids, '[]'::jsonb) ? v_${direction}_class_id::text`))
    assert.ok(transfer.includes(`coalesce(v_${direction}_class.waitlist_ids, '[]'::jsonb) ? v_student_id::text`))
    assert.ok(transfer.includes(`case when coalesce(v_student.class_ids, '[]'::jsonb) ? v_${direction}_class_id::text then 'enrolled' else 'removed' end`))
  }
  assert.match(transfer, /into v_to_claim_count, v_to_claim_id[\s\S]*?enrollment\.class_id = v_to_class_id and enrollment\.roster_active/u)
  assert.match(transfer, /v_to_claim_count > 1 or exists[\s\S]*?enrollment\.id = v_to_claim_id[\s\S]*?enrollment\.status <> 'enrolled'/u)
  assert.match(transfer, /v_to_class_id,\n    'enrolled',\n    case[^\n]+\n    v_to_claim_id,/u)
  assert.ok(transfer.includes("v_detail.from_class_end_date is null or v_detail.to_class_start_date is null"))
  assert.ok(transfer.indexOf("update public.students set status = '재원'") < transfer.indexOf("update public.ops_transfer_details"))
  assert.ok(transfer.includes("class_name = v_detail.to_class_name,\n    subject = v_task.subject"))
  assert.ok(transfer.includes("coalesce(v_detail.from_class_name, '')"))
  assert.ok(transfer.includes("coalesce(v_detail.to_class_name, '') || ' 등록 · transfer_to_class'"))
  assert.ok(transfer.includes("'학생 상태', v_student.status, '재원'"))
  for (const message of ["ops_transfer_completion_state_conflict", "ops_transfer_checklist_incomplete",
    "registration_student_reactivation_required", "registration_roster_mode_conflict",
    "registration_student_class_already_active", "registration_open_admission_batch"]) {
    assert.ok(!transfer.includes(`raise exception '${message}' using errcode = '40001'`), message)
  }
})

test("separate PR126 requested/applied snapshot producer and actor NULL authorization guard are not overwritten by this draft", () => {
  const migration = readFileSync(new URL(`../supabase/migrations/${TRANSFER_COMPLETION_PR126_SOURCE.migration}`, import.meta.url), "utf8")
  const actorGuard = readFileSync(new URL("../supabase/migrations/20261009082000_ops_legacy_dispatch_actor_null_guard.sql", import.meta.url), "utf8")
  assert.equal(sourceHash(migration), TRANSFER_COMPLETION_PR126_SOURCE.migrationSha256)
  for (const field of ["requested_transfer_snapshot_status", "requested_transfer_snapshot", "applied_transfer_snapshot"]) assert.ok(migration.includes(`'${field}'`))
  assert.ok(migration.includes("source.event_type = 'transfer.submitted'\n      order by source.created_at, source.id\n      limit 1"))
  assert.ok(migration.includes("when p_event_key = 'transfer.completed' then v_requested_transfer_snapshot ->> 'after_class_start_date'"))
  assert.ok(actorGuard.includes("if not coalesce(("))
  assert.ok(actorGuard.includes("), false) then"))
  assert.ok(actorGuard.includes("ops_task_legacy_dispatch_forbidden' using errcode = '42501'"))
  for (const signature of ["dashboard_private.record_ops_transition_notification_source_v1(public.ops_tasks,text,uuid)",
    "public.get_ops_task_legacy_dispatch_before_subject_completion_v1(uuid,uuid)"]) assert.ok(!candidates.has(signature))
})

for (const [signature, original] of finalSources) {
  test(`${signature}: exact source guard, UUID-only identity and preserved business writes`, () => {
    const candidate = candidates.get(signature)
    assert.ok(candidate)
    assert.equal(candidate.beforeHash, sourceHash(original.body))
    assert.equal(candidate.afterHash, sourceHash(candidate.body))
    assert.doesNotMatch(candidate.body, /parent_contact|student_phone|parent_phone|v_name_key|v_parent_phone_key|registration-student:/u)
    assert.doesNotMatch(candidate.body, /insert into public\.students/u)
    assert.match(candidate.body, /hashtextextended\('registration-student-id:' \|\| (?:v_task\.student_id|v_student_id|v_enrollment\.student_id|v_release\.student_id)::text, 0\)/u)
    const oldWrites = writeStatements(original.body).filter((statement) => !/^insert into public\.students\(/u.test(statement)
      && !/^update public\.ops_tasks(?: task)?\s+set student_id = v_student_id/u.test(statement))
    assert.deepEqual(writeStatements(candidate.body), oldWrites, "all remaining roster, status, settlement, queue, history and receipt writes are unchanged")
    assert.deepEqual(helperCalls(candidate.body), helperCalls(original.body), "access, audit, roster and checkpoint calls retain exact arguments")
    assert.deepEqual(fingerprintStatements(candidate.body), fingerprintStatements(original.body), "actor/key request target contract is unchanged")
  })
}

test("metadata-only install keeps owner ACL execution properties and creates no privilege surface", () => {
  let installer = draft
  for (const row of rows) installer = installer.replace(row[4] + row[5] + row[4], "'source_body_omitted'")
  installer = installer.replace(/--[^\n]*/gu, "")
  assert.doesNotMatch(installer, /\b(?:grant|revoke|create\s+function|create\s+role|alter\s+role|create\s+policy|alter\s+policy|drop\s+policy|update\s+public\.|insert\s+into\s+public\.|delete\s+from\s+public\.|truncate|copy|disable\s+trigger|session_replication_role)\b/iu)
  assert.match(installer, /execute pg_catalog\.replace\(v_definition, v_before\.prosrc, v_spec\.candidate_body\)/u)
  for (const field of ["proowner", "proacl", "proconfig", "prosecdef", "provolatile", "proparallel", "proisstrict", "proleakproof", "prolang", "procost", "prorows", "prosupport", "proretset", "prorettype"]) {
    assert.ok(installer.includes(`v_after.${field} is distinct from v_before.${field}`), field)
  }
  assert.ok(draft.includes("SOURCE ONLY, NOT INSTALLABLE"))
})

test("new UUID prerequisites follow authenticated exact receipt replay on all four batch/cancel APIs", () => {
  for (const [name, marker] of [
    ["start_registration_admission_batch_impl", "admission_batch"],
    ["cancel_registration_admission_batch_impl", "admission_cancel"],
    ["complete_registration_admission_batch_impl", "admission_complete"],
    ["cancel_registration_enrollment_impl", "enrollment_cancel"],
  ]) {
    const body = [...candidates].find(([signature]) => signature.includes(name))[1].body
    const access = body.indexOf("perform dashboard_private.assert_registration_mutation_access(")
    const replay = body.indexOf(`-- ${marker}_receipt_lookup`)
    const identity = body.indexOf(`-- ${marker}_identity_lock`)
    const mutable = body.indexOf(`-- ${marker}_mutable_state_check`)
    assert.ok(access >= 0 && access < replay && replay < identity && identity < mutable, name)
    assert.ok(body.slice(replay, identity).includes("if v_receipt_found then return v_response; end if;"), name)
    assert.ok(body.slice(replay, identity).includes("idempotency_key_reused"), name)
  }
  const cancel = candidates.get("dashboard_private.cancel_registration_enrollment_impl(uuid,text,text,uuid,text,text)").body
  assert.match(cancel, /if v_enrollment\.status = 'enrolled' and v_enrollment\.roster_active then[\s\S]*?registration-student-id:/u)
  assert.match(cancel, /v_enrollment\.status = 'planned'[\s\S]*?v_enrollment\.admission_batch_id is null/u)
})

test("only actual UUID/epoch/parent/claim rescans retain 40001; business messages use domain errors", () => {
  const expected = { complete_ops_withdrawal_roster_transition_impl: 2, complete_ops_transfer_roster_transition_impl: 3,
    apply_scheduled_withdrawal_roster_release_v1: 2 }
  for (const [signature, { body }] of candidates) {
    const raises = [...body.matchAll(/raise exception '([^']+)' using errcode\s*=\s*'40001'/gu)]
    const name = signature.slice(signature.indexOf(".") + 1, signature.indexOf("("))
    assert.equal(raises.length, expected[name] ?? 0, signature)
    assert.ok(raises.every((raise) => raise[1] === "registration_workflow_retry_required"), signature)
    if (expected[name]) assert.match(body, /v_student\.created_at is distinct from v_pre_student\.created_at/u)
  }
  const start = candidates.get("dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)").body
  assert.doesNotMatch(start, /registration_admission_notice_required|track\.pipeline_status not in \('enrollment_decided', 'registered'\)/u)
})

test("last-lesson reservation, queue generation and settlement independence remain in final source", () => {
  const withdrawal = candidates.get("dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid,text)").body
  for (const evidence of ["withdrawal_completion_validation", "v_roster_mode = 'removed'", "withdrawal_release_scheduler_not_ready",
    "previous.expected_history_count", "'rosterAlreadyRemoved', v_roster_mode = 'removed'", "'rosterReleaseScheduled',true"]) assert.ok(withdrawal.includes(evidence), evidence)
  assert.doesNotMatch(withdrawal, /if not v_detail\.makeedu_withdrawal_done\s+or not v_detail\.fee_processed/u)
  assert.doesNotMatch(withdrawal, /set\s+fee_processed\s*=\s*true|textbook_fee_processed\s*=\s*true/u)
  const worker = candidates.get("dashboard_private.apply_scheduled_withdrawal_roster_release_v1(uuid)").body
  assert.ok(worker.indexOf("from public.ops_tasks task") < worker.indexOf("registration-student-id:"))
  assert.ok(worker.indexOf("registration-student-id:") < worker.indexOf("for update;\n  if not found then\n    v_superseded"))
  assert.ok(worker.includes("where task_id=p_task_id for update"))
  assert.ok(worker.includes("v_history_count<>v_release.expected_history_count"))
})

test("manual workflow setter is outside this candidate and adds no finalizer call", () => {
  assert.doesNotMatch(draft, /\('dashboard_private\.set_registration_workflow_status_v1_impl/u)
  const latest = readFileSync(new URL("../supabase/migrations/20261004140440_registration_free_recording.sql", import.meta.url), "utf8")
  assert.ok(latest.includes("set_registration_workflow_status_v1_impl"))
  assert.doesNotMatch(latest, /finalize_registration_track_enrollments_v1/u)
})
