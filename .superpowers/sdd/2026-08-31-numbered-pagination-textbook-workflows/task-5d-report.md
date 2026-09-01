# Task5d implementation report — 2026-09-01

## State and scope

- Status: implementation and local source verification complete, ready for fresh independent review. This does not claim the Task5 umbrella is accepted or production-ready.
- Base: `2ccb9ad9` on `codex/loading-performance`.
- Removed the workspace-owned 17-table startup loader and post-write whole-bundle refresh. Startup, ordinary refresh, and targeted invalidation now use only prepared numbered/reference/detail resources.
- Changed only the bounded workspace, the approved non-UUID service fallback, the mounted harness/adopted fixture, directly affected textbook tests, and this report. No numbered/reference/work-context service or type, SQL/migration/manifest, writer formula/atomicity, navigation codec, package/query-budget, `.next`, browser/server/build, DB/container, network/remote, provider/send, push, or deploy action was changed or run.

## TDD evidence

The reserved fixture was staged before extension with its exact original SHA-256:

```text
72a3da979a7da3c4428f76f65e03ed140a2e275c25918dcb5e4c93481ad303fd
```

Its unchanged two-test run produced the required genuine RED: `2 tests; 1 pass; 1 fail`. The unresolved-auth case passed with zero requests. The direct master page-11 case observed the expected single page RPC but failed because ordinary startup additionally requested all 17 legacy tables: `textbooks`, `textbook_publishers`, `textbook_suppliers`, `textbook_publisher_supplier_links`, `textbook_sub_subject_settings`, `textbook_inventory_locations`, `textbook_purchase_orders`, `textbook_purchase_order_lines`, `textbook_stock_moves`, `textbook_sales`, `textbook_sale_lines`, `textbook_stock_counts`, `textbook_monthly_closings`, `students`, `classes`, and `teacher_catalogs`.

Mounted extensions then produced ordinary source REDs before the corresponding implementation:

- Purchase deletion expected one fresh `get_textbook_purchase_detail_v1` call and observed zero.
- Full-filter purchase and billing handoff counterexamples both failed because the dialog exposed only the two visible rows rather than the complete 12-line source count.
- Action lifetime cases showed an old purchase detail could reach confirmation/writer state and an already-started former-actor action could publish stale completion/invalidation.
- Cleanup, all-subject closing, and sale-status tests initially observed their writers before the required complete purpose/detail/balance reads.
- Inventory mounted cases observed page-row quantities rather than fresh balances and lacked per-key quantity/memo revision protection and complete multi-location reads before the first writer.

Three test-boundary defects were kept separate from product RED: the cleanup fixture initially had the wrong page cardinality, the sale-status assertion assumed the line update preceded the unchanged stock-move lookup, and an inventory expectation counted a targeted refresh at the wrong point. Each was corrected against the actual accepted service/writer contract without weakening the zero-writer, exact-ID, or authoritative-balance assertions.

The first post-self-review focused aggregate exposed one real transient regression: strict local rejection of the accepted `missingStudentIds` contract prevented the class writer. The fix passes only the server-validated `context.students` plus the original class `student_ids` to the unchanged ledger; it does not filter or fabricate missing legacy IDs. The exact counterexample then passed `1/1`, and the final full gate includes the corrected path.

## Implementation and context map

- **Master save/bulk** uses only exact accepted `masterOptions.scienceSubjectAreas`. Master actions invalidate master page/summary, operations summary, and master options only.
- **Inactive cleanup** reads `getTextbookInactiveCleanupContext`, previews at most five server rows, freezes the complete target ID sequence, re-reads and compares the full sequence at confirmation, and only then calls the unchanged purge writer.
- **Purchase form/order/receive/move/delete/return** reads `getTextbookPurchaseDetail` for every actual anchor/member before confirmation or the first writer. Fresh detail references own book/class/supplier/pricing completion. Selection/input and actor lifetime are checked before write; delete/return recheck the actual members at confirmation. Purchase invalidation is limited to request/purchase pages and summaries, operations summary, and purchase detail.
- **Purchase and billing documents** use `getTextbookPurchaseHandoff`/`getTextbookBillingHandoff` over frozen accepted filters. The dialogs report the complete `sourceLineCount` independently of visible page rows or grouped output.
- **Class sale** re-reads `getClassTextbookSaleContext` with exact class/book/month/location immediately before save. The minimal legacy-shaped boundary contains its original class roster, server-returned student records (including school), selected book/location, duplicate state, and authoritative balance. Missing legacy IDs remain in the class roster and are not locally invented or silently removed.
- **Teacher sale** keeps manual teacher-name precedence and no invented teacher ID, while using the exact accepted book/location plus a fresh `getTextbookInventoryBalance` before the writer.
- **Sale status/delete/bulk** reads `getTextbookSaleDetail` for every actual member. Status/return paths additionally batch fresh balances by actual location and textbook before the first writer. Cancellation/history confirmation and writer recheck use the actual detail members. Sales invalidation is limited to sales page/history, their summaries, operations summary, and sale detail.
- **Inventory count** freezes only selected displayed rows, batches every selected book by actual location, completes and validates all balances before any writer, and passes each authoritative `currentQuantity` as `expectedQuantity`. Quantity and memo share a per-book/location revision; unchanged successful rows clear, while newer edits, off-page drafts, other locations, and new selection survive old completions. Inventory invalidation is limited to inventory page/summary/history and operations summary.
- **Closing** reads all original targets (`all`, `english`, `math`, `science`) via `getTextbookClosingSaveContext(month, subject)` before the first writer, then retains the original ordered sequential writer calls. Closing invalidation is limited to closing page, operations summary, and preview.
- **Lifecycle** keys the owner by actor ID and role, snapshots relevant form/selection inputs before context reads, and suppresses stale confirmation, error, success, form clearing, and targeted invalidation dispatch after actor/input mismatch or unmount. Once a writer starts it is neither retried nor described as cancelled. A sequence token prevents an old completion from clearing a newer action's busy state.
- **Approved fallback** retains the UUID fast path in `resolvePurchaseLifecycleTextbook`; only non-UUID references now use the existing `resolveTextbookReference({ activeOnly: false, scope: "request", fallbackSupplier: "" })` path instead of scanning `textbooks`.

