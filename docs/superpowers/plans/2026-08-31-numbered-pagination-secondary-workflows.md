# Secondary Workflow Numbered Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply direct numbered reads and the common pager to curriculum, class planning, approvals and makeup requests.

**Architecture:** Keep domain row components and mutation workflows; replace only accumulated/unbounded list reads with invoker page APIs. Share the reviewed pagination controller/preferences/UI. Keep authorized detail reads, form catalogs and aggregate tab counts separate from current-page rows.

**Tech Stack:** React19, Next16, Supabase/PostgreSQL, existing shadcn/ui, node:test, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-31-app-wide-numbered-pagination-design.md`

## Global Constraints

- For each new bounded RPC, extend the foundation's explicit numbered-RPC query-budget registry only after strict10/15/20 final-SQL validation and local pgTAP proof; retain timeout/retry/authorization checks. The owning read-model task may update `src/lib/query-surface-budget.js` and its focused tests for that exact contract, never exempt arbitrary list RPCs or weaken unrelated guards.

- Page-number blocks contain ten existing numbers: 1–10, 11–20, 21–30. No ellipses or direct page input. Single arrows move one page; double arrows select global first/last.
- Page size10/15/20, minimum10; same page result feeds desktop and mobile. Shared DataTablePagination stays outside desktop row scrollports.
- Authorized full-filter counts and stable unique ordering; no loaded-subset count, full-list or intermediate-cursor fallback. Only selected-page relations receive full-history enrichment.
- Use createNumberedPageController, retain successful page/rows/count on pending/error, reject stale results, reset page atomically with filters/sort/size, retain/clamp after refresh/mutation. No cross-user retained data.
- Resolved actor ID and role form the client authorization scope. Wait for auth/profile readiness; clear retained rows, metadata, details, selection and drafts on logout/user/role change and reject old async completions. Any supplemental cache invalidation must cover in-flight writes as well as stored values. Do not send the client role as a SQL authority override.
- Preserve URL/back/detail restoration, unsaved drafts, current-page selection and existing export/aggregate scope.
- Preserve auth/RLS/ACL, final active SQL definitions and domain mutations. No remote migrations, deploy, push or sends. New migrations use CLI-generated filenames and candidate manifest entries until actual SQL proof.
- Exclude timetable, calendar/agenda, annual board and single-class lesson timeline; leave independent search pickers bounded and unchanged.
- Add executable production service/controller/SQL tests, distinguish them from rendered/live verification, and do not bypass Browser-policy denial.

## Prerequisites

Foundation and task-workflow plans are reviewed. Shared types/UI/controller exist in `src/lib/numbered-pagination.ts`, `src/lib/numbered-page-controller.ts`, `src/hooks/use-data-table-page-size.ts`, and `src/components/data-table/data-table-pagination.tsx`.

Read the relevant surface section of `docs/superpowers/plans/2026-08-31-secondary-numbered-read-audit.md` for concrete predicate/detail boundaries. Verify ordered migration definitions before implementation.

Refined final-source evidence: `docs/superpowers/plans/2026-08-31-secondary-workflow-preflight.md`. Its producer-consumer corrections are incorporated below.

## Task 1: Curriculum and class-planning numbered read adapters

**Files:**
- Create CLI migration `academic_operations_numbered_pages`.
- Create `supabase/tests/academic_operations_numbered_pages_test.sql`.
- Modify `src/features/academic/academic-read-service.js`; create matching `.d.ts` only if needed for the new typed consumer.
- Modify `src/features/operations/operations-read-service.js`; create matching `.d.ts` only if needed for the new typed consumer.
- Create `tests/academic-operations-numbered-service.test.mjs`.

**Interfaces:** Add `get_academic_curriculum_numbered_page_v1(p_filters jsonb,p_page integer,p_page_size integer,p_include_scope_metadata boolean default true)` and `get_operations_class_schedule_numbered_page_v1(p_filters jsonb,p_page integer,p_page_size integer)`. Both return flat `NumberedPage<existing row DTO>` plus typed domain metadata `{stats,filterOptions}`. Academic also returns `resolvedPeriodId`; operations also returns `syncGroupCounts:Array<{groupId:string,memberCount:number,representativeClassId:string}>`. Retain existing DTO/metadata field meanings and unwrap any SQL `{id,sort_key,row_data}` wrappers before UI delivery. Add `readCurriculumNumberedPage({filters,page,pageSize,includeScopeMetadata,signal})` and `readClassScheduleNumberedPage({filters,page,pageSize,signal})` methods to the respective existing read-service factories; preserve all cursor/range/detail methods.

- [ ] Read final `20260814062437_academic_scoped_reads.sql` and `20260814035710_operations_scoped_reads.sql` definitions and later replacements. Preserve eight curriculum filter keys (`periodId,search,status,subject,grade,teacher,classroom,viewMode`) and six schedule filter keys (`termId,search,subject,grade,teacher,syncGroupId`).
- [ ] Preserve distinct predicate/order contracts: academic teacher substring/classroom aliases/status normalization versus operations exact split-token teacher/raw status sets; academic blank-name U+FFFF sentinel versus operations empty string. Both retain full class name with `dashboard_private.ko_numeric`, then id ASC, not stripped display title. Neither gains a new sort UI. Test numeric names2/10, bracket prefixes, different terms and equal names across page boundaries. Use final authenticated classes SELECT policy rather than invent owner-only visibility.
- [ ] Match legitimate final transport shapes before tightening validators: explicit academic period-name aliases remain the returned `resolvedPeriodId` selector (only absent input resolves to a default UUID), academic planned counts/percentages may exceed session counts/100 under existing distinct-log semantics, and operations `updatedAt` may be null because it projects nullable class.created_at. Preserve SQL nextSession.sessionKey even though the old CurriculumRow declaration omits it. Do not reject or silently coerce these valid shapes; see the bounded DTO preflight for exact field sources.
- [ ] Add RED service tests with direct page11 and strict transport assertions:

```js
const page = await service.readClassScheduleNumberedPage({filters,page:11,pageSize:10,signal});
assert.equal(calls.length, 1);
assert.equal(calls[0].name, 'get_operations_class_schedule_numbered_page_v1');
assert.deepEqual(calls[0].args, {p_filters:filters,p_page:11,p_page_size:10});
assert.equal(page.totalCount, 260);
```

Test malformed/missing RPC responses, over-page rows, invalid row IDs/page/size/count/metadata, size5/30 rejection, combined caller abort+8s deadline/retryfalse, literal filtered totals and no detail/schedule-plan payload. Write SQL fixtures for both sources, equal-sort ties, page11, partial/empty/out-of-range pages, full filters, period/term selection, RLS/ACL and invalid JSON/null/enum/overflow SQLSTATE22023. Validate before JSON expansion and offset arithmetic; do not copy old nullable-limit validation weaknesses.
- [ ] Generate the new migration and append exact hash candidate. Reuse authorized candidate/filter predicates for count and page. Academic minimal session/distinct planned-progress aggregates precede viewMode classification/count/page because filtering depends on them; preserve skipped exclusion, distinct session_id/progress_key/id, partial/done states and no-schedule-before-unlinked precedence. Move display-only next_unplanned/next-session enrichment after selected page IDs. Full histories remain detail-only. Keep `schedule_plan` out of class-schedule list projections.
- [ ] Preserve academic scope semantics: resolve absent/blank period with existing deterministic default and ID/name aliases; return resolvedPeriodId on every page. stats totals/sums use filtered candidates; viewModeCounts use classified candidates before selected viewMode; options use base candidates and period catalog. `includeScopeMetadata:false` still returns fresh totalCount/resolvedPeriodId, with stats/filterOptions explicitly null and reuse allowed only for the same actor+resolved-filter scope. A cold direct page11 requests metadata in its single RPC; do not issue automatic cursor/full/second-page fallback. Refresh/mutation invalidates or recomputes metadata.
- [ ] Compute operations syncGroupCounts over the same final six-filter candidate relation, including selected syncGroupId. Credit each class only to the existing preferred/chosen group; retain the independently ordered200-option group catalog and hide zero groups. Each representativeClassId is the first matching class in SQL order; full member-ID arrays are unnecessary. `totalCount` supplies the 전체 chip. Do not redesign these facets as term-only or self-excluding counts. Test multiple group memberships and counts unchanged across pages.
- [ ] Implement strict adapter methods with shared size validation and actual caller+timeout cancellation plus retryfalse. Expose flat typed domain extensions instead of old nested cursor page envelopes; retain compatibility methods. Do not silently fall back to cursor v1 or malformed empty-success defaults. Run service tests, focused lint/typecheck, isolated SQL, and commit owned files as `feat: add numbered academic and planning reads`.

## Task 2: Curriculum and class-planning UI integration

**Files:**
- Modify `src/features/academic/use-academic-workspace-data.ts` and `src/features/academic/curriculum-workspace.tsx`.
- Modify `src/features/operations/use-operations-workspace-data.ts` and `class-schedule-workspace.tsx`.
- Modify `src/features/academic/records.js` and `src/features/operations/records.js` (and matching declarations if needed) only to preserve numbered page input order and consume independent sync-group facets; retain legacy/range sorting behavior.
- Create `tests/academic-operations-numbered-pagination.test.mjs`; update affected scoped-read tests.

**Interfaces:** Hooks expose `page,pageSize,totalCount,goToPage,pageSizeMode,setPageSizePreference` only for their record-list modes, consuming Task1 methods. Keep their existing range/detail interfaces unchanged. Per-list preference keys are `academic:curriculum` and `operations:class-schedule`.

- [ ] Write RED controller/hook cases for page11 one read, atomic filter/size reset, retained rows on error, stale count rejection, refresh clamp and URL/detail return. Assert timetable/calendar/annual modes use their existing range readers, not numbered APIs.
- [ ] Include the actual DTO model builders in order tests; do not let their existing display-title/term sorts reorder a server page. Preserve SQL input order only for numbered mode. Adapt flat pages explicitly into the workspace envelope. Keep domain metadata attached to the accepted successful response scope (using domain-owned state or a reviewed typed controller extension); never publish metadata before stale rejection. Pin resolved academic period for subsequent pages and refresh so a default change cannot silently switch datasets.
- [ ] Replace curriculum/schedule accumulation and list `loadMore` with shared controller and pager. Use successful response page/count, preserve scope metadata and all current filters. Keep `get_academic_curriculum_detail_v1` and `get_operations_class_lesson_design_detail_v1` independent of loaded rows.
- [ ] Remove curriculum's requested-scope mismatch hiding/skeleton behavior when a successful displayed page exists. Rows/count/header labels stay on that displayed scope during pending/error. Scope operations by resolved `useAuth().role` plus actor, not app_metadata.role alone; clear controller, rows, metadata and catalogs on actor/role/logout transitions. Keep operations catalogs independent of page reads and available to unchanged range modes instead of waiting for catalog hydration on every page.
- [ ] Feed operations group chips from returned syncGroupCounts and filterOptions, with totalCount for 전체 and only representativeClassId for its existing local-selection/lifecycle action. No full group members are required by current mutations/exports. Keep explicitly page-only indicators page-only and replace curriculum's overall row summary with full filtered total.
- [ ] Preserve `lessonProgressDraft`, selected-class mutation lifecycle token and unsaved guards. Preserve scroll and URL parameters without replacing unrelated detail links. Update any visible total derived from loaded array to full-filter count while leaving per-page selection separate.
- [ ] Add page to existing URL/return-path/scroll keys and test browser Back on an already-mounted hook as well as detail-return remount. URL-writing effects must not overwrite restored page state. Page replacement must not auto-select a different class and reset an independently open detail draft. No new all-filtered export API is needed for these two surfaces, which have no current list-export action.
- [ ] Run new tests, existing academic/operations scoped and continuous-class-schedule regressions, focused lint/TS, then commit as `feat: paginate curriculum and class planning lists`.

## Task 3: Approval pages and direct detail access

**Files:**
- Create CLI migration `approval_numbered_pages` and `supabase/tests/approval_numbered_pages_test.sql`.
- Create `src/features/approvals/approval-numbered-service.ts`.
- Modify `src/features/approvals/approval-service.ts` and `approval-workspace.tsx`.
- Create `tests/approval-numbered-pagination.test.mjs`; update `tests/approval-workspace.test.mjs`.

**Interfaces:** Export `ApprovalListView = 'mine'|'review'|'open'|'done'|'returned'`. Add service `readApprovalNumberedPage({view,page,pageSize,signal}) -> Promise<NumberedPage<ApprovalRequest>>` and `readApprovalDetail({id,signal}) -> Promise<ApprovalRequest|null>`, using the existing exported request DTO type. RPC `list_approval_numbered_page_v1(p_view text,p_page integer,p_page_size integer)` returns page plus authoritative `tabCounts`; `get_approval_detail_v1(p_id uuid)` returns the complete authorized single-record DTO. Do not add search/sort UI not present today.

- [ ] Copy existing tab predicates exactly from approval-workspace into test fixtures before moving them server-side. RED tests exercise all views, direct detail outside loaded page, page11 single RPC, failed-page retry and full tab counts. SQL tests cover involved/admin visibility, unrelated user exclusion, anon denial, updated_at ties with id DESC, selected-page-only comments/events and empty count.
- [ ] Generate migration. Use invoker security, RLS and authenticated grants from final approval chain (base `20260523190000_approval_requests.sql` plus later definitions), order `updated_at DESC,id DESC`. Derive tab counts from authorized rows independent of chosen view; enrich only paged request IDs. Direct detail uses the same visibility boundary.
- [ ] Separate profiles/templates loading from list pages. Replace in-memory complete-list/tab count assumptions with service/controller. Deep links resolve directly, choose owning tab from returned record and open it without scanning pages. Preserve sessionStorage idempotency, composer/edit draft guards, approval/comment/send mutation semantics unchanged.
- [ ] Render an outside-page approval detail in a separate detail region/dialog, not by prepending it to numbered rows. Preserve mine across statuses and the existing review/open `isClosedApproval` predicates. The exact new metadata field is `tabCounts` (not the older audit's viewCounts); align service/RPC/tests on this contract.
- [ ] Exercise unresolved auth, logout/user switch and same-ID role change through the real approval consumer with delayed page/detail/catalog responses. Prior-authority rows, tab counts and editor/detail state must not reappear; preserve drafts only within their current actor scope.
- [ ] Add shared pager/preferences `approvals:requests`, preserve previous displayed state on error, reset/clamp correctly, and use an explicit error/retry path rather than replacing prior rows with an empty success. Run service/controller/SQL tests and existing approval tests, lint/TS, then commit as `feat: paginate approval request lists`.

## Task 4: Makeup request full-filter numbered pages

**Files:**
- Create CLI migration `makeup_numbered_pages` and `supabase/tests/makeup_numbered_pages_test.sql`.
- Create `src/features/makeup-requests/makeup-numbered-service.ts`.
- Modify `src/features/makeup-requests/makeup-request-service.ts` and `makeup-request-workspace.tsx`.
- Create `tests/makeup-numbered-pagination.test.mjs`; update `tests/makeup-request-workspace.test.mjs`.

**Interfaces:** Define `MakeupNumberedFilters` from current controls: `view:'mine'|'approvalPending'|'makeupPending'|'refundPending'|'closed'`, `subject,teacher,period,dateFrom,dateTo,filterColumn,search,sortColumn,sortDirection`. Preserve current value/null conventions and exact allow-listed column identifiers. Service `readMakeupNumberedPage({filters,page,pageSize,signal})` returns NumberedPage of existing MakeupRequest DTO; `readMakeupDetail({id,signal})` returns request plus complete event history. RPC `list_makeup_numbered_page_v1(p_filters jsonb,p_page integer,p_page_size integer)` returns page plus full-filter/view facets/counts needed by existing controls. `get_makeup_detail_v1(p_id uuid)` resolves deep links independently.

These wire names are authoritative for new implementation; map current controls into them explicitly instead of mixing the older audit's periodStartDate/periodEndDate/searchColumn/nested-sort names or alternate RPC names.

- [ ] Write RED fixtures reproducing current combined view+subject+teacher+period predicates, including period matches across cancel/makeup slot dates and selected-column text search. Event-derived revision/approved/rejected/canceled dates and notes remain searchable/sortable with the same latest-event semantics. Test that an event outside the requested page still affects ordering/filter selection, but only selected-page full histories are returned.
- [ ] Preserve display-string search/sort: Korean numeric comparison, '-' fallbacks, localized status/slot text, submittedAt preferring request.createdAt, approvedAt/canceledAt preferring stored row dates and finalNote suppressing system/cancel notes. Use minimal derived keys before paging, not event timestamp alone. Resolve equal latest-event timestamps deterministically by event id DESC and test it. View counts ignore table filters; subject options use current view; teacher options use current view+selected subject plus visible teacher catalog. Do not derive these facets from current page rows or homogenize their scopes.
- [ ] Add SQL tests for all views, manager/involved visibility, assistant restrictive deny, anon/invalid SQLSTATE22023, deterministic ties, page11, partial/empty result and count consistency. Generate migration using final request/event RLS; derive minimal latest-event sort/filter values before page selection, complete event history only after selected IDs. No privileged security workaround.
- [ ] Include final assistant hard-deny policy chain through `20260721132249_assistant_makeup_policy_performance.sql`, not just the earlier `20260721131903` migration; preserve profiles.role checks and actual final ACL/RLS evidence.
- [ ] Lift table-local filter/sort controls to the page-query scope while preserving exact visible options. Keep profiles/teachers/classes/rooms/academic events/lesson-session form catalogs separate and lazy as currently required. Replace deep-link in-page `find` with direct detail and preserve unsaved request form state.
- [ ] Use common controller, `makeup:requests` preference and shared pager for desktop table/mobile cards. Keep prior displayed rows/count through pending/error, reset filters atomically, refresh/clamp after mutations and retain all current confirmation/no-send boundaries.
- [ ] Exercise unresolved auth and same-ID role changes as well as logout/user switches with delayed page/detail/catalog reads. The assistant denial and all role-sensitive facets/actions must reflect the new resolved scope immediately, without cached or late prior-role state.
- [ ] Run new behavior/SQL tests, affected makeup workflow tests, lint/TS and commit as `feat: paginate makeup request workflows`.

## Task 5: Slice verification

**Files:** Update `docs/qa/2026-08-31-numbered-pagination.md`.

**Interfaces:** Coverage evidence for curriculum, class-schedule, approval tabs and makeup views; exact test/migration/commit IDs and pending live gates.

- [ ] Run new and affected regressions plus production build. Confirm date-based modes/pickers were not paginated and no record-list accumulation control remains.
- [ ] Record actual isolated SQL results or exact capability blocker, and rendered checks only if permitted with available RPCs. Preserve separate deployment prerequisite status.
- [ ] Independent whole-slice review, resolve findings, commit evidence, and continue textbook/settings plan without new user approval.
