# Task5c implementation and review-fix report — 2026-09-01

## State and scope

- Status: review fixes implemented and ready for fresh independent re-review. This does not claim that Task5c, Task5d, or the Task5 umbrella is accepted.
- Original Task5c base: `aa5a3ad1eb9148001a88e43d0645accefbbf5a98`; review-fix base: `128f910626b5a81763d3d4d212379521e1f80607` on `codex/loading-performance`.
- Added the closed `useTextbookReferenceData` owner and mounted production-workspace coverage, then fixed only the Task5c workspace/hook/test lifecycle gaps identified by the independent review.
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

### Independent-review fix RED

Eight mounted counterexamples were first added for the seven review findings. The initial aggregate was interrupted by a test-process `SIGKILL`, so that run was not counted as product RED. Following systematic-debugging Phase 1, each new test was isolated. The first same-kind master-navigation test reproduced the kill only when a full post-popstate DOM query pushed RSS to approximately 2.85 GB. Replacing that query with the already-captured form node's `isConnected` check was the smallest harness/test-only validation; all eight tests then produced ordinary assertion failures against unchanged product source:

1. accepted master A form stayed connected under master B;
2. accepted purchase A form stayed connected under purchase B;
3. accepted closing A metric stayed rendered after its input changed;
4. purchase B's picker still rendered accepted A;
5. purchase form issued no independent balance RPC;
6. master list ignored authoritative service category options;
7. duplicate input sent the non-canonical category;
8. static `TeacherSelect` omitted the explicit `미지정` Radix option.

Two navigation-adjacent counterexamples were then proven within the Task5c navigation contract and produced ordinary RED independently: an invalid detail kind/tab pair issued a direct request, and explicit detail close appended a history entry (`expected 1`, `actual 2`).

The projected-stock test initially stopped at a strict fixture/parser boundary because the balance fixture omitted required quantity maps. After repairing the fixture shape, the observed `7` was traced through selected quantity `0`, current accepted balance `7`, and `current + received = 7`. The original expected `11` was a test expectation defect: changing order stage to receive does not synthesize a received quantity. Product calculation was not changed.

A final hook self-review found that the new synchronous watermark initially keyed only input identity. A direct-hook mounted counterexample accepted `{row:null}` for an admin and synchronously rerendered the identical request input as staff before passive effects; it produced genuine RED because the admin value was still published (`expected null`, actual `{row:null}`). The watermark now keys actor ID/role and input identity together. The same counterexample proves synchronous clearing for role change, user change, and auth disable, while the existing late-completion/retry/unmount cases remain in the suite.

The final mounted suite is `24/24 PASS` (the original 13 plus 11 review/self-review counterexamples). It now additionally covers same-kind A-to-B and A-to-none form closure, stale render/submit exclusion before passive effects, actor-boundary publication exclusion, canonical detail kind/tab and replace-history close, controlled purchase selection and exact location/book/balance readiness, authoritative master/bulk options, canonical duplicate identity and total count, and the static Radix teacher selector.

## Implementation

- Every named picker, selected reference, metadata/detail/duplicate resource, class or teacher sale preview and closing preview has a separately typed state, its own `AbortController`, monotonically invalidated request identity, frozen accepted input, explicit retry, and actor ID plus role lifetime. A render-time publication key combining actor lifetime and input identity prevents an accepted A value from appearing under B or a former actor before the passive cleanup effect runs.
- Picker requests stay bounded to `10|15|20` (initially 20), keep server order and authoritative facets/counts, reset target page once on search/facet/size changes, and never accumulate a catalog.
- Controlled `SearchCombobox` disables local filtering only in server mode, preserves typed search through navigation/error, renders bounded pager/retry state, and pins a separately resolved selected option. Existing static callers retain cmdk scoring, filter behavior and ARIA semantics.
- Purchase and sale forms now use direct selected book/class/location resources, preserve request-safe catalog/manual scope, keep explicit custom teacher names, use real inferred/default locations, and reject late auto defaults after manual edits. The purchase picker is controlled by `purchaseForm.textbookId`; exact accepted catalog, optional class, real location, and balance resources gate submit. Projected stock comes only from the new narrow `purchaseBalanceInput` resource backed by the existing `getTextbookInventoryBalance` service.
- Master metadata, direct edit and exact duplicate checks use their independent reads. `categoryOptions` and `bulkCategoryOptions` come only from exact accepted master options. Pending/error/stale options or duplicates block their dependent actions; strict errors are visible and retryable. Duplicate identity is exact title/subject/publisher/canonical category/excludeId and the UI displays `totalCount`, not the preview length.
- Student sale uses the complete Task5b2 class context in enrolled sequence with `{id,name,grade,school}`, missing placeholders, repeated IDs, exclusions, school search, duplicates and selected-location balance. Teacher sale uses the approved existing inventory-balance input. Both retain the unchanged pure draft formulas and do not authorize final save.
- Closing display is sourced only from `getTextbookClosingPreview`; stale completion cannot overwrite current input, errors are visible, and preview absence blocks save. The Task5d save context and writer are unchanged.
- Canonical `master|purchase|sale|closing` detail query keys now drive direct reads while preserving primary/history/movement query state. Same-kind external A-to-B or A-to-none navigation immediately closes and clears old writable forms; invalid kind/tab pairs issue no request, and explicit close replaces rather than appends the history entry.
- Static no-server `TeacherSelect` retains the Radix Select path, explicit `미지정`, and native keyboard/ARIA behavior; server callers continue to use `SearchCombobox`.

