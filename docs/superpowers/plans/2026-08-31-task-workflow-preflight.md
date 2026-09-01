# Task workflow numbered pagination — bounded preflight

Read-only inspection on 2026-08-31, checkout HEAD `f588af71`. No production/source/plan edits, branch changes, network calls, DB execution, or tests. This report is the only owned write. Findings are static code evidence, not SQL/runtime verification.

## Conclusion

The one-RPC numbered service is feasible with the current list DTO. The largest implementation risk is SQL predicate/projection separation, not client hydration. Sharpen Task 1's SQL seam and strict parsing requirements before implementation; make the server-paged UI marker explicit in Task 2. Keep registration's independent appointment-calendar reader untouched.

## Final active definitions checked

- Filter validator and source: [20260813234824_ops_task_page_reads.sql:48](/Users/hyunjun/Documents/Codex/tips_dashboard/supabase/migrations/20260813234824_ops_task_page_reads.sql:48) and [source:204](/Users/hyunjun/Documents/Codex/tips_dashboard/supabase/migrations/20260813234824_ops_task_page_reads.sql:204).
- Cursor v1: [same migration:787](/Users/hyunjun/Documents/Codex/tips_dashboard/supabase/migrations/20260813234824_ops_task_page_reads.sql:787).
- Final stats wrapper: [20260818083818_optimize_registration_task_stats.sql:165](/Users/hyunjun/Documents/Codex/tips_dashboard/supabase/migrations/20260818083818_optimize_registration_task_stats.sql:165). It routes registration to `dashboard_private.ops_registration_task_stats_v1`; other types call the renamed `ops_task_list_stats_legacy_v1`. Registration's count source is embedded in its stats function, not a reusable page-key function.
- Final cursor v2 / actor augmentation: [20260820150057_ops_task_completion_actor.sql:162](/Users/hyunjun/Documents/Codex/tips_dashboard/supabase/migrations/20260820150057_ops_task_completion_actor.sql:162).
- Repository-wide migration-name references found no later redefinition of these functions. This is the checked-in migration chain, not remote ledger confirmation.

## Plan defects / brief clarifications

### 1. “Reuse shared predicates” does not yet identify a reusable narrow SQL source

[Plan:64](/Users/hyunjun/Documents/Codex/tips_dashboard/docs/superpowers/plans/2026-08-31-numbered-pagination-task-workflows.md:64) is directionally right, but calling `ops_task_page_source_v1` and only then applying OFFSET/LIMIT is not the promised optimization. Its `common` CTE builds all common JSON at SQL lines 264–297; registration matching and all-track JSON aggregation happen at 392–524; withdrawal/transfer/retest display JSON is also used for selection or ordering. The function has `SET` clauses and accepts no parent-ID restriction, so an outer `WHERE id IN (...)` is not a reliable bounded enrichment seam. Do not call it once per selected ID either.

Use one new narrow eligible-key relation for both numbered count and page. Only after the ordered page keys are selected should the query construct list DTOs and aggregate registration tracks. Existing cursor/stats APIs may remain unchanged; compare their selected IDs/order with the new reader in parity fixtures rather than silently replacing their behavior.

Type-specific selection that must remain before paging:

| Type | Mandatory eligible-key semantics / exact source |
| --- | --- |
| General | Includes `general` **and `textbook`**, shared status/search at SQL 252–262; requester/team, primary/secondary assignee, auth.uid()-based inbox/sent/completed and focus at 315–354. Preserve the existing “unassigned” meanings, which differ between assignee filter and focus. |
| Registration | One parent per matching case. Keep view/consultation-owner/search membership and representative track selection at SQL 392–470, including normalized phone/search text, sibling-subject EXISTS, `consultation_waiting` priority, `phone_ready_at`, and track-ID tie break. Carry `matching_track_id` into projection: all authorized sibling tracks are emitted, with the matching track first at 519–523. A plain join/count of tracks or deduplication after LIMIT is wrong. |
| Withdrawal | Inner detail join; subject/teacher placeholder equivalence, applicant/operations/closed states, ANY-of-date period checks, and selected display-column search at SQL 553–594. Header sorting/filtering needs the exact scalar display text, including progress/checklist formatting; do not move those expressions after LIMIT. |
| Transfer | Inner detail join, from-teacher filtering, placeholder equivalence, ANY-of-date checks and selected display-column search at SQL 627–669. Preserve `toClassName` fallback and checklist formatting. |
| Word retest | Inner detail join; branch, teacher catalog/name/unassigned, class ID/name/unassigned, includeClosed + queue, and effective-test-date period semantics at SQL 705–781. Header display text may depend on scores/status/profile-label fallbacks and must be available before sorting. |