The retained multi-member purchase, sale, inventory, cleanup, bulk master, and four-subject closing writers are still intentionally non-atomic. A later writer failure can leave prior writes committed; this task does not add retries, rollback, or atomic APIs.

## Verification

Focused mounted workspace/reference/renderer milestone:

```text
tests/textbook-numbered-pagination.test.mjs
tests/textbook-reference-ui.test.mjs
tests/textbook-numbered-renderers.test.mjs
65/65 PASS

tests/textbook-workspace.test.mjs
95/95 PASS
```

Final focused command from the brief:

```text
423 tests; 422 pass; 1 fail
```

The only failure is the explicitly preserved, pre-existing out-of-scope source-text assertion `buildPurchaseSupplierHandoffGroups is imported` in `tests/textbook-work-context.test.mjs`. Log: `/private/tmp/task5d-focused-final.log`, SHA-256 `af545c2c0b86a2e3e6ed9f0e4201f003ba8ffb2f7bb9d282d920b1ff76c76a04`.

The required full affected command was run exactly once at final source state:

```text
757 tests; 756 pass; 1 fail
```

Its sole failure is the same known unrelated import assertion. No other failure occurred. Log: `/private/tmp/task5d-full-affected.log`, SHA-256 `32c6f50da7c9b47a2abd45b9ec9cf82f08600afff45369d944fc406762682cad`.

- Nonincremental TypeScript (`tsc --noEmit --incremental false --pretty false`): exit 0, no diagnostics.
- ESLint over every changed TS/TSX/MJS path: exit 0, zero errors and zero warnings. Babel emitted only its informational >500 KB styling note for the existing workspace file.
- `git diff --check`: exit 0.
- Workspace source audit: no `data.*`, `useTextbookOperationsData`, `TextbookOperationsData`, `emptyData`, `listTextbookOperationsData`, or workspace `.from(...)` usage remains.
- Protected `.next/BUILD_ID`: `3553d308874a9a5457c0fa26af30abf82c1c9f6352413f9cfa87391b1105d323`.
- Protected `.next/build-manifest.json`: `aac272c3ac88e8389ab35ebb9e4c6aeb13292e2a9dce55864bb29963dd28ddcf`.
- The staged original adopted fixture still hashes to `72a3da979a7da3c4428f76f65e03ed140a2e275c25918dcb5e4c93481ad303fd`; its final extended hash is `7327e21f20e9c0336727fee0e561e84f2af23e69c4f903bc2f4616da0804ba42`.

Owned source/test hashes at the final gate:

```text
1855ba47d0e40c8da6e9cf810c35de2c37ecc156c92dccbb16398acc5fe976be  src/features/textbooks/textbook-operations-workspace.tsx
ff8ad60e3675fee9d901b7f0e4d89fa2acb01eabf0e47115fef276220e865176  src/features/textbooks/textbook-service.ts
65f91fd8855f6687c815aab7ead8b0c87d20da6615ed34ce76fe64e406cec63f  tests/helpers/textbook-numbered-harness.mjs
7327e21f20e9c0336727fee0e561e84f2af23e69c4f903bc2f4616da0804ba42  tests/textbook-numbered-pagination.test.mjs
56d0986fb099620ccaa76471da99c6e1501a5c64ac95b0279db9bcf9d99e8c37  tests/textbook-numbered-renderers.test.mjs
b27a1bf09f9a72de13c04330df9307fab5389fe316b53f26bb3bf9d379fb2fcd  tests/textbook-reference-ui.test.mjs
420db121c64d4e528a0e8811d313a04b048c8b2a7299757a11f38e09e3a95e57  tests/textbook-workspace.test.mjs
```

## Self-review and remaining boundaries

Every source and test hunk was reviewed against the complete Task5d brief. The final review rechecked all 17 removed legacy sources, exact actor/role and form/selection lifetimes, all-read-before-first-writer order, full off-page IDs, missing-student preservation without fabrication, manual teacher precedence, authoritative expected quantities, per-key quantity/memo revisions, targeted invalidation only, full-filter document counts, complete cleanup recheck, all four closing contexts, non-UUID fallback semantics, and the retained non-atomic writer order. Obsolete source-text guards were updated to assert the prepared/server-owned equivalents rather than removed wholesale.

This is local source evidence only. Browser behavior, build output, database/RPC deployment, remote data, production release, and atomic writer redesign remain outside Task5d. Fresh independent review is required before Task5 or its umbrella can be accepted.
