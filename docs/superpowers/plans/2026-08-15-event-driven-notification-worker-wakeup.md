# Event-Driven Google Chat and Teacher Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace periodic Google Chat polling with commit-triggered worker wakeups, add workflow-local delivery retry controls, and replace scheduled observation prompts with dashboard teacher tasks while adding the registration first-consultation task.

**Architecture:** A forward Supabase migration turns durable fanout inserts into coalesced `pg_net` worker wakeups and retires worker/watchdog cron schedules. The Vercel worker acknowledges generations and chains one follow-up drain only when new work arrived. Authenticated event-status/retry RPCs feed a small shared React control beside workflow actions; observation feedback and registration first-consultation tasks reuse `ops_tasks` with private idempotency links.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Postgres/PLpgSQL, `pg_net`, `pg_cron`, Node test runner, pgTAP/local Supabase QA.

## Global Constraints

- Do not modify applied migrations; add forward migrations only.
- Do not create periodic worker, watchdog, or recovery schedules.
- Preserve the separate SOLAPI daily 10:00 reminder schedule and fixed backend rules.
- Core workflow saves commit even when worker wakeup or provider delivery fails.
- Never retry a `sent` Google Chat target; `unknown` requires explicit user confirmation.
- UI status checks are limited to immediate, about 2 seconds, and about 5 seconds; no background interval or page-wide polling.
- System-created teacher tasks do not emit `task.created` Google Chat events.
- The first-parent-consultation task uses the existing general task completion action; no dedicated contact form or completion RPC.
- No customer send, production migration, or provider activation occurs during source implementation tests.

---

## File Structure

- Create `supabase/migrations/20260815120000_event_driven_notification_worker.sql`: wakeup singleton, trigger, generation callbacks, schedule retirement, event status/retry RPCs.
- Create `supabase/migrations/20260815121000_registration_teacher_followup_tasks.sql`: observation feedback and first-parent-consultation task links and mutation hooks.
- Create `src/features/notifications/notification-delivery-control.tsx`: local event status display and manual retry UI.
- Create `src/features/notifications/notification-delivery-service.ts`: authenticated status/retry calls and response validation.
- Delete `src/components/dashboard-notification-popover.tsx` and `src/components/dashboard-notification-content.tsx`: remove the retired dashboard inbox/push UI surface.
- Create `src/app/api/notifications/events/[eventId]/route.ts`: actor-authenticated event status read.
- Create `src/app/api/notifications/events/[eventId]/retry/route.ts`: actor-authenticated manual retry command.
- Modify `src/app/api/notifications/worker/route.ts`: accept and complete optional wakeup generations.
- Modify `src/features/notifications/server/notification-worker.ts`: report backlog and generation completion without self-retry loops.
- Modify `src/features/notifications/notification-control-panel.tsx`: remove delivery summary UI.
- Modify `src/features/notifications/notification-settings-workspace.tsx`: restrict settings sections to rules/connections.
- Modify `scripts/verify-notification-content-browser.mjs`: stop probing the removed dashboard notification popover.
- Modify `src/features/tasks/registration-observation-feedback-panel.tsx`: show linked feedback task state and preserve action receipt.
- Modify `src/features/tasks/registration-track-service.ts`: map task IDs and notification receipts returned by registration RPCs.
- Modify `src/features/tasks/ops-task-workspace.tsx`: render observation feedback deep link and keep first consultation as an ordinary general task.
- Test with new `tests/notification-event-driven-wakeup.test.mjs`, `tests/notification-delivery-control.test.mjs`, `tests/registration-teacher-followup-tasks.test.mjs` and focused existing notification/registration suites.

### Task 1: Coalesced Wakeup State and Cron Retirement

**Files:**
- Create: `tests/notification-event-driven-wakeup.test.mjs`
- Create: `supabase/migrations/20260815120000_event_driven_notification_worker.sql`
- Modify: `tests/notification-worker-production-schedule.test.mjs`

**Interfaces:**
- Consumes: existing `dashboard_private.notification_event_fanout_jobs`, Vault worker URL/secret, `net.http_post`, `cron.job`.
- Produces: `dashboard_private.request_notification_worker_wakeup_v1(text)`, `public.complete_notification_worker_generation_v1(bigint,boolean)`, retired `public.manage_notification_worker_schedule_v1(text,uuid)` contract.

