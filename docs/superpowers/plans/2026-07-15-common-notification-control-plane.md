# Common Notification Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the private notification schema, secure settings and connection APIs, durable worker core, shared global/scoped settings UI, per-profile inbox receipt boundary, and deploy-verifiable Web Push readiness required by all seven notification workflows.

**Architecture:** PostgreSQL owns immutable events, versioned rules/templates, deliveries, leases, audit records, idempotency, and narrow role-checked RPCs. TypeScript owns the injectable worker core, provider classification, connection encryption, and one shared `NotificationControlPanel`; workflow producers and resolvers plug into the worker later through `NotificationWorkflowAdapter`. Existing notification tables and senders remain operational until their workflow-specific cutover, so this plan expands first and leaves every dispatch flag off.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Supabase/PostgreSQL, pgTAP, Zod 4, Node `crypto`, `web-push`, Node test runner, pnpm.

## Global Constraints

- The only first-release scope is `scope_key = 'global'`.
- Canonical workflow keys are `tasks`, `word_retests`, `registration`, `transfer`, `withdrawal`, `makeup_requests`, and `approvals`; UI order is exactly that order and `transfer` is always displayed as `전반`.
- Canonical channels are `in_app`, derived `web_push`, `google_chat`, and registration-only `customer_message`; web push is never an independent settings toggle.
- `dashboard_private.notification_events`, `notification_rules`, `notification_templates`, `notification_deliveries`, and all support queues are inaccessible directly to `anon` and `authenticated`.
- Do not revoke `usage` on `dashboard_private`; existing registration wrappers rely on it.
- Do not delete, rename, or backfill historical `dashboard_notifications`, `dashboard_push_subscriptions`, `google_chat_webhook_settings`, makeup delivery history, registration claims, or SOLAPI state.
- Do not activate tasks, word-retests, or approvals during installation. All dispatch flags remain false.
- This plan does not implement workflow-specific producers, audience resolvers, the closed workflow settings registry, or registration appointment scheduling. Execution order is common control plane, then registration appointments/reminders, then the seven workflow adapters.
- The common worker must compile without importing a workflow module. The later composition root supplies `(workflowKey) => NotificationWorkflowAdapter | null` to `createNotificationWorker({ getAdapter })`.
- Every adapter supplies exact `buildRenderContext` and `buildDeepLink` callbacks; only the common worker reads immutable templates, renders content, validates same-origin links, and persists rendered delivery fields.
- A provider timeout, reset after dispatch begins, or lost sending lease becomes `delivery_unknown`; no ordinary worker automatically retries it.
- Google Chat secrets never appear in browser responses, logs, event payloads, delivery summaries, or audit summaries.
- The expand release preserves legacy browser writers. Direct `dashboard_notifications`/makeup insert grants and arbitrary provider POSTs are closed only after every active legacy caller has moved behind a fixed-purpose adapter.
- RPC/HTTP wire keys stay snake_case. TypeScript/UI camelCase exists only behind explicit mappers, and every PostgreSQL `bigint` revision, target generation, or owner generation crosses JSON as a decimal string.
- All twelve approved UI/shadow/dispatch/specialized flags live in `dashboard_private.notification_runtime_flags`, seed false, and are read again by DB ownership RPCs; no `NEXT_PUBLIC_*` duplicate is authoritative.
- Every registration dispatch/specialized flag additionally requires `public.registration_appointment_reminders_runtime_version() = 1`; absence or version mismatch fails closed.
- Inbox list, unread count, and mark-read use one server-owned visible-row relation plus `(notification_id, profile_id)` read receipts. New reads never mutate shared row `read_at`.
- Web Push is ready only with a matching public/private VAPID pair, secure context, reachable `/sw.js` and manifest, current-profile subscription ownership, and an explicit fixed-content self-test; automated tests never contact a real push provider.

## File Structure

### Create

- `supabase/migrations/20260715090000_notification_control_plane_expand.sql` — canonical tables, queues, request ledger, ownership claims, inbox/connection expand columns, constraints, indexes, grants.
- `supabase/migrations/20260715091000_notification_control_plane_settings_rpc.sql` — settings read/save, audit, manual reconciliation, connection metadata, and public wrappers.
- `supabase/migrations/20260715092000_notification_control_plane_worker_rpc.sql` — event recording, queue claim/finish, delivery claim/begin/finalize/reap, projection, and ownership RPCs.
- `supabase/migrations/20260715093000_notification_control_plane_runtime_marker.sql` — final capability marker returning `1` after all common database contracts exist.
- `supabase/tests/notification_control_plane_schema_test.sql` — pgTAP schema, grant, RLS, deferred-FK, and actor-constraint checks.
- `supabase/tests/notification_control_plane_runtime_test.sql` — pgTAP idempotency, revision, queue lease, status transition, role impersonation, and manual-reconciliation checks.
- `src/features/notifications/notification-control-plane-types.ts` — safe browser DTOs and canonical unions.
- `src/features/notifications/notification-control-plane-model.ts` — pure draft, validation, dirty-patch, conflict, and rebase logic.
- `src/features/notifications/notification-control-plane-service.ts` — authenticated settings/delivery/connection HTTP client.
- `src/features/notifications/notification-control-panel.tsx` — shared page/dialog renderer.
- `src/features/notifications/notification-settings-workspace.tsx` — global seven-workflow settings surface.
- `src/features/notifications/use-notification-navigation-guard.ts` — dirty close, link, back, and unload protection.
- `src/features/notifications/server/notification-workflow-adapter.ts` — cross-plan adapter interface fixed below.
- `src/features/notifications/server/notification-worker.ts` — injectable queue/dispatch orchestration.
- `src/features/notifications/server/legacy-in-app-projection.ts` — fixed-purpose compatibility materialization from source/event/rule/adapter callbacks with no raw content input.
- `src/features/notifications/server/notification-auth.ts` — bearer authentication and exact admin/staff role checks.
- `src/features/notifications/server/notification-connection-crypto.ts` — AES-256-GCM versioned envelope.
- `src/features/notifications/server/notification-connection-repository.ts` — canonical-to-legacy channel mapping and dual-read rules.
- `src/features/notifications/server/providers/google-chat-provider.ts` — fixed delivery-only Google Chat sender and outcome classifier.
- `src/features/notifications/server/providers/web-push-provider.ts` — fixed delivery-only push sender and expired-subscription cleanup.
- `src/app/api/notifications/control-plane/route.ts` — GET/save boundary with HTTP 409 conflict mapping.
- `src/app/api/notifications/connections/route.ts` — masked GET and admin-only replace/verify/disconnect actions.
- `src/app/api/notifications/deliveries/[deliveryId]/route.ts` — fixed manual retry/unknown-resolution endpoint.
- `src/app/api/notifications/push-readiness/route.ts` — masked readiness GET and current-user/current-browser fixed test action.
- `scripts/backfill-google-chat-webhook-encryption.mjs` — dry-run-by-default controlled ciphertext backfill.
- `tests/notification-control-plane-model.test.mjs`, `tests/notification-control-plane-schema.test.mjs`, `tests/notification-control-plane-api.test.mjs`, `tests/notification-control-plane-ui.test.mjs`, `tests/notification-control-plane-worker.test.mjs` — focused source and behavior tests.

### Modify

