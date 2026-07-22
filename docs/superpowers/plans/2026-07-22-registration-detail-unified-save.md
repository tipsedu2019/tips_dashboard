# Registration Detail Unified Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the saved registration application use one atomic inquiry save, remove repeated read-only summaries, and replace dated native controls with the dashboard's shared UI components.

**Architecture:** Lift common fields and subjects into one inquiry draft and send it through a new versioned Supabase RPC that validates the final grade/subject state before mutating anything. Keep existing split RPCs for compatibility, preserve reminder and removal guards, and simplify the detail renderer so only the active controls remain.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Tailwind CSS, Radix Select/Dialog/Collapsible, Node test runner, Supabase PostgreSQL 17.

## Global Constraints

- Scope is the saved registration application detail modal and its registration mutation only.
- Button copy is exactly `저장`; `과목 저장` and `공통 정보 저장` must not remain in the detail flow.
- Common fields and subjects save in one PostgreSQL transaction.
- The RPC compares both `expectedCommonRevision` and `expectedSubjects` before writes.
- Existing science subjects remain editable when capability is disabled; only newly added subjects require enabled capability.
- Existing subject-removal, identity-freeze, reminder rematerialization, and idempotency contracts remain authoritative.
- Do not run `supabase db push`; apply only the named SQL migrations and reconcile the returned remote version.
- Do not execute the registration delete RPC during this change.
- Do not trigger Google Chat, Web Push, SOLAPI, or registration provider sends.
- Preserve unrelated dirty-worktree changes; do not commit, push, deploy, or stage files without a separate user request.

---

### Task 1: Failing Contracts for the Unified Detail

**Files:**
- Modify: `tests/registration-track-workspace.test.mjs`
- Modify: `tests/registration-track-service.test.mjs`
- Modify: `tests/registration-track-fixtures.test.mjs`
- Modify: `tests/registration-browser-verifier-contract.test.mjs`

**Interfaces:**
- Produces: source contracts for `RegistrationInquiryDraft`, `saveRegistrationCaseInquiry`, one `저장` button, no duplicate summary functions, and no native selects in detail descendants.

- [x] **Step 1: Write the failing workspace tests**

Require the detail editor to render one inquiry editor, forbid `RegistrationSubjectSyncSection` and the three summary components in the detail render, forbid `RegistrationTrackSectionValues`, and assert the common action text is exactly `저장`.

- [x] **Step 2: Write the failing service and fixture tests**

Require `saveRegistrationCaseInquiry()` to call `save_registration_case_inquiry_v1` once with `p_expected_common_revision`, sorted `p_expected_subjects`, sorted `p_subjects`, and one request key. Add a fixture action that rejects stale common revision or expected subjects without mutating the detail.

- [x] **Step 3: Update the browser-verifier contract**

Replace separate `과목 저장` and `공통 정보 저장` actions with one `저장` action and require duplicate-summary absence checks.

- [x] **Step 4: Verify RED**

Run:

```bash
node --test --experimental-strip-types tests/registration-track-workspace.test.mjs tests/registration-track-service.test.mjs tests/registration-track-fixtures.test.mjs tests/registration-browser-verifier-contract.test.mjs
```

Expected: failures for the missing unified draft/service/RPC and the still-present old summary/save controls.

### Task 2: Atomic Inquiry RPC and SQL Tests

**Files:**
- Create: `supabase/migrations/<remote-version>_registration_case_inquiry_atomic_save.sql`
- Create: `supabase/tests/registration_case_inquiry_atomic_save_test.sql`
- Modify: `tests/registration-track-schema.test.mjs`
- Modify: `tests/registration-science-subject.test.mjs`

**Interfaces:**
- Produces: `dashboard_private.save_registration_case_inquiry_v1_impl(...) returns jsonb`.
- Produces: `public.save_registration_case_inquiry_v1(...) returns jsonb`, executable only by `authenticated`.
- Consumes: existing registration notification locks, reminder-aware common update behavior, subject removal rules, subject capability registry, and mutation receipts.

- [x] **Step 1: Add failing SQL source contracts**

Assert the new migration has an empty `search_path`, authenticated actor and admin access checks, exact expected-subject comparison, final grade/subject validation, explicit PUBLIC/anon revoke, authenticated grant, and no provider adapter calls.

- [x] **Step 2: Add transaction SQL fixtures**

