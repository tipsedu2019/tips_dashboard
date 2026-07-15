# Notification Workflow Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect tasks, word retests, registration, transfer, withdrawal, makeup requests, and approvals to the common notification control plane with atomic producers, preserved legacy intent, seven settings entry points, and duplicate-safe cutovers.

**Architecture:** The common plan lands first and owns canonical storage, settings RPCs, orchestration, the worker, and `NotificationWorkflowAdapter`. This plan adds fixed-purpose domain producers that commit the business mutation, immutable source event, canonical event, and unique fan-out job together; implements six non-registration adapters plus the registry; consumes the registration adapter from the appointments/reminders plan; and keeps legacy senders behind shared dispatch ownership until each flag changes owner. Browsers send domain commands or stable source IDs only.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Supabase/PostgreSQL PL/pgSQL and pgTAP, Node.js test runner, existing Google Chat/Web Push/SOLAPI adapters.

## Global Constraints

- Execution order: common control plane, registration appointments/reminders, then this plan.
- Measured baseline: `node --test tests/*.test.mjs` passes 1011 tests with 0 failures.
- Do not edit applied migrations; add only the migrations named below.
- At cutover, domain mutation, immutable source event, canonical event, and fan-out job commit in one transaction.
- No generic browser event endpoint. Only fixed-purpose domain RPCs/triggers call private helpers.
- `ops_tasks.type = general` belongs only to `tasks`; all other task types have exclusive workflow owners.
- UUID event sources use `source_revision = null`; do not invent revisions.
- Closed source types are `ops_task_event`, `ops_task_comment`, `registration_track_event`, `registration_appointment`, `registration_message_command`, `makeup_request_event`, `approval_event`, and `approval_comment`; their immutable source ID is also the immediate occurrence key unless the approved registration revision/request-key formula applies.
- Tasks, word retests, and approvals start with every rule disabled.
- Generic registration core, transfer, and withdrawal import only submitted/completed management-team Google Chat intent. Registration phone-ready and visit-immediate compatibility cells are the separately approved exception: their rules are enabled in the registry but remain legacy-owned and produce no canonical side effect until the corresponding specialized ownership flag transfers. Processing and phantom applicant/operations cells stay off or absent.
- Makeup imports persisted settings, templates, and retained history exactly; missing rows are not inferred from component defaults.
- Shadow ends as `skipped/shadow_mode`, calls no provider, creates no inbox projection, and is never replayed.
- A dispatch flag and its legacy side effect change owner in the same release.
- Registration scheduling/reminder algorithms are out of scope; consume their canonical occurrence/revision and adapter.
- Retain legacy notification/settings/provider-state tables through rollback and 14 canonical-only days.
- All twelve flags are the common plan's server-authoritative database rows. This plan never introduces env/build-time mirrors, and provider/inbox ownership RPCs re-check the relevant row at side-effect time.
- RPC/HTTP wire data is snake_case; common service/adapters map once to camelCase, while every SQL bigint revision, target generation, and owner generation remains a decimal string in TypeScript.

The twelve rollout flags are exact and default false:

```text
notification_control_plane_settings_ui_enabled
notification_control_plane_shadow_write_enabled
notification_control_plane_dispatch_tasks_enabled
notification_control_plane_dispatch_word_retests_enabled
notification_control_plane_dispatch_registration_enabled
notification_control_plane_registration_phone_adapter_enabled
notification_control_plane_registration_visit_adapter_enabled
notification_control_plane_registration_solapi_adapter_enabled
notification_control_plane_dispatch_transfer_enabled
notification_control_plane_dispatch_withdrawal_enabled
notification_control_plane_dispatch_makeup_requests_enabled
notification_control_plane_dispatch_approvals_enabled
```

## Consumed Common Interfaces

```sql
public.common_notification_control_plane_runtime_version() returns integer
public.get_notification_runtime_flags_v1() returns jsonb
public.set_notification_runtime_flag_v1(p_flag_key text, p_enabled boolean, p_expected_revision bigint, p_request_id uuid) returns jsonb
public.get_notification_orchestration_job_status_v1(p_job_kind text, p_job_id uuid) returns jsonb
public.retry_notification_orchestration_job_v1(p_job_kind text, p_job_id uuid, p_expected_attempt_count integer, p_request_id uuid) returns jsonb
public.get_notification_control_plane_v1(p_workflow_key text) returns jsonb
public.save_notification_control_plane_v1(
  p_workflow_key text,
  p_expected_revisions jsonb,
  p_patch jsonb,
  p_request_id uuid
) returns jsonb

dashboard_private.record_notification_event_v1(
  p_scope_key text,
  p_workflow_key text,
  p_event_key text,
  p_source_type text,
  p_source_id text,
  p_source_revision bigint,
  p_occurrence_key text,
  p_actor_profile_id uuid,
  p_occurred_at timestamptz,
  p_payload_schema_version integer,
  p_payload jsonb,
  p_materialized_rule_id uuid default null,
  p_materialized_rule_revision bigint default null
) returns jsonb

dashboard_private.enqueue_notification_target_reconciliation_job_v1(
  p_workflow_key text,
  p_source_type text,
  p_source_id text,
  p_source_revision bigint,
  p_source_event_id uuid,
  p_reconciliation_kind text,
  p_target_generation bigint,
  p_previous_target_set_hash text,
  p_current_target_set_hash text
) returns uuid

public.commit_notification_in_app_delivery_v1(p_delivery_id uuid, p_claim_token uuid) returns jsonb
public.begin_legacy_notification_dispatch_v1(p_workflow_key text, p_occurrence_key text, p_rule_id uuid, p_channel_key text, p_target_key text, p_target_generation bigint, p_legacy_owner_key text, p_expected_owner_generation bigint, p_request_id uuid) returns jsonb
public.finalize_legacy_notification_dispatch_v1(p_claim_id uuid, p_owner_generation bigint, p_dispatch_token uuid, p_outcome text, p_provider_reference text) returns jsonb
public.commit_legacy_notification_in_app_projection_v1(p_delivery_id uuid, p_claim_id uuid, p_owner_generation bigint, p_dispatch_token uuid) returns jsonb
public.transfer_notification_dispatch_ownership_v1(p_claim_id uuid, p_expected_owner_generation bigint, p_to_owner_kind text, p_request_id uuid, p_reason_code text) returns jsonb
```

