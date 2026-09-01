# Textbook Numbered Read Audit

**Date:** 2026-08-31
**Status:** Read-only architecture audit; no implementation or runtime validation.
**Spec:** `docs/superpowers/specs/2026-08-31-app-wide-numbered-pagination-design.md`
**Scope:** Smallest safe decomposition of textbook operations into numbered parent reads, authoritative aggregates, and separate detail/lookup/export/mutation-context reads.
**Not authorized:** Remote migrations, deployment, provider activation, sends, domain mutation changes, index changes without plan evidence.

## Core decision

Do not replace the existing `TextbookOperationsData` arrays with page arrays. Inventory, duplicate detection, closing calculations, exports, and mutation inputs currently assume complete source collections. Introduce independent page DTOs and purpose-specific complete contexts; retire the full-load list hook only after its consumers are separated.

The common result is `NumberedPage<T> { rows, page, pageSize, totalCount }`, with one-based page and `pageSize: 10 | 15 | 20`. Full-filter count is not loaded-row length. Selection means current-page selection, while drafts survive page changes independently.

## 1. Page units and table dependencies

| Read API / parent unit | Source and required calculation |
| --- | --- |
| `listTextbookMasterPage` / `textbooks.id` | Textbooks plus all-time `textbook_stock_moves` aggregate; duplicate and quality flags from all active textbooks. Search, subject, school level, grade, subsubject, quality, and inventory filters. |
| `listTextbookPurchasePage` / display case | `textbook_purchase_order_lines`, purchase orders, resolved textbook/reference, classes, publishers, suppliers, publisher-supplier links, locations. Shared request/order implementation with distinct mode, filters, and authorization. |
| `listTextbookSalePage` / `textbook_sale_lines.id` | Sale lines, sales, textbooks, classes, selected recipient students/teachers, locations. Preserve status group order. |
| `listTextbookSaleHistoryPage` / month + class + textbook | Aggregate complete matching sale lines before pagination. Preserve waiting/issued quantities and cancelled/returned/excluded exclusion. |
| `listTextbookInventoryPage` / textbook ID for requested location | Textbooks, all-time movement balance, latest stock count for textbook/location. Audit status and ordering computed before paging. |
| `listTextbookInventoryHistoryPage` / kind + ID | `stock_moves UNION ALL stock_counts`; preserve `adjustment_move_id`. Do not silently deduplicate linked adjustment movement and count records. |
| `listTextbookClosingPage` / `monthly_closings.id` | Stored closing rows only; defer movement details and recalculation to explicit reads. |
| `listTextbookPublisherPage`, `listTextbookSupplierPage` / catalog ID | Publisher/supplier rows plus authoritative link counts, related names, and textbook counts. Separate editable lists from search pickers. |

### Source anchors

- `src/features/textbooks/textbook-service.ts:289`: `listTextbookOperationsData` makes 17 concurrent source requests and derives inventory from complete stock moves.
- `src/features/textbooks/textbook-operations-workspace.tsx:1353`: `buildInventoryCountRows`.
- `src/features/textbooks/textbook-operations-workspace.tsx:1787`: `getPurchaseDisplayCaseKey`; `:1803`: `buildPurchaseDisplayRows`.
- `src/features/textbooks/textbook-operations-workspace.tsx:2418`: `buildSaleHistorySummaryRows`.
- `src/features/textbooks/textbook-operations-workspace.tsx:2547`: existing whole-bundle hook.
- `src/features/textbooks/textbook-operations-workspace.tsx:9306`: `InventoryHistoryPanel`, currently sorts a union and slices 30 records.
- `src/features/textbooks/textbook-operations-workspace.tsx:12066`: `MonthlyClosingTable`, currently uses `slice(-12).reverse()`.
- `src/features/textbooks/textbook-ledger.js:281`: inventory snapshot; `:468`: closing movement filtering/enrichment; `:803`: closing calculation.

### Purchase display parent is not purchase_order_id

The current case key combines status, resolved textbook, class, location, requester, supplier, order date, and statement number. It does **not** include `purchase_order_id`. Student/teacher lines can be paired in one display row; another line of the same copy scope remains a separate display row. Paging raw lines can split this parent, and paging order IDs changes current grouping.

