# Task 5d fix-round report

## Scope and boundary

- Base/parent: `c1fb9067b1fc12f9f813f60a2b09cc3aa32d977d`.
- Changed only the Task 5d workspace and directly affected mounted/static tests, plus this report. No read/context/reference service or type, SQL/migration/API, formula/writer-order/atomicity, navigation codec, hook framework, package/manifest/query budget, `.next`, browser/server/build, Docker/DB, network/remote, provider/send, push, or deploy work was performed.
- The reserved first two assertions in `tests/textbook-numbered-pagination.test.mjs` remain literal and strong: direct page 11 issues exactly one page-11/page-size-10 master RPC and zero legacy table reads; unresolved auth issues zero requests.
- Task 5c accepted-input, actor, navigation, and static TeacherSelect guarantees were preserved.

## Review findings and corrections

### 1. Off-page direct purchase save

The accepted direct detail now retains its anchor, mode, ordered member IDs, and per-scope line IDs independently of numbered page maps. Save freezes that identity, calls `getTextbookPurchaseDetail` directly, requires the fresh ordered member identity to match, and builds lifecycle payload IDs/orders/references only from that fresh detail. A direct identity change before the read resolves yields zero writers; the same identity predicate suppresses obsolete post-writer publication and invalidation.

Mounted coverage submits a hydrated record absent from both numbered pages, observes the exact fresh direct RPC and zero early writers, proves the fresh order ID owns the writer, then proves clearing the direct URL identity while the read is pending starts no writer or stale success.

### 2. Complete action-input lifetime

The live action watermark now includes purchase direct/member identity, class-sale exclusions, bulk-order selection plus quantities, purchase/sale selections, and inventory selected IDs plus per-key quantity, memo, and revision. Each affected action freezes its full payload owner, checks it after all context reads and immediately before the first writer, and passes the same predicate to `runAction`. A pre-writer mismatch starts zero writers. A post-writer mismatch lets the unchanged non-atomic writer sequence finish but suppresses stale toast, clearing, navigation/filter changes, and invalidation.

Mounted counterexamples cover class-sale exclusion changes, single inventory memo changes, bulk inventory revision/selection changes, bulk-order quantity changes, and post-first-writer purchase/sale selection changes.

### 3. Inventory partial-success acknowledgement

Bulk inventory records a row as completed only after the row's entire existing `createStockCountAdjustment` promise resolves. Whether the later action succeeds or fails, only completed snapshots whose revision remains unchanged have their quantity, memo, and selection acknowledged. Failed, unstarted, newer, off-page, and other-location drafts remain. A retry therefore requests balance and writes only retained work. A separate mounted case proves an edit made to A after A's writer starts survives when B later fails.

This deliberately retains the existing non-atomic sequential writer contract: there is no rollback, automatic retry, writer reorder, or duplicate invocation of an already-started writer.

### 4. Prepared schema/error boundary

`schemaDisabled = false` is gone. A narrow missing-schema predicate recognizes the read layer's `textbook_read_rpc_unavailable` plus missing prepared RPC/table/column codes only, including nested causes. The gate is fed by the active numbered page/summary/operations owner and active required form reference owners. Numbered owners render one destructive, retryable API-unavailable alert; existing reference-owner alerts remain their visible retry owner without a duplicate global alert. Relevant submits and the central writer boundary remain closed while the gate is present.

The mounted schema case keeps an inventory row otherwise actionable, rejects its real prepared inventory-summary owner with `PGRST202`, proves a disabled `실사 반영 불가` control and visible retry, observes a second exact summary request, and observes zero balance or table writers.

### Retained Minor

The review's old-scope-before-target-scope invalidation finding remains visible and intentionally unfixed. Correcting it safely would require coordinating target navigation/filter ownership with invalidation timing across several actions. This round does not introduce premature local navigation, `flushSync`, a generic invalidation dispatcher, or hook/service expansion. The new lifetime predicates do narrowly suppress invalidation only when the action owner has actually become obsolete.

## TDD evidence

Before product edits, the new mounted cases produced eight ordinary product REDs:

- reference cases: `0/2` passed — pending class exclusion still wrote, and the off-page direct save did not issue the required second detail read;
- renderer cases: `0/4` passed — pending bulk inventory change still wrote, partial success retained A, the prepared schema gate was absent, and a pending single inventory edit still wrote;
- pagination cases: `0/2` passed — pending bulk-order quantity still wrote, and post-writer sale selection still dispatched stale completion work.

