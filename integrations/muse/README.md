# TIPS ↔ Muse integration v1 / v2

## Supported work

`/api/v1` supports scoped class reads, school calendar metadata reads, and changing the start/end of **one existing weekly schedule slot**. Existing dated lessons, holiday/makeup sessions, teaching content, student/enrollment/payment records, external systems and outgoing messages are not changed. Do not translate a dated cancellation/makeup request into this weekly-template operation.

The maintained machine contract is `GET /api/v1/openapi`. All protected responses use `{data,error}`, `Cache-Control: no-store`, and `Authorization: Bearer <opaque credential>`. No browser session export, service-role key sharing, arbitrary SQL, or generic table PATCH is supported.

## Release and connection sequence

1. Review the migrations `20260929110109_agent_api_scoped_schedule.sql` and `20260929113744_agent_api_audit_history_decoupling.sql`, `20260929130122_agent_api_class_changes.sql`, and `20260929132914_agent_legacy_dated_override.sql` and PR checks. Apply through the maintained migration pipeline. Verify the final gateway function ACL and isolated pgTAP suite. The code is fail-closed unless the server environment has `TIPS_AGENT_API_ENABLED=true`.
2. Deploy the application with that flag **unset**. `GET /api/v1/openapi` must return the schema; `GET /api/v1/health` must return 503 `agent_api_disabled`. The settings page shows that integration is disabled and cannot issue a key.
3. For first authentication verification, use a separate Supabase/preview environment containing synthetic data only. Enable the flag there, with its own server-only `SUPABASE_SERVICE_ROLE_KEY` and public Supabase configuration. Never connect a synthetic test to production. A deployed app without the new migration is not ready.
4. The administrator opens **환경 설정 → AI 연결**, selects one synthetic class, `조회만`, and `1일`, and issues a key. Copy the one-time masked value directly into Muse's hosted secure credential page. Do not paste the key into chat, source code, command history, a screenshot or a document. After an uncertain issuance response, refresh the list and revoke the newly created entry before issuing again.
5. Muse requests a connector with `provider=tips-admin-api-test`, `api_hosts=[exact-preview-host]`, `auth_scheme=api_key`, `placement=bearer_header`. The human completes secure key entry. Test and production connectors must have separate names/hosts/credentials; do not broaden the test connector to production.
6. Muse runs authenticated `health` and class read using the official surrogate helper. Confirm the actual response's scope, class IDs and expiry. Also verify unauthenticated 401, denied class access, and immediate key revocation. This is the outstanding Vault → Sentinel → HTTPS authentication gate; local handler/DB tests do not establish it.
7. Before writes, issue a separate synthetic-class write grant and run preview → commit → receipt readback → exact replay. Verify no second operation and no external messages. Only after these gates should an administrator enable production and grant the chosen production classes/work types/expiry.

To stop access, revoke the credential in settings. Revocation and issuer role downgrade, suspension or soft deletion are checked on every request. Unset the feature flag and redeploy to disable the entire gateway. Keep tables and receipts; do not roll back history to disable access.

## Muse runtime contract

The following runtime capabilities were reported directly by Muse on 2026-09-29 after inspecting its installed official documentation; the Vault injection has not yet been exercised with this API:

- `credentials.request_api_access` creates the secure human entry flow. The `placement` cannot be corrected in place.
- `/opt/hatch/skills/skill-creator/bin/scaffold-connector-skill --provider <provider>` generates the connector's auth instructions after connection.
- Python `add_surrogate_to_request(request, credential_name, allowed_hosts=[...])` injects an `hsurr:*` surrogate. The actual key is substituted by Sentinel; never read or export it.
- Use HTTPS, fixed connector hosts and a no-redirect urllib opener. Do not derive a new trusted host from arbitrary CLI input. Host restrictions are not API path restrictions; the server enforces scopes/actions.
- Muse prepared `~/workspace/skills/tips-admin-api/SKILL.md` and `bin/tips-admin` in its workspace. The reviewed source is now [pinned here](client/README.md), with archive/source hashes and 59 v1 tests, 39 v2 checks, and 10 independent contract tests reproduced locally. The temporary v1 suite was reconstructed from the contract, not recovered byte-for-byte. Socket/DNS/subprocess attempts are blocked in the offline runner; this does not establish real credential injection.

Conversation: https://muse.ai/thread/35b3ea22-938e-4c5e-be65-e1b77a457ac3

## v2 class editing

`GET /api/v2/openapi` is the maintained request/response contract. Class UUID search remains explicitly at `/api/v1/classes`; the v2 base must not silently fall back to browser writes or another API version.

| Scope | Work |
|---|---|
| `class-details:read` | Safe basic/weekly/dated workspace, catalog IDs, credential-local operation recovery |
| `class-info:write` | Name, class type, subject/subject area, grade, capacity, fee |
| `weekly-plan:write` | Weekday, time, teacher and room of existing weekly slots |
| `lesson-plan:write` | Bounded future dated lessons, exclusions, cancellations and one linked makeup per original lesson |

