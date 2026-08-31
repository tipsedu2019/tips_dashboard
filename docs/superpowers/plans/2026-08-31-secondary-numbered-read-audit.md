# Secondary Numbered Read Audit

**Date:** 2026-08-31  
**Status:** Read-only implementation input for the approved app-wide numbered-pagination design.  
**Scope:** Makeup requests, approvals, academic curriculum list, and class-schedule list only.

## Guardrails carried into implementation

- Add page-index reads; retain deployed cursor reads and existing mutation RPCs.
- A page response must carry `rows`, one-based `page`, `pageSize` (`10 | 15 | 20`), and `totalCount` produced from the identical authorized filter scope. Do not derive a total from rows loaded in the client.
- All new database reads remain `security invoker`, authenticated-only, and subject to existing RLS. Do not use `SECURITY DEFINER` to make pagination work.
- Apply offset/page selection to the narrow, deterministically ordered parent key relation before expensive child enrichment. Every order ends in the parent ID.
- Keep direct authorized detail reads, form/catalog reads, exports/aggregate semantics, and unsaved drafts independent of page replacement.

## 1. Makeup requests

### Current client authority

- Workspace: `src/features/makeup-requests/makeup-request-workspace.tsx`.
- Outer view predicates (`MakeupRequestView`):
  - `mine`: participant and request statuses;
  - `approvalPending`: participant or manager, `approval_pending`;
  - `makeupPending`: participant or manager, `makeup_pending`;
  - `refundPending`: participant or manager, `refund_pending`;
  - `closed`: closed statuses.
- `MakeupRequestDataTable` then applies subject, teacher, period (`all | today | week | month | custom`), one selected-column text filter, and a sortable table column. Period matching uses both cancel date and makeup-slot dates. Preserve that exact combined semantics on the server.
- DTO authority: `src/features/makeup-requests/makeup-request-service.ts` exports `MakeupRequest`, `MakeupRequestEvent`, and `MakeupRequestWorkspaceData`; retain `MAKEUP_REQUEST_LIST_SELECT` for the list row projection.

### Proposed page contract

```ts
type MakeupRequestPageFilters = {
  view: "mine" | "approvalPending" | "makeupPending" | "refundPending" | "closed";
  subject: string | null;
  teacher: string | null; // existing id:<teacherCatalogId> or name:<teacherLabel> wire value
  period: "all" | "today" | "week" | "month" | "custom";
  periodStartDate: string | null;
  periodEndDate: string | null;
  searchColumn: MakeupRequestTableColumnKey | null;
  search: string;
  sort: { columnKey: MakeupRequestTableColumnKey; direction: "asc" | "desc" } | null;
};
type MakeupRequestPage = {
  rows: MakeupRequest[];
  page: number;
  pageSize: 10 | 15 | 20;
  totalCount: number;
  viewCounts: Record<MakeupRequestView, number>;
};
```

Add an authenticated `security invoker` RPC such as:

```sql
list_makeup_request_numbered_page_v1(
  p_filters jsonb,
  p_page integer,
  p_page_size integer
) returns jsonb
```

Validate filter keys, dates, column allow-list, directions, one-based page, and size with `22023`. Derive the exact event-dependent sort/search values (`revisionRequestedAt`, approval/rejection/cancellation times and notes) in the filtered key relation before ordering. Order must end with `request.id`.

### Active table/RLS and boundaries

- Base tables: `public.makeup_requests`, `public.makeup_request_events` from `20260706102047_makeup_requests.sql`; status/request-kind constraints are subsequently updated by `20260707152220_makeup_request_flow_types.sql` and `20260708025405_makeup_request_refund_flow.sql`.
- RLS: request select is `makeup_requests_select_involved_or_manager`; events select through parent request. Later `20260721131903_assistant_word_retest_makeup_permissions.sql` adds restrictive assistant hard-deny policies. The new list must run under, not around, these policies.
- Selected-page enrichment only: events may be loaded for the returned request IDs. Full history belongs in a direct authorized request-detail read when a card/dialog is opened.
- Do not page the startup/form data: profiles, teachers, classes, classrooms, academic events, lesson sessions, selected-class schedule plan. Keep request mutation state, selected detail, deep links, collision checks, and unsaved request/revision dialogs independent.

### Existing tests

- `tests/makeup-request-workspace.test.mjs` covers loader projections and combined table filters.
- Add `tests/makeup-request-numbered-service.test.mjs`, `tests/makeup-request-numbered-pagination.test.mjs`, and `supabase/tests/makeup_request_numbered_page_test.sql` for direct arbitrary pages, full-filter count, event-derived sorts, RLS, empty/final pages, and invalid inputs.

## 2. Approvals

### Current client authority

- Workspace: `src/features/approvals/approval-workspace.tsx`.
- Tabs (`ApprovalView`): `mine`, `review`, `open`, `done`, `returned`; no independent table search/sort contract exists today.
- `loadApprovalWorkspaceData` in `src/features/approvals/approval-service.ts` reads all `approval_requests` (`updated_at DESC`) and then every related `approval_comments` and `approval_events`; request DTOs embed both arrays.

### Proposed page contract

```sql
list_approval_numbered_page_v1(
  p_view text,
  p_page integer,
  p_page_size integer
) returns jsonb
```

Return:

```ts
type ApprovalPage = {
  rows: ApprovalRequest[];
  page: number;
  pageSize: 10 | 15 | 20;
  totalCount: number;
  viewCounts: Record<ApprovalView, number>;
};
```

Use the current tab predicates and deterministic `updated_at DESC, id DESC`; count with the same tab predicate. Page request rows first, then load comments/events only for returned IDs. Add a direct `get_approval_detail_v1(p_id uuid)` (or equivalent local adapter) for an authorized deep link/edit/comment history outside the current page.

