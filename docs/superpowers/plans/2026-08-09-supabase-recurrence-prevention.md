# Supabase Recurrence Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 반복되는 Supabase Disk I/O 고갈의 확인된 애플리케이션 부하 원인을 제거하고 OFF 자동 작업과 고비용 RLS 평가를 중단한 뒤 운영 배포를 검증한다.

**Architecture:** 대시보드는 `classes.schedule_plan` 전체 대신 명시적 수업 필드와 기간 제한 회차 날짜 RPC를 결합한다. 공개 API와 넓은 GET 로더는 실제 취소 가능한 제한시간과 GET 재시도 차단을 사용한다. DB follow-up migration은 리마인드 설정과 cron active 상태를 일치시키고, 기존 권한 의미를 유지하면서 중복 permissive 정책과 중첩 등록 RLS 평가를 줄인다.

**Tech Stack:** Next.js 16, React 19, Supabase JS 2.103, PostgreSQL 17, PostgREST, pg_cron, Node test runner, ESLint, TypeScript.

## Global Constraints

- 유료 Supabase 플랜 변경, 고객 메시지 발송, 데이터 삭제, backfill은 하지 않는다.
- 적용된 과거 migration은 수정하지 않고 새 follow-up migration만 추가한다.
- mutation 및 provider 요청에는 자동 재시도를 추가하지 않는다.
- GET/RPC 제한시간은 `AbortSignal.timeout(...)`과 `.retry(false)`로 실제 요청을 취소한다.
- RLS는 현재 허용 범위를 넓히지 않으며 `search_path = ''`, 최소 execute 권한을 사용한다.
- 각 task는 RED 확인, 최소 GREEN, 검증, diff 확인, 독립 커밋 순서로 끝낸다.

---

### Task 1: 대시보드 수업 payload를 기간 제한 회차 날짜로 교체

**Files:**
- Create: `src/features/dashboard/session-dates.js`
- Create: `supabase/migrations/20260809090000_dashboard_class_session_dates.sql`
- Create: `tests/dashboard-resource-pressure.test.mjs`
- Modify: `src/hooks/use-tips-dashboard-metrics.ts`
- Test: `tests/dashboard-metrics.test.mjs`

**Interfaces:**
- Produces: `buildDashboardSessionDateWindow(now: Date): { dateFrom: string; dateTo: string }`
- Produces: `attachDashboardClassSessionDates(classes, rows): unknown[]`
- Produces: `public.list_dashboard_class_session_dates_v1(p_date_from date, p_date_to date)` returning `class_id`, `session_date`, `schedule_state`, `storage_mode`
- Consumes: existing `buildDashboardMetrics({ classes, students, ... })` input shape

- [ ] **Step 1: Write failing pure-behavior and source-contract tests**

```js
test("dashboard session dates preserve legacy and normalized metric shapes", () => {
  const result = attachDashboardClassSessionDates(
    [
      { id: "legacy", schedule_storage_mode: "legacy" },
      { id: "normalized", schedule_storage_mode: "normalized" },
    ],
    [
      { class_id: "legacy", session_date: "2026-08-10", schedule_state: "active", storage_mode: "legacy" },
      { class_id: "normalized", session_date: "2026-08-11", schedule_state: "makeup", storage_mode: "normalized" },
    ],
  )
  assert.deepEqual(result[0].schedule_plan.sessions, [{ date: "2026-08-10", state: "active" }])
  assert.deepEqual(result[1].lessonSessions, [{ date: "2026-08-11", scheduleState: "makeup" }])
})
```

The source-contract test must assert that dashboard class columns do not contain `schedule_plan` or `*`, the hook calls `list_dashboard_class_session_dates_v1`, and both table reads and RPC call `.abortSignal(...)` then `.retry(false)`.

- [ ] **Step 2: Run the tests and confirm RED**

Run: `node --test --experimental-strip-types tests/dashboard-resource-pressure.test.mjs tests/dashboard-metrics.test.mjs`

