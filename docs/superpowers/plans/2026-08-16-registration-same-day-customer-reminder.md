# Registration Same-Day Customer Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send SOLAPI appointment reminders at 10:00 KST only for same-day level-test and visit-consultation appointments confirmed before that calendar day, while replacing manual reminder controls with read-only status and removing obsolete scheduled Google Chat UI.

**Architecture:** A forward Supabase migration adds an explicit schedule confirmation timestamp, replaces `lead_hours` appointment eligibility with KST calendar-day eligibility, exposes an authorized reminder-summary RPC, and provides a bounded continuation fence. The existing Next.js worker keeps the one-message safety boundary internally but wraps it in a bounded batch, while registration detail maps summary DTOs into appointment rows and the UI renders status without a send action. Observation reminder timing remains unchanged and continues to use the private `lead_hours` compatibility field.

**Tech Stack:** PostgreSQL 15/Supabase, pg_cron, pg_net, Next.js 16 App Router, React 19, TypeScript, Node test runner, existing SOLAPI adapter.

## Global Constraints

- Keep customer SOLAPI appointment reminders enabled; do not send a live customer message during implementation or verification.
- Execute the appointment reminder schedule at exact cron `0 1 * * *` UTC, or 10:00 KST daily.
- Include only `level_test` and `visit_consultation` appointments whose KST appointment date is today and whose current schedule was confirmed before today 00:00 KST.
- Exclude same-day creation and same-day schedule/place changes because the booking AlimTalk is the only customer message for those actions.
- Preserve observation reminder timing and its internal `lead_hours` contract.
- Preserve provider attempt, `unknown`, `failed_hold`, audit, and recipient-safety contracts; never automatically retry a provider-attempted message.
- Keep appointment persistence independent from reminder delivery.
- Remove manual appointment-reminder sending from the canonical registration workspace.
- Keep `예약 안내 알림톡` preview-before-send and human confirmation unchanged.
- Hide scheduled registration Google Chat reminder rows and remove the common `시점` presentation without deleting historical events or deliveries.
- Every database mutation must be delivered through a CLI-created forward migration; do not edit an applied migration.
- Report evidence in separate gates: source/tests, migration, `main`/Vercel, runtime, provider, recipient.

---

## File Structure

- Create via `supabase migration new registration_same_day_customer_reminders`: `supabase/migrations/*_registration_same_day_customer_reminders.sql` — authoritative forward schema, eligibility, queue, summary, and continuation contract.
- Create: `supabase/tests/registration_same_day_customer_reminders_test.sql` — pgTAP behavior around KST dates, same-day exclusion, summary authorization, and continuation.
- Create: `tests/registration-same-day-customer-reminder.test.mjs` — source-level migration and cross-layer contract guard.
- Modify: `src/features/tasks/server/registration-customer-reminder-worker.ts` — bounded batch wrapper around the existing one-provider-attempt operation.
- Modify: `src/features/tasks/server/registration-customer-reminder-route.ts` — production RPC adapters and continuation call.
- Modify: `tests/registration-customer-reminder-worker.test.mjs` — batch stopping, continuation, and provider-boundary tests.
- Modify: `tests/registration-customer-reminder-route.test.mjs` — route-level batch response and fail-closed tests.
- Modify: `src/features/tasks/registration-track-service.ts` — reminder summary type, strict parser, detail RPC read, and appointment merge.
- Modify: `tests/registration-track-service.test.mjs` — strict summary mapping and unsafe response rejection.
- Modify: `src/features/tasks/registration-appointment-editor.tsx` — read-only reminder status and removal of manual reminder action.
- Create: `tests/registration-reminder-status-ui.test.mjs` — focused canonical registration UI contract independent of existing consultation test failures.
- Modify: `src/features/notifications/notification-control-panel.tsx` — hide scheduled registration reminder rows and remove timing presentation.
- Modify: `tests/notification-control-plane-ui.test.mjs` — assert the reduced rule table and retained Google Chat editing.
- Delete: `src/features/notifications/registration-customer-reminder-settings.tsx` — unmounted editable `leadHours` UI that must not return.
- Delete: `src/features/notifications/registration-customer-reminder-service.ts` — orphaned browser settings client used only by the deleted component/tests.
- Modify: `tests/registration-customer-reminder-settings.test.mjs` — replace component/service behavior tests with a retirement guard.
- Modify: `docs/superpowers/specs/2026-08-16-registration-same-day-customer-reminder-design.md` — clarify the observation-only compatibility field; already staged in the design branch.