Cover middle-school English to high-school English/science, high-school science to middle-school English, removal-block rollback, stale common revision, stale expected subjects, idempotent replay, mismatched-key reuse, disabled existing science common edit, disabled new science rejection, and reminder rematerialization.

- [x] **Step 3: Implement the private and public functions**

Acquire locks in the established global-registration-notification, task-workflow, task/detail/tracks order. Normalize and compare the expected subject set, validate the final pair, apply only newly added-subject capability checks, perform removal guards, run reminder-aware common mutation semantics, write subject events, recompute the parent once, and store one outer mutation receipt.

- [x] **Step 4: Verify SQL contracts GREEN**

Run:

```bash
node --test --experimental-strip-types tests/registration-track-schema.test.mjs tests/registration-science-subject.test.mjs
```

Expected: all SQL source and safety contracts pass.

### Task 3: Unified Client Service, Fixture, and Draft

**Files:**
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `src/features/tasks/registration-track-fixtures.ts`
- Modify: `src/features/tasks/registration-track-fixture-runtime.ts`
- Modify: `src/features/tasks/registration-application-track-actions.tsx`
- Modify: `src/features/tasks/registration-application-inquiry-section.tsx`
- Modify: `src/features/tasks/registration-track-editor.tsx`

**Interfaces:**
- Produces: `saveRegistrationCaseInquiry(input)` service method.
- Produces: `RegistrationInquiryDraft` containing common fields and `subjects: RegistrationSubject[]`.
- Consumes: `save_registration_case_inquiry_v1` and the existing committed-refresh/conflict helpers.

- [x] **Step 1: Implement one service call**

Map the unified input to one RPC call and normalize returned tracks. Keep `syncRegistrationCaseSubjects` and `updateRegistrationCaseCommon` exported for other existing paths.

- [x] **Step 2: Implement atomic fixture behavior**

Validate request-key reuse, common revision, expected subject set, final science grade, and removal guards before cloning and mutating fixture state. Increment common revision once and return tracks in academic order.

- [x] **Step 3: Lift the detail inquiry draft**

Move subject state into the common editor, calculate availability from `draft.schoolGrade`, use one canonical key containing revision and subjects, and include subjects in conflict comparison and dirty ownership.

- [x] **Step 4: Replace the two submit paths**

Remove the subject action slot and call `saveRegistrationCaseInquiry` once from the `저장` button with both expected values. Preserve committed-refresh recovery and focus the first invalid field.

- [x] **Step 5: Verify focused client tests GREEN**

Run the Task 1 test command. Expected: all focused client, fixture, and verifier contracts pass.

### Task 4: Remove Duplicate Detail Rendering

**Files:**
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `src/features/tasks/registration-application-track-actions.tsx`
- Modify: `src/features/tasks/registration-application-inquiry-section.tsx`
- Modify: `tests/registration-track-workspace.test.mjs`

**Interfaces:**
- Consumes: existing subject tabs, progress stepper, active track controls, and section state.
- Produces: one source of truth for each visible field and no empty locked frame.

- [x] **Step 1: Remove read-only summary renderers**

Delete `RegistrationTrackSectionValues`, `RegistrationLevelTestSummary`, `RegistrationConsultationSummary`, and `RegistrationPlacementSummary` plus their imports and call sites.

- [x] **Step 2: Remove repeated lock copy**

Stop rendering `sectionState.lockReason` inside every track frame; retain actual disabled fieldsets and accessible section state from the shell.

- [x] **Step 3: Suppress empty frames**

Render frames only when they contain an actionable editor or current operational content. Do not introduce replacement cards.

- [x] **Step 4: Verify workspace tests GREEN**

Run:

```bash
node --test --experimental-strip-types tests/registration-track-workspace.test.mjs
```

Expected: duplicate-summary and empty-frame assertions pass.

### Task 5: Shared Registration Controls

**Files:**
- Create: `src/features/tasks/registration-select.tsx`
- Modify: `src/features/tasks/registration-initial-plan-control.tsx`
- Modify: `src/features/tasks/registration-application-inquiry-fields.tsx`
- Modify: `src/features/tasks/registration-application-inquiry-section.tsx`
- Modify: `src/features/tasks/registration-application-track-actions.tsx`
- Modify: `src/features/tasks/registration-appointment-editor.tsx`
- Modify: `src/features/tasks/registration-enrollment-editor.tsx`
- Modify: `src/features/tasks/registration-application-shell.tsx`
- Modify: `src/features/tasks/registration-history-timeline.tsx`
- Modify: `tests/registration-track-workspace.test.mjs`