The optimized registration stats memberships at [stats:41](/Users/hyunjun/Documents/Codex/tips_dashboard/supabase/migrations/20260818083818_optimize_registration_task_stats.sql:41) are useful count-reference material, not a drop-in sorted key source: they omit representative sort fields. `byView` intentionally counts membership across views without the selected consultation-owner restriction (122–140), while `total` counts the selected parent set (98–106, 129). Numbered total must come from its own eligible keys, not supplemental stats.

Preserve the actual ORDER BY at [page SQL:954](/Users/hyunjun/Documents/Codex/tips_dashboard/supabase/migrations/20260813234824_ops_task_page_reads.sql:954), including `dashboard_private.ko_numeric`, null placement and final `id ASC`. Do not reconstruct it solely from cursor JSON: for general/completed, cursor arity/sort-values contain only completion time (815/854), but actual ORDER BY also applies selected status/priority tie keys (956–960). Changing that is a separate legacy-contract fix, not implicit numbered-pagination cleanup.

### 2. Strict parsing cannot be delegated to the existing mapper

[Plan:62–65](/Users/hyunjun/Documents/Codex/tips_dashboard/docs/superpowers/plans/2026-08-31-numbered-pagination-task-workflows.md:62) requests strict response parsing and existing DTO mapping. Those must be separate steps. [mapOpsTaskPageRow:1535](/Users/hyunjun/Documents/Codex/tips_dashboard/src/features/tasks/ops-task-service.ts:1535) coerces values and casts nested DTOs; [normalizers:993](/Users/hyunjun/Documents/Codex/tips_dashboard/src/features/tasks/ops-task-service.ts:993) turn invalid type/status/priority into valid-looking defaults. Reusing it alone accepts malformed RPC data.

Specify the RPC `rows` shape as flat camelCase list payloads, or `{id,row_data}` wrappers, and validate that single shape before mapping. Prefer flat payloads matching the existing `row_data`; the mapper already supports these. Validate parent IDs, allowed type (general may include textbook), status/priority, per-type nested objects/track task IDs, actor fields, integer nonnegative count, integer page, exact requested size, unique parent IDs and maximum row length. Do not require comments/events/attachments hydration: the list mapper deliberately sets them to empty arrays.

### 3. Reusing the filter validator alone cannot establish “all invalid input => 22023”

The existing SQL validator checks enum values using `NOT IN` without guarding JSON null for queue/focus/sort/view/period, e.g. [SQL:112](/Users/hyunjun/Documents/Codex/tips_dashboard/supabase/migrations/20260813234824_ops_task_page_reads.sql:112). SQL three-valued conditions can let those invalid null enums through. Custom date strings are type-checked but not parsed in the validator; later casts at 591/666/780 can produce date-format errors instead of 22023. This is a static risk, not an observed SQLSTATE claim.

For the new API, define the invalid-input contract explicitly: reject null/invalid page and size, validate mandatory enums and custom ISO date bounds before query execution, and use overflow-safe offset arithmetic. A narrow new numbered validator can call the shared validator and add the missing checks without changing cursor APIs. Client [assertOpsTaskPageFilters:758](/Users/hyunjun/Documents/Codex/tips_dashboard/src/features/tasks/ops-task-service.ts:758) also lacks an asc/desc membership check and permits partial non-custom date input in some cases; do not call its current checks complete runtime validation. Add exact-state pgTAP cases against the final new definition before claiming 22023 coverage; never relabel domain issues as 40001.

### 4. Numbered rows need an explicit server-selection marker, not only `tasks` replacement