---

### Task 1: Same-Day Appointment Eligibility and Queue Contract

**Files:**
- Create via Supabase CLI: `supabase/migrations/*_registration_same_day_customer_reminders.sql`
- Create: `supabase/tests/registration_same_day_customer_reminders_test.sql`
- Create: `tests/registration-same-day-customer-reminder.test.mjs`
- Test: `tests/registration-customer-reminder-scheduler.test.mjs`
- Test: `tests/registration-observation-solapi-db.test.mjs`

**Interfaces:**
- Consumes: `public.ops_registration_appointments`, `dashboard_private.registration_customer_reminder_jobs`, existing SOLAPI activation/message tables, and cron `tips-registration-customer-reminder-v1`.
- Produces: `ops_registration_appointments.schedule_confirmed_at timestamptz`, `dashboard_private.registration_appointment_reminder_state_v1(appointment, now)`, updated `sync_registration_customer_reminder_jobs_v1()`, and exact daily cron readiness.

- [ ] **Step 1: Create the migration using the Supabase CLI**

Run:

```bash
supabase migration new registration_same_day_customer_reminders
```

Expected: one new empty migration ending `_registration_same_day_customer_reminders.sql`. Record that exact generated path in the task report and use it for every later command.

- [ ] **Step 2: Write the failing source-contract test**

Create `tests/registration-same-day-customer-reminder.test.mjs` with assertions equivalent to:

```js
test("appointment reminders use KST same-day eligibility instead of lead hours", async () => {
  const sql = await latestMigration("registration_same_day_customer_reminders")
  assert.match(sql, /add column schedule_confirmed_at timestamptz/)
  assert.match(sql, /at time zone 'Asia\/Seoul'/)
  assert.match(sql, /schedule_confirmed_at < v_day_start/)
  assert.match(sql, /v_send_at\s*:=\s*v_day_start\s*\+\s*interval\s*'10 hours'/)
  assert.doesNotMatch(appointmentBlock(sql), /settings\.lead_hours/)
  assert.match(observationBlock(sql), /lead_hours/)
  assert.match(sql, /job\.schedule = '0 1 \* \* \*'/)
})
```

- [ ] **Step 3: Run the source test and verify RED**

Run:

```bash
node --test tests/registration-same-day-customer-reminder.test.mjs
```

Expected: FAIL because the CLI-created migration does not yet contain `schedule_confirmed_at` or the KST eligibility function.

- [ ] **Step 4: Write pgTAP cases before production SQL**

Create fixtures in `supabase/tests/registration_same_day_customer_reminders_test.sql` that prove:

```sql
select plan(12);
-- Previous-day confirmed appointment on the current KST date is eligible.
-- Same-day created appointment is not eligible.
-- Previous-day appointment changed after KST midnight is not eligible.
-- A change before KST midnight remains eligible.
-- Canceled, completed, past-date, and future-date appointments are not due today.
-- Existing accepted/unknown/failed_hold messages prevent a new job.
-- Appointment source revision mismatch prevents claim.
-- Observation reminder SQL still reads the private lead_hours value.
-- Cron remains exactly 0 1 * * * and invokes only the reminder worker endpoint.
select * from finish();
```

- [ ] **Step 5: Implement the forward migration**

The migration must:

```sql
alter table public.ops_registration_appointments
  add column schedule_confirmed_at timestamptz;

update public.ops_registration_appointments
set schedule_confirmed_at = updated_at
where schedule_confirmed_at is null;

alter table public.ops_registration_appointments
  alter column schedule_confirmed_at set not null,
  alter column schedule_confirmed_at set default pg_catalog.clock_timestamp();
```

Replace the appointment mutation implementations so `schedule_confirmed_at` changes only when `scheduled_at` or `place` changes. Preserve replay, revision, advisory-lock, notification receipt, and permission behavior from the latest definitions.

Define a private KST boundary helper that returns:

```sql
v_day_start := date_trunc('day', p_now at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
v_day_end := v_day_start + interval '1 day';
v_send_at := v_day_start + interval '10 hours';
```

Replace only the `appointment_reminder` arm of `sync_registration_customer_reminder_jobs_v1()` so it requires:

```sql
appointment.kind in ('level_test', 'visit_consultation')
and appointment.status = 'scheduled'
and appointment.scheduled_at >= v_day_start
and appointment.scheduled_at < v_day_end
and appointment.schedule_confirmed_at < v_day_start
```

Set `due_at = v_send_at`. Keep the observation-reminder arm and its `lead_hours` calculation byte-for-byte equivalent in behavior.

- [ ] **Step 6: Run the source tests and scheduler regression tests**

Run:

```bash
node --test tests/registration-same-day-customer-reminder.test.mjs tests/registration-customer-reminder-scheduler.test.mjs tests/registration-observation-solapi-db.test.mjs
```

Expected: PASS with zero failures. Update obsolete scheduler assertions from `appointment.scheduled_at - lead_hours` to the fixed KST appointment arm while retaining an explicit observation `lead_hours` assertion.

- [ ] **Step 7: Run the isolated pgTAP test**

Run using the repository's isolated Supabase test runner:

```bash
node scripts/run-isolated-supabase-db-tests.mjs supabase/tests/registration_same_day_customer_reminders_test.sql
```

Expected: 12 planned assertions, zero failures. If Docker is unavailable, record this gate as open; do not claim DB behavior from source tests alone.

- [ ] **Step 8: Commit Task 1**

```bash
git add supabase/migrations supabase/tests/registration_same_day_customer_reminders_test.sql tests/registration-same-day-customer-reminder.test.mjs tests/registration-customer-reminder-scheduler.test.mjs tests/registration-observation-solapi-db.test.mjs
git commit -m "fix: schedule registration reminders on appointment day"
```

---

### Task 2: Authorized Reminder Summary Projection

**Files:**
- Modify: the Task 1 migration ending `_registration_same_day_customer_reminders.sql`
- Modify: `supabase/tests/registration_same_day_customer_reminders_test.sql`
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `tests/registration-track-service.test.mjs`

**Interfaces:**
- Consumes: appointment rows, reminder jobs, scheduled customer messages, and existing registration read authorization.
- Produces: `public.get_registration_customer_reminder_summaries_v1(p_task_id uuid)` and `OpsRegistrationAppointment.customerReminder`.

- [ ] **Step 1: Write failing service parser tests**

Add strict cases that expect:

```ts
type RegistrationCustomerReminderSummary = Readonly<{
  state:
    | "scheduled"
    | "not_applicable_same_day_created"
    | "not_applicable_same_day_changed"
    | "processing"
    | "sent"
    | "unknown"
    | "failed_hold"
    | "canceled"
  scheduledFor: string | null
  sentAt: string | null
  updatedAt: string
}>
```

Test exact keys, valid timestamps, closed state vocabulary, duplicate appointment IDs, task mismatch, and rejection of recipient/provider fields.

- [ ] **Step 2: Run parser tests and verify RED**

Run:

```bash
node --test --test-name-pattern='reminder summary' tests/registration-track-service.test.mjs
```

Expected: FAIL because `customerReminder` and the summary RPC read do not exist.

- [ ] **Step 3: Add the authorized summary RPC to the migration**

The RPC must authenticate with `auth.uid()`, reuse the existing registration detail read-access predicate, accept one `task_id`, and return only:

```json
{
  "appointmentId": "uuid",
  "state": "scheduled",
  "scheduledFor": "ISO timestamp or null",
  "sentAt": "ISO timestamp or null",
  "updatedAt": "ISO timestamp"
}
```

State precedence must be `sent`, `unknown`, `failed_hold`, `processing`, same-day exclusion, `scheduled`, then `canceled`. Do not expose phone numbers, template data, provider IDs, request keys, or claim tokens. Revoke execute from `PUBLIC`, `anon`, and `service_role`; grant execute only to `authenticated`, with the function still enforcing the internal actor check.

- [ ] **Step 4: Add pgTAP authorization and state cases**

Assert authorized admin/staff reads, unrelated actor denial, exact JSON keys, sent/unknown/failed precedence, same-day created versus changed distinction, and absence of secret columns.

- [ ] **Step 5: Map summaries into registration detail**

Add one parallel RPC read per task in `loadOpsRegistrationCaseDetail`, parse it strictly into a map keyed by appointment ID, and return:

```ts
type OpsRegistrationAppointment = {
  // existing fields
  scheduleConfirmedAt: string
  customerReminder: RegistrationCustomerReminderSummary
}
```