**Interfaces:**
- Produces: `RegistrationSelect({ value, placeholder, options, disabled, onValueChange, ...triggerProps })` with empty-string sentinel normalization.
- Consumes: shared `Select`, `Dialog`, `Alert`, and `Collapsible` components.

- [x] **Step 1: Add failing native-control contracts**

Assert the detail descendants contain no native `<select>`, `window.confirm`, or native `details/summary`, and require imports of the shared primitives.

- [x] **Step 2: Implement `RegistrationSelect`**

Wrap the shared Select primitives, render options through `SelectItem`, map external `""` to an internal sentinel, and preserve aria labels, disabled state, full-width trigger, and keyboard selection.

- [x] **Step 3: Convert all detail option controls**

Replace grade, school, director, class, waiting-kind, appointment, enrollment, cancellation, and admission selects without changing their domain values or disabled conditions.

- [x] **Step 4: Convert confirmation, warning, and collapsible controls**

Use controlled common Dialog confirmation for the three destructive transitions, shared Alert for warning boxes, and Collapsible for expandable alternate/history sections.

- [x] **Step 5: Verify shared-control contracts GREEN**

Run the Task 4 command. Expected: no forbidden native controls remain in the scoped detail descendants.

### Task 6: Local Verification and Browser QA

**Files:**
- Modify: `scripts/verify-ops-task-browser-workflow.mjs`
- Verify: all changed files

**Interfaces:**
- Consumes: the unified `저장` workflow and shared controls.
- Produces: deterministic desktop and narrow-viewport evidence without provider sends.

- [x] **Step 1: Run focused and full test gates**

Run focused registration tests, then the full Node suite, TypeScript, ESLint, `git diff --check`, notification provider-zero tests, and `next build --webpack`. Every command must exit zero.

- [x] **Step 2: Restart the local production server**

Serve the newly built app on port 3000 and verify `/admin/registration?flow=inquiry` returns HTTP 200.

- [x] **Step 3: Run exact-route browser QA**

Open the saved task and verify one `저장` button, no old save labels, no repeated responsible-person/status/time rows, no empty bordered frames, and shared option menus at desktop and narrow viewport widths. Change a safe draft value and revert it before saving unless DB mutation verification specifically requires the fixture route.

- [x] **Step 4: Verify provider zero**

Confirm no Google Chat, Web Push, SOLAPI, registration delivery, or dispatch call was created by QA.

### Task 7: Targeted Supabase Apply and Postflight

**Files:**
- Reconciled filename: `supabase/migrations/20260722142020_registration_science_director_and_case_delete.sql`
- Reconciled filename: `supabase/migrations/20260722142108_registration_case_inquiry_atomic_save.sql`
- Verify: Supabase migration history, ACLs, settings, and advisors

**Interfaces:**
- Consumes: exactly two reviewed SQL strings.
- Produces: science default director `김법균`, delete RPC definition, and atomic inquiry save RPC on the connected project.

- [x] **Step 1: Repeat read-only preflight**

Confirm project ref, migration history, one active eligible 김법균 profile, provider flags off, zero active target deliveries, and no conflicting function signatures.

- [x] **Step 2: Apply the pending science director/delete migration**

Use `apply_migration(name, query)` with the exact reviewed SQL. Immediately list migrations, record the generated version, rename the local file with `apply_patch`, and verify director setting plus RPC ACL. Do not invoke the delete RPC.

- [x] **Step 3: Apply the atomic save migration**

Use the same targeted process, reconcile the returned remote version locally, and verify function owner, empty search path, PUBLIC/anon revoke, authenticated grant, and function definition hash/shape.

- [x] **Step 4: Run postflight queries and advisors**

Verify 김법균 is the science default, execute rollback-only or read-only validation for the atomic function boundaries, compare Security and Performance Advisor results against the 95/321 baseline with zero new ERROR, and recheck provider-zero flags.

- [x] **Step 5: Final repository verification**

Rerun SQL contracts, full tests, TypeScript, ESLint, build, and `git diff --check`. Report local verification, remote migration state, DB values, provider-zero state, and untouched unrelated dirty changes separately.