- [ ] **Step 1: Write failing source-contract tests**

```js
test("fanout inserts request one statement-level wakeup and periodic jobs are retired", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  assert.match(sql, /after insert on dashboard_private\.notification_event_fanout_jobs[\s\S]*referencing new table as inserted_jobs[\s\S]*for each statement/i)
  assert.match(sql, /requested_generation = wakeup\.requested_generation \+ 1/i)
  assert.match(sql, /cron\.unschedule[\s\S]*tips-notification-worker-v1/i)
  assert.match(sql, /cron\.unschedule[\s\S]*tips-notification-cutover-watchdog-v1/i)
  assert.match(sql, /notification_periodic_worker_retired/i)
  assert.doesNotMatch(sql, /cron\.schedule[\s\S]*(notification-worker|watchdog|recovery)/i)
})
```

- [ ] **Step 2: Run the tests and confirm RED**

Run: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/notification-event-driven-wakeup.test.mjs tests/notification-worker-production-schedule.test.mjs`

Expected: FAIL because the forward migration and retirement assertions do not exist.

- [ ] **Step 3: Implement the singleton and statement trigger**

Create a single-row private table with exact columns:

```sql
create table dashboard_private.notification_worker_wakeup_state (
  wakeup_key text primary key check (wakeup_key = 'global'),
  requested_generation bigint not null default 0 check (requested_generation >= 0),
  active_generation bigint check (active_generation is null or active_generation > 0),
  completed_generation bigint not null default 0 check (completed_generation >= 0),
  lease_expires_at timestamptz,
  last_requested_at timestamptz,
  last_dispatched_at timestamptz,
  last_completed_at timestamptz,
  last_request_id bigint,
  last_error_code text
);
```

Implement `request_notification_worker_wakeup_v1` so it increments `requested_generation`, dispatches only when there is no live active lease, catches Vault/`pg_net` errors into a closed `last_error_code`, and never rethrows into the producer transaction. Add `AFTER INSERT ON dashboard_private.notification_event_fanout_jobs REFERENCING NEW TABLE AS inserted_jobs FOR EACH STATEMENT` and call the wakeup function only when `inserted_jobs` has rows.

- [ ] **Step 4: Retire schedules without dropping history**

Unschedule exact job names, redefine `manage_notification_worker_schedule_v1` so `install` raises `notification_periodic_worker_retired`, and make `inspect` return zero worker/watchdog active jobs. Leave heartbeat tables and the SOLAPI 10:00 reminder schedule untouched.

- [ ] **Step 5: Run focused tests and commit**

Run: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/notification-event-driven-wakeup.test.mjs tests/notification-worker-production-schedule.test.mjs`

Expected: PASS.

```bash
git add tests/notification-event-driven-wakeup.test.mjs tests/notification-worker-production-schedule.test.mjs supabase/migrations/20260815120000_event_driven_notification_worker.sql
git commit -m "feat: wake notification worker from outbox commits"
```

### Task 2: Worker Generation Completion and Single Follow-Up Drain

**Files:**
- Modify: `src/app/api/notifications/worker/route.ts`
- Modify: `src/features/notifications/server/notification-worker.ts`
- Modify: `tests/notification-control-plane-worker.test.mjs`
- Modify: `tests/notification-control-plane-api.test.mjs`

**Interfaces:**
- Consumes: optional request field `wakeup_generation: integer` and Task 1 `complete_notification_worker_generation_v1`.
- Produces: worker response `{ ok, counts, contractVersion, wakeupGeneration }`; exactly one DB-owned follow-up dispatch when requested generation advanced or indexed backlog exists.

- [ ] **Step 1: Add failing request and callback tests**

```js
assert.deepEqual(allowedBodyKeys.sort(), ["batch_size", "lease_seconds", "wakeup_generation"])
assert.deepEqual(rpcCalls.at(-1), ["complete_notification_worker_generation_v1", {
  p_generation: 7,
  p_succeeded: true,
}])
```

Cover success, failure callback, stale generation, no generation compatibility, and callback failure after a completed drain.

