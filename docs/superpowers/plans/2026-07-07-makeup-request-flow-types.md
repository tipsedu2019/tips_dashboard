# Makeup Request Flow Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 휴강만 and 보강만 request flows while preserving the existing 휴강+보강 approval path and fixing orphaned makeup calendar collisions.

**Architecture:** Keep one `makeup_requests` domain and add a `request_kind` discriminator: `cancel_makeup`, `cancel_only`, `makeup_only`. Approval completes requests that already have a makeup schedule, but a `cancel_only` approval moves to `makeup_pending` so operators can track unresolved makeup/refund cases.

**Tech Stack:** Next.js, Supabase, source-level Node tests in `tests/makeup-request-*.test.mjs`, existing makeup-request model/service/workspace files.

## Global Constraints

- Preserve the visible field wording: `과목`, `선생님`, `수업`, `사유`, `휴강일`, `보강일시`, `보강 강의실`, `결재자`.
- Keep the form compact and action-oriented; do not add explanatory cards.
- Use TDD: add failing model/workspace tests before production changes.
- Do not reintroduce direct delete actions in the 휴보강 table.

---

### Task 1: Model Flow Types and Orphan Collision Guard

**Files:**
- Modify: `src/features/makeup-requests/makeup-request-model.js`
- Modify: `src/features/makeup-requests/makeup-request-model.d.ts`
- Test: `tests/makeup-request-model.test.mjs`

**Interfaces:**
- Produces: `MAKEUP_REQUEST_KINDS`, `getMakeupRequestKind(request)`, `hasCancelPart(request)`, `hasMakeupPart(request)`.
- Produces: `buildRoomAvailability({ requests })` ignores `academic_events` makeup metadata when the referenced request id is not present in live request data.

- [ ] **Step 1: Write failing tests**

Add tests that:
- `buildRoomAvailability` ignores an orphan `academic_events` makeup entry when no matching request exists.
- `applyMakeupRequestToSchedulePlan` supports cancel-only and makeup-only requests.
- `buildMakeupCalendarDrafts` emits only cancel drafts for cancel-only and only makeup drafts for makeup-only.

- [ ] **Step 2: Run model tests to verify failure**

Run: `node --test tests/makeup-request-model.test.mjs`
Expected: FAIL on missing flow/orphan behavior.

- [ ] **Step 3: Implement model helpers**

Add flow helpers, include `makeup_pending` in statuses and active reservations, update schedule-plan/calendar helpers to branch by request kind, and pass live request ids into academic-event collision filtering.

- [ ] **Step 4: Run model tests to verify pass**

Run: `node --test tests/makeup-request-model.test.mjs`
Expected: PASS.

### Task 2: Service Schema and Approval Behavior

**Files:**
- Create: `supabase/migrations/20260707170000_makeup_request_flow_types.sql`
- Modify: `src/features/makeup-requests/makeup-request-service.ts`
- Test: `tests/makeup-request-workspace.test.mjs`

**Interfaces:**
- Consumes: `hasCancelPart`, `hasMakeupPart`, `getMakeupRequestKind`.
- Produces: `MakeupRequestInput.requestKind`.
- Produces: `approveMakeupRequest` sets `makeup_pending` for approved cancel-only requests and `completed` for existing makeup-bearing requests.

- [ ] **Step 1: Write failing workspace/service tests**

Assert the migration adds `request_kind`, makes cancel/makeup columns nullable, and allows `makeup_pending`. Assert service validation permits cancel-only without slots and makeup-only without cancel date.

- [ ] **Step 2: Run workspace tests to verify failure**

Run: `node --test tests/makeup-request-workspace.test.mjs`
Expected: FAIL on missing schema/service flow support.

- [ ] **Step 3: Implement migration and service branching**

Add `request_kind`, relax NOT NULL constraints for optional parts, update mapping/payload validation, approval branching, room validation, and event ids for variable draft counts.

- [ ] **Step 4: Run workspace tests to verify pass**

Run: `node --test tests/makeup-request-workspace.test.mjs`
Expected: PASS.

### Task 3: Workspace UI Flow Selector

**Files:**
- Modify: `src/features/makeup-requests/makeup-request-workspace.tsx`
- Test: `tests/makeup-request-workspace.test.mjs`

**Interfaces:**
- Consumes: `MakeupRequestInput.requestKind`.
- Produces: a compact mode control with labels `휴강+보강`, `휴강만`, `보강만`.

- [ ] **Step 1: Write failing UI tests**

Assert the form renders the mode labels, conditionally requires 휴강일/보강일시, and shows `보강대기` in active tracking.

- [ ] **Step 2: Implement UI**

Add the selector, conditionally render/validate `휴강일` and `보강일시`, keep room availability for makeup-bearing flows, and show `보강대기` in the list/detail labels.

- [ ] **Step 3: Verify**

Run focused tests, typecheck, lint, build, then browser-check the three form modes and the orphaned room selection.
