# App-wide Numbered Pagination Design

**Status:** User-specified ten-page block behavior recorded on 2026-08-31; written design ready for review before implementation.
**Scope:** Shared pagination UI and behavior for administrative record lists, with domain-specific bounded page reads.
**Not authorized by this design:** Remote migration application, deployment, provider activation, notification sends, or changes to domain mutations.

## 1. User-facing contract

Replace record-list `다음 N건` / `더 보기` controls with one common numbered pager based on official shadcn/ui Pagination, using this project's Radix/new-york components, Lucide icons, semantic colors, and existing blue primary color. Do not replace the table engine or upgrade TanStack Table merely to adopt the current documentation examples; this application uses v8.

### Fixed blocks of ten page numbers

- Initially display existing page numbers from `1` through `10`.
- Clicking a number navigates directly to that page.
- Single Previous/Next arrows move exactly one page, not a whole block.
- At page 10, Next selects page 11 and changes the displayed numbers to 11–20.
- At page 11, Previous selects page 10 and restores the displayed numbers to 1–10.
- The same rule applies at every ten-page boundary.
- Double First/Last arrows select page 1 / the final page in the entire filtered result, not the first/last page of the current block.
- Do not show ellipses, sliding windows centered on the current page, or a page-number input.
- The final block contains only existing pages. For 26 total pages it displays 21–26.
- On narrow screens, wrap the number controls in reading order; keep every existing number in the current block selectable. Do not hide numbers or introduce horizontal page overflow.

For a nonempty result:

```ts
totalPages = Math.ceil(filteredTotal / pageSize)
currentPage = Math.min(Math.max(requestedPage, 1), totalPages)
blockStart = Math.floor((currentPage - 1) / 10) * 10 + 1
blockEnd = Math.min(blockStart + 9, totalPages)
```

Empty results show `0건`, no numbered buttons, and disabled navigation. The request state remains one-based (`page = 1`); never send page 0 to a service. While the total is unknown, show a loading state rather than inventing zero or deriving a total from currently loaded rows.

### Shared list behavior

- Keep automatic 10/15/20 rows, a ten-row minimum, and the existing per-list manual-size preference. Page-number block size is always ten and is independent of rows per page.
- Show total count and displayed row range for the entire active filtered result.
- Keep the pager outside the desktop table scrollport; preserve sticky headers and complete multiline content. Mobile card counterparts consume the same page result.
- Search, filters, tab, sort, or page size changes reset to page 1 atomically with the new request scope.
- On refresh/mutation, retain the current page when valid. If the last page disappears, revalidate the total and load the new final valid page.
- Back navigation and returning from a record restore the list's filters, sort, page, and appropriate scroll position. A detail deep link must work even when that record is not in the loaded page.
- Page changes replace rows rather than append them. Retain old rows while the request is pending, but do not label them as the new page before success. Failed navigation retains the displayed page and offers retry.
- Cancel obsolete requests and ignore stale results/counts. A count is usable only for the same authorization, list, filters, and sort scope as the rows.
- Selection means current-page selection. Clear selection when leaving a page or changing its scope; never silently turn it into all-filtered-results selection.
- Preserve unsaved per-record edits/drafts independently of the page. If an existing editor cannot safely retain them, use its unsaved-change guard before navigation rather than discard them.
- Keep existing export scope. All-filtered exports, aggregate quantities, balances, and inventory must not accidentally become current-page-only calculations.

## 2. Commonality boundary

Share the pager, block calculation, page validation, state transitions, query-scope rules, accessibility, and tests. Keep domain filters, row rendering, and authorized query adapters local to each feature. Do not create one universal table that absorbs every workflow or one generic privileged database endpoint.

The common read contract is a one-based page request with a validated 10/15/20 page size, stable allow-listed sort, and domain filters. The result supplies page rows, the displayed page, page size, and a full-filter total. Where a total arrives separately, expose it as pending until its matching request completes; initial rows need not wait for heavyweight statistics.

Small catalog lists may use a client adapter only when the underlying complete collection is explicitly bounded and known complete. A truncated or accumulated collection is not an authoritative complete result.

## 3. Server paging and performance

Current keyset-only APIs cannot jump directly to an unseen numbered page. Do not simulate a jump by downloading every preceding page, preload every record, or compute total pages from loaded rows.

Add versioned page-index read APIs where needed while preserving deployed cursor API compatibility. Use the same authorized filters for page selection and total count. Require a deterministic order ending in a unique identifier.

Select the target page's parent IDs/sort keys before expensive relation enrichment. Where OFFSET is used for random access, apply it to the narrow filtered key set and measure first/middle/final-page plans; large offsets still have a scan cost and must not be described as constant time. Index changes require execution-plan evidence. Related comments, events, students, inventory details, and other enrichment are restricted to the selected page or explicitly requested detail.