`record_notification_event_v1` returns exactly `{ event_id, fanout_job_id }`. Both values are UUIDs, and an occurrence replay returns the original pair. Domain producers pass the opaque fan-out job reference through their response when UI status is needed; they never query private job tables directly.

Service-role orchestration consumes `claim_notification_fanout_jobs_v1`, `claim_notification_rule_reconciliation_jobs_v1`, `claim_notification_target_reconciliation_jobs_v1`, both `apply_notification_*_reconciliation_batch_v1` RPCs, `finish_notification_orchestration_job_v1`, `claim_notification_deliveries_v1`, `begin_notification_delivery_send_v1`, `commit_notification_in_app_delivery_v1`, `finalize_notification_delivery_v1`, and `reap_notification_leases_v1`. Fixed-purpose legacy external-provider bridges use the locked legacy ownership begin/finalize pair; fixed-purpose legacy inbox bridges additionally use the common compatibility materializer and `commit_legacy_notification_in_app_projection_v1`; rollback uses transfer. Admin/staff status and retry use only the two operator wrappers, while delivery recovery consumes `reconcile_notification_delivery_v1`.

The common plan creates `src/features/notifications/server/notification-workflow-adapter.ts` with `DbBigInt`, `NotificationWorkflowAdapter`, per-rule `NotificationResolveInput`, `NotificationTargetSet`, `NotificationRevalidationInput`, `NotificationRevalidationResult`, `RuleReconciliationInput/Batch`, and `TargetReconciliationInput/Batch`, plus:

```ts
export function createNotificationWorker(input: {
  getAdapter: (workflowKey: string) => NotificationWorkflowAdapter | null
}): NotificationWorker
```

The registration plan creates:

```ts
// src/features/notifications/server/adapters/registration-notification-adapter.ts
export const registrationNotificationAdapter: NotificationWorkflowAdapter
```

Common UI owns `/admin/settings/notifications`, its navigation item, and all seven launchers. It exports `NotificationControlPanel({ workflowKey, presentation, open, onOpenChange })`; dialog mode receives a locked `workflowKey`.

## Existing Ownership Map

| Workflow | Current files | Persistence/sender debt |
| --- | --- | --- |
| tasks | `src/app/admin/tasks/page.tsx`, `src/features/tasks/ops-task-service.ts`, `ops-task-workspace.tsx` | `ops_tasks`, events/comments; no sender; coarse `updated` is insufficient |
| word_retests | `/admin/word-retests`, same service/workspace | `ops_word_retests`; retry is two calls; auto-absence is client-triggered |
| registration | `/admin/registration`, `registration-track-service.ts` | track events plus generic component sender, DB phone projection, visit route, SOLAPI route |
| transfer | `/admin/transfer`, ops task files | transfer detail plus in-memory settings/browser Chat |
| withdrawal | `/admin/withdrawal`, ops task files | withdrawal detail plus in-memory settings/browser Chat; checklist must not re-emit |
| makeup_requests | `/admin/makeup-requests`, makeup service/workspace | browser writes events/inbox/push/Chat/history; persisted settings/templates/history |
| approvals | `/admin/approvals`, approval service/workspace | direct writes, limited status trigger, no comment/approver projection |

---

### Task 1: Register seven adapters and compose the worker

**Files:**
- Create: `src/features/notifications/server/adapters/tasks-notification-adapter.ts`
- Create: `src/features/notifications/server/adapters/word-retests-notification-adapter.ts`
- Create: `src/features/notifications/server/adapters/transfer-notification-adapter.ts`
- Create: `src/features/notifications/server/adapters/withdrawal-notification-adapter.ts`
- Create: `src/features/notifications/server/adapters/makeup-requests-notification-adapter.ts`
- Create: `src/features/notifications/server/adapters/approvals-notification-adapter.ts`
- Create: `src/features/notifications/server/notification-workflow-registry.ts`
- Create: `src/app/api/notifications/worker/route.ts`
- Create: `tests/notification-workflow-registry.test.mjs`

**Interfaces:**
- Consumes: common adapter/worker interface and `registrationNotificationAdapter`.
- Produces: `tasksNotificationAdapter`, `wordRetestsNotificationAdapter`, `transferNotificationAdapter`, `withdrawalNotificationAdapter`, `makeupRequestsNotificationAdapter`, `approvalsNotificationAdapter`, and `getNotificationWorkflowAdapter(workflowKey: string): NotificationWorkflowAdapter | null`.

- [ ] **Step 1: Write a failing registry test.**