## Remaining legacy loader consumers for Task5d

The remaining `data.*` fields map to exactly these six action/write groups:

1. **Shared schema/write readiness** — `isSchemaReady`, `missingTables`. Displayed/default location reads have moved to the reference owner; only writer gating remains.
2. **Master edit/bulk/delete/settings actions** — `inventory`, `scienceSubjectAreas`, and action-time `textbooks` support inactive cleanup, taxonomy validation and save/delete/bulk payloads. Task5c metadata/direct-detail/duplicate display and master/bulk selector options no longer read these catalogs or numbered summaries.
3. **Purchase request/order action completion and registration handoff** — action-time `textbooks`, `publishers`, `suppliers`, `publisherSupplierLinks`, and `scienceSubjectAreas` remain for mutation payload completion and the unregistered-title-to-master handoff. Form picker/default/detail/projected-stock reads are independent.
4. **Purchase lifecycle/bulk action confirmation and payloads** — `purchaseOrders`, `purchaseOrderLines`, and action-time `textbooks` remain for actual member identity, status confirmation and bulk writer payloads. Direct detail hydration uses authoritative detail/reference data plus the independently resolved book; no form or direct-detail display fallback remains.
5. **Sale create/status/bulk actions** — `sales`, `saleLines`, `textbooks`, `classes`, and `students` remain only in duplicate/status/return/billing action paths that Task5d must refetch immediately before a writer. Task5c preview/display reads are independent.
6. **Closing save** — the unchanged writer still receives the opaque legacy `data` action context. Task5c owns only the independent preview; Task5d must replace that authority with `getTextbookClosingSaveContext` immediately before save.

The final source count confirms there are no remaining loader reads of `locations`, `defaultLocationId`, or `teacherCatalogs` in the workspace.

## Verification

```text
node --test tests/textbook-reference-ui.test.mjs
24/24 PASS

node --test --test-name-pattern='master and inventory controls use summary counts' tests/textbook-numbered-renderers.test.mjs
1/1 PASS

node --test tests/textbook-reference-ui.test.mjs tests/textbook-numbered-renderers.test.mjs tests/textbook-numbered-data.test.mjs tests/textbook-reference-read-service.test.mjs tests/textbook-numbered-read-service.test.mjs tests/textbook-work-context.test.mjs tests/textbook-reference-model.test.mjs tests/search-combobox.test.mjs tests/class-textbook-picker-model.test.mjs
409/410 PASS
```

The sole aggregate failure is the known pre-existing out-of-scope source-text assertion `workspace imports and invokes the single extracted implementations of all three builders` / `buildPurchaseSupplierHandoffGroups is imported`. All 409 other aggregate tests and all exact Task5c review-fix gates pass. The authoritative-options renderer guard now positively checks the service-provided category and negatively checks the stale numbered-summary category; it is not an expectation relaxation. A separate exploratory workspace source-text selection included stale pre-Task5c string guards and was not used as a completion gate or rewritten to broaden this fix.

- Nonincremental TypeScript: `tsc --noEmit --incremental false`, exit 0, no diagnostics.
- Owned ESLint over the hook, workspace, mounted harness, mounted suite, and affected renderer guard: exit 0, no warnings/errors (Babel emitted only its large-file styling note).
- `git diff --check`: exit 0.
- Reserved `tests/textbook-numbered-pagination.test.mjs`: SHA256 `72a3da979a7da3c4428f76f65e03ed140a2e275c25918dcb5e4c93481ad303fd`, unchanged and untracked.
- `.next` has no status entry. Forbidden SQL/manifest/service/type/numbered-hook/writer/query-budget paths have no diff.

Owned source/test hashes at the final gate:

```text
75b4c1cc7ada219423ce022bd136b88e68c174fb1ed06875d3763014eba9d419  src/features/textbooks/use-textbook-reference-data.ts
b1cd2ed4b8ce72111a07a2fd35cc1ddd604bdd55a469e044b55a3aaa703b3111  src/features/textbooks/textbook-operations-workspace.tsx
a7e7beee29e87e0d76356b2e21b1fe5818f22b89a6ce16c7b8ab0e39219c0174  tests/helpers/textbook-numbered-harness.mjs
f1f4c867c476129c7ee8f7e5a802947ed6a14e34a7319b1b99433797f0438f80  tests/textbook-reference-ui.test.mjs
c0f1ef2841858d28bdff8f7f88207d5eb536a7f2c20865f6bd4f2b40a329962d  tests/textbook-numbered-renderers.test.mjs
```

## Self-review

Every owned hunk was reviewed against the closed brief and the complete independent review. The review rechecked synchronous accepted-input identity, retained retry invalidation, same-ID role changes, A-to-B/none closure, valid detail kind/tab pairs, request-safe scope, manual-over-auto precedence, real UUID gating, authoritative option ownership, exact submit/effect guards, duplicate and preview error visibility, direct purchase hydration, projected balance provenance, popstate/history cleanup, the static teacher selector, repeated roster React keys, and the six remaining loader groups. The 387-line workspace diff was also checked for duplicated helpers and avoidable fallbacks; the shared exact-input/canonical-detail helpers and one purchase-balance resource are the narrow reusable additions. Fresh independent re-review is still required before Task5d.
