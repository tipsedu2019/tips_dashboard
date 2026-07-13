# Registration Operational Hardening Plan

> Scope: only the `/admin/registration` workflow. Preserve the single moving registration case and the existing stage vocabulary.

## Acceptance target

An operator can create, search, advance, pause, reopen a canceled outcome, complete, and delete an eligible registration case without hidden state, partial writes, wrong-student linkage, accidental form loss, or stage-irrelevant table noise. A completed enrollment is immutable until a dedicated compensating correction flow can reverse its student, class, textbook, and history projections together. Admin and regular staff behavior must agree. Desktop and mobile must expose the next action clearly.

## Implementation and verification snapshot (2026-07-11)

- The annotated add-modal feedback is implemented: icon-only close, explicit required/optional inquiry fields, actionable validation, early level-test/consultation entry, removal of the existing-student picker, and canonical `영어, 수학` inquiry storage.
- Registration persistence now validates exact student identity, stages terminal parent writes last for staff RLS, checks affected rows, restores student/class/textbook snapshots, records compensating enrollment history, and rejects unsafe completed or ambiguous waitlist deletion.
- Held and terminal states, canceled-outcome reopen, compact per-tab tables, mobile actual-history sections, digit-normalized phone search, keyboard listboxes/resizers, dirty-close confirmation, load retry, and focus restoration are covered.
- Focused registration tests: 136 passed. Repository tests excluding two unchanged non-registration baseline source-contract failures: 576 passed. ESLint, TypeScript, browser-verifier syntax, diff checks, and the production build pass.
- A real browser fixture was saved through inquiry, level test, consultation, inquiry-only close, reopen, and eligible deletion. A final read-only Supabase audit found zero temporary tasks, details, or students; no orphan details, status/pipeline mismatches, completion projection issues, or chronology issues.
- No migration or production deployment was performed in this lane.

## Task 1: Lock down critical persistence behavior with failing tests

Files:
- `tests/registration-workflow.test.mjs`
- `tests/ops-task-workspace.test.mjs`
- `src/features/tasks/registration-workflow.js`
- `src/features/tasks/ops-task-service.ts`

Steps:
1. Add identity-match tests for same-name students with matching and conflicting phone/school data.
2. Add service-order/source contract tests for terminal registration transitions under staff RLS.
3. Make registration resolution reject a persisted or name-matched student whose identity conflicts.
4. Persist registration detail and management links while the parent task is still open, then persist the terminal parent status last; make rollback order RLS-safe.
5. Run the focused Node tests.

## Task 2: Make stage state explicit and internally consistent

Files:
- `tests/registration-workflow.test.mjs`
- `tests/ops-task-workspace.test.mjs`
- `src/features/tasks/registration-workflow.js`
- `src/features/tasks/ops-task-workspace.tsx`

Steps:
1. Add cumulative validation tests for reservation/completion chronology and required upstream values.
2. Add tests that canceled registration stages expose exactly one dedicated reopen action, completed enrollment remains immutable, and waitlist stages do not expose the generic reopen action.
3. Render `보류` as a visible operating state, block stage mutation while held, and expose one clear `다시 진행` action.
4. Apply cumulative blockers before transition writes and focus the relevant field on failure.
5. Run the focused tests.

## Task 3: Remove hidden table state and expose the current work

Files:
- `tests/registration-workflow.test.mjs`
- `tests/ops-task-workspace.test.mjs`
- `src/features/tasks/registration-workflow.js`
- `src/features/tasks/ops-task-workspace.tsx`

Steps:
1. Define compact columns per registration top tab and keep the action column visible.
2. Reset or validate local filters on tab change so the displayed `전체` value always matches the applied filter.
3. Replace per-cell duplicate detail buttons with one keyboard entry point per row; keep resize handles out of the tab order unless they support keyboard resizing.
4. Provide mobile multi-field search for student, phones, school, class, and request text.
5. Add a registration refresh/retry control and disable creation while initial data is unavailable.
6. Run focused tests, then verify the table at desktop and mobile widths.

## Task 4: Protect unsaved input and keyboard context

Files:
- `tests/ops-task-workspace.test.mjs`
- `src/features/tasks/ops-task-workspace.tsx`

Steps:
1. Replace the silent two-click X behavior with an explicit discard confirmation dialog in the current viewport.
2. Remove pre-dialog blur calls and verify focus returns to create/detail/edit triggers.
3. Preserve the requested icon-only top-right close affordance.
4. Add render/browser coverage for dirty close, cancel, discard, Escape, and focus return.

## Task 5: Make roster completion atomic and recoverable

Files:
- a new Supabase migration created with the repository CLI
- `src/features/tasks/ops-task-service.ts`
- focused database/integration tests when the local database runtime is available

Steps:
1. Introduce one authenticated, least-privilege database operation that locks the student, class, and textbook rows and updates both sides in one transaction.
2. Validate `auth.uid()` and the dashboard role inside the operation; revoke default/public execution and grant only authenticated callers.
3. Restore student, class roster, class textbook links, and completion bookkeeping together on failure.
4. Return explicit affected-row results and reject zero-row writes.
5. Add idempotency for a repeated completion request.
6. Run migration lint/advisors and role-specific RLS tests on a non-production branch or local database.

## Task 6: Full operational simulation and cleanup proof

Steps:
1. Run focused tests, lint, and production build.
2. Simulate inquiry-only, level-test, consultation-only, waitlist, next-opening, enrollment, hold/resume, terminal/reopen, validation-error, and dual-subject cases in the real browser.
3. Use unique fixtures only; disable outbound SOLAPI and Google Chat side effects.
4. Exercise desktop keyboard and 390px mobile paths, including filter switching, dirty close, retry, horizontal layout, and focus return.
5. Delete all temporary records and assert zero residual task/detail/message/event/student/class/textbook fixture rows.
6. Request a final independent code review and resolve every blocking finding before completion.

## Deferred product decision

One registration currently has one class and one textbook enrollment representation. A true English-and-math dual enrollment needs an explicit data-model decision (one case with multiple enrollment children vs. one linked child case per subject). Preserve both inquiry subjects now, but do not silently invent two enrollment records without that decision.

Completed enrollment correction is also intentionally deferred from generic status changes. Reopening or deleting pipeline `7` must remain blocked until one compensating database operation can reverse the roster, textbook, detail flags, and enrollment history atomically.

The client now compensates failed multi-table writes and verifies the restored snapshots, but process termination and true concurrent writes still require the transactional RPC in Task 5. That migration must be built and exercised on a non-production branch before production application; it is not safe to improvise directly against the live project.