- `src/app/admin/settings/notifications/page.tsx` — replace dashboard redirect with `NotificationSettingsWorkspace`.
- `src/lib/navigation.ts` — add exact settings metadata and the `알림 설정` sub-navigation entry before generic `/admin/settings` matching.
- `src/features/tasks/ops-task-workspace.tsx` — under the settings-UI flag, open the common locked panel for tasks, word-retests, registration, transfer, and withdrawal; do not change producer calls here.
- `src/features/makeup-requests/makeup-request-workspace.tsx` — switch only the settings launcher to the common locked panel when enabled.
- `src/features/approvals/approval-workspace.tsx` — add the approvals locked settings launcher.
- `src/features/makeup-requests/makeup-request-service.ts` — narrow inbox select/read operations and call the ownership-checked read RPC; leave legacy senders intact until the adapter cutover.
- `src/components/dashboard-notification-popover.tsx` — render server-derived receipt state, inline no-navigation read action, and actionable push readiness states.
- `src/lib/dashboard-push-client.ts`, `src/app/api/push-subscriptions/route.ts`, `public/sw.js` — verify current-profile binding/assets, expose explicit permission states, and harden same-origin service-worker behavior without replacing the legacy workflow push endpoint.
- `package.json` — add focused notification test scripts; retain existing build/lint scripts.
- `tests/admin-shell.test.mjs`, `tests/ops-task-workspace.test.mjs`, `tests/makeup-request-workspace.test.mjs`, `tests/approval-workspace.test.mjs` — replace redirect/legacy-dialog assertions with shared-panel assertions.

### Explicitly Deferred to Later Plans

- Do not modify `/api/google-chat`, `/api/web-push`, registration consultation notification, SOLAPI, or workflow business mutations in this plan.
- The workflow-adapter plan closes arbitrary provider payloads, registers adapters, and adds the worker composition/cron route only after all active callers use fixed-purpose source/event IDs.
- The later connection contract migration removes plaintext only after the controlled backfill and every legacy/rollback reader has been verified against ciphertext.

## Locked Interfaces

```sql
public.common_notification_control_plane_runtime_version() returns integer
public.get_notification_runtime_flags_v1() returns jsonb
public.set_notification_runtime_flag_v1(
  p_flag_key text,
  p_enabled boolean,
  p_expected_revision bigint,
  p_request_id uuid
) returns jsonb
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

public.claim_notification_fanout_jobs_v1(p_worker_id text, p_batch_size integer, p_lease_seconds integer) returns setof jsonb
public.claim_notification_rule_reconciliation_jobs_v1(p_worker_id text, p_batch_size integer, p_lease_seconds integer) returns setof jsonb
public.claim_notification_target_reconciliation_jobs_v1(p_worker_id text, p_batch_size integer, p_lease_seconds integer) returns setof jsonb
public.apply_notification_rule_reconciliation_batch_v1(p_job_id uuid, p_claim_token uuid, p_expected_cursor text, p_batch jsonb, p_next_cursor text, p_done boolean) returns jsonb
public.apply_notification_target_reconciliation_batch_v1(p_job_id uuid, p_claim_token uuid, p_expected_cursor text, p_batch jsonb, p_next_cursor text, p_done boolean) returns jsonb
public.finish_notification_orchestration_job_v1(p_job_kind text, p_job_id uuid, p_claim_token uuid, p_disposition text, p_outcome_summary jsonb, p_error_code text, p_next_attempt_at timestamptz) returns jsonb
public.get_notification_orchestration_job_status_v1(p_job_kind text, p_job_id uuid) returns jsonb
public.retry_notification_orchestration_job_v1(p_job_kind text, p_job_id uuid, p_expected_attempt_count integer, p_request_id uuid) returns jsonb
public.claim_notification_deliveries_v1(p_worker_id text, p_batch_size integer, p_lease_seconds integer) returns setof jsonb
public.record_notification_worker_heartbeat_v1(p_worker_id text, p_run_id uuid, p_phase text, p_counts jsonb, p_error_code text) returns void
public.begin_notification_delivery_send_v1(p_delivery_id uuid, p_claim_token uuid) returns jsonb
public.commit_notification_in_app_delivery_v1(p_delivery_id uuid, p_claim_token uuid) returns jsonb
public.finalize_notification_delivery_v1(p_delivery_id uuid, p_claim_token uuid, p_status text, p_status_reason text, p_provider_message_id text, p_provider_response_code text, p_error_code text, p_error_summary text, p_next_attempt_at timestamptz) returns jsonb
public.reap_notification_leases_v1(p_worker_id text, p_batch_size integer) returns jsonb
public.reconcile_notification_delivery_v1(p_delivery_id uuid, p_resolution text, p_reason text, p_request_id uuid, p_duplicate_risk_accepted boolean default false) returns jsonb

public.get_dashboard_notification_inbox_v1(p_limit integer default 20, p_before_created_at timestamptz default null, p_before_id uuid default null) returns jsonb
public.get_dashboard_notification_unread_count_v1() returns jsonb
public.mark_dashboard_notification_read_v1(p_notification_id uuid) returns jsonb

dashboard_private.reserve_canonical_dispatch_ownership_v1(p_delivery_id uuid) returns uuid
public.begin_legacy_notification_dispatch_v1(p_workflow_key text, p_occurrence_key text, p_rule_id uuid, p_channel_key text, p_target_key text, p_target_generation bigint, p_legacy_owner_key text, p_expected_owner_generation bigint, p_request_id uuid) returns jsonb
public.finalize_legacy_notification_dispatch_v1(p_claim_id uuid, p_owner_generation bigint, p_dispatch_token uuid, p_outcome text, p_provider_reference text) returns jsonb
public.commit_legacy_notification_in_app_projection_v1(p_delivery_id uuid, p_claim_id uuid, p_owner_generation bigint, p_dispatch_token uuid) returns jsonb
public.transfer_notification_dispatch_ownership_v1(p_claim_id uuid, p_expected_owner_generation bigint, p_to_owner_kind text, p_request_id uuid, p_reason_code text) returns jsonb
```

`record_notification_event_v1` returns exactly `{event_id, fanout_job_id}` and an occurrence replay returns the same UUID pair; a domain mutation never reads the fan-out table directly. `finish_notification_orchestration_job_v1` accepts only job kinds `fanout`, `rule_reconciliation`, `target_reconciliation` and dispositions `succeeded`, `retry`, `failed`. The two orchestration operator RPCs are admin/staff-only: status returns only `{job_kind, job_id, workflow_key, status, attempt_count, next_attempt_at, last_error_code, created_at, completed_at}`, while retry request-ledger-idempotently requeues the same manually-retryable `failed` row only when `p_expected_attempt_count` still matches. It preserves job identity, cursor, captured revisions/generation/hash, and attempt count; it rejects succeeded, claimed, pending, non-retryable, or stale requests and returns no source payload, target, rendered body, or secret. `record_notification_worker_heartbeat_v1` accepts only `started | succeeded | failed`; counts are a closed numeric map with no payload/body data. `reconcile_notification_delivery_v1` accepts `mark_sent`, `mark_failed`, `approve_retry`; unknown resolution is admin-only, while retry of an explicitly retryable failed reason is admin/staff. Runtime-flag mutation and every worker/ownership/apply/projection materialization RPC are service-role-only; the flag read, settings/delivery/job, and inbox wrappers retain their narrower authenticated role contracts. All RPC JSON is snake_case, and every `bigint` value in JSON is a decimal string.

