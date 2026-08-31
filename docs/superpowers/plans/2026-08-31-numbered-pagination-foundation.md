# Numbered Pagination Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver reusable ten-number pagination controls and bounded numbered student/class list reads as the first independently verifiable app-wide slice.

**Architecture:** Share block arithmetic, accessible shadcn controls, page-size preferences and request-state transitions. Add a versioned management page-index RPC with authoritative filtered totals; preserve deployed cursor APIs and detail readers. Integrate it into the existing management table without rewriting its columns or workflow.

**Tech Stack:** React 19, Next.js 16.1.1, TanStack Table v8, Radix/new-york shadcn/ui, Supabase/PostgreSQL, node:test, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-31-app-wide-numbered-pagination-design.md`

## Global Constraints

- Page-number blocks contain ten existing numbers: 1–10, 11–20, 21–30. No ellipses or direct page input. Single arrows move one page; double arrows select global first/last.
- List page size is 10/15/20, minimum ten. Existing independent relationship/picker contracts remain unchanged.
- Total count represents the authorized full filtered result, never the loaded subset. Unknown count is not zero.
- Number clicks fetch their page without fetching intermediate pages or full datasets. Stable sorts end with id.
- Preserve previous rows on pending/error, abort superseded requests, reject stale rows/counts, reset page on filter/sort/size changes, and clamp after mutation shrink.
- Current-page selection only; preserve domain draft/export/mutation semantics and detail links.
- Keep original cursor RPCs compatible. Authentication/RLS/ACL/no-send stay intact. Do not apply remote migrations, push, deploy, or send notifications.
- Generated migration filenames come from the available Supabase CLI. Tests must execute production behavior, not merely grep source text.
- Work in `/Users/hyunjun/Documents/Codex/tips_dashboard` on the existing clean `codex/loading-performance` feature branch. Do not reset another branch, add unrelated worktrees, or use Browser-policy workarounds.

## Shared interfaces

```ts
export type DataTablePageSize = 10 | 15 | 20;
export type DataTablePageSizePreference = "auto" | DataTablePageSize;
export type NumberedPage<T> = {
  rows: T[];
  page: number;
  pageSize: DataTablePageSize;
  totalCount: number;
};
export type DataTablePaginationProps = {
  page: number; // displayed, successful page, 1-based
  pageSize: DataTablePageSize;
  totalCount: number | null;
  loading?: boolean;
  onPageChange: (page: number) => void;
  pageSizeMode?: "auto" | "manual";
  onPageSizeChange?: (preference: DataTablePageSizePreference) => void;
  ariaLabel?: string;
};
```

The exports live in `src/components/data-table/data-table-pagination.tsx` (component) and `src/lib/numbered-pagination.ts` (types and pure functions). Later domain plans consume these exact interfaces.

## Task 1: Shared ten-number pager and page-size preference

**Files:**
- Create `src/components/ui/pagination.tsx` via the official shadcn CLI after a dry run.
- Create `src/lib/numbered-pagination.ts`.
- Create `src/components/data-table/data-table-pagination.tsx`.
- Create `src/hooks/use-data-table-page-size.ts`.
- Create `tests/numbered-pagination.test.mjs` and `tests/data-table-pagination.test.mjs`.

**Interfaces:** Produces the shared interfaces above, `getNumberedPagination({page,pageSize,totalCount})`, and `useDataTablePageSize(tableId)` returning `{ready,pageSize,mode,setPreference,setAutoPageSize}`. `getNumberedPagination` returns `{page,totalPages,pages,rangeStart,rangeEnd,canPrevious,canNext}`; an unknown count gives `totalPages:null`, empty pages, disabled navigation. Empty results give totalPages0 and range0–0 while page remains1. The hook stores versioned manual10/15/20 per table; auto is default, exposes hydration readiness, estimates auto by viewport initially and accepts a measured override. Do not use list data in preference storage.

- [ ] Write failing behavior tests with literal cases, including these:

```js
assert.deepEqual(getNumberedPagination({page:10,pageSize:10,totalCount:260}).pages, [1,2,3,4,5,6,7,8,9,10]);
assert.deepEqual(getNumberedPagination({page:11,pageSize:10,totalCount:260}).pages, [11,12,13,14,15,16,17,18,19,20]);
assert.deepEqual(getNumberedPagination({page:26,pageSize:10,totalCount:260}).pages, [21,22,23,24,25,26]);
assert.equal(getNumberedPagination({page:50,pageSize:20,totalCount:21}).page, 2);
assert.equal(getNumberedPagination({page:1,pageSize:20,totalCount:null}).totalPages, null);
```

Also cover 0/1/9/10/11/20/21 pages, invalid page/size, manual5 rejection, hydration and preference storage exceptions. Render the real pager using the project's JSX-test/transpile utilities (or a small test-only TypeScript transpile helper) and React DOM/jsdom; assert numbers, aria-current, disabled boundaries, 10→11 and11→10 click callbacks, First/Last callbacks, no textbox, keyboard button semantics, and all numbers present in a wrapping group. Run before production code and record RED.

- [ ] Inspect official pagination with `npx shadcn@latest add pagination --dry-run`; install only this absent component, preserve Button/Select/theme and lockfile unless CLI demonstrably needs a dependency. Read generated source. Compose Pagination/PaginationContent/PaginationItem with native Buttons for disabled semantics; no fake `href="#"` navigation. Use existing semantic Button variants and Lucide ChevronsLeft/ChevronLeft/ChevronRight/ChevronsRight. Use a compact wrapping number group; existing active color, accessible Korean labels, row range and optional page-size Select (with SelectGroup).
- [ ] Implement the exact block arithmetic from the spec. Normalize invalid pages; validate pageSize without allowing zero/5/30 into new list requests. Clamp known-count out-of-range page; never manufacture unknown totals. Implement preference hook with cleanup and guarded browser storage access. No Supabase calls in this task.
- [ ] Run `node --test --experimental-strip-types tests/numbered-pagination.test.mjs tests/data-table-pagination.test.mjs`, focused ESLint, and TypeScript. Record GREEN. Commit only owned files with `feat: add shared ten-page pagination controls`.

## Task 2: Numbered management read model and executable service contract

**Files:**
- Create migration through CLI named `management_numbered_pages`.
- Create `supabase/tests/management_numbered_pages_test.sql`.
- Create `src/features/management/management-numbered-service.ts`.
- Create `tests/management-numbered-service.test.mjs`.
- Update isolated-db manifest/verification artifacts only using repository conventions needed to include the new migration.

**Interfaces:** Consumes `NumberedPage`/`DataTablePageSize` from Task1. Produces `createManagementNumberedReadService({supabase}).readPage({kind,filters,page,pageSize,sort,signal})` returning a NumberedPage of current management list DTOs. Sort is an allow-listed `{id:string,desc:boolean}`; include every currently actionable header or explicitly keep non-sortable headers disabled rather than sort page-local results. Produces authenticated `list_management_numbered_page_v1(p_kind text,p_filters jsonb,p_page integer,p_page_size integer,p_sort jsonb)` returning JSON `{rows,page,pageSize,totalCount}`. It must resolve the default class period using the existing resolver at the hook boundary; do not invent a separate default rule.

- [ ] Read the final active `list_management_page_v1`, `get_management_stats_v1`, Korean numeric collation and related tests. Write RED service tests that request page11 directly and assert one numbered RPC, exact filters/sort/size/page, timeout signal and retry(false), parse valid/malformed responses, no cursor fallback and no intermediary calls. Use a strict Supabase transport double, assert returned production DTOs and emitted request contract.
- [ ] Write pgTAP fixtures for student/class/textbook list branches, filtering, last-page count, ordered ties, arbitrary page11, invalid page/size/sort SQLSTATE22023, ACL/RLS and empty results. Keep auth helpers and no-send isolation consistent with existing management pgTAP tests.
- [ ] Generate migration via CLI. Preserve current cursor functions, RLS and grants. Extract/shared authorized predicate sources when needed to avoid divergent total/list filters; select narrow parent keys with deterministic sort and validated OFFSET/LIMIT before enriching only returned rows. Return full-filter count even for empty page. Do not use count-over-window as the only total source because out-of-range empty pages still need total. Do not add speculative indexes or SECURITY DEFINER.
- [ ] Implement read service with shared validation, caller-owned AbortSignal plus eight-second timeout, retry(false), typed response validation and explicit missing-RPC error. Do not catch malformed page data and present an empty success.
- [ ] Run focused service tests, TypeScript/ESLint and actual isolated pgTAP via the repository runner. If Docker/CLI capability blocks SQL execution, report exact blocker and retain unverified SQL status; do not claim migration QA. Commit code/test/migration with `feat: add bounded numbered management reads`.

## Task 3: Management UI numbered state and real server sorting

**Files:**
- Modify `src/features/management/use-management-records.ts`.
- Modify `src/features/management/management-page.tsx`.
- Modify `src/features/management/management-data-table.tsx`.
- Create `src/features/management/management-numbered-state.ts` if needed for executable async request tests.
- Create `tests/management-numbered-pagination.test.mjs`; update existing management behavior tests affected by replacing cursor accumulation.

**Interfaces:** Consumes Tasks1/2. Hook exposes displayed `{page,pageSize,totalCount,sort}`, `goToPage`, `setSort`, and existing detail/mutation/stat/filter state. ManagementDataTable accepts controlled server page/sort and renders DataTablePagination. Keep original APIs available to unrelated callers; migrate this page's list flow only.

- [ ] Write RED tests with deferred transports: page11 requested once without pages2–10; old page retained while pending/error; stale page/total rejected; filter+page reset atomic; refresh keeps valid page; delete-last-page clamps; arbitrary detail ID still loads independently; sort header changes server sort+page1, not just local loaded rows. Exercise an extracted production state/controller used by the hook rather than merely matching hook source.
- [ ] Change the hook's list execution to numbered reads while keeping independent stats/catalog/detail and mutations. Preserve canonical/default class period behavior, timed abort and stale scope protection. Add URL page/sort restore without overwriting unrelated detail/filter parameters. No effect may publish old page rows with the new page number.
- [ ] Set TanStack manualPagination/manualSorting for server lists, use totalCount rather than prePaginationRowCount for pagination, remove load-more/continuation and local accumulated-row page controls. Wire the shared pager. Preserve existing table-scroll bounds, auto measurement, per-kind manual preference and mobile cards. Selection clears on displayed page/scope change; existing explicit mutation confirmations remain.
- [ ] Run full relevant management tests, focused lint/typecheck/build and independent task review. Keep local production server's previous build until required DB capabilities are available; do not connect the new UI to missing remote RPCs merely to claim a visual result. Commit as `feat: use numbered server pages in management lists`.

## Task 4: Foundation verification and downstream handoff

**Files:** Update `docs/qa/2026-08-31-numbered-pagination.md`; preserve other plans' QA records.

**Interfaces:** Produces documented shared exports, commit IDs, test/SQL/browser evidence and remaining deployment prerequisites for subsequent task/academic/makeup/approval/textbook/settings plans.

- [ ] Run combined new/management tests, existing query-surface budget, TypeScript, full lint and production build. Record exact results; do not treat existing unrelated lint warnings as new failures.
- [ ] For actual rendered QA use the Browser skill only when access is permitted: student/class routes at1440×768/900/952 and390×844, 10→11 and11→10, last partial block, keyboard/focus, page restore and table scroll. Do not bypass the prior Browser URL-policy denial. If blocked, label browser evidence pending.
- [ ] Review all changes from this plan's starting SHA; resolve findings through implementer fix/re-review. Commit evidence separately. This finishes only the foundation, not the app-wide request; continue with domain plans without asking again.