```js
test("registry has seven exclusive owners", async () => {
  const source = await readFile(new URL("../src/features/notifications/server/notification-workflow-registry.ts", import.meta.url), "utf8")
  assert.deepEqual(
    [...source.matchAll(/^\s*(tasks|word_retests|registration|transfer|withdrawal|makeup_requests|approvals):/gm)].map((match) => match[1]),
    ["tasks", "word_retests", "registration", "transfer", "withdrawal", "makeup_requests", "approvals"],
  )
  assert.match(source, /registrationNotificationAdapter/)
  assert.match(source, /return adapters\[workflowKey as NotificationWorkflowKey\] \?\? null/)
})
```

Also assert all six immediate adapters return one deterministic target set per supplied rule and omit reconciliation callbacks, while the imported registration adapter exposes both `reconcileScheduledRules` and `reconcileTargets`. Feed a synthetic reconciliation job to a callback-free workflow and require `failed/reconciler_missing` with no apply RPC call.

- [ ] **Step 2: Run `node --test tests/notification-workflow-registry.test.mjs`.** Expected: fail because files do not exist.
- [ ] **Step 3: Implement six focused adapters.** Tasks resolves requester, primary/secondary assignees, and active admin/staff; word retests resolves requesting teacher, assigned assistant, secondary assignee, and active admin/staff; transfer/withdrawal resolves requester and management; approvals resolves requester, current approver, and management; makeup resolves requester, approver, management, executive Chat, and subject Chat. `math_middle|math_high` selects `google_chat.math`, `english` selects `google_chat.english`, and unknown selects no subject target. Each `resolveTargets` call handles exactly one supplied rule and returns a sorted `NotificationTargetSet` with a deterministic whole-set hash; sources without a recipient revision use decimal string generation `"0"`. Each adapter also implements the common `buildRenderContext` and `buildDeepLink` callbacks from the same authoritative source snapshot; the link callback returns only an allowlisted same-origin admin path and never accepts a browser-provided href. Adapters accept no rendered body or recipient input. The common worker exclusively rereads the stored rule/template and renders the provider payload from that context, so adapters do not own template loading or rendering. These six immediate-only adapters omit both reconciliation callbacks; the registration adapter supplies them.
- [ ] **Step 4: Add the closed registry and compose `createNotificationWorker({ getAdapter: getNotificationWorkflowAdapter })` in the route.** Export `POST` only. Before `runBatch`, require `Authorization` to equal `Bearer ${process.env.NOTIFICATION_WORKER_SECRET}` using a timing-safe comparison; missing or wrong credentials return 401 before any claim. The later Supabase Cron job calls this POST with the Vault-held credential.

```ts
const adapters: Record<NotificationWorkflowKey, NotificationWorkflowAdapter> = {
  tasks: tasksNotificationAdapter,
  word_retests: wordRetestsNotificationAdapter,
  registration: registrationNotificationAdapter,
  transfer: transferNotificationAdapter,
  withdrawal: withdrawalNotificationAdapter,
  makeup_requests: makeupRequestsNotificationAdapter,
  approvals: approvalsNotificationAdapter,
}
export function getNotificationWorkflowAdapter(workflowKey: string) {
  return adapters[workflowKey as NotificationWorkflowKey] ?? null
}
```

- [ ] **Step 5: Re-run the test.** Expected: pass with seven keys and no fallback.
- [ ] **Step 6: Commit.**

```bash
git add src/features/notifications/server src/app/api/notifications/worker/route.ts tests/notification-workflow-registry.test.mjs
git commit -m "feat: register notification workflow adapters"
```

### Task 2: Make task and word-retest production atomic

**Files:**
- Create: `supabase/migrations/20260715190000_notification_ops_task_producers.sql`
- Create: `supabase/tests/notification_ops_task_adapters_test.sql`
- Create: `tests/notification-ops-task-producers.test.mjs`
- Modify: `src/features/tasks/ops-task-service.ts:907-935,3751-4270`
- Modify: `src/features/tasks/ops-task-workspace.tsx:10840-10935,11211-11279`

**Interfaces:**
- Consumes: private canonical producer.
- Produces:

```sql
public.create_ops_task_v2(p_input jsonb, p_request_id uuid) returns jsonb
public.update_ops_task_v2(p_task_id uuid, p_input jsonb, p_expected_updated_at timestamptz, p_request_id uuid) returns jsonb
public.transition_ops_task_status_v2(p_task_id uuid, p_status text, p_expected_updated_at timestamptz, p_request_id uuid) returns jsonb
public.add_ops_task_comment_v2(p_task_id uuid, p_body text, p_request_id uuid) returns jsonb
public.retry_word_retest_v1(p_previous_task_id uuid, p_input jsonb, p_request_id uuid) returns jsonb
public.report_word_retest_result_v1(p_task_id uuid, p_result jsonb, p_request_id uuid) returns jsonb
public.report_word_retest_absent_v1(p_task_id uuid, p_source text, p_request_id uuid) returns jsonb
public.request_word_retest_revision_v1(p_task_id uuid, p_reason text, p_request_id uuid) returns jsonb
```

- [ ] **Step 1: Write failing schema/pgTAP tests.** Require `request_id uuid` and `payload jsonb` on `ops_task_events`, replay-safe uniqueness, authenticated fixed RPCs, original source UUID on replay, and rollback after induced canonical failure.

