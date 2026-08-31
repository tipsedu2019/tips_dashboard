# Secondary workflow numbered-page preflight

Date: 2026-08-31. Branch observed: `codex/loading-performance`.
Scope: read-only source review of secondary plan Tasks 1/2, with bounded approval/makeup checks. No DB, network, browser, test execution, migration, production-source edit, or commit performed. Existing unrelated implementation changes were left untouched.

## Verdict

Academic and operations numbered reads are implementable without cursor/all-row fallback or schedule/detail mutation changes, but Tasks 1/2 are not yet a complete producer-consumer contract. Correct the page ordering, scope metadata, and operations sync-group facets below before implementing. Existing SQL aggregate formulas should remain authoritative; a bounded row payload does not mean all aggregate work can occur after LIMIT.

## Required Task 1/2 corrections

### 1. Preserve server order through the model layer (high)

Both proposed numbered adapters can return deterministic rows, but the existing UI builders sort those rows again:

- `src/features/academic/records.js:1089-1096`: curriculum sorts `term`, then displayed `title`, with nonnumeric Korean locale comparison. `:1445-1457` applies this even to `precomputedRows`.
- `src/features/operations/records.js:972-986`: class planning sorts route rows by displayed title with nonnumeric Korean comparison.
- SQL authority is full class name with `dashboard_private.ko_numeric`, then UUID ASC: academic migration `20260814062437_academic_scoped_reads.sql:416,549-553`; operations `20260814035710_operations_scoped_reads.sql:861,880-884`. Academic display title also strips a bracket prefix (`:560-561`), so sorting display titles is not equivalent.

Add both `records.js` files (and their declarations/tests if signatures change) to Task 2, or restore page input order by ID after DTO transformation. Do not change range/legacy model ordering globally. Test numeric names (`수업 2`, `수업 10`), bracketed names, different terms, and equal names spanning a page boundary. Neither list currently offers a sort control; retain this fixed SQL order rather than inventing a sort UI.

### 2. Specify operations sync-group facet semantics and producer (high)

The Task 1 payload `{stats:{total,active,draft},filterOptions:{syncGroups:[{value,label}]}}` cannot supply the current group's displayed member counts independently of a page.

- Workspace synthesizes one group membership per loaded class: `src/features/operations/class-schedule-workspace.tsx:2725-2730`.
- `src/features/operations/records.js:741-772` derives member counts/members from those loaded rows and suppresses groups with zero loaded members.
- Workspace uses this to render a group navigation bar, its `전체` count, and selects `group.members[0].classId` on click: `class-schedule-workspace.tsx:6347-6402`.

**Exact current scope:** this is not a term-only/base-scope facet. The RPC has already applied all six filters, including search/subject/grade/teacher and the selected `syncGroupId` (`operations migration:864-876`); the workspace then passes `filters:{}` to its model (`class-schedule-workspace.tsx:2858-2866`). Counts cover only the accumulated returned rows in that final filtered scope. Each class is credited to the one group chosen by the RPC (`operations migration:845-858`), not every membership. Groups are limited to the independently returned 200-option group catalog (`:937`) and zero-loaded-member groups are hidden. The `전체` chip also counts the final filtered loaded result, even with a selected group; it does not count the result with the group predicate removed.

Paging this unchanged makes groups disappear or their counts change on navigation. The minimal numbered-page correction is to lift these counts from accumulated rows to the **same final six-filter candidate relation**, preserving single chosen-group assignment, catalog group order, and the existing 200-option catalog boundary. Do not redesign the chips to ignore search/subject/grade/teacher/selected group; that would be different facet semantics. Return, for example, `syncGroupCounts:[{groupId,memberCount,representativeClassId}]`, matched to existing `filterOptions.syncGroups` labels/order; use `totalCount` for the `전체` chip. Only include nonzero represented groups.

The only workspace use of `group.members` is `group.members[0].classId` in the chip click (`:6382-6386`): it sets local selected class and enters the mutation lifecycle, but does not itself open detail, mutate a group, or export. No workspace consumer requires complete group class-ID arrays. A single representative class ID preserves this local selection behavior; choose the first final-filter candidate in SQL `(sort_key,id)` order, matching today's synthesized `sortOrder:index` (`:2725-2730`). Alternatively, a deliberately reviewed UI change can select the first row after the filtered page succeeds and omit this field, but do not silently remove the click behavior. Full members, histories, and group-wide mutation/export data are unnecessary. Keep page-only indicators explicitly page-only (`:6337-6343`).

### 3. Make academic resolved-period and metadata behavior explicit (high)

Task 1 interface at `docs/superpowers/plans/2026-08-31-numbered-pagination-secondary-workflows.md:39` omits `resolvedPeriodId`, although the linked audit requires it.