New grants also require `classes:read` and explicit class IDs. Existing v1 credentials are unchanged. Settings default to read only, one day, and no selected write scopes. The weekly checkbox additionally enables the compatible v1 weekly-time scopes.

1. Read `/api/v2/health`, then `/classes/{id}?from=YYYY-MM-DD&to=YYYY-MM-DD` (date difference ≤93). Read exact teacher/room IDs from `/classes/{id}/catalogs?kind=teachers|classrooms&search=...&page=1` (20 per page). Subject compatibility is checked by the final domain resolver at preview/commit.
2. POST `/classes/{id}/changes/preview` with `expectedVersion`, `window`, `reason`, and at least one of `basic`, `weeklySlots`, or `lessons`. Input allows only declared fields; no raw schedule-plan PATCH is exposed. Up to 14 existing weekly slot edits and 50 dated edits can be combined atomically for one class. Times are integer minutes; full timing includes teacher/room UUIDs.
3. A dated item is `{date,lessonId?,state,timing?,makeup?}`. State is `scheduled|cancelled|skipped|undecided`. `makeup` is null or `{date,startMinute,endMinute,teacherId,classroomId}` and is allowed only with `cancelled`. Omitting it preserves an existing linked makeup while keeping a cancellation; null clears it. Removing a makeup retains its historical row as skipped. A makeup is edited through its original lesson. Both original and target dates must be today or later and inside the window, including an existing makeup being replaced.
4. Preview returns `before`/`after` workspaces plus ten-minute `previewToken`/`expiresAt`. Journal the preview's class ID and `after.verificationHash` under origin + API version + credential ID. POST `/operations` uses the v1 request-key protocol. Applied receipt `class.id` and `class.verificationHash` must match the preview, as must `operationId`. Missing expectations or any mismatch are unconfirmed. Versions and timestamps are excluded from the verification hash.
5. Recover with GET `/operations/{key}`; use GET `/operations?page=1` to discover credential-local history (20 per page). List entries are discovery only; fetch the exact receipt before deciding completion. Unknown/timeout and a write HTTP 5xx or malformed response without a valid durable receipt are unconfirmed, even if the server may already have committed. They must not create a new key, preview or browser write. Recover with the same request key; only a valid failed receipt confirms a failed business operation. Cache refresh and external-send states follow the v1 rules below.

Important semantics:

- Weekly edits apply to the template immediately. They neither defer until a future date nor rewrite existing materialized lessons. For “from October,” resolve a concrete end date and enumerate the bounded dated edits. Do not substitute a weekly change silently.
- A legacy class must already have billing periods for dated edits. Missing periods return `agent_missing_billing_period`; the API does not invent a term. Multiple normalized lessons on a date require exact `lessonId`. Legacy overrides are date-keyed, so a legacy date with multiple lessons is always rejected, even with an ID; editing one would otherwise change them all. A lesson-number request without an unambiguous date needs clarification.
- Normalized storage represents cancellation as `skipped`; legacy uses `exception` internally. The workspace returns the canonical resulting state. Existing learning content, notes, textbooks, student/enrollment/payment history, and unrelated periods/rows stay intact.
- One cancellation links to one makeup. Merging several originals into one makeup or targeting an occupied date is unsupported. Existing weekly slot creation/deletion, class closure, past-history corrections, and approval transitions are not supported.
- Pending makeup approvals, or completed approval-owned dates in the window, return `agent_approval_workflow_required`. Use the existing approval workflow with appropriate authority; never bypass it via a direct edit or browser.
- Server-only compiler contexts contain the plan required for preservation, but HTTP responses use allowlisted projections and never expose raw plans/private notes. v2 previews/receipts are separate private tables so v1 cannot expose those contexts. The DB rechecks scopes from the compiled fields, not a caller-provided scope list. Edited catalog resources are revalidated at execution, including legacy plans. Unique explicit regular legacy lessons replace the corresponding single weekly occurrence; forced/makeup/ambiguous rows do not gain this inference. The existing final resource-conflict guard remains active.

The [pinned client](client/README.md) covers the five synthetic request patterns, failure receipts without class data, malformed responses, same-key recovery, origin isolation and damaged journals. Its 59 v1 tests + 39 v2 checks + 10 independent regressions pass locally and run in CI. Actual Vault/Sentinel/HTTPS transport still requires the separate synthetic-environment connection gate.

## v1 execution protocol

