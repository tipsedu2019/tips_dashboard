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
- For each new bounded RPC, extend the foundation's explicit numbered-RPC query-budget registry only after strict10/15/20 final-SQL validation and local pgTAP proof; retain timeout/retry/authorization checks. The owning read-model task may update `src/lib/query-surface-budget.js` and its focused tests for that exact contract, never exempt arbitrary list RPCs or weaken unrelated guards.

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

Final-source preflight evidence: `docs/superpowers/plans/2026-08-31-task-workflow-preflight.md`. Its contract corrections are incorporated below; verify definitions have not drifted before implementation.

## Task 1: Authorized numbered task read model

**Status:** Complete at `31b3c2b1` after Task1 spec/quality review and R1 scoped fix re-review. Exact Node/SQL/evidence limits are recorded in `docs/qa/2026-08-31-numbered-pagination.md`; this does not complete Task2 UI or Task3 verification.

**Files:**
- Create migration named `ops_task_numbered_pages` through CLI.
- Create `supabase/tests/ops_task_numbered_pages_test.sql`.
- Create `src/features/tasks/ops-task-numbered-service.ts`.
- Modify `src/features/tasks/ops-task-service.ts` only to expose pure shared row/filter validation and mapping where needed; retain cursor readers. The numbered list must not call workspace/catalog hydration.
- Create `tests/ops-task-numbered-service.test.mjs`.

**Interfaces:** Export `createOpsTaskNumberedReadService({supabase}).readPage({filters,page,pageSize,viewerId,signal})` returning `Promise<NumberedPage<OpsTask>>`. Add `list_ops_task_numbered_page_v1(p_type text,p_filters jsonb,p_page integer,p_page_size integer)` returning JSON `{rows,page,pageSize,totalCount}`. Sort remains inside the existing type-specific filter contract, not a second conflicting sort object.

- [ ] Read final active filter/source/list functions in `20260813234824_ops_task_page_reads.sql`, active stats wrapper/count-only registration source in `20260818083818_optimize_registration_task_stats.sql`, and completed-actor augmentation in `20260820150057_ops_task_completion_actor.sql`. Verify no later migration replaces these before editing.
- [ ] Build a predicate/order parity matrix before SQL changes. General includes general and textbook tasks, with existing requester/team/assignee/unassigned/inbox/focus semantics. Registration counts parent cases, not tracks or stats-byView buckets: compute the representative matching track using the existing consultation-waiting/phone-ready/track-id priority, then include every authorized sibling track with matching track first in the selected parent DTO. Withdrawal/transfer/retest selected-column search and sort need their existing formatted progress/checklist/status/score scalars before paging. Preserve Korean numeric collation, null order and final id tie-break; use the actual final ORDER BY expressions rather than infer ordering from cursor arity.
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
- [ ] Generate migration. Add strict guards around the existing validator for null/invalid enum values, invalid ISO dates and offset overflow, so malformed numbered inputs reliably raise22023 instead of leaking casts or passing SQL three-valued logic. Do not weaken existing cursor validation. Reuse shared predicates/sort expressions through a narrow authorized parent-key source, materialize count/page from the same eligible keys, then project selected parents only. An OFFSET wrapper around the old all-row JSON source, an outer id predicate on that set-returning function, or calling the old source once per page ID does not satisfy bounded enrichment. Return count even on empty page; no speculative indexes or SECURITY DEFINER. Preserve existing v1/v2 cursor APIs and stats wrapper behavior.
- [ ] Implement service with eight-second timeout, caller signal, retry(false), strict flat camelCase RPC row_data validation before the existing permissive DTO mapper, and strict filter/sort validation including direction membership. Keep comments/events/attachments unhydrated in list DTOs. Completed actor comes only from stored `ops_tasks.completed_by` and `_label`, never a fresh profile join or inferred viewer. `viewerId` scopes client state only: do not send a DB authority override. Leave detail and stats supplemental loading independent. Run new service tests and isolated SQL; report exact SQL capability gaps without claiming pass. Commit owned files as `feat: add numbered task workflow reads`.

## Task 2: All task-owned screens consume shared pagination

**Files:**
- Modify `src/features/tasks/ops-task-workspace.tsx`.
- Modify `src/features/tasks/registration-case-list.tsx`.
- Modify `src/features/tasks/ops-task-service.ts`, `src/features/tasks/ops-task-page-stats-cache.ts` and `src/features/tasks/registration-track-service.ts` only for client actor-scoped supplemental/cache invalidation and late-result guards; preserve legacy cursor defaults, calendar reads and mutation behavior.
- Create `src/features/tasks/use-ops-task-numbered-page.ts`.
- Create a focused `src/features/tasks/ops-task-list-navigation.ts` and matching navigation tests if needed for validated per-entry list restoration; no generic router or route-wrapper refactor.
- Create `tests/ops-task-numbered-pagination.test.mjs`.
- Update affected `tests/ops-task-service-loading.test.mjs`, `tests/ops-task-page-stats-cache.test.mjs`, `tests/ops-task-workspace.test.mjs`, registration cache/list and word-retest tests.