Expected: FAIL because `session-dates.js`, the RPC migration, and hook wiring do not exist.

- [ ] **Step 3: Implement the session-date RPC and pure adapter**

The SQL function must validate non-null dates, `p_date_to >= p_date_from`, and `(p_date_to - p_date_from) <= 400`; then return distinct rows from:

```sql
select class.id, (session.item ->> 'date')::date,
       coalesce(session.item ->> 'scheduleState', session.item ->> 'state'), 'legacy'
from public.classes class
cross join lateral pg_catalog.jsonb_array_elements(
  case when pg_catalog.jsonb_typeof(class.schedule_plan -> 'sessions') = 'array'
       then class.schedule_plan -> 'sessions' else '[]'::jsonb end
) session(item)
where coalesce(class.schedule_storage_mode, 'legacy') <> 'normalized'
  and session.item ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$'
  and (session.item ->> 'date')::date between p_date_from and p_date_to
  and coalesce(session.item ->> 'scheduleState', session.item ->> 'state', 'active') in ('active', 'makeup')
union all
select class.id, lesson.session_date, lesson.schedule_state, 'normalized'
from public.classes class
join public.class_lesson_sessions lesson on lesson.class_id = class.id
where class.schedule_storage_mode = 'normalized'
  and lesson.session_date between p_date_from and p_date_to
  and lesson.schedule_state in ('active', 'makeup');
```

Revoke from `public, anon`, grant only to `authenticated`, and add a comment describing the payload boundary.

- [ ] **Step 4: Wire the dashboard to explicit columns and bounded RPC**

Use the exact class projection:

```ts
[
  "id", "name", "subject", "grade", "teacher", "room", "schedule",
  "status", "start_date", "end_date", "student_ids", "waitlist_ids",
  "schedule_storage_mode",
].join(",")
```

Use `buildDashboardSessionDateWindow(new Date())`, call the RPC in parallel with classes/students, and pass the adapted classes to both the initial metrics and enrichment state. Remove the old normalized-only session query.

- [ ] **Step 5: Run GREEN and regression tests**

Run: `node --test --experimental-strip-types tests/dashboard-resource-pressure.test.mjs tests/dashboard-metrics.test.mjs tests/continuous-class-schedule-consumer-parity.test.mjs`

Expected: all PASS; legacy and normalized exam conflicts remain covered.

- [ ] **Step 6: Lint, diff-check, and commit**

Run: `npx eslint src/hooks/use-tips-dashboard-metrics.ts src/features/dashboard/session-dates.js tests/dashboard-resource-pressure.test.mjs`

Run: `git diff --check`

Commit: `perf: shrink dashboard class session reads`

---

### Task 2: 공개 API와 넓은 GET 로더를 fail-fast로 변경

**Files:**
- Modify: `src/server/public-classes-payload.js`
- Modify: `src/server/public-classes-api.js`
- Modify: `src/features/academic/use-academic-workspace-data.ts`
- Modify: `src/features/operations/use-operations-workspace-data.ts`
- Modify: `tests/public-classes-summary-loading.test.mjs`
- Create: `tests/supabase-read-safety.test.mjs`

**Interfaces:**
- Produces: `applyPublicClassesQuerySafety(query)` with 8,000 ms abort and `.retry(false)`
- Produces: `normalizePublicClassesFailure(error): string`
- Preserves: explicit `buildPublicClassesPayload({ mode: "full" })` compatibility path

- [ ] **Step 1: Write failing API behavior and loader source-contract tests**

Add a responder test whose fake builder records its argument and expects `{ mode: "summary" }`. Add a gateway failure test expecting a stable reason without `<html>`, Cloudflare content, URL, or token-like data. Add source contracts requiring both academic and operations query builders to contain `.abortSignal(AbortSignal.timeout(...)).retry(false)`.

- [ ] **Step 2: Run the tests and confirm RED**

Run: `node --test --experimental-strip-types tests/public-classes-summary-loading.test.mjs tests/supabase-read-safety.test.mjs`

