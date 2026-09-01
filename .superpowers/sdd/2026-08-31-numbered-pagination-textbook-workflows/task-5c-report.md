# Task5c implementation report — 2026-09-01

## State and scope

- Status: implementation complete and ready for fresh independent review; Task5d and the Task5 umbrella remain open.
- Base: `aa5a3ad1eb9148001a88e43d0645accefbbf5a98` on `codex/loading-performance`.
- Added the closed `useTextbookReferenceData` owner and mounted production-workspace coverage, and changed only the Task5c workspace plus its mounted harness.
- Preserved the legacy loader for the six Task5d action/write groups below. No writer, save API, numbered controller, Task2/3/4 service/type, navigation codec, SQL, manifest, query-budget file, protected `.next`, or reserved pagination fixture was changed.
- No browser, server, build, DB/container, remote, provider, or send action was run.

## TDD evidence

The first mounted test used the real workspace, new hook boundary, named services and `SearchCombobox`, controlling only Supabase transport, auth and Next query state. Before source implementation it failed at the first independent form-read boundary:

```text
node --test tests/textbook-reference-ui.test.mjs
tests 1; pass 0; fail 1
AssertionError: request form owns a book reference page
```

That was the genuine source RED: the mounted request form still depended on the legacy catalog bundle and issued no bounded reference-page request.

The final mounted suite is `13/13 PASS`. It covers exact named calls and caller cancellation, bounded page 1/page 2 and search reset, authoritative facets/order, real default location/no fabricated location, accepted null/error/retry with zero fallback, changed-input/unmount/remount retained callback invalidation, off-page selected labels/custom teacher, manual value winning over a late class default, exact purchase anchor identity, direct master/purchase/sale navigation and cancellation, strict duplicate pending/error/stale/direct-detail behavior, the final Task5b2 class roster including school-only off-page search/repeats/missing identities/duplicate/negative balance, and closing preview races.

## Implementation

- Every named picker, selected reference, metadata/detail/duplicate resource, class or teacher sale preview and closing preview has a separately typed state, its own `AbortController`, monotonically invalidated request identity, frozen accepted input, explicit retry, and actor ID plus role lifetime.
- Picker requests stay bounded to `10|15|20` (initially 20), keep server order and authoritative facets/counts, reset target page once on search/facet/size changes, and never accumulate a catalog.
- Controlled `SearchCombobox` disables local filtering only in server mode, preserves typed search through navigation/error, renders bounded pager/retry state, and pins a separately resolved selected option. Existing static callers retain cmdk scoring, filter behavior and ARIA semantics.
- Purchase and sale forms now use direct selected book/class/location resources, preserve request-safe catalog/manual scope, keep explicit custom teacher names, use real inferred/default locations, and reject late auto defaults after manual edits.
- Master metadata, direct edit and exact duplicate checks use their independent reads. Pending/error/stale duplicates block save; strict errors are visible and retryable; an off-page duplicate opens by direct UUID.
- Student sale uses the complete Task5b2 class context in enrolled sequence with `{id,name,grade,school}`, missing placeholders, repeated IDs, exclusions, school search, duplicates and selected-location balance. Teacher sale uses the approved existing inventory-balance input. Both retain the unchanged pure draft formulas and do not authorize final save.
- Closing display is sourced only from `getTextbookClosingPreview`; stale completion cannot overwrite current input, errors are visible, and preview absence blocks save. The Task5d save context and writer are unchanged.
- Canonical `master|purchase|sale` detail query keys now drive direct reads while preserving primary/history/movement query state. Back/external A-to-B-to-none navigation cancels old reads; invalid IDs issue no direct request.

## Remaining legacy loader consumers for Task5d

The remaining `data.*` fields map to exactly these six action/write groups:

1. **Shared schema/write readiness** — `isSchemaReady`, `missingTables`. Displayed/default location reads have moved to the reference owner; only writer gating remains.
2. **Master edit/bulk/delete/settings actions** — `inventory`, `scienceSubjectAreas`, and action-time `textbooks` support inactive cleanup, taxonomy validation and save/delete/bulk payloads. Task5c metadata/direct-detail/duplicate display no longer reads these catalogs.
3. **Purchase request/order action completion** — action-time `textbooks`, `publishers`, `suppliers`, `publisherSupplierLinks`, and `scienceSubjectAreas` remain for mutation payload completion and the unregistered-title handoff. Form picker/default/detail reads are independent.
4. **Purchase lifecycle/bulk actions** — `purchaseOrders`, `purchaseOrderLines`, and action-time `textbooks` remain for actual member identity, status confirmation and bulk writer payloads. Direct detail display uses the real anchor-line service.
5. **Sale create/status/bulk actions** — `sales`, `saleLines`, `textbooks`, `classes`, and `students` remain only in duplicate/status/return/billing action paths that Task5d must refetch immediately before a writer. Task5c preview/display reads are independent.
6. **Closing save** — the unchanged writer still receives the opaque legacy `data` action context. Task5c owns only the independent preview; Task5d must replace that authority with `getTextbookClosingSaveContext` immediately before save.

The final source count confirms there are no remaining loader reads of `locations`, `defaultLocationId`, or `teacherCatalogs` in the workspace.

## Verification

```text
node --test tests/textbook-reference-ui.test.mjs
13/13 PASS

node --test --test-name-pattern='<14 actually affected workspace guards>' tests/textbook-workspace.test.mjs
14/14 PASS

node --test tests/textbook-reference-ui.test.mjs tests/textbook-numbered-renderers.test.mjs tests/textbook-numbered-data.test.mjs tests/textbook-reference-read-service.test.mjs tests/textbook-numbered-read-service.test.mjs tests/textbook-work-context.test.mjs tests/textbook-reference-model.test.mjs tests/search-combobox.test.mjs tests/class-textbook-picker-model.test.mjs
398/399 PASS
```

The sole aggregate failure is the known pre-existing out-of-scope source-text assertion `workspace imports and invokes the single extracted implementations of all three builders` / `buildPurchaseSupplierHandoffGroups is imported`. All 398 other aggregate tests and all exact Task5c gates pass. A separate exploratory full workspace source-text run exposed 33 stale guards whose required strings are absent from base `aa5a3ad1`; they were not rewritten or used to broaden Task5c.

- Nonincremental TypeScript: `tsc --noEmit --incremental false`, exit 0, no diagnostics.
- Owned ESLint over the hook, workspace, mounted harness and mounted suite: exit 0, no warnings/errors.
- `git diff --check`: exit 0.
- Reserved `tests/textbook-numbered-pagination.test.mjs`: SHA256 `72a3da979a7da3c4428f76f65e03ed140a2e275c25918dcb5e4c93481ad303fd`, unchanged and untracked.
- `.next` has no status entry. Forbidden SQL/manifest/service/type/numbered-hook/writer/query-budget paths have no diff.

Owned source/test hashes at the final gate:

```text
92981433afdf9b0a6b7ee5bcf4e79cb92fff559d88e53e995609a3702a7ec859  src/features/textbooks/use-textbook-reference-data.ts
3c2cc4cba623b30325c1d219b15e23f0310f055d486d5dbe524263f0aa940cfd  src/features/textbooks/textbook-operations-workspace.tsx
fa49e943e2b59bbc805c738c3393136a50cd1ba952294514f3c6d830c5c9a1b0  tests/helpers/textbook-numbered-harness.mjs
450a5a1c090b58a8ee20cc623177b1be9e3d092e3b22d4919ff5f990734fe508  tests/textbook-reference-ui.test.mjs
```

## Self-review

Every owned hunk was reviewed against the closed brief. The review rechecked structural input identity, retained retry invalidation, same-ID role changes, request-safe scope, manual-over-auto precedence, real UUID gating, server-order preservation, accepted-input submit guards, duplicate and preview error visibility, exact direct-detail IDs, popstate cleanup, repeated roster React keys, and the six remaining loader groups. No Task5c-owned correctness blocker remains. Fresh independent review is still required before Task5d.