Require exactly one summary for every shared level-test/visit appointment. Reject missing, duplicate, foreign-task, or malformed rows rather than silently showing an incorrect state.

- [ ] **Step 6: Run service and pgTAP tests**

```bash
node --test --test-name-pattern='reminder summary' tests/registration-track-service.test.mjs
node scripts/run-isolated-supabase-db-tests.mjs supabase/tests/registration_same_day_customer_reminders_test.sql
```

Expected: PASS; if local Supabase is unavailable, keep the DB gate open.

- [ ] **Step 7: Commit Task 2**

```bash
git add supabase/migrations supabase/tests/registration_same_day_customer_reminders_test.sql src/features/tasks/registration-track-service.ts tests/registration-track-service.test.mjs
git commit -m "feat: expose registration reminder status"
```

---

### Task 3: Bounded Daily Worker Batch

**Files:**
- Modify: `src/features/tasks/server/registration-customer-reminder-worker.ts`
- Modify: `src/features/tasks/server/registration-customer-reminder-route.ts`
- Modify: `tests/registration-customer-reminder-worker.test.mjs`
- Modify: `tests/registration-customer-reminder-route.test.mjs`
- Modify: the Task 1 migration ending `_registration_same_day_customer_reminders.sql`

**Interfaces:**
- Consumes: existing safe single-job `runOnce()` and service-role claim/begin/finalize RPCs.
- Produces: `runBatch({ maxJobs, maxDurationMs })`, `has_registration_customer_reminder_backlog_v1()`, and coalesced continuation dispatch.

- [ ] **Step 1: Write failing worker batch tests**

Cover:

```ts
await worker.runBatch({ maxJobs: 25, maxDurationMs: 20_000 })
```

Assert that it processes multiple claims, stops on idle, stops at 25, stops at the duration boundary, counts accepted/held/unknown without retrying, and never makes a second provider attempt for one claim.

- [ ] **Step 2: Run worker tests and verify RED**

```bash
node --test tests/registration-customer-reminder-worker.test.mjs
```

Expected: FAIL because `runBatch` is undefined.

- [ ] **Step 3: Implement `runBatch` around `runOnce`**

Keep `runOnce` unchanged as the single provider boundary. Add:

```ts
async runBatch({ maxJobs, maxDurationMs }: { maxJobs: number; maxDurationMs: number }) {
  const startedAt = now().getTime()
  const outcomes = { processed: 0, providerAttempted: 0, accepted: 0, held: 0, unknown: 0 }
  while (outcomes.processed < maxJobs && now().getTime() - startedAt < maxDurationMs) {
    const result = await runOnce()
    if (!result.processed) break
    // increment closed counters only
  }
  return Object.freeze({ ok: true, ...outcomes })
}
```

Validate bounds as constants in production: `maxJobs=25`, `maxDurationMs=20_000`.

- [ ] **Step 4: Write failing continuation route tests**

Assert that the route calls the new backlog RPC after a full/non-idle batch, schedules at most one continuation when due jobs remain, does not continue on idle, and returns 503 without provider retry when the continuation RPC fails after a completed batch.

- [ ] **Step 5: Add backlog and continuation SQL**

Create service-role-only RPCs:

```sql
public.has_registration_customer_reminder_backlog_v1() returns boolean
public.continue_registration_customer_reminder_worker_v1() returns bigint
```

The backlog function must use the due pending index and exact source eligibility. The continuation function must acquire an advisory transaction lock and suppress a second continuation within the same bounded lease window before calling the existing private `pg_net` invocation.

- [ ] **Step 6: Wire route production dependencies**

The worker route runs one batch, queries backlog, and requests one continuation only when backlog remains. It must not accept batch sizes, URLs, secrets, or provider inputs from the HTTP request.

- [ ] **Step 7: Run worker and route tests**

```bash
node --test tests/registration-customer-reminder-worker.test.mjs tests/registration-customer-reminder-route.test.mjs tests/registration-observation-customer-reminder-worker.test.mjs
```