### Active table/RLS and boundaries

- Base tables/RLS originate in `20260523190000_approval_requests.sql`: `approval_requests_select_involved_or_admin`, plus child `approval_events_select_involved` and `approval_comments_select_involved` predicates. Preserve invoker/RLS authorization.
- Keep profiles and templates as independent catalogs; they power composer/recommendation behavior and are not approval-list rows.
- Preserve session-storage mutation idempotency attempts, composer/edit unsaved state, direct deep-link tab selection, and mutation RPCs (`create_approval_request_v2`, update/transition/delete/comment paths) independently of paging.

### Existing tests

- `tests/approval-workspace.test.mjs` is the existing workspace coverage.
- Add `tests/approval-numbered-service.test.mjs`, `tests/approval-numbered-pagination.test.mjs`, and `supabase/tests/approval_numbered_page_test.sql`; notification-adapter SQL tests are not list/read coverage.

## 3. Academic curriculum list

### Active read contract

- Client filters in `src/features/academic/academic-read-service.js` (`normalizeCurriculumFilters`): `periodId`, `search`, `status`, `subject`, `grade`, `teacher`, `classroom`, `viewMode`.
- Active migration and function: `20260814062437_academic_scoped_reads.sql`, `public.get_academic_curriculum_page_v1(p_filters jsonb, p_cursor_sort_key text, p_cursor_id uuid, p_limit integer default 30, p_include_scope_metadata boolean default true)`.
- The current function is authenticated, `security invoker`, validates the exact key set and requires `p_limit = 30`; it resolves the default period, returns 30+1 keyset rows plus matching `stats` and `filterOptions`.

### Required numbered seam

Keep v1 for deployed cursor clients. Add a versioned sibling:

```sql
get_academic_curriculum_numbered_page_v1(
  p_filters jsonb,
  p_page integer,
  p_page_size integer,
  p_include_scope_metadata boolean default true
) returns jsonb
```

Reuse the final v1 candidate/filter/stats/filter-options relations and canonical default-period behavior. Apply page offset only to the ordered narrow key set, then build the existing row DTO. Return `{ rows, page, pageSize, totalCount, stats, filterOptions, resolvedPeriodId }`; `totalCount` must be the same filtered candidate count. Validate page/size/metadata flag with `22023` and retain stable v1 ordering with a unique ID tie-breaker.

### Detail/draft boundaries

- Keep `get_academic_curriculum_detail_v1(p_class_id uuid)` separate. It is selected-class schedule/progress/textbook detail, not list enrichment.
- Replace accumulated `appendAcademicCurriculumPageIfCurrent` / `loadMore` only for `mode: "curriculum"` in `src/features/academic/use-academic-workspace-data.ts`.
- Do not alter timetable range mode, curriculum return-scroll state, lesson-design deep links, or details for a class outside page one.

### Existing tests

- `tests/academic-scoped-reads.test.mjs`
- `supabase/tests/academic_scoped_reads_test.sql`
- Extend with direct page N/no-intermediate-read, matching total, default-period continuity, stale/cancelled scope behavior, RLS, invalid parameters, and final-page deletion cases.

## 4. Class-schedule list

### Active read contract

- Client filters in `src/features/operations/operations-read-service.js` (`normalizeClassFilters`): `termId`, `search`, `subject`, `grade`, `teacher`, `syncGroupId`.
- Active migration/function: `20260814035710_operations_scoped_reads.sql`, `public.get_operations_class_schedule_page_v1(p_filters jsonb, p_cursor_sort_key text, p_cursor_id uuid, p_limit integer default 30)`.
- Current service uses 30+1 keyset rows and full-filter `{ total, active, draft }` stats with `filterOptions`; it is authenticated `security invoker` and current list tests guard against adding `schedule_plan` to list DTOs.

### Required numbered seam

Preserve v1 and add:

```sql
get_operations_class_schedule_numbered_page_v1(
  p_filters jsonb,
  p_page integer,
  p_page_size integer
) returns jsonb
```

Reuse the existing six-filter candidate relation and lightweight row projection. Page ordered parent keys before enrichment and return `{ rows, page, pageSize, totalCount, stats, filterOptions }`, where `totalCount` agrees with `stats.total`. Validate inputs with `22023`; retain stable sort plus class ID.

### Detail/draft boundaries

- Keep `get_operations_class_lesson_design_detail_v1(p_class_id uuid)` direct and selection-driven.
- Keep `get_operations_lesson_textbook_candidate_page_v1` separate; it is a bounded picker, not the class list.
- Preserve lesson-progress drafts, class mutation lifecycle tokens, public-cache invalidation, direct deep links, calendar mode, and annual board mode.
- Replace only the class-schedule branch of `src/features/operations/use-operations-workspace-data.ts`; do not change its calendar/annual range contracts.

### Existing tests

- `tests/operations-scoped-reads.test.mjs`
- `supabase/tests/operations_academic_scoped_reads_test.sql`
- `tests/continuous-class-schedule-service.test.mjs` and related `tests/continuous-class-schedule-*.mjs`
- Extend with direct arbitrary pages, identical count/filter scope, no `schedule_plan` list leak, detail outside page one, invalid inputs, RLS, stale-page rejection, and final-page clamp after deletion.

## Shared implementation hooks already present in the worktree

- `src/lib/numbered-pagination.ts`
- `src/components/data-table/data-table-pagination.tsx`
- `src/hooks/use-data-table-page-size.ts`

Use those shared pager primitives; keep each domain's filters, DTO adapter, query, detail loaders, and mutations local.