Before SQL pagination, freeze the existing pairing algorithm against a deterministic `(created_at, id)` source order. Return an `anchorLineId`, `memberLineIds`, and complete student/teacher member DTOs. Count display parents for the pager. Existing operational badge counts often count raw lines, so expose these separately instead of changing their meaning implicitly. Detail access should resolve from a stable real line ID, not require that the synthesized display key be in the loaded page.

## 2. Proposed TypeScript contracts

Create `src/features/textbooks/textbook-read-types.ts`:

```ts
type ReadOptions = {
  client?: SupabaseClientLike;
  signal?: AbortSignal;
};

type PageRequest<F, S extends string> = {
  page: number;
  pageSize: 10 | 15 | 20;
  filters: F;
  sort: S;
};

type MasterFilters = {
  search: string;
  subject: string;
  schoolLevel: string;
  gradeLevel: string;
  subSubject: string;
  quality: TextbookQualityFilter;
  inventory: InventoryFilter;
};

type PurchaseFilters = {
  mode: "request" | "order";
  search: string;
  boardScope: "active" | "recent" | "all";
  requestFilter: "all" | "unregistered" | "orderable";
  orderFilter: "all" | "waiting" | "partial" | "returnable" | "returned";
};

type SaleFilters = {
  search: string;
  status: "all" | "waiting" | "issued" | "returned" | "cancelled";
};

type SaleHistoryFilters = {
  search: string;
  year: string;
  month: string;
  classId: string;
};

type InventoryFilters = MasterFilters & {
  locationId: string;
  audit: "recommended" | "pending" | "done" | "all";
};

type InventoryHistoryFilters = {
  textbookId: string | null;
  locationId: string | null;
};

type ClosingFilters = { month: string; subject: string; status: string };
type SettingFilters = { search: string };
```

Create `src/features/textbooks/textbook-read-service.ts` with these page boundaries:

```ts
listTextbookMasterPage(
  request: PageRequest<MasterFilters, "quality-title">, options?: ReadOptions
): Promise<NumberedPage<TextbookMasterRow>>;

listTextbookPurchasePage(
  request: PageRequest<PurchaseFilters, "status-event">, options?: ReadOptions
): Promise<NumberedPage<PurchaseCaseRow>>;

listTextbookSalePage(
  request: PageRequest<SaleFilters, "status-event">, options?: ReadOptions
): Promise<NumberedPage<SaleLineRow>>;

listTextbookSaleHistoryPage(
  request: PageRequest<SaleHistoryFilters, "month-class-title">, options?: ReadOptions
): Promise<NumberedPage<SaleHistorySummaryRow>>;

listTextbookInventoryPage(
  request: PageRequest<InventoryFilters, "audit-priority">, options?: ReadOptions
): Promise<NumberedPage<InventoryCountRow>>;

listTextbookInventoryHistoryPage(
  request: PageRequest<InventoryHistoryFilters, "event-desc">, options?: ReadOptions
): Promise<NumberedPage<InventoryHistoryRow>>;

listTextbookClosingPage(
  request: PageRequest<ClosingFilters, "month-desc">, options?: ReadOptions
): Promise<NumberedPage<ClosingRow>>;

listTextbookPublisherPage(
  request: PageRequest<SettingFilters, "name">, options?: ReadOptions
): Promise<NumberedPage<PublisherSettingsRow>>;

listTextbookSupplierPage(
  request: PageRequest<SettingFilters, "name">, options?: ReadOptions
): Promise<NumberedPage<SupplierSettingsRow>>;
```

`TextbookMasterRow` must retain the current inventory-row fields `locationQuantities`, `studentLocationQuantities`, `teacherLocationQuantities`, `totalQuantity`, `studentQuantity`, `teacherQuantity`, and `stockValue`, plus server `qualityIssues` and `qualityScore`. `PurchaseCaseRow` includes display fields, member IDs, and complete scoped line DTOs. Reuse the existing `InventoryCountRow`, `InventoryHistoryRow`, and `SaleHistorySummaryRow` shapes by extracting them from the workspace rather than maintaining duplicate definitions.

These signatures are architecture boundaries, not an implemented/compilable module; detailed aggregate DTO field declarations must follow the existing calculations identified below.

## 3. Aggregate, detail, lookup, and mutation-context boundaries