Expected: PASS with no provider calls in idle, held, or source-ineligible cases.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/features/tasks/server/registration-customer-reminder-worker.ts src/features/tasks/server/registration-customer-reminder-route.ts tests/registration-customer-reminder-worker.test.mjs tests/registration-customer-reminder-route.test.mjs supabase/migrations
git commit -m "fix: drain daily registration reminders safely"
```

---

### Task 4: Read-Only Reminder State in Registration Sections

**Files:**
- Modify: `src/features/tasks/registration-appointment-editor.tsx`
- Create: `tests/registration-reminder-status-ui.test.mjs`
- Test: `tests/registration-track-service.test.mjs`

**Interfaces:**
- Consumes: `appointment.customerReminder` from Task 2.
- Produces: `RegistrationCustomerReminderStatus` presentation with no send callback.

- [ ] **Step 1: Write the failing focused UI test**

Assert:

```js
assert.doesNotMatch(appointmentSource, /messageKind:\s*"appointment_reminder"/)
assert.doesNotMatch(appointmentSource, />\s*리마인드 알림톡\s*</)
assert.match(appointmentSource, />\s*예약 안내 알림톡\s*</)
assert.match(appointmentSource, /오전 10시 발송 예정/)
assert.match(appointmentSource, /리마인드 대상 아님 · 오늘 예약/)
assert.match(appointmentSource, /리마인드 대상 아님 · 오늘 변경/)
assert.match(appointmentSource, /리마인드 발송 완료/)
assert.match(appointmentSource, /리마인드 발송 결과 확인 필요/)
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
node --test tests/registration-reminder-status-ui.test.mjs
```

Expected: FAIL because the manual button exists and the status presenter does not.

- [ ] **Step 3: Implement the minimal status presenter**

Add a small pure label function or focused component in `registration-appointment-editor.tsx`. Render it near the booking AlimTalk action only when an appointment exists. Use KST formatting for `scheduledFor` and `sentAt`; do not infer status from browser time when the server already supplies a terminal state.

Keep the `예약 안내 알림톡` button and its dirty/save guard unchanged. Remove only the `appointment_reminder` target and its button.

- [ ] **Step 4: Run focused UI and service tests**

```bash
node --test tests/registration-reminder-status-ui.test.mjs tests/registration-track-service.test.mjs
```

Expected: focused reminder tests pass. If the pre-existing consultation assertions in another test file fail, record them separately and do not modify consultation code in this task.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/features/tasks/registration-appointment-editor.tsx tests/registration-reminder-status-ui.test.mjs
git commit -m "feat: show automatic reminder status"
```

---

### Task 5: Retire Scheduled Google Chat and Editable Lead-Time UI

**Files:**
- Modify: `src/features/notifications/notification-control-panel.tsx`
- Modify: `tests/notification-control-plane-ui.test.mjs`
- Delete: `src/features/notifications/registration-customer-reminder-settings.tsx`
- Delete: `src/features/notifications/registration-customer-reminder-service.ts`
- Modify: `tests/registration-customer-reminder-settings.test.mjs`

**Interfaces:**
- Consumes: existing parsed notification snapshot and Google Chat-only rule projection.
- Produces: immediate-rule table without timing presentation and a source guard preventing the legacy lead-time component from returning.

- [ ] **Step 1: Replace old positive UI assertions with failing retirement assertions**

In `tests/notification-control-plane-ui.test.mjs`, require the visible rule projection to exclude `registration.appointment_reminder_due`, remove the `시점` table heading, remove `notificationRuleVariantLabel`, and retain event/audience/channel/settings columns plus mobile cards.

In `tests/registration-customer-reminder-settings.test.mjs`, replace service/component behavior tests with source-tree assertions that the deleted files are absent and the canonical notification panel does not import them.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test tests/notification-control-plane-ui.test.mjs tests/registration-customer-reminder-settings.test.mjs
```

Expected: FAIL on the visible scheduled reminder rules, timing column/helper, and existing lead-time component files.

- [ ] **Step 3: Implement the minimal UI retirement**

Filter `registration.appointment_reminder_due` before `groupServerRules`. Remove the desktop timing column/cells, mobile non-immediate timing suffix, schedule editor controls reachable only from those hidden rows, and orphan imports/helpers. Keep parser vocabulary and historical server event keys intact.

Delete the unmounted `RegistrationCustomerReminderSettings` and its browser service so an editable `예약 N시간 전` control cannot be remounted accidentally. Do not delete the server settings route because observation reminders still use the private compatibility setting.

- [ ] **Step 4: Run UI retirement tests**

```bash
node --test tests/notification-control-plane-ui.test.mjs tests/registration-customer-reminder-settings.test.mjs tests/notification-control-plane-model.test.mjs tests/notification-control-plane-api.test.mjs
```

Expected: PASS; Google Chat rule editing and connection tests remain green.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/features/notifications tests/notification-control-plane-ui.test.mjs tests/registration-customer-reminder-settings.test.mjs
git commit -m "refactor: simplify registration reminder UI"
```