[Plan:77](/Users/hyunjun/Documents/Codex/tips_dashboard/docs/superpowers/plans/2026-08-31-numbered-pagination-task-workflows.md:77) says compose displayed rows into `OpsTaskWorkspaceData.tasks`. Current `OpsTaskWorkspaceData.page` is specifically the cursor response shape at [service:417](/Users/hyunjun/Documents/Codex/tips_dashboard/src/features/tasks/ops-task-service.ts:417). UI logic relies on `data?.page` to bypass local selection at [workspace:9476](/Users/hyunjun/Documents/Codex/tips_dashboard/src/features/tasks/ops-task-workspace.tsx:9476), and passes `serverPaged={Boolean(data?.page)}` to a row component at [workspace:13203](/Users/hyunjun/Documents/Codex/tips_dashboard/src/features/tasks/ops-task-workspace.tsx:13203).

Introduce/route an explicit numbered server-page state and update those gates. Do not remove cursor `page` then accidentally reactivate page-local filters/sorts, and do not fabricate cursor metadata to make a boolean truthy. Numbered cache entries need a separate namespace including viewer, canonical filters, page, and pageSize; the current cursor cache at [service:552](/Users/hyunjun/Documents/Codex/tips_dashboard/src/features/tasks/ops-task-service.ts:552) has no numbered page/size and persisted rows at 584–607 are not numbered-envelope validated.

Also preserve facet readiness: current word-retest filter-reset effects use current options at [workspace:9437](/Users/hyunjun/Documents/Codex/tips_dashboard/src/features/tasks/ops-task-workspace.tsx:9437). With stats pending/failed, deriving options from a replacement page can clear an otherwise valid filter. Do not let numbered page changes redefine the catalog or tab-count scope.

## Exact safe service seam and actor/auth contract

