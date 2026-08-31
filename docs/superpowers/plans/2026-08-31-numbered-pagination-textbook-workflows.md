# Textbook Workflow Numbered Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Page every textbook operational record list without changing inventory, settlement, grouping, duplicate checks, draft or export meaning.

**Architecture:** Separate page DTOs from full-filter summaries and explicit detail/mutation/export contexts. Preserve existing mutation functions by supplying complete purpose-specific inputs; never pass a page slice where an existing function expects a complete ledger. Share the reviewed pager/preferences/controller, with domain-specific invoker SQL and strict adapters.

**Tech Stack:** React19, Next16, existing shadcn/ui, Supabase/PostgreSQL, TypeScript, node:test, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-31-app-wide-numbered-pagination-design.md`

## Global Constraints

- For each new bounded RPC, extend the foundation's explicit numbered-RPC query-budget registry only after strict10/15/20 final-SQL validation and local pgTAP proof; retain timeout/retry/authorization checks. The owning read-model task may update `src/lib/query-surface-budget.js` and its focused tests for that exact contract, never exempt arbitrary list RPCs or weaken unrelated guards. Complete aggregate/export/write-context APIs have separate contracts and must not be misclassified as bounded list reads.

- Page-number blocks contain ten existing numbers: 1–10, 11–20, 21–30. No ellipses or direct page input. Single arrows move one page; double arrows select global first/last.
- Page size10/15/20 minimum10, shared DataTablePagination/useDataTablePageSize/createNumberedPageController, full-filter authorized total, direct target-page reads only. No general full-load fallback.
- Preserve each display-parent unit: purchase student/teacher pairing and sales month/class/textbook aggregation are not raw-row pages.
- Compute balances/quality/facets/summary and count over their complete authorized source scope before page slicing. Restrict raw relation/history DTO enrichment to returned page IDs or explicit detail.
- Preserve current-page selection independently from per-user/per-record drafts. Never delete a draft merely because its record is absent from this page.
- Bind retained rows, summaries, catalogs, details and drafts to resolved actor ID plus role. Disable reads until auth is ready; clear old presentation and invalidate late in-flight/cache writes on logout, user or same-user role change. No client actor value becomes a database authority override.
- Preserve full-filter export and monthly settlement scope, existing write authority and all domain mutation semantics. Do not change formulas, negative-stock policy, notification/send behavior, RLS or authorization boundaries.
- No remote migration, push, deployment or sends. CLI-generated migrations remain candidate until actual isolated SQL proof; no speculative indexes.
- Supplier/publisher settings and other global-order settings are separate from operational pages; on 2026-08-31 the user approved recommended ordering/save API improvements needed for paging. Preserve existing reorder/add and complete ordered publisher-link semantics; do not introduce an arbitrary catalog cap.
- Distinguish unit/parity/SQL/build/browser evidence; do not bypass Browser access policy or deploy a UI without its required RPC capability.

## Required implementation input

Read `docs/superpowers/plans/2026-08-31-textbook-numbered-read-audit.md` completely before coding this domain. It defines exact filter unions, page units, source anchors, existing quantity/cost formulas, lookup precedence, and required detail/export/draft boundaries. Its proposed API signatures are the contract for this plan, not evidence of an implementation.

Implementation clarifications superseding the audit's delivery sketches: use the task-specific split CLI migration names below, not the audit's single illustrative migration; extract `textbook-read-model.ts` as Task1 specifies, not the audit's alternate `.js/.d.ts` sketch. Numbered SQL returns the requested page with matching total and empty rows when out of range; the reviewed common controller alone performs its bounded final-page clamp/reload. Do not silently relabel requested pages inside SQL.

The variable-length editable `textbook_sub_subject_settings` table/mobile cards are in scope, unlike the excluded finite subject configuration matrix. Task6 covers their own draft/global-order/default-merge semantics. The root's source-only preflight is `.superpowers/sdd/2026-08-31-numbered-pagination-textbook-workflows/subsubject-preflight.md`; verify current source before implementation.

## Task 1: Extract executable projection and scope contracts

**Files:**
- Create `src/features/textbooks/textbook-read-types.ts`.
- Create `src/features/textbooks/textbook-read-model.ts`.
- Modify `src/features/textbooks/textbook-operations-workspace.tsx` only to import extracted pure models/types.
- Create `tests/textbook-numbered-model-parity.test.mjs`.
- Modify `tests/textbook-workspace.test.mjs` only to move affected definition-location assertions to the extracted module and verify the real workspace imports/wiring; retain unrelated UI/service safeguards.

**Interfaces:** Export audit-named `MasterFilters`, `PurchaseFilters`, `SaleFilters`, `SaleHistoryFilters`, `InventoryFilters`, `InventoryHistoryFilters`, `ClosingFilters`, `SettingFilters`, `PageRequest<F,S>`. Extract existing `InventoryCountRow`, `InventoryHistoryRow`, `SaleHistorySummaryRow` and purchase/master DTO types without inventing alternate copies. Export pure grouping/filter projections matching current `buildPurchaseDisplayRows`, `buildSaleHistorySummaryRows`, `buildInventoryCountRows`, master quality and inventory filters. Keep UI rendering outside this module.

- [x] Write RED fixture tests using literal expectations: paired student+teacher lines count as one display row; repeated same-copy-scope lines remain separate; sales from two source rows in one month/class/textbook yield one history group; opening/purchase/sale/return quantities preserve existing balance and closing formulas.
- [x] Include cross-page-boundary fixtures (at least101 display parents), inactive/missing-reference textbook resolution, global duplicate title beyond the page, zero/negative/teacher stock, and all-time balances. Freeze purchase pairing using stable `(created_at ASC NULLS LAST,id ASC)` source order before offset selection. This explicitly stabilizes previously unspecified input order; preserve native timestamp precision for that ordering and test equal/missing timestamps and shuffled inputs.
- [x] Extract existing pure functions/types and wire old workspace consumers to them without paging yet. Give `PurchaseCaseRow` stable anchorLineId/memberLineIds plus complete member DTOs. Preserve title/ISBN/barcode lookup exact→normalized→compact precedence and edition separation.
- [x] Run new parity tests and existing textbook ledger/workspace/service regressions; typecheck/lint and commit as `refactor: isolate textbook list projection contracts`. This task must not change data loading or formulas.

## Task 2: Master, inventory and history read models

**Files:**
- Create CLI migration `textbook_inventory_numbered_reads`.
- Create `supabase/tests/textbook_inventory_numbered_reads_test.sql`.
- Create `src/features/textbooks/textbook-read-service.ts`.
- Extend `src/features/textbooks/textbook-read-types.ts` with the actual summary/detail/balance/duplicate transport contracts; reuse Task1's projected row types.
- Create `tests/textbook-numbered-read-service.test.mjs`.
- Append only this task's exact candidate/final entry to `supabase/test-baselines/dashboard-free-tier-v1.manifest.json`; prior final entries remain immutable.
- Modify `src/lib/query-surface-budget.js` and `tests/query-surface-budget.test.mjs` only for the exact new bounded read contracts after final SQL proof, as the global constraint requires.

**Interfaces:** Implement the audit contracts for `listTextbookMasterPage`, `listTextbookInventoryPage`, `listTextbookInventoryHistoryPage`, `getTextbookMasterSummary`, `getTextbookInventorySummary`, `getTextbookMasterDetail`, `getTextbookInventoryBalance`, `checkTextbookMasterDuplicate`. RPC names are corresponding snake_case with `_v1`, page requests use `(p_filters jsonb,p_sort text,p_page integer,p_page_size integer)`. The three page methods return NumberedPage; summary/detail/balance/duplicate methods return their separately typed purpose-specific DTOs from the audit, not artificial numbered-page envelopes. Page projection retains all inventory quantity/value fields and global quality flags specified by the audit.

- [x] Write RED strict transport tests for page11 one RPC, exact filter/sort/page/size, caller AbortSignal, retryfalse, timeout, malformed/missing API failure and no fallback. Write pgTAP fixtures that reproduce Task1 parity expectations and validate matching count/source authorization.
- [x] Generate migration with invoker functions and existing role guards. Derive minimum balance/quality/latest-count aggregates needed for filtering/order before key paging; raw movement history is never part of master page payload. Count the full filtered key set, retain exact total on empty/out-of-range pages, and use stable id/composite tie-breakers.
- [x] Inventory history uses `stock_moves UNION ALL stock_counts` with `(event_at DESC,kind,id)` and retains adjustment_move_id. Do not deduplicate count and linked move implicitly. Inventory shortage means negative or1..3; zero is unused and surplus>=20. Master duplicate quality uses all active titles before list filters.
- [x] Implement strict service response parsers and existing auth/timeout conventions. Preserve existing APIs and no-send/RLS boundaries. Add exact candidate migration hash, run local SQL if available plus service tests/lint/TS, then commit as `feat: add numbered textbook inventory reads`.

## Task 3: Purchase, sale, closing and explicit work contexts

**Files:**
- Create CLI migration `textbook_workflow_numbered_reads`.
- Create `supabase/tests/textbook_workflow_numbered_reads_test.sql`.
- Extend `src/features/textbooks/textbook-read-service.ts` and read types.
- Create `src/features/textbooks/textbook-work-context-service.ts`.
- Create `src/features/textbooks/textbook-handoff-model.ts` by extracting the existing pure order/return/MakeEdu group builders and their minimal pure dependency closure. Modify `textbook-operations-workspace.tsx` only for those extraction imports/deletions in this task; operational paging integration remains Task4. Reuse ledger/taxonomy/read-model helpers, with no workspace import cycle or duplicate alternative formula.
- Extend `tests/textbook-numbered-read-service.test.mjs`; create `tests/textbook-work-context.test.mjs`.
- Narrowly update `tests/textbook-workspace.test.mjs` only if existing helper-location guards move with the extraction, preserving executable parity and workspace wiring coverage rather than removing safeguards.
- Append only this task's candidate/final migration entry to the baseline manifest, and extend the exact query-budget contracts/tests only after final SQL proof; prior final hashes and generic guard behavior remain immutable.

**Interfaces:** Implement audit-named purchase/sale/sale-history/closing page methods; authoritative purchase/sale/operations summaries; direct purchase/sale/closing detail; `getClassTextbookSaleContext`; `getTextbookPurchaseHandoff`; `getTextbookBillingHandoff`. Page RPC naming/params match Task2 pattern. Explicit export outputs contain `{groups,sourceLineCount,complete:true}`; failure never returns a partial success.

The existing closing-detail record table is also a page boundary: add `ClosingMovementFilters` with `{closingMonth,subject,search}` and `listTextbookClosingMovementPage(PageRequest<ClosingMovementFilters,"event-desc">,options)` using `list_textbook_closing_movement_page_v1` and the same four page arguments. Its row is the existing `{id,at,typeLabel,textbookTitle,locationName,quantity,amount,marginAmount}` projection, sorted by event descending then stable real movement ID. Add `getTextbookClosingPreview({closingMonth,subject,openingQuantity,openingAmount},options)` for the existing complete preview calculation plus unfiltered movement count, without raw movement arrays. Direct saved closing detail similarly returns the selected stored row and complete current aggregate/count (explicit missing row), never its full movement table. Add explicit `getTextbookClosingSaveContext({closingMonth,subject},options)` for the legacy complete save inputs, and `getTextbookClosingMovementExport(filters,options)` returning `{rows,sourceLineCount,complete:true}` for full-filter clipboard output. These name already-approved separate preview/detail/save/export boundaries, not new calculation semantics or ordinary-page fallbacks.

Sales history also requires its own `getTextbookSaleHistorySummary(filters,options)` / `get_textbook_sale_history_summary_v1(p_filters jsonb)` contract: `{totalCount,totalWaitingQuantity,totalIssuedQuantity,sourceTotalCount,yearOptions,monthOptions,classOptions,effectiveMonth}`. Count and quantities apply the complete year/effective-month/class-filtered grouped source; sourceTotalCount counts all eligible unfiltered history groups so the existing hide-only-when-no-history behavior remains possible. Year options and class options come from all eligible history groups, while month options depend only on selected year, never the displayed page or class. Preserve numeric Korean class-label ordering with an explicit deterministic identity tie. A selected month absent from those month options resolves to `all` in both page and summary; other filters retain their existing meaning. The existing history component does not receive the operations search query and exposes no search input. Accordingly narrow the audit's provisional `SaleHistoryFilters.search` to the empty-string literal, reject nonempty values as invalid input, and pass `""` from its actual consumer; do not invent search semantics or leak an adjacent list's filter into history. These source-backed clarifications supersede that provisional audit field and add no new UI controls.

- [ ] Write RED fixtures proving pairing never splits at page boundaries, same-scope duplicates remain separate, parent totals differ correctly from raw-line badges, grouped sales history page11 is based on group count, and summaries remain identical regardless of requested page.
- [ ] Implement SQL candidate/group sources with existing complete filters and role boundaries. Purchase pairing key excludes order_id and includes status/resolved textbook/class/location/requester/supplier/order_date/statement_number. Preserve current status order and member mutation IDs. Keep request-role reads separate from management aggregates.
- [ ] Preserve the exact existing purchase facet loops: request and board-scope raw-line badges iterate all mode groups with their respective replacement row filter; order-filter badges additionally apply their candidate group restriction. This source-specific clarification supersedes the audit's generic facet sketch. Pager parent count and displayed full-filter totals still use the final visible-group scope; add a literal case proving these distinct counts rather than changing existing badge semantics.
- [ ] Preserve sale-history complete-source options, waiting/issued totals and stale-month fallback through both page and dedicated summary. Include more than100 groups, off-page classes/months, teacher-copy inclusion, cancelled/returned/excluded exclusion, unknown year/class, stale month, empty source and empty filtered result. Its raw-status/latestAt semantics come from the extracted model, not sale-process display normalization; no operations-search dependency.
- [ ] Closing page reads saved closing rows only; explicit preview/detail returns complete month+subject aggregates and separately paged movement rows. Preserve closing formulas from ledger: incoming/outgoing type sets, sale_issue-only team profit, zero teacher/TIPS-store cost, rounded90% external cost. No formula repair is part of paging.
- [ ] Exercise the actual closing-movement projection/search against the legacy source, including more than100 rows, direct page11, empty/out-of-range count, month/timezone boundary, same-time ID tie and both quantity and money search. Keep full aggregate/mismatch metadata independent of detail search/page. Detail row amount, ledger aggregate amount fallback and stored-vs-current rounded mismatch rules are distinct existing formulas; do not silently unify them. Clipboard export retains the full active search scope and fails on incomplete reads.
- [ ] Implement purpose-specific complete contexts for existing writes. `getClassTextbookSaleContext` includes selected class's complete enrolled roster, referenced students/textbook, current all-time balance, and complete billable duplicate IDs for class/textbook/month. Revalidate inventory expected quantity at save. For legacy closing mutation, fetch its complete month/subject movement+reference context only on explicit save, with a completeness assertion; never use a displayed page as its input.
- [ ] Exports use full active filter scope, not current page/selection. Prefer server grouped outputs; explicit export/save context may follow bounded chunks to completion, but ordinary page reads may not. Detail IDs and lookup candidates resolve independently of page rows. Tests assert incomplete/error context cannot call writes or produce documents.
- [ ] Execute the extracted handoff builders with literal existing order/return/billing outputs before changing their source path, including cross-order grouping, student/teacher/location splits, raw eligible source-line counts, price/zero formatting and real student line IDs. They may consume an explicitly complete export context; importing the large React workspace into a service or using page arrays as a complete context is forbidden. Preserve PNG/PDF/clipboard rendering and preview-before-send.
- [ ] Run service/context/parity/SQL tests, lint/TS and commit as `feat: add bounded textbook workflow read contexts`.

## Task 4: Operational tabs adopt prepared pages

**Files:**
- Create `src/features/textbooks/use-textbook-numbered-data.ts`.
- Modify `src/features/textbooks/textbook-operations-workspace.tsx`.
- Modify `src/features/textbooks/textbook-service.ts` only for explicit work-context integration, not domain formula changes.
- Create `tests/textbook-numbered-pagination.test.mjs`.

**Interfaces:** The new hook keeps separate page snapshots per visible record-list tab, full-filter summary metadata and explicit work contexts. It exposes prepared row DTOs rather than substituting page arrays into TextbookOperationsData. Preference IDs use `textbooks:<tab>`. Existing row components consume prepared page rows plus callbacks and matching summaries.

- [ ] Write RED controller/component tests for direct page11, previous-page retention/error/retry, atomic scope reset, refresh clamp, URL/detail restoration and independent tab scopes. Add draft/selection fixtures verifying page changes preserve inventory drafts but clear current-page selections.
- [ ] Exercise resolved same-ID role change, logout/relogin and late page/summary/catalog/detail completions through the real consumer. Clear old authorization-scoped data immediately and reject old cache writes; preserve same-actor drafts across ordinary paging. Carry server-selected order through actual raw DTO/service/model/hook/table paths rather than re-sorting display titles locally.
- [ ] Replace TextbookTable master slice60, PurchaseProcessTable list processing, SalesProcessTable, SalesHistoryLedger, InventoryCountWorkspace, InventoryHistoryPanel slice30 and MonthlyClosingTable slice12 with prepared paged results. Remove list `더 보기` controls. Each shows shared pager and whole-filter count; mobile mirrors use the same page.
- [ ] Remove inventory draft pruning based on `data.inventory`; key drafts by user/textbook/location, clean only after confirmed deletion/save. Preserve current-page member IDs for bulk actions; never select all filtered results implicitly.
- [ ] Wire editor/mutation/export entrypoints to Task3's complete purpose-specific context. Forms must not infer missing reference records or duplicate absence from page contents. Dirty form guards remain; page changes cannot discard unsaved edits. Tab facets/options come from authoritative summaries, not page values.
- [ ] Remove startup use of the17-table `listTextbookOperationsData` bundle only after every list/summary/context dependency is replaced. Keep legacy helper callable solely where a remaining explicitly requested complete work context requires it, and name that boundary in tests; no silent general fallback.
- [ ] Run all affected textbook parity/service/controller/workspace/export regressions, focused lint/TS and commit as `feat: paginate textbook operational tabs`.

## Task 5: Supplier and publisher editable pages

**Files:**
- Create CLI migration `textbook_supplier_numbered_reads` and `supabase/tests/textbook_supplier_numbered_reads_test.sql`.
- Extend read service/types.
- Create `src/features/textbooks/textbook-settings-draft-service.ts` and focused transport/draft tests for the authorized owner-scoped transactional save boundary; the following taxonomy task extends this same boundary rather than creating an unrelated Save button.
- Modify `src/features/textbooks/textbook-supplier-settings-workspace.tsx`.
- Create `tests/textbook-supplier-numbered-pagination.test.mjs`.

**Interfaces:** Implement audit `listTextbookPublisherPage`, `listTextbookSupplierPage`; each row includes complete ordered links for that owner, authoritative related counts/names and independent picker support. Draft maps/tombstones are keyed by owner ID, not page.

- [ ] Apply the user's 2026-08-31 approval of recommended settings save-structure improvements. Restrict each save to dirty supplier/publisher owners, preserve each dirty publisher's complete ordered links, and leave off-page owners untouched. Retain existing controls and write authority. Operational tasks1–4 remain independent.
- [ ] With that scope resolved, write RED tests proving off-page publishers/links are unchanged when saving one owner, draft roundtrip retains all ordered supplier IDs and primary priorities, counts retain id-first/name-fallback semantics, and page changes never use a partial link set as replacement input.
- [ ] Add invoker page/detail/picker reads with RLS/role parity, exact count and stable id order. Separate full owner link detail from arbitrary current-page links; catalog limits are not proof of completeness.
- [ ] Refactor draft/save targets to dirty owners only while preserving each dirty owner's complete link list and existing primary/priority meaning. Apply any approved authoritative ordering contract separately; never globally renumber only a page. Keep subsubject lazy loading and its distinct global-order boundary.
- [ ] Use one domain-specific transactional invoker save for dirty publisher/supplier owners and complete links, with optimistic base revision and actor/request replay identity for uncertain retries. Validate and apply the entire submitted owner set or none, retain untouched owner rows/links, and preserve existing DML authority. Preserve a single workspace Save coordinator and keep unrelated subsubject drafts until their explicit successful save; Task6 extends the same atomic endpoint to taxonomy. No generic table writer or partial-success masquerade. Read errors never imply missing/empty links.
- [ ] Shared pager/preferences and preserved unsaved guards, then service/controller/SQL tests, lint/TS and commit as `feat: paginate textbook supplier settings`.

## Task 6: Editable subsubject taxonomy pages and shared Save

**Files:**
- Create CLI migration `textbook_taxonomy_numbered_drafts` and `supabase/tests/textbook_taxonomy_numbered_drafts_test.sql`.
- Extend textbook read types/service and `textbook-settings-draft-service.ts`.
- Modify `textbook-supplier-settings-workspace.tsx` for its subsubject panel and shared Save coordinator only; preserve reviewed publisher/supplier paging.
- Extend `textbook-taxonomy.ts` only with pure default identity/projection helpers if required; preserve existing picker and legacy helper behavior.
- Create `tests/textbook-subsubject-numbered-pagination.test.mjs` and update affected lazy-taxonomy tests with actual behavior coverage.

**Interfaces:** `listTextbookSubSubjectPage({page,pageSize,filters:{subject,search},draft},options)` uses `list_textbook_sub_subject_numbered_page_v1(p_filters jsonb,p_draft jsonb,p_page integer,p_page_size integer)` and returns the projected `NumberedPage<TextbookSubSubjectSettingRecord>` plus matching revision, whole-taxonomy visible count, and per-returned-row move directions from the entire subject order. Extend Task5's atomic settings save body with the chronological subsubject journal; reuse its actor/request identity and all-or-none transaction for the shared workspace Save. Add/patch/delete/move operations carry stable IDs; the server resolves off-page neighbors and duplicate checks without full-list client reads.

- [ ] Verify final taxonomy table/RLS/constraints and executable `mergeTextbookSubSubjectSettings` parity. The effective source is persisted normalized named records plus every missing built-in `(subject,name)` default, not defaults only when a subject is empty. Preserve English/Math/Science/Other defaults, visible flags, subject order, numeric name ties and explicit duplicate-name validation after trim. Built-in defaults are a finite overlay; persisted custom rows are not bounded.
- [ ] Keep reads lazy until the subsubject tab is opened. Ordinary page reads must not persist defaults or convert an unavailable/missing new RPC into a successful built-in-only catalog. Represent virtual defaults with stable non-DB identity; explicit save materializes only necessary rows with valid stable UUIDs/replay identity, never writes legacy `english-단어` strings to a UUID column. Preserve missing-default reappearance after a fresh canonical reload and suppress it while an explicit draft tombstone is active. Test rename/delete of a built-in separately from a custom row; do not change general textbook picker fallback behavior.
- [ ] Project the full chronological journal over that effective source before filter/count/page. Add uses the active subject's global final rank; move swaps adjacent rows in the complete subject order regardless of search/page, preserving other subjects. Return global move availability instead of disabling the first/last row of each page. Use the existing stable Korean numeric name semantics with a deterministic identity tie; do not renumber only a page. Preserve blank editable new rows before Save and the legacy trimmed-empty omission rule without silently deleting persisted rows.
- [ ] Test more than100 custom rows plus missing-default overlays, direct page11 in one request, full total/visible badge, page10→11, off-page duplicate, move across page/search boundaries, add-at-global-end and retained edits across page/subject/tab changes. Actual desktop/mobile consumers must use the same page and common pager preference `textbooks:subsubjects`; no current-page sorting/filtering that changes server order.
- [ ] Extend the single atomic Save to pending publisher/supplier/link/subsubject changes together. Untouched taxonomy remains unread/unwritten on a publisher-only save. Validate all dirty edits before any DML; constraint/RLS/conflict failure rolls back all included changes and preserves all drafts. No-op leaves timestamps unchanged; uncertain retry reuses the identical request body/ID, with no automatic write retry. Subsubject duplicates are checked against off-page persisted/projected rows. Preserve native privilege/constraint errors and never manually raise40001.
- [ ] Preserve resolved actor/role clearing, auth readiness, stale-result guards, existing unsaved navigation behavior and successful-save-only draft clearing. Run real model/service/consumer tests, final local pgTAP with permissions/default/order/atomic rollback/replay coverage, focused lint/TS and commit as `feat: paginate editable textbook taxonomy settings`.

## Task 7: Textbook verification gate

**Files:** Update `docs/qa/2026-08-31-numbered-pagination.md`.

**Interfaces:** Evidence per master, request, order/receipt, sale/history, inventory/history, closing, supplier/publisher and editable subsubject list; exact formula/parity/export/draft/permission test results and remaining deployment gates.

- [ ] Run the complete affected textbook regressions and production build. Verify no in-scope operational list still starts the17-table full bundle or accumulates displayed pages, and no old full-scope calculation receives only page rows.
- [ ] Execute isolated final SQL and first/middle/final explain probes when available; record offset cost honestly, and add an index only from measured plan evidence. Record browser tests only when permitted and RPC capability exists.
- [ ] Independent whole-slice review and one fix/re-review wave. The user has approved the required settings save improvements; unimplemented publisher/supplier/subsubject work is pending implementation, not an unresolved approval. App-wide completion requires the remaining general settings/audit plan, not just textbook tabs.