**Interfaces:** `useOpsTaskNumberedPage({viewerId,viewerRole,filters,enabled,restoredPage?,restorationKey?,onPageCommit?})` owns the shared controller and page-size preference `ops-task:<taskType>`, exposes displayed `NumberedPage<OpsTask>` fields, `loading,error,goToPage,retry,refresh,pageSizeMode,setPageSizePreference`. Optional `restoredPage:number` plus `restorationKey:string` is an edge-triggered restoration command; `onPageCommit({scope:string,page:number,pageSize:DataTablePageSize})` fires for an accepted successful page, not a requested/failed target. The workspace owns URL/history parsing/writes; the hook does not write URLs or listen for popstate. `viewerRole` is the resolved existing Auth role and scopes client state only; it is not a DB authority argument. The workspace keeps catalog, registration-runtime and form state independent; compose displayed rows into existing `OpsTaskWorkspaceData.tasks` rather than append.

- [ ] Write RED real controller/hook tests for page11 one-request access, stale/cancelled page rejection, old displayed page on navigation error, same-page refresh/clamp, and filter+page1 atomicity. Exercise route/type/view changes and viewer switch clearing rather than relying on source regex.
- [ ] Exercise a numbered RPC response through the actual hook/DTO/workspace path to rendered row order, with literal descending, natural numeric and secondary-tie examples. A table test supplied with pre-normalized rows does not prove server order survived intermediate model helpers. Keep server-selected order unchanged and retain local sorting only in explicitly complete fixture/legacy modes.
- [ ] Include resolved actor role in the workspace session key, numbered controller and cache namespace; the current outer session is keyed only by user ID. Clear retained rows/details/metadata and cancel old requests on same-user role change as well as logout/user switch. Keep queries disabled until resolved auth is ready. Existing development fixture adapters remain explicit and must not route fixture authority through production DB calls.
- [ ] Cover the actual supplemental cache seams, not just the React key: cursor memory/persisted registration snapshots, stats values and in-flight requests, non-registration and registration options, registration case and class details. Give these reads an optional client-only actor scope or invalidate them before new-scope access with a generation that also blocks late cache writes; preserve legacy callers' default behavior. A values-only stats `clear()` is insufficient. Preserve the existing registration cache-clear cascade and its generation guards. Guard stats/catalog/detail/observation UI completions by actor epoch. Global schema/runtime capability probes are not role-sensitive row caches and stay unchanged; only their UI completion ownership is gated.
- [ ] Add real-consumer auth regressions: same-ID staff→teacher with delayed page/stats/catalog/detail work, actor A page11→logout→B, and unresolved profile→resolved login. Assert immediate old-data/action clearing, no anonymous RPC, no shared previous-role in-flight stats and no late rows/facets/dialog/track/appointment/observation restoration. Word-retest drafts persist across pages within one actor scope, but clear on actor/role change; page selection never crosses a page. Numbered total always comes from its own response, not supplemental stats.
- [ ] Preserve existing `taskPageFilters` construction as the authority for general queue/sort, registration view/consultation owner, withdrawal/transfer column filters/sort and word-retest queue/branch/date/teacher/class/sort. Replace cursor state/loadMore with the numbered hook and common pager outside scroll areas. Remove page-local filtering/sorting only where it duplicates server selection; do not change authorization-derived transformations.
- [ ] Replace the old `data.page` cursor-presence server-selection flag with an explicit numbered-server-page marker. Do not fabricate cursor metadata or accidentally reactivate local filtering/sorting. Cache by viewer, full filters, page and size. Keep word-retest facets/options independent of page rows; pending metadata must not reset a valid selection merely because it is absent from the new page.
- [ ] Keep URL/back/detail return state scoped to route and task type without overwriting existing dialog/track/appointment parameters. Preserve direct `loadOpsTaskById` and registration case detail. Refetch page after relevant mutations; no intermediate page loads. Catalog hydration and tab counts must not be truncated to current rows.
- [ ] Restore full list controls/sort/page/appropriate scroll on Back and detail-return remount, not only URL-owned filters. Preserve existing URL-owned names; keep currently local-only list controls in a validated versioned actor+role+workspace-bound `history.state` snapshot, never row DTOs or unsaved drafts. Merge existing Next/history state in relevant push/replace calls. List page keys may be `taskPage`/`taskPageType`, with page writes using replace, not a new history push. Consume restoration only on initial entry or an actual restoration event; self-written URLs must not create restore loops. Gate the numbered read until restored controls and page settle atomically, avoiding page1 then restored-page. Existing local filter changes reset page1 without re-consuming a stale restore command. Child-owned operation-table controls may receive a narrow restoration input/key so rendered controls and server filters agree.
- [ ] Exact observation deep links remain the existing five-key `{taskId,trackId,appointmentId,observationId,view=calendar}` URL, with no page/filter parameters appended and no relaxed parser. Keep list return context only in its separate history snapshot. Registration dirty-Back/cancel/Forward guard decides before restoration writes. Add real consumer tests for nondefault local filter+sort+page Back/detail return, self-write-loop rejection, wrong-actor/role snapshot rejection and the exact observation/dirty-Back boundary. Numbered general mode preserves the complete server-selected general+textbook rows; any legacy fixture-only local exclusion stays separate.
- [ ] Preserve registration appointment calendar's independent date-range reader in `registration-track-service.ts` and calendar component. The legacy generic `loadCalendarRows(visibleTasks)` render branch is unreachable for the current WorkspaceKey union/routes: registration, withdrawal, transfer and word_retest are handled first, while its condition excludes the remaining todo case. Do not add a new calendar API for that dead branch or perform unrelated dead-code cleanup; recheck reachability only if this implementation changes the workspace union/render ordering.
- [ ] Remove `REGISTRATION_CASE_INITIAL_RENDER_LIMIT`, `windowState`, local slicing and its additional `더 보기`; render every parent case delivered by the server page. Test that two tracks in a case count as one page item. Keep desktop and mobile mirrors on the same items.
- [ ] Clear word-retest selected task IDs on successful page/scope change. Keep `wordRetestScoreDrafts` by task ID across pagination; test draft restoration on return and current-page-only bulk targets. Guard any existing dirty editor before navigation using the existing workflow guard. Do not alter send/status/delete operations.
- [ ] Render DataTablePagination with total from matching numbered response, not stats fallback or `visibleTasks.length`. Keep stats as independent supplementary data. Update fixture modes to use an explicitly complete fixture adapter; production must never use a full-array fallback.
- [ ] Run all task-related affected tests, focused lint/typecheck and foundation regression; run build at the slice gate. Commit as `feat: paginate all task workflow lists`.