Expected: FAIL because the responder defaults to full mode, gateway error text is exposed, and the loaders do not cancel GETs.

- [ ] **Step 3: Implement public API summary-only default and error sanitization**

Set the responder default to:

```js
buildPayload = (options) => buildPublicClassesPayload(options)
// inside respond
const payload = await buildPayload({ mode: "summary" })
```

Apply 8-second AbortSignal and `.retry(false)` to both summary and explicit full queries. Map timeout/network/522/HTML-shaped failures to `Public class data is temporarily unavailable.` and preserve only known safe configuration errors.

- [ ] **Step 4: Add actual abort and retry-off to academic and operations readers**

Use one constant per loader and this request form:

```ts
supabase!
  .from(table)
  .select("*")
  .abortSignal(AbortSignal.timeout(TABLE_TIMEOUT_MS))
  .retry(false)
```

Keep optional missing-table handling and existing result shapes unchanged. Remove Promise-race-only timeouts that leave network work running.

- [ ] **Step 5: Run GREEN, lint, and commit**

Run: `node --test --experimental-strip-types tests/public-classes-summary-loading.test.mjs tests/supabase-read-safety.test.mjs tests/continuous-class-schedule-consumer-parity.test.mjs`

Run: `npx eslint src/server/public-classes-payload.js src/server/public-classes-api.js src/features/academic/use-academic-workspace-data.ts src/features/operations/use-operations-workspace-data.ts tests/public-classes-summary-loading.test.mjs tests/supabase-read-safety.test.mjs`

Run: `git diff --check`

Commit: `fix: bound Supabase read retries`

---

### Task 3: 리마인드 OFF 상태에서 cron과 heartbeat를 정지

**Files:**
- Create: `supabase/migrations/20260809091000_registration_customer_reminder_off_cron.sql`
- Modify: `tests/registration-customer-reminder-scheduler.test.mjs`

**Interfaces:**
- Replaces: `dashboard_private.registration_customer_reminder_schedule_ready_v1()` with structural readiness
- Produces: settings `enabled` trigger that reconciles cron active state transactionally for every write path
- Replaces: `dashboard_private.invoke_registration_customer_reminder_worker_v1()` to return `null` while OFF before Vault access
- Replaces: `public.claim_registration_customer_reminder_job_v1()` to update heartbeat only while ON

- [ ] **Step 1: Write failing migration contract tests**

The new tests must extract the last `create or replace function` body and assert:

```js
assert.ok(invoke.indexOf("settings.enabled") < invoke.indexOf("registration_customer_reminder_worker_vault_v1"))
assert.ok(claim.indexOf("if not v_settings.enabled") < claim.indexOf("registration_customer_reminder_worker_heartbeats"))
assert.match(sql, /create trigger sync_registration_customer_reminder_cron_active/)
assert.match(syncTrigger, /set_registration_customer_reminder_cron_active_v1\(new\.enabled\)/)
assert.doesNotMatch(scheduleReady, /heartbeat|bool_and\(job\.active\)/)
```

Also require install/reconciliation to set active from the singleton setting.

- [ ] **Step 2: Run the scheduler test and confirm RED**

Run: `node --test --experimental-strip-types tests/registration-customer-reminder-scheduler.test.mjs`

Expected: FAIL on all four new contracts.

- [ ] **Step 3: Implement the follow-up migration**

Create a private helper `dashboard_private.set_registration_customer_reminder_cron_active_v1(p_active boolean)` that finds exactly the named cron job and calls `cron.alter_job`. Structural readiness checks one exact job name, schedule, and command only.

Keep the settings setter unchanged so all current revision/template/live checks and claimed-job release remain authoritative. Add an `after insert or update of enabled` trigger whose function calls the cron helper; an ON transition additionally validates the exact cron structure and Vault before activation, so trigger failure rolls the settings update back. `invoke` must read the setting before Vault. `claim` must read the setting before inserting heartbeat. `manage ... install` must activate according to the current singleton setting. End the migration by reconciling the existing job to the current setting; because production is OFF this disables the current minute cron without sending.