- Academic SQL chooses default group deterministically when period is absent/blank (`academic migration:397-405`) and permits period ID **or name** aliases (`:419-425`); response returns resolved scope at `:661`.
- Existing service pins the resolved period into continuation filters and actor-bound metadata hash: `src/features/academic/academic-read-service.js:253-299`.
- Numbered services cannot hide this information only inside a removed cursor. Expose resolved period in the numbered domain extension, hold it in list query state, and pin subsequent pages/refresh to that period. A default setting change between pages must not silently switch the result set.
- Define `includeScopeMetadata:false`: `totalCount` remains fresh every time, while `stats/filterOptions` are either explicitly null and reused only from the same actor+resolved-filter scope, or requested again. A direct cold page 11 needs metadata or a clear metadata-missing error, never an automatic second/cursor/full read. Refresh/mutation must invalidate or recompute metadata so aggregate cards do not remain stale.
- Preserve aggregate scopes: `stats.total` and sums are from `filtered`, but `stats.viewModeCounts` are from `classified` **before** the selected `viewMode`; options are from `base`, while period options are the catalog (`academic migration:622-655`). Do not reduce these to current rows or apply the active view filter to every work-queue count.

### 4. Split academic aggregate-required work from display-only enrichment

Required minimal sequence:

1. Authorized class candidates after period/status/subject/grade/teacher/classroom/search.
2. Session count and distinct planned-progress count for eligible class IDs.
3. State classification; selected `viewMode`; full filtered count (and scope stats when requested).
4. Narrow ordered class keys; LIMIT/OFFSET.
5. Only selected-page next-session fields and row DTO shaping.

Session/progress aggregates are required before paging because `viewMode` depends on them (`academic migration:441-455,510-536`). Preserve `skipped` exclusion, distinct `session_id/progress_key/id`, statuses `partial|done`, and state precedence (no schedule before unlinked). `next_unplanned` is currently evaluated for all eligible classes (`:456-478`) but is display-only and can join selected page IDs instead. Do not copy its broad pre-page scan into the new API. Full child histories remain direct detail only.

### 5. Specify the flat page DTO / metadata / hook adaptation seam

- Shared `NumberedPage<T>` is flat: `src/lib/numbered-pagination.ts:7-12`. Existing domain services return `{page:{rows,hasMore,nextCursor},stats,filterOptions}` (`academic-read-service.js:300-313`, `operations-read-service.js:452-464`); both workspaces read nested `data.page.rows`.
- Return `NumberedPage<existing row DTO>` plus a typed domain metadata extension from the new methods; explicitly map it into each hook's existing workspace envelope or change consumers together. RPC wrappers `{id,sort_key,row_data}` must be unwrapped, not leaked as UI rows.
- The current common controller snapshot only declares page fields (`src/lib/numbered-page-controller.ts:3-17`). Keep metadata as a domain-owned successful-scope value or add a reviewed typed extension; do not publish metadata separately before stale-result rejection.
- New validators must reject missing/malformed rows, over-page rows, invalid IDs/page/size/count, and required metadata rather than copying the cursor services' empty-success defaults (`operations-read-service.js:450-464`, academic `:278`). Validate page input rather than using `normalizePage` as invalid API-input acceptance.
- `AbortSignal.timeout(8000)` alone in the old services does not propagate caller cancellation (`academic-read-service.js:275`, operations `:447`). New methods need combined caller+timeout cancellation and `.retry(false)`; obsolete requests must not merely be ignored after running to timeout.

### 6. Retained presentation and actor isolation need explicit UI changes

- Academic hook retains actor-scoped successful data (`use-academic-workspace-data.ts:103-123,149-154,214-236`), but curriculum explicitly hides it whenever request scope differs (`curriculum-workspace.tsx:251`) and replaces the screen with skeleton (`:535-536`). Replace this gate with successful displayed-page rendering while the requested page is pending/failed. Count/header/row labels must follow displayed scope, not pending controls.
- Operations hook uses `user.app_metadata.role` instead of resolved `useAuth().role`, and its fingerprint excludes actor (`use-operations-workspace-data.ts:57,64-74`); retained data is not actor-scoped. Recreate/clear list controller and metadata on resolved actor changes, including logout and same-user role change.
- Operations currently waits for `loadCatalogs()` after its list RPC before committing rows (`:92-100`). Keep bounded catalogs independent/actor-scoped and available to existing range consumers; don't make every numbered page depend on this additional request. Do not accidentally remove catalogs from calendar/annual modes.
- Academic visible summary currently uses page row count (`curriculum-workspace.tsx:560`); replace with full filtered total. Existing global stats must remain SQL-derived (`:286-301`).

### 7. Back/deep-link state and drafts are separate from page state

- Add page to both query serialization helpers/state and to their existing return-path/scroll key, while preserving unrelated URL fields: curriculum `:84-113,335-424`; class planning `:753-790,2887-2970`.
- Initial URL state is read by `useState`; test browser Back on an already-mounted component as well as detail-route remount. Avoid a URL replacement effect overwriting restored page with old local state.
- Operations already has exact detail independent of loaded rows (`class-schedule-workspace.tsx:2751-2793,3020-3065`). Preserve this and its detail loader identity/mutation lifecycle. Its automatic selection of first page row (`:2972-2999`) is not a substitute for independent detail selection; replacing rows must not reset `lessonProgressDraft` or revoke an unrelated open edit.
- No list export action was found in these two workspace sources. Keep existing selected-class schedule/lesson operations unchanged; no new all-filtered export producer is needed for Tasks 1/2.

