# Task 5d fix round 2 report

## Scope and outcome boundary

- Base/parent: `13a911d7e1128fa398d667d47bc801fcc9f6b6f4`.
- Changed only `src/features/textbooks/textbook-operations-workspace.tsx`, the directly affected mounted renderer test, and this report.
- No SQL/migration/API, read/context/reference service or type, formula, writer order/atomicity, hook framework, navigation codec, package/manifest/query budget, `.next`, browser/server/build, Docker/DB, network/remote, provider/send, push, or deploy work was performed.
- Reserved direct-page-11 and unresolved-auth assertions remain unchanged. Task 5c guarantees and the accepted direct-purchase and inventory partial-success behavior remain covered.
- Task 5d remains pending fresh independent final re-review.

## Remaining Important 1: live master and inventory ownership

Master bulk edit, status, and delete now share `createMasterBulkActionGuard`, which freezes the exact selected textbook IDs plus the current bulk patch. Edit also freezes the selected rows and a deep-enough patch snapshot for its writer payload. Once any writer has started, the unchanged writer sequence finishes, but a new selection or patch makes `runAction` suppress stale invalidation, success presentation, search/navigation changes, and selection/patch clearing.

Inventory selection ownership now uses a revision per textbook, not only the final global selection array. Every actual user membership change through the individual or visible-set selectors increments the affected textbook's revision, including deselect then reselect. Inventory action snapshots freeze each textbook's draft revision and selection revision. Pre-writer validation checks both, while partial acknowledgement removes a completed row only if both revisions still match. A B-only selection change therefore does not prevent safe acknowledgement of unchanged A, while a new A selection-only intent survives.

The existing sequential, non-atomic writer behavior is unchanged: no writer is cancelled, rolled back, reordered, retried automatically, or invoked twice after it starts.

## Remaining Important 2: live prepared-schema transition

The prepared schema state is published through `schemaDisabledRef` on every render. `runAction` reads the live value at entry and includes it in publication/invalidation gating. A schema transition after the first writer starts does not interrupt the writer sequence, but it suppresses obsolete UI completion and invalidation.

The same `assertLivePreparedSchemaReady` boundary is checked after complete save-time reads and immediately before the first writer for:

- direct purchase detail;
- purchase detail helpers used by single and bulk lifecycle paths;
- teacher balance and class-sale context;
- sale detail/balance helpers and the direct sale-status path;
- single and bulk inventory balances;
- inactive cleanup context and confirmation recheck;
- all-subject closing contexts.

The narrow prepared-schema classifier now also includes `PGRST205` for a missing prepared table. Ordinary transient errors remain outside the schema gate.

## TDD evidence

Before product edits:

- inventory selection-only ordinary RED: completed A was removed after A deselect/reselect and later B failure (`"7"` became `""`);
- live schema ordinary RED: a summary accepting `PGRST205` during a pending balance still allowed the first table writer;
- the first master attempt had a test-only selector error because the accessible row label contains more than the title. This was corrected without product edits, then the master ordinary RED showed stale invalidation RPC count `4 -> 8` after the first writer.

The initial combined RED log is `/private/tmp/task5d-fix2-red.log`, SHA-256 `899de02e8330c2d07da04408aa59293141eeed30b2f3c9e29c3ccf9718ed51c7`; the corrected master product RED is `/private/tmp/task5d-fix2-red-master.log`, SHA-256 `c035b49c8996e4ae96c795bf6f1ddb174ad48ab97c3a3cd6cb27b2eff88c19c1`.

After the minimal product correction, the three new mounted counterexamples passed `3/3`. Log `/private/tmp/task5d-fix2-green-initial.log`, SHA-256 `a06e2c7350f1d6fbfccad7ecc8149a05a5ce10caca4b90a65784d2016b849f59`.

Focused regressions before the final aggregate:

- renderer suite: `36/36` PASS;
- reference mounted suite: `27/27` PASS;
- reserved pagination suite: `11/11` PASS;
- workspace guards: `95/95` PASS.

## Final verification

Task 5d focused command at final fix2 source/test state:

```text
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --disable-warning=ExperimentalWarning --test tests/textbook-numbered-pagination.test.mjs tests/textbook-reference-ui.test.mjs tests/textbook-numbered-data.test.mjs tests/textbook-numbered-renderers.test.mjs tests/textbook-numbered-read-service.test.mjs tests/textbook-reference-read-service.test.mjs tests/textbook-work-context.test.mjs tests/textbook-ledger.test.mjs
```

Result: `432 tests; 431 pass; 1 fail`. The only failure is the explicitly preserved unrelated assertion `buildPurchaseSupplierHandoffGroups is imported` in `tests/textbook-work-context.test.mjs`. Log `/private/tmp/task5d-fix2-focused-final.log`, SHA-256 `c2f3373ee5fc28a0fbdd0577b03a897472b21d561d82018c715ecb57be851edf`.

Required full affected command at final fix2 source/test state:

```text
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --disable-warning=ExperimentalWarning --test tests/textbook-*.test.mjs tests/class-textbook-picker-model.test.mjs tests/class-schedule-planner-textbook-ranges.test.mjs tests/numbered-pagination.test.mjs tests/query-surface-budget.test.mjs tests/science-class-taxonomy.test.mjs tests/science-negative-workflow-guards.test.mjs tests/notification-science-provider-zero.test.mjs tests/registration-science-subject.test.mjs
```

Result: `766 tests; 765 pass; 1 fail`, solely the same known unrelated import assertion. Log `/private/tmp/task5d-fix2-full-affected.log`, SHA-256 `6e624a92d36fa198ec6e0dacf629afcbb177ece99e7e3500275aef86f3473085`.

- Nonincremental TypeScript: exit 0, no diagnostics. Empty log SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- ESLint over both changed TSX/MJS paths: exit 0, zero errors and zero warnings. Babel emitted only its informational >500 KB styling note. Log SHA-256 `f6c780bb47409995693d1a58cfc9e2e08ad1f71a015d72768975691db252ae82`.
- `git diff --check`: exit 0.
- Protected `.next/BUILD_ID`: `3553d308874a9a5457c0fa26af30abf82c1c9f6352413f9cfa87391b1105d323`.
- Protected `.next/build-manifest.json`: `aac272c3ac88e8389ab35ebb9e4c6aeb13292e2a9dce55864bb29963dd28ddcf`.

Owned source/test hashes at the final gate:

```text
809be0bba746b4bdcdd7ca64192086a517ce54c9b85e98d6c64db908860558e7  src/features/textbooks/textbook-operations-workspace.tsx
324e5c0bbcc832810a124cf5cfeeacd94eb60601eda3adcfd87f59ea2d9bf936  tests/textbook-numbered-renderers.test.mjs
```

## Retained Minor and remaining evidence

The old-scope-before-target-scope invalidation overfetch remains the accepted nonblocking Minor. This round adds no premature navigation, generic invalidation framework, or hook/service expansion. Browser, server/build, database/container, network/remote, provider/send, push, and deployment verification remain later evidence boundaries.