- [ ] **Step 2: Run worker/API tests and confirm RED**

Run: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/notification-control-plane-worker.test.mjs tests/notification-control-plane-api.test.mjs`

Expected: FAIL on the new field and callback expectations.

- [ ] **Step 3: Extend the route with bounded generation parsing**

```ts
const workerId = "notification-worker-route-v1"
const wakeupGeneration = boundedInteger(body.wakeup_generation, 0, 0, Number.MAX_SAFE_INTEGER)
let succeeded = false
try {
  const counts = await worker.runBatch({ workerId, batchSize, leaseSeconds })
  succeeded = true
  return response({ ok: true, counts, contractVersion, wakeupGeneration: wakeupGeneration || null })
} finally {
  if (wakeupGeneration > 0) {
    await client.rpc("complete_notification_worker_generation_v1", {
      p_generation: wakeupGeneration,
      p_succeeded: succeeded,
    })
  }
}
```

Keep old generation-less calls valid. Do not add a JavaScript self-fetch loop; the completion RPC owns coalescing and the one follow-up `pg_net` dispatch.

- [ ] **Step 4: Keep follow-up dispatch inside the completion RPC**

The JavaScript worker must not self-fetch. `complete_notification_worker_generation_v1` performs bounded `EXISTS` checks on claim indexes and dispatches exactly one next generation when either `requested_generation` advanced or immediate backlog remains. Add tests proving a drained queue stops and a newer generation chains once.

- [ ] **Step 5: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add src/app/api/notifications/worker/route.ts src/features/notifications/server/notification-worker.ts tests/notification-control-plane-worker.test.mjs tests/notification-control-plane-api.test.mjs
git commit -m "feat: complete notification wakeup generations"
```

### Task 3: Event Status and Manual Google Chat Retry Boundary

**Files:**
- Modify: `supabase/migrations/20260815120000_event_driven_notification_worker.sql`
- Create: `src/app/api/notifications/events/[eventId]/route.ts`
- Create: `src/app/api/notifications/events/[eventId]/retry/route.ts`
- Create: `src/features/notifications/notification-delivery-service.ts`
- Create: `tests/notification-delivery-control.test.mjs`
- Modify: `tests/notification-operations.test.mjs`

**Interfaces:**
- Produces RPC `public.get_google_chat_notification_event_status_v1(uuid)` returning `event_id,status,updated_at,reason_code,retry_allowed,confirmation_required,sent_count,total_count`.
- Produces RPC `public.retry_google_chat_notification_event_v1(uuid,uuid,boolean)` returning the same shape plus `wakeup_generation`.
- Produces client functions `readGoogleChatDeliveryStatus(eventId, signal?)` and `retryGoogleChatDelivery(eventId, requestId, confirmedAbsent)`.

- [ ] **Step 1: Write failing SQL and route tests**

Assert the status precedence `unknown > processing/delayed > failed > sent > not_applicable`, source authorization adapter use, `sent` retry rejection, confirmation for `unknown`, request-ledger idempotency, and preservation of successful targets.

```js
assert.match(sql, /when .*delivery_unknown.* then 'unknown'[\s\S]*when .*pending|sending.* then 'processing'/i)
assert.match(sql, /notification_retry_request_id_reused/i)
assert.match(sql, /status = 'sent'[\s\S]*notification_already_sent/i)
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/notification-delivery-control.test.mjs tests/notification-operations.test.mjs`

- [ ] **Step 3: Implement least-privilege RPCs**

Lock event/fanout/delivery/ownership rows in a stable order. Revalidate the source through the workflow registry already used by notification adapters. Return counts and closed reason codes only; never return webhook URL, message body, provider payload, phone number, room identity, or target profile identity.

- [ ] **Step 4: Implement authenticated routes and strict DTO parsing**

The GET route passes the actor JWT to Supabase. The POST route accepts exactly:

```ts
type RetryBody = { requestId: string; confirmedAbsent: boolean }
```

Reject unknown fields, malformed UUIDs, unauthenticated requests, and invalid RPC envelopes. Add `Cache-Control: no-store`.