```sql
select lives_ok(
  $$ select public.create_ops_task_v2(
    '{"type":"general","title":"원장 확인","status":"requested"}'::jsonb,
    '10000000-0000-4000-8000-000000000001'::uuid
  ) $$,
  'general producer commits atomically'
);
select is(
  (select count(*) from dashboard_private.notification_events where workflow_key = 'word_retests'),
  0::bigint,
  'general never emits word-retest events'
);
```

- [ ] **Step 2: Run `node --test tests/notification-ops-task-producers.test.mjs`.** Expected: fail on missing RPC/event catalog.
- [ ] **Step 3: Add fixed RPCs.** Allow `general`, `word_retest`, `transfer`, `withdrawal`; reject `registration`; validate actor and `expected_updated_at`; write source then canonical event; return `{ task, sourceEventIds }`.
- [ ] **Step 4: Map tasks to `task.created`, `assignee_changed`, `due_changed`, `status_changed`, `completed`, `canceled`, `reopened`, `comment_added`.** Never infer coarse `updated`; cancel only unsent stale work.
- [ ] **Step 5: Map word events to `word_retest.created`, `assigned`, `schedule_changed`, `started`, `result_reported`, `absent_reported`, `revision_requested`, `retry_created`, `completed`, `canceled`.** Retry completes/links old and creates new in one transaction. The workflow owns absence calculation.
- [ ] **Step 6: Switch service/workspace to RPCs.** Remove post-commit event writes, return source IDs, replace two-call retry, keep registration on its dedicated service.
- [ ] **Step 7: Run tests.**

```bash
node --test tests/notification-ops-task-producers.test.mjs tests/ops-task-workspace.test.mjs
pnpm dlx supabase@2.109.1 test db
```

Expected: exclusive ownership, idempotent replay, atomic rollback.

- [ ] **Step 8: Commit.**

```bash
git add supabase/migrations/20260715190000_notification_ops_task_producers.sql supabase/tests/notification_ops_task_adapters_test.sql tests/notification-ops-task-producers.test.mjs src/features/tasks/ops-task-service.ts src/features/tasks/ops-task-workspace.tsx
git commit -m "feat: produce task notification events atomically"
```

### Task 3: Move transfer and withdrawal off component senders

**Files:**
- Create: `supabase/migrations/20260715191000_notification_transfer_withdrawal_producers.sql`
- Create: `supabase/tests/notification_transfer_withdrawal_adapters_test.sql`
- Create: `src/app/api/notifications/legacy/ops-task/route.ts`
- Create: `tests/notification-transfer-withdrawal-adapters.test.mjs`
- Modify: `src/features/tasks/ops-task-workspace.tsx:615-839,7324-7458,11000-11125`
- Modify: `src/features/tasks/ops-task-service.ts:2039-2085`

**Interfaces:**
- Consumes: v2 ops-task `{ task, sourceEventIds }`, shared ownership, both adapters.
- Produces: `complete_ops_transfer_roster_transition_v2(p_task_id uuid,p_request_id uuid) returns jsonb`, `complete_ops_withdrawal_roster_transition_v2(p_task_id uuid,p_request_id uuid) returns jsonb`, legacy POST `{ sourceEventId: string }`.

- [ ] **Step 1: Write failing intent/security tests.** Submitted/completed create management Chat only; processing/applicant/operations create none; no cross-emission; checklist save does not complete; channel/text/recipient/webhook payload returns `422 notification_payload_forbidden`.
- [ ] **Step 2: Run `node --test tests/notification-transfer-withdrawal-adapters.test.mjs`.** Expected: fail on component arbitrary senders.
- [ ] **Step 3: Map transfer and withdrawal separately.** Each emits submitted, processing_started, details_changed, completed, canceled, reopened. Seed only submitted/completed `management_team/google_chat/google_chat.management` with the checked-in compatibility template; component toggle shapes are not configuration truth. V2 roster transitions commit roster/status/source/canonical/job together.
- [ ] **Step 4: Add source-ID-only legacy bridge.** Reread source/task/detail, verify owner, render compatibility content, and record the fingerprint. Derive the stable compatibility rule/target with target generation `0`, call `begin_legacy_notification_dispatch_v1`, and invoke the server-only Chat provider only when `acquired`; finish every accepted/definite-failure/unknown outcome through `finalize_legacy_notification_dispatch_v1`. Return `202` with no provider work when canonical owns dispatch. Never call `/api/google-chat` or pass rendered content into an ownership RPC.
- [ ] **Step 5: Remove browser senders.** Post returned source ID only while legacy owns; provider failure never rejects saved transition.
- [ ] **Step 6: Run and commit.**

```bash
node --test tests/notification-transfer-withdrawal-adapters.test.mjs tests/ops-task-workspace.test.mjs
pnpm dlx supabase@2.109.1 test db
git add supabase/migrations/20260715191000_notification_transfer_withdrawal_producers.sql supabase/tests/notification_transfer_withdrawal_adapters_test.sql src/app/api/notifications/legacy/ops-task/route.ts tests/notification-transfer-withdrawal-adapters.test.mjs src/features/tasks/ops-task-workspace.tsx src/features/tasks/ops-task-service.ts
git commit -m "feat: adapt transfer and withdrawal notifications"
```

Expected: one intent per occurrence and never two owners.

### Task 4: Import and harden makeup notification state

**Files:**
- Create: `supabase/migrations/20260715192000_notification_makeup_adapter.sql`
- Create: `supabase/tests/notification_makeup_adapter_test.sql`
- Create: `src/app/api/notifications/legacy/makeup/route.ts`
- Create: `tests/notification-makeup-adapter.test.mjs`
- Modify: `src/features/makeup-requests/makeup-request-service.ts:777-1085,1317-1815`
- Modify: `src/features/makeup-requests/makeup-request-workspace.tsx:2232-2245,2451-2455,2785-2965`
- Modify: `tests/makeup-request-workspace.test.mjs`