## Final migration / predicate authority

Repository-wide symbol search found no later definition/replacement of these four RPCs in the ordered migration chain:

| API | Final repository definition | Access |
| --- | --- | --- |
| `get_academic_curriculum_page_v1` | `supabase/migrations/20260814062437_academic_scoped_reads.sql:360-666` | Invoker, empty search_path, explicit auth.uid guard; revoke/grant at `:758-769` |
| `get_academic_curriculum_detail_v1` | same file `:668-756` | Separate exact bounded detail |
| `get_operations_class_schedule_page_v1` | `supabase/migrations/20260814035710_operations_scoped_reads.sql:793-942` | Invoker, empty search_path, authenticated-only ACL at `:1170-1186` (no explicit uid guard in this function) |
| `get_operations_class_lesson_design_detail_v1` | same file `:1001` onward | Separate exact detail; preserve |

Do not homogenize valid filter semantics: academic teacher is substring matching and classroom uses aliases; operations teacher is exact split-token matching (including newline). Academic status is normalized by `academic_class_status_v1`; operations active/draft stats intentionally use their existing raw status sets (`operations migration:925-929`). Academic blank-name sort sentinel is U+FFFF; operations sentinel is empty string. These are source contracts, not opportunities for cleanup during pagination.

Current classes SELECT policy is `classes_authenticated_select_v2 USING(true)` for authenticated (`supabase/migrations/20260808172743_rls_policy_initplan_consolidation.sql:3-12`); don't invent owner/teacher row restriction tests that contradict existing access. Keep helpers/schema grants needed by invoker functions. Validate new SQL inputs explicitly with 22023 before JSON expansion/arithmetic: old operations expands jsonb_object_keys before shape validation (`:811-825`), and old academic `p_limit <> 30` does not reject SQL NULL (`:381`). New page arithmetic should avoid integer overflow for large page inputs. These old validation weaknesses need not alter the compatibility RPCs.

## Approval/makeup follow-ups (bounded checks)

1. Align plan/audit wire names before implementation: approval `tabCounts` vs audit `viewCounts`; makeup plan flat `dateFrom/dateTo/filterColumn/sortColumn/sortDirection` vs audit `periodStartDate/periodEndDate/searchColumn/sort:{columnKey,direction}`; makeup RPC names also differ. Pick one exact producer-consumer contract and test it.
2. Approval direct detail must render independently, not just switch tab. Current code finds a deep link in loaded requests and scrolls to its inline card, and can prepend it (`approval-workspace.tsx:496-551`). Prepending an outside-page detail would violate strict page size/count. Use a separate detail region/dialog. Preserve `mine` across statuses and `review/open` exact `isClosedApproval` predicates (`:525-546`).
3. Makeup facets are not all identical full-filter counts: view counts ignore table filters (`makeup-request-workspace.tsx:2000-2009`); subjects derive from current-view requests, and teachers derive from current view+selected subject plus visible catalog teachers (`:1292-1312`). Encode these scopes, not current-page arrays.
4. Makeup sort/search uses **display strings**, Korean numeric comparison, `-` fallbacks, localized status labels and formatted slot strings (`:658-702,1314-1329`). Latest event timestamp alone is insufficient: submittedAt prefers request.createdAt, approvedAt/canceledAt prefer stored row dates, and finalNote suppresses system/cancel notes (`:631-644,680-697`). Preserve these exact transformations in minimal sort/search keys. Existing latest-event tie order is unspecified (`:315-319`); decide/test a deterministic ID tie rather than assume stable timestamp alone.
5. The final assistant hard-deny policies are further altered by `supabase/migrations/20260721132249_assistant_makeup_policy_performance.sql:49-101`, after the audit's cited `20260721131903`. Include both in RLS test authority and preserve profiles.role assistant checks. No later approval SELECT replacement was found for the base involved/admin request/child policies.

## Minimum added evidence before calling this slice complete

- Production adapter transport tests: one direct page-11 RPC, flat normalized DTO, exact 10/15/20 bound, strict response rejection, actual abort propagation, retry false, no cursor/detail/range fallback.
- SQL: fixed duplicate/numeric/prefix-name fixtures across pages; all distinct domain filters; canonical null/name period behavior; view-mode count scope; metadata false still yields literal total; operations multi-group/facet counts; empty and out-of-range total; invalid JSON/null/page/size/overflow SQLSTATE; final ACL/RLS function definitions.
- Hook/controller tests that include the real DTO model builders, metadata publication, actor changes, pending/failed page presentation, Back/return URL, count clamp, and unchanged exact detail/range calls.
- No EXPLAIN, pgTAP, rendered, runtime, or production verification is claimed by this preflight.