Retain existing timeout, AbortSignal, no-automatic-retry, RLS/ACL, and authentication boundaries. Validate invalid page/size/filter inputs with the appropriate existing invalid-input contract; do not use SQLSTATE 40001 for domain validation. Verify final active migration definitions and pgTAP evidence before any database-backed adapter is considered complete.

## 4. Applicability inventory

| Area | Record-list surfaces | Existing gap / migration boundary |
|---|---|---|
| Management | Student and class lists; management textbook list where used | Cursor-based management reads plus loaded-row client pagination. Full-filter stats exist; numeric totals and page-index reads must reach the pager. |
| Operations tasks | Tasks, word retests, registration, transfer, withdrawal | Shared OpsTaskWorkspace and cursor v1/v2 APIs. Full-filter total already exists. Replace accumulated rows and remove registration's additional 40-record render-window load-more. Registration page units remain parent cases, not subject tracks. |
| Makeup requests | Desktop request table and mobile mirror | Currently reads all requests/events and filters in memory. Move the full existing filter/sort contract to page reads and restrict event loading. |
| Approvals | Each approval workflow tab's record list | Currently loads requests/comments/events broadly. Count and page under identical tab/permission predicates; retain direct authorized detail access. |
| Academic and class planning | Curriculum/class-progress list and class-schedule/lesson-design entry list | Existing 30-row keyset RPCs contain full-filter totals but lack random-page inputs. Keep selected-class lesson detail separate. |
| Textbook operations | Master, requests, orders/receipts, sales/history, inventory/history, monthly closing | Current 17-table full-load model requires dedicated page projections plus authoritative summaries, counts, lookup data, and detail reads. Preserve stock/settlement/duplicate-check/export semantics. |
| Settings and auxiliary record tables | School/classroom/term/period and supplier/publisher management, teacher audit/history and other administrative record lists | Reuse the common pager through bounded client or server adapters as appropriate. Do not mistake a row limit for completeness. |

Explicitly exclude temporal/layout matrices: weekly timetable, calendar/agenda range navigation, annual school-by-month board, single-class lesson timeline, and the finite notification-rule configuration matrix. These use date/range or configuration navigation, not record pagination. Search pickers are separate controls; existing independently bounded picker contracts are not changed just because they have a load-more control.

## 5. Delivery slices and completion rule

1. Shared shadcn pager, pure block/state rules, accessibility, and student/class server-page integration.
2. Shared operations-task adapter and all five task-owned routes, including registration's nested render window and word-retest selection.
3. Makeup, approvals, curriculum, and class-planning list adapters.
4. Textbook read-model pages/aggregates/details and its pageable tabs; settings/auxiliary record-list coverage.
5. App-wide audit enforcing that every in-scope record list uses the common contract and no list retains an accumulated-load control.

Each slice must retain a working workflow and its domain-specific tests. Finishing one slice does not mean app-wide completion. Database migration application and production deployment remain separate, explicitly authorized steps; missing page APIs must not silently fall back to incomplete cursor semantics.

## 6. Required evidence

- Pure block cases: totals 0/1/9/10/11/20/21/26 pages; transitions 9→10, 10→11, 11→10, 20→21, First, Last; partial final block; no out-of-range links.
- Separate row-count cases for page sizes 10/15/20; row size never changes the ten-number grouping rule.
- State cases: scope reset, refresh retain/clamp, invalid URL page, empty result, matching/stale total, cancelled requests, failed-page retry, back/detail return, current-page selection, and unsaved drafts.
- SQL cases: authorized full-filter total, arbitrary-page retrieval without intermediate reads, deterministic no-duplicate/no-omission static fixtures, final-page deletion, invalid parameters, and RLS/ACL.
- Workflow cases: registration parent counts, word-retest bulk scope, makeup existing combined filters, approval tabs/detail access, textbook inventory/settlement/export correctness.
- Rendered checks: desktop 1440×768/900/952, mobile 390×844, all ten numbers selectable, active/disabled/focus states, header/pager access, page-boundary transitions, and no horizontal document overflow.
- Distinguish unit/build/SQL/browser/production evidence. The previous localhost Browser URL-policy blocker does not authorize a browser-policy workaround or a claim that visual QA passed.

## References

- shadcn/ui Pagination: https://ui.shadcn.com/docs/components/radix/pagination
- TanStack Table v8 controlled/manual pagination: https://tanstack.com/table/v8/docs/guide/pagination
- PostgreSQL LIMIT/OFFSET ordering and cost: https://www.postgresql.org/docs/current/queries-limit.html
