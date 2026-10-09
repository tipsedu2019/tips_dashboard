import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import { one, readFinalContactBundleSources } from "./helpers/registration-contact-bundle-final-source.mjs"

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const lifecycle = read("docs/security/sql/registration-contact-lifecycle-integration-draft.sql")
const fence = read("docs/security/sql/registration-contact-message-fence-draft.sql")
const hash = value => createHash("sha256").update(value).digest("hex")
const body = (source, name) => source.match(new RegExp(`create(?: or replace)? function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`, "iu"))?.[1]
const finalSources = readFinalContactBundleSources()
const boundedPatch = fence.slice(fence.indexOf("do $bounded_bundle_sources$"), fence.indexOf("end $bounded_bundle_sources$;") + "end $bounded_bundle_sources$;".length)
const matches = [...boundedPatch.matchAll(/\('([^']+)','([a-f0-9]{64})',\s*array\[([\s\S]*?)\],\s*array\[([\s\S]*?)\]\)/gu)]
const patched = new Map()
for (const match of matches) {
  const name = match[1].slice(0, match[1].indexOf("("))
  const original = finalSources.get(name)
  assert.ok(original, name)
  assert.equal(hash(original), match[2], `reviewed ordered source pin ${name}`)
  const anchors = [...match[3].matchAll(/\$bundle_anchor_(\d+)\$([\s\S]*?)\$bundle_anchor_\1\$/gu)]
  const replacements = [...match[4].matchAll(/\$bundle_replace_(\d+)\$([\s\S]*?)\$bundle_replace_\1\$/gu)]
  assert.deepEqual(anchors.map(item => item[1]), replacements.map(item => item[1]))
  let candidate = original
  anchors.forEach((item, index) => { candidate = one(candidate, item[2], replacements[index][2]) })
  patched.set(name, candidate)
}

test("source proof: three final ordered bundle bodies accept all fourteen exact sequential anchors", () => {
  assert.equal(matches.length, 3)
  assert.equal([...boundedPatch.matchAll(/\$bundle_anchor_(\d+)\$/gu)].length / 2, 14)
  assert.equal(patched.size, 3)
  assert.throws(() => one("missing", "required", "replacement"), /exact sequential source anchor/u)
  assert.throws(() => one("required required", "required", "replacement"), /exact sequential source anchor/u)
  assert.match(boundedPatch, /source_drift' using errcode='55000'/u)
  assert.match(boundedPatch, /anchor_drift' using errcode='55000'/u)
})
test("source proof: aggregate receives at most four candidates, and four is rejected rather than truncated to three", () => {
  const collector = patched.get("dashboard_private.collect_registration_customer_message_bundle_items_v1")
  assert.match(collector, /ordered as \([\s\S]*?source_id limit 4\s*\)[\s\S]*?jsonb_agg/u)
  assert.match(collector, /v_count > 3[\s\S]*?source_ineligible' using errcode = '22023'/u)
  assert.doesNotMatch(collector, /limit 3|jsonb_array_elements\(v_items\).*limit/iu)
  assert.ok(collector.indexOf("v_count > 3") < collector.indexOf("assert_registration_contact_bundle_candidate_v1"))
})
test("source proof: actual level-test and observation candidates exclude terminal/archive/wrong-case facts", () => {
  const collector = patched.get("dashboard_private.collect_registration_customer_message_bundle_items_v1")
  assert.match(collector, /and level_test.status = 'scheduled'[\s\S]*?and track.workflow_status not in \('registered','not_registered','inquiry_only'\)/u)
  assert.match(collector, /observation.task_id = p_task_id[\s\S]*?appointment.task_id=p_task_id[\s\S]*?appointment.kind='observation_class'[\s\S]*?appointment.status='scheduled'[\s\S]*?track.workflow_status='observation_requested' and observation.subject=track.subject/u)
  assert.equal(collector.match(/track\.task_id = p_task_id/gu).length, 3)
  assert.equal(collector.match(/track\.archived_at is null/gu).length, 3)
})
test("source proof: protected candidate recheck follows parent/tracks/detail before appointment/activity/observation SHARE locks", () => {
  const helper = body(fence, "dashboard_private.assert_registration_contact_bundle_candidate_v1")
  assert.ok(helper.indexOf("assert_registration_contact_open_v1") < helper.indexOf("for share"))
  assert.match(helper, /track.id=\(item->>'trackId'\)::uuid and track.task_id=p_task_id and track.archived_at is null/u)
  assert.match(helper, /appointment.id=\(item->>'sourceId'\)::uuid and appointment.task_id=p_task_id/u)
  assert.match(helper, /observation.id=\(item->>'sourceId'\)::uuid and observation.task_id=p_task_id and observation.track_id=/u)
  assert.match(helper, /item->'sourceRevision'=pg_catalog.jsonb_build_object/u)
  assert.match(helper, /observation.appointment_id=any\(appointment_ids\)/u, "rechecked observation must reference an appointment already SHARE-locked")
  assert.doesNotMatch(helper, /for update.*(?:bundle|message|job)/iu)
})
test("source contract regression: shared level-test appointment on distinct subject tracks is not a duplicate source", () => {
  const collector = patched.get("dashboard_private.collect_registration_customer_message_bundle_items_v1")
  const helper = body(fence, "dashboard_private.assert_registration_contact_bundle_candidate_v1")
  assert.match(collector, /'sourceId', source_id/u)
  assert.match(collector, /appointment\.id as source_id/u)
  assert.match(collector, /level_test\.id as activity_id/u)
  assert.match(helper, /count\(distinct \(value->>'sourceKind',\(value->>'sourceId'\)::uuid,\(value->>'trackId'\)::uuid\)\)/u)
  assert.doesNotMatch(helper, /count\(distinct \(value->>'sourceId'\)::uuid\)/u)
  const appointment = "00000000-0000-0000-0000-000000000101"
  const items = [
    { subject: "영어", sourceKind: "level_test", sourceId: appointment, trackId: "00000000-0000-0000-0000-000000000201" },
    { subject: "수학", sourceKind: "level_test", sourceId: appointment, trackId: "00000000-0000-0000-0000-000000000202" },
  ]
  assert.equal(new Set(items.map(item => item.sourceId)).size, 1)
  assert.equal(new Set(items.map(item => `${item.sourceKind}:${item.sourceId}:${item.trackId}`)).size, 2)
  assert.equal(new Set([...items, items[0]].map(item => `${item.sourceKind}:${item.sourceId}:${item.trackId}`)).size, 2)
})
test("source proof: cached and new bundles both revalidate identical captured-time candidates without rewriting historical snapshots", () => {
  const materializer = patched.get("dashboard_private.materialize_registration_customer_message_bundle_v1")
  const stored = body(fence, "dashboard_private.assert_registration_contact_stored_bundle_v1")
  assert.equal(materializer.match(/assert_registration_contact_stored_bundle_v1/gu).length, 2)
  assert.ok(materializer.indexOf("assert_registration_contact_open_v1") < materializer.indexOf("pg_advisory_xact_lock"), "case locks precede bundle advisory on direct owner-only materializer too")
  assert.ok(materializer.indexOf("order by track.id") < materializer.indexOf("v_rechecked_items:="))
  assert.match(materializer, /v_rechecked_items is distinct from v_items[\s\S]*?23514/u)
  assert.match(stored, /source.bundle_id=p_bundle_id order by source.sort_order limit 4/u)
  assert.match(stored, /current_items is distinct from items/u)
  assert.match(stored, /bundle.contact_generation::text is distinct from state->>'generation'/u)
  assert.doesNotMatch(stored, /update |insert |delete /iu)
})
test("source proof: canonical bundle probe replaces ANY track heuristic; future dispatch remains inactive", () => {
  const helper = body(fence, "dashboard_private.registration_contact_message_fence_v1")
  assert.match(helper, /collect_registration_customer_message_bundle_items_v1/u)
  assert.doesNotMatch(helper, /source_open := exists\(select 1 from public.ops_registration_subject_tracks/u)
  assert.match(helper, /exception when sqlstate '22023' or sqlstate '23514' then source_open:=false/u)
  assert.match(fence, /return null; end;'/u)
  assert.doesNotMatch(fence, /create(?: or replace)? function public\.claim_registration_customer_reminder_job_v1/iu)
  assert.match(fence, /p_reservation_kind not in \('level_test','observation'\)/u)
})
test("source proof: readonly metadata and all public source wrappers reject NULL service role before work", () => {
  for (const name of ["dashboard_private.registration_contact_message_fence_v1", "public.read_registration_contact_message_fence_v1",
    "public.read_registration_contact_bundle_preview_v1", "public.mark_registration_customer_message_attempt_started_v1"]) {
    assert.match(body(fence, name), /auth.role\(\)\) is distinct from 'service_role'/u, name)
  }
  assert.match(body(lifecycle, "public.mutate_registration_contact_v1"), /auth.role\(\)\) is distinct from 'service_role'/u)
})
test("source proof: complete fresh receipt validated before INSERT and exact replay revalidated before returning unchanged metadata", () => {
  const mutation = body(lifecycle, "public.mutate_registration_contact_v1")
  const save = mutation.indexOf("insert into dashboard_private.registration_contact_receipts_v1")
  const check = mutation.indexOf("registration_contact_assert_receipt_v1(response,task_id")
  assert.ok(check >= 0 && check < save)
  assert.match(mutation, /response:=saved.response_payload[\s\S]*?registration_contact_assert_receipt_v1\(response,saved.task_id/u)
  assert.doesNotMatch(mutation, /update dashboard_private.registration_contact_receipts_v1/u)
})
test("source proof: JSON response budgets cap UTF8 bytes/depth/strings and UUID arrays before expansion; no business-size claim or truncation", () => {
  const budget = body(lifecycle, "dashboard_private.registration_contact_assert_bounded_json_v1")
  const array = body(lifecycle, "dashboard_private.registration_contact_assert_uuid_array_v1")
  const projector = body(lifecycle, "dashboard_private.registration_contact_result_v1")
  assert.match(budget, /octet_length\(pg_catalog.convert_to\(p_value::text,'UTF8'\)\)>128000/u)
  assert.match(budget, /depth>8[\s\S]*?length\(value#>>'\{\}'\)>500/u)
  assert.ok(array.indexOf("jsonb_array_length(p_value)>p_max") < array.indexOf("jsonb_array_elements(p_value)"))
  assert.match(array, /count\(distinct value::uuid\)/u)
  assert.match(projector, /assert_uuid_array_v1\(finalization->'enrollmentIds',50\)/u)
  assert.match(projector, /assert_uuid_array_v1\(p_result->'sourceEventIds',50\)/u)
  assert.match(projector, /jsonb_array_length\(p_result->'tracks'\)>50/u)
  assert.match(lifecycle, /RPC response budgets, not roster\/admission business quotas/u)
  assert.doesNotMatch(body(lifecycle, "dashboard_private.registration_contact_assert_receipt_v1"), /limit |slice|jsonb_set/iu)
})
test("source proof: final metadata is scope bound, unique, phone-free and historical observation phases remain valid display states", () => {
  const receipt = body(lifecycle, "dashboard_private.registration_contact_assert_receipt_v1")
  assert.match(receipt, /event.id=item.value::uuid and event.task_id=p_task_id/u)
  assert.match(receipt, /enrollment.track_id=\(finalization->>'trackId'\)::uuid/u)
  assert.match(receipt, /state->'parentPhone' is distinct from 'null'::jsonb/u)
  assert.match(receipt, /assert_uuid_array_v1\(state->'currentTrackIds',3\)/u)
  assert.match(receipt, /count\(distinct value->>'subject'\)/u)
  assert.match(receipt, /observation_feedback_pending','observation_completed/u)
  assert.match(receipt, /required_keys:=case p_command/u)
  assert.match(receipt, /required_keys is null or not result \?& required_keys/u)
  assert.match(receipt, /closureReason'='last_current_track_excluded' and state->'closedAt'='null'::jsonb/u)
  assert.match(receipt, /directorAssignmentRuleKey' !~ '\^\[a-zA-Z0-9_:.-\]\{0,200\}\$'/u)
  assert.match(receipt, /jsonb_typeof\(item->'migrationReviewRequired'\) is distinct from 'boolean'/u)
})
test("source proof: twelve-key preview strips raw recipient only inside DB; thirteen-key future transport remains separate", () => {
  const preview = body(fence, "public.read_registration_contact_bundle_preview_v1")
  const resolver = body(fence, "public.resolve_registration_customer_message_bundle_source_v1")
  assert.match(preview, /resolve_registration_customer_message_bundle_source_v1\(p_message_kind,p_task_id,p_service_date\)-'parentPhoneDigits'/u)
  assert.ok(preview.indexOf("-'parentPhoneDigits'") < preview.indexOf("registration_contact_assert_bounded_json_v1"))
  assert.match(resolver, /'parentPhoneDigits','items'/u)
  assert.match(fence, /revoke all on function public.read_registration_contact_bundle_preview_v1\(text,uuid,date\) from public,anon,authenticated,service_role/u)
  assert.doesNotMatch(fence, /^grant /mu)
})
test("source proof: exact patching retains target OID/ACL/SECDEF/volatility and assigns only business error states", () => {
  for (const field of ["oid","proowner","proacl","proconfig","prosecdef","provolatile","proisstrict","proleakproof","prorettype","prolang","proretset","proparallel","procost","prorows","prosupport"]) {
    assert.ok(boundedPatch.includes(`after_proc.${field} is distinct from prior.${field}`), field)
  }
  assert.doesNotMatch(boundedPatch, /40001|grant |revoke |update public\.|delete from public\./iu)
  assert.doesNotMatch(lifecycle, /using errcode\s*=\s*'40001'/u)
})
