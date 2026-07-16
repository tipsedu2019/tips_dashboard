# Task 1 implementation report

Status: implementation complete; Release A remains blocked on the required real-browser reload/provider-zero proof and an authorized pgTAP runtime.

## Branch and commit boundary

- Worktree: `/Users/hyunjun/Documents/Codex/tips_dashboard/.worktrees/operational-safety-notification-completion`
- Branch: `codex/operational-safety-notification-completion`
- Implementation base: `c76ca3085008a35de554a0f3adcc27454011fd67`
- Task 1 commit: the commit containing this report, created with `fix: make registration intake save canonical`. Its final SHA is recorded in the parent handoff because a commit cannot embed its own hash.
- No push, deploy, production flag change, remote migration apply, remote account creation, or external provider delivery was performed.

## RED evidence

The requested five-file RED command was run before production changes:

```bash
"$NODE" --experimental-strip-types --test \
  tests/registration-intake-workflow.test.mjs \
  tests/registration-intake-runtime-probe.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-track-schema.test.mjs \
  tests/ops-task-workspace.test.mjs
```

Result: 128 tests, 120 passed, 8 failed as expected. The failures covered the obsolete phone/result scheduling surface, incorrect visit-field order, non-atomic ready save, incomplete retry identity, and obsolete workspace/source assertions.

## Implementation summary

- `registration-initial-plan-control.tsx` now renders per-subject next-action choices first, conditional per-subject owners, exactly two possible appointment datetime controls, and the locked owner/time/place/subject ordering. It exposes no phone datetime or scheduling-time result URL.
- `registration-intake-workflow.ts` implements the exact two-runtime persistence matrix, fail-closed indeterminate states, stale-field sanitization, normalization, and a single frozen fingerprint/request-key/inquiry-time/workflow attempt envelope.
- `registration-intake-runtime-probe.ts` preserves wrong numeric versions, accepts only exact version 1 as ready, maps only the exact missing-function case to version 0, and rejects malformed or unrelated errors as indeterminate.
- `registration-track-service.ts` independently rechecks subject-track ready v1 and intake ready v1 immediately before the atomic RPC. No business RPC runs after missing, wrong, malformed, rejected, or contradictory probe outcomes.
- `registration-track-fixture-runtime.ts` preserves exact fixture versions, including zero and wrong nonzero versions. The existing fixture reducer already modeled the required mixed direct-phone/visit receipt; tests now lock its exact canonical rows and replay behavior, so `registration-track-fixtures.ts` required no production change.
- `ops-task-workspace.tsx` removes legacy downstream registration fields, uses only the atomic initial-workflow writer in ready mode, limits confirmed fallbacks to inquiry-safe payloads, closes canonical common-edit identity/reload behavior, retains the business attempt only for ambiguous pre-commit retries, and separates post-commit notification failures from business-create replay. Accepted notifications with audit warnings now use neutral audit language rather than claiming the notification was not sent.
- `20260716100000_registration_intake_runtime_guard.sql` replaces only the public wrapper, retains its signature/grants, checks both markers for exact version 1, then delegates to the private implementation. It was generated with `pnpm dlx supabase@2.109.1 migration new registration_intake_runtime_guard` and renamed to the reserved timestamp before any apply.
- `registration_intake_workflow_runtime_test.sql` covers independently wrong, missing, and unauthorized subject/intake markers and asserts zero created rows.
- The browser verifier and source tests were updated for the deterministic mixed English direct-phone/Mathematics visit route, both required viewports, absence of obsolete fields, field order, runtime matrix, retry envelope, canonical edit boundary, and notification non-replay contracts.

## GREEN evidence

Focused Task 1 command from Step 7:

```bash
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
```

Result: 341 tests, 341 passed, 0 failed.

Mandatory local gate:

- Full Node suite: 1022 tests, 1022 passed, 0 failed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm run lint`: passed with 0 errors and 0 warnings.
- `pnpm run build`: passed; 72 static pages generated and the registration/API routes compiled.
- `git diff --check`: passed.
- Static migration/schema contracts were included in the passing Node suites.

## Browser and database runtime evidence

- Deterministic route: `http://127.0.0.1:3001/admin/registration?fixture=registration-subject-tracks&fixtureRole=english_admin`
- The worktree server answered the exact route with HTTP 200. The verifier source fixes desktop at 1349x987 and mobile at 390x844.
- Attempted command:

```bash
OPS_BROWSER_WORKFLOW=1 \
OPS_BROWSER_BASE_URL=http://127.0.0.1:3001 \
OPS_BROWSER_ROUTE_FILTER=registration-subject-track-fixture \
OPS_BROWSER_SUPABASE_STORAGE=0 \
node scripts/verify-ops-task-browser-workflow.mjs
```

- The harness stopped before browser interaction because no `OPS_BROWSER_STORAGE_STATE`, temporary-user authorization, or login credentials were available. A direct local import also reports that the Playwright package is unavailable. No remote temp user or dependency was created.
- The current verifier statically checks the required create dialog and field ordering, but it does not yet perform the required save, reopen, canonical-row duplicate check, same-request-key receipt replay, or canonical editor mutation/reload sequence. Therefore the exact-route browser gate and provider-zero browser/server ledgers are not proven.
- The pgTAP file was authored but not executed because no authorized local/preview PostgreSQL runtime was available. No remote database was used as a substitute and the migration was not applied.

## Self-review and remaining concerns

- Fixed during review: unrelated SQLSTATE 42883 errors can no longer masquerade as a missing intake marker; generated `inquiryAt` is part of the frozen attempt; default owners are not falsely persisted as manual overrides; canonical identity and post-edit track reload fail closed; hidden registration defaults no longer mutate silently; accepted delivery plus audit-warning responses cannot prompt a duplicate resend.
- Release A is not independently releasable until a credentialed browser run proves save/reload/replay/canonical-editor persistence at both viewports and produces empty provider ledgers.
- The six pgTAP fault cases must run against an explicitly authorized local or preview database before release. Keep the forward migration unapplied until that gate is available.