1. Read health and search classes. Resolve an exact UUID; ask if ambiguous. Read the selected class and its exact `weeklySlots[].id` and `version`. An incomplete schedule is not editable.
2. POST `/classes/{classId}/weekly-time/preview` with `{expectedVersion,slotId,startMinute,endMinute,reason}`. Minutes are from midnight in Asia/Seoul; weekday uses Sunday=0. The version is a SHA256 fingerprint, not a numeric counter.
3. Check the returned `before`, `after`, `effect=weekly_template_only`, and ten-minute expiry against the person's actual request. A preview itself is not human authorization. Work within the original approved scope; stop for ambiguity or scope changes.
4. Before POST `/operations`, persist a UUID request key and the exact `{previewToken,sourceReference?}` in a local 0600 journal under an exclusive lock, flush and fsync. `sourceReference` should be a message URL/opaque reference, never a private message body or claimed authenticated identity. Journal records must be namespaced by API origin, API version, and credential ID to avoid cross-environment receipt lookups.
5. Send the same UUID in `Idempotency-Key`. `data.operationId` is that UUID; the changed class ID is **`data.class.id`**, not a top-level `classId`. Persisted success is `data.state=applied`. Persist the preview expectation, then compare operation ID, exact class ID and all weekly slots by weekday/startMinute/endMinute/teacherId/classroomId against `preview.after`. Ignore slot IDs, versions and timestamps in this semantic comparison: legacy slot IDs change with their time string. Missing expectations or mismatches are unconfirmed, never automatic success. A later ordinary GET may differ because someone else edited afterward; the durable receipt is the original operation outcome.
6. On lost response, a reused preview, or a prior journal record, GET `/operations/{requestKey}` first. `unknown` means no durable receipt is visible, not that the write failed. Do not issue a new key, a new preview, or a browser write to retry an uncertain operation. An exact explicit replay may only use the same credential/key/body after resolution; never automatically branch the key lineage.
7. HTTP 403/409 are not permission to bypass the API. Keep the entire non-2xx receipt: a failed commit may return HTTP 409/422/503 with `data.state=failed` and `data.error`. GET receipt returns 200 even when the stored operation failed. 429 includes `Retry-After: 60`.
8. Report `notifications`, `externalSync` and `reply` separately; all are `not_requested` in this API. No “completed in Google Chat/Makeedu” claim follows from a dashboard receipt.

An applied commit, replay or receipt lookup also tries the existing public-class cache invalidation. Its optional `publicCache.state` is `invalidated` or `pending` for that HTTP attempt, separate from the durable business result. `pending` does not undo the saved schedule and must never trigger a new business request. A later receipt GET can retry this cache effect. `invalidated` means the cache invalidation calls completed; it does not establish that a public browser has already displayed fresh content.

The credential issuer is the authenticated actor for the existing domain writers. `executor` labels the delegated integration; the API always reports `requesterVerified=false`. A chat link is not authentication. This release does not implement per-chat-sender authorization or automatic message ingestion.

## Database design and limits

Raw tokens are returned once and only SHA256 digests are stored. Private tables have RLS and no client table grants. The service-role-only gateway receives a digest, rechecks the explicit admin profile and current account status, then derives transaction-local actor claims from the credential issuer. Inputs cannot select an actor.

Write/preview grants require explicit class IDs (max 50), classes:read, and write also requires preview. Keys expire within 30 days; max 20 active keys per issuer; valid requests are limited to 60 per minute per key. Class lists are paged at 20; credential settings at 10/15/20. Calendar windows are bounded to 31 days difference.

Preview executes the final existing writer inside a deliberately rolled-back subtransaction, preserving only the preview record. Commit rechecks the schedule fingerprint and resource conflicts under the existing timetable lock, and atomically persists the operation receipt. Same key/body replays the receipt; another key cannot consume the same preview. Existing `23P01` domain conflict evidence is preserved; no domain condition is relabeled as a serialization `40001`.

Audit actor/class IDs are retained as snapshots without foreign keys into operational classes/profiles, so existing deletion flows remain possible while receipts survive. Authority and target existence are rechecked at execution. Preview/receipt retention is presently indefinite for audit/recovery. No background deletion or automatic rotation is introduced. Failed preconditions before a receipt exists (invalid key/scope/token) return a typed error; a transport timeout always requires status resolution.

## Reproduce verification

```sh
python3 integrations/muse/client/tests/run_offline.py
node --test --experimental-strip-types tests/agent-api-http.test.mjs tests/agent-class-edit.test.mjs
node scripts/run-isolated-supabase-db-tests.mjs --review-head --execute --authorized \
  --request-id agent-api-local-review \
  --test supabase/tests/agent_api_scoped_schedule_test.sql \
  --test supabase/tests/agent_api_class_changes_test.sql \
  --probe tests/probe-agent-class-edit-dto.mjs \
  --test supabase/tests/timetable_operational_conflicts_test.sql
```

For UI only, `scripts/qa/agent-access-fixture-server.mjs` binds loopback ports 3260/3262. Run Next with `--webpack` on 3261 with the synthetic public URL/key and enabled flag stated in that file, then open `http://127.0.0.1:3260/__fixture`. It returns a fake key with no authority, blocks unmocked API calls, and never forwards to production. This verifies presentation and RPC payloads, not live authentication.