## Task 3: Slice verification and coverage evidence

**Files:** Update `docs/qa/2026-08-31-numbered-pagination.md` with task-owned route evidence. Repair only the account/profile/JWT fixture prerequisites in `supabase/tests/ops_task_completion_actor_test.sql` as described below. Add bounded diagnostic execution-plan evidence to `supabase/tests/ops_task_numbered_pages_test.sql` using its existing synthetic fixture and actual authenticated actor; do not weaken existing assertions or change production SQL.

**Interfaces:** Record coverage for `/admin/tasks`, `/admin/word-retests`, `/admin/registration`, `/admin/transfer`, `/admin/withdrawal`, exact commits, unit/SQL/build/browser statuses and required RPC migration.

- [ ] Repair the reproduced legacy actor fixture pre-assertion FK failure: seed the three matching synthetic `auth.users` rows before its profile insert and upsert the signup-trigger-created profiles' intended role/name/login ID. Keep actor JWT claim representations consistent through the existing actor switches/no-JWT phase. Preserve all16 assertions and the existing historical-backfill setup; do not change production triggers, add new trigger suppression or weaken assertions. Run it alongside the numbered/cursor final-only SQL. The historical test uses privileged DML and existing transactional trigger toggles, so label it actor/backfill compatibility evidence, not new RLS proof; numbered SQL separately covers authenticated/anon boundaries. Report any remaining real failure rather than broadening the fixture repair silently.
- [ ] Verify no in-scope task record list retains `다음30건`/`더 보기`, registration parent count and completed actor tests pass, and old cursor contracts remain compatible.
- [ ] Run the new and affected task/registration/retest regressions together with shared controller/pager/preferences and query-budget regressions. Run TypeScript and focused lint, recording existing warnings separately. Build only in the resynced isolated never-served source copy; preserve the live checkout's `.next/BUILD_ID` hash. Reuse an exact-current Task2 build only if no build input changed afterward, and state that reuse explicitly.
- [ ] Capture first/middle/final-page execution-plan evidence in the authorized isolated local fixture, preserving actual auth/filter/size and reporting fixture size and warm/cold context. The spec requires measuring the narrow OFFSET path: distinguish public-function wrapper plans from any observed nested eligible-key/projector plan; do not infer nested loop counts, constant-time offsets or production latency from wrapper-only output. No speculative index or remote load test.
- [ ] Verify rendered desktop/mobile when Browser access is permitted and backend RPC capability exists; do not bypass prior localhost policy denial or claim mocks prove live requests.
- [ ] Review the entire slice diff independently, resolve findings, commit evidence, and proceed to the remaining domain plan without a new approval prompt.