```ts
getTextbookMasterSummary(filters: MasterFilters, options?: ReadOptions);
getTextbookPurchaseSummary(filters: PurchaseFilters, options?: ReadOptions);
getTextbookSaleSummary(filters: SaleFilters, options?: ReadOptions);
getTextbookInventorySummary(filters: InventoryFilters, options?: ReadOptions);
getTextbookOperationsSummary(options?: ReadOptions);

getTextbookMasterDetail(id: string, options?: ReadOptions);
getTextbookPurchaseDetail(anchorLineId: string, options?: ReadOptions);
getTextbookSaleDetail(lineId: string, options?: ReadOptions);
getTextbookClosingDetail(id: string, options?: ReadOptions);

getTextbookInventoryBalance(
  input: { textbookIds: string[]; locationId: string | null },
  options?: ReadOptions
);

checkTextbookMasterDuplicate(
  input: {
    excludeId: string | null;
    title: string;
    subject: string;
    publisher: string;
    category: string;
  }, options?: ReadOptions
): Promise<{ totalCount: number; previewRows: TextbookMasterRow[] }>;

getClassTextbookSaleContext(
  input: {
    classId: string;
    textbookId: string;
    chargeMonth: string;
    locationId: string;
  }, options?: ReadOptions
);
```

`getClassTextbookSaleContext` returns the selected class's complete enrolled roster and associated student records, selected textbook, all-time inventory balance, and billable duplicate count/student IDs for the same class/textbook/month. A bounded preview is allowed only alongside an authoritative count. Search pickers need independent bounded search and selected-ID detail contracts; do not feed them a record-list page or infer options from current-page rows.

Reference matching preserves exact ID -> normalized alias -> compact alias precedence from `getTextbookByExactReference` and `getTextbookByReference`. Aliases include title/name/ISBN/barcode. Retain revised-edition separation. `resolvePurchaseLifecycleTextbook` in `textbook-service.ts:269` still reads all textbooks; replacing the list read alone will not remove that action-time full scan.

### Preserve aggregate scopes

- Quality facet counts use taxonomy filters, but currently do not use the text search term. Duplicate-title quality is computed across all active textbooks before list filtering.
- Purchase facets replace only their respective facet while retaining other active scope and search predicates; their existing quantities are raw-line counts, not display-parent counts.
- Inventory shortage is negative or 1–3; zero is unused; surplus is at least 20.
- Audit recommendation depends on all-time current balance, latest count at the selected location, and the existing count-cycle constants.
- Master visible ordering currently groups by subject, then descending quality score, then Korean numeric title. Carry this into the server stable sort rather than sorting only a selected page.
- Purchase board `recent` has the existing 30-day terminal-status behavior; preserve missing-date behavior.
- Filter options and year/class choices cannot be derived from current-page rows; they need separately scoped authoritative options.
- Existing table and group totals must distinguish full-filter totals from explicitly labeled current-page totals.

## 4. Mutation inputs and closing preservation

The existing mutation code is not authorized for domain-semantic changes in this work.

- `createClassTextbookSale` (`textbook-service.ts:844`), `createTeacherTextbookIssue` (`:904`), and `updateSaleLineStatus` (`:966`) find inputs in the supplied data bundle. Construct complete selected-ID contexts in their expected shape. Never pass page arrays as that bundle.
- `createStockCountAdjustment` (`:1070`) uses the supplied `expectedQuantity` directly. The displayed quantity must be an authoritative all-time balance; re-read the selected textbook/location balance before submitting a count. Preserve negative stock issuing behavior; do not introduce a shortage rejection.
- Purchase changes update the order plus individual lines and inspect existing linked stock moves. Do not substitute a synthetic case ID for real order/line IDs, or remove member IDs needed for the existing lifecycle actions.
- `upsertMonthlyClosing` (`:1183`) recomputes from raw stock moves. Passing a closing-page array or a single detail page silently stores incorrect settlement totals.

For closing, use a server aggregate for month/subject preview and a separately numbered movement detail read. To preserve the existing mutation calculation unchanged, an explicit save operation must first obtain a complete month/subject-scoped movement context and all referenced textbook/publisher/supplier/link data, then invoke the existing function. That context can be read in explicit chunks to completion; partial completion must fail, never masquerade as a complete collection. Do not load it for every list navigation. Making the mutation accept aggregate inputs instead is a separate interface change and must be identified as such.

Parity rules from `textbook-ledger.js`:

- Purchase movement classes: opening, purchase_receipt, return_in, transfer_in.
- Sale movement classes: sale_issue, return_out, transfer_out.
- Adjustment class: stock_adjustment.
- Team margin uses sale_issue only. Do not invent return-based margin reversal.
- Teacher-copy and Tips bookstore purchase cost are zero; external purchase cost is rounded 90% of sale price.
- Closing enrichment resolves publisher/supplier from current textbook defaults and publisher-supplier links, including existing normalized-name fallbacks.
- Keep English, Math, Science, and Other team buckets, received/supplier-payment differences, negative ending-quantity review, memo requirement, and stored-vs-recomputed mismatch reporting.

## 5. Export scope

Supplier order/return exports (`workspace:10282`) and MakeEdu billing (`:11556`) consume all currently filtered rows, independently of selected rows. The old term “visible” meant the complete filtered collection; it must not silently become current-page-only.

```ts
getTextbookPurchaseHandoff(
  filters: PurchaseFilters,
  kind: "order" | "return",
  options?: ReadOptions
): Promise<{
  groups: TextbookHandoffGroup[];
  sourceLineCount: number;
  complete: true;
}>;

getTextbookBillingHandoff(
  filters: SaleFilters,
  options?: ReadOptions
): Promise<{
  groups: TextbookHandoffGroup[];
  sourceLineCount: number;
  complete: true;
}>;
```

Return server-grouped document DTOs, or read explicit export chunks to completion before building the existing document. The normal numbered list must never traverse prior pages to simulate direct navigation. Preserve the existing PNG/PDF/clipboard rendering and preview-before-send boundary; export preparation does not authorize sending.

## 6. Drafts and settings

### Inventory and operations

`workspace:3094` currently deletes inventory count/memo draft keys absent from `data.inventory`. Remove this completeness assumption before page integration. Retain drafts by user/textbook/location; clear only on successful explicit save/discard or confirmed record deletion. Selection and drafts are separate stores. Clear current-page selection on leaving the page or changing scope; apply stale-request protection before committing page selection state. Keep dialog records in independent detail contexts so off-page deep links and open editors remain valid.

### Publisher/supplier settings

`textbook-supplier-settings-workspace.tsx:427` loads publishers, suppliers, all links, and textbook publisher references. `:770` deletes and recreates links for every loaded publisher. A page substitution into these arrays is unsafe.

- Keep `draftByPublisherId`, `draftBySupplierId`, and explicit deletion tombstones independent of page rows.
- Every edited publisher must have its complete ordered supplier-ID list.
- Rebuild links only for the intended saved owners, with unchanged priority and is_primary meaning. Off-page publisher/link records must not be deleted or renumbered.
- Publisher textbook counts use publisher_id first and publisher-name fallback; move this whole-source calculation to the server.
- Supplier linked-publisher names and counts must be authoritative, not derived from the current publisher page.
- Preserve lazy subsubject loading and its global duplicate/sortOrder/save assumptions.

There is no inspected domain constraint proving publishers/suppliers are a small complete catalog. An arbitrary row cap is not completeness. Use a complete small-catalog client adapter only if a genuine bound and complete retrieval are established; otherwise paging needs the explicit per-record draft/save boundary above. Likewise, do not slice a global reorder/upsert-all array without accounting for off-page order and edits.

## 7. SQL shape, migration chain, and authorization

Create a new CLI-generated `textbook_numbered_read_models` migration, not an invented timestamp filename. Prefer invoker private helper/view projections with separate versioned public domain endpoints. Do not create a universal privileged list RPC or modify existing mutations.

Query order:

1. Validate page >= 1, size in 10/15/20, allow-listed sort and filters, and dashboard role.
2. Compute narrow eligible keys; aggregate only what is necessary for filtering/order/parent formation.
3. Compute matching full total and clamp the requested page in the same scope.
4. OFFSET/LIMIT narrow parent keys.
5. Enrich only selected parents with display relations/member data.

Inventory/quality filters inherently need some aggregation before paging; do not pretend all work can occur after key selection. Do not serialize all historical movement rows. Sorts end with a unique ID/composite key; stock history uses `(event_at DESC, kind, id)`. Reuse `dashboard_private.ko_numeric` where appropriate and verify exact display parity. Random OFFSET is not constant time.

Local ordered-chain evidence:

- `20260429110000_textbook_management.sql`: textbook operations table schema, authenticated SELECT policies, admin/staff write policies, ledger and reference indexes.
- `20260429143000_textbook_publisher_supplier_settings.sql`: publisher-level supplier links, link RLS.
- `20260430150000_textbook_purchase_request_free_title.sql`: free-title request support.
- `20260501100000_textbook_taxonomy_settings.sql`, `20260714104301_textbook_taxonomy_arrays.sql`, `20260722110000_science_classes_and_textbooks.sql`: taxonomy/science schema evolution.
- `20260623111146_textbook_teacher_copy_scope.sql`: student/teacher copy_scope fields, checks and indexes, sale teacher fields.
- `20260808172743_rls_policy_initplan_consolidation.sql`: later active textbooks policies; authenticated SELECT, admin/staff/teacher writes. Do not infer textbook master write roles from the earlier management migration alone.
- `20260813053000_textbook_teacher_request_access.sql`: final local `create_textbook_request_v1` definition. Server-owned requester, admin/staff/teacher role check, invalid-input `22023`, permission `42501`, public/anon execute revoked.
- `20260814011752_management_page_reads.sql` and subsequent academic/operations scoped reads contain related management/picker/detail APIs, not the required operations inventory/closing numbered reads.

New management operations reads should explicitly admit admin/staff; request reads admit admin/staff/teacher and do not expose management aggregates through the request projection. Preserve RLS via security invoker and explicit function grants/revokes. Do not use SQLSTATE 40001 for validation. Keep existing cursor APIs compatible.

Existing useful movement indexes include `(textbook_id, location_id, moved_at)` and `(textbook_id, copy_scope, location_id, moved_at)`. Decide additions only after authorized first/middle/final-page EXPLAIN evidence. This audit did not run DB queries or EXPLAIN.

## 8. Smallest independently verifiable delivery units

1. Extract pure read-model parity rules to `textbook-read-model.js`/`.d.ts` and types to `textbook-read-types.ts`; preserve existing ledger tests.
2. Add read-only SQL page/summary/detail functions and pgTAP fixtures, including grouping and authorization tests.
3. Implement `textbook-read-service.ts` with exact projections, abort propagation, existing timeout/no-retry boundaries, and explicit missing-RPC errors rather than incomplete fallback.
4. Add `use-textbook-numbered-data.ts` for tab-scoped page state, retained prior rows, matching-count scope, clamp/retry/back navigation, and independent contexts/drafts.
5. Integrate workspace renderers and then publisher/supplier settings with safe draft ownership. Remove full-load list dependencies only as their consumers migrate.
6. Verify SQL, adapter, ledger parity, and actual desktop/mobile behavior separately.

Required regression cases:

- Student/teacher purchase pair crossing the page boundary; duplicate same-scope lines; cross-order current grouping; inactive/missing/unregistered textbook references.
- Eleven or more sale-history groups: count groups, not lines or sale records.
- Stock moves on other history pages do not change a textbook's balance; zero/negative/teacher quantities and valuation remain correct.
- Duplicate master and billable sale records exist outside the loaded page; checks still catch them.
- Month/subject closing matches the complete legacy ledger, including Science, teacher copies, external discount, transfers/returns, and memo requirement.
- Supplier/return/MakeEdu exports preserve all-filter scope and do not issue provider sends.
- Inventory draft survives page/filter/return; current-page selection does not expand; open detail remains valid off page.
- Settings save does not delete/reorder off-page links or lose drafts; owner supplier order remains complete.
- Arbitrary pages, no static duplicate/omission, final-page deletion/clamp, unknown/stale count, cancellation, failed-page retry, invalid input SQLSTATE, teacher restrictions and anon denial.
- Existing tests to extend: `tests/textbook-ledger.test.mjs`, `tests/textbook-workspace.test.mjs`, `tests/textbook-management-schema.test.mjs`, `tests/textbook-settings-lazy-taxonomy.test.mjs`, taxonomy schema/array tests, and teacher request pgTAP coverage referenced by the schema tests.
- Rendered 1440×768/900/952 and 390×844 checks per approved spec, including all ten page buttons, complete multiline content, accessible pager/header, and no horizontal document overflow.

## Evidence boundary

This is a source/migration audit only. No code, migration, index, runtime, database, browser, deployment, or provider changes were made. No tests or query plans were executed. The signatures above are proposed interfaces, not evidence of implemented endpoints. Earlier loading-performance memory was used only to locate the full-load path; all domain findings above were checked against current local source.