- [ ] **Step 5: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add supabase/migrations/20260815120000_event_driven_notification_worker.sql src/app/api/notifications/events src/features/notifications/notification-delivery-service.ts tests/notification-delivery-control.test.mjs tests/notification-operations.test.mjs
git commit -m "feat: add manual Google Chat delivery retry"
```

### Task 4: Workflow-Local Delivery Control and Settings Cleanup

**Files:**
- Create: `src/features/notifications/notification-delivery-control.tsx`
- Delete: `src/components/dashboard-notification-popover.tsx`
- Delete: `src/components/dashboard-notification-content.tsx`
- Delete: `tests/dashboard-inbox-state.test.mjs`
- Delete: `tests/dashboard-notification-content.test.mjs`
- Modify: `src/features/notifications/notification-control-panel.tsx`
- Modify: `src/features/notifications/notification-settings-workspace.tsx`
- Modify: `scripts/verify-notification-content-browser.mjs`
- Modify: `tests/makeup-request-workspace.test.mjs`
- Modify: `tests/notification-control-plane-ui.test.mjs`
- Modify: `tests/notification-delivery-control.test.mjs`

**Interfaces:**
- Consumes: Task 3 service and a `notificationEventId` returned by a successful workflow mutation.
- Produces component `GoogleChatDeliveryControl({ eventId, onWarning })`.

- [ ] **Step 1: Write failing UI contract tests**

```js
assert.doesNotMatch(panelSource, /최근 전달|DeliverySummary|value="deliveries"/)
assert.equal(existsSync("src/components/dashboard-notification-popover.tsx"), false)
assert.equal(existsSync("src/components/dashboard-notification-content.tsx"), false)
assert.match(controlSource, /setTimeout[\s\S]*2000[\s\S]*setTimeout[\s\S]*5000/)
assert.doesNotMatch(controlSource, /setInterval/)
assert.match(controlSource, /Google Chat 재발송/)
assert.match(controlSource, /Google Chat 방에 메시지가 없음을 확인했습니다/)
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/notification-control-plane-ui.test.mjs tests/notification-delivery-control.test.mjs tests/makeup-request-workspace.test.mjs`

- [ ] **Step 3: Implement the finite status control**

Use an abortable effect for the immediate read and two `setTimeout` reads. Clear timers and abort on unmount/event change. Render nothing for `not_applicable`; render no button for `sent`; render retry for `failed`/`delayed`; require a checkbox/confirmation dialog for `unknown`.

- [ ] **Step 4: Remove settings delivery summary**

Delete `DeliverySummary`, the `deliveries` tab, and its initial-section union member. Keep the server response parser compatible with the existing delivery summary until a separate API-contract migration removes it. Keep `Google Chat 규칙`, `연결`, and mention settings. Do not expose SOLAPI rules in this workspace.

- [ ] **Step 5: Delete the retired dashboard notification UI**

Delete the unused popover/content components and their component-specific tests. Remove the popover probe from the browser QA script and direct file reads from the makeup test. Keep notification audit/inbox database history intact; this step removes only the dashboard UI and dead browser checks.

- [ ] **Step 6: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add src/features/notifications/notification-delivery-control.tsx src/features/notifications/notification-control-panel.tsx src/features/notifications/notification-settings-workspace.tsx scripts/verify-notification-content-browser.mjs tests/makeup-request-workspace.test.mjs tests/notification-control-plane-ui.test.mjs tests/notification-delivery-control.test.mjs
git add -u src/components tests
git commit -m "feat: show Google Chat status beside workflow actions"
```

### Task 5: Observation Feedback Teacher Task

**Files:**
- Create: `supabase/migrations/20260815121000_registration_teacher_followup_tasks.sql`
- Create: `tests/registration-teacher-followup-tasks.test.mjs`
- Modify: `tests/registration-observation-feedback-mutations.test.mjs`
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `src/features/tasks/ops-task-workspace.tsx`

**Interfaces:**
- Produces private link `registration_observation_feedback_tasks(observation_id unique,task_id unique,teacher_profile_id,observation_revision)`.
- Extends attendance response with `feedbackTaskId`.
- Feedback submission completes the linked task; direct generic completion is rejected with `registration_observation_feedback_required`.

- [ ] **Step 1: Write failing migration/service/UI tests**