One bulk-order fixture initially returned an `order` detail to a `request`-mode RPC. That harness error was corrected before recording its ordinary product RED; it is not counted as product evidence.

After the minimal product corrections, all original eight counterexamples passed, and the additional newer-A inventory case passed: `9/9` mounted lifecycle cases GREEN. The final schema test uses the required real inventory-summary owner rather than a self-fulfilling static assertion.

During the first broad gate, three now-stale source-text guards failed because their exact old spellings excluded the new schema/acknowledgement paths. They were updated to assert the preserved semantics directly: request-stage zero quantity remains allowed, only acknowledged completed inventory rows are removed, and master submit includes the real schema gate. No assertion was weakened to omit the behavior.

The broad gate also exposed a pre-existing timing race in the mounted teacher-sale test: the previous test opened the book popover before Radix had restored focus after closing the teacher popover, so the late close-focus could close the new popover. Instrumentation showed the book combobox enabled but collapsed, no options, and focus restored to the teacher trigger. Replacing the guessed single-rAF delay with a condition wait for that exact focus restoration made the isolated counterexample pass `5/5`; product source was not changed for this harness issue.

## Final verification

Focused command from the brief at final source/test state:

```text
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --disable-warning=ExperimentalWarning --test tests/textbook-numbered-pagination.test.mjs tests/textbook-reference-ui.test.mjs tests/textbook-numbered-data.test.mjs tests/textbook-numbered-renderers.test.mjs tests/textbook-numbered-read-service.test.mjs tests/textbook-reference-read-service.test.mjs tests/textbook-work-context.test.mjs tests/textbook-ledger.test.mjs
```

Result: `429 tests; 428 pass; 1 fail`. The only failure is the explicitly preserved unrelated assertion `buildPurchaseSupplierHandoffGroups is imported` in `tests/textbook-work-context.test.mjs`. Log `/private/tmp/task5d-fix-focused-final-v2.log`, SHA-256 `9343f9fef82e260f4594a4c8f23a19ce63af4369be8bf5db43beba4d0043899e`.

Required full affected command at final source/test state:

```text
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --disable-warning=ExperimentalWarning --test tests/textbook-*.test.mjs tests/class-textbook-picker-model.test.mjs tests/class-schedule-planner-textbook-ranges.test.mjs tests/numbered-pagination.test.mjs tests/query-surface-budget.test.mjs tests/science-class-taxonomy.test.mjs tests/science-negative-workflow-guards.test.mjs tests/notification-science-provider-zero.test.mjs tests/registration-science-subject.test.mjs
```

Result: `763 tests; 762 pass; 1 fail`, solely the same known unrelated import assertion. Log `/private/tmp/task5d-fix-full-affected-v2.log`, SHA-256 `9b960f651ca1aaddd17b6fbd05d46af1367423adbfbde53d9213095e6c612773`.

- Nonincremental TypeScript (`tsc --noEmit --incremental false --pretty false`): exit 0, no diagnostics. Empty log SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- ESLint over every changed TS/TSX/MJS path: exit 0, zero errors and zero warnings. The only output was Babel's informational styling note for the existing >500 KB workspace. Log SHA-256 `f6c780bb47409995693d1a58cfc9e2e08ad1f71a015d72768975691db252ae82`.
- `git diff --check`: exit 0.
- Protected `.next/BUILD_ID`: `3553d308874a9a5457c0fa26af30abf82c1c9f6352413f9cfa87391b1105d323`.
- Protected `.next/build-manifest.json`: `aac272c3ac88e8389ab35ebb9e4c6aeb13292e2a9dce55864bb29963dd28ddcf`.

Owned source/test hashes at the final gate:

```text
d054e8633c129f432f688e0d48ca52af5874558e15b7dcfd262aa61abd95a799  src/features/textbooks/textbook-operations-workspace.tsx
527be1303451aa891dce077f071bf990a31701ceb0dce05f9fda694bd2ea1314  tests/textbook-numbered-pagination.test.mjs
57693e4183a1a55bb910106e92ce8df382c781bbadb249efcdbb70bfb9159f69  tests/textbook-numbered-renderers.test.mjs
3216eba77709eb04235bfece7c637bc8e42e376c1b722cacd0332776d72f8a34  tests/textbook-reference-ui.test.mjs
9bd0c10c291c965a67a0dc965c6c05f857407b1d14e72fcc9214aaf8e2772f9b  tests/textbook-workspace.test.mjs
```

Browser, server/build, database/container, network/remote, provider/send, push, and deployment verification remain explicit later evidence boundaries. Task 5d remains pending fresh independent re-review.