- [ ] **Step 4: Run GREEN plus worker/route regressions**

Run: `node --test --experimental-strip-types tests/registration-customer-reminder-scheduler.test.mjs tests/registration-customer-reminder-settings.test.mjs tests/registration-customer-reminder-route.test.mjs tests/registration-customer-reminder-worker.test.mjs`

Expected: all PASS and no provider call occurs in tests.

- [ ] **Step 5: Diff-check and commit**

Run: `git diff --check`

Commit: `fix: stop disabled reminder cron work`

---

### Task 4: 중복 profiles/classes/textbooks RLS와 ops_tasks initplan 정리

**Files:**
- Create: `supabase/migrations/20260809092000_rls_policy_initplan_consolidation.sql`
- Create: `tests/supabase-rls-resource-pressure.test.mjs`
- Test: `tests/management-operational-rls.test.mjs`

**Interfaces:**
- Preserves: authenticated read-all for `classes` and `textbooks`
- Preserves: admin/staff/teacher write for `classes` and `textbooks`
- Preserves: profiles self/identity read, profiles self update, viewer self insert, admin/staff all profile writes
- Preserves: existing `ops_tasks` select/insert/update/delete business conditions

- [ ] **Step 1: Write failing policy-count and expression tests**

Require the follow-up migration to drop every old overlapping policy by exact name, create one policy per command, wrap `auth.uid()`, `auth.jwt()`, and `current_dashboard_role()` in scalar selects, and avoid `FOR ALL` on the three consolidated tables.

- [ ] **Step 2: Run the tests and confirm RED**

Run: `node --test --experimental-strip-types tests/supabase-rls-resource-pressure.test.mjs tests/management-operational-rls.test.mjs`

Expected: FAIL because the consolidation migration does not exist.

- [ ] **Step 3: Implement command-specific policies with exact old unions**

Use these role predicates:

```sql
(select public.current_dashboard_role()) in ('admin', 'staff', 'teacher')
(select public.current_dashboard_role()) in ('admin', 'staff')
```

The consolidated profiles SELECT is:

```sql
id = (select auth.uid())
or lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
or (
  lower(coalesce((select auth.jwt()) ->> 'email', '')) like '%@tipsedu.co.kr'
  and lower(login_id) = split_part(lower(coalesce((select auth.jwt()) ->> 'email', '')), '@', 1)
)
or (select public.current_dashboard_role()) in ('admin', 'staff')
```

Recreate `ops_tasks` four policies with the same current role/requester/assignee/secondary-assignee/word-retest and registration direct-write conditions, changing only zero-argument request helpers to scalar selects.

- [ ] **Step 4: Run GREEN and regression tests**

Run: `node --test --experimental-strip-types tests/supabase-rls-resource-pressure.test.mjs tests/management-operational-rls.test.mjs tests/registration-track-schema.test.mjs`

- [ ] **Step 5: Diff-check and commit**

Run: `git diff --check`

Commit: `perf: consolidate high-frequency RLS policies`

---

### Task 5: 등록 하위 읽기 정책의 중첩 RLS 제거

**Files:**
- Create: `supabase/migrations/20260809093000_ops_registration_read_policy_optimization.sql`
- Modify: `tests/supabase-rls-resource-pressure.test.mjs`
- Test: `tests/registration-track-schema.test.mjs`

**Interfaces:**
- Produces: `dashboard_private.can_read_ops_task_v1(p_task_id uuid) returns boolean`
- Produces: `dashboard_private.can_read_registration_track_v1(p_track_id uuid) returns boolean`
- Preserves: the exact `ops_tasks` SELECT visibility contract

- [ ] **Step 1: Write failing helper security and policy wiring tests**

Require both helpers to be `stable security definer set search_path = ''`, owned by postgres, revoked from `public, anon, authenticated, service_role`, and to use primary-key predicates. Require task-id child policies to call `can_read_ops_task_v1` and track-id child policies to call `can_read_registration_track_v1` without an `EXISTS (... ops_tasks ...)` RLS subquery.