`dashboard_private.visible_dashboard_notification_rows_v1(auth.uid())` is the one source for inbox and count. New `public.dashboard_notification_read_receipts(notification_id, profile_id, read_at)` has primary key `(notification_id, profile_id)`, RLS own-select only, and no direct browser write grant. Mark-read locks an active visible row and inserts only the caller's receipt with `ON CONFLICT DO NOTHING`; its result is `{notification_id, newly_read, read_at, unread_count}`. Existing row `read_at` is a read-only historical fallback when no receipt exists; new reads never update it. The list returns stable `(created_at,id)` pagination and performs no client-side content grouping.

Fixed-purpose legacy inbox code uses the common compatibility materializer with only `{workflowKey, eventId, ruleId, targetProfileId, targetGeneration, legacyOwnerKey, expectedOwnerGeneration, requestId}`. It resolves the exact target and invokes the adapter rendering callbacks, persists an immutable `in_app` delivery with ownership `owner_kind = legacy`, then calls `begin_legacy_notification_dispatch_v1`. `commit_legacy_notification_in_app_projection_v1` takes only the stored delivery and returned ownership claim/generation/token; it atomically inserts the `source_delivery_id`-unique inbox row from stored rendered fields, marks delivery sent, and closes the claim. It creates no push child. Replays return the same notification ID, mismatches reject, and generic canonical claim/`legacy_skipped` logic never consumes this explicit legacy-owned compatibility delivery.

```ts
// src/features/notifications/server/notification-workflow-adapter.ts
export type DbBigInt = string

export type NotificationRuleSnapshot = {
  ruleId: string
  ruleRevision: DbBigInt
  templateId: string
  audienceKey: string
  channelKey: string
  ruleVariantKey: string
}

export type NotificationTarget = {
  targetKind: "profile" | "connection" | "push_subscription" | "customer_endpoint" | "audience"
  targetKey: string
  targetProfileId: string | null
  connectionKey: string | null
  targetSnapshot: Readonly<Record<string, unknown>>
}

export type NotificationTargetSet = {
  targetGeneration: DbBigInt
  targetSetHash: string
  targets: ReadonlyArray<NotificationTarget>
}

export type NotificationResolveInput = {
  eventId: string
  workflowKey: NotificationWorkflowKey
  eventKey: string
  sourceType: string
  sourceId: string
  sourceRevision: DbBigInt | null
  payloadSchemaVersion: number
  payload: Readonly<Record<string, unknown>>
  rule: NotificationRuleSnapshot
}

export type NotificationRevalidationInput = {
  eventId: string
  deliveryId: string
  eventKey: string
  sourceType: string
  sourceId: string
  sourceRevision: DbBigInt | null
  ruleId: string
  ruleRevision: DbBigInt
  targetGeneration: DbBigInt
  scheduledFor: string
  target: NotificationTarget
}

export type NotificationRenderInput = {
  eventId: string
  workflowKey: NotificationWorkflowKey
  eventKey: string
  sourceType: string
  sourceId: string
  sourceRevision: DbBigInt | null
  payloadSchemaVersion: number
  payload: Readonly<Record<string, unknown>>
  rule: NotificationRuleSnapshot
  targetGeneration: DbBigInt
  target: NotificationTarget
  scheduledFor: string
}

export type NotificationRenderContext = Readonly<Record<string, string>>

export type NotificationRevalidationResult =
  | { ok: true }
  | {
      ok: false
      status: "canceled"
      reason: "source_status_changed" | "source_schedule_changed" | "source_revision_changed" | "rule_revision_changed" | "recipient_revoked"
    }
  | {
      ok: false
      status: "failed"
      reason: "retry_window_closed" | "schedule_validation_failed" | "payload_schema_unsupported" | "render_validation_failed"
    }

export type ScheduledOccurrenceDraft = {
  eventKey: string
  sourceType: string
  sourceId: string
  sourceRevision: DbBigInt | null
  occurrenceKey: string
  occurredAt: string
  payloadSchemaVersion: number
  payload: Readonly<Record<string, unknown>>
  materializedRuleId: string
  materializedRuleRevision: DbBigInt
  scheduledFor: string
}

export type RuleReconciliationInput = {
  jobId: string
  claimToken: string
  workflowKey: NotificationWorkflowKey
  ruleRevisionMap: Readonly<Record<string, DbBigInt>>
  cursor: string | null
  batchSize: number
}

export type RuleReconciliationBatch = {
  sources: ReadonlyArray<{ sourceType: string; sourceId: string; sourceRevision: DbBigInt | null }>
  occurrences: ReadonlyArray<ScheduledOccurrenceDraft>
  nextCursor: string | null
  done: boolean
}

export type TargetReconciliationInput = {
  jobId: string
  claimToken: string
  workflowKey: NotificationWorkflowKey
  sourceType: string
  sourceId: string
  sourceRevision: DbBigInt | null
  sourceEventId: string // authoritative immutable domain/raw event UUID, never notification_events.id
  reconciliationKind: "recipient_set_changed"
  targetGeneration: DbBigInt
  previousTargetSetHash: string
  currentTargetSetHash: string
  cursor: string | null
  batchSize: number
}

export type TargetReconciliationBatch = {
  items: ReadonlyArray<{
    eventId: string
    rule: NotificationRuleSnapshot
    scheduledFor: string
    targetSet: NotificationTargetSet
  }>
  nextCursor: string | null
  done: boolean
}

export interface NotificationWorkflowAdapter {
  workflowKey: NotificationWorkflowKey
  resolveTargets(input: NotificationResolveInput): Promise<NotificationTargetSet>
  buildRenderContext(input: NotificationRenderInput): Promise<NotificationRenderContext>
  buildDeepLink(input: NotificationRenderInput): Promise<string | null>
  revalidateBeforeSend(input: NotificationRevalidationInput): Promise<NotificationRevalidationResult>
  reconcileScheduledRules?(input: RuleReconciliationInput): Promise<RuleReconciliationBatch>
  reconcileTargets?(input: TargetReconciliationInput): Promise<TargetReconciliationBatch>
}
```

`resolveTargets` is called once per rule, so audience/channel context is never lost in a cross-rule target array. For each resolved target, the worker constructs one immutable `NotificationRenderInput`, calls both required rendering callbacks, then reads the captured immutable template and performs token replacement itself. `buildRenderContext` returns only preformatted string values; keys outside `allowed_variables`, missing used tokens, schema mismatches, raw HTML/mentions, and length violations fail before persistence/provider contact. `buildDeepLink` returns only `null` or an allowlisted same-origin `/admin/...` path; absolute, protocol-relative, script, and open-redirect paths fail. Adapters never receive template text and never return rendered title/body.

A reconciliation callback returns domain-authoritative drafts only; the common worker validates them, calls the same two rendering callbacks per draft target, renders immutable templates, and calls the matching `apply_*_batch_v1` RPC. Rule apply batches may cancel superseded unattempted deliveries and create immutable scheduled events plus fan-out jobs, but never create targets directly. Target apply batches reuse existing events, cancel/revoke the prior target generation, and insert only the current generation's deliveries. If a claimed job has no matching optional callback, it ends as `failed/reconciler_missing`; another adapter never guesses.