Cover attendance replay, title/assignee/due time, no `task.created` notification source, deep link to the exact observation, feedback-only completion, teacher reassignment before completion, and immutable lifecycle-owned fields.

- [ ] **Step 2: Run tests and confirm RED**

Run: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-teacher-followup-tasks.test.mjs tests/registration-observation-feedback-mutations.test.mjs tests/registration-track-service.test.mjs tests/ops-task-workspace.test.mjs`

- [ ] **Step 3: Hook attendance and feedback mutations**

In the same attendance transaction read `v_current_session := dashboard_private.assert_registration_observation_current_session_v1(v_observation.id, 'record_attendance')`, then insert a `general` task with title `청강 피드백 작성 · {학생명} · {과목}`, `assignee_id=teacher_profile_id`, `priority=normal`, and `due_at=(v_current_session->>'endsAt')::timestamptz + interval '24 hours'`. Use `ON CONFLICT (observation_id)` on the private link. Feedback submission updates the open task to `done` and stamps `completed_at`.

- [ ] **Step 4: Add task deep-link behavior**

Map `feedbackTaskId` in the service. In general task detail, detect the private projection returned by the task read RPC and show `피드백 작성`; navigate to the exact registration task/track/observation panel. Hide the generic completion action for this linked task.

- [ ] **Step 5: Retire future observation Chat jobs**

Stop creating `registration.observation_reminder_due` and `registration.observation_feedback_due`. Cancel only pending/claimed future jobs with `scheduled_google_chat_replaced_by_task`; preserve sent deliveries and audit history.

- [ ] **Step 6: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add supabase/migrations/20260815121000_registration_teacher_followup_tasks.sql src/features/tasks/registration-track-service.ts src/features/tasks/ops-task-workspace.tsx tests/registration-teacher-followup-tasks.test.mjs tests/registration-observation-feedback-mutations.test.mjs
git commit -m "feat: assign observation feedback teacher tasks"
```

### Task 6: Registration First-Parent-Consultation General Task

**Files:**
- Modify: `supabase/migrations/20260815121000_registration_teacher_followup_tasks.sql`
- Modify: `tests/registration-teacher-followup-tasks.test.mjs`
- Modify: `tests/registration-track-schema.test.mjs`

**Interfaces:**
- Produces private link `registration_first_consultation_task_links(enrollment_id unique,task_id unique)`.
- Hooks `complete_registration_admission_batch` and first-session update/cancel paths.

- [ ] **Step 1: Add failing multi-enrollment tests**

Assert one general task per enrolled class, assignee resolution through `class_lesson_sessions.teacher_catalog_id -> profiles.teacher_catalog_id`, Korean title/memo, `start_at` at the first lesson end in `Asia/Seoul`, `due_at=start_at+24 hours`, replay dedupe, schedule/teacher synchronization, and open-task cancellation when enrollment is canceled.

- [ ] **Step 2: Run tests and confirm RED**

Run: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-teacher-followup-tasks.test.mjs tests/registration-track-schema.test.mjs`

- [ ] **Step 3: Create ordinary general tasks atomically**

For every enrollment completed by the batch, insert:

```sql
insert into public.ops_tasks(
  title,type,status,priority,requested_by,assignee_id,student_id,class_id,
  student_name,class_name,subject,start_at,due_at,memo
) values (
  '신규 등록 학부모 첫 상담 · ' || v_student_name || ' · ' || v_subject,
  'general','requested','normal',v_actor,v_teacher_profile_id,v_student_id,v_class_id,
  v_student_name,v_class_name,v_subject,v_first_lesson_end,v_first_lesson_end + interval '24 hours',
  '첫 수업 후 학부모님께 문자 또는 전화로 수업 상황을 안내하고, 앞으로 잘 부탁드린다는 인사를 전해주세요.'
);
```

Fail the registration completion transaction with `registration_first_consultation_assignee_required` if first-session teacher/profile resolution is absent or ambiguous. Do not add a dedicated task type or completion RPC.

- [ ] **Step 4: Synchronize only open tasks**

On first-session date/time/teacher changes, update `assignee_id`, `start_at`, `due_at`, class/subject snapshots only for statuses outside `done,canceled`. On enrollment/class assignment cancellation, cancel only the linked open task. Do not emit notification events for these system mutations.

- [ ] **Step 5: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add supabase/migrations/20260815121000_registration_teacher_followup_tasks.sql tests/registration-teacher-followup-tasks.test.mjs tests/registration-track-schema.test.mjs
git commit -m "feat: assign first consultation tasks after registration"
```