**Interfaces:**
- Consumes: makeup adapter, common import/audit storage, shared ownership.
- Produces: `create_makeup_request_v2(p_input jsonb,p_request_id uuid) returns jsonb`, `transition_makeup_request_v2(p_makeup_request_id uuid,p_command text,p_patch jsonb,p_expected_status text,p_request_id uuid) returns jsonb`, `delete_makeup_request_v2(p_makeup_request_id uuid,p_request_id uuid) returns jsonb`.

- [ ] **Step 1: Write failing import tests.** Two imports keep counts stable; persisted disabled stays disabled; missing stays absent; unused channel content remains inactive metadata; retained history maps sent/failed/skipped/disabled/deduped without provider calls; 500-row prune becomes audit metadata only.
- [ ] **Step 2: Write failing producer tests.** Repeated submit/resubmit have distinct event UUIDs; completed maps to `makeup.refund_completed`; cancellation to `makeup.approval_canceled`; hard delete records `makeup.deleted`; management inbox is per profile; unknown subject makes management Chat once and no subject target.
- [ ] **Step 3: Run `node --test tests/notification-makeup-adapter.test.mjs tests/makeup-request-workspace.test.mjs`.** Expected: fail on browser fan-out.
- [ ] **Step 4: Implement idempotent import.** Read persisted settings/deliveries only; import allowed cells and retained terminal history; preserve inactive content/checksums; never infer from `buildDefaultNotificationSettings`.
- [ ] **Step 5: Implement fixed commands.** Commands are approve, revision_requested, reject, refund_requested, refund_completed, resubmit, approval_canceled. Normalize submitted/resubmitted to `makeup.submitted`; approved to `makeup.approved`; returned/revision_requested to `makeup.revision_requested`; rejected to `makeup.rejected`; refund_requested to `makeup.refund_requested`; completed/refund_completed to `makeup.refund_completed`; canceled/approval_canceled/completed_canceled to `makeup.approval_canceled`; and pre-delete audit to `makeup.deleted`. Validate actor/status, mutate, insert source, record canonical, return `{ request, sourceEventId }`. Prepare calendar effects before terminal mutation.
- [ ] **Step 6: Harden legacy route.** Accept source ID only; reread event/request/settings and record its fingerprint. Use the locked legacy begin/finalize RPCs per external-provider rule/target/generation before server-only Chat/Web Push work; no acquired claim means no side effect. For legacy inbox, call the common fixed-purpose compatibility materializer with only event/rule/profile/generation/owner/request identities; it rereads the authoritative source, runs adapter render/deep-link callbacks, stores one immutable legacy-owned `in_app` delivery, and begins legacy ownership. Complete only through `commit_legacy_notification_in_app_projection_v1(delivery_id,claim_id,owner_generation,dispatch_token)`, which uses stored fields and atomically inserts inbox + marks delivery sent + closes ownership without a push child. Never pass title/body/href to either RPC. Remove browser inbox/push/Chat/history writes; keep legacy settings read-only for rollback.
- [ ] **Step 7: Run and commit.**

```bash
node --test tests/notification-makeup-adapter.test.mjs tests/makeup-request-model.test.mjs tests/makeup-request-workspace.test.mjs
pnpm dlx supabase@2.109.1 test db
git add supabase/migrations/20260715192000_notification_makeup_adapter.sql supabase/tests/notification_makeup_adapter_test.sql src/app/api/notifications/legacy/makeup/route.ts tests/notification-makeup-adapter.test.mjs src/features/makeup-requests/makeup-request-service.ts src/features/makeup-requests/makeup-request-workspace.tsx tests/makeup-request-workspace.test.mjs
git commit -m "feat: migrate makeup notification adapter"
```

Expected: repeatable import, occurrence-safe dedupe, personal read state, no dual send.

### Task 5: Produce approval events from authoritative mutations

**Files:**
- Create: `supabase/migrations/20260715193000_notification_approval_producers.sql`
- Create: `supabase/tests/notification_approval_adapter_test.sql`
- Create: `tests/notification-approval-adapter.test.mjs`
- Modify: `src/features/approvals/approval-service.ts:335-435`
- Modify: `tests/approval-workspace.test.mjs`

**Interfaces:**
- Consumes: approvals adapter and canonical producer.
- Produces:

```sql
public.create_approval_request_v2(p_input jsonb, p_status text, p_request_id uuid) returns jsonb
public.update_approval_request_v2(p_approval_id uuid, p_input jsonb, p_status text, p_expected_updated_at timestamptz, p_request_id uuid) returns jsonb
public.transition_approval_request_v2(p_approval_id uuid, p_status text, p_expected_updated_at timestamptz, p_request_id uuid) returns jsonb
public.add_approval_comment_v2(p_approval_id uuid, p_body text, p_request_id uuid) returns jsonb
public.delete_approval_request_v2(p_approval_id uuid, p_request_id uuid) returns jsonb
```