The apply JSON contracts are closed and snake_case. A rule batch is `{ sources: [{ source_type, source_id, source_revision }], occurrences: [{ event_key, source_type, source_id, source_revision, occurrence_key, occurred_at, payload_schema_version, payload, materialized_rule_id, materialized_rule_revision, scheduled_for }] }`. A target batch is `{ target_generation, target_set_hash, deliveries: [{ event_id, rule_id, rule_revision, template_id, target_kind, target_key, target_profile_id, connection_key, target_snapshot, rendered_title, rendered_body, href, scheduled_for }] }`. Revisions/generations are decimal strings; unknown keys, mixed workflow/source identity, unregistered payload fields, non-allowlisted hrefs, or a target hash that does not match the normalized deliveries are rejected. Apply returns only `applied | superseded`, persisted counts, and the accepted cursor; it never returns rendered bodies.

`target_generation` is the domain recipient-set version used in delivery/ownership identity; `owner_generation` is only the legacy/canonical handoff version. `commit_notification_in_app_delivery_v1` replaces generic begin/finalize for canonical `in_app`: it atomically rechecks claim/cancel/rule/recipient/ownership, inserts the `source_delivery_id`-unique inbox row with no shared row-read mutation, creates active-subscription `web_push` children and their canonical ownership reservations, marks the parent sent, and closes ownership. Shadow deliveries never call it. `begin_notification_delivery_send_v1` performs the corresponding canonical ownership `reserved -> dispatch_started` transition in the same transaction as `claimed -> sending`; finalize closes it. Legacy external-provider routes use the legacy begin/finalize pair; fixed-purpose legacy in-app uses legacy begin plus `commit_legacy_notification_in_app_projection_v1`, and transfer accepts only pre-dispatch reserved claims with no provider/inbox reference.

```ts
// src/features/notifications/server/notification-worker.ts
export type NotificationWorker = {
  runBatch(input: { workerId: string; batchSize: number; leaseSeconds: number }): Promise<{
    fanout: number
    ruleReconciliation: number
    targetReconciliation: number
    deliveries: number
    reaped: number
  }>
}

export function createNotificationWorker(input: {
  getAdapter: (workflowKey: string) => NotificationWorkflowAdapter | null
}): NotificationWorker
```

---

### Task 1: Establish the baseline and pure browser contracts

