# Operational Safety and Notification Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Remove the highest-risk mismatches on the live registration and notification surfaces first, then complete automatic history, persistent notification settings for seven workflows, per-user inbox reads, Web Push readiness, the registration appointment calendar, scheduled reminders, and duplicate-safe workflow cutovers.

**Architecture:** Deliver the work as small, reversible release trains. Canonical registration rows and atomic RPCs own registration truth; a private common notification control plane owns settings, immutable events, deliveries, receipts, leases, and audit; workflow adapters translate authoritative business events only after the common layer is ready. Existing legacy senders remain the sole delivery owner until an explicitly gated cutover, while every new dispatch flag starts false.

**Tech Stack:** Next.js 16.1.1, React 19.2.3, TypeScript 5.9, Supabase/PostgreSQL 17, date-fns 4, Radix/shadcn UI, Node.js built-in test runner, Playwright, pnpm.

## 2026-07-16 execution override

Development proceeds through the connected Supabase plugin and does not wait
for Docker, a local Supabase stack, or local pgTAP. The plugin-visible `tips
dashboard` project is healthy, its migration history includes
`20260714104301_textbook_taxonomy_arrays`, and both registration runtime markers
currently return version 1. Use plugin reads for current database truth and the
repository's migration/schema/service tests for new code. Missing local
infrastructure and provider-ledger harnesses are evidence notes, not
implementation blockers. This override supersedes the local-only stop language
below.

## Global Constraints

- The service is already in daily use. Prefer additive, forward-only changes, compatibility reads, and independently releasable commits.
- Never edit an applied migration. Add a new migration with a later timestamp.
- Never reset, delete, or overwrite unrelated user changes or any existing worktree.
- Never apply migrations to the linked production Supabase project, enable a dispatch flag, send a real Google Chat/Web Push/SOLAPI message, push, or deploy without separate user authorization.
- Automated tests inject provider transports and keep a server-side outbound-host ledger. Any non-fixture Google Chat, Web Push, or SOLAPI host makes the test fail. Workflow browser automation denies and records every delivery request to /api/google-chat, /api/web-push, and /api/solapi. The only exception is a separately named connection-management contract test that may stub non-delivery GET/PATCH locally; POST/test-message delivery remains blocked and its outbound-host ledger must stay empty.
- Preview/staging shadow creates no external request and no new inbox projection at all. A separately authorized production shadow may let the unchanged legacy owner continue its normal live sends, but canonical provider calls and canonical inbox projections must remain exactly zero.
- Preserve every active legacy sender until the same release proves and transfers its exact ownership. A canonical path and a legacy path must never both send the same occurrence.
- Canonical workflow order is exactly: tasks, word_retests, registration, transfer, withdrawal, makeup_requests, approvals. UI labels are exactly: 할 일, 영어 단어 재시험, 등록, 전반, 퇴원, 휴보강, 전자결재.
- The product-wide default input order is 누가 → 언제 → 어디서 → 무엇을 → 어떻게. Apply it to every form created or materially edited by this plan. Only a documented domain rule may override it; the exhaustive untouched-repository retrofit is a named follow-up rather than silently dropped scope.
- A phone consultation is a subject-specific queue activity, not an appointment. It has no editable reservation date/time and never appears in the appointment calendar or reminder producer.
- Appointment ID, not date, is the source of identity. Multiple appointments may share the same date and kind without colliding.
- Registration and reminder time calculations use Asia/Seoul. Persist exact timestamptz values; do not reduce appointments to date-only values.
- Obsolete reminders are canceled by appointment/rule revision. Delivery identity is idempotent and never uses scheduled time as its only key.
- PostgreSQL bigint revisions/generations cross JSON and TypeScript as decimal strings. Registration appointment notification_revision remains a PostgreSQL integer and a TypeScript number.
- SQL/RPC/HTTP wire values stay snake_case. TypeScript maps once to camelCase behind a typed service boundary.
- New common notification settings, shadow, dispatch, and specialized registration flags live in the database and seed false. Do not add a NEXT_PUBLIC duplicate as an authority.
- Do not rebuild the deferred dashboard work-summary project. No 내가 해야 할 일, 내가 요청한 일, cross-workflow count, or combined deadline list belongs in this plan.
- Do not copy registration appointments into academic_events and do not add calendar drag/resize mutation.
- Do not remove legacy registration columns, notification history, provider state, settings rows, or delivery history during this plan.
- A task is complete only after its focused tests, relevant database contract tests, type/lint/build gates, exact-route browser QA, rollback check, and provider-zero assertion pass. Code presence alone is not completion.
- The compatibility read rule for inbox history is fixed: preserve existing dashboard_notifications.read_at without backfill or clearing; use it only as a historical effective-read fallback when no per-profile receipt exists. Every new canonical or fixed-purpose legacy projection inserts read_at = null and uses receipts thereafter.

---

## 1. Authoritative documents and conflict rules

This file is the master execution and priority document for the new thread.

The approved architecture remains in:

- docs/superpowers/specs/2026-07-15-common-notification-control-plane-design.md
- docs/superpowers/specs/2026-07-15-notification-workflow-adapters-design.md
- docs/superpowers/specs/2026-07-15-registration-appointments-reminders-design.md
- docs/superpowers/specs/2026-07-15-dashboard-existing-surface-polish-design.md

The detailed task packets remain in:

- docs/superpowers/plans/2026-07-15-common-notification-control-plane.md
- docs/superpowers/plans/2026-07-15-notification-workflow-adapters.md
- docs/superpowers/plans/2026-07-15-registration-appointments-reminders.md
- docs/superpowers/plans/2026-07-15-dashboard-existing-surface-polish.md

Conflict resolution is fixed:

1. This file overrides older documents only for priority, release grouping, safety gates, and the split between independent registration work and notification-dependent work.
2. The approved specs remain authoritative for domain semantics and locked interfaces.
3. The detailed July 15 plans remain authoritative for exact subtask code and tests unless this file explicitly changes that step.
4. The most important explicit correction is that the urgent registration create path probes registration_intake_workflow_runtime_version and calls createRegistrationCaseWithInitialWorkflow. Subject-track runtime readiness alone is insufficient.
5. If a code change would violate a locked interface, stop that task and amend the plan before changing the interface.

---

## 2. Current truth snapshot

Snapshot date: 2026-07-16. Re-verify this table before implementation because line numbers and branch state may move.

### Completed locally

| Item | Evidence | Completion boundary |
| --- | --- | --- |
| Remove inaccurate dashboard task summary | commits 745e68e and current source no longer render OpsTaskDashboardSummary | Code and focused tests complete; final route smoke remains part of the release gate |
| Expose English/Math and division filters | commit a3a66b6; DashboardVisibleFilters exists | Code and focused tests complete |
| Put dashboard first in full-access navigation | commit 3610ea4; fullOverviewItems starts with dashboard | Code and focused tests complete |
| Deduplicate dashboard classroom labels | commit 61f7d4c | Code and focused tests complete |
| Defer integrated dashboard work summary | approved product decision | Explicit non-goal, not missing work |

Current main was observed at 61f7d4c9c56d4cdfcd2cb5f43290a60db2e5af4a, seven commits ahead of origin/main. Do not clone origin/main and assume it contains these changes.

### Highest-risk live-use gaps

| Priority | State | Risk | Current evidence | Completion task |
| --- | --- | --- | --- | --- |
| P0 | Partial and unsafe | Registration create shows downstream reservation fields, but the ready-mode submit path calls createRegistrationCase and then a director-default follow-up. Visible level-test/visit inputs are not passed through the canonical atomic initial-workflow RPC. | src/features/tasks/ops-task-workspace.tsx around submitForm; createRegistrationCaseWithInitialWorkflow already exists in registration-track-service.ts | Task 1 |
| P0 | Partial and misleading | Registration, transfer, and withdrawal toggles/templates are React state only. A page revisit restores defaults. Only the Google Chat webhook PATCH persists. | ops-task-workspace.tsx notification dialog/state; settings page still redirects | Task 1A immediately contains the fake controls; Tasks 4-8 build persistence; Tasks 14-21 make saved rules operational |
| P1 | Partial and misleading | Canonical registration events and a history builder exist, but the live UI still labels editable assignee/due fields as 담당자 및 일시 이력. The builder is not mounted as a read-only timeline. | write_registration_track_event v1; registration-track-history.js; ops-task-workspace.tsx editable block | Tasks 2-3 |
| P1 | Partial and unsafe for teams | Notification item navigation marks a shared dashboard_notifications.read_at and closes the popover. No sibling 읽음 button or per-profile receipt exists. | dashboard-notification-popover.tsx; makeup-request-service.ts | Task 9 |
| P1 | Partial and unproven | Service worker, subscription route, and coarse Push states exist, but assets/server-key/profile ownership/self-test readiness is not verified. | dashboard-push-client.ts and push-subscriptions route | Task 9 |
| P2 | Missing | No registration list/calendar toggle or canonical appointment projection exists. | planned calendar files and migration are absent | Task 10 |
| P2 | Missing | D-1 14:00, same-day 14:00, and one-hour reminders have no producer, rules, worker integration, revision cancellation, or shadow verification. | planned reminder producer migration/tests are absent | Tasks 11-13 |
| P2 | Missing | Seven workflow producers/adapters, common worker composition, shadow comparison, ownership cutover, and rollback drill are absent. | planned notification adapter files/migrations are absent | Tasks 14-21 |

### Important partial foundations to preserve

- registration-intake-workflow.ts already defines subjectPlans, shared level-test/visit drafts, director overrides, blockers, and normalization.
- registration-track-service.ts already exposes createRegistrationCaseWithInitialWorkflow and canonical appointment mutation methods.
- the database already has canonical parent cases, subject tracks, appointments, per-subject activities, revision checks, and version-1 registration events.
- registration-track-history.js already groups shared appointment operations and has focused tests.
- 휴보강 already persists makeup_notification_settings and templates. Import it; do not replace it with component defaults.
- current dashboard Push infrastructure is a compatibility foundation, not proof that Push works end to end.
- focused current-behavior tests passed 140/140 on 2026-07-16. Some of those tests deliberately assert the obsolete phone picker, three datetime controls, and editable history block, so green is a baseline, not acceptance of the requested behavior.

---

## 3. Release trains and dependency order

The first release is intentionally small. Do not bury the registration data-loss risk inside the notification platform project.

1. **Release A — Registration truth hotfix:** Task 0 and Task 1.
2. **Release A2 — Immediate notification-settings containment:** Task 1A. Ship this before lower-priority history work so a live user cannot mistake session-only controls for saved settings.
3. **Release B — Common notification control plane and truthful fixture/preview UI:** Tasks 4 through 9. The live common UI remains gated until ownership is operational; containment stays visible meanwhile.
4. **Release C — Honest automatic history:** Tasks 2 and 3. It may be developed in parallel after Release A, but does not jump ahead of the P0 containment.
5. **Release D — Registration calendar:** Task 10. This can be developed in parallel after Task 1, but must pass its own browser gate.
6. **Release E — Scheduled registration reminder code package:** Tasks 11 through 13. Requires Releases B and D plus Task 2's version-2 history writer. This package is mergeable/testable but not independently production-deployable; its migrations/UI processing state stay off until the worker route, schedule, adapter marker, and heartbeat arrive with Release F.
7. **Release F — Seven workflow adapters, executable worker, and cutover-support code:** Tasks 14 through 21. Requires Releases B and E. Production observation and flag changes remain post-authorization operations.
8. **Release G — Full code/preview regression, rollback rehearsal, and authorization handoff:** Task 22.

Dependency summary:

~~~text
Task 0
  -> Task 1 registration truth
      -> Task 1A fake-settings containment
      -> Tasks 4-9 common control plane
      -> Tasks 2-3 history
      -> Task 10 calendar
          + Tasks 4-9
          + Task 2 history writer
          -> Tasks 11-13 reminder producer and registration adapter
              -> Tasks 14-21 seven workflow adapters and cutover support
                  -> Task 22 code/preview release gate and authorization handoff
                      -> authorized production shadow
                          -> separately authorized owner-by-owner cutover
~~~

Release A and A2 must be independently mergeable and deployable. Releases B, C, and D must not wait for live provider credentials. Release E is code-only and must not be independently deployed/applied. Releases E and F stay dispatch-disabled through Task 22. Production shadow happens only after a deploy/migration authorization; production cutover requires a second explicit authorization after the observation gate passes.

### Mandatory gate before every independently releasable train

Focused tests are not sufficient for a release. Before any Release A, A2, B, C, D, or F merge/deploy candidate, run the following from that release worktree, then run the exact-route desktop/mobile check named by the release with provider blocking and both network ledgers enabled. Run the same gate for the Release E merge candidate, but do not deploy/apply E independently:

~~~bash
export NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
export PATH=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
"$NODE" --experimental-strip-types --test tests/*.test.mjs
pnpm exec tsc --noEmit
pnpm run lint
pnpm run build
git diff --check
~~~

Use the Supabase plugin to re-check migration history and runtime markers when a
task touches database contracts. Record the actual test counts and browser
route exercised; Docker and local pgTAP are not prerequisites for development.

---

## 4. Fresh-thread startup contract

The new thread begins with this exact instruction:

> Read docs/superpowers/plans/2026-07-16-operational-safety-and-notification-completion.md completely. Before each task, also read its named Source packet and the relevant locked-interface section of the approved spec completely; this master plan intentionally abbreviates some event catalogs and mutation contracts. Use superpowers:using-git-worktrees before implementation and superpowers:subagent-driven-development to execute one task at a time. Start with Task 0 and Task 1 only, then execute Task 1A and Tasks 4-9 before returning to lower-priority Tasks 2-3. Preserve all existing worktrees and local commits. Use the connected Supabase plugin for database truth and continue development without waiting for local Docker. Update the checkbox and evidence for each task before moving to the next release.

Recommended branch name:

~~~text
codex/operational-safety-notification-completion
~~~

Do not reuse or delete these observed worktrees:

- /Users/hyunjun/.config/superpowers/worktrees/tips_dashboard/codex-makeup-requests
- /Users/hyunjun/.config/superpowers/worktrees/tips_dashboard/public-classes-sanitized
- /Users/hyunjun/Documents/Codex/tips_dashboard/.worktrees/registration-intake-routing

If the plan file is still uncommitted when the new thread starts, read it from the root workspace and make it the only staged file before worktree creation:

~~~bash
git status --short
git add docs/superpowers/plans/2026-07-16-operational-safety-and-notification-completion.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs: add operational safety execution plan"
git rev-parse HEAD
~~~

The name-only output must contain exactly this plan. Branch the implementation worktree from that resulting HEAD. Never copy or commit unrelated dirty files.

Every shell block in this plan runs in a fresh shell. Prepend the following preamble every time, including pnpm commands, because pnpm itself needs node on PATH:

~~~bash
export NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
export PATH=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
~~~

Before every browser command, also re-export the exact OPS_BROWSER_BASE_URL recorded in the baseline evidence. Shell variables from an earlier code block do not persist automatically.

---

### Task 0: Freeze a safe baseline and prove no hidden implementation already exists

**Files:**

- Create: docs/operations/evidence/operational-safety-notification-baseline.md
- Verify only: git state, migration histories, current planned-file presence, current test baseline, local database identity, and QA server ownership.
- Do not modify application code.

**Interfaces:**

- Produces docs/operations/evidence/operational-safety-notification-baseline.md with starting HEAD, origin/main delta, dirty files, worktrees, focused/full pass counts, local and authorized-remote migration inventories, database target proof, worktree server port/PID/CWD/HEAD, and provider-zero test mode.
- Blocks Task 1 if current failures or overlapping dirty files are unexplained.

- [x] **Step 1: inspect repository and worktree state**

Run:

~~~bash
git status --short
git branch --show-current
git rev-parse HEAD
git rev-parse origin/main
git rev-list --count origin/main..HEAD
git worktree list --porcelain
~~~

Expected: the branch and exact delta are recorded. Any dirty file overlapping Task 1 is reviewed before editing. No reset, checkout-discard, or worktree deletion is allowed.

- [x] **Step 2: prove the planned common/calendar/reminder files are still absent**

Run:

~~~bash
planned_matches="$(rg --files src/features/notifications src/features/tasks supabase/migrations tests 2>/dev/null | rg "notification-control-plane|registration-appointment-calendar|registration-history-timeline|registration-appointment-reminders" || true)"
if test -n "$planned_matches"; then printf '%s\n' "$planned_matches"; fi
~~~

Expected at the authoring snapshot: the variable is empty. The inner rg normally exits 1 when it finds nothing; that is an expected no-match, not a failed baseline. If files now exist, audit them against this plan instead of recreating them.

- [x] **Step 3: prove migration names and database target are safe**

First compare every timestamp named in this plan with local filenames and local migration history. With separate read-only authorization, also inspect linked remote history; never infer it from local files. If any name/timestamp is occupied, allocate later unique timestamps, update every reference in this plan, and never overwrite an applied migration.

~~~bash
rg --files supabase/migrations | sort
pnpm dlx supabase@2.109.1 status
pnpm dlx supabase@2.109.1 migration list --local
~~~

The connected Supabase plugin now supplies the migration inventory and runtime
marker truth. Docker/local status is no longer required to continue.

- [x] **Step 4: run the focused baseline**

Run:

~~~bash
"$NODE" --experimental-strip-types --test \
  tests/admin-shell.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/registration-intake-workflow.test.mjs \
  tests/registration-track-history.test.mjs \
  tests/makeup-request-workspace.test.mjs
~~~

Expected at the authoring snapshot: 140 tests, 140 pass, 0 fail. If the count changed, require zero failures and explain the delta before Task 1.

- [x] **Step 5: run the full baseline and static checks**

Run:

~~~bash
"$NODE" --experimental-strip-types --test tests/*.test.mjs
pnpm exec tsc --noEmit
pnpm run lint
git diff --check
~~~

Expected: zero test failures, typecheck/lint pass, and diff check prints nothing. Record the actual full pass count rather than weakening assertions to match an old number.

- [x] **Step 6: create the isolated implementation worktree**

Use superpowers:using-git-worktrees. Branch from the verified current HEAD, not origin/main. Preserve every listed worktree. Run the focused baseline again inside the new worktree before editing.

- [ ] **Step 7: assign and prove the implementation worktree's browser server**

Inspect existing listeners and the current Codex terminal before choosing a port. Never kill or reuse an unrelated user/root-workspace dev server. From the implementation worktree, select a recorded free port such as 3001 and start Next there:

~~~bash
pwd -P
git rev-parse HEAD
lsof -nP -iTCP:3000 -sTCP:LISTEN || true
export OPS_BROWSER_PORT=3001
export OPS_BROWSER_BASE_URL=http://127.0.0.1:$OPS_BROWSER_PORT
"$NODE" node_modules/next/dist/bin/next dev --port "$OPS_BROWSER_PORT"
~~~

Record the spawned PID. In another fresh shell, prove its cwd is the implementation worktree with lsof -a -p PID -d cwd -Fn, record that worktree's HEAD, and only then use OPS_BROWSER_BASE_URL. Do not hard-code localhost:3000 later. If 3001 is occupied, choose another free port and update the evidence.

- [ ] **Step 8: establish the reload-capable QA and provider-zero harness**

Use the connected Supabase runtime for database truth and fixture mode for
deterministic layout/state interaction checks. Do not wait for local Docker.

The workflow browser harness aborts and records any delivery request to /api/google-chat, /api/web-push, or /api/solapi. A separately named connection-management test may stub non-delivery GET/PATCH but still aborts every POST/test-message call. Server routes receive injected fake transports and a deny-by-default outbound-host ledger; consultation/worker tests may record a simulated fixture outcome but no external host. Store only route/host/count/status metadata, never message bodies, phone numbers, endpoints, or secrets.

**Execution rule:** record unexplained failures or environment gaps, then use the
connected plugin and deterministic fixtures to keep implementation moving.

**2026-07-16 evidence:** Steps 1 through 6 passed. Focused tests passed 140/140
and the full Node suite passed 1012/1012. The Supabase plugin confirmed migration
history through `20260714104301_textbook_taxonomy_arrays`, PostgreSQL 17, and
both registration runtime markers at version 1. Steps 7 and 8 remain QA work but
do not block implementation. Full details are recorded in
`docs/operations/evidence/operational-safety-notification-baseline.md`.

---

### Task 1: Eliminate the registration create/save truth mismatch

**Priority:** P0. This is the first application-code change.

**Source packet:** Task 1 of docs/superpowers/plans/2026-07-15-registration-appointments-reminders.md and the initial-intake/runtime sections of the approved registration appointments spec.

**Files:**

- Create: src/features/tasks/registration-initial-plan-control.tsx
- Create: supabase/migrations/20260716100000_registration_intake_runtime_guard.sql
- Modify: src/features/tasks/registration-intake-workflow.ts
- Modify: src/features/tasks/registration-intake-runtime-probe.ts
- Modify: src/features/tasks/registration-track-service.ts
- Modify: src/features/tasks/registration-track-fixture-runtime.ts
- Modify: src/features/tasks/ops-task-workspace.tsx
- Modify: src/features/tasks/registration-track-fixtures.ts
- Modify: scripts/verify-ops-task-browser-workflow.mjs
- Test: tests/registration-intake-workflow.test.mjs
- Test: tests/registration-intake-runtime-probe.test.mjs
- Test: tests/registration-track-service.test.mjs
- Test: tests/registration-track-schema.test.mjs
- Test: tests/registration-track-fixtures.test.mjs
- Test: tests/ops-task-workspace.test.mjs
- Test: tests/registration-track-workspace.test.mjs
- Test: supabase/tests/registration_intake_workflow_runtime_test.sql
- Verify: tests/registration-workflow.test.mjs
- Verify: tests/registration-consultation-notification.test.mjs

**2026-07-16 preflight amendment:** the original Task 1 file list omitted the
probe and database surfaces needed to satisfy its own fail-closed contract.
The current intake probe collapses every successful non-1 value to version 0,
and the already-applied intake migration's public create wrapper does not check
either runtime marker. Preserve the applied migration and close both gaps with
the forward-only migration and direct probe/service/schema/pgTAP tests listed
above.

**Interfaces:**

- Consumes both probeRegistrationSubjectTrackRuntime() and probeRegistrationIntakeWorkflowRuntime(), plus normalizeRegistrationInitialWorkflow(), getRegistrationInitialWorkflowBlockers(), createRegistrationCase(), createRegistrationCaseWithInitialWorkflow(), and the existing visit notification target handoff.
- Produces:

~~~ts
export type RegistrationInitialPlanControlProps = {
  subjects: RegistrationSubject[]
  draft: RegistrationInitialWorkflowDraft
  resolvedDirectorIds: Partial<Record<RegistrationSubject, string>>
  directorOptionsBySubject: Record<
    RegistrationSubject,
    Array<{ value: string; label: string }>
  >
  disabled: boolean
  onChange: (draft: RegistrationInitialWorkflowDraft) => void
}
~~~

- The ready path uses RegistrationCaseCreateWithInitialWorkflowInput and one atomic RPC.
- The fallback path renders and saves inquiry-safe fields only.
- The retry envelope freezes fingerprint, requestKey, inquiryAt, and normalized initial workflow as one logical attempt.

- [ ] **Step 1: replace obsolete positive tests with failing requested-behavior tests**

Change tests/ops-task-workspace.test.mjs so the registration form contract requires:

- no 전화상담 예약일시 label or phoneConsultationAt control;
- no 시험지·결과지 URL in scheduling/create UI;
- exactly two possible DateTimePickerControl sources: level test and visit;
- 상담 책임자 before 방문상담 예약일시 before 방문상담실 in DOM order;
- import and use of probeRegistrationIntakeWorkflowRuntime;
- import and use of createRegistrationCaseWithInitialWorkflow;
- no createRegistrationCase call inside the ready initial-workflow branch;
- no persistCreatedRegistrationDirectorDefaults call after the atomic create;
- runtime-not-ready UI hides every downstream field it cannot persist;
- editing an existing canonical registration never writes appointment fields through updateOpsTask;
- registration-track-workspace tests no longer require createRegistrationCase plus persistCreatedRegistrationDirectorDefaults;
- all four runtime matrix paths and probe rejection/timeout are covered;
- changing a subject plan, appointment time/place, director, or common inquiry field rotates the request key, while an identical retry retains the whole attempt envelope;
- successful/canceled modal close clears the envelope, while a network retry does not;
- a committed create followed by visit-notification failure never replays the business create.

In a dedicated direct_phone-only normalization test in tests/registration-intake-workflow.test.mjs, assert:

~~~js
assert.equal(payload.levelTestAppointment, null)
assert.equal(payload.visitAppointment, null)
assert.equal("phoneConsultationAt" in payload, false)
assert.equal("levelTestMaterialLink" in payload, false)
~~~

In tests/registration-intake-runtime-probe.test.mjs, replace the obsolete
successful-non-1-is-version-0 assertion. Require an exact numeric 1 to be ready,
an exactly missing function to be confirmed version 0, any other numeric value
to remain observable as that wrong version, and a malformed successful response
to reject as indeterminate rather than selecting an inquiry-only fallback
writer. Add service tests proving that
the atomic create rechecks both runtimes and does not call the business RPC for
version 2, malformed, rejected, or contradictory states.

Run:

~~~bash
"$NODE" --experimental-strip-types --test \
  tests/registration-intake-workflow.test.mjs \
  tests/registration-intake-runtime-probe.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-track-schema.test.mjs \
  tests/ops-task-workspace.test.mjs
~~~

Expected: fail on the legacy phone picker/result URL, incorrect order, non-atomic ready submit, stale request fingerprint, and obsolete workspace assertions. Do not add the two-null appointment assertion to a mixed level-test/visit case, where it would contradict correct behavior.

- [ ] **Step 2: build the focused per-subject initial-plan control**

Use the existing RegistrationInitialWorkflowDraft as the only draft for downstream create choices. Reconcile it whenever selected subjects change. Render plan selectors first because they determine which branches exist.

For every subject:

- 문의 유지 reveals nothing.
- 바로 전화상담 requires/resolves a subject director and creates no datetime.
- 레벨테스트 contributes that subject to one shared level-test appointment.
- 방문상담 requires/resolves a subject director and contributes it to one shared visit appointment.

Within the visit branch, render exactly:

1. 과목별 상담 책임자;
2. 방문상담 예약일시;
3. 방문상담실;
4. read-only participating subject badges.

Within the level-test branch, render exactly:

1. 레벨테스트 예약일시;
2. 레벨테스트 장소;
3. read-only participating subject badges.

Do not map the new draft back into legacy registration.levelTestAt, phoneConsultationAt, visitConsultationAt, visitConsultationPlace, or levelTestMaterialLink fields.

- [ ] **Step 3: implement the exact two-runtime persistence matrix**

Probe both runtimes. RegistrationIntakeRuntimeState has only available and version; maintenance belongs to the subject-track runtime. Apply this matrix exactly:

| Subject-track probe | Intake probe | UI/save behavior |
| --- | --- | --- |
| maintenance | any confirmed state | Block save with the existing maintenance message |
| ready | available with version 1 | Show downstream controls and use the atomic initial-workflow create |
| ready | confirmed unavailable/version 0 | Hide downstream controls and use canonical inquiry-only createRegistrationCase |
| legacy | confirmed unavailable/version 0 | Hide downstream controls and use legacy inquiry-only createOpsTask |
| legacy | available version 1 or any contradictory confirmed combination | Block save as runtime mismatch and offer retry/upgrade; do not guess a writer |
| probe rejects, times out, is unauthorized, or is otherwise indeterminate | any | Block save, show retry, and use neither ready nor fallback |

A wrong nonzero intake version fails closed rather than being silently treated as version 0. The confirmed inquiry-only branches sanitize all stale legacy downstream fields before persistence: levelTestAt, phoneConsultationAt, visitConsultationAt, visitConsultationPlace, levelTestMaterialLink, director overrides, subject plans, and appointment drafts must not leak through hidden form state.

The ready branch normalizes once and calls:

~~~ts
const initialWorkflow = normalizeRegistrationInitialWorkflow(
  registrationInitialWorkflowDraft,
  subjects,
)

const result = await createRegistrationCaseWithInitialWorkflow({
  studentName,
  schoolGrade,
  schoolName,
  parentPhone,
  studentPhone,
  campus: normalizeRegistrationCampus(campus),
  inquiryAt,
  subjects,
  requestNote,
  priority,
  requestKey,
  subjectPlans: initialWorkflow.subjectPlans,
  levelTestAppointment: initialWorkflow.levelTestAppointment,
  visitAppointment: initialWorkflow.visitAppointment,
  directorOverrides: initialWorkflow.directorOverrides,
})
~~~

The service boundary inside createRegistrationCaseWithInitialWorkflow rechecks subject-track ready plus the exact intake runtime marker before invoking the RPC, and the database RPC also fails closed if either required marker/version is absent or wrong. UI visibility is not the security or integrity boundary.

Keep the probe state capable of distinguishing exact missing/version 0 from a
wrong nonzero response; do not coerce version 2 to 0, and reject malformed
successful responses as indeterminate. Extend the
service factory with an independently injectable intake-runtime probe so its
direct contract tests cannot accidentally pass through only the generic
subject-track gate.

Create the forward migration through
`pnpm dlx supabase@2.109.1 migration new registration_intake_runtime_guard`,
then, before applying it anywhere, rename that generated file to the verified
unoccupied reserved path
`supabase/migrations/20260716100000_registration_intake_runtime_guard.sql` so it
sorts before the later notification migrations in this plan. Do not edit
`20260714073327_registration_intake_workflow.sql`. The new migration replaces
the public `create_registration_case_with_initial_workflow_v1` wrapper without
changing its signature or grants and checks that both
`registration_subject_tracks_runtime_version()` and
`registration_intake_workflow_runtime_version()` return exactly 1 before it
delegates to the existing private implementation. Schema and pgTAP tests must
exercise each marker independently and prove its wrong, missing, and
unauthorized states create no rows.

Do not perform a second director-default mutation after the create. After the business receipt commits, hand result.notificationTargets to the existing sendRegistrationVisitNotificationTarget path with Promise.allSettled. A notification failure is reported separately and may retry only the notification target/token; it must never rerun the registration create.

- [ ] **Step 4: freeze one retry envelope for one logical submit**

On first logical submit, store this together:

~~~ts
type RegistrationCreateAttempt = {
  fingerprint: string
  requestKey: string
  inquiryAt: string
  normalizedInitialWorkflow: NormalizedRegistrationInitialWorkflow
}
~~~

The fingerprint includes normalized common inquiry fields plus normalizedInitialWorkflow. Reuse all four values for an identical network retry, including a generated inquiryAt when the visible form had none. Rotate the envelope after any logical input change or reviewed rebase. Clear it only on successful business commit, explicit cancel/close after discard, or a new blank form. A post-commit notification failure does not retain a business-create retry envelope.

- [ ] **Step 5: close the canonical edit boundary without removing real capabilities**

The generic parent edit form may edit common inquiry fields only. Existing appointment scheduling, participant changes, director changes, result URLs, and consultation outcomes open the canonical track/appointment editors. Remove legacy downstream inputs from both create and generic edit branches rather than allowing updateOpsTask to write compatibility columns.

Add regression coverage that an existing canonical case can still reschedule, change participants/director, and record a level-test result URL through the canonical appointment/attempt editors after the generic legacy inputs disappear.

- [ ] **Step 6: extend deterministic fixture receipts and runtime controls**

Add a fixture case with:

- English: direct_phone with its own director;
- Mathematics: visit with a different director;
- one visit appointment for Mathematics;
- no phone appointment;
- no level-test result URL at scheduling;
- exact normalized payload recorded in the fixture receipt.

Allow the fixture runtime or an explicit probe mock to represent unavailable, wrong-version, maintenance, rejection, and timeout without weakening production runtime checks. Cover every matrix row and an induced atomic RPC failure. A failed RPC must create no parent, track, consultation, appointment, or event fixture row.

- [ ] **Step 7: update the browser verifier and pass focused/registration tests**

Remove the obsolete telephone-reservation assertion from scripts/verify-ops-task-browser-workflow.mjs and add assertions for no phone datetime, no scheduling-time result URL, correct 5W1H visit order, and canonical reload.

Run:

~~~bash
"$NODE" --experimental-strip-types --test \
  tests/registration-intake-workflow.test.mjs \
  tests/registration-intake-runtime-probe.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-track-schema.test.mjs \
  tests/registration-track-fixtures.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/registration-track-workspace.test.mjs \
  tests/registration-workflow.test.mjs \
  tests/registration-consultation-notification.test.mjs
pnpm exec tsc --noEmit
git diff --check
~~~

Expected: all pass; source has no phone scheduling control, scheduling-time result URL, or ready-path createRegistrationCase call.

- [ ] **Step 8: run exact-route browser QA**

Use the Task 0 worktree-owned OPS_BROWSER_BASE_URL and deterministic fixture
runtime for frontend interaction, plus Supabase plugin reads for current
database/runtime truth. Do not wait for local Docker. At desktop 1349x987 and
mobile 390x844 on /admin/registration:

1. Open 등록 추가.
2. Select English direct phone and Mathematics visit.
3. Confirm owner → visit time → room order.
4. Confirm no phone datetime and no result URL.
5. Save once, reopen the fixture case, and verify canonical English phone waiting plus one Mathematics visit appointment.
6. Confirm no duplicate appointment or track.
7. Simulate retry with the same request key and confirm the same receipt in the fixture ledger.
8. Through canonical editors, reschedule/change participants/change director and record a level-test result URL; reload and confirm each persisted through its canonical path.
9. Confirm blocked browser provider routes are empty and the server outbound-host ledger is empty. A simulated visit-notification outcome may exist only in the injected fixture transport ledger.

Expected: saved UI and reloaded canonical data match exactly.

- [ ] **Step 9: run the mandatory release gate and commit Release A**

Run the full Mandatory gate before every independently releasable train, then the browser check above. Do not call Release A independently deployable on focused tests alone.

~~~bash
git add \
  src/features/tasks/registration-initial-plan-control.tsx \
  src/features/tasks/registration-intake-workflow.ts \
  src/features/tasks/registration-intake-runtime-probe.ts \
  src/features/tasks/registration-track-service.ts \
  src/features/tasks/registration-track-fixture-runtime.ts \
  src/features/tasks/ops-task-workspace.tsx \
  src/features/tasks/registration-track-fixtures.ts \
  supabase/migrations/20260716100000_registration_intake_runtime_guard.sql \
  supabase/tests/registration_intake_workflow_runtime_test.sql \
  scripts/verify-ops-task-browser-workflow.mjs \
  tests/registration-intake-workflow.test.mjs \
  tests/registration-intake-runtime-probe.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-track-schema.test.mjs \
  tests/registration-track-fixtures.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/registration-track-workspace.test.mjs
git commit -m "fix: make registration intake save canonical"
~~~

**Release A gate:** This commit can ship independently only after the browser reload proves the visible fields became canonical rows and every provider ledger remains zero.

---

### Task 1A: Contain the nonpersistent notification controls immediately

**Priority:** P0 containment. This does not complete shared settings; it prevents live users from believing unsaved session state is durable while Tasks 4-21 are built.

**Files:**

- Modify: src/features/tasks/ops-task-workspace.tsx
- Modify: tests/ops-task-workspace.test.mjs
- Verify: src/features/makeup-requests/makeup-request-workspace.tsx
- Verify: tests/makeup-request-workspace.test.mjs

**Boundary:**

- Registration, transfer, and withdrawal session-only toggles/template editors are hidden or disabled behind honest non-editable copy.
- The existing persisted Google Chat connection/webhook action remains available and is visually separated as a real saved connection action.
- Current legacy sender defaults and side-effect ownership are unchanged; this containment commit neither enables nor disables delivery.
- 휴보강's genuinely persisted settings stay available. Do not incorrectly contain them.

- [x] **Step 1: write failing containment tests**

Require no clickable session-only toggle, editable message field, 저장 claim, or success toast on registration/transfer/withdrawal. Require explicit copy that these controls are unavailable until persistent shared settings are enabled. Require the persisted webhook action and current live sender code to remain present.

- [x] **Step 2: implement the smallest honest state**

Keep the settings launcher if operators need the webhook connection, but render a separate read-only notice where fake controls were. Never label a close action 저장. Do not add localStorage or a second temporary persistence model.

Evidence: the focused test packet first failed 95/96 on the missing containment surface, then passed 96/96 after the shared registration/transfer/withdrawal dialog was reduced to honest read-only copy plus the separately persisted Google Chat webhook action. The full Node suite passed 1032/1032; typecheck, lint, build, and diff-check passed. 휴보강's persisted settings regression remained green.

- [ ] **Step 3: run route QA and the mandatory Release A2 gate**

At desktop/mobile, open each registration/transfer/withdrawal settings surface, confirm no fake setting can be edited, close/reopen it, and verify webhook management remains clear. Run the full mandatory release gate and provider-zero harness.

- [x] **Step 4: commit**

~~~bash
git add \
  src/features/tasks/ops-task-workspace.tsx \
  tests/ops-task-workspace.test.mjs
git commit -m "fix: contain nonpersistent notification controls"
~~~

Evidence: commit `3e13dc8` contains the independently reviewed containment implementation and its local gate report.

**Release A2 gate:** no live control implies persistence before the common settings and active-sender ownership path are ready. This is containment, not completion of the user's saved-settings request; that P0 remains open until the live common panel and matching sender ownership are enabled after authorized rollout.

---

### Task 2: Record explicit version-2 registration actors and timestamps

**Priority:** P1. Required before the read-only timeline.

**Files:**

- Create: supabase/migrations/20260716114000_registration_history_v2.sql
- Modify: src/features/tasks/registration-track-service.ts
- Test: tests/registration-track-schema.test.mjs
- Test: tests/registration-track-service.test.mjs
- Test: supabase/tests/registration_subject_tracks_runtime_test.sql

**Interfaces:**

- Produces OpsRegistrationTrackEvent.actorKind, systemSource, reasonCode, and payloadVersion.
- Produces private write_registration_track_event_v2(
  p_task_id uuid,
  p_track_id uuid,
  p_event_type text,
  p_source text,
  p_destination text,
  p_reason_code text,
  p_metadata jsonb,
  p_actor_kind text,
  p_system_source text
  ) returning the raw event UUID.
- Preserves the existing seven-argument version-1 function signature. Its new body delegates exactly once to write_registration_track_event_v2 with actor_kind = user for authenticated callers. Automated/system/migration writers call v2 explicitly rather than passing through v1.

- [ ] **Step 1: write failing parser and migration source tests**

Assert user, system, and migration actor kinds; stable systemSource; returned raw event UUID; same-transaction rollback; honest historical version-1 null actors; and source proof that no authoritative mutation calls both v1 and v2 for one transition. A historical version-1 null actor must remain null and render 알 수 없음.

- [ ] **Step 2: add the forward-only event writer**

Server-author the payload:

~~~sql
jsonb_build_object(
  'version', 2,
  'event_type', p_event_type,
  'actor_profile_id',
    case when p_actor_kind = 'user' then auth.uid() else null end,
  'actor_kind', p_actor_kind,
  'system_source', nullif(btrim(p_system_source), ''),
  'track_id', p_track_id,
  'subject', v_subject,
  'source', p_source,
  'destination', p_destination,
  'reason_code', nullif(btrim(p_reason_code), ''),
  'metadata', coalesce(p_metadata, '{}'::jsonb),
  'occurred_at', v_occurred_at
)
~~~

Accept only user, system, or migration. Require auth.uid() for user, require a stable source for system, and force migration profile ID null. The seven-argument wrapper performs one v2 call and no separate insert. pgTAP must prove each authoritative mutation adds exactly one process event, including rollback/replay paths.

- [ ] **Step 3: decode both versions without inference**

Map v2 snake_case once. Map the version-1 reason only for display compatibility. Never infer system/migration from a null actor or current owner.

- [ ] **Step 4: run Node and authorized ephemeral database tests**

~~~bash
"$NODE" --experimental-strip-types --test \
  tests/registration-track-schema.test.mjs \
  tests/registration-track-service.test.mjs
pnpm dlx supabase@2.109.1 test db
~~~

Expected: Node passes; pgTAP proves actor validation, grants, rollback, and compatibility. The pgTAP command runs only against an explicitly authorized local/preview database.

- [ ] **Step 5: commit**

~~~bash
git add \
  supabase/migrations/20260716114000_registration_history_v2.sql \
  src/features/tasks/registration-track-service.ts \
  tests/registration-track-schema.test.mjs \
  tests/registration-track-service.test.mjs \
  supabase/tests/registration_subject_tracks_runtime_test.sql
git commit -m "feat: record registration history actors explicitly"
~~~

---

### Task 3: Replace editable pseudo-history with an honest read-only timeline

**Files:**

- Create: src/features/tasks/registration-history-timeline.tsx
- Modify: src/features/tasks/registration-track-history.js
- Modify: src/features/tasks/registration-track-history.d.ts
- Modify: src/features/tasks/registration-track-editor.tsx
- Modify: src/features/tasks/ops-task-workspace.tsx
- Test: tests/registration-track-history.test.mjs
- Test: tests/ops-task-workspace.test.mjs

**Interfaces:**

- Produces buildRegistrationSubjectHistory(detail) items with actorKind, actorId, systemSource, nullable occurredAt, timeKind, and origin.
- Produces RegistrationHistoryTimeline({ detail, profiles }) with subject/stage filters and no mutation callbacks.

- [ ] **Step 1: write failing history truth tests**

Require:

- newest-first milestone ordering;
- one grouped row for a shared appointment with both subject badges;
- current owner separated from event actor;
- notification internals excluded;
- version-1 null actor shown as 알 수 없음;
- migration fallback labeled 마이그레이션;
- fallback timeKind unavailable rather than borrowing mutable updatedAt;
- no input, edit, delete, assignee, or due-date control inside the timeline.

- [ ] **Step 2: normalize the closed milestone map**

Use the exact event-to-stage map from Task 3 of docs/superpowers/plans/2026-07-15-registration-appointments-reminders.md. Fine appointment edits become milestone detail metadata. Never include notification event/fan-out/delivery/retry/provider rows.

- [ ] **Step 3: mount the timeline and rename mutable present state**

Remove the 담당자 및 일시 이력 collapsible. Mount RegistrationHistoryTimeline in the canonical registration detail/editor.

If assignee and next-processing time remain needed, move them to a separate 현재 업무 area beside current action controls. That area is mutable present state and must not be visually or semantically merged with history.

- [ ] **Step 4: run focused and browser tests**

~~~bash
"$NODE" --experimental-strip-types --test \
  tests/registration-track-history.test.mjs \
  tests/ops-task-workspace.test.mjs
pnpm exec tsc --noEmit
~~~

Browser QA opens a case with two-subject shared history, filters by each subject, expands detail, and confirms there is no editable history action. Provider calls remain zero. Before this history release is called merge/deploy-ready, also run the full mandatory release gate.

- [ ] **Step 5: commit the history release**

~~~bash
git add \
  src/features/tasks/registration-history-timeline.tsx \
  src/features/tasks/registration-track-history.js \
  src/features/tasks/registration-track-history.d.ts \
  src/features/tasks/registration-track-editor.tsx \
  src/features/tasks/ops-task-workspace.tsx \
  tests/registration-track-history.test.mjs \
  tests/ops-task-workspace.test.mjs
git commit -m "feat: show automatic registration history"
~~~

**History release gate:** a user cannot type, alter, or delete a history record, actor/time labels come from immutable events or are explicitly unknown, and the mandatory full release gate passes.

---

### Task 4: Establish common notification vocabulary and pure settings contracts

**Source packet:** Task 1 of docs/superpowers/plans/2026-07-15-common-notification-control-plane.md.

**Files:**

- Create: src/features/notifications/notification-control-plane-types.ts
- Create: src/features/notifications/notification-control-plane-model.ts
- Create: tests/notification-control-plane-model.test.mjs
- Modify: package.json

**Interfaces:**

- Closed workflow, event, audience, channel, rule, template, connection, delivery-summary, revision, and conflict DTOs.
- Pure draft/dirty-patch/rebase/validation functions shared by page and dialog.
- web_push remains derived from in_app and is never an independent rule toggle.

- [x] **Step 1: copy the exact locked unions and DTOs from the approved common spec**
- [x] **Step 2: add failing tests for seven-workflow order, impossible cells, explicit save, revision conflicts, dirty navigation, and decimal-string bigint handling**
- [x] **Step 3: implement pure model functions with no Supabase, React, provider, or workflow import**
- [x] **Step 4: add test:notifications to package.json**
- [x] **Step 5: run pnpm run test:notifications and pnpm exec tsc --noEmit**
- [x] **Step 6: commit**

~~~bash
git add \
  package.json \
  src/features/notifications/notification-control-plane-types.ts \
  src/features/notifications/notification-control-plane-model.ts \
  tests/notification-control-plane-model.test.mjs
git commit -m "test: define notification control plane contracts"
~~~

**Gate:** no UI or sender uses component-owned defaults as canonical settings.

**완료 증거(2026-07-17):** `787cd10` 커밋에 닫힌 7개 업무·79개 이벤트·12개 대상·4개 채널, 실패-폐쇄 DTO decoder, 순수 draft/patch/validation/rebase 모델과 테스트를 기록했습니다. 최초 RED는 새 모듈의 `ERR_MODULE_NOT_FOUND`였고 최종 집중 테스트 18/18, 다음 작업의 의도된 RED 파일을 제외한 전체 회귀 1050/1050, TypeScript, 대상 ESLint, diff 검사가 모두 통과했습니다. 독립 검토에서 찾은 연결 조합, 연결 검증 오류, 예약 임의 필드, 동적 과목 연결, 중복 식별자 문제를 모두 회귀 테스트와 함께 보강했으며 최종 P0/P1/P2 잔여 문제는 없습니다. Supabase 쓰기, 외부 발송, 마이그레이션 적용, 배포는 수행하지 않았습니다.

---

### Task 5: Add the private canonical notification schema and per-profile receipt boundary

**Source packet:** Task 2 of docs/superpowers/plans/2026-07-15-common-notification-control-plane.md.

**Files:**

- Create: supabase/migrations/20260716110000_notification_control_plane_expand.sql
- Create: supabase/tests/notification_control_plane_schema_test.sql
- Create: tests/notification-control-plane-schema.test.mjs

**Database ownership:**

- dashboard_private.notification_events
- dashboard_private.notification_rules
- dashboard_private.notification_templates
- dashboard_private.notification_deliveries
- durable fanout/rule-reconciliation/target-reconciliation queues
- request ledger, dispatch ownership, leases, runtime flags, audit logs
- public.dashboard_notification_read_receipts
- additive compatibility columns on existing inbox/connection rows

- [x] **Step 1: write failing schema/grant/RLS/idempotency/source-drift tests**
- [x] **Step 2: add forward-only tables, constraints, unique occurrence keys, indexes, deferred relationships, and all twelve false runtime flags**

~~~text
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
~~~

The schema test requires this exact set, exact count, server-authoritative database storage, and false defaults.
- [x] **Step 3: keep dashboard_private usage required by existing registration wrappers but revoke direct canonical-table access from anon/authenticated**
- [x] **Step 4: preserve every currently required legacy writer grant until its fixed-purpose bridge lands in Task 20**

The expand migration must not revoke authenticated/public writer access still used by dashboard_notifications, Google Chat compatibility, makeup, phone-consultation, or other legacy domain event paths. Source and pgTAP tests snapshot grants before/after and prove unchanged legacy behavior. Only new private canonical tables and the new receipt mutation boundary are closed here.

- [x] **Step 5: add receipts with historical read compatibility**

Add primary key (notification_id, profile_id), own-select RLS, and no direct browser write. The shared visible relation uses a receipt first, otherwise an existing non-null dashboard_notifications.read_at only as historical effective read. Never backfill, clear, or newly update legacy row read_at. New canonical and fixed-purpose legacy projections explicitly insert read_at = null.

- [x] **Step 6: detect optional live-only legacy tables without assuming they exist**

Use to_regclass for ops_task_notification_deliveries and ops_task_automation_runs. If present, register them as read-only legacy import sources; if absent, migration and tests still succeed. Do not destructively backfill either table. Cover both present and absent pgTAP fixtures because linked-live drift may differ from local schema.

- [x] **Step 7: prove no historical inbox, push subscription, webhook, makeup history, registration claim, SOLAPI, or optional legacy row is deleted/backfilled destructively**
- [x] **Step 8: run source tests and authorized local/preview pgTAP**
- [x] **Step 9: commit**

~~~bash
git add \
  supabase/migrations/20260716110000_notification_control_plane_expand.sql \
  supabase/tests/notification_control_plane_schema_test.sql \
  tests/notification-control-plane-schema.test.mjs
git commit -m "feat: add notification control plane schema"
~~~

**Gate:** all canonical tables are private, all runtime flags are false, installing the migration creates zero deliveries, historical read_at semantics remain intact, optional live-only tables are handled both ways, and no required legacy writer grant closes early.

**완료 증거(2026-07-17):** `d7a285f` 커밋에 private canonical 네 계층, 세 내구성 큐, 요청 원장, heartbeat, 12개 false 플래그, 발송 소유권, 개인별 receipt와 호환 확장을 기록했습니다. 최초 RED는 마이그레이션 부재로 7개 중 6개가 실패했고, 최종 source 8/8, 알림 집중 26/26, 다음 작업의 의도된 RED를 제외한 전체 회귀 1058/1058, TypeScript, 대상 ESLint, cached diff 검사가 통과했습니다. Supabase 플러그인으로 migration 번호·optional live table·기존 schema/RPC 권한을 읽기 전용 검증했으며 최종 독립 검토는 P0/P1/P2 잔여 문제 없이 통과했습니다. 원격 적용·데이터 변경·provider 호출·배포는 수행하지 않았습니다. 승인된 local/preview DB에서의 실제 pgTAP 실행은 적용 단계의 release gate로 남겼으며 실행한 것으로 보고하지 않습니다.

---

### Task 6: Implement role-checked settings, audit, connections, and reconciliation APIs

**Source packets:** Tasks 3 and 4 of docs/superpowers/plans/2026-07-15-common-notification-control-plane.md.

**Files:**

- Create: supabase/migrations/20260716111000_notification_control_plane_settings_rpc.sql
- Create: src/features/notifications/notification-control-plane-service.ts
- Create: src/features/notifications/server/notification-auth.ts
- Create: src/features/notifications/server/notification-connection-crypto.ts
- Create: src/features/notifications/server/notification-connection-repository.ts
- Create: src/app/api/notifications/control-plane/route.ts
- Create: src/app/api/notifications/connections/route.ts
- Create: src/app/api/notifications/deliveries/[deliveryId]/route.ts
- Create: scripts/backfill-google-chat-webhook-encryption.mjs
- Create: tests/notification-control-plane-api.test.mjs
- Create: supabase/tests/notification_control_plane_runtime_test.sql

**Locked public interfaces:**

~~~sql
public.get_notification_control_plane_v1(p_workflow_key text) returns jsonb
public.save_notification_control_plane_v1(
  p_workflow_key text,
  p_expected_revisions jsonb,
  p_patch jsonb,
  p_request_id uuid
) returns jsonb
public.get_notification_runtime_flags_v1() returns jsonb
public.set_notification_runtime_flag_v1(
  p_flag_key text,
  p_enabled boolean,
  p_expected_revision bigint,
  p_request_id uuid
) returns jsonb
~~~

- [x] **Step 1: write failing auth, UI-flag, revision, request-ledger, audit, masking, and connection-conflict tests**
- [x] **Step 2: implement exact admin/staff read/write boundaries; arbitrary workflow/event/channel keys fail closed**
- [x] **Step 3: implement one-transaction explicit settings save with expected revisions and request ID replay**

The operator save path also rechecks notification_control_plane_settings_ui_enabled in the same transaction. An already-open stale panel cannot save after rollback disables the UI; controlled migration/import uses its separate service-role path rather than bypassing this operator contract.
- [x] **Step 4: encrypt Google Chat URLs with versioned AES-256-GCM envelopes; browser responses expose only configured state and masked metadata**
- [x] **Step 5: make the controlled backfill dry-run by default and preserve legacy readers until cutover**
- [ ] **Step 6: run pnpm run test:notifications and authorized pgTAP**
- [x] **Step 7: commit**

~~~bash
git add \
  supabase/migrations/20260716111000_notification_control_plane_settings_rpc.sql \
  supabase/tests/notification_control_plane_runtime_test.sql \
  src/features/notifications/notification-control-plane-service.ts \
  src/features/notifications/server/notification-auth.ts \
  src/features/notifications/server/notification-connection-crypto.ts \
  src/features/notifications/server/notification-connection-repository.ts \
  src/app/api/notifications/control-plane/route.ts \
  src/app/api/notifications/connections/route.ts \
  'src/app/api/notifications/deliveries/[deliveryId]/route.ts' \
  scripts/backfill-google-chat-webhook-encryption.mjs \
  tests/notification-control-plane-api.test.mjs
git commit -m "feat: add secure notification settings APIs"
~~~

**Gate:** a successful save survives route exit/reload; a stale revision returns a conflict without overwriting another operator; no secret appears in response, logs, event payload, delivery summary, or audit summary.

**완료 증거(2026-07-17):** `871b04f` 커밋에 역할 기반 설정 읽기·저장, 원자적 revision/CAS·요청 원장·감사, 12개 런타임 플래그 경계, Google Chat 연결 암호화·검증 예약·안전한 legacy 호환, dry-run 기본 백필을 기록했습니다. 작업 6 API 34/34, 작업 4~6 집중 60/60, 기존 관련 회귀 132/132, 작업 7 RED를 제외한 전체 Node 1092/1092, TypeScript, 전체 ESLint, production build가 통과했습니다. 독립 최종 검토는 P0/P1/P2 0건입니다. 로컬 `/admin/registration`은 HTTP 200으로 계속 실행 중입니다. 원격 마이그레이션·데이터 변경·런타임 플래그 변경·provider 호출·배포는 수행하지 않았고, 실제 DB pgTAP 실행은 승인된 local/preview 적용 단계의 배포 전 검증으로 남겼습니다.

---

### Task 7: Build the durable orchestration and delivery worker core

**Source packet:** Task 5 of docs/superpowers/plans/2026-07-15-common-notification-control-plane.md.

**Files:**

- Create: supabase/migrations/20260716112000_notification_control_plane_worker_rpc.sql
- Extend: supabase/tests/notification_control_plane_runtime_test.sql
- Create: src/features/notifications/server/notification-workflow-adapter.ts
- Create: src/features/notifications/server/notification-worker.ts
- Create: src/features/notifications/server/legacy-in-app-projection.ts
- Create: src/features/notifications/server/providers/google-chat-provider.ts
- Create: src/features/notifications/server/providers/web-push-provider.ts
- Create: src/app/api/notifications/push-readiness/route.ts
- Modify: src/app/api/push-subscriptions/route.ts
- Modify: public/sw.js
- Create: tests/notification-control-plane-worker.test.mjs

**Locked worker interfaces:**

~~~sql
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
public.claim_notification_fanout_jobs_v1(
  p_worker_id text,
  p_batch_size integer,
  p_lease_seconds integer
) returns setof jsonb
public.claim_notification_rule_reconciliation_jobs_v1(
  p_worker_id text,
  p_batch_size integer,
  p_lease_seconds integer
) returns setof jsonb
public.claim_notification_target_reconciliation_jobs_v1(
  p_worker_id text,
  p_batch_size integer,
  p_lease_seconds integer
) returns setof jsonb
public.apply_notification_rule_reconciliation_batch_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_expected_cursor text,
  p_batch jsonb,
  p_next_cursor text,
  p_done boolean
) returns jsonb
public.apply_notification_target_reconciliation_batch_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_expected_cursor text,
  p_batch jsonb,
  p_next_cursor text,
  p_done boolean
) returns jsonb
public.finish_notification_orchestration_job_v1(
  p_job_kind text,
  p_job_id uuid,
  p_claim_token uuid,
  p_disposition text,
  p_outcome_summary jsonb,
  p_error_code text,
  p_next_attempt_at timestamptz
) returns jsonb
public.get_notification_orchestration_job_status_v1(
  p_job_kind text,
  p_job_id uuid
) returns jsonb
public.retry_notification_orchestration_job_v1(
  p_job_kind text,
  p_job_id uuid,
  p_expected_attempt_count integer,
  p_request_id uuid
) returns jsonb
public.claim_notification_deliveries_v1(
  p_worker_id text,
  p_batch_size integer,
  p_lease_seconds integer
) returns setof jsonb
public.record_notification_worker_heartbeat_v1(
  p_worker_id text,
  p_run_id uuid,
  p_phase text,
  p_counts jsonb,
  p_error_code text
) returns void
public.begin_notification_delivery_send_v1(
  p_delivery_id uuid,
  p_claim_token uuid
) returns jsonb
public.commit_notification_in_app_delivery_v1(
  p_delivery_id uuid,
  p_claim_token uuid
) returns jsonb
public.finalize_notification_delivery_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_status text,
  p_status_reason text,
  p_provider_message_id text,
  p_provider_response_code text,
  p_error_code text,
  p_error_summary text,
  p_next_attempt_at timestamptz
) returns jsonb
public.reap_notification_leases_v1(
  p_worker_id text,
  p_batch_size integer
) returns jsonb
public.reconcile_notification_delivery_v1(
  p_delivery_id uuid,
  p_resolution text,
  p_reason text,
  p_request_id uuid,
  p_duplicate_risk_accepted boolean default false
) returns jsonb
public.get_dashboard_notification_inbox_v1(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
) returns jsonb
public.get_dashboard_notification_unread_count_v1() returns jsonb
public.mark_dashboard_notification_read_v1(
  p_notification_id uuid
) returns jsonb
dashboard_private.reserve_canonical_dispatch_ownership_v1(
  p_delivery_id uuid
) returns uuid
public.begin_legacy_notification_dispatch_v1(
  p_workflow_key text,
  p_occurrence_key text,
  p_rule_id uuid,
  p_channel_key text,
  p_target_key text,
  p_target_generation bigint,
  p_legacy_owner_key text,
  p_expected_owner_generation bigint,
  p_request_id uuid
) returns jsonb
public.finalize_legacy_notification_dispatch_v1(
  p_claim_id uuid,
  p_owner_generation bigint,
  p_dispatch_token uuid,
  p_outcome text,
  p_provider_reference text
) returns jsonb
public.commit_legacy_notification_in_app_projection_v1(
  p_delivery_id uuid,
  p_claim_id uuid,
  p_owner_generation bigint,
  p_dispatch_token uuid
) returns jsonb
public.transfer_notification_dispatch_ownership_v1(
  p_claim_id uuid,
  p_expected_owner_generation bigint,
  p_to_owner_kind text,
  p_request_id uuid,
  p_reason_code text
) returns jsonb
~~~

record_notification_event_v1 returns exactly event_id and fanout_job_id. An occurrence replay returns the same pair. Domain mutations pass opaque job references to UI when status is needed and never read private queue tables. Heartbeat accepts only started, succeeded, or failed and a closed numeric count map. Target generation and dispatch owner generation remain distinct decimal-string values and can never be substituted for each other.

- [x] **Step 1: write failing state-machine, ownership, lease, retry, receipt-projection, and provider-fixture tests**

Cover:

- event and fan-out idempotency;
- one-rule-at-a-time target resolution;
- deterministic target-set hashes;
- claim tokens and FOR UPDATE SKIP LOCKED;
- partial replay and compare-and-swap reconciliation cursors;
- A→B→A target generations and out-of-order supersession;
- cancel-before-send and recipient revocation immediately before send;
- atomic in-app projection and derived Push children;
- historical row read_at fallback only when no receipt exists, with every new projection read_at null;
- ownership races between canonical and legacy paths;
- legacy begin/finalize and fixed-purpose in-app replay use the same rule-scoped ownership identity as canonical;
- attempt increment only at begin-send;
- bounded retry_wait;
- timeout/reset after begin-send becomes delivery_unknown and is not automatically retried;
- missing adapter or reconciler fails closed;
- heartbeat start and one terminal result with sanitized counts;
- injected provider fakes only, deny-by-default outbound-host ledger, and zero non-fixture network calls.

- [x] **Step 2: implement service-role-only producer, claim, apply, projection, ownership, and finalization RPCs**

The database rechecks workflow flags, source/rule revisions, target generation, cancel requests, and ownership immediately before a side effect. Shadow work ends skipped/shadow_mode. Dispatch-disabled canonical work ends skipped/legacy_skipped. Neither path contacts a provider or reserves a canonical send owner.

- [x] **Step 3: implement an injectable common worker**

Export:

~~~ts
export function createNotificationWorker(input: {
  getAdapter: (workflowKey: string) => NotificationWorkflowAdapter | null
}): NotificationWorker
~~~

The common worker imports no workflow module. It loads immutable rules/templates, calls adapter target/render/deep-link/revalidation callbacks, validates allowlisted same-origin links, and persists the rendered snapshot before delivery. Tests inject all transport functions and assert the external-host ledger remains empty; production providers are impossible to construct in the automated test environment.

- [x] **Step 4: implement fixed-purpose provider classifiers**

Google Chat and Web Push providers accept a begun canonical delivery context only. They never accept a browser-authored title, body, href, recipient, team, endpoint, or webhook.

Classify:

- definite acceptance as sent;
- retryable pre-acceptance rejection as retry_wait;
- definite permanent rejection as failed with a closed reason;
- timeout/reset/lost sending lease after dispatch starts as delivery_unknown.

- [x] **Step 5: implement Push readiness server boundary**

GET returns normalized booleans/codes only for public/private VAPID match, contact, asset availability, subscription ownership, and capability. POST accepts only fixed send_test for the current authenticated profile and current browser endpoint. It uses fixed same-origin content and an injected sender in tests.

- [x] **Step 6: harden service-worker parsing and click navigation**

Malformed Push JSON must degrade safely. Notification click href must pass a same-origin admin allowlist. Never expose endpoint/auth keys or service-role information.

- [ ] **Step 7: run focused and authorized database tests**

~~~bash
pnpm run test:notifications
pnpm dlx supabase@2.109.1 test db
~~~

Expected: all focused tests and pgTAP pass; provider fake ledger has expected simulated outcomes and network ledger stays empty.

- [x] **Step 8: commit**

~~~bash
git add \
  supabase/migrations/20260716112000_notification_control_plane_worker_rpc.sql \
  supabase/tests/notification_control_plane_runtime_test.sql \
  src/features/notifications/server/notification-workflow-adapter.ts \
  src/features/notifications/server/notification-worker.ts \
  src/features/notifications/server/legacy-in-app-projection.ts \
  src/features/notifications/server/providers/google-chat-provider.ts \
  src/features/notifications/server/providers/web-push-provider.ts \
  src/app/api/notifications/push-readiness/route.ts \
  src/app/api/push-subscriptions/route.ts \
  public/sw.js \
  tests/notification-control-plane-worker.test.mjs
git commit -m "feat: add durable notification worker core"
~~~

**Gate:** no provider call can occur without a current source, rule, recipient, flag, claim token, ownership claim, and begun delivery row.

**완료 증거(2026-07-17):** `1117f85` 커밋에 멱등 이벤트·fan-out·재계산·전달 상태기계, canonical/legacy 소유권, 개인별 receipt, 고정 provider 분류, Push 준비 상태·재연결·서비스워커 안전 경계를 기록했습니다. Worker `22/22`, 작업 4~7 알림 집중 `82/82`, 관련 회귀 `178/178`, 전체 Node `1114/1114`, TypeScript, 전체 ESLint, production build와 diff 검사가 통과했고 독립 최종 검토는 P0/P1/P2 0건입니다. 로컬 등록 화면·서비스워커·매니페스트는 HTTP 200이고 인증 없는 Push API는 401입니다. 실제 provider 호출은 0건이며 원격 적용·데이터 변경·플래그 변경·배포는 수행하지 않았습니다. Step 7의 source/집중 검증은 완료했지만 실제 DB pgTAP은 승인된 local/preview 적용 단계의 release gate로 남겨 두었고 실행한 것으로 보고하지 않습니다.

---

### Task 8: Add one persistent settings UI for all seven workflows

**Source packet:** Task 6 and launcher portion of Task 7 in docs/superpowers/plans/2026-07-15-common-notification-control-plane.md.

**Files:**

- Create: supabase/migrations/20260716113000_notification_control_plane_runtime_marker.sql
- Create: supabase/migrations/20260716112500_notification_workflow_settings_seed.sql
- Create: src/features/notifications/notification-control-panel.tsx
- Create: src/features/notifications/notification-settings-workspace.tsx
- Create: src/features/notifications/use-notification-navigation-guard.ts
- Modify: src/app/admin/settings/notifications/page.tsx
- Modify: src/lib/navigation.ts
- Modify: src/features/tasks/ops-task-workspace.tsx
- Modify: src/features/makeup-requests/makeup-request-workspace.tsx
- Modify: src/features/approvals/approval-workspace.tsx
- Create: tests/notification-control-plane-ui.test.mjs
- Modify: tests/admin-shell.test.mjs
- Modify: tests/ops-task-workspace.test.mjs
- Modify: tests/makeup-request-workspace.test.mjs
- Modify: tests/approval-workspace.test.mjs

**Interfaces:**

~~~ts
type NotificationControlPanelProps = {
  workflowKey: NotificationWorkflowKey
  presentation: "page" | "dialog"
  open?: boolean
  onOpenChange?: (open: boolean) => void
}
~~~

Dialog mode locks one workflow. Page mode shows the seven workflows in the canonical order. Both consume the same GET/save API and server-returned registry; neither owns defaults.

- [x] **Step 1: write failing global/scoped persistence and interaction tests**

Require:

- /admin/settings/notifications no longer redirects when capability and UI flag are ready;
- canonical seven-workflow order including 영어 단어 재시험;
- same rule/template revision in global page and scoped dialog;
- desktop matrix and mobile cards backed by one draft;
- impossible audience/channel cells omitted, not disabled decoration;
- explicit sticky 저장 action;
- save conflict with 최신 설정 불러오기 and 내 변경 유지;
- unsaved close/ESC/outside click/tab/link/back protection with 저장하고 이동, 저장하지 않고 이동, 계속 편집;
- page exit/re-entry reloads saved values;
- tasks/word-retests/approvals launchers exist;
- registration/transfer/withdrawal/makeup launchers use the same component;
- no duplicate legacy and canonical settings dialog when the flag is on.

- [x] **Step 2: implement the shared page/dialog and explicit save**

Render only server-registry events and cells. Template editing belongs to a rule and immutable template revision. Settings save and delivery recalculation are distinct statuses:

~~~text
저장 중
저장됨 · 알림 재계산 중
저장됨 · 알림 재계산 완료
저장됨 · 알림 재계산 실패 · 다시 시도
~~~

A failed recalculation does not roll back a successfully saved setting and retry does not replay the settings mutation.

- [x] **Step 3: separate Connections from event settings**

Show masked Google Chat connections in a dedicated area. Staff can inspect state; only admins can replace/verify/disconnect. Saving a webhook never silently sends a test. 테스트 메시지 보내기 is a separately confirmed action and remains unavailable in automated QA.

- [x] **Step 4: add final common runtime marker last**

Create public.common_notification_control_plane_runtime_version() returning integer 1 only after common schema, settings RPC, worker RPC, UI contracts, and tests exist. Missing or wrong version fails closed.

- [x] **Step 5: replace route-local settings surfaces behind the server flag**

Load notification_control_plane_settings_ui_enabled from the authenticated database flag boundary.

- Flag false: preserve legacy behavior for rollback.
- Flag true: render only NotificationControlPanel; never render the local React-state toggles/templates.
- Do not change workflow send calls in this step.

Registration, transfer, and withdrawal local settings are not considered operationally fixed until the persistent panel is enabled, reload-tested, and the matching active sender consumes the canonical saved rule under Tasks 14-21. Keep the live UI flag false before that ownership gate. Fixture/preview may enable it to prove save behavior. Do not add a temporary second persistence schema.

- [x] **Step 6: seed/import settings without enabling new delivery**

This step intentionally moves the approved closed settings registry/import ahead of adapter dispatch so the user's save problem can be solved without waiting for provider cutover. It does not move producer, adapter, ownership, or dispatch responsibility. Put the idempotent registry/import in 20260716112500_notification_workflow_settings_seed.sql and keep every dispatch flag false.

- tasks, word_retests, and approvals start with every rule disabled.
- registration seeds exactly registration.case_created, registration.registration_completed, and registration.case_closed management-team Google Chat rows. Transfer and withdrawal import only their real submitted/completed management-team Google Chat intent.
- registration phone/visit compatibility cells remain legacy-owned behind separate false flags.
- phantom applicant/operations cells are absent.
- makeup performs the baseline idempotent import of configuration and template rows only, records stable source keys plus source revisions/checksums, and adds inactive import metadata. It does not import delivery/history/occurrence ownership here, and missing rows are never inferred from component defaults.
- registration appointment reminder cells are added by Task 11 and seed disabled.

- [ ] **Step 7: run focused and browser persistence tests**

~~~bash
pnpm run test:notifications
"$NODE" --experimental-strip-types --test \
  tests/admin-shell.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/makeup-request-workspace.test.mjs \
  tests/approval-workspace.test.mjs
pnpm exec tsc --noEmit
~~~

At desktop and mobile, change one safe fixture toggle/template in each of the seven panels, save, close, reload, and open both global and scoped surfaces. Expect identical revisions and values. Network ledger remains empty.

- [x] **Step 8: commit**

~~~bash
git add \
  supabase/migrations/20260716112500_notification_workflow_settings_seed.sql \
  supabase/migrations/20260716113000_notification_control_plane_runtime_marker.sql \
  src/features/notifications/notification-control-panel.tsx \
  src/features/notifications/notification-settings-workspace.tsx \
  src/features/notifications/use-notification-navigation-guard.ts \
  src/app/admin/settings/notifications/page.tsx \
  src/lib/navigation.ts \
  src/features/tasks/ops-task-workspace.tsx \
  src/features/makeup-requests/makeup-request-workspace.tsx \
  src/features/approvals/approval-workspace.tsx \
  tests/notification-control-plane-ui.test.mjs \
  tests/admin-shell.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/makeup-request-workspace.test.mjs \
  tests/approval-workspace.test.mjs
git commit -m "feat: add persistent notification settings"
~~~

**Gate:** fixture/preview proves save and reload for all seven workflows while every dispatch flag remains false. The Task 1A honest containment remains on the live production surface; do not describe the P0 save request as operationally fixed until Tasks 14-21 make saved rules authoritative for every active sender and the live UI flag is separately authorized.

**완료 증거(2026-07-17):** `ea8e1fc` 커밋에 7개 업무 공통 설정 UI, 서버 플래그·런타임 마커 가용성, 명시적 저장·충돌 감사·재계산·이탈 보호, 연결 분리, 멱등 설정 레지스트리/import를 기록했습니다. 알림 `119/119`, UI/API 관련 `206/206`, 전체 Node `1155/1155`, pgTAP 계획 `222/222`, TypeScript, 전체 ESLint, production build `75/75`, diff 검사가 통과했고 UI·SQL 독립 최종 검토는 각각 P0/P1/P2 0건입니다. 로컬 브라우저는 데스크톱·모바일에서 가로 넘침이 없고 현재 원격 런타임 마커 부재 시 한글 실패-폐쇄 상태를 표시합니다. provider 호출·원격 적용·데이터·플래그 변경은 0건입니다. Step 7의 로컬 source/브라우저 containment 검증은 완료했지만 실제 7개 패널 DB 저장·reload와 pgTAP은 승인된 local/preview 적용 단계의 release gate로 남겼으며 실행한 것으로 보고하지 않습니다.

---

### 작업 9: 알림함 읽음을 사용자별로 분리하고 Push 준비 상태를 실제 행동으로 연결

**기준 문서:** `2026-07-15-common-notification-control-plane.md`의 알림함·Push 범위와 승인된 대시보드 개선 명세.

**주요 변경 파일:**

- `supabase/migrations/20260716113500_notification_inbox_contract_fix.sql`
- `src/features/makeup-requests/makeup-request-service.ts`
- `src/components/dashboard-notification-popover.tsx`
- `src/lib/dashboard-inbox-state.ts`
- `src/lib/dashboard-push-client.ts`
- `src/lib/dashboard-push-readiness.ts`
- `src/features/notifications/server/notification-push-readiness-route.ts`
- `src/app/api/push-subscriptions/route.ts`
- 관련 Node·SQL 계약 테스트

**고정 알림함 API:**

~~~sql
public.get_dashboard_notification_inbox_v1(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
) returns jsonb
public.get_dashboard_notification_unread_count_v1() returns jsonb
public.mark_dashboard_notification_read_v1(
  p_notification_id uuid
) returns jsonb
~~~

세 API는 모두 `auth.uid()`에 기반한 같은 비공개 가시성 관계를 사용합니다. 브라우저 요청은 사용자·프로필 ID를 보내지 않습니다.

- [x] **1단계: receipt·개별 읽음·Push 상태의 실패 테스트 작성**

  두 프로필의 독립 읽음, 목록·개수·읽음 일치, 안정 커서, 레거시 `read_at` 호환, 링크와 형제 `읽음` 버튼, 항목별 진행·오류·재시도, 취소된 알림 제외, 닫힌 Push 상태 전부, 사용자 클릭 안에서만 권한 요청, 고정 자가진단 본문만 허용하는 계약을 테스트로 고정했습니다.

- [x] **2단계: 알림 목록·개수·읽음을 세 RPC로 통일**

  공개 서비스에서 `viewerId`와 직접 테이블 접근, 클라이언트 내용 그룹화를 제거했습니다. 읽음 처리는 현재 프로필 receipt만 기록하고 서버가 돌려준 미확인 수를 사용합니다. 오래된 비동기 결과가 새 프로필·목록·개수를 덮지 않도록 프로필, 세대, 스냅샷, 항목별 진행 상태를 함께 검증합니다.

- [x] **3단계: 링크와 형제 `읽음` 제어 렌더링**

~~~tsx
<div className="grid grid-cols-[minmax(0,1fr)_auto] items-start">
  <Link href={notification.href}>
    <span>{notification.title}</span>
  </Link>
  {!notification.readAt ? <Button type="button">읽음</Button> : null}
</div>
~~~

  `읽음` 버튼은 URL과 팝오버를 유지하고 항목별 오류를 표시합니다. 링크 클릭은 읽음 요청을 동기적으로 시작하지만 이동을 막거나 기다리지 않습니다.

- [x] **4단계: 현재 브라우저 기준 Push 준비 상태 구현**

  브라우저 API, 보안 연결, 서버 VAPID 설정, `/sw.js`·manifest, 권한, 현재 구독, 현재 프로필 소유권, 고정 자가진단 결과를 순서대로 판정합니다. 프로필 전환은 진행 중 작업을 취소합니다. DELETE가 현재 프로필 행을 실제로 삭제한 경우에만 로컬 구독을 해제하며, 공개키 교체와 명시 해제 모두 같은 소유권 경계를 사용합니다. 확정된 전송·만료 결과는 감사 저장 실패와 분리하고, 만료 구독 정리 실패 원인은 감사 경고보다 우선 보존합니다.

- [x] **5단계: 집중 테스트와 실제 브라우저 검증**

  - 전체 Node 회귀 `1198/1198` 통과
  - 알림 전용 테스트 `132/132` 통과
  - 알림함·Push 최신 집중 테스트 `71/71` 통과
  - pgTAP 소스 계획·assertion `226/226` 일치
  - TypeScript, 전체 ESLint, `git diff --check` 통과
  - 별도 임시 복사본 프로덕션 빌드 통과, 정적 페이지 `75/75` 생성
  - 독립 UI·SQL·Push 검토 P0/P1/P2 `0/0/0`
  - 데스크톱과 390px 모바일에서 `scrollWidth = clientWidth`, 가로 넘침 없음
  - 자동 검증 중 실제 Google Chat·Web Push·SOLAPI 공급자 호출 `0건`
  - 원격 DB에 새 RPC가 없는 현재 상태와 VAPID 미설정을 로컬 화면에서 한글 실패 상태로 정확히 확인

  실제 DB pgTAP과 두 프로필 receipt 영속성은 마이그레이션이 적용된 승인된 로컬 또는 미리보기 DB에서 확인해야 하며, 이번 소스 검증에서 실행한 것으로 보고하지 않습니다. 상세 증거는 `.superpowers/sdd/task-9-report.md`에 기록했습니다.

- [x] **6단계: 릴리스 B 구현 커밋**

  구현 커밋: `f3fbf26` (`feat: make notification reads and push readiness trustworthy`)

**릴리스 B 결과:** 사용자별 읽음 계약, 실제 상태만 표시하는 Push UI, 전체 회귀·빌드·브라우저 검증을 통과했습니다. 원격 마이그레이션·플래그·실제 공급자 발송은 변경하지 않았습니다.

---

### Task 10: Add the canonical registration appointment calendar

**Source packet:** Task 4 of docs/superpowers/plans/2026-07-15-registration-appointments-reminders.md.

**Files:**

- Create: supabase/migrations/20260716120000_registration_appointment_calendar.sql
- Create: src/features/tasks/registration-appointment-calendar-model.ts
- Create: src/features/tasks/registration-appointment-calendar.tsx
- Modify: src/features/tasks/registration-track-service.ts
- Modify: src/features/tasks/registration-track-fixture-runtime.ts
- Modify: src/features/tasks/registration-track-fixtures.ts
- Modify: src/features/tasks/registration-track-editor.tsx
- Modify: src/features/tasks/ops-task-workspace.tsx
- Create: tests/registration-appointment-calendar.test.mjs
- Modify: tests/ops-task-workspace.test.mjs
- Extend: supabase/tests/registration_subject_tracks_runtime_test.sql

**Interfaces:**

- Security-invoker view public.ops_registration_appointment_calendar, one row per canonical appointment.
- loadRegistrationAppointmentCalendar({ rangeStart, rangeEnd, statuses }).
- buildRegistrationAppointmentCalendarItems(rows).
- RegistrationTrackEditorProps.initialAppointmentId.

~~~ts
export type RegistrationAppointmentCalendarItem = {
  id: string
  appointmentId: string
  taskId: string
  studentName: string
  kind: "level_test" | "visit_consultation"
  scheduledAt: string
  place: string
  status: "scheduled" | "completed" | "canceled"
  notificationRevision: number
  trackIds: string[]
  subjects: RegistrationSubject[]
  href: string
}
~~~

- [ ] **Step 1: write failing projection and source-contract tests**

Require stable ID registration-appointment:{appointmentId}, exact timestamp, distinct same-day IDs, one shared item with subject badges, scheduled-only default, and deep link:

~~~text
/admin/registration?taskId={taskId}&appointmentId={appointmentId}&view=calendar
~~~

Phone/legacy timestamps are excluded.

- [ ] **Step 2: add the security-invoker canonical view**

Expose exactly appointment_id, task_id, student_name, kind, scheduled_at, place, status, integer notification_revision, track_ids, and subjects. Aggregate canonical child participants. Do not join or write academic_events.

- [ ] **Step 3: implement typed projection, fixture loader, and list/calendar mode**

Desktop supports month/week. Mobile uses a chronological agenda. Default scheduled status can explicitly include completed/canceled. Cards open the canonical editor. No draggable, drop, resize, range-create, direct delete, or bypass of revision checks.

- [ ] **Step 4: preserve deep-link state**

Parse taskId plus appointmentId, select a participating track, open the shared editor, and preserve view=calendar when switching tracks.

- [ ] **Step 5: run focused, pgTAP, and browser tests**

~~~bash
"$NODE" --experimental-strip-types --test \
  tests/registration-appointment-calendar.test.mjs \
  tests/ops-task-workspace.test.mjs
pnpm dlx supabase@2.109.1 test db
pnpm exec tsc --noEmit
~~~

Browser QA covers two same-day appointments, one two-subject shared appointment, exact deep-link reload, desktop month/week, mobile agenda, and no phone item.

- [ ] **Step 6: commit Release D**

~~~bash
git add \
  supabase/migrations/20260716120000_registration_appointment_calendar.sql \
  src/features/tasks/registration-appointment-calendar-model.ts \
  src/features/tasks/registration-appointment-calendar.tsx \
  src/features/tasks/registration-track-service.ts \
  src/features/tasks/registration-track-fixture-runtime.ts \
  src/features/tasks/registration-track-fixtures.ts \
  src/features/tasks/registration-track-editor.tsx \
  src/features/tasks/ops-task-workspace.tsx \
  tests/registration-appointment-calendar.test.mjs \
  tests/ops-task-workspace.test.mjs \
  supabase/tests/registration_subject_tracks_runtime_test.sql
git commit -m "feat: add canonical registration calendar"
~~~

**Release D gate:** one database appointment is one calendar item, regardless of subjects or same-day neighbors, calendar navigation cannot mutate data, exact-route desktop/mobile QA passes on the worktree server, and the full mandatory release gate/provider-zero ledgers pass.

---

### Task 11: Materialize registration reminder rules and events atomically

**Source packet:** Task 5 of docs/superpowers/plans/2026-07-15-registration-appointments-reminders.md.

**Prerequisites:** public.common_notification_control_plane_runtime_version() = 1, Task 2's version-2 history writer, and Task 10 canonical appointments.

**Files:**

- Create: supabase/migrations/20260716130000_registration_appointment_reminder_producer.sql
- Create: tests/registration-appointment-reminders.test.mjs
- Modify: src/features/notifications/notification-control-panel.tsx
- Extend: tests/notification-control-plane-ui.test.mjs
- Modify: tests/registration-track-schema.test.mjs
- Extend: supabase/tests/registration_subject_tracks_runtime_test.sql

**Produces:**

- appointment recipient_revision bigint;
- calculate_registration_reminder_schedule_v1;
- materialize_registration_appointment_reminders_v1;
- cancel_registration_appointment_reminders_v1;
- preview_registration_appointment_reminders_v1;
- public.registration_appointment_reminders_runtime_version() returning 1 as the migration's final object.

- [ ] **Step 1: write failing time, identity, revision, target-generation, and rollback tests**

Test KST at 00:00, 00:30, 13:59, 14:00, 14:01, and 23:59; month/year/leap boundaries; non-KST host timezone; no past backfill; exactly nine disabled rule rows; duplicate materialization; two same-day appointments; A→B→A recipient generations; one raw director event reused by target reconciliation; registry validation for editable schedules; all-disabled UI copy; and complete rollback if common event/job insertion fails.

- [ ] **Step 2: seed only the fixed disabled cells**

Variants:

- previous_day_at at previous KST day 14:00;
- same_day_at at KST day 14:00;
- offset_before at 60 minutes.

Applicability uses three stable rule families per variant, producing exactly nine rows total:

- level test → management_team/in_app;
- visit → track_director/in_app;
- level test and visit share one management_team/google_chat rule per variant rather than seeding duplicate appointment-kind rows.

Every seed is disabled and has an immutable initial template. Installation creates zero reminder deliveries.

- [ ] **Step 3: expose the approved schedule settings in the common panel**

Show the three Korean preset labels 예약 전날 14:00, 예약 당일 14:00, and 예약 1시간 전. While all applicable cells are disabled, show 현재 예약 알림이 발송되지 않습니다 and link/focus the first applicable switch without implying delivery is active.

Admin/staff may edit the KST wall-clock for previous_day_at and same_day_at while preserving those fixed variants, and may edit the lead duration for offset_before. Validate timezone, wall-clock, positive bounded lead, audience/channel applicability, and the shared management Chat row against the server registry. A schedule edit creates a new rule revision; template edit creates an immutable template revision. Add desktop/mobile UI tests for all-disabled, enabled, invalid, save/reload, and conflict states.

- [ ] **Step 4: construct stable occurrence identity**

~~~text
registration:registration_appointment:{appointmentId}:source_revision:{notificationRevision}:rule:{ruleId}:rule_revision:{ruleRevision}
~~~

Identity never uses scheduled_for alone. Only now < scheduled_for < appointment.scheduled_at creates a future event/job.

- [ ] **Step 5: wrap canonical appointment mutations under one lock order**

Creation, reschedule, place/participation change, replacement, cancellation, completion, and director reassignment must update canonical data, version-2 process history, required notification event/fan-out job, and target reconciliation job in one transaction.

- schedule/place/participation/replacement/cancellation increments integer notification_revision exactly once as specified;
- completion and director reassignment do not increment schedule revision;
- a real normalized recipient-set change increments bigint recipient_revision once;
- semantically unchanged recipient set creates no target job;
- pending/retry_wait obsolete work is canceled;
- claimed pre-send work gets cancel_requested;
- sending, sent, delivery_unknown, and terminal audit history are preserved.

- [ ] **Step 6: add preview and final runtime marker**

Preview returns only enabled, applicable, future rounds and safe snake_case fields. It exposes no template body or recipient data.

Create registration_appointment_reminders_runtime_version last. Registration settings exposure, shadow production, dispatch, and visit target reconciliation require both common and registration markers; missing/wrong versions fail closed.

- [ ] **Step 7: run Node, UI, pgTAP, and concurrency tests**

~~~bash
"$NODE" --experimental-strip-types --test \
  tests/registration-appointment-reminders.test.mjs \
  tests/notification-control-plane-ui.test.mjs \
  tests/registration-track-schema.test.mjs
pnpm dlx supabase@2.109.1 test db
~~~

Expected: all disabled by default, zero provider calls, exact idempotency, and no partial commit.

- [ ] **Step 8: commit**

~~~bash
git add \
  supabase/migrations/20260716130000_registration_appointment_reminder_producer.sql \
  src/features/notifications/notification-control-panel.tsx \
  tests/registration-appointment-reminders.test.mjs \
  tests/notification-control-plane-ui.test.mjs \
  tests/registration-track-schema.test.mjs \
  supabase/tests/registration_subject_tracks_runtime_test.sql
git commit -m "feat: materialize registration appointment reminders"
~~~

---

### Task 12: Harden appointment conflicts, confirmations, and reminder processing status

**Source packet:** Task 6 of docs/superpowers/plans/2026-07-15-registration-appointments-reminders.md.

**Files:**

- Create: src/features/tasks/registration-appointment-draft.ts
- Modify: src/features/tasks/registration-appointment-editor.tsx
- Modify: src/features/tasks/registration-track-service.ts
- Modify: src/features/tasks/registration-track-fixtures.ts
- Create: tests/registration-appointment-draft.test.mjs
- Modify: tests/registration-consultation-notification.test.mjs

**Interfaces:**

- compareRegistrationAppointmentDraft.
- rebaseRegistrationAppointmentDraft.
- buildRegistrationAppointmentConfirmation.
- previewRegistrationAppointmentReminders.
- getRegistrationNotificationJobStatus.
- retryRegistrationNotificationJob.

- [ ] **Step 1: write failing conflict and status tests**

Require a 409 to retain local date/place/subjects, explicit latest comparison, reviewed rebase, old/new confirmation, future-round counts, cancellation confirmation without a mandatory invented reason, opaque common job references, and retry of the same failed job rather than replaying save/cancel.

- [ ] **Step 2: preserve immutable local/server drafts and remove invented cancellation input**

Expose 최신 예약 비교, 다시 적용, and 계속 편집. A new request key is generated only after a logical local change or reviewed rebase. Remove the cancellation-reason textarea from this flow and pass reason: "" to the unchanged RPC until a forward-compatible RPC revision normalizes nullable reason internally. Do not require an operator to invent text merely to cancel.

- [ ] **Step 3: separate canonical save from notification recalculation**

After save, show 예약 저장됨 · 알림 재계산 중. Poll only get_notification_orchestration_job_status_v1. A failed job retries only through retry_notification_orchestration_job_v1 with expected attempt count and stable request ID. Registration UI never inserts/requeues private jobs or replays the appointment RPC.

Do not expose this processing/polling UI merely because the registration reminder marker exists. It additionally requires notification_workflow_adapters_runtime_version() = 1 plus successful worker and watchdog heartbeats within three minutes. Before that executable runtime exists, keep reminder controls/status hidden behind the existing safe feature gate; a production operator must never see 재계산 중 for a queue that has no runnable worker.

- [ ] **Step 4: keep settings ownership in the common panel**

Appointment editor shows preview/processing status only. It does not mount a second NotificationControlPanel or own settings defaults.

- [ ] **Step 5: run focused tests and commit**

~~~bash
"$NODE" --experimental-strip-types --test \
  tests/registration-appointment-draft.test.mjs \
  tests/registration-consultation-notification.test.mjs
pnpm exec tsc --noEmit
git add \
  src/features/tasks/registration-appointment-draft.ts \
  src/features/tasks/registration-appointment-editor.tsx \
  src/features/tasks/registration-track-service.ts \
  src/features/tasks/registration-track-fixtures.ts \
  tests/registration-appointment-draft.test.mjs \
  tests/registration-consultation-notification.test.mjs
git commit -m "feat: harden registration appointment editing"
~~~

---

### Task 13: Add and verify the registration common-worker adapter

**Source packets:** Tasks 7 and 8 of docs/superpowers/plans/2026-07-15-registration-appointments-reminders.md.

**Files:**

- Create: src/features/notifications/server/adapters/registration-notification-adapter.ts
- Create: tests/registration-notification-adapter.test.mjs
- Modify: scripts/verify-ops-task-browser-workflow.mjs
- Modify: scripts/verify-registration-subject-track-concurrency.mjs
- Modify: src/features/tasks/registration-track-fixtures.ts

**Interface:**

~~~ts
export const registrationNotificationAdapter: NotificationWorkflowAdapter = {
  workflowKey: "registration",
  resolveTargets,
  buildRenderContext,
  buildDeepLink,
  revalidateBeforeSend,
  reconcileScheduledRules,
  reconcileTargets,
}
~~~

- [ ] **Step 1: write failing adapter tests for exact targets, whole-set hash, decimal target generation, current-source/rule/schedule revalidation, paging, and supersession**
- [ ] **Step 2: implement required buildRenderContext and buildDeepLink callbacks from the same authoritative source snapshot; return only allowed string variables and a same-origin registration deep link**
- [ ] **Step 3: return exact canceled reasons for stale source/rule/recipient and exact failed reasons for closed retry window, invalid schedule, or unsupported payload**
- [ ] **Step 4: reconcile scheduled rules from canonical appointments in stable scheduled_at/id order without writing inside the adapter**
- [ ] **Step 5: reconcile targets from current participants/directors and let common apply compare captured versus live generation/hash**
- [ ] **Step 6: extend no-provider browser and two-session concurrency fixtures**
- [ ] **Step 7: run focused, full registration, type, browser, and authorized pgTAP/concurrency gates**

~~~bash
"$NODE" --experimental-strip-types --test \
  tests/registration-notification-adapter.test.mjs \
  tests/registration*.test.mjs \
  tests/ops-task-workspace.test.mjs
pnpm exec tsc --noEmit
OPS_BROWSER_WORKFLOW=1 OPS_BROWSER_BASE_URL="$OPS_BROWSER_BASE_URL" pnpm run verify:ops-browser
~~~

- [ ] **Step 8: commit Release E**

~~~bash
git add \
  src/features/notifications/server/adapters/registration-notification-adapter.ts \
  tests/registration-notification-adapter.test.mjs \
  scripts/verify-ops-task-browser-workflow.mjs \
  scripts/verify-registration-subject-track-concurrency.mjs \
  src/features/tasks/registration-track-fixtures.ts
git commit -m "feat: add registration notification adapter"
~~~

**Release E code gate:** reminder seeds remain off, common/registration code markers and deterministic future rounds/cancellation pass, no registration dispatch flag is enabled, and the full mandatory release gate plus worktree-owned exact-route/provider-zero QA passes. Do not deploy/apply this package alone: the processing UI remains gated until Task 20's final adapter marker, worker/watchdog schedules, and recent heartbeats exist in the same authorized Release F deployment.

---

### Task 14: Register seven exclusive workflow adapters and compose the worker route

**Source packet:** Task 1 of docs/superpowers/plans/2026-07-15-notification-workflow-adapters.md.

**Files:**

- Create: src/features/notifications/server/adapters/tasks-notification-adapter.ts
- Create: src/features/notifications/server/adapters/word-retests-notification-adapter.ts
- Create: src/features/notifications/server/adapters/transfer-notification-adapter.ts
- Create: src/features/notifications/server/adapters/withdrawal-notification-adapter.ts
- Create: src/features/notifications/server/adapters/makeup-requests-notification-adapter.ts
- Create: src/features/notifications/server/adapters/approvals-notification-adapter.ts
- Create: src/features/notifications/server/notification-workflow-registry.ts
- Create: src/app/api/notifications/worker/route.ts
- Create: tests/notification-workflow-registry.test.mjs

- [ ] **Step 1: write a failing registry test with exactly seven ordered exclusive owners**
- [ ] **Step 2: implement deterministic one-rule target sets plus authoritative render-context/deep-link callbacks**
- [ ] **Step 3: import the registration adapter from Task 13; only it supplies scheduled-rule and target reconciliation**
- [ ] **Step 4: require a timing-safe Bearer NOTIFICATION_WORKER_SECRET check before any claim**
- [ ] **Step 5: run the registry/worker tests with no provider network**
- [ ] **Step 6: commit**

~~~bash
git add \
  src/features/notifications/server/adapters/tasks-notification-adapter.ts \
  src/features/notifications/server/adapters/word-retests-notification-adapter.ts \
  src/features/notifications/server/adapters/transfer-notification-adapter.ts \
  src/features/notifications/server/adapters/withdrawal-notification-adapter.ts \
  src/features/notifications/server/adapters/makeup-requests-notification-adapter.ts \
  src/features/notifications/server/adapters/approvals-notification-adapter.ts \
  src/features/notifications/server/notification-workflow-registry.ts \
  src/app/api/notifications/worker/route.ts \
  tests/notification-workflow-registry.test.mjs
git commit -m "feat: register notification workflow adapters"
~~~

---

### Task 15: Make general tasks and word retests atomic producers

**Source packet:** Task 2 of docs/superpowers/plans/2026-07-15-notification-workflow-adapters.md.

**Files:**

- Create: supabase/migrations/20260716190000_notification_ops_task_producers.sql
- Create: supabase/tests/notification_ops_task_adapters_test.sql
- Create: tests/notification-ops-task-producers.test.mjs
- Modify: src/features/tasks/ops-task-service.ts
- Modify: src/features/tasks/ops-task-workspace.tsx

- [ ] **Step 1: write failing request-ID, source-event, ownership, replay, and rollback tests**
- [ ] **Step 2: add fixed create/update/status/comment task RPCs and fixed word-retest result/absence/revision/retry RPCs**
- [ ] **Step 3: make word-retest retry finish/link old and create new in one transaction**
- [ ] **Step 4: remove post-commit browser source-event writes and two-call retry**
- [ ] **Step 5: keep every task/word-retest notification rule disabled**
- [ ] **Step 6: run Node plus authorized pgTAP and commit**

~~~bash
"$NODE" --experimental-strip-types --test \
  tests/notification-ops-task-producers.test.mjs \
  tests/ops-task-workspace.test.mjs
pnpm dlx supabase@2.109.1 test db
git add \
  supabase/migrations/20260716190000_notification_ops_task_producers.sql \
  supabase/tests/notification_ops_task_adapters_test.sql \
  tests/notification-ops-task-producers.test.mjs \
  src/features/tasks/ops-task-service.ts \
  src/features/tasks/ops-task-workspace.tsx
git commit -m "feat: produce task notification events atomically"
~~~

**Gate:** ops_tasks.type=general emits only tasks; word_retest emits only word_retests; registration remains on its dedicated service.

---

### Task 16: Move transfer and withdrawal production behind fixed authoritative mutations

**Source packet:** Task 3 of docs/superpowers/plans/2026-07-15-notification-workflow-adapters.md.

**Files:**

- Create: supabase/migrations/20260716191000_notification_transfer_withdrawal_producers.sql
- Create: supabase/tests/notification_transfer_withdrawal_adapters_test.sql
- Create: src/app/api/notifications/legacy/ops-task/route.ts
- Create: tests/notification-transfer-withdrawal-adapters.test.mjs
- Modify: src/features/tasks/ops-task-service.ts
- Modify: src/features/tasks/ops-task-workspace.tsx

- [ ] **Step 1: assert submitted/completed management Chat intent only; no processing/applicant/operations phantom emission**
- [ ] **Step 2: make roster-transition completion atomic and idempotent**
- [ ] **Step 3: make checklist-only saves non-terminal and non-emitting**
- [ ] **Step 4: route legacy side effects by stable sourceEventId through shared ownership**
- [ ] **Step 5: run Node plus authorized pgTAP and commit**

~~~bash
"$NODE" --experimental-strip-types --test tests/notification-transfer-withdrawal-adapters.test.mjs
pnpm dlx supabase@2.109.1 test db
git add \
  supabase/migrations/20260716191000_notification_transfer_withdrawal_producers.sql \
  supabase/tests/notification_transfer_withdrawal_adapters_test.sql \
  src/app/api/notifications/legacy/ops-task/route.ts \
  tests/notification-transfer-withdrawal-adapters.test.mjs \
  src/features/tasks/ops-task-service.ts \
  src/features/tasks/ops-task-workspace.tsx
git commit -m "feat: produce transfer withdrawal events atomically"
~~~

---

### Task 17: Import and harden 휴보강 notification state

**Source packet:** Task 4 of docs/superpowers/plans/2026-07-15-notification-workflow-adapters.md.

**Files:**

- Create: supabase/migrations/20260716192000_notification_makeup_adapter.sql
- Create: supabase/tests/notification_makeup_adapter_test.sql
- Create: src/app/api/notifications/legacy/makeup/route.ts
- Create: tests/notification-makeup-adapter.test.mjs
- Modify: src/features/makeup-requests/makeup-request-service.ts
- Modify: src/features/makeup-requests/makeup-request-workspace.tsx
- Modify: tests/makeup-request-workspace.test.mjs

- [ ] **Step 1: compare current legacy settings/templates with the Task 8 baseline source revisions/checksums, then snapshot delivery/history/occurrence counts and checksums**
- [ ] **Step 2: reconcile only legacy configuration rows changed since Task 8**

Update only common rules/templates that are still system-owned and unmodified by an operator. Preserve stable IDs and revisions where content is unchanged, create no duplicate template, and stop on any operator-edited conflict instead of overwriting it. Two runs with no further legacy change are an idempotent no-op.

- [ ] **Step 3: import retained delivery/history/occurrence references and normalize completed, per-channel template, occurrence dedupe, and team read-state only as approved**

Task 17 owns delivery/history/occurrence import and legacy ownership adaptation. It does not blindly re-import Task 8 configuration. Add a test proving Task 17 after Task 8 leaves rule/template IDs, operator-edited revisions, enabled values, and unchanged checksums intact while importing the missing retained history exactly once.
- [ ] **Step 4: preserve current request/business mutation success even when post-commit legacy delivery fails**
- [ ] **Step 5: run Node plus authorized pgTAP and commit**

~~~bash
"$NODE" --experimental-strip-types --test \
  tests/notification-makeup-adapter.test.mjs \
  tests/makeup-request-workspace.test.mjs
pnpm dlx supabase@2.109.1 test db
git add \
  supabase/migrations/20260716192000_notification_makeup_adapter.sql \
  supabase/tests/notification_makeup_adapter_test.sql \
  src/app/api/notifications/legacy/makeup/route.ts \
  tests/notification-makeup-adapter.test.mjs \
  src/features/makeup-requests/makeup-request-service.ts \
  src/features/makeup-requests/makeup-request-workspace.tsx \
  tests/makeup-request-workspace.test.mjs
git commit -m "feat: adapt makeup notifications"
~~~

---

### Task 18: Produce electronic approval events from authoritative mutations

**Source packet:** Task 5 of docs/superpowers/plans/2026-07-15-notification-workflow-adapters.md.

**Files:**

- Create: supabase/migrations/20260716193000_notification_approval_producers.sql
- Create: supabase/tests/notification_approval_adapter_test.sql
- Create: tests/notification-approval-adapter.test.mjs
- Modify: src/features/approvals/approval-service.ts
- Modify: tests/approval-workspace.test.mjs

- [ ] **Step 1: write failing request/comment/approver/status/withdrawal event and rollback tests**
- [ ] **Step 2: add fixed-purpose mutation RPCs/triggers with immutable approval_event and approval_comment sources**
- [ ] **Step 3: resolve requester, current approver, and management without browser-supplied recipients**
- [ ] **Step 4: keep approval notification rules disabled**
- [ ] **Step 5: run Node plus authorized pgTAP and commit**

~~~bash
"$NODE" --experimental-strip-types --test \
  tests/notification-approval-adapter.test.mjs \
  tests/approval-workspace.test.mjs
pnpm dlx supabase@2.109.1 test db
git add \
  supabase/migrations/20260716193000_notification_approval_producers.sql \
  supabase/tests/notification_approval_adapter_test.sql \
  tests/notification-approval-adapter.test.mjs \
  src/features/approvals/approval-service.ts \
  tests/approval-workspace.test.mjs
git commit -m "feat: produce approval notification events"
~~~

---

### Task 19: Connect registration core, phone, visit, and SOLAPI ownership without flattening semantics

**Source packet:** Task 6 of docs/superpowers/plans/2026-07-15-notification-workflow-adapters.md.

**Files:**

- Create: supabase/migrations/20260716194000_notification_registration_handoffs.sql
- Create: supabase/tests/notification_registration_handoffs_test.sql
- Create: tests/notification-registration-handoffs.test.mjs
- Modify: src/features/tasks/registration-track-service.ts
- Modify: src/features/tasks/ops-task-workspace.tsx
- Modify: src/app/api/notifications/legacy/ops-task/route.ts
- Modify: src/app/api/registration/consultation-notification/route.ts
- Modify: src/app/api/solapi/registration/route.ts
- Modify: tests/registration-track-service.test.mjs
- Modify: tests/registration-consultation-notification.test.mjs
- Modify: tests/registration-admission-message-route.test.mjs

- [ ] **Step 1: preserve immediate visit appointment revision, participants, director targets, and failed-target retry**
- [ ] **Step 2: preserve phone queue create/reassign/unread-withdrawal/completion semantics**
- [ ] **Step 3: preserve SOLAPI claim/finalize/reconcile/delivery_unknown semantics**
- [ ] **Step 4: map one raw version-2 director event UUID exactly once; do not create a duplicate raw event**
- [ ] **Step 5: keep core, phone, visit, and SOLAPI behind four independent false flags and one shared ownership ledger**
- [ ] **Step 6: run focused route/service/pgTAP tests and commit**

~~~bash
"$NODE" --experimental-strip-types --test \
  tests/notification-registration-handoffs.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-consultation-notification.test.mjs \
  tests/registration-admission-message-route.test.mjs
pnpm dlx supabase@2.109.1 test db
git add \
  supabase/migrations/20260716194000_notification_registration_handoffs.sql \
  supabase/tests/notification_registration_handoffs_test.sql \
  tests/notification-registration-handoffs.test.mjs \
  src/features/tasks/registration-track-service.ts \
  src/features/tasks/ops-task-workspace.tsx \
  src/app/api/notifications/legacy/ops-task/route.ts \
  src/app/api/registration/consultation-notification/route.ts \
  src/app/api/solapi/registration/route.ts \
  tests/registration-track-service.test.mjs \
  tests/registration-consultation-notification.test.mjs \
  tests/registration-admission-message-route.test.mjs
git commit -m "feat: connect registration notification handoffs"
~~~

---

### Task 20: Close unsafe legacy endpoints, install the worker schedule, and prove operational readiness

**Source packet:** Task 7 of docs/superpowers/plans/2026-07-15-notification-workflow-adapters.md.

**Files:**

- Create: supabase/migrations/20260716195000_notification_workflow_legacy_closure.sql
- Create: supabase/migrations/20260716195500_notification_worker_schedule.sql
- Create: supabase/tests/notification_workflow_seed_test.sql
- Create: supabase/tests/notification_worker_schedule_test.sql
- Create: tests/notification-provider-endpoint-closure.test.mjs
- Create: tests/notification-workflow-entrypoints.test.mjs
- Create: tests/notification-operations.test.mjs
- Create: scripts/verify-notification-workflow-entrypoints.mjs
- Create: scripts/manage-notification-worker-schedule.mjs
- Create: scripts/verify-notification-contract-drain.mjs
- Create: src/features/notifications/server/notification-operations-metrics.ts
- Create: src/app/api/notifications/operations/route.ts
- Modify: src/app/api/google-chat/route.ts
- Modify: src/app/api/web-push/route.ts
- Modify: src/app/api/notifications/worker/route.ts

**Atomic rollback interface:**

~~~sql
public.activate_notification_dispatch_cutover_v1(
  p_scope_key text,
  p_dispatch_flag_key text,
  p_expected_flag_revisions jsonb,
  p_request_id uuid
) returns jsonb

public.abort_notification_shadow_v1(
  p_expected_flag_revisions jsonb,
  p_request_id uuid,
  p_reason_code text
) returns jsonb

public.clear_notification_worker_stop_latch_v1(
  p_expected_latch_revision bigint,
  p_request_id uuid,
  p_reason_code text
) returns jsonb

public.rollback_notification_dispatch_cutover_v1(
  p_scope_key text,
  p_flag_keys text[],
  p_expected_flag_revisions jsonb,
  p_reenable_shadow boolean,
  p_request_id uuid,
  p_reason_code text
) returns jsonb
~~~

The activation RPC is the only production cutover mutation. On the first owner it atomically changes global shadow from true to false and enables that owner's dispatch flag after exact revisions/ownership/readiness checks; later owners require shadow already false and enable one dispatch flag at a time.

The shadow-abort RPC handles faults before any owner is cut over. It atomically forces shadow, settings UI, and every dispatch flag false; cancels pending/retry_wait canonical work; marks claimed pre-send work cancel_requested; and raises a private worker stop latch checked before every canonical claim/begin. Legacy remains the sole owner. Clearing the latch uses only the fixed admin/service operation above, changes no feature flag, requires expected revision, fresh heartbeats, clean metrics, an audit reason, and explicit re-authorization; rollback never clears it implicitly.

In one service-role rollback transaction, the rollback RPC sets every named dispatch flag false, sets global shadow false as the safe baseline, disables the global settings UI so Task 1A containment returns, cancels pending/retry_wait deliveries as cutover_rollback, and stamps cancel_requested_at/reason on claimed pre-send deliveries. A partial one-scope rollback therefore keeps global shadow false so previously cut-over owners continue canonical dispatch. p_reenable_shadow = true is accepted only when the request includes and disables every currently enabled dispatch owner as one all-owner rollback and the fault did not compromise shadow/worker safety; only that full rollback may restore global shadow. It preserves canonical settings plus sending, sent, failed, canceled, and delivery_unknown history and never transfers a dispatch-started claim.

- [ ] **Step 1: enumerate every legacy writer/sender and map it to exactly one workflow/owner/flag**

Prove both old and new rolling-deploy bundles use the shared rule-scoped ownership claim before any flag can change. No deployment may rely on process-local mutual exclusion.

- [ ] **Step 2: verify exact registry completeness**

Require exactly the twelve approved false-by-default flag rows, no alias or env mirror, both required runtime markers, and registration marker checks for its four specialized flags. Verify the Task 8 settings registry/import is idempotent, add the closed source-type registry, and add only adapter/legacy-closure rows not already owned by Task 8, Task 11, or Task 17.

- [ ] **Step 3: implement a bridge-aware dual-contract bundle before closure**

Before the closure marker exists, the newly deployed server keeps the old browser envelope only as a measured compatibility path, logs sanitized contract-version/entry-point counts, leaves legacy as sole side-effect owner, and keeps every canonical dispatch flag false. Audit every old caller: where its envelope contains an authoritative stable source/event ID, the bridge must ignore browser title/body/target and recompute the fixed-purpose intent server-side. Any caller without enough identity must be upgraded and reach zero traffic before closure. New clients send a fixed notification contract version and use fixed-purpose source/event routes. When the closure marker exists, a legacy envelope may be translated only from an allowlisted authoritative source/event ID; arbitrary Google Chat/Web Push title/body/href/recipient values are ignored/rejected, and an untranslatable request returns notification_payload_forbidden with zero provider call.

Add a response/build contract version so open stale browser bundles are identifiable. The closure phase requires at least 24 continuous hours of zero untranslatable old-contract traffic spanning one full operating day, all bridge-aware clients deployed, and every pre-bridge server instance drained. The safe source-ID translator remains available for later-waking stale tabs; it never trusts their content/target. If the platform cannot prove old server drain, do not apply the closure migration or revoke grants.

- [ ] **Step 4: preserve fixed connection management and current-browser Push self-test routes**

- [ ] **Step 5: define a distinct, gated contract-closure migration**

The 20260716195000 migration creates the closure marker and revokes arbitrary authenticated inbox/provider/domain notification writes only after every fixed-purpose replacement passed, the bridge-aware bundle is fully deployed, old server instances are drained, and the 24-hour/full-operating-day drain gate passed. Preserve required legacy reads through the retention period. Applying this migration is a separate post-deploy authorization step, not an automatic part of the bridge bundle deploy.

- [ ] **Step 6: install one idempotent every-minute worker schedule**

Use Supabase pg_cron plus pg_net. The migration defines the fixed private invocation/install/disable/remove contract; the manage script performs the environment-specific install only after the worker route is deployed and Vault entries are provisioned. The scheduled SQL command calls the fixed private function; that function reads both worker URL and Bearer secret by stable names from Supabase Vault at execution time.

Before attaching the Bearer secret, parse and require: scheme exactly https; no username/password; no query; no fragment; port absent or exactly 443; host exactly the environment's separately approved deployment host; and path exactly /api/notifications/worker with no path normalization ambiguity. Store the approved host as sanitized private configuration/audit, not as browser input. Any malicious/mismatched Vault URL makes zero pg_net request. The URL/secret never appears in migration text, cron.command, logs, audit, errors, or test output. Missing extensions, missing Vault rows, wrong URL policy, or missing secret fails closed before any HTTP request.

The manage script supports inspect, install, disable, and remove. Install/update leaves exactly one named worker schedule; the following watchdog step adds exactly one separately named watchdog schedule. Disable/remove is the documented schedule rollback and never deletes delivery/event history. pgTAP proves zero/one/duplicate-install, missing-Vault no-request, fixture pg_net request shape, and exactly one of each expected schedule without contacting a real host. Applying this migration or installing production schedules requires separate environment authorization.

- [ ] **Step 7: add sanitized operations metrics and an independent cutover watchdog**

Expose admin/staff summaries only: per workflow/channel status and closed reason counts, oldest pending age/queue lag, pending/claimed/sending/retry_wait and reconciliation backlogs, delivery_unknown count, ownership denial/duplicate-attempt count, shadow match/mismatch rate, and last successful heartbeat age. Never return source payloads, rendered bodies, recipients, endpoints, phone numbers, provider bodies, or secrets.

Immediate stop/alert thresholds are: any canonical provider request or inbox projection in shadow; any legacy/canonical duplicate external attempt; any new delivery_unknown; three consecutive missed one-minute worker heartbeats; pending later than schedule by more than five minutes; workflow scope mismatch; or enabled rule with zero audience. A cutover verifier consumes these metrics and fails closed.

Schedule a separate every-minute dashboard_private cutover-watchdog function with pg_cron; it must not call the notification worker endpoint or share the worker credential/process. The cron job is owned by the fixed migration/database service role, browser/authenticated EXECUTE is revoked, and no HTTP secret is involved. Use fixed search_path, acquire one advisory lease per run, and record sanitized watchdog start/terminal heartbeats. It inspects only active shadow/cutover scopes. On a stop threshold it calls the internal atomic rollback helper. If expected flag revisions changed, refresh once and retry with the new complete revision set; mixed/unknown flag keys, one stale revision, or any invalid scope fails the entire transaction with zero partial flag/cancellation changes.

Classify faults before rollback. During pre-cutover shadow, any canonical provider request/inbox projection or global worker/schedule/Vault/route fault invokes abort_notification_shadow_v1, raises the stop latch, and leaves legacy as owner. After cutover begins, a global failure, three missed worker heartbeats, or a cross-workflow duplicate invokes one all-owner rollback containing every currently enabled dispatch flag, raises the latch for global execution faults, and leaves shadow false until repair/re-authorization. A workflow-local mismatch, queue lag, delivery_unknown, zero-audience rule, or ownership anomaly invokes only that workflow/specialized-owner partial rollback and leaves global shadow false so unrelated canonical owners continue. No fault path immediately re-enables the path that triggered it.

If the retry/rollback fails, record a critical rollback_failed audit/metric, do not advance any cutover, and withhold a successful watchdog heartbeat. Canonical and fixed-purpose legacy begin-send gates require a recent successful watchdog heartbeat whenever a production shadow/cutover scope is active, so a dead or failing watchdog stops new side effects independently of worker health. The operations surface makes this critical state explicit for manual escalation.

- [ ] **Step 8: add the final workflow-adapter runtime marker last**

Create notification_workflow_adapters_runtime_version() = 1 as the final statement/object of 20260716195500_notification_worker_schedule.sql, not the earlier closure migration, and only after the worker route, exact-one worker/watchdog schedule contracts, every entry point, ownership bridge, rollback RPC, metrics, and tests exist. Enabling any flag must additionally recheck successful worker and watchdog heartbeats within the last three minutes.

- [ ] **Step 9: run entry-point scan, Node, authorized local/preview pgTAP, type, lint, build, schedule rollback, and provider-zero ledgers**
- [ ] **Step 10: commit**

~~~bash
git add \
  supabase/migrations/20260716195000_notification_workflow_legacy_closure.sql \
  supabase/migrations/20260716195500_notification_worker_schedule.sql \
  supabase/tests/notification_workflow_seed_test.sql \
  supabase/tests/notification_worker_schedule_test.sql \
  tests/notification-provider-endpoint-closure.test.mjs \
  tests/notification-workflow-entrypoints.test.mjs \
  tests/notification-operations.test.mjs \
  scripts/verify-notification-workflow-entrypoints.mjs \
  scripts/manage-notification-worker-schedule.mjs \
  scripts/verify-notification-contract-drain.mjs \
  src/features/notifications/server/notification-operations-metrics.ts \
  src/app/api/notifications/operations/route.ts \
  src/app/api/notifications/worker/route.ts \
  src/app/api/google-chat/route.ts \
  src/app/api/web-push/route.ts
git commit -m "fix: close legacy notification payload writers"
~~~

---

### Task 21: Build cutover verification and rehearse rollback without production flag changes

**Source packet:** Task 8 and Final Release Gates of docs/superpowers/plans/2026-07-15-notification-workflow-adapters.md.

**Files:**

- Create: scripts/verify-notification-workflow-cutover.mjs
- Create: tests/notification-workflow-cutover.test.mjs
- Create: docs/operations/notification-workflow-cutover.md
- Do not enable production flags as part of the code commit.

- [ ] **Step 1: run deterministic fixture/preview shadow**

Canonical shadow rows end skipped/shadow_mode. They create no provider call or inbox projection and are never replayed at cutover. In fixture/preview, total external calls from both legacy and canonical transports are exactly zero. Legacy is simulated as the sole side-effect owner with an injected recorder.

- [ ] **Step 2: compare normalized intent**

Comparison key:

~~~text
workflowKey
eventKey
occurrenceKey
audienceKey
channelKey
targetKey
targetGeneration
template_checksum
normalized_rendered_content_hash
~~~

Classify every mismatch as missing event, extra event, target mismatch, target-generation mismatch, channel mismatch, template mismatch, or an explicitly approved normalization. The verifier treats targetGeneration as a decimal-string business recipient generation and rejects any comparison that substitutes the independent dispatch ownerGeneration.

- [ ] **Step 3: require code/preview evidence**

- low-frequency paths: at least one complete deterministic fixture cycle;
- fixture/preview total external requests: exactly zero;
- canonical inbox projections: exactly zero;
- duplicate legacy/canonical external requests: exactly zero;
- enabled rule with zero audience: investigated before cutover;
- delivery_unknown, missed-heartbeat, queue-lag, scope-mismatch, ownership-denial anomaly, or shadow mismatch fixtures block the verifier and trigger the classified rollback path;
- a provider/inbox side effect during pre-cutover shadow invokes the dedicated shadow abort, leaves every flag false, raises the stop latch, and never re-enables shadow automatically.

- [ ] **Step 4: encode but do not execute the exact cutover order**

1. tasks;
2. word_retests;
3. approvals;
4. transfer;
5. withdrawal;
6. makeup_requests;
7. registration core plus reminders;
8. registration phone inbox;
9. registration visit immediate;
10. registration SOLAPI.

Finish the authorized seven-day production shadow gate for every active path before the first cutover. The first future cutover uses activate_notification_dispatch_cutover_v1 to turn global shadow true → false and enable exactly the first dispatch flag atomically; later calls enable one ordered owner at a time while shadow remains false. Each call changes the server-authoritative dispatch owner and disables the matching legacy side effect through the same database flag/ownership boundary. Both old and new rolling bundles must already consult that boundary. Registration specialized owners remain independently reversible.

- [ ] **Step 5: rehearse atomic rollback before production**

1. Call rollback_notification_dispatch_cutover_v1 once; the same transaction sets the affected dispatch flag set false, disables the live common settings UI/returns Task 1A containment, cancels pending/retry_wait with cutover_rollback, and marks claimed pre-send work cancel_requested. Partial rollback keeps global shadow false. Only an all-owner rollback that disables every enabled owner may set p_reenable_shadow = true.
2. Confirm the returned revisions/counts and wait for claimed/lease closure without holding a business lock.
3. Never resend sending or delivery_unknown through legacy.
4. Only after closure, transfer a reserved, never-started ownership claim to legacy's next owner generation with transfer_notification_dispatch_ownership_v1.
5. Reject transfer for dispatch_started, sending, sent, provider-referenced, or delivery_unknown claims.
6. For a partial rollback, confirm previously cut-over owners still dispatch canonically and the restored legacy scope creates no canonical side effect. For a safe all-owner rollback with p_reenable_shadow = true, confirm global shadow recording resumed without a side effect; otherwise confirm shadow remains false.
7. Preserve sent/failed/unknown rows, settings import, receipts, and audit.

Tests cover partial rollback with other canonical owners still active, all-owner rollback with shadow restoration, mixed/unknown flag keys, and one stale expected revision. Every invalid case leaves all flags, deliveries, cancel requests, and ownership rows unchanged.

- [ ] **Step 6: encode readiness and automatic stop gates**

No verifier may recommend a flag enable unless the registry has exactly twelve rows, common and adapter runtime markers match version 1, registration marker exists for registration flags, the private worker stop latch is clear, and the latest successful worker and watchdog heartbeats are both under three minutes old. During a rollout, any Task 20 immediate-alert threshold invokes the dedicated shadow abort or correctly classified partial/all-owner atomic rollback and stops the sequence before another workflow advances.

- [ ] **Step 7: document post-authorization retention**

Keep legacy settings/history/provider-state reads for at least 14 canonical-only days and one successful rollback drill. Removal requires a separate reviewed plan and is not part of branch completion.

- [ ] **Step 8: run the mandatory Release F gate and commit verification support**

~~~bash
git add \
  scripts/verify-notification-workflow-cutover.mjs \
  tests/notification-workflow-cutover.test.mjs \
  docs/operations/notification-workflow-cutover.md
git commit -m "test: verify notification workflow cutovers"
~~~

Do not commit production flag values, secrets, real endpoints, or provider payloads.

**Release F code gate:** local/preview evidence proves one and only one owner can create each side effect at every simulated rollout/rollback point, the atomic rollback works, all flags remain false, and the mandatory full release gate passes. Seven production days and live cutover are deliberately not prerequisites for this code-complete handoff.

### Post-authorization operational stages

These stages occur only after Task 22 hands off code/preview evidence. They are not silently run as part of implementation.

1. **Authorized expand phase.** Approve and apply only additive migrations through 20260716194000 with all twelve flags false; withhold the 195000 closure and 195500 schedule migrations. Prove current production behavior still works and no new provider owner is active.
2. **Authorized bridge-aware app phase and drain.** Deploy the compatible bundle against the expanded schema. New clients use fixed-purpose contracts while old-contract traffic is measured. Drain every pre-bridge server instance, version-gate open stale browser bundles, and require at least 24 continuous hours of zero untranslatable old-contract traffic spanning one full operating day. Keep the safe source-ID translator for later-waking stale tabs. If any proof is missing, stop here.
3. **Authorized contract/schedule phase and production shadow.** Apply 20260716195000 to close/revoke the old contract, then apply 20260716195500 whose final object is the adapter runtime marker. Provision the named Vault values, install exactly one worker schedule plus one independent watchdog schedule, and prove both successful heartbeats. With a specific shadow approval, set shadow false → true while every dispatch flag and settings UI flag remain false. Legacy alone may continue normal live sends; canonical provider calls and canonical inbox projections remain zero. Require seven consecutive production days of 100% normalized intent match for every active legacy path plus a deterministic cycle for low-frequency paths, with all stop metrics green.
4. **Separately authorized owner-by-owner cutover.** Obtain a new approval for each ordered flag/legacy-owner transfer. Immediately before each transaction recheck the exact twelve flags, required markers, worker/watchdog heartbeats under three minutes, zero stop alerts, and shared ownership. The first activation atomically sets shadow true → false and enables only the first owner; later activations enable one owner at a time. Hold and observe after each. Any rollback disables the common settings UI before restoring legacy ownership; a partial rollback keeps shadow false, while only an all-owner rollback may atomically restore shadow true.
5. **Finish the saved-settings request only after all owners are canonical.** After all ten owners pass their hold gates, separately enable notification_control_plane_settings_ui_enabled. Confirm Task 1A containment disappears and the shared panel is the only editor. In the live browser, save/reload one non-delivering disabled rule/template in each of the seven workflow panels and prove the matching canonical sender reads that revision. Keep provider delivery ledgers zero during this test. If any workflow rolls back to legacy, atomically disable the settings UI again.
6. **Retention.** Keep legacy reads for at least 14 canonical-only days and complete one successful rollback drill. Do not delete legacy tables/columns/history in this plan.

---

### Task 22: Run the final operational release gate and hand off truthfully

**Files:**

- Verify all touched code, migrations, tests, fixtures, and docs.
- Update this plan's checkbox/evidence sections with actual results.

- [ ] **Step 1: run focused suites**

~~~bash
"$NODE" --experimental-strip-types --test \
  tests/admin-shell.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/registration*.test.mjs \
  tests/notification*.test.mjs \
  tests/makeup-request-workspace.test.mjs \
  tests/approval-workspace.test.mjs
~~~

Expected: zero failures.

- [ ] **Step 2: run full static/build gates**

Stop only the recorded implementation-worktree dev-server PID before build if it shares that worktree's .next directory. Never kill an unrelated root-workspace/user server.

~~~bash
"$NODE" --experimental-strip-types --test tests/*.test.mjs
pnpm exec tsc --noEmit
pnpm run lint
pnpm run build
git diff --check
~~~

Expected: zero full-test failures; typecheck/lint/build pass; diff check is empty. Record actual counts.

- [ ] **Step 3: run authorized database and concurrency gates**

~~~bash
pnpm dlx supabase@2.109.1 test db
~~~

Run the registration two-session concurrency script against an explicitly authorized local/preview database. Verify:

- atomic parent/track/appointment/history/event/job rollback;
- rule/source/recipient revision conflicts;
- claim/lease/cursor compare-and-swap;
- exact decimal-string bigint handling;
- ownership races;
- A→B→A supersession;
- receipt visibility;
- cancel-before-send;
- delivery_unknown no-auto-retry;
- exactly one named worker schedule plus one named watchdog schedule, Vault-missing fail-closed behavior, and disable/remove/reinstall idempotency for both;
- atomic flag-disable plus pending/retry cancellation plus claimed cancel-request rollback.

- [ ] **Step 4: run route-by-route browser QA**

Using the recorded worktree-owned OPS_BROWSER_BASE_URL, desktop 1349x987 and mobile 390x844:

- /admin/registration: canonical create, reload, history, calendar, deep links, conflict draft, reminder preview;
- /admin/settings/notifications: seven workflow save/reload/conflict/dirty navigation;
- scoped launchers on tasks, word-retests, registration, transfer, withdrawal, makeup, approvals;
- /admin/dashboard: existing visible filters/menu order/no false summary, inline read without navigation, Push readiness states;
- no horizontal overflow, runtime error, console error, focus trap, or inaccessible nested interactive control.

The workflow browser abort ledger must contain zero delivery attempts to /api/google-chat, /api/web-push, and /api/solapi. The separately named connection-management ledger may contain only stubbed non-delivery GET/PATCH and no POST. Injected server transports must show zero external hosts. Preview/staging shadow must show zero total external provider calls and zero canonical inbox projections.

- [ ] **Step 5: distinguish blocked from passed external delivery**

- Google Chat live verification is not passed without one separately authorized fixed test and confirmed destination.
- Web Push live verification is not passed without HTTP 200 assets, matching VAPID pair, current-profile binding, and one user-confirmed fixed self-test on desktop plus installed mobile where required.
- SOLAPI live verification is not passed without separately authorized test credentials and its claim/reconciliation audit.
- Missing credentials/configuration is reported as blocked, never silently converted to pass.

- [ ] **Step 6: verify dashboard non-goal**

Search for new cross-workflow dashboard summaries/loaders. Expect none. The page still begins with the existing filters and operational metrics.

- [ ] **Step 7: prepare rollout evidence and request authorization**

Provide:

- commit list by release;
- migration list and target environment;
- test counts;
- browser screenshots/route checklist;
- feature-flag matrix, all false before approval;
- deterministic fixture/preview shadow match report;
- explicit statement that seven-day production shadow and live cutover have not run unless separately authorized;
- worker and watchdog schedule inspect/disable/remove evidence plus both latest fixture heartbeats;
- rollback rehearsal result;
- exact remaining blocked external checks;
- origin/main delta.

Do not push, deploy, apply linked migrations, install/enable the production schedules, run production shadow, or enable flags until the user approves the specific action. Production shadow authorization and production cutover authorization are separate decisions.

- [ ] **Step 8: finish the branch only after all required gates pass**

Use superpowers:verification-before-completion, then superpowers:finishing-a-development-branch. Never claim completion merely because files exist or local unit tests pass.

---

## 5. Release-level acceptance checklist

### Release A — registration truth

- [ ] Visible create fields equal the atomic RPC payload.
- [ ] No phone reservation datetime.
- [ ] No scheduling-time result URL.
- [ ] Owner → visit time → room order.
- [ ] Exact two-probe runtime matrix and fail-closed probe errors pass at UI, service, and RPC boundaries.
- [ ] Retry envelope freezes fingerprint/requestKey/inquiryAt/normalized workflow and notification failure never replays create.
- [ ] Reload shows one canonical result without duplicates.
- [ ] Canonical reschedule/participants/director/result editors still work.
- [ ] Full release gate and both provider-zero ledgers pass.

### Release A2 — fake-settings containment

- [ ] Registration/transfer/withdrawal expose no editable session-only toggle/template as saved state.
- [ ] Persisted webhook management and existing sender behavior remain intact.
- [ ] The UI states honestly that shared saved settings are not yet live.
- [ ] Full release gate and provider-zero ledgers pass.

### Release B — settings foundation, inbox, Push truth

- [ ] Seven workflows use one persisted settings contract and explicit save in fixture/preview.
- [ ] Global and scoped revisions match after reload.
- [ ] No nonfunctional applicant/operations cells.
- [ ] Makeup baseline import is idempotent and preserves real persisted state.
- [ ] Per-profile receipt state is independent and legacy read_at is historical fallback only.
- [ ] Inline 읽음 keeps route and popover; Link read attempt never blocks navigation.
- [ ] Push readiness exposes the exact next action and no false success.
- [ ] Live containment remains until Release F code plus separately authorized operational rollout make saved rules authoritative.
- [ ] Full release gate and provider-zero ledgers pass.

### Release C — history truth

- [ ] Every new authoritative mutation has a same-transaction v2 event.
- [ ] Timeline is read-only and separates actor from current owner.
- [ ] Migration/unknown actor/time are labeled honestly.
- [ ] Seven-argument wrapper delegates once to v2 and no mutation double-writes.
- [ ] Full release gate and provider-zero ledgers pass.

### Release D — calendar truth

- [ ] One appointment ID creates one item.
- [ ] Same-day appointments remain distinct.
- [ ] Shared subjects appear as badges on one item.
- [ ] Phone/legacy dates never appear.
- [ ] Deep links restore the exact appointment.
- [ ] Full release gate and provider-zero ledgers pass.

### Release E — reminder truth

- [ ] Exactly nine fixed-variant rows are correct and disabled by default.
- [ ] Approved KST wall-clock/lead editing and all-disabled warning work through the common panel.
- [ ] Occurrence identity uses appointment/rule revisions.
- [ ] Reschedule/cancel/completion/director change preserve exact revision rules.
- [ ] Worker retries only safe outcomes and never auto-retries delivery_unknown.
- [ ] Both runtime markers are required.
- [ ] Full release gate and provider-zero ledgers pass.
- [ ] Package is not deployed/applied independently before worker route, schedules, final adapter marker, and recent heartbeats exist.

### Release F — workflow ownership truth

- [ ] Seven exclusive producers/adapters exist.
- [ ] Browser cannot submit arbitrary provider content/targets.
- [ ] Exactly one Vault-backed every-minute worker schedule and one independent watchdog schedule exist, both heartbeats are recent, and observability stop thresholds work.
- [ ] Expand → compatible bundle/drain → closure → schedule/marker ordering is proven; old contract traffic is zero before closure.
- [ ] Fixture/preview shadow makes zero external calls and zero canonical inbox projections.
- [ ] A pre-cutover shadow violation atomically disables all flags, raises the worker stop latch, and leaves legacy as sole owner.
- [ ] targetGeneration is compared and never confused with ownerGeneration.
- [ ] Atomic rollback disables flags and cancels/requests cancellation without a race.
- [ ] First cutover atomically sets shadow true → false; every rollback hides common settings, partial rollback keeps shadow false, and only all-owner rollback restores shadow true.
- [ ] Code/preview cutover simulation always has one owner; production shadow/cutover remains separately authorized.
- [ ] After all ten owners are canonical, enabling the settings UI replaces containment and all seven panels pass live save/reload with disabled non-delivering rules.
- [ ] Legacy-read retention is documented for post-cutover operations.
- [ ] Full release gate and provider-zero ledgers pass.

---

## 6. Explicitly deferred work

The following stays outside this plan:

- integrated dashboard 내가 해야 할 일/내가 요청한 일 summary;
- the named follow-up Exhaustive 5W1H Retrofit for untouched existing forms; every form created or materially edited by this plan still must follow 누가 → 언제 → 어디서 → 무엇을 → 어떻게;
- drag-and-drop appointment editing;
- registration reminders to students/guardians;
- replacement of the academic calendar with the registration calendar;
- deletion of legacy tables/columns/history;
- live provider enablement without separate approval;
- production deploy/push as an automatic final step.

---

## 7. Stop and reporting rules

Stop the current release and report the exact blocker when:

- visible registration fields cannot be proven in reloaded canonical rows;
- a runtime probe error is treated as ready or inquiry fallback instead of blocking/retry;
- an atomic mutation partially commits;
- an existing legacy sender loses ownership before its replacement is ready;
- a shadow run contacts a provider;
- preview/staging shadow creates any new canonical inbox projection;
- a duplicate owner/provider request is detected;
- a worker misses three one-minute heartbeats or pending work is more than five minutes late;
- a stale revision overwrites newer data;
- inbox list/count/mark disagree;
- a team member's read hides another member's unread state;
- a new read or projection mutates compatibility dashboard_notifications.read_at;
- a Push endpoint belongs to a different profile;
- any migration needs destructive rollback;
- a test/QA database is non-local or the browser server cannot be tied to the recorded worktree/HEAD;
- a production secret, webhook, phone number, endpoint, or message body appears in a client/audit response;
- full tests, type, lint, build, database tests, or exact-route browser QA fail.

If work pauses, report each line as 완료, 부분완료, 미완료, or 차단. Name the last passing task, the exact failing command/route, whether data/schema changed, whether any provider was called, and the safe next task. Never summarize a partially finished release as complete.