- [ ] **Step 1: Write failing tests.** Cover created, first submitted, review started, approver changed before/after, approved, returned, canceled, resubmitted, comment UUID, closed delete audit; rules remain disabled and provider count zero.
- [ ] **Step 2: Run `node --test tests/notification-approval-adapter.test.mjs tests/approval-workspace.test.mjs`.** Expected: fail on limited trigger.
- [ ] **Step 3: Replace trigger in new migration.** Preserve hardened search path. The trigger is the sole producer boundary: it inserts exactly one semantic source event and calls the canonical producer exactly once in the same transaction. On approver change, cancel only the old approver's unsent delivery and let that one new `approval.approver_changed` event fan out the new recipient; do not enqueue target reconciliation, because that queue is reserved for retargeting an existing scheduled event. Record deleted before cascade so private audit survives.
- [ ] **Step 4: Add fixed RPCs and switch service.** RPCs validate requester/operator/approver, request replay, and optimistic update, then mutate the authoritative rows only; they never write a source/canonical event directly and rely on Step 3's trigger. Remove direct browser writes. Tests assert one raw source UUID and one canonical occurrence per request, including approver change.
- [ ] **Step 5: Run and commit.**

```bash
node --test tests/notification-approval-adapter.test.mjs tests/approval-workspace.test.mjs
pnpm dlx supabase@2.109.1 test db
git add supabase/migrations/20260715193000_notification_approval_producers.sql supabase/tests/notification_approval_adapter_test.sql tests/notification-approval-adapter.test.mjs src/features/approvals/approval-service.ts tests/approval-workspace.test.mjs
git commit -m "feat: produce approval notification events"
```

Expected: one source occurrence per mutation, stale approver targets revoked, delete audit retained.

### Task 6: Connect registration core and specialized owners

**Files:**
- Create: `supabase/migrations/20260715194000_notification_registration_handoffs.sql`
- Create: `supabase/tests/notification_registration_handoffs_test.sql`
- Create: `tests/notification-registration-handoffs.test.mjs`
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `src/features/tasks/ops-task-workspace.tsx:7427-7458,11019-11120`
- Modify: `src/app/api/notifications/legacy/ops-task/route.ts`
- Modify: `src/app/api/registration/consultation-notification/route.ts`
- Modify: `src/app/api/solapi/registration/route.ts`
- Modify: `tests/registration-track-service.test.mjs`
- Modify: `tests/registration-consultation-notification.test.mjs`
- Modify: `tests/registration-admission-message-route.test.mjs`

**Interfaces:**
- Consumes: registration adapter, the prerequisite `write_registration_track_event_v2` plus seven-argument wrapper, persisted appointment occurrence/notification/recipient revisions, common ownership/delivery RPCs, and target reconciliation helper.
- Produces: exactly-once canonical producer attachment to the existing version-2 track writer; independent core, phone, visit, SOLAPI handoffs.

```sql
dashboard_private.write_registration_track_event_v2(
  p_task_id uuid,
  p_track_id uuid,
  p_event_type text,
  p_source text,
  p_destination text,
  p_reason_code text,
  p_metadata jsonb,
  p_actor_kind text,
  p_system_source text
) returns uuid

dashboard_private.write_registration_track_event(
  p_task_id uuid,
  p_track_id uuid,
  p_event_type text,
  p_source text,
  p_destination text,
  p_reason text,
  p_metadata jsonb
) returns void
```

- [ ] **Step 1: Write failing core tests.** New events require version 2 and actor_kind user/system/migration; version 1 is read-only; core flag creates no phone/visit/SOLAPI delivery while specialized flags are false.
- [ ] **Step 2: Write failing specialized tests.** Phone create/reassign/complete leaves one inbox owner; visit accepts appointment ID only and preserves revision/cancel/unknown; SOLAPI reuses request key and preserves accepted/failed/unknown/reconcile/retry-release without automatic resend.
- [ ] **Step 3: Run focused tests.**

```bash
node --test tests/notification-registration-handoffs.test.mjs tests/registration-track-service.test.mjs tests/registration-consultation-notification.test.mjs tests/registration-admission-message-route.test.mjs
```

Expected: fail on version or ownership.

- [ ] **Step 4: Extend the already-installed version-2 writer in the new migration.** Forward-replace only `write_registration_track_event_v2` so it keeps the prerequisite actor validation/payload contract, captures its one raw source UUID, maps that row to exactly one canonical event key, and calls the canonical producer exactly once in the same transaction. Keep the seven-argument `write_registration_track_event` as delegation only; it must not write another v2 row or call the producer itself. In particular, existing raw `director_default_resolved`, `director_manual_override`, or `director_default_cleared` rows map to canonical `registration.director_assigned`; never insert a second raw row whose event type is the canonical key. Apply the same one-source-to-one-canonical mapping for case_created, inquiry_routed, phone_consultation_ready, level_test_scheduled/rescheduled/started/completed/absent/canceled, visit_scheduled/rescheduled/replaced/subject_deselected/canceled, consultation_completed, waiting_transitioned, enrollment_decided, admission_started/advanced/canceled, registration_completed, case_closed, track_reopened, and admission_message_requested/accepted/failed/unknown/reconciled/retry_released; do not emit coarse processing for pipeline `2.*`. `registration.appointment_reminder_due` remains exclusively owned by the prerequisite registration reminder materializer and is never emitted by this track-event writer. Resolve track director, management, subject team, and requester server-side; guardian phone exists only inside SOLAPI resolution. Seed generic case-created/completed management Chat only; retain the prerequisite phone/visit compatibility rules enabled but legacy-owned until their specialized flags transfer. Immediate visit uses `source_type = registration_appointment`, occurrence `registration:registration_appointment:{appointmentId}:source_revision:{notificationRevision}:immediate`, and the persisted appointment recipient revision as `target_generation`; it produces one management Chat target and one in-app target per distinct current director profile, with subject badges aggregated per profile.
- [ ] **Step 5: Remove generic component sender.** Extend Task 3's source-ID bridge to verified registration core source events and the locked legacy begin/finalize ownership contract; submitted/completed compatibility uses generation `0` until the core flag owns dispatch.
- [ ] **Step 6: Gate specialized owners independently.** Phone's fixed-purpose service-role projection and visit's fixed-purpose route use persisted recipient revision as target generation. Legacy in-app paths materialize the immutable compatibility delivery and complete through `commit_legacy_notification_in_app_projection_v1`; visit Chat uses the legacy begin/finalize pair. SOLAPI uses canonical claims while `ops_registration_messages` remains evidence. Do not alter appointment/reminder algorithms. Each owner flag is read from the common runtime table at the side-effect RPC, not from an environment variable, and no registration core/phone/visit/reminder ownership may activate unless common, adapters, and registration-reminders runtime markers plus the recent worker heartbeat all pass.
- [ ] **Step 7: Run and commit.**

