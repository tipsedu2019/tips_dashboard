# Textbook Workflow Numbered Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Page every textbook operational record list without changing inventory, settlement, grouping, duplicate checks, draft or export meaning.

**Architecture:** Separate page DTOs from full-filter summaries and explicit detail/mutation/export contexts. Preserve existing mutation functions by supplying complete purpose-specific inputs; never pass a page slice where an existing function expects a complete ledger. Share the reviewed pager/preferences/controller, with domain-specific invoker SQL and strict adapters.

**Tech Stack:** React19, Next16, existing shadcn/ui, Supabase/PostgreSQL, TypeScript, node:test, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-31-app-wide-numbered-pagination-design.md`

## Global Constraints

- Page-number blocks contain ten existing numbers: 1–10, 11–20, 21–30. No ellipses or direct page input. Single arrows move one page; double arrows select global first/last.
- Page size10/15/20 minimum10, shared DataTablePagination/useDataTablePageSize/createNumberedPageController, full-filter authorized total, direct target-page reads only. No general full-load fallback.
- Preserve each display-parent unit: purchase student/teacher pairing and sales month/class/textbook aggregation are not raw-row pages.
- Compute balances/quality/facets/summary and count over their complete authorized source scope before page slicing. Restrict raw relation/history DTO enrichment to returned page IDs or explicit detail.
- Preserve current-page selection independently from per-user/per-record drafts. Never delete a draft merely because its record is absent from this page.
- Preserve full-filter export and monthly settlement scope, existing write authority and all domain mutation semantics. Do not change formulas, negative-stock policy, notification/send behavior, RLS or authorization boundaries.
- No remote migration, push, deployment or sends. CLI-generated migrations remain candidate until actual isolated SQL proof; no speculative indexes.
- Supplier/publisher settings and other global-order settings are separate from operational pages; on 2026-08-31 the user approved recommended ordering/save API improvements needed for paging. Preserve existing reorder/add and complete ordered publisher-link semantics; do not introduce an arbitrary catalog cap.
- Distinguish unit/parity/SQL/build/browser evidence; do not bypass Browser access policy or deploy a UI without its required RPC capability.

## Required implementation input

Read `docs/superpowers/plans/2026-08-31-textbook-numbered-read-audit.md` completely before coding this domain. It defines exact filter unions, page units, source anchors, existing quantity/cost formulas, lookup precedence, and required detail/export/draft boundaries. Its proposed API signatures are the contract for this plan, not evidence of an implementation.

## Task 1: Extract executable projection and scope contracts

**Files:**
- Create `src/features/textbooks/textbook-read-types.ts`.
- Create `src/features/textbooks/textbook-read-model.ts`.
- Modify `src/features/textbooks/textbook-operations-workspace.tsx` only to import extracted pure models/types.
- Create `tests/textbook-numbered-model-parity.test.mjs`.

**Interfaces:** Export audit-named `MasterFilters`, `PurchaseFilters`, `SaleFilters`, `SaleHistoryFilters`, `InventoryFilters`, `InventoryHistoryFilters`, `ClosingFilters`, `SettingFilters`, `PageRequest<F,S>`. Extract existing `InventoryCountRow`, `InventoryHistoryRow`, `SaleHistorySummaryRow` and purchase/master DTO types without inventing alternate copies. Export pure grouping/filter projections matching current `buildPurchaseDisplayRows`, `buildSaleHistorySummaryRows`, `buildInventoryCountRows`, master quality and inventory filters. Keep UI rendering outside this module.

- [ ] Write RED fixture tests using literal expectations: paired student+teacher lines count as one display row; repeated same-copy-scope lines remain separate; sales from two source rows in one month/class/textbook yield one history group; opening/purchase/sale/return quantities preserve existing balance and closing formulas.
- [ ] Include cross-page-boundary fixtures (at least101 display parents), inactive/missing-reference textbook resolution, global duplicate title beyond the page, zero/negative/teacher stock, and all-time balances. Freeze purchase pairing using stable `(created_at,id)` source order before offset selection.
- [ ] Extract existing pure functions/types and wire old workspace consumers to them without paging yet. Give `PurchaseCaseRow` stable anchorLineId/memberLineIds plus complete member DTOs. Preserve title/ISBN/barcode lookup exact→normalized→compact precedence and edition separation.
- [ ] Run new parity tests and existing textbook ledger/workspace/service regressions; typecheck/lint and commit as `refactor: isolate textbook list projection contracts`. This task must not change data loading or formulas.

## Task 2: Master, inventory and history read models

**Files:**
- Create CLI migration `textbook_inventory_numbered_reads`.
- Create `supabase/tests/textbook_inventory_numbered_reads_test.sql`.
- Create `src/features/textbooks/textbook-read-service.ts`.
- Create `tests/textbook-numbered-read-service.test.mjs`.

**Interfaces:** Implement the audit contracts for `listTextbookMasterPage`, `listTextbookInventoryPage`, `listTextbookInventoryHistoryPage`, `getTextbookMasterSummary`, `getTextbookInventorySummary`, `getTextbookMasterDetail`, `getTextbookInventoryBalance`, `checkTextbookMasterDuplicate`. RPC names are corresponding snake_case with `_v1`, page requests use `(p_filters jsonb,p_sort text,p_page integer,p_page_size integer)`; all return NumberedPage plus explicitly named matching summaries where applicable. Page projection retains all inventory quantity/value fields and global quality flags specified by the audit.

- [ ] Write RED strict transport tests for page11 one RPC, exact filter/sort/page/size, caller AbortSignal, retryfalse, timeout, malformed/missing API failure and no fallback. Write pgTAP fixtures that reproduce Task1 parity expectations and validate matching count/source authorization.
- [ ] Generate migration with invoker functions and existing role guards. Derive minimum balance/quality/latest-count aggregates needed for filtering/order before key paging; raw movement history is never part of master page payload. Count the full filtered key set, retain exact total on empty/out-of-range pages, and use stable id/composite tie-breakers.
- [ ] Inventory history uses `stock_moves UNION ALL stock_counts` with `(event_at DESC,kind,id)` and retains adjustment_move_id. Do not deduplicate count and linked move implicitly. Inventory shortage means negative or1..3; zero is unused and surplus>=20. Master duplicate quality uses all active titles before list filters.
- [ ] Implement strict service response parsers and existing auth/timeout conventions. Preserve existing APIs and no-send/RLS boundaries. Add exact candidate migration hash, run local SQL if available plus service tests/lint/TS, then commit as `feat: add numbered textbook inventory reads`.

## Task 3: Purchase, sale, closing and explicit work contexts

**Files:**
- Create CLI migration `textbook_workflow_numbered_reads`.
- Create `supabase/tests/textbook_workflow_numbered_reads_test.sql`.
- Extend `src/features/textbooks/textbook-read-service.ts` and read types.
- Create `src/features/textbooks/textbook-work-context-service.ts`.
- Extend `tests/textbook-numbered-read-service.test.mjs`; create `tests/textbook-work-context.test.mjs`.

**Interfaces:** Implement audit-named purchase/sale/sale-history/closing page methods; authoritative purchase/sale/operations summaries; direct purchase/sale/closing detail; `getClassTextbookSaleContext`; `getTextbookPurchaseHandoff`; `getTextbookBillingHandoff`. Page RPC naming/params match Task2 pattern. Explicit export outputs contain `{groups,sourceLineCount,complete:true}`; failure never returns a partial success.

- [ ] Write RED fixtures proving pairing never splits at page boundaries, same-scope duplicates remain separate, parent totals differ correctly from raw-line badges, grouped sales history page11 is based on group count, and summaries remain identical regardless of requested page.
- [ ] Implement SQL candidate/group sources with existing complete filters and role boundaries. Purchase pairing key excludes order_id and includes status/resolved textbook/class/location/requester/supplier/order_date/statement_number. Preserve current status order and member mutation IDs. Keep request-role reads separate from management aggregates.
- [ ] Closing page reads saved closing rows only; explicit preview/detail returns complete month+subject aggregates and separately paged movement rows. Preserve closing formulas from ledger: incoming/outgoing type sets, sale_issue-only team profit, zero teacher/TIPS-store cost, rounded90% external cost. No formula repair is part of paging.
- [ ] Implement purpose-specific complete contexts for existing writes. `getClassTextbookSaleContext` includes selected class's complete enrolled roster, referenced students/textbook, current all-time balance, and complete billable duplicate IDs for class/textbook/month. Revalidate inventory expected quantity at save. For legacy closing mutation, fetch its complete month/subject movement+reference context only on explicit save, with a completeness assertion; never use a displayed page as its input.
- [ ] Exports use full active filter scope, not current page/selection. Prefer server grouped outputs; explicit export/save context may follow bounded chunks to completion, but ordinary page reads may not. Detail IDs and lookup candidates resolve independently of page rows. Tests assert incomplete/error context cannot call writes or produce documents.
- [ ] Run service/context/parity/SQL tests, lint/TS and commit as `feat: add bounded textbook workflow read contexts`.

## Task 4: Operational tabs adopt prepared pages

**Files:**
- Create `src/features/textbooks/use-textbook-numbered-data.ts`.
- Modify `src/features/textbooks/textbook-operations-workspace.tsx`.
- Modify `src/features/textbooks/textbook-service.ts` only for explicit work-context integration, not domain formula changes.
- Create `tests/textbook-numbered-pagination.test.mjs`.

**Interfaces:** The new hook keeps separate page snapshots per visible record-list tab, full-filter summary metadata and explicit work contexts. It exposes prepared row DTOs rather than substituting page arrays into TextbookOperationsData. Preference IDs use `textbooks:<tab>`. Existing row components consume prepared page rows plus callbacks and matching summaries.

- [ ] Write RED controller/component tests for direct page11, previous-page retention/error/retry, atomic scope reset, refresh clamp, URL/detail restoration and independent tab scopes. Add draft/selection fixtures verifying page changes preserve inventory drafts but clear current-page selections.
- [ ] Replace TextbookTable master slice60, PurchaseProcessTable list processing, SalesProcessTable, SalesHistoryLedger, InventoryCountWorkspace, InventoryHistoryPanel slice30 and MonthlyClosingTable slice12 with prepared paged results. Remove list `더 보기` controls. Each shows shared pager and whole-filter count; mobile mirrors use the same page.
- [ ] Remove inventory draft pruning based on `data.inventory`; key drafts by user/textbook/location, clean only after confirmed deletion/save. Preserve current-page member IDs for bulk actions; never select all filtered results implicitly.
- [ ] Wire editor/mutation/export entrypoints to Task3's complete purpose-specific context. Forms must not infer missing reference records or duplicate absence from page contents. Dirty form guards remain; page changes cannot discard unsaved edits. Tab facets/options come from authoritative summaries, not page values.
- [ ] Remove startup use of the17-table `listTextbookOperationsData` bundle only after every list/summary/context dependency is replaced. Keep legacy helper callable solely where a remaining explicitly requested complete work context requires it, and name that boundary in tests; no silent general fallback.
- [ ] Run all affected textbook parity/service/controller/workspace/export regressions, focused lint/TS and commit as `feat: paginate textbook operational tabs`.

## Task 5: Supplier and publisher editable pages

**Files:**
- Create CLI migration `textbook_supplier_numbered_reads` and `supabase/tests/textbook_supplier_numbered_reads_test.sql`.
- Extend read service/types.
- Modify `src/features/textbooks/textbook-supplier-settings-workspace.tsx`.
- Create `tests/textbook-supplier-numbered-pagination.test.mjs`.

**Interfaces:** Implement audit `listTextbookPublisherPage`, `listTextbookSupplierPage`; each row includes complete ordered links for that owner, authoritative related counts/names and independent picker support. Draft maps/tombstones are keyed by owner ID, not page.

- [ ] Apply the user's 2026-08-31 approval of recommended settings save-structure improvements. Restrict each save to dirty supplier/publisher owners, preserve each dirty publisher's complete ordered links, and leave off-page owners untouched. Retain existing controls and write authority. Operational tasks1–4 remain independent.
- [ ] With that scope resolved, write RED tests proving off-page publishers/links are unchanged when saving one owner, draft roundtrip retains all ordered supplier IDs and primary priorities, counts retain id-first/name-fallback semantics, and page changes never use a partial link set as replacement input.
- [ ] Add invoker page/detail/picker reads with RLS/role parity, exact count and stable id order. Separate full owner link detail from arbitrary current-page links; catalog limits are not proof of completeness.
- [ ] Refactor draft/save targets to dirty owners only while preserving each dirty owner's complete link list and existing primary/priority meaning. Apply any approved authoritative ordering contract separately; never globally renumber only a page. Keep subsubject lazy loading and its distinct global-order boundary.
- [ ] Shared pager/preferences and preserved unsaved guards, then service/controller/SQL tests, lint/TS and commit as `feat: paginate textbook supplier settings`.

## Task 6: Textbook verification gate

**Files:** Update `docs/qa/2026-08-31-numbered-pagination.md`.

**Interfaces:** Evidence per master, request, order/receipt, sale/history, inventory/history, closing and supplier/publisher list; exact formula/parity/export/draft/permission test results and remaining authorization/deployment gates.

- [ ] Run the complete affected textbook regressions and production build. Verify no in-scope operational list still starts the17-table full bundle or accumulates displayed pages, and no old full-scope calculation receives only page rows.
- [ ] Execute isolated final SQL and first/middle/final explain probes when available; record offset cost honestly, and add an index only from measured plan evidence. Record browser tests only when permitted and RPC capability exists.
- [ ] Independent whole-slice review and one fix/re-review wave; preserve settings tasks as pending if their scope decision remains unresolved. App-wide completion requires the remaining settings/audit plan, not just operational tabs.