---

### Task 6: Integrated Verification and Release Gates

**Files:**
- Modify if required by verified contract only: files from Tasks 1-5
- Update: `docs/superpowers/specs/2026-08-16-registration-same-day-customer-reminder-design.md`
- Update: this plan's checkbox state during execution

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: verified source commit, applied migration evidence, `main`/Vercel evidence, and authenticated runtime evidence without provider sends.

- [ ] **Step 1: Run the focused regression suite**

```bash
node --test \
  tests/registration-same-day-customer-reminder.test.mjs \
  tests/registration-customer-reminder-scheduler.test.mjs \
  tests/registration-customer-reminder-worker.test.mjs \
  tests/registration-customer-reminder-route.test.mjs \
  tests/registration-observation-customer-reminder-worker.test.mjs \
  tests/registration-observation-solapi-db.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-reminder-status-ui.test.mjs \
  tests/notification-control-plane-model.test.mjs \
  tests/notification-control-plane-api.test.mjs \
  tests/notification-control-plane-ui.test.mjs \
  tests/registration-customer-reminder-settings.test.mjs
```

Expected: zero failures in the focused suite.

- [ ] **Step 2: Run typecheck and production build**

```bash
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build --webpack
```

Expected: exit 0 and all application routes generated. Do not append `-- --webpack` to `pnpm build`.

- [ ] **Step 3: Re-run pgTAP in an isolated local database**

```bash
node scripts/run-isolated-supabase-db-tests.mjs supabase/tests/registration_same_day_customer_reminders_test.sql
```

Expected: zero failures. If Docker is unavailable, stop the migration gate and report it rather than applying production SQL from source-only evidence.

- [ ] **Step 4: Verify provider-zero boundaries**

Run the existing SOLAPI provider-zero tests and assert zero outbound provider calls for source-ineligible, same-day-created, same-day-changed, idle, and migration verification cases.

```bash
node --test tests/registration-observation-solapi-provider-zero.test.mjs tests/registration-observation-solapi-provider-zero-runner.test.mjs
```

Expected: PASS with provider attempt count 0.

- [ ] **Step 5: Commit verification-only adjustments**

```bash
git status --short
git diff --check
git add docs/superpowers/specs/2026-08-16-registration-same-day-customer-reminder-design.md docs/superpowers/plans/2026-08-16-registration-same-day-customer-reminder.md
git commit -m "docs: finalize registration reminder rollout"
```

Skip the commit when no tracked changes remain.

- [ ] **Step 6: Apply the Supabase migration as a separate gate**

Before applying, inspect current settings, cron, queue counts, scheduled-message counts, and exact migration ledger. Apply only the new forward migration. Then verify:

```sql
select schedule, active from cron.job where jobname = 'tips-registration-customer-reminder-v1';
select enabled, lead_hours from dashboard_private.registration_customer_reminder_settings where singleton;
select count(*) from dashboard_private.registration_customer_reminder_jobs where status in ('pending', 'claimed');
```

Expected: cron remains `0 1 * * *` and active; appointment logic ignores `lead_hours`; no provider call is made by migration; historical messages remain unchanged.

- [ ] **Step 7: Push `main` and verify Vercel Production**

Push the reviewed commits to GitHub `main`, identify the deployment tied to the exact SHA, and wait until Vercel reports `READY`. Treat deployment and provider activation as separate evidence.

- [ ] **Step 8: Verify authenticated runtime UI**

In the authenticated production registration detail:

- `예약 안내 알림톡` remains.
- `리마인드 알림톡` manual button is absent.
- a future eligible booking shows `{date} 오전 10시 발송 예정`.
- a same-day booking/change shows the matching not-applicable status.
- no manual reminder dialog can be opened.

In environment settings:

- registration scheduled Google Chat reminder rows are absent.
- the `시점` column/mobile suffix is absent.
- immediate Google Chat rule editing and connections still render.

- [ ] **Step 9: Leave provider and recipient gates explicitly open**

Do not create a booking, invoke the worker, send SOLAPI, reconcile a provider result, or claim recipient receipt during release verification. Report provider activation as retained configuration only; verify real delivery and recipient receipt separately on an approved operational booking day.