```bash
node --test tests/notification-registration-handoffs.test.mjs tests/registration-track-service.test.mjs tests/registration-consultation-notification.test.mjs tests/registration-admission-message-route.test.mjs
pnpm dlx supabase@2.109.1 test db
git add supabase/migrations/20260715194000_notification_registration_handoffs.sql supabase/tests/notification_registration_handoffs_test.sql tests/notification-registration-handoffs.test.mjs src/features/tasks/registration-track-service.ts src/features/tasks/ops-task-workspace.tsx src/app/api/notifications/legacy/ops-task/route.ts src/app/api/registration/consultation-notification/route.ts src/app/api/solapi/registration/route.ts tests/registration-track-service.test.mjs tests/registration-consultation-notification.test.mjs tests/registration-admission-message-route.test.mjs
git commit -m "feat: hand off registration notification owners"
```

Expected: core, phone, visit, SOLAPI each have one reversible owner.

### Task 7: Close legacy payload writers and verify seeds/entry points

**Files:**
- Create: `supabase/migrations/20260715195000_notification_workflow_legacy_closure.sql`
- Create: `supabase/tests/notification_workflow_seed_test.sql`
- Create: `tests/notification-provider-endpoint-closure.test.mjs`
- Create: `tests/notification-workflow-entrypoints.test.mjs`
- Create: `scripts/verify-notification-workflow-entrypoints.mjs`
- Modify: `src/app/api/google-chat/route.ts`
- Modify: `src/app/api/web-push/route.ts`

**Interfaces:**
- Consumes: common plan ownership of the global page/navigation and seven `NotificationControlPanel({ workflowKey, presentation: "dialog", open, onOpenChange })` launchers.
- Produces: closed arbitrary POST contracts, revoked authenticated direct writers, one authenticated worker schedule, workflow-specific seed/entry-point gates, and final `public.notification_workflow_adapters_runtime_version() returns 1`. It does not fork common UI.

- [ ] **Step 1: Write failing closure tests.** Send legacy `channel + text` and recipient/team/title/body/href payloads and require `422 { code: "notification_payload_forbidden" }` with zero provider calls. Assert missing/wrong worker authorization returns 401 before a claim.
- [ ] **Step 2: Write the seed pgTAP packet.** Assert tasks/word/approvals all disabled; transfer/withdrawal enable only submitted/completed management Chat; registration generic core enables only submitted/completed management Chat while the separately approved phone/visit compatibility cells are enabled but legacy-owned behind their specialized flags; makeup equals persisted rows; every rule has an active template; applicant/operations rows are absent.

```sql
select is(
  (select count(*) from dashboard_private.notification_rules where workflow_key in ('tasks','word_retests','approvals') and enabled),
  0::bigint,
  'new workflows start disabled'
);
select is(
  (select count(*) from dashboard_private.notification_rules where audience_key in ('applicant','operations')),
  0::bigint,
  'phantom audiences are absent'
);
```

- [ ] **Step 3: Finalize the closed settings registry, then close writers in a new migration.** Upsert the exact workflow/event rows, audience/channel cells, Korean labels, initial enabled values, deterministic template version 1, allowed-variable catalogs, and `system` seed actor from the approved adapter design; reject any registry-external cell at save/runtime. Re-running the migration must leave rule/template counts and checksums unchanged. Then revoke authenticated insert/update/delete on canonical-backed `dashboard_notifications` and direct insert on `ops_task_events`, `ops_task_comments`, `makeup_request_events`, `makeup_notification_deliveries`, `approval_events`, and `approval_comments`. Preserve select access and fixed domain RPC/service-role paths. Keep legacy settings tables readable for rollback. Create `notification_workflow_adapters_runtime_version() = 1` as the migration's final statement only after all producer/seed/closure contracts exist; its source tests also require the seven-adapter registry and authenticated worker route.
- [ ] **Step 4: Close provider POSTs and schedule the worker.** `/api/google-chat` and `/api/web-push` reject arbitrary legacy payloads before reading credentials. In the closure migration, enable `pg_cron` and `pg_net`, read the worker URL and credential from Supabase Vault, and install one every-minute `net.http_post` job for `/api/notifications/worker`. Never embed the credential in migration SQL or logs. Task 1's POST route authenticates `NOTIFICATION_WORKER_SECRET` and delegates to the common worker.
- [ ] **Step 5: Write the common-launcher integration test.** Assert exact adapter key per route, common UI mounts no route-local settings dialog, and opening/saving settings invokes no provider or legacy source-ID bridge. Tasks 3, 4, and 6 have already removed route-local sender state; legacy settings data stays frozen for rollback.
- [ ] **Step 6: Run static/database gates.**

