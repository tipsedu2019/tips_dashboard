# Task Workflow Numbered Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the shared numbered pager to tasks, word retests, registration, transfer, and withdrawal with direct bounded reads.

**Architecture:** Keep OpsTaskWorkspace and its domain row components. Add an authenticated page-index read API using the existing validated task filters and stable sorts. Reuse the foundation pager, page-size hook and request controller, preserving independent catalogs, metadata, drafts and detail reads.

**Tech Stack:** React19, Next16, Supabase/PostgreSQL, node:test, pgTAP, existing shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-31-app-wide-numbered-pagination-design.md`

## Global Constraints

- Page-number blocks contain ten existing numbers: 1–10, 11–20, 21–30. No ellipses or direct page input. Single arrows move one page; double arrows select global first/last.
- List page size is10/15/20, minimum ten; use shared DataTablePagination and useDataTablePageSize.
- Page/count use identical authorized filters, stable sorting ending in id, and no all-row/intermediate-page fallback.
- Preserve old rows/page/count together on pending/error; reject stale results, abort superseded requests, reset page on scope changes and clamp after mutation shrink.
- Registration page units are parent cases, not subject tracks. Preserve the existing registration authority/runtime, deep-link and unsaved application guards.
- Word retest selection is current-page only; score drafts remain independent of displayed-page replacement. Never turn bulk action scope into all matching rows.
- Preserve RLS/ACL, completed-actor snapshots, detail-by-id access and existing domain mutations. No remote migration, push, deployment or sends.
- Existing date-range calendar/appointment views and search pickers keep their separate contracts; generic list pagination must not omit calendar events.
- Use production behavior tests, not source-only assertions. Generate migration filenames with the installed Supabase CLI. Distinguish SQL, unit, build and browser evidence.

## Prerequisites and interfaces

Foundation plan must be reviewed before implementation. Consume:

```ts
type DataTablePageSize = 10 | 15 | 20;
type NumberedPage<T> = { rows:T[]; page:number; pageSize:DataTablePageSize; totalCount:number };
// src/lib/numbered-pagination.ts
// src/lib/numbered-page-controller.ts: createNumberedPageController<T>({loadPage,onChange})
// src/components/data-table/data-table-pagination.tsx: DataTablePagination
// src/hooks/use-data-table-page-size.ts: useDataTablePageSize(tableId)
```

Use existing `OpsTaskPageFilters`, `OpsTask`, `OpsTaskPageStats` from `src/features/tasks/ops-task-service.ts`; keep the discriminated filter union and its keys exactly.

## Task 1: Authorized numbered task read model

**Files:**
- Create migration named `ops_task_numbered_pages` through CLI.
- Create `supabase/tests/ops_task_numbered_pages_test.sql`.
- Create `src/features/tasks/ops-task-numbered-service.ts`.
- Modify `src/features/tasks/ops-task-service.ts` only to expose shared row/filter validation and scoped workspace enrichment where needed; retain cursor readers.
- Create `tests/ops-task-numbered-service.test.mjs`.

**Interfaces:** Export `createOpsTaskNumberedReadService({supabase}).readPage({filters,page,pageSize,viewerId,signal})` returning `Promise<NumberedPage<OpsTask>>`. Add `list_ops_task_numbered_page_v1(p_type text,p_filters jsonb,p_page integer,p_page_size integer)` returning JSON `{rows,page,pageSize,totalCount}`. Sort remains inside the existing type-specific filter contract, not a second conflicting sort object.

- [ ] Read final active filter/source/list functions in `20260813234824_ops_task_page_reads.sql`, active stats wrapper/count-only registration source in `20260818083818_optimize_registration_task_stats.sql`, and completed-actor augmentation in `20260820150057_ops_task_completion_actor.sql`. Verify no later migration replaces these before editing.
- [ ] Write and run RED service behavior tests, including literal request checks:

```js
const result = await service.readPage({ filters, page:11, pageSize:10, viewerId:'viewer-a', signal });
assert.deepEqual(calls.map(call => call.name), ['list_ops_task_numbered_page_v1']);
assert.deepEqual(calls[0].args, {p_type:filters.taskType,p_filters:filters,p_page:11,p_page_size:10});
assert.equal(result.totalCount, 260);
assert.equal(result.page, 11);
```

Also reject invalid size5/30, missing viewer, malformed rows/count/page, mismatched page size and missing RPC; assert no retry/cursor fallback and caller abort propagation.
- [ ] Write pgTAP fixtures for all five task types. Assert direct page11, exact parent registration total with multiple tracks per case, count/page consistency for every filter branch, stable ties and header sorts, last partial and empty pages, completed actor preservation, invalid-input SQLSTATE22023 and authenticated/anon/RLS boundaries. Keep no-send fixtures transactional.
- [ ] Generate migration. Validate inputs with existing private validator. Reuse shared predicates/sort expressions, extracting narrow authorized keys when the current JSON source would shape all rows. Keep required relation predicates before paging but restrict DTO/enrichment and completed-actor augmentation to selected parent IDs. Return count even on empty page; no speculative indexes or SECURITY DEFINER. Preserve existing v1/v2 cursor APIs and stats wrapper behavior.
- [ ] Implement service with eight-second timeout, caller signal, retry(false), strict response parsing and existing DTO mapping. Leave detail and stats supplemental loading independent. Run new service tests and isolated SQL; report exact SQL capability gaps without claiming pass. Commit owned files as `feat: add numbered task workflow reads`.

## Task 2: All task-owned screens consume shared pagination

**Files:**
- Modify `src/features/tasks/ops-task-workspace.tsx`.
- Modify `src/features/tasks/registration-case-list.tsx`.
- Modify `src/features/tasks/ops-task-service.ts` for numbered cache/options keys if required.
- Create `src/features/tasks/use-ops-task-numbered-page.ts`.
- Create `tests/ops-task-numbered-pagination.test.mjs`.
- Update affected `tests/ops-task-service-loading.test.mjs`, `tests/ops-task-workspace.test.mjs`, registration list and word-retest tests.

**Interfaces:** `useOpsTaskNumberedPage({viewerId,filters,enabled})` owns the shared controller and page-size preference `ops-task:<taskType>`, exposes displayed `NumberedPage<OpsTask>` fields, `loading,error,goToPage,retry,refresh,pageSizeMode,setPageSizePreference`. The workspace keeps catalog, registration-runtime and form state independent; compose displayed rows into existing `OpsTaskWorkspaceData.tasks` rather than append.

- [ ] Write RED real controller/hook tests for page11 one-request access, stale/cancelled page rejection, old displayed page on navigation error, same-page refresh/clamp, and filter+page1 atomicity. Exercise route/type/view changes and viewer switch clearing rather than relying on source regex.
- [ ] Preserve existing `taskPageFilters` construction as the authority for general queue/sort, registration view/consultation owner, withdrawal/transfer column filters/sort and word-retest queue/branch/date/teacher/class/sort. Replace cursor state/loadMore with the numbered hook and common pager outside scroll areas. Remove page-local filtering/sorting only where it duplicates server selection; do not change authorization-derived transformations.
- [ ] Keep URL/back/detail return state scoped to route and task type without overwriting existing dialog/track/appointment parameters. Preserve direct `loadOpsTaskById` and registration case detail. Refetch page after relevant mutations; no intermediate page loads. Catalog hydration and tab counts must not be truncated to current rows.
- [ ] Remove `REGISTRATION_CASE_INITIAL_RENDER_LIMIT`, `windowState`, local slicing and its additional `더 보기`; render every parent case delivered by the server page. Test that two tracks in a case count as one page item. Keep desktop and mobile mirrors on the same items.
- [ ] Clear word-retest selected task IDs on successful page/scope change. Keep `wordRetestScoreDrafts` by task ID across pagination; test draft restoration on return and current-page-only bulk targets. Guard any existing dirty editor before navigation using the existing workflow guard. Do not alter send/status/delete operations.
- [ ] Render DataTablePagination with total from matching numbered response, not stats fallback or `visibleTasks.length`. Keep stats as independent supplementary data. Update fixture modes to use an explicitly complete fixture adapter; production must never use a full-array fallback.
- [ ] Run all task-related affected tests, focused lint/typecheck and foundation regression; run build at the slice gate. Commit as `feat: paginate all task workflow lists`.

## Task 3: Slice verification and coverage evidence

**Files:** Update `docs/qa/2026-08-31-numbered-pagination.md` with task-owned route evidence.

**Interfaces:** Record coverage for `/admin/tasks`, `/admin/word-retests`, `/admin/registration`, `/admin/transfer`, `/admin/withdrawal`, exact commits, unit/SQL/build/browser statuses and required RPC migration.

- [ ] Verify no in-scope task record list retains `다음30건`/`더 보기`, registration parent count and completed actor tests pass, and old cursor contracts remain compatible.
- [ ] Verify rendered desktop/mobile when Browser access is permitted and backend RPC capability exists; do not bypass prior localhost policy denial or claim mocks prove live requests.
- [ ] Review the entire slice diff independently, resolve findings, commit evidence, and proceed to the remaining domain plan without a new approval prompt.
