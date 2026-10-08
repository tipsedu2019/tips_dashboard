# Chat thread replies: preparation evidence

Base: `3ad5a6f032dba817cca35afb8b5142b7331d3f23`. PR121/122/123 are retained. No deployment, production SQL mutation, credential/grant creation, runtime configuration change or provider send was performed for this extension. The [activation packet](../../operations/chat-thread-replies.md) records the remaining room/secret/approval boundaries.

## Verification

- Isolated Linux/PostgreSQL: eight related AI/Chat suites, **666 assertions PASS**. The new thread-reply suite was then strengthened with four rotated-key immutable-identity cases and separately passed **54 assertions**. Existing unrelated 94-suite historical verification was not repeated or relabeled as a new full parity run.
- Real concurrent PostgreSQL sessions: **five cases PASS**, each observing an actual lock wait. Same client across rotated keys creates one outbox; changing its event conflicts `23514`; competing new clients on one unresolved event stop `55000`; late incident before the next permit stops `55000`; permit-first ordering completes without deadlock and records the later incident. A committed permit cannot be recalled by subsequent evidence.
- Exact migration `2b618a4944c4e5bdf573b1335cd146a4eb989fff451ca585f4e55a8c348682c1`: run against the original main prefix (161 forward migrations). Nonempty outbox returns `55000` before DDL and preserves the row, columns, constraints, indexes and both function definitions. Conflicting reader lock produces an observed wait and `55P03` without catalog changes. Empty-prefix installation succeeds with the new column/three indexes and zero outbox rows. Synthetic fixture reset was confined to the disposable DB; it is not an operational recovery instruction.
- Linux Node 22.18.0: **52 API/UI/receipt tests**, **28 affected workflow/layout tests** and **10 design tests PASS**; no skipped cases within those selected runs. An additional new-pin negative test verifies SQL-only drift, combined SQL/manifest drift and missing-file rejection. TypeScript, affected ESLint, migration layout, domain SQLSTATE and generated probe checks pass.
- Squawk 2.63.0: **0 findings**. Four statement-local exceptions apply only to the migration's CHECK/three indexes, justified by the exclusive empty-table guard; no global rule or protected migration exception was changed.
- Production Next 16.1.1 webpack build: **PASS** in network-none Linux, with synthetic env only. Cached dependencies match current lockfile SHA256 `3c1fd6064088693750380b876e0b0fdb86686087fd4cabb3fd62f13947a6b2de`.
- Actual Chrome: **1440/390 × light/dark PASS**. Uses the real settings route/component, synthetic loopback transport, external request/WebSocket blocking, and fake fixture keys only. No provider calls. Verifies support OFF, explicit two-room grant, five unavailable rooms disabled, zero request scopes, bridge_reply only, default one-day expiration, Escape/focus restoration, and immutable worker-recovery permission display after remount.
- Independent review: initial lock ordering, recovery display and migration pin findings were corrected. No remaining P1/P2 in the final feature/security/documentation review. Final commit/tree identity is recorded in the draft PR and local handoff.

The SQL semantic/race runs used the same final RPC bodies before the final empty-install guard was added. The separate prefix installation test verifies the final complete DDL bytes. These are scoped evidence sets, not a claim that the entire canonical 95 SQL/20 probe/producer-consumer pipeline ran in a single new execution. The original 94 SQL/19 probe registrations are retained and exactly one new SQL suite/probe is appended; exact inventories, workflow hashes and immutable migration pins were updated without changing triggers, permissions, secret boundaries or assertions.

Initial setup failures are retained in the local evidence directory: missing Docker mount target/compiler, missing worktree Git mount, generated Next file read-only, synthetic profile duplicate/immutable fixture cleanup, and pre-fix UI rapid-selection loss. Successful results above refer to the corrected runs. No failure was counted as a pass.

## Screens and reproduction

Reference is the existing AI key read-default dialog and shared settings primary button under matching synthetic data, width and theme. Shared FormDialogContent, NativeSelect, Checkbox and settings table remain in use. No global tokens or component styling changed. All four cases have zero page overflow, browser errors and attempted external requests.

| Reference | Changed state |
| --- | --- |
| [390 light read-default](reference-read-default-390-light.png) | [390 light Chat-only](chat-only-two-rooms-390-light.png) |
| [1440 dark read-default](reference-read-default-1440-dark.png) | [1440 dark Chat-only](chat-only-two-rooms-1440-dark.png) |

[390 dark worker recovery](immutable-worker-recovery-390-dark.png) displays the original request-processing scope instead of editable Chat-only controls. Recovery reuses the original UUID/payload and never reconstructs the raw key.

Run `scripts/qa/ai-agent-requests-fixture-server.mjs` and a synthetic Next server on ports 3300/3301/3302 as described in that fixture. Then run `scripts/qa/chat-thread-replies-browser.mjs`. Optional `PLAYWRIGHT_PACKAGE`, `PLAYWRIGHT_EXECUTABLE_PATH`, `AI_AGENT_BASE_URL`, and `AI_CHAT_REPLIES_QA_OUT` select installed local tooling/output. No real env file is required. The original credential browser harness was adjusted for the read-only pending-recovery view.

Full private local evidence (synthetic only) is under `evidence/chat-replies-20261008` in the delegated workspace: `sql-run1`, `sql-run3`, `sql-run4`, `install-boundary-r2`, `results.json`, `unit-final.log`, `layout-focused.log`, `design.log`, `new-pin-negative.log`, `squawk.log`, `build-r2.log`, and `browser/screenshots/results.json`.