- Export/share the pure filter validator (with the new reader's required strict additions) and pure list mapper at service 758 and 1535. New injected read service performs exactly `rpc('list_ops_task_numbered_page_v1', {p_type,p_filters,p_page,p_page_size})`, composed caller/8-second timeout signal, `.retry(false)`, strict validation, then mapping. Do not delegate to `loadOpsTaskPage`: its v2→v1 fallback at [1842–1878](/Users/hyunjun/Documents/Codex/tips_dashboard/src/features/tasks/ops-task-service.ts:1842) is intentionally a different retained contract.
- No hidden page hydration dependency was found. Current page read maps DTOs at 1881–1884; workspace composition at 2026–2050 supplies otherwise empty option arrays. Catalogs remain independent via [loadOpsTaskWorkspaceOptionData:1728](/Users/hyunjun/Documents/Codex/tips_dashboard/src/features/tasks/ops-task-service.ts:1728); stats/runtime via [supplements:1821](/Users/hyunjun/Documents/Codex/tips_dashboard/src/features/tasks/ops-task-service.ts:1821); detail/comments/events via [loadOpsTaskById:2068](/Users/hyunjun/Documents/Codex/tips_dashboard/src/features/tasks/ops-task-service.ts:2068); registration detail via 2161. Do not import global Supabase reads into the injected factory.
- Completed actor source is **only** the authorized task's stored `completed_by` and `completed_by_label`. Final v2 appends `completedById`/`completedByLabel` after paging at [actor SQL:175](/Users/hyunjun/Documents/Codex/tips_dashboard/supabase/migrations/20260820150057_ops_task_completion_actor.sql:175); the list mapper converts these to `completedBy`/`completedByLabel` at 1561–1562. Preserve null actor → empty string and absent historical evidence. Do not use assignee, event guesses, current viewer or fresh profile joins to fill blanks. Profile RLS is intentionally narrower; actor SQL comments 158–161 explicitly explain the snapshot design.
- `viewerId` is a required client scope/cache identity, **not** DB authorization. Do not add `p_viewer_id` as an authority override. Use the authenticated caller's DB client, SECURITY INVOKER, `auth.uid()` predicates, underlying RLS and explicit revoke PUBLIC/anon + grant authenticated for the new public/helper functions. Existing task RLS is [20260808172743_rls_policy_initplan_consolidation.sql:146](/Users/hyunjun/Documents/Codex/tips_dashboard/supabase/migrations/20260808172743_rls_policy_initplan_consolidation.sql:146). Clearing old-viewer rows/controller/cache state must accompany viewer changes; a nonempty string check by itself does not prove authentication.

## Suggested SQL boundary

1. New invoker helper or CTE: validated type/filters → authorized eligible parent ID + only required sort/filter scalars + registration representative track ID. Required relationship predicates stay here; no row JSON, comments/events, or all-track aggregation.
2. In one STABLE statement/snapshot, materialize eligible keys once; derive total and ordered offset/limit page from that same relation. Preserve existing timezone-dependent selection (`Asia/Seoul`). Define out-of-range/clamp behavior consistently with the shared controller; retain count on empty pages through an independent count aggregate and coalesced empty row array.
3. Bounded projector joins the selected page IDs to tasks/detail/profile labels only as needed, aggregates all authorized registration sibling tracks for those parents, and appends actor snapshots. Carry/order by the selected ordinal so JSON aggregate order is explicit. Do not re-enter the unrestricted old source function during projection.
4. Leave cursor v1/v2, stats wrapper and mutation/trigger functions unchanged. Parity fixtures must include all five selection branches, multiple registration tracks and tied representative times, scalar header columns, auth role visibility, and empty/off-end counts. Static source shape alone is not SQL performance proof.

## Calendar / appointment preservation boundary

The real independent full requested-range reader is [registration-track-service.ts:2108](/Users/hyunjun/Documents/Codex/tips_dashboard/src/features/tasks/registration-track-service.ts:2108): it probes runtime then queries `ops_registration_appointment_calendar` with scheduled-at lower/upper range, statuses and appointment-ID tie sort (2122–2133). [registration-appointment-calendar.tsx:195](/Users/hyunjun/Documents/Codex/tips_dashboard/src/features/tasks/registration-appointment-calendar.tsx:195) owns that range request. Leave it and [loadRegistrationAppointmentCalendar:3896](/Users/hyunjun/Documents/Codex/tips_dashboard/src/features/tasks/registration-track-service.ts:3896) independent of numbered rows, page-size preferences, and parent-list filters; do not add a 10/15/20 cap.

There is also a legacy generic calendar branch that is **already page-coupled**, not an independent range reader: `calendarItems = loadCalendarRows(visibleTasks)` at [workspace:9542](/Users/hyunjun/Documents/Codex/tips_dashboard/src/features/tasks/ops-task-workspace.tsx:9542), consumed under `!isTodoWorkspace && view === 'calendar'` at 13206. Do not claim every calendar currently has a full-range contract. Confirm that branch's reachable route separately before changing it; if reachable in the numbered slice, it requires a separately scoped calendar read, not the new current page as an event source.

Controller follow-up: the current WorkspaceKey union at293 contains only todo, registration, transfer, withdrawal and word_retest; all five route callers use these values. The render chain at13025–13206 handles the four non-todo workspaces before reaching the generic calendar condition, which excludes todo. It is therefore unreachable in the current supported routes. The plan preserves the real registration range reader without adding a new API for this dead branch; re-evaluate only if the union/render order changes.

## Evidence limits / next implementation brief

No tests, EXPLAIN, remote ledger checks, browser checks, or DB writes were run. Required next gates are behavior tests for the exported seam (including no `.from` hydration/fallback calls), final-definition pgTAP filter/sort/auth/actor cases, and independent review that projection happens only after selected parent IDs. This report neither authorizes remote migrations/deployment nor changes no-send/notification boundaries.

## Task 2 actor/cache follow-up

Read-only client preflight on 2026-08-31 confirmed that the existing workspace session, cursor snapshots, stats, options and details use viewer ID without resolved role. The stats cache additionally retains in-flight promises across its values-only `clear()`. A same-ID role change can therefore reuse previous-authority data even after a React remount.

The Task 2 plan now requires a resolved `viewerId + role` client scope and an invalidation epoch, including supplemental cache values, pending promises and UI completion ownership. Optional client cache scope arguments may preserve legacy defaults; the new numbered service remains cache-free and sends no role/viewer authority override to SQL. Registration cache-clear cascading and generation guards must remain intact. Login/profile resolution issues no production list RPC until ready.

This is a targeted cache boundary correction, not an auth-provider redesign. Global registration schema/runtime capability probes, calendar range reads, mutation idempotency, notification sends and cursor compatibility remain unchanged. Required rendered tests cover same-ID role change, logout/user switch, delayed stats/catalog/detail/observation completions, and score drafts that survive pagination only within the same actor scope. Source inspection is not execution evidence.