### Task 7: Wire Delivery Receipts into Workflow Action Surfaces

**Files:**
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `src/features/tasks/registration-observation-feedback-panel.tsx`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: notification-producing workflow services/components identified by `tests/notification-workflow-entrypoints.test.mjs`
- Modify: `tests/notification-workflow-entrypoints.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`

**Interfaces:**
- Consumes: producer response `{ notificationEventId, fanoutJobId }` and Task 4 component.
- Produces: delivery control beside each save/complete action that created a Google Chat event.

- [ ] **Step 1: Add failing entrypoint coverage**

Build a manifest in the test mapping every Google Chat-producing action to the component rendering `GoogleChatDeliveryControl`. Include registration reservation/change/cancel/teacher/feedback, general task mutations, word retest, transfer, withdrawal, makeup, and approval actions.

- [ ] **Step 2: Run tests and confirm RED**

Run: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/notification-workflow-entrypoints.test.mjs tests/registration-track-workspace.test.mjs tests/ops-task-workspace.test.mjs`

- [ ] **Step 3: Preserve receipt IDs through services**

For each producer response, validate UUIDs and return:

```ts
type NotificationReceipt = {
  notificationEventId: string | null
  fanoutJobId: string | null
}
```

Do not reconstruct event identity from task IDs or query private tables.

- [ ] **Step 4: Render the shared control at the action boundary**

Store only the most recent committed receipt for that action instance. Render the control next to the save/complete confirmation. Clear it when the source record changes or the dialog closes; do not create a global inbox/badge.

- [ ] **Step 5: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add src/features tests/notification-workflow-entrypoints.test.mjs tests/registration-track-workspace.test.mjs tests/ops-task-workspace.test.mjs
git commit -m "feat: expose Google Chat retry at workflow actions"
```

### Task 8: Full Source Verification and Release Gates

**Files:**
- Modify only if verification finds a defect in files already scoped above.

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces: a clean source/test/build checkpoint ready for separate migration, `main`, Vercel, provider, and recipient gates.

- [ ] **Step 1: Run the focused notification and registration suites**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types \
  tests/notification-event-driven-wakeup.test.mjs \
  tests/notification-worker-production-schedule.test.mjs \
  tests/notification-control-plane-worker.test.mjs \
  tests/notification-control-plane-api.test.mjs \
  tests/notification-control-plane-ui.test.mjs \
  tests/notification-delivery-control.test.mjs \
  tests/notification-operations.test.mjs \
  tests/notification-workflow-entrypoints.test.mjs \
  tests/makeup-request-workspace.test.mjs \
  tests/registration-teacher-followup-tasks.test.mjs \
  tests/registration-observation-feedback-mutations.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-track-workspace.test.mjs \
  tests/registration-track-schema.test.mjs \
  tests/ops-task-workspace.test.mjs
```

Expected: all PASS.

- [ ] **Step 2: Run lint and production build**

Run: `pnpm lint`

Run: `pnpm build`

Expected: both exit 0. Do not append another webpack flag; the package script already supplies it.

- [ ] **Step 3: Verify migration safety without applying production changes**

Run local migration replay/pgTAP using the repository Supabase QA harness. Confirm worker/watchdog/recovery schedule count is zero while the SOLAPI 10:00 reminder schedule remains one. Confirm empty-queue operation makes no recurring worker HTTP request.

- [ ] **Step 4: Commit any verification-only corrections**

```bash
git status --short
git add -u src/features/notifications src/features/tasks tests supabase/migrations
git commit -m "test: verify event driven notification operations"
```

- [ ] **Step 5: Stop at the source gate and report remaining gates separately**

Report source/tests, migration application, `main` merge/push, Vercel Production `READY`, runtime worker, Google Chat provider response, and recipient-room receipt as separate statuses. Do not call them collectively complete.
