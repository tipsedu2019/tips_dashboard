# Registration Workflow Chart And Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make registration load quickly, split level-test and consultation work, show the approved six-stage operating chart, and deliver secure consultation-reservation notifications.

**Architecture:** Keep the single moving registration task and existing Supabase tables. Add a registration-only class projection plus same-key in-flight request deduplication, render workflow data from the registration domain module, and use a staff-only server endpoint for counselor/dashboard and management Google Chat notifications.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase JavaScript client, Node test runner, Tailwind CSS, and the in-app Browser.

## Global Constraints

- One registration case remains the source of truth from inquiry through completion.
- Top tab order is exactly `문의 → 레벨테스트 → 상담 → 대기 → 등록 → 완료`.
- Existing `flow=consulting` URLs remain valid and now mean the consultation-only tab.
- Registration class queries must not select schedule, schedule plan, fee, roster, or waitlist payloads.
- Consultation notification failures never roll back the saved business transition.
- No multi-attempt level-test schema, deployment, commit, or production migration is included.

---

### Task 1: Lock The Loading Regression

**Files:**
- Create: `tests/ops-task-service-loading.test.mjs`
- Modify: `src/features/tasks/ops-task-service.ts`

**Interfaces:**
- Consumes: existing `getOpsTaskWorkspaceCacheKey(options)` and Supabase client.
- Produces: `readOpsClassRows(taskType)` and one in-flight Promise per cache key.

- [ ] Write a transpile-and-VM test proving registration selects `id,name,subject,grade,teacher,room,textbook_ids` and transfer still selects the full class projection.
- [ ] Run `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/ops-task-service-loading.test.mjs`; expect the registration projection assertion to fail because `schedule_plan` is still selected.
- [ ] Add `OPS_REGISTRATION_CLASS_COLUMN_CANDIDATES`, pass `options.taskType` into `readOpsClassRows`, and retain the existing candidates for non-registration workspaces.
- [ ] Add a delayed Supabase mock test that calls `loadOpsTaskWorkspaceData` twice before the first call settles and expects one task/class query wave.
- [ ] Run the focused test; expect the query count assertion to fail with two waves.
- [ ] Add `Map<string, Promise<OpsTaskWorkspaceData>>`, reuse a pending same-key request, and only cache/delete when the map still points to that Promise.
- [ ] Re-run the focused test; expect all cases to pass, including fallback, different-key isolation, and post-settle TTL cache reuse.

### Task 2: Lock The Six-Stage Registration Contract

**Files:**
- Modify: `tests/registration-workflow.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`
- Modify: `src/features/tasks/registration-workflow.js`
- Modify: `src/features/tasks/ops-task-workspace.tsx`

**Interfaces:**
- Produces: `getRegistrationWorkflowStages()` and `RegistrationViewKey` containing `level_test`.
- Mapping: `1./1-1. -> level_test`, `2./3. -> consulting`.

- [ ] Add runtime tests for six ordered workflow stages, required branch notes, URL output, notification rule, waitlist re-test loop, and view-key mapping.
- [ ] Add source-contract tests for six top tabs, separate table columns, chart placement, `aria-expanded`, and `data-testid="registration-workflow-chart"`.
- [ ] Run both tests; expect missing `level_test` mapping and missing chart failures.
- [ ] Export immutable workflow stage data through `getRegistrationWorkflowStages()`.
- [ ] Split the tab type, tab list, prefix map, and per-view columns while keeping `consulting` URL compatibility.
- [ ] Render `RegistrationWorkflowChart` immediately below the tab/tool row. Keep the compact six-stage strip visible and show six detailed cards when expanded.
- [ ] Rename the existing level-test link label to `시험지·결과지 URL` in form and detail surfaces.
- [ ] Re-run both tests; expect all new contracts to pass.

### Task 3: Deliver Consultation Reservation Notifications

**Files:**
- Create: `src/app/api/registration/consultation-notification/route.ts`
- Modify: `src/features/tasks/registration-workflow.js`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `tests/registration-workflow.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`

**Interfaces:**
- Registration input stores counselor display text in `registration.counselor` and profile identity in `secondaryAssigneeId`.
- POST body is `{ taskId: string }`; the server reloads canonical task/detail data.
- Response is `{ ok: true, skipped?: boolean }` or a non-2xx `{ ok: false, error: string }`.

- [ ] Add tests that consultation reservation requires both appointment time and `secondaryAssigneeId`.
- [ ] Add source tests requiring staff/admin authorization, canonical task lookup, registration/`2.` checks, personal dashboard dedupe, and admin Google Chat dedupe.
- [ ] Run the tests; expect failures because the profile selector and endpoint do not exist.
- [ ] Replace the free-text counselor field with a profile-linked principal selector that writes both fields.
- [ ] Implement the server endpoint using authenticated and service-role Supabase clients. Read the current task/detail, insert the counselor notification with `registration:{taskId}:consultation:{reservationKey}:counselor`, and post the canonical message to the configured admin webhook once.
- [ ] Call the endpoint after a newly created or changed consultation reservation. Await it, preserve the saved task on failure, and surface a warning.
- [ ] Re-run the focused tests and confirm all cases pass.

### Task 4: Verify The Complete Surface

**Files:**
- Verify: `src/features/tasks/ops-task-service.ts`
- Verify: `src/features/tasks/registration-workflow.js`
- Verify: `src/features/tasks/ops-task-workspace.tsx`
- Verify: `src/app/api/registration/consultation-notification/route.ts`

- [ ] Run all registration-focused Node tests and require zero failures.
- [ ] Run scoped ESLint and `tsc --noEmit` and require exit code 0.
- [ ] Run the production build and require exit code 0.
- [ ] Open `/admin/registration?flow=inquiry`, measure shell-to-data readiness, and confirm no duplicate registration request wave.
- [ ] Expand the chart and verify all six stages at desktop and 390px mobile widths without page-level horizontal overflow.
- [ ] Select `레벨테스트`, then `상담`, and confirm URL and table columns update.
- [ ] Save a reversible consultation-reservation test fixture, verify the counselor notification record and management Google Chat request result, then remove the fixture.
- [ ] Check Browser console errors/warnings and capture final desktop and mobile screenshots outside the repository.
