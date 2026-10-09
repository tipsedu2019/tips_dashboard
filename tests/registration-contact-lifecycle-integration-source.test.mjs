import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const sql = readFileSync(join(root, 'docs/security/sql/registration-contact-lifecycle-integration-draft.sql'), 'utf8')
const specs = [
  ['create_registration_case_impl', '20260901110700_registration_flat_case_creation.sql', 'd5ce049f39adef16428b1dc0964ff414', 'create_case'],
  ['update_registration_case_common_impl', '20260901110500_registration_flat_common_input_decoupling.sql', 'ba45098e855e187262e31102a87c0d46', 'update_common'],
  ['save_registration_case_inquiry_v1_impl', '20260901110600_registration_subject_soft_archive.sql', '5f96e3817673f97d8d803855ef7141d6', 'save_inquiry'],
  ['set_registration_workflow_status_v1_impl', '20261004140440_registration_free_recording.sql', 'de5e23e2f3662119c832b93ceb17e9e5', 'set_workflow_status'],
  ['save_registration_waiting_details_v2_impl', '20261004140440_registration_free_recording.sql', 'fcb2a22ab233bf23456e1154a19a58bb', 'save_registration_waiting_details_v2'],
  ['sync_registration_case_subjects_impl', '20260901110600_registration_subject_soft_archive.sql', '75d1bb204e1597a5a0e0d12cfc2765bd', 'sync_subjects'],
  ['update_registration_case_common_with_reminders_v1_impl', '20260901110500_registration_flat_common_input_decoupling.sql', '0b52417da5059cd844ccad8d2f19de71', null],
]
const transformed = new Map()
function sourceBody(name, file) {
  const source = readFileSync(join(root, 'supabase/migrations', file), 'utf8')
  const match = source.match(new RegExp(`create (?:or replace )?function dashboard_private\\.${name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'))
  assert.ok(match, name)
  return match[1]
}
function patchBody(name, body) {
  const start = sql.indexOf(`-- source-transform ${name}\n`)
  assert.notEqual(start, -1)
  const end = sql.indexOf('-- source-transform ', start + 20)
  const section = sql.slice(start, end === -1 ? sql.indexOf(') patches(signature', start) : end)
  const anchors = [...section.matchAll(/\$contact_anchor_(\d+)\$([\s\S]*?)\$contact_anchor_\1\$/g)]
  const replacements = new Map([...section.matchAll(/\$contact_replace_(\d+)\$([\s\S]*?)\$contact_replace_\1\$/g)].map(match => [match[1], match[2]]))
  assert.equal(anchors.length, replacements.size)
  assert.ok(anchors.length > 0)
  for (const [, id, anchor] of anchors) {
    assert.equal(body.split(anchor).length - 1, 1, `${name} exact sequential anchor ${id}`)
    body = body.replace(anchor, replacements.get(id))
  }
  return body
}
for (const [name, file, pin, scope] of specs) {
  test(`${name}: final source pin and all exact sequential transformations`, () => {
    const body = sourceBody(name, file)
    assert.equal(createHash('md5').update(body).digest('hex'), pin)
    assert.ok(sql.slice(0, sql.indexOf('alter table public.ops_registration_details')).includes(pin))
    const result = patchBody(name, body)
    transformed.set(name, result)
    if (scope) {
      assert.ok(result.indexOf('prepare_registration_contact_write_v1') < result.indexOf('pg_advisory_xact_lock'))
      if (result.includes('for update')) assert.ok(result.indexOf('prepare_registration_contact_write_v1') < result.indexOf('for update'))
      const insert = result.indexOf('  insert into dashboard_private.ops_registration_mutations(')
      assert.ok(insert > 0)
      const values = result.slice(insert)
      assert.match(values, /registration_contact_fingerprint_v1\(/)
      assert.doesNotMatch(values, /\n    v_(?:target_)?fingerprint,\n/)
      const freshGuard = result.indexOf(`perform dashboard_private.registration_contact_fingerprint_v1(`)
      const businessWrite = scope === 'save_inquiry' ? result.indexOf('v_subject_response :=')
        : result.search(/(?:insert into public\.|update public\.|for v_track in\s+update public\.)/)
      assert.ok(freshGuard >= 0 && freshGuard < businessWrite, 'capability before first business write')
      assert.match(result, /registration_contact_fingerprint_matches_v1/)
    } else assert.doesNotMatch(result, /update dashboard_private.ops_registration_mutations mutation/)
  })
}

test('new event representations are formed before INSERT and contain no raw typed phone or note body', () => {
  for (const name of ['create_registration_case_impl', 'update_registration_case_common_impl']) {
    const body = transformed.get(name)
    const events = body.slice(body.indexOf('  insert into public.ops_task_events('), body.indexOf('  v_response :=') > 0 ? body.indexOf('  v_response :=') : body.indexOf('  select pg_catalog.jsonb_build_object('))
    assert.match(events, /contact_metadata_only/)
    assert.doesNotMatch(events, /'(?:parentPhone|studentPhone|requestNote|studentName|schoolName)'\s*,/)
    assert.match(events, /parentContactPresent/)
    assert.match(events, /requestNotePresent/)
  }
})
test('atomic inquiry establishes subjects and generation before the fresh common contact write', () => {
  const body = transformed.get('save_registration_case_inquiry_v1_impl')
  const snapshotGuard = body.indexOf('v_current_subjects is distinct from v_expected_subjects')
  const sync = body.indexOf('v_subject_response :=')
  const refresh = body.indexOf("refresh_registration_contact_case_v1(p_task_id,'save_inquiry')")
  const common = body.indexOf('v_common_response :=')
  assert.ok(snapshotGuard < sync && sync < refresh && refresh < common)
  assert.match(sql, /parent_phone:=null;/)
  assert.match(sql, /source_task\.status='canceled' or snapshot->>'closureReason'='whole_case_cancelled' or planned_all_closed/)
})
test('legacy inquiry/status and common compatibility replay never rewrite the historical receipt', () => {
  for (const name of ['save_registration_case_inquiry_v1_impl', 'set_registration_workflow_status_v1_impl', 'update_registration_case_common_with_reminders_v1_impl']) {
    assert.doesNotMatch(transformed.get(name), /update dashboard_private.ops_registration_mutations mutation/)
  }
  const create = transformed.get('create_registration_case_impl')
  assert.match(create, /v_legacy_target_fingerprint/)
  for (const key of ['subjectPlans', 'levelTestAppointment', 'visitAppointment', 'directorOverrides']) assert.ok(create.includes(`- '${key}'`))
})
test('whole-case terminal predicate uses all current tracks and rejects empty vacuous closure', () => {
  const start = sql.indexOf('create function dashboard_private.registration_case_contact_snapshot_v1')
  const body = sql.slice(start, sql.indexOf('$$;', start))
  assert.match(body, /count\(\*\)>0 and coalesce\(pg_catalog\.bool_and/)
  assert.match(body, /registered','not_registered','inquiry_only/)
  assert.match(body, /track\.archived_at is null/)
  assert.match(body, /task\.status='canceled'/)
  assert.doesNotMatch(body, /pipeline_status/)
  assert.match(body, /not effective_closed and pg_catalog\.cardinality\(current_ids\)>0/)
})
test('parent/tracks/detail/UUID row ordering is explicit; row guards add no parent locks', () => {
  const start = sql.indexOf('create function dashboard_private.lock_registration_contact_case_v1')
  const body = sql.slice(start, sql.indexOf('$$;', start))
  assert.ok(body.indexOf('public.ops_tasks') < body.indexOf('public.ops_registration_subject_tracks'))
  assert.ok(body.indexOf('public.ops_registration_subject_tracks') < body.indexOf('public.ops_registration_details'))
  assert.match(body, /order by track.id for update/)
  for (const helper of ['guard_registration_contact_detail_write_v1', 'guard_registration_contact_track_write_v1', 'guard_registration_contact_task_cancel_v1']) {
    const begin = sql.indexOf(`create function dashboard_private.${helper}`)
    const guard = sql.slice(begin, sql.indexOf('$$;', begin))
    assert.doesNotMatch(guard, /for update|advisory_xact_lock|lock_registration_contact_case_v1/)
    assert.match(guard, /registration_contact_claims_v1/)
  }
})
test('direct detail movement/track terminal edits/parent cancellation require the trusted boundary', () => {
  assert.match(sql, /row\(new\.task_id,new\.parent_phone/)
  assert.match(sql, /registration_contact_case_identity_immutable/)
  assert.match(sql, /row\(new\.workflow_status,new\.archived_at,new\.task_id\)/)
  assert.match(sql, /guard_registration_contact_task_cancel_v1/)
  assert.match(sql, /claim\.command='close' and claim\.close_reason='whole_case_cancelled'/)
  assert.match(sql, /claim\.command='reopen' and claim\.parent_reopen_authorized/)
  assert.match(sql, /new\.status is distinct from projection->>'parentStatus'/)
})
test('server entry rejects forged caller/digests and restores all actor JWT settings on success and error', () => {
  const start = sql.indexOf('create function public.mutate_registration_contact_v1')
  const body = sql.slice(start, sql.indexOf('$$;', start))
  assert.match(body, /auth\.role\(\)\) is distinct from 'service_role'/)
  assert.match(body, /assert_registration_actor_is_active_manager_v1\(p_actor_id\)/)
  assert.match(body, /p_request_hmac !~ '\^\[0-9a-f\]\{64\}\$'/)
  assert.match(body, /p_payload-allowed_keys<>'\{\}'::jsonb/)
  for (const setting of ['request.jwt.claims', 'request.jwt.claim.sub', 'request.jwt.claim.role']) {
    assert.equal(body.split(`set_config('${setting}',coalesce`).length - 1, 2)
  }
  assert.ok(body.indexOf('select source.* into saved') < body.indexOf("snapshot->>'generation'<>expected_generation"))
  assert.doesNotMatch(body, /request\.jwt.*(?:user_metadata|app_metadata)/)
})
test('counter overflow has business SQLSTATE and reopens never recover the previous contact', () => {
  const start = sql.indexOf('create function dashboard_private.refresh_registration_contact_case_v1')
  const body = sql.slice(start, sql.indexOf('$$;', start))
  assert.match(body, /contact_revision=9223372036854775807/)
  assert.match(body, /next_generation=9223372036854775807/)
  assert.match(body, /registration_contact_generation_overflow' using errcode='23514'/)
  assert.match(body, /parent_phone=case when reopen_now or close_now or source\.contact_phase='closed' then null/)
  assert.match(body, /student_phone=null/)
  assert.doesNotMatch(sql, /using errcode\s*=\s*'40001'/i)
})
test('strict metadata receipts preserve IDs and business tracks without spreading raw nested snapshots', () => {
  const start = sql.indexOf('create function dashboard_private.registration_contact_result_v1')
  const body = sql.slice(start, sql.indexOf('$$;', start))
  assert.match(body, /'trackId',finalization->'trackId','studentId',finalization->'studentId','batchId',finalization->'batchId'/)
  assert.doesNotMatch(body, /build_object\('enrollmentFinalization',finalization\)/)
  assert.match(body, /select source\.\* into source_track/)
  assert.match(body, /'directorProfileId',source_track.director_profile_id/)
  assert.match(body, /'workflowStatus',source_track.workflow_status/)
  assert.match(body, /registration_case_contact_snapshot_v1\(p_task_id,false\)/)
})
test('binding is internal UUID only, preserves business arrays and has no automatic master creation', () => {
  const start = sql.indexOf("when 'bind_student' then\n          select")
  const end = sql.indexOf('      end case;', start)
  const body = sql.slice(start, end)
  assert.match(body, /registration_student_binding_immutable/)
  assert.match(body, /registration-student-id:/)
  assert.match(body, /public\.students student.*student\.id=/)
  assert.doesNotMatch(body, /parent_phone|student_phone|student\.(?:name|phone|contact|uid)|studNo|class_ids|waitlist_class_ids|insert into public.students/i)
})
test('close dispatch retirement is mandatory, future ACL grants withheld, no historical purge or key provisioning', () => {
  assert.match(sql, /registration_contact_dispatch_retirement_not_installed' using errcode='55000'/)
  assert.match(sql, /retire_registration_contact_dispatch_v1\(\$1,\$2\)/)
  assert.match(sql, /revoke all on function public\.mutate_registration_contact_v1.*from public,anon,authenticated,service_role/)
  assert.match(sql, /-- grant execute on function public\.mutate_registration_contact_v1.*to service_role/)
  assert.doesNotMatch(sql, /^grant execute.*mutate_registration_contact_v1/m)
  assert.doesNotMatch(sql, /(?:delete from|update) public\.dashboard_audit_logs/i)
  assert.doesNotMatch(sql, /gen_random_bytes|set_config\('.*(?:pepper|secret|password)|vault\.decrypted_secrets/i)
  assert.match(sql, /task_id uuid not null references public.ops_tasks\(id\) on delete cascade/)
  assert.match(sql, /and contact_closure_reason is not null/)
})
test('blank inquiry date and parent contact are valid; student contact cannot be collected', () => {
  assert.match(sql, /field in \('parentPhone','waitingKind','retakeDecision','inquiryAt'\)/)
  assert.match(sql, /registration_student_contact_collection_disabled/)
  const keys = sql.slice(sql.indexOf('allowed_keys:=case p_command'), sql.indexOf('required_keys:='))
  assert.doesNotMatch(keys, /studentPhone|student_phone/)
})
test('omitted contact on a facts-only edit preserves open contact, while explicit null/closed cannot rehydrate', () => {
  assert.match(sql, /p_command='update_common' and not \(p_payload \? 'parentPhone'\) and snapshot->>'phase'='open'/)
  assert.match(sql, /select detail\.parent_phone into parent_phone/)
  assert.match(sql, /elsif not legacy and snapshot->>'phase'='closed' then parent_phone:=null/)
})
test('registration cannot change type to bypass the guarded whole-case cancel transition', () => {
  const start = sql.indexOf('create function dashboard_private.guard_registration_contact_task_cancel_v1')
  const body = sql.slice(start, sql.indexOf('$$;', start))
  assert.ok(body.indexOf('new.type is distinct from old.type') < body.indexOf("(old.status='canceled')=(new.status='canceled')"))
  assert.match(body, /registration_contact_case_type_immutable' using errcode='23514'/)
})
test('owner policy B: manual workflow recording cannot reopen a canceled parent or contact generation', () => {
  const start = sql.indexOf("when 'set_workflow_status' then\n          --")
  const body = sql.slice(start, sql.indexOf("when 'waiting_details' then result", start))
  assert.match(body, /set_registration_workflow_status_v1_impl/)
  assert.doesNotMatch(body, /update public\.ops_tasks|parent_reopen_authorized=true|legacy_parent_projection/u)
  const reopen = sql.slice(sql.indexOf("when 'reopen' then\n          if source_track"), sql.indexOf("when 'close' then\n          if p_payload"))
  assert.match(reopen, /inherited_status not in \('requested','in_progress'\)/)
  assert.match(reopen, /registration_contact_business_reopen_required' using errcode='23514'/)
  assert.match(reopen, /set status=inherited_status/)
  assert.match(reopen, /parent_reopen_authorized=true/)
  assert.doesNotMatch(reopen, /set status='requested'/)
  assert.match(sql, /not exists\(select 1 from public\.ops_tasks task where task\.id=p_task_id and task\.status='canceled'\)/)
})
test('source contract: terminal subject reopening in an already-open whole case preserves generation/contact', () => {
  const driverStart = sql.indexOf("when 'reopen' then\n          if source_track")
  const driver = sql.slice(driverStart, sql.indexOf("when 'close' then", driverStart))
  assert.match(driver, /source_track\.archived_at is not null or source_task\.status<>'canceled' and snapshot->>'closureReason' is distinct from 'whole_case_cancelled'\s+and source_track\.workflow_status not in \('registered','not_registered','inquiry_only'\)/)
  assert.match(driver, /'inquiry' then 'inquiry' else 'consultation_requested'/)
  assert.match(driver, /set_registration_workflow_status_v1_impl\(source_track\.id,next_status,source_track\.workflow_revision,p_request_key\)/)
  const refreshStart = sql.indexOf('create function dashboard_private.refresh_registration_contact_case_v1')
  const refresh = sql.slice(refreshStart, sql.indexOf('$$;', refreshStart))
  assert.match(refresh, /if claim\.command='reopen' and claim\.before_phase='closed' and not reopen_now then/)
  assert.doesNotMatch(refresh, /if claim\.command='reopen' and not reopen_now then/)
  assert.match(refresh, /reopen_now:=claim\.before_phase='closed'/)
  assert.match(refresh, /if reopen_now then[\s\S]*next_generation:=next_generation\+1;\s*end if;/)
  assert.match(refresh, /parent_phone=case when reopen_now or close_now or source\.contact_phase='closed' then null else source\.parent_phone end/)
  assert.match(refresh, /contact_revision=case when claim\.command='create' then source\.contact_revision else source\.contact_revision\+1 end/)
})