```bash
node --test tests/notification-provider-endpoint-closure.test.mjs tests/notification-workflow-entrypoints.test.mjs tests/notification-control-plane-ui.test.mjs tests/ops-task-workspace.test.mjs tests/makeup-request-workspace.test.mjs tests/approval-workspace.test.mjs
pnpm dlx supabase@2.109.1 test db
```

Expected: stale bundles cannot reach providers, direct browser writers are denied, seeds match approved intent, and common launchers remain the only settings surface.

- [ ] **Step 7: Add and run browser verification.** Visit seven routes at desktop and 390x844; open/close; assert locked label; confirm one saved draft globally and after refresh; make no provider request.

```bash
pnpm run dev
node scripts/verify-notification-workflow-entrypoints.mjs --base-url http://localhost:3000
```

Expected: seven actions share one persisted panel and no legacy dialog appears under the UI flag. Stop the server afterward.

- [ ] **Step 8: Commit.**

```bash
git add supabase/migrations/20260715195000_notification_workflow_legacy_closure.sql supabase/tests/notification_workflow_seed_test.sql tests/notification-provider-endpoint-closure.test.mjs tests/notification-workflow-entrypoints.test.mjs scripts/verify-notification-workflow-entrypoints.mjs src/app/api/google-chat/route.ts src/app/api/web-push/route.ts
git commit -m "feat: close legacy notification writers"
```

### Task 8: Prove shadow parity, cut over, and rehearse rollback

**Files:**
- Create: `scripts/verify-notification-workflow-cutover.mjs`
- Create: `tests/notification-workflow-cutover.test.mjs`
- Create: `docs/operations/notification-workflow-cutover.md`

**Interfaces:**
- Consumes: common runtime 1, workflow-adapters runtime 1, registration-reminders runtime 1 for every registration core/phone/visit/reminder ownership change, twelve approved flags, legacy/shadow audit, ownership, heartbeat, cancellation/reconciliation RPCs.
- Produces: no-provider verifier and rollback runbook.

- [ ] **Step 1: Write failing verifier test.** Require both common/adapters runtime markers and a successful worker heartbeat within three minutes; additionally require `registration_appointment_reminders_runtime_version() = 1` before any registration core/phone/visit/reminder ownership flag can enable. Require the exact twelve-row server flag registry; zero provider/inbox calls in shadow; comparison by workflow/event/occurrence/audience/channel/target/target generation/template checksum/rendered hash; approved normalization only; fail on dual ownership or mixed target/owner generation.
- [ ] **Step 2: Implement/run shadow verifier.**

```bash
node --test tests/notification-workflow-cutover.test.mjs
node scripts/verify-notification-workflow-cutover.mjs --mode shadow --provider-mode blocked
```

Expected: all shadow deliveries are skipped/shadow_mode and provider/inbox counts are zero.

- [ ] **Step 3: Document cutover order.** Require seven days 100% match plus low-volume fixtures; use `set_notification_runtime_flag_v1` with expected decimal-string revision/request ID to enable tasks, word retests, approvals, transfer, withdrawal, makeup, registration core/reminder handoff, phone, visit, and SOLAPI. The same release disables the matching legacy caller; no env-only toggle is accepted as evidence.
- [ ] **Step 4: Document rollback.** Lower the authoritative flag through the same RPC; stop canonical claims; cancel pending/retry_wait as cutover_rollback; request cancel on claimed; wait heartbeat; never resend sending/sent/unknown. Transfer only a reserved, provider-reference-free, pre-send-canceled ownership row via `transfer_notification_dispatch_ownership_v1` with expected owner generation/request ID/reason; restore the matching legacy owner and keep shadow enabled. Target generation never changes during owner transfer.
- [ ] **Step 5: Run complete packet.**

```bash
node --test tests/*.test.mjs
pnpm dlx supabase@2.109.1 test db
pnpm run lint
pnpm run build
git diff --check
```

Expected: 1011 baseline plus new tests pass with 0 failures; pgTAP, lint, build, diff checks pass.

- [ ] **Step 6: Run rollback drill.**

```bash
node scripts/verify-notification-workflow-cutover.mjs --mode rollback --provider-mode blocked
```

Expected: no dual provider or shadow replay; unsent ends cutover_rollback; sent/unknown unchanged.

- [ ] **Step 7: Commit.**

```bash
git add scripts/verify-notification-workflow-cutover.mjs tests/notification-workflow-cutover.test.mjs docs/operations/notification-workflow-cutover.md
git commit -m "test: verify notification workflow cutovers"
```

## Final Release Gates

- Runtime probe is 1 and dispatch flags default false.
- Arbitrary Google Chat/Web Push payloads return `422 notification_payload_forbidden` without provider calls.
- Every active workflow has atomic production and exactly one dispatch owner.
- Tasks, word retests, approvals remain disabled until explicit settings save.
- No phantom applicant/operations rules exist.
- Makeup import counts/checksums are stable over two runs.
- Registration phone, visit, SOLAPI flags are independently reversible.
- Seven scoped panels and global page show identical saved revisions.
- Keep legacy reads for 14 canonical-only days and one successful rollback drill.