- [ ] **Step 2: Run the tests and confirm RED**

Run: `node --test --experimental-strip-types tests/supabase-rls-resource-pressure.test.mjs tests/registration-track-schema.test.mjs`

Expected: FAIL because the helpers and rewritten policies do not exist.

- [ ] **Step 3: Implement exact visibility helpers and SELECT policies**

`can_read_ops_task_v1` selects one `ops_tasks` PK row and applies:

```sql
role in ('admin', 'staff', 'assistant')
or task.requested_by = actor
or task.assignee_id = actor
or task.secondary_assignee_id = actor
or dashboard_private.is_ops_word_retest_teacher(task.id)
```

`can_read_registration_track_v1` resolves `track.task_id` by track PK and delegates. Rewrite SELECT policies for `ops_task_events`, `ops_registration_subject_tracks`, `ops_registration_appointments`, `ops_registration_admission_batches`, `ops_registration_details`, `ops_registration_level_tests`, `ops_registration_consultations`, and `ops_registration_enrollments`. Do not alter write policies.

- [ ] **Step 4: Run GREEN and full registration policy regressions**

Run: `node --test --experimental-strip-types tests/supabase-rls-resource-pressure.test.mjs tests/registration-track-schema.test.mjs tests/management-operational-rls.test.mjs`

- [ ] **Step 5: Diff-check and commit**

Run: `git diff --check`

Commit: `perf: flatten registration read policies`

---

### Task 6: 전체 검증, 운영 migration, main 배포, 안정성 확인

**Files:**
- Create: `docs/runbooks/supabase-resource-pressure.md`
- Modify: `docs/superpowers/plans/2026-08-09-supabase-recurrence-prevention.md` only to check completed boxes

**Interfaces:**
- Consumes: Tasks 1–5 commits
- Produces: production migration evidence, `origin/main` commit, Vercel Production `READY`, browser/runtime health evidence

- [ ] **Step 1: Write the runbook with exact read-only checks**

Include SQL for project activity/waits, `pg_stat_statements` top full reads, cron active/settings parity, recent cron failures, and payload byte measurement. Include explicit restart-only emergency guidance and a separate paid-upgrade approval gate.

- [ ] **Step 2: Run the complete local verification matrix**

Run the focused tests from Tasks 1–5, then:

```bash
npx tsc --noEmit --pretty false
npx eslint src tests middleware.ts next.config.ts
npm run build
git diff --check
git status --short
```

- [ ] **Step 3: Review migration safety before production**

Compare migration list with production, run security and performance advisors, record pre-deploy role-visible row counts and cron/settings state, and run EXPLAIN for the new session-date RPC query shape. Stop if counts cannot be reproduced or any policy widens access.

- [ ] **Step 4: Apply production migrations in order and verify each boundary**

Apply `20260809090000`, verify RPC parity/payload; apply `20260809091000`, verify OFF cron inactive and no new heartbeat/net request; apply `20260809092000`, verify role counts/advisors; apply `20260809093000`, verify role counts and EXPLAIN. Do not combine migrations into one opaque operation.

- [ ] **Step 5: Push verified commits to `main` and wait for Vercel Production**

Fetch `origin/main`, ensure it has not moved, rebase/resolve only if required, push `HEAD:main`, and verify the deployment SHA, `READY` state, custom-domain alias, route HTTP response, and runtime logs separately.

- [ ] **Step 6: Browser and soak verification**

Using the already authenticated operator session, verify `/sign-in`, `/admin/dashboard`, `/admin/registration`, `/admin/makeup-requests`, `/admin/academic-calendar`, and `/api/public-classes`. Confirm no customer message is sent. Observe Supabase API/Auth/Postgres/cron and Disk I/O for at least 30 minutes; report a guarantee only as removal of confirmed triggers plus measured stability, not an absolute impossibility of future failure.