**Files:**
- Create: `src/features/notifications/notification-control-plane-types.ts`
- Create: `src/features/notifications/notification-control-plane-model.ts`
- Create: `tests/notification-control-plane-model.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `NotificationWorkflowKey`, `NotificationRuleDto`, `NotificationTemplateDto`, `NotificationControlPlaneSnapshot`, `NotificationDraft`, `NotificationPatch`, `createNotificationDraft`, `validateNotificationDraft`, `buildNotificationPatch`, and `rebaseNotificationDraft`.
- Consumes no workflow registry; rows/cells arrive from `get_notification_control_plane_v1`.

- [ ] **Step 1: Record the measured baseline**

Run:

```bash
PATH="/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH" node --test tests/*.test.mjs
```

Expected: the current baseline passes `1011` tests before notification implementation changes.

- [ ] **Step 2: Write failing model tests**

Cover exact workflow order/labels, snake_case wire-to-camelCase DTO mapping, decimal-string rule/template revisions above `Number.MAX_SAFE_INTEGER`, dirty patch minimization, invalid token rejection, missing-connection validation, clean rebase, same-field conflict preservation, and overwrite confirmation. Import the new TypeScript module directly under Node strip-types.

```js
test("rebase preserves local fields and reports same-field conflicts", () => {
  const result = rebaseNotificationDraft(base, local, remote)
  assert.deepEqual(result.conflictingFields, ["rules.rule-1.enabled"])
  assert.equal(result.draft.rules["rule-1"].enabled, true)
})
```

- [ ] **Step 3: Run the focused test and confirm the red state**

Run: `node --test --experimental-strip-types tests/notification-control-plane-model.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `notification-control-plane-model.ts`.

- [ ] **Step 4: Implement immutable draft helpers and canonical DTO unions**

Use discriminated results instead of throwing for validation/conflict paths. Browser DTOs keep revisions as strings. `buildNotificationPatch` emits only operator-changed `enabled`, `scheduleConfig`, `titleTemplate`, and `bodyTemplate` fields; the service converts these to the exact snake_case wire keys and never emits actor IDs, targets, webhook URLs, rendered text, or server revisions.

- [ ] **Step 5: Add and run the focused package script**

Add `"test:notifications": "node --test --experimental-strip-types tests/notification-control-plane-*.test.mjs"` and run `pnpm run test:notifications`.

Expected: model tests PASS; test files created in later tasks may be absent without making the shell glob fail.

- [ ] **Step 6: Commit**

```bash
git add package.json src/features/notifications/notification-control-plane-types.ts src/features/notifications/notification-control-plane-model.ts tests/notification-control-plane-model.test.mjs
git commit -m "test: define notification control plane contracts"
```

### Task 2: Add the private canonical schema and compatibility expand columns

**Files:**
- Create: `supabase/migrations/20260715090000_notification_control_plane_expand.sql`
- Create: `supabase/tests/notification_control_plane_schema_test.sql`
- Create: `tests/notification-control-plane-schema.test.mjs`

**Interfaces:**
- Produces the four canonical tables, audit log, three orchestration queues, shared request ledger, worker heartbeat state, twelve-row runtime-flag registry, dispatch ownership claims, `public.dashboard_notification_read_receipts`, exact unique keys, immutable-template deferred FKs, and nullable public compatibility columns.
- Preserves existing `dashboard_private` schema usage and every legacy table/grant needed by current bundles.

- [ ] **Step 1: Write failing source-contract and pgTAP tests**

Assert all table/column/check/index names from the approved design, `NULLS NOT DISTINCT` target-job uniqueness, one target job per authoritative domain source-event UUID rather than per rule, explicit absence of a `source_event_id -> notification_events.id` FK, event occurrence uniqueness, target-generation delivery/ownership uniqueness, separation of `target_generation` from `owner_generation`, actor-kind/profile nullability, template composite deferred FK, materialized-rule pair constraint, worker-heartbeat PII exclusion, the twelve false runtime flags, status/reason registry, and absence of anon/authenticated private-table/sequence privileges. Assert the receipt composite primary key, own-profile SELECT RLS, and absence of authenticated INSERT/UPDATE/DELETE.

```sql
select ok(to_regclass('dashboard_private.notification_events') is not null, 'private event table exists');
select is(has_table_privilege('authenticated', 'dashboard_private.notification_events', 'select'), false, 'authenticated cannot select events');
select is(has_table_privilege('authenticated', 'dashboard_private.notification_deliveries', 'insert'), false, 'authenticated cannot insert deliveries');
```

- [ ] **Step 2: Run tests and confirm missing-schema failures**

Run: `node --test tests/notification-control-plane-schema.test.mjs`

Expected: FAIL because the expand migration and locked table/function names do not exist.

- [ ] **Step 3: Implement the expand migration**

Create every field exactly as specified in `docs/superpowers/specs/2026-07-15-common-notification-control-plane-design.md`, including queue identity, cursor, lease, `target_generation`, target-set hashes/snapshots, and ownership fields. Target-job identity includes the authoritative immutable domain/raw source-event UUID plus `recipient_set_changed`; `source_event_id` is not a FK to `notification_events.id`. Dispatch ownership includes target generation. Seed the closed twelve-key `notification_runtime_flags` registry false. Add `source_delivery_id`, `revoked_at`, and `revoked_reason` to `public.dashboard_notifications`; create `public.dashboard_notification_read_receipts(notification_id,profile_id,read_at)` with composite primary key and own-profile RLS; add `webhook_url_ciphertext`, `webhook_url_mask`, `connection_state`, `revision`, `last_verified_at`, and `last_error_code` to `public.google_chat_webhook_settings`. Keep legacy `dashboard_notifications.read_at`, `webhook_url NOT NULL`, and existing browser grants in this expand migration, but grant no direct browser receipt writes.

- [ ] **Step 4: Add invariants and least privilege**

Enable RLS on every new private table, revoke all from `public`, `anon`, and `authenticated`, grant table/function access only to `service_role` or exact public wrappers, and use `set search_path = ''` on security-definer functions. Do not run a schema-wide revoke.

- [ ] **Step 5: Run source and local database tests**

Run:

```bash
node --test tests/notification-control-plane-schema.test.mjs
pnpm dlx supabase@2.109.1 test db
```

Expected: source test PASS; pgTAP PASS when Docker/local Supabase is available. On this workstation Docker and `psql` are currently absent, so record the database runtime check as pending instead of claiming it ran.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260715090000_notification_control_plane_expand.sql supabase/tests/notification_control_plane_schema_test.sql tests/notification-control-plane-schema.test.mjs
git commit -m "feat: add notification control plane schema"
```

### Task 3: Implement role-checked settings, audit, idempotency, and manual reconciliation RPCs

**Files:**
- Create: `supabase/migrations/20260715091000_notification_control_plane_settings_rpc.sql`
- Create: `src/features/notifications/notification-control-plane-service.ts`
- Create: `src/features/notifications/server/notification-auth.ts`
- Create: `src/app/api/notifications/control-plane/route.ts`
- Create: `src/app/api/notifications/deliveries/[deliveryId]/route.ts`
- Create: `tests/notification-control-plane-api.test.mjs`
- Create: `supabase/tests/notification_control_plane_runtime_test.sql`

**Interfaces:**
- Produces the exact runtime-flag, public settings, orchestration status/same-job retry, and `reconcile_notification_delivery_v1` signatures in Locked Interfaces.
- GET/save responses contain rules, current immutable templates, revisions, reconciliation state, masked recent delivery summaries, and no raw payload/body/secret.

- [ ] **Step 1: Write failing RPC/API tests**

Test authenticated flag capability read, service-role-only optimistic flag mutation, all flags false by default, admin/staff settings read/save, ordinary-user denial, no-op save, atomic stale-revision rejection, same-request/same-fingerprint replay, same-request/different-patch rejection, immutable template versioning, actor constraints, masked delivery output, admin-only unknown resolution, and attempt-count stability during manual retry approval. For all three orchestration job kinds, test safe status shape, admin/staff allow, ordinary-user denial, same failed-row retry, expected-attempt conflict, same-request replay, changed-fingerprint rejection, captured revision/cursor preservation, and succeeded/claimed/pending/nonretryable denial. Assert no status result contains payload, target, rendered body, connection, or secret; SQL/RPC wire JSON stays snake_case with bigint decimal strings and the service is the only camelCase mapper.

- [ ] **Step 2: Confirm failures**

Run: `node --test tests/notification-control-plane-api.test.mjs tests/notification-control-plane-schema.test.mjs`

Expected: FAIL for missing RPC and route files.

- [ ] **Step 3: Implement settings RPCs as narrow wrappers**

Both RPCs re-check `auth.uid()` and exact `public.current_dashboard_role() in ('admin','staff')`. Save normalizes and hashes the patch, locks changed rules in stable ID order, compares every expected revision before writing, inserts a template only when its checksum changes, increments each changed rule exactly once, appends audit rows, and records the committed JSON result in the private request ledger.

`get_notification_runtime_flags_v1` exposes only the closed boolean/revision capability map. `set_notification_runtime_flag_v1` is service-role-only, request-ledger idempotent, and rejects unknown keys or stale revisions. UI enablement requires common runtime 1. Shadow/dispatch/specialized enablement additionally requires a dynamically discovered `public.notification_workflow_adapters_runtime_version() = 1` and a successful worker heartbeat within three minutes; absence of the later marker fails closed while the common layer is deployed alone. `notification_control_plane_dispatch_registration_enabled` and all three `notification_control_plane_registration_*_adapter_enabled` flags additionally require dynamically discovered `public.registration_appointment_reminders_runtime_version() = 1`; missing function, other version, or lookup error fails closed. Enabling never reopens prior `legacy_skipped`/shadow rows. Disabling a dispatch owner atomically cancels matching `pending`/`retry_wait` as `cutover_rollback`, marks matching `claimed` with cancel request, and preserves `sending`, `sent`, `delivery_unknown`, failed, and audit history; eligible reserved ownership rows are returned for the separately audited transfer step.

Implement `get_notification_orchestration_job_status_v1` and `retry_notification_orchestration_job_v1` as exact admin/staff wrappers over a closed job-kind table map, never dynamic SQL from an unvalidated identifier. Retry locks the identified row, compares `status = failed`, manually-retryable `last_error_code`, and exact attempt count, writes the same row to pending/now with claim/lease/completed fields cleared, preserves cursor/captured revisions/generation/hash/attempt count, appends audit, and stores the safe response in the shared request ledger. It never inserts a job or repeats settings/business mutations.

- [ ] **Step 4: Implement HTTP conflict mapping and manual actions**

The control-plane HTTP wire accepts only `workflow_key`, `expected_revisions`, `patch`, and `request_id`; map `notification_revision_conflict` to HTTP 409 with the current snake_case snapshot/revisions. The delivery route accepts only `resolution`, `reason`, `request_id`, and `duplicate_risk_accepted` beside the path delivery ID; never accept body, target, phone, or webhook fields. Add service methods whose only job inputs are `(job_kind, job_id)` for status and `(job_kind, job_id, expected_attempt_count, request_id)` for retry; do not expose table names or a generic patch. `notification-control-plane-service.ts` validates every wire payload, preserves bigint strings, and maps once into camelCase browser DTOs.

- [ ] **Step 5: Run focused tests**

Run: `pnpm run test:notifications`

Expected: model, schema-source, and API tests PASS with no provider network calls.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260715091000_notification_control_plane_settings_rpc.sql supabase/tests/notification_control_plane_runtime_test.sql src/features/notifications/notification-control-plane-service.ts src/features/notifications/server/notification-auth.ts src/app/api/notifications/control-plane/route.ts src/app/api/notifications/deliveries tests/notification-control-plane-api.test.mjs
git commit -m "feat: add secure notification settings APIs"
```

### Task 4: Encrypt and manage Google Chat connections without breaking legacy readers

**Files:**
- Create: `src/features/notifications/server/notification-connection-crypto.ts`
- Create: `src/features/notifications/server/notification-connection-repository.ts`
- Create: `src/app/api/notifications/connections/route.ts`
- Create: `scripts/backfill-google-chat-webhook-encryption.mjs`
- Extend: `tests/notification-control-plane-api.test.mjs`

**Interfaces:**
- Maps `google_chat.management -> admin`, `google_chat.executive -> executive`, `google_chat.math -> math`, and `google_chat.english -> english` without renaming DB primary keys.
- Uses `NOTIFICATION_CONNECTION_ENCRYPTION_KEY` as a base64-encoded 32-byte AES-256-GCM key and stores `v1:<iv-base64url>:<tag-base64url>:<ciphertext-base64url>`.

- [ ] **Step 1: Write failing crypto/repository/API tests**

Cover round-trip encryption, wrong-key/tag rejection, strict `https://chat.googleapis.com/v1/spaces/.../messages` validation, masked-only GET, staff read/admin mutate permissions, optimistic connection revision, `legacy_active` plaintext fallback, `encrypted_active` ciphertext-only read, and `disconnected` ignoring both columns. Prove replace/backfill never contacts Google Chat; only the separately authorized verify action may invoke the injected provider fixture.

- [ ] **Step 2: Confirm failures**

Run: `node --test --experimental-strip-types tests/notification-control-plane-api.test.mjs`

Expected: FAIL for missing connection modules and route.

- [ ] **Step 3: Implement crypto, repository, and route**

PATCH encrypts before persistence and returns only connection key/state/mask/revision/verification fields. Expose verification as an explicit admin action labelled `테스트 메시지 보내기`, disclose that one Google Chat message will be posted, and require a fresh confirmation before invoking the repository with a fixed non-business test body. Never run this action during save, backfill, page load, or automated tests; production verification stores only normalized result codes and timestamps. Disconnect atomically sets `disconnected`, clears ciphertext, increments revision, and audits before returning; residual plaintext cannot reactivate it.

- [ ] **Step 4: Implement the controlled backfill**

The script lists channel keys and states only, performs no write without `--apply`, uses service-role credentials, encrypts non-empty legacy values, and never prints plaintext/ciphertext. A second `--apply` run is a no-op for `encrypted_active` rows.

- [ ] **Step 5: Run tests and dry-run**

Run:

```bash
pnpm run test:notifications
node scripts/backfill-google-chat-webhook-encryption.mjs
```

Expected: tests PASS; dry-run exits nonzero with a clear missing-environment message when credentials are absent and performs zero writes.

- [ ] **Step 6: Commit**

```bash
git add src/features/notifications/server/notification-connection-crypto.ts src/features/notifications/server/notification-connection-repository.ts src/app/api/notifications/connections/route.ts scripts/backfill-google-chat-webhook-encryption.mjs tests/notification-control-plane-api.test.mjs
git commit -m "feat: secure notification connections"
```

### Task 5: Build the durable database state machine and injectable worker core

**Files:**
- Create: `supabase/migrations/20260715092000_notification_control_plane_worker_rpc.sql`
- Create: `src/features/notifications/server/notification-workflow-adapter.ts`
- Create: `src/features/notifications/server/notification-worker.ts`
- Create: `src/features/notifications/server/legacy-in-app-projection.ts`
- Create: `src/features/notifications/server/providers/google-chat-provider.ts`
- Create: `src/features/notifications/server/providers/web-push-provider.ts`
- Create: `src/app/api/notifications/push-readiness/route.ts`
- Modify: `src/app/api/push-subscriptions/route.ts`
- Modify: `public/sw.js`
- Create: `tests/notification-control-plane-worker.test.mjs`
- Extend: `supabase/tests/notification_control_plane_runtime_test.sql`

**Interfaces:**
- Produces every producer/queue/apply/delivery/projection/ownership RPC signature in Locked Interfaces, the two required adapter rendering callbacks, the fixed-purpose legacy in-app materializer, current-profile push readiness/test boundary, and `createNotificationWorker({ getAdapter })`.
- Does not create a workflow registry, import a workflow module, expose a generic event-insert RPC, or create the cron/composition route.

- [ ] **Step 1: Write failing state-machine and worker tests**

Test event+fanout-job atomicity with exact `{event_id,fanout_job_id}` replay, one-rule-at-a-time target resolution, target-set hash stability, both required render callbacks, allowed-variable/schema/deep-link rejection, identical immediate/reconciliation render paths, `FOR UPDATE SKIP LOCKED`, queue retry/cursor identity, partial fanout replay, scheduled single-rule snapshot enforcement, first-success team-membership snapshotting, retry stability after membership changes, rule/target reconciliation callback paging, `apply_*_batch_v1` cursor replay rejection, out-of-order newer-rule and newer-target supersession, reconciler-missing fail-closed behavior, A→B→A target generations, heartbeat start/success/failure with sanitized counts, claimed lease recovery, sending lease to unknown, cancel-before-send, pre-provider recipient revocation, atomic canonical in-app projection plus push-child creation, atomic legacy compatibility projection without push child, legacy replay/rollback/ownership mismatch, revoke-without-delete, canonical/legacy ownership races, pre-dispatch generation transfer, attempt increment only at begin-send, retry backoff limits, terminal non-claimability, provider fixture classifications, and missing-adapter fail-closed behavior. Push tests cover server/key/assets/binding states and fixed self-test input rejection with an injected provider only.

- [ ] **Step 2: Confirm failures**

Run: `node --test --experimental-strip-types tests/notification-control-plane-worker.test.mjs tests/notification-control-plane-schema.test.mjs`

Expected: FAIL for missing worker modules/RPC source.

- [ ] **Step 3: Implement private producer helpers and service-role RPCs**

`record_notification_event_v1` builds `rule_snapshot` server-side, inserts the unique fanout job in the same transaction, and returns exactly the same `{event_id,fanout_job_id}` pair on occurrence replay. The first successful fan-out evaluation resolves one rule at a time, freezes its target generation/set/hash and active profile snapshot on the job/deliveries, and reuses it on retry. Canonical evaluation reads the runtime flags in the applying transaction: shadow closes as `skipped/shadow_mode`; dispatch-disabled generic work closes as `skipped/legacy_skipped`; neither reserves ownership. Every sendable canonical delivery insert from fanout, target apply, or derived push creation calls `reserve_canonical_dispatch_ownership_v1` in the same transaction; an existing legacy claim closes it as `skipped/legacy_deduped` plus `ownership_not_acquired` audit, never as an unowned pending row. `enqueue_notification_target_reconciliation_job_v1` accepts one authoritative immutable domain/raw source-event UUID plus the domain-locked target generation and whole-set hashes; it never accepts `notification_events.id`, individual previous/current target IDs, or one job per rule.

All public worker/apply/projection/ownership RPCs reject roles other than `service_role`; claims return snake_case IDs/tokens plus decimal-string revisions/generations only. The common worker pages `reconcileScheduledRules`/`reconcileTargets`; for every target it calls `buildRenderContext` and `buildDeepLink`, validates their closed outputs, renders immutable templates itself, and applies batches with compare-and-swap cursors. Apply RPCs validate job token, cursor, workflow/source/rule/generation identity and commit each cancellation/insertion page atomically; they never trust rendered content or targets from a browser. Before a rule batch applies, current stable rule revisions must still equal the job's captured map. Before a target batch applies, its live generation/hash must still equal the job's captured generation/hash. A mismatch means a newer committed job superseded this one: apply makes no canonical change and the worker finishes it successfully with a `superseded` outcome, so old work cannot reintroduce stale rules/recipients out of order. Missing callbacks close a claimed job as `failed/reconciler_missing`.

`legacy-in-app-projection.ts` accepts no title/body/href. It rereads event/rule/template, resolves the exact profile target through the matching adapter, runs the two rendering callbacks/common renderer, materializes one immutable `in_app` compatibility delivery with legacy ownership, obtains the idempotent legacy begin claim/token, and calls `commit_legacy_notification_in_app_projection_v1`. The RPC uses only stored delivery fields and atomically inserts inbox + marks sent + closes ownership; the canonical claim query excludes legacy-owned compatibility rows.

Create `visible_dashboard_notification_rows_v1` as the single private SQL relation for active visibility and effective read receipts, then implement the three locked public inbox RPCs over it. List/count never expose other users' personal rows or receipts; mark-read inserts only `(notification_id, auth.uid())`, returns `newly_read` plus the relation-derived count, and never updates compatibility `dashboard_notifications.read_at`. Canonical and legacy atomic projection commits insert no receipt; unread begins independently for each visible profile.

Immediately before provider work, the injected adapter rereads its authoritative source and returns an exact canceled/failed reason. Every authoritative source mutation marks affected claimed deliveries with `cancel_requested_at`, so canonical begin atomically rechecks that marker, source/rule snapshot, current recipient privilege, server-authoritative flag, and dispatch ownership before `claimed -> sending`; it records `reserved -> dispatch_started` and increments `attempt_count` in the same transaction. `commit_notification_in_app_delivery_v1` performs the equivalent checks and atomically inserts the inbox projection, creates push children/ownership reservations, marks the parent sent, and closes ownership without a crash gap. A lost recipient is `canceled/recipient_revoked` without provider contact; a sent unread inbox row may be revoked by target apply without rewriting its sent delivery. Finalize accepts only the closed status/reason registry and closes canonical ownership.

- [ ] **Step 4: Implement the common worker with injected adapters**

Record a `started` heartbeat before the first claim and exactly one terminal `succeeded` or `failed` heartbeat in `finally`, keyed by one run ID and containing only closed queue/delivery counts plus normalized error code. Then process fanout, rule reconciliation, target reconciliation, lease reaping, and due deliveries in bounded batches. A missing adapter fails fanout with `payload_schema_unsupported`; a missing reconciliation callback fails its job with `reconciler_missing`. The worker converts adapter camelCase drafts into snake_case apply batches, preserving decimal strings, and never imports a workflow module. `in_app` uses only the atomic commit RPC; Google Chat and Web Push providers receive only a begun delivery context and fixture-injected fetch/send functions. Timeout/reset after dispatch begins returns `delivery_unknown`; 429/definite non-acceptance can return `retry_wait`; missing connection returns `failed/connection_missing`. Ownership denial makes no provider call, closes the canonical delivery as `skipped/legacy_deduped`, and writes `ownership_not_acquired` only to audit.

Implement push readiness with canonical `NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY`, matching `WEB_PUSH_PRIVATE_KEY`, and `WEB_PUSH_CONTACT` plus legacy VAPID aliases as read-only fallback. GET returns booleans/normalized codes only. POST accepts only fixed `send_test` plus current browser endpoint, verifies that endpoint belongs to `auth.uid()`, uses fixed same-origin content, and records only normalized audit. It never accepts arbitrary target/title/body/href or enables workflow dispatch. Harden `sw.js` JSON parsing and same-origin URL validation. Automated tests inject the sender and make zero real network calls.

- [ ] **Step 5: Run focused and pgTAP tests**

Run:

```bash
pnpm run test:notifications
pnpm dlx supabase@2.109.1 test db
```

Expected: Node tests PASS with zero real Google Chat/Web Push calls; pgTAP proves concurrent claims and leases where local Supabase is available.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260715092000_notification_control_plane_worker_rpc.sql supabase/tests/notification_control_plane_runtime_test.sql src/features/notifications/server/notification-workflow-adapter.ts src/features/notifications/server/notification-worker.ts src/features/notifications/server/legacy-in-app-projection.ts src/features/notifications/server/providers src/app/api/notifications/push-readiness/route.ts src/app/api/push-subscriptions/route.ts public/sw.js tests/notification-control-plane-worker.test.mjs
git commit -m "feat: add durable notification worker core"
```

### Task 6: Add the shared global/scoped control panel and runtime marker

**Files:**
- Create: `supabase/migrations/20260715093000_notification_control_plane_runtime_marker.sql`
- Create: `src/features/notifications/notification-control-panel.tsx`
- Create: `src/features/notifications/notification-settings-workspace.tsx`
- Create: `src/features/notifications/use-notification-navigation-guard.ts`
- Create: `tests/notification-control-plane-ui.test.mjs`
- Modify: `src/app/admin/settings/notifications/page.tsx`
- Modify: `src/lib/navigation.ts`

**Interfaces:**
- `NotificationControlPanel({ workflowKey, presentation, open, onOpenChange })`, where `workflowKey` is locked in dialog mode and selected in page mode.
- Uses only the DTO/model/service from Tasks 1 and 3; server-returned settings rows define visible events/cells.

- [ ] **Step 1: Write failing UI and route tests**

Assert the seven-workflow order, `전반` label, page no longer redirecting when the server capability flag is enabled, false-flag legacy behavior, desktop matrix/mobile cards sharing one draft, impossible cells omitted, per-rule template editor, masked Connections separation, staff read-only/admin actions, recent-delivery summaries, sticky explicit save, save/recalculation split, and the three-choice dirty navigation confirmation. Source tests reject any `NEXT_PUBLIC_NOTIFICATION_CONTROL_PLANE_*` flag duplicate.

- [ ] **Step 2: Confirm failures**

Run: `node --test --experimental-strip-types tests/notification-control-plane-ui.test.mjs tests/admin-shell.test.mjs`

Expected: FAIL because the page still redirects and the shared components do not exist.

- [ ] **Step 3: Implement the panel and navigation guard**

Render matrix at `md` and cards below `md` with no page-wide horizontal overflow. Dirty interception covers X, ESC, outside click, workflow tab, captured internal links, browser back, route navigation, and `beforeunload`; `저장하고 이동` continues only after successful save, while failed/conflicted saves retain draft and navigation intent.

- [ ] **Step 4: Implement revision conflict and connection UX**

Show `최신 설정 불러오기` and `내 변경 유지`; reapply only locally changed fields and require explicit overwrite confirmation for same-field conflicts. Newly enabling Chat with a missing/broken connection is a validation error; an already-enabled disconnected rule remains visible as `연결 필요` without erasing history. Admin connection verification is rendered as the confirmed `테스트 메시지 보내기` action, never as an automatic side effect of connection save.

- [ ] **Step 5: Add the final runtime marker**

Create `public.common_notification_control_plane_runtime_version()` last, returning integer `1`, owned by postgres, executable by authenticated/service role, and readable as capability only. Source tests must verify it appears after the settings and worker migrations.

- [ ] **Step 6: Run focused tests and commit**

Run: `pnpm run test:notifications && node --test tests/admin-shell.test.mjs`

Expected: PASS.

```bash
git add supabase/migrations/20260715093000_notification_control_plane_runtime_marker.sql src/features/notifications/notification-control-panel.tsx src/features/notifications/notification-settings-workspace.tsx src/features/notifications/use-notification-navigation-guard.ts src/app/admin/settings/notifications/page.tsx src/lib/navigation.ts tests/notification-control-plane-ui.test.mjs tests/admin-shell.test.mjs
git commit -m "feat: add shared notification settings UI"
```

### Task 7: Wire scoped launchers, harden the inbox read model, and verify the common layer

**Files:**
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `src/features/makeup-requests/makeup-request-workspace.tsx`
- Modify: `src/features/approvals/approval-workspace.tsx`
- Modify: `src/features/makeup-requests/makeup-request-service.ts`
- Modify: `src/components/dashboard-notification-popover.tsx`
- Modify: `src/lib/dashboard-push-client.ts`
- Modify: `tests/ops-task-workspace.test.mjs`
- Modify: `tests/makeup-request-workspace.test.mjs`
- Modify: `tests/approval-workspace.test.mjs`
- Extend: `tests/notification-control-plane-ui.test.mjs`

**Interfaces:**
- Every workflow launcher opens the same component with one locked workflow key; no launcher owns defaults, webhook persistence, draft validation, or save behavior.
- Inbox list/count/mark call the three locked RPCs with no viewer ID; effective read state comes from the caller's receipt and both canonical and legacy team visibility use the same private relation.
- Push UI consumes `checking | unsupported | server_unconfigured | asset_missing | permission_prompt | permission_denied | subscription_missing | subscription_owner_mismatch | ready` and the fixed current-browser self-test only.

- [ ] **Step 1: Write failing scoped-launcher and inbox tests**

Cover all seven routes, global/dialog persistence parity, mobile/desktop template identity, revoked-row filtering, receipt-only per-user read state, legacy team members reading independently, list/count/mark parity, stable cursor ordering, no client grouping, revoke-without-delete/read-rewrite semantics, legacy team-row visibility, canonical catch-all removal, inline read without Link navigation/popup close, per-ID pending/error/idempotent count behavior, all push readiness states, explicit permission gesture, denied recovery copy, focus refresh, current-profile binding mismatch, and fixed self-test input. Preserve existing producer helpers and registration/SOLAPI calls.

- [ ] **Step 2: Confirm failures**

Run:

```bash
node --test --experimental-strip-types tests/notification-control-plane-ui.test.mjs tests/ops-task-workspace.test.mjs tests/makeup-request-workspace.test.mjs tests/approval-workspace.test.mjs
```

Expected: FAIL because tasks/word-retests/approvals lack the common launcher and existing pages still own local dialogs.

- [ ] **Step 3: Replace only settings launchers behind the UI flag**

Load `notification_control_plane_settings_ui_enabled` through the authenticated server capability boundary backed by `get_notification_runtime_flags_v1()`. When false, preserve current route-local settings so the expand release is backward compatible; when true, render only the common panel, never duplicate legacy and canonical settings surfaces. Cache only within one request/navigation refresh and never mirror it into a build-time public environment variable. Do not touch notification send calls in these workspaces.

- [ ] **Step 4: Harden canonical inbox reads without early grant revocation**

Replace direct table reads with `get_dashboard_notification_inbox_v1` and `get_dashboard_notification_unread_count_v1`; neither accepts viewer ID and both share `visible_dashboard_notification_rows_v1(auth.uid())`. Map receipt-derived effective `read_at` once and remove client-side content grouping. Mark through `mark_dashboard_notification_read_v1(notification_id)`, decrement only when `newly_read`, and trust its returned unread count after races. Render the navigation Link and an `읽음` sibling button rather than nesting controls; the button prevents propagation/default, keeps the popover open and route unchanged, tracks per-ID pending, and surfaces retryable error. Canonical recall updates `revoked_at` and `revoked_reason` by `source_delivery_id`; it never deletes the row or rewrites notification ID, compatibility row `read_at`, receipt, or delivery audit history. Preserve legacy writers until the workflow hardening gate; do not revoke authenticated insert in this task.

- [ ] **Step 5: Implement actionable push readiness UI**

Start in `checking`, combine server readiness, `/sw.js`/manifest HTTP status, browser API/permission, browser subscription, and server ownership binding. Request permission only inside the explicit `켜기` click. Show separate copy/actions for missing server keys/assets, permission prompt/denied, missing subscription, cross-account ownership mismatch, and ready. Refresh on profile change, popover open, focus, and `visibilitychange`. `테스트 알림 보내기` calls the fixed readiness POST for the current owned endpoint only after a confirmation and displays sent/expired/failed; it never accepts content or target input.

- [ ] **Step 6: Run complete static and build verification**

Run:

```bash
pnpm run test:notifications
node --test tests/*.test.mjs
pnpm exec tsc --noEmit
pnpm run lint
pnpm run build
git diff --check
```

Expected: notification suites pass, the full suite remains at least the measured 1011-test baseline plus new tests, TypeScript/lint/build pass, and diff check prints nothing.

- [ ] **Step 7: Perform browser QA without enabling dispatch**

On local port 3000, verify `/admin/settings/notifications` and each scoped launcher at desktop and `390x844`: dirty close/back/link, conflict recovery, template edits, missing connection, masked staff/admin states, partial/unknown recent delivery fixtures, receipt-independent team reads, inline read with unchanged URL/open popover, push permission/denied/missing-asset/binding-mismatch copy, and no horizontal page overflow. Automated/browser fixture passes keep Google Chat, Web Push, and SOLAPI provider requests at zero. In a separately confirmed manual readiness pass with matching local keys, send exactly one fixed self-test to the current browser. Before production handoff, require HTTP 200 for `/sw.js` and `/manifest.webmanifest`, successful registration/binding, and one confirmed desktop plus installed-mobile self-test; report missing VAPID/env/assets as blocked rather than claiming push works.

- [ ] **Step 8: Commit and hand off**

```bash
git add src/features/tasks/ops-task-workspace.tsx src/features/makeup-requests/makeup-request-workspace.tsx src/features/approvals/approval-workspace.tsx src/features/makeup-requests/makeup-request-service.ts src/components/dashboard-notification-popover.tsx src/lib/dashboard-push-client.ts tests/ops-task-workspace.test.mjs tests/makeup-request-workspace.test.mjs tests/approval-workspace.test.mjs tests/notification-control-plane-ui.test.mjs
git commit -m "feat: connect notification settings and inbox"
```

Handoff requirements for the next plans:

1. Registration appointments/reminders may call the two locked private producer helpers but must not change their signatures. `record_notification_event_v1` returns only `{event_id,fanout_job_id}`; `enqueue_notification_target_reconciliation_job_v1` returns the target job UUID, so domain UI returns opaque job references without direct queue reads.
2. Workflow adapters implement the exact target, render-context, deep-link, revalidation, and optional reconciliation callbacks and supply `getAdapter` at the later worker composition root.
3. The workflow-adapter cutover owns fixed-purpose replacement of `/api/google-chat` and `/api/web-push`, shared dispatch-ownership acquisition, direct-browser-writer revocation, cron activation, and dispatch flags.
4. No workflow dispatch flag is enabled until shadow comparison, ownership gating, endpoint closure, and rollback takeover tests pass; registration flags also require `registration_appointment_reminders_runtime_version() = 1`.
